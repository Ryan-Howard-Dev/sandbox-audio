/*!
Plan first, then apply.

This is the layer that can destroy a library. A naming rule applied to forty thousand files is not
something anybody can check by reading the rule, so nothing here writes to disk until the exact
list of paths that will change has been produced and handed back. Apply takes a plan id rather than
a list of operations, which means an operation that was never previewed cannot be executed at all.

Deletes go to the recycle bin. A media manager that unlinks files is one bad rule away from being
the reason somebody loses a collection they spent fifteen years building, and the recycle bin costs
nothing to route through.
*/

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::roots::{confine_existing, confine_new_path, confine_target, ConfineError};

#[derive(Debug, Clone, Serialize, Deserialize)]
/*
 * rename_all renames the variants; rename_all_fields renames what is inside them.
 *
 * Without the second, the tag arrives as "move" exactly as the client sends it and the field it
 * carries is expected as to_dir while the client sends toDir, so every move and rename is rejected
 * at the boundary with a message about a missing field. Nothing in Rust caught it: the tests build
 * these values directly and never go through serde at all.
 */
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum Operation {
    /// Change a file or folder's name, leaving it where it is.
    Rename { path: PathBuf, to_name: String },
    /// Move a file or folder into another directory, optionally under a new name.
    ///
    /// The name belongs here rather than in a following rename. Organising changes the folder and
    /// the file name together, and as two operations the rename can never be planned: its source
    /// does not exist until the move it depends on has already run.
    Move {
        path: PathBuf,
        to_dir: PathBuf,
        #[serde(default)]
        to_name: Option<String>,
    },
    /// Send to the recycle bin.
    Delete { path: PathBuf },
    /// Create a directory, including any missing parents inside the root.
    CreateDir { path: PathBuf },
}

/// Why a planned change can or cannot proceed. Everything is reported; nothing is silently dropped,
/// because a plan that quietly omits the operations it disliked is a plan you cannot trust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Ok,
    /// Something already exists at the destination.
    Collision,
    /// The source is gone — a stale plan, or another program moved it.
    SourceMissing,
    /// Source or destination resolves outside every library root.
    OutsideRoots,
    /// No library folder has been added, so nothing is permitted.
    NoRoots,
    /// Destination equals source. Not an error, just nothing to do.
    NoChange,
    /// The name is empty, or contains a path separator, or is a reserved device name.
    InvalidName,
}

impl Outcome {
    pub fn blocks(self) -> bool {
        !matches!(self, Outcome::Ok | Outcome::NoChange)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedChange {
    pub operation: Operation,
    pub from: PathBuf,
    /// Absent for a delete, which has no destination.
    pub to: Option<PathBuf>,
    pub outcome: Outcome,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub changes: Vec<PlannedChange>,
    /// How many changes cannot proceed. A caller that ignores everything else should still refuse
    /// to apply a plan with a non-zero count without saying so.
    pub blocked: usize,
    pub created_at: u64,
}

/// Names Windows refuses regardless of extension. Creating one silently fails or produces something
/// unopenable, so it is caught while it is still a plan.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub fn name_outcome(name: &str) -> Option<Outcome> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Some(Outcome::InvalidName);
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Some(Outcome::InvalidName);
    }
    if trimmed == "." || trimmed == ".." {
        return Some(Outcome::InvalidName);
    }
    // A trailing dot or space is legal to ask for and not legal to store on Windows; it gets
    // stripped on write, so the file ends up under a name nobody asked for.
    if trimmed.ends_with('.') || name.ends_with(' ') {
        return Some(Outcome::InvalidName);
    }
    let stem = trimmed.split('.').next().unwrap_or(trimmed).to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        return Some(Outcome::InvalidName);
    }
    if trimmed.chars().any(|c| matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return Some(Outcome::InvalidName);
    }
    None
}

fn confine_outcome(err: ConfineError) -> Outcome {
    match err {
        ConfineError::OutsideRoots => Outcome::OutsideRoots,
        ConfineError::NoRoots => Outcome::NoRoots,
        ConfineError::Unresolvable => Outcome::SourceMissing,
    }
}

/// Describe what each operation would do, touching nothing.
pub fn plan_operations(operations: Vec<Operation>, roots: &[PathBuf]) -> Plan {
    let mut changes = Vec::with_capacity(operations.len());

    /*
     * Folders this plan will create, treated as existing by the operations that follow.
     *
     * A plan is checked against the disk as it is now, and organising means creating a folder and
     * then moving into it — so without this the move is measured against a disk where its
     * destination does not exist yet and every single one is refused. That is not an edge case, it
     * is what filing a library into artist and album folders looks like.
     *
     * Only folders the plan itself confined and accepted count, so this widens what can be
     * planned without widening what can be reached.
     */
    let mut will_exist: Vec<PathBuf> = Vec::new();

    for operation in operations {
        let change = match &operation {
            Operation::Rename { path, to_name } => plan_rename(&operation, path, to_name, roots),
            Operation::Move { path, to_dir, to_name } => {
                plan_move(&operation, path, to_dir, to_name.as_deref(), roots, &will_exist)
            }
            Operation::Delete { path } => plan_delete(&operation, path, roots),
            Operation::CreateDir { path } => plan_create_dir(&operation, path, roots),
        };
        if matches!(operation, Operation::CreateDir { .. })
            && !change.outcome.blocks()
        {
            if let Some(to) = &change.to {
                will_exist.push(to.clone());
            }
        }
        changes.push(change);
    }

    /*
     * Collisions the plan creates itself, which no per-operation check can see.
     *
     * Two renames that individually look fine can both target one name — a rule that strips track
     * numbers turns "01 Intro" and "02 Intro" into the same thing. Left unchecked the second
     * silently overwrites the first, and one of the two files is simply gone.
     */
    let mut seen: Vec<PathBuf> = Vec::new();
    for change in changes.iter_mut() {
        if change.outcome != Outcome::Ok {
            continue;
        }
        if let Some(to) = &change.to {
            if seen.contains(to) {
                change.outcome = Outcome::Collision;
                change.note = Some("Another change in this plan already targets that name".into());
            } else {
                seen.push(to.clone());
            }
        }
    }

    let blocked = changes.iter().filter(|c| c.outcome.blocks()).count();
    Plan {
        id: new_plan_id(),
        changes,
        blocked,
        created_at: now_ms(),
    }
}

fn plan_rename(
    operation: &Operation,
    path: &PathBuf,
    to_name: &str,
    roots: &[PathBuf],
) -> PlannedChange {
    let from = match confine_existing(path, roots) {
        Ok(p) => p,
        Err(e) => return blocked_change(operation, path.clone(), None, confine_outcome(e)),
    };
    if let Some(outcome) = name_outcome(to_name) {
        return blocked_change(operation, from, None, outcome);
    }
    let parent = match from.parent() {
        Some(p) => p.to_path_buf(),
        None => return blocked_change(operation, from, None, Outcome::OutsideRoots),
    };
    let to = parent.join(to_name.trim());
    if to == from {
        return PlannedChange {
            operation: operation.clone(),
            from,
            to: Some(to),
            outcome: Outcome::NoChange,
            note: None,
        };
    }
    let outcome = if to.exists() { Outcome::Collision } else { Outcome::Ok };
    PlannedChange {
        operation: operation.clone(),
        from,
        to: Some(to),
        outcome,
        note: None,
    }
}

fn plan_move(
    operation: &Operation,
    path: &PathBuf,
    to_dir: &PathBuf,
    to_name: Option<&str>,
    roots: &[PathBuf],
    will_exist: &[PathBuf],
) -> PlannedChange {
    let from = match confine_existing(path, roots) {
        Ok(p) => p,
        Err(e) => return blocked_change(operation, path.clone(), None, confine_outcome(e)),
    };
    let dir = match confine_existing(to_dir, roots) {
        Ok(p) => p,
        Err(e) => {
            // Not there yet, but this plan is about to make it. Matched against what an earlier
            // createDir resolved to, so the destination is still one confinement already approved.
            match confine_new_path(to_dir, roots) {
                Ok(target) if will_exist.iter().any(|d| d == &target) => target,
                _ => return blocked_change(operation, from, None, confine_outcome(e)),
            }
        }
    };
    let name = match to_name {
        Some(requested) => {
            if let Some(outcome) = name_outcome(requested) {
                return blocked_change(operation, from, None, outcome);
            }
            std::ffi::OsString::from(requested.trim())
        }
        None => match from.file_name() {
            Some(n) => n.to_os_string(),
            None => return blocked_change(operation, from, None, Outcome::InvalidName),
        },
    };
    let to = dir.join(&name);
    if to == from {
        return PlannedChange {
            operation: operation.clone(),
            from,
            to: Some(to),
            outcome: Outcome::NoChange,
            note: None,
        };
    }
    // Moving a folder inside itself detaches the subtree; the OS may or may not stop it.
    if from.is_dir() && dir.starts_with(&from) {
        return PlannedChange {
            operation: operation.clone(),
            from,
            to: Some(to),
            outcome: Outcome::InvalidName,
            note: Some("A folder cannot be moved inside itself".into()),
        };
    }
    let outcome = if to.exists() { Outcome::Collision } else { Outcome::Ok };
    PlannedChange {
        operation: operation.clone(),
        from,
        to: Some(to),
        outcome,
        note: None,
    }
}

fn plan_delete(operation: &Operation, path: &PathBuf, roots: &[PathBuf]) -> PlannedChange {
    match confine_existing(path, roots) {
        Ok(from) => {
            /*
             * Deleting a root deletes the library. It is always a mistake, and it is exactly the
             * shape of mistake a rule generates: "remove empty folders" run against a library that
             * happens to be empty.
             */
            if roots.iter().any(|r| {
                std::fs::canonicalize(r).map(|c| c == from).unwrap_or(false)
            }) {
                return PlannedChange {
                    operation: operation.clone(),
                    from,
                    to: None,
                    outcome: Outcome::InvalidName,
                    note: Some("That is a library folder itself, not something in it".into()),
                };
            }
            let note = if from.is_dir() {
                Some("Folder and everything inside it".into())
            } else {
                None
            };
            PlannedChange {
                operation: operation.clone(),
                from,
                to: None,
                outcome: Outcome::Ok,
                note,
            }
        }
        Err(e) => blocked_change(operation, path.clone(), None, confine_outcome(e)),
    }
}

fn plan_create_dir(operation: &Operation, path: &PathBuf, roots: &[PathBuf]) -> PlannedChange {
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if let Some(outcome) = name_outcome(name) {
            return blocked_change(operation, path.clone(), None, outcome);
        }
    }
    match confine_new_path(path, roots) {
        Ok(to) => {
            let outcome = if to.exists() { Outcome::NoChange } else { Outcome::Ok };
            PlannedChange {
                operation: operation.clone(),
                from: to.clone(),
                to: Some(to),
                outcome,
                note: None,
            }
        }
        Err(e) => blocked_change(operation, path.clone(), None, confine_outcome(e)),
    }
}

fn blocked_change(
    operation: &Operation,
    from: PathBuf,
    to: Option<PathBuf>,
    outcome: Outcome,
) -> PlannedChange {
    PlannedChange {
        operation: operation.clone(),
        from,
        to,
        outcome,
        note: None,
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn new_plan_id() -> String {
    format!("plan-{}-{:x}", now_ms(), std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Temp(PathBuf);

    impl Temp {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "sandbox-plan-{tag}-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&base).unwrap();
            Temp(base)
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn library(tag: &str) -> (Temp, PathBuf) {
        let tmp = Temp::new(tag);
        let root = tmp.0.join("library");
        fs::create_dir_all(&root).unwrap();
        (tmp, root)
    }

    /*
     * The wire format, pinned against what the TypeScript client actually sends.
     *
     * Every other test in this file builds an Operation in Rust and never touches serde, which is
     * how a camelCase mismatch survived: the planner was correct and the boundary rejected every
     * move before reaching it.
     */
    #[test]
    fn deserializes_the_json_the_client_sends() {
        let move_op: Operation =
            serde_json::from_str(r#"{"kind":"move","path":"C:/a.flac","toDir":"C:/b"}"#)
                .expect("move");
        assert!(matches!(move_op, Operation::Move { .. }));

        let rename_op: Operation =
            serde_json::from_str(r#"{"kind":"rename","path":"C:/a.flac","toName":"b.flac"}"#)
                .expect("rename");
        assert!(matches!(rename_op, Operation::Rename { .. }));

        let delete_op: Operation =
            serde_json::from_str(r#"{"kind":"delete","path":"C:/a.flac"}"#).expect("delete");
        assert!(matches!(delete_op, Operation::Delete { .. }));

        let create_op: Operation =
            serde_json::from_str(r#"{"kind":"createDir","path":"C:/b"}"#).expect("createDir");
        assert!(matches!(create_op, Operation::CreateDir { .. }));
    }

    #[test]
    fn a_plain_rename_is_ok_and_changes_nothing_on_disk() {
        let (_t, root) = library("rename");
        let file = root.join("01 track.flac");
        fs::write(&file, b"x").unwrap();

        let plan = plan_operations(
            vec![Operation::Rename {
                path: file.clone(),
                to_name: "Intro.flac".into(),
            }],
            &[root.clone()],
        );

        assert_eq!(plan.changes[0].outcome, Outcome::Ok);
        assert_eq!(plan.blocked, 0);
        // The whole point: planning is not doing.
        assert!(file.exists());
        assert!(!root.join("Intro.flac").exists());
    }

    #[test]
    fn renaming_onto_an_existing_file_is_a_collision() {
        let (_t, root) = library("collide");
        let a = root.join("a.flac");
        let b = root.join("b.flac");
        fs::write(&a, b"x").unwrap();
        fs::write(&b, b"y").unwrap();

        let plan = plan_operations(
            vec![Operation::Rename {
                path: a,
                to_name: "b.flac".into(),
            }],
            &[root],
        );
        assert_eq!(plan.changes[0].outcome, Outcome::Collision);
        assert_eq!(plan.blocked, 1);
    }

    #[test]
    fn two_renames_targeting_one_name_collide_with_each_other() {
        // Neither is a collision on its own. Applied in order the second overwrites the first and
        // a file is gone with nothing reported.
        let (_t, root) = library("selfcollide");
        let a = root.join("01 Intro.flac");
        let b = root.join("02 Intro.flac");
        fs::write(&a, b"x").unwrap();
        fs::write(&b, b"y").unwrap();

        let plan = plan_operations(
            vec![
                Operation::Rename { path: a, to_name: "Intro.flac".into() },
                Operation::Rename { path: b, to_name: "Intro.flac".into() },
            ],
            &[root],
        );

        assert_eq!(plan.changes[0].outcome, Outcome::Ok);
        assert_eq!(plan.changes[1].outcome, Outcome::Collision);
        assert_eq!(plan.blocked, 1);
    }

    #[test]
    fn a_rename_carrying_a_separator_is_a_move_in_disguise_and_is_refused() {
        let (_t, root) = library("sep");
        let file = root.join("track.flac");
        fs::write(&file, b"x").unwrap();

        let plan = plan_operations(
            vec![Operation::Rename {
                path: file,
                to_name: "../escaped.flac".into(),
            }],
            &[root],
        );
        assert_eq!(plan.changes[0].outcome, Outcome::InvalidName);
    }

    #[test]
    fn reserved_windows_names_are_refused() {
        let (_t, root) = library("reserved");
        let file = root.join("track.flac");
        fs::write(&file, b"x").unwrap();

        for name in ["CON.flac", "nul.mp3", "Com1.txt"] {
            let plan = plan_operations(
                vec![Operation::Rename {
                    path: file.clone(),
                    to_name: name.into(),
                }],
                &[root.clone()],
            );
            assert_eq!(plan.changes[0].outcome, Outcome::InvalidName, "{name}");
        }
    }

    #[test]
    fn renaming_to_the_same_name_is_no_change_not_a_collision() {
        let (_t, root) = library("nochange");
        let file = root.join("track.flac");
        fs::write(&file, b"x").unwrap();

        let plan = plan_operations(
            vec![Operation::Rename {
                path: file,
                to_name: "track.flac".into(),
            }],
            &[root],
        );
        assert_eq!(plan.changes[0].outcome, Outcome::NoChange);
        assert_eq!(plan.blocked, 0);
    }

    #[test]
    fn a_move_into_a_folder_this_plan_creates_is_allowed() {
        /*
         * The whole shape of organising: make the artist/album folder, then move the track into it.
         * Planned against the disk as it is, the destination does not exist yet, and refusing on
         * that basis refuses every file being filed.
         */
        let (_t, root) = library("createthenmove");
        let file = root.join("track.flac");
        fs::write(&file, b"x").unwrap();
        let album = root.join("Radiohead").join("OK Computer");

        let plan = plan_operations(
            vec![
                Operation::CreateDir { path: album.clone() },
                Operation::Move { path: file, to_dir: album, to_name: None },
            ],
            &[root],
        );

        assert_eq!(plan.changes[0].outcome, Outcome::Ok);
        assert_eq!(plan.changes[1].outcome, Outcome::Ok, "{:?}", plan.changes[1]);
        assert_eq!(plan.blocked, 0);
    }

    #[test]
    fn a_move_into_a_folder_nobody_is_creating_is_still_refused() {
        // The allowance is only for folders this plan confined and accepted, not for any path that
        // happens to be absent.
        let (_t, root) = library("movenowhere");
        let file = root.join("track.flac");
        fs::write(&file, b"x").unwrap();

        let plan = plan_operations(
            vec![Operation::Move { path: file, to_dir: root.join("Nowhere"), to_name: None }],
            &[root],
        );
        assert!(plan.changes[0].outcome.blocks());
    }

    #[test]
    fn a_move_outside_the_roots_is_refused() {
        let (t, root) = library("moveout");
        let outside = t.0.join("elsewhere");
        fs::create_dir_all(&outside).unwrap();
        let file = root.join("track.flac");
        fs::write(&file, b"x").unwrap();

        let plan = plan_operations(
            vec![Operation::Move { path: file, to_dir: outside, to_name: None }],
            &[root],
        );
        assert_eq!(plan.changes[0].outcome, Outcome::OutsideRoots);
    }

    #[test]
    fn a_folder_cannot_be_moved_inside_itself() {
        let (_t, root) = library("selfmove");
        let album = root.join("Album");
        let inner = album.join("Disc 1");
        fs::create_dir_all(&inner).unwrap();

        let plan = plan_operations(
            vec![Operation::Move { path: album, to_dir: inner, to_name: None }],
            &[root],
        );
        assert_eq!(plan.changes[0].outcome, Outcome::InvalidName);
    }

    #[test]
    fn deleting_a_library_root_itself_is_refused() {
        let (_t, root) = library("delroot");

        let plan = plan_operations(
            vec![Operation::Delete { path: root.clone() }],
            &[root],
        );
        assert_eq!(plan.changes[0].outcome, Outcome::InvalidName);
    }

    #[test]
    fn deleting_a_folder_says_so_in_the_note() {
        let (_t, root) = library("delfolder");
        let album = root.join("Album");
        fs::create_dir_all(&album).unwrap();
        fs::write(album.join("track.flac"), b"x").unwrap();

        let plan = plan_operations(vec![Operation::Delete { path: album }], &[root]);
        assert_eq!(plan.changes[0].outcome, Outcome::Ok);
        assert!(plan.changes[0].note.is_some());
    }

    #[test]
    fn every_operation_is_reported_even_the_refused_ones() {
        // A plan that drops what it disliked cannot be checked by the person approving it.
        let (t, root) = library("reportall");
        let outside = t.0.join("elsewhere");
        fs::create_dir_all(&outside).unwrap();
        let good = root.join("a.flac");
        fs::write(&good, b"x").unwrap();
        let stranger = outside.join("b.flac");
        fs::write(&stranger, b"y").unwrap();

        let plan = plan_operations(
            vec![
                Operation::Rename { path: good, to_name: "renamed.flac".into() },
                Operation::Delete { path: stranger },
                Operation::Delete { path: root.join("missing.flac") },
            ],
            &[root],
        );

        assert_eq!(plan.changes.len(), 3);
        assert_eq!(plan.changes[0].outcome, Outcome::Ok);
        assert_eq!(plan.changes[1].outcome, Outcome::OutsideRoots);
        assert_eq!(plan.changes[2].outcome, Outcome::SourceMissing);
        assert_eq!(plan.blocked, 2);
    }
}
