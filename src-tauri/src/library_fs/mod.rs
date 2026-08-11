/*!
The desktop's filesystem layer: which folders it may touch, what it can see in them, and the
plan-then-apply path for changing anything.

Nothing above this can move a file, and nothing here moves a file without having described the move
first. The three rules the whole manager rests on:

  - Every path resolves inside a registered library root, symlinks followed, before anything reads
    or writes it.
  - Apply takes a plan id, not operations, so nothing runs that was not previewed.
  - Deletes go to the recycle bin, and every applied move is written to an undo log.
*/

pub mod media_server;
pub mod plan;
pub mod roots;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

use plan::{now_ms, plan_operations, Operation, Outcome, Plan};
use roots::{load_roots, root_paths, save_roots, LibraryRoot, RootKind};

/// Plans awaiting approval, and the undo log for what has already run.
#[derive(Default)]
pub struct LibraryFsState {
    plans: Mutex<HashMap<String, Plan>>,
}

impl LibraryFsState {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: PathBuf,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// Epoch milliseconds, 0 where the platform will not say.
    pub modified: u64,
    pub extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub entries: Vec<FileEntry>,
    /// True when the cap was hit. A library of 200k files must not be returned in one array and
    /// silently pretend to be the whole picture.
    pub truncated: bool,
    pub scanned: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedChange {
    pub from: PathBuf,
    pub to: Option<PathBuf>,
    pub ok: bool,
    pub error: Option<String>,
    /// True where the change was skipped because the plan said it was blocked.
    pub skipped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub plan_id: String,
    pub applied: usize,
    pub failed: usize,
    pub skipped: usize,
    pub changes: Vec<AppliedChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UndoRecord {
    plan_id: String,
    at: u64,
    /// Only reversible moves. A recycle-bin delete is not undone from here — the bin is where it
    /// gets undone, by the person, deliberately.
    moves: Vec<(PathBuf, PathBuf)>,
}

fn undo_log_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("library_undo_log.json")
}

fn append_undo(app: &AppHandle, record: UndoRecord) {
    if record.moves.is_empty() {
        return;
    }
    let path = undo_log_path(app);
    let mut log: Vec<UndoRecord> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    log.push(record);
    // Keep the log bounded; the last fifty runs is far more history than anybody reaches back for.
    let len = log.len();
    if len > 50 {
        log.drain(0..len - 50);
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(&log) {
        let _ = std::fs::write(path, raw);
    }
}

fn entry_from_path(path: &std::path::Path) -> Option<FileEntry> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(FileEntry {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        is_dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified,
        extension: path
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase()),
        path: path.to_path_buf(),
    })
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn library_roots_list(app: AppHandle) -> Vec<LibraryRoot> {
    load_roots(&app).roots
}

#[tauri::command]
pub fn library_root_add(app: AppHandle, path: String, kind: RootKind) -> Result<LibraryRoot, String> {
    let raw = PathBuf::from(&path);
    let resolved = std::fs::canonicalize(&raw)
        .map_err(|_| format!("That folder could not be found: {path}"))?;
    if !resolved.is_dir() {
        return Err("That is a file, not a folder".into());
    }

    let mut store = load_roots(&app);
    if store.roots.iter().any(|r| r.path == resolved) {
        return Err("That folder is already a library folder".into());
    }
    /*
     * Nesting one root inside another makes every path ambiguous — which root confines it, which
     * station owns it — and makes a scan return everything twice.
     */
    if let Some(existing) = store
        .roots
        .iter()
        .find(|r| resolved.starts_with(&r.path) || r.path.starts_with(&resolved))
    {
        return Err(format!(
            "That overlaps a library folder you already have: {}",
            existing.path.display()
        ));
    }

    let root = LibraryRoot {
        id: format!("root-{}-{}", now_ms(), store.roots.len()),
        path: resolved,
        kind,
        added_at: now_ms(),
    };
    store.roots.push(root.clone());
    save_roots(&app, &store)?;
    Ok(root)
}

#[tauri::command]
pub fn library_root_remove(app: AppHandle, id: String) -> Result<(), String> {
    let mut store = load_roots(&app);
    let before = store.roots.len();
    store.roots.retain(|r| r.id != id);
    if store.roots.len() == before {
        return Err("No such library folder".into());
    }
    // Forgetting a folder never touches what is in it.
    save_roots(&app, &store)
}

#[tauri::command]
pub fn library_scan(
    app: AppHandle,
    root_id: Option<String>,
    limit: Option<usize>,
) -> Result<ScanResult, String> {
    let store = load_roots(&app);
    if store.roots.is_empty() {
        return Err("No library folder has been added yet".into());
    }
    let targets: Vec<&LibraryRoot> = match &root_id {
        Some(id) => store.roots.iter().filter(|r| &r.id == id).collect(),
        None => store.roots.iter().collect(),
    };
    if targets.is_empty() {
        return Err("No such library folder".into());
    }

    let cap = limit.unwrap_or(50_000);
    let mut entries = Vec::new();
    let mut scanned = 0usize;
    let mut truncated = false;

    for root in targets {
        for item in WalkDir::new(&root.path).follow_links(false) {
            let Ok(item) = item else { continue };
            scanned += 1;
            if entries.len() >= cap {
                truncated = true;
                break;
            }
            if item.depth() == 0 {
                continue;
            }
            if let Some(entry) = entry_from_path(item.path()) {
                entries.push(entry);
            }
        }
        if truncated {
            break;
        }
    }

    Ok(ScanResult {
        entries,
        truncated,
        scanned,
    })
}

#[tauri::command]
pub fn library_stat(app: AppHandle, path: String) -> Result<FileEntry, String> {
    let store = load_roots(&app);
    let resolved = roots::confine_existing(&PathBuf::from(&path), &root_paths(&store))
        .map_err(|e| e.message().to_string())?;
    entry_from_path(&resolved).ok_or_else(|| "That path could not be read".into())
}

/// Describe what a set of operations would do. Writes nothing.
#[tauri::command]
pub fn library_plan(
    app: AppHandle,
    state: State<'_, LibraryFsState>,
    operations: Vec<Operation>,
) -> Result<Plan, String> {
    let store = load_roots(&app);
    let plan = plan_operations(operations, &root_paths(&store));
    state.plans.lock().insert(plan.id.clone(), plan.clone());
    Ok(plan)
}

/// Carry out a plan that was already produced and handed back.
///
/// Takes an id rather than operations so that nothing can run without having been previewed, and
/// re-checks confinement at the moment of writing: a plan is a description of the disk as it was,
/// and the disk may have moved on.
#[tauri::command]
pub fn library_apply(
    app: AppHandle,
    state: State<'_, LibraryFsState>,
    plan_id: String,
) -> Result<ApplyResult, String> {
    let plan = state
        .plans
        .lock()
        .remove(&plan_id)
        .ok_or("That plan is unknown or has already been applied")?;

    let store = load_roots(&app);
    let allowed = root_paths(&store);
    let mut changes = Vec::with_capacity(plan.changes.len());
    let mut applied = 0usize;
    let mut failed = 0usize;
    let mut skipped = 0usize;
    let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();

    for change in &plan.changes {
        if change.outcome.blocks() || change.outcome == Outcome::NoChange {
            skipped += 1;
            changes.push(AppliedChange {
                from: change.from.clone(),
                to: change.to.clone(),
                ok: false,
                error: None,
                skipped: true,
            });
            continue;
        }

        /*
         * Each operation is isolated, so one going wrong cannot take the record of the others
         * with it.
         *
         * The undo log is written after this loop. Without the catch, a panic part way through
         * leaves files already moved and no log saying where they came from -- the one state this
         * layer must never produce, since undo is the answer to a rule that turned out wrong.
         * Tauri would surface the panic as a failed call rather than corrupting anything, but the
         * moved files would still be unrecoverable by any means the app offers.
         */
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            apply_one(change, &allowed)
        }))
        .unwrap_or_else(|_| Err("That operation failed unexpectedly".to_string()));
        match result {
            Ok(()) => {
                applied += 1;
                if let Some(to) = &change.to {
                    if !matches!(change.operation, Operation::CreateDir { .. }) {
                        moves.push((change.from.clone(), to.clone()));
                    }
                }
                changes.push(AppliedChange {
                    from: change.from.clone(),
                    to: change.to.clone(),
                    ok: true,
                    error: None,
                    skipped: false,
                });
            }
            Err(err) => {
                failed += 1;
                changes.push(AppliedChange {
                    from: change.from.clone(),
                    to: change.to.clone(),
                    ok: false,
                    error: Some(err),
                    skipped: false,
                });
            }
        }
    }

    append_undo(
        &app,
        UndoRecord {
            plan_id: plan.id.clone(),
            at: now_ms(),
            moves,
        },
    );

    Ok(ApplyResult {
        plan_id: plan.id,
        applied,
        failed,
        skipped,
        changes,
    })
}

fn apply_one(change: &plan::PlannedChange, allowed: &[PathBuf]) -> Result<(), String> {
    match &change.operation {
        Operation::Delete { .. } => {
            let from = roots::confine_existing(&change.from, allowed)
                .map_err(|e| e.message().to_string())?;
            trash::delete(&from).map_err(|e| format!("Could not move to the recycle bin: {e}"))
        }
        Operation::CreateDir { .. } => {
            let to = change.to.as_ref().ok_or("No destination")?;
            roots::confine_target(to, allowed).map_err(|e| e.message().to_string())?;
            std::fs::create_dir_all(to).map_err(|e| e.to_string())
        }
        Operation::Rename { .. } | Operation::Move { .. } => {
            let from = roots::confine_existing(&change.from, allowed)
                .map_err(|e| e.message().to_string())?;
            let to = change.to.as_ref().ok_or("No destination")?;
            let to = roots::confine_target(to, allowed).map_err(|e| e.message().to_string())?;
            // Re-checked here rather than trusted from the plan: something else may have created
            // this in between, and rename would overwrite it without a word.
            if to.exists() {
                return Err("Something already exists there".into());
            }
            std::fs::rename(&from, &to).map_err(|e| e.to_string())
        }
    }
}

/**
 * A url the player can stream this file from.
 *
 * The WebView cannot open a path, and handing it the asset protocol would hand it the whole disk.
 * So Rust serves the bytes over loopback, with byte ranges, and the player treats the library as
 * an ordinary HTTP source it already knows how to buffer and seek.
 *
 * The path is confined before a url is minted as well as on every request that follows. Failing
 * here means the caller learns immediately, rather than getting a url that will only ever 403.
 */
#[tauri::command]
pub fn library_media_url(
    app: AppHandle,
    state: State<'_, media_server::MediaServerState>,
    path: String,
) -> Result<String, String> {
    let store = load_roots(&app);
    let allowed = root_paths(&store);
    let resolved = roots::confine_existing(&PathBuf::from(&path), &allowed)
        .map_err(|e| e.message().to_string())?;

    let handle = app.clone();
    let roots_fn: Arc<dyn Fn() -> Vec<PathBuf> + Send + Sync> =
        Arc::new(move || root_paths(&load_roots(&handle)));

    let (port, token) = media_server::ensure_running(&state, roots_fn)?;
    Ok(format!(
        "http://127.0.0.1:{port}/media?t={}&p={}",
        media_server::percent_encode(&token),
        media_server::percent_encode(&resolved.to_string_lossy()),
    ))
}

/// Reverse the most recent applied run, where the files are still where it left them.
#[tauri::command]
pub fn library_undo_last(app: AppHandle) -> Result<ApplyResult, String> {
    let path = undo_log_path(&app);
    let mut log: Vec<UndoRecord> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let record = log.pop().ok_or("There is nothing to undo")?;

    let store = load_roots(&app);
    let allowed = root_paths(&store);
    let mut changes = Vec::new();
    let mut applied = 0usize;
    let mut failed = 0usize;

    // Reversed, so a run that moved A to B then B to C is undone C to B then B to A.
    for (from, to) in record.moves.iter().rev() {
        let result = (|| -> Result<(), String> {
            let current =
                roots::confine_existing(to, &allowed).map_err(|e| e.message().to_string())?;
            let original =
                roots::confine_target(from, &allowed).map_err(|e| e.message().to_string())?;
            if original.exists() {
                return Err("Something is back at the original name already".into());
            }
            std::fs::rename(&current, &original).map_err(|e| e.to_string())
        })();

        match result {
            Ok(()) => {
                applied += 1;
                changes.push(AppliedChange {
                    from: to.clone(),
                    to: Some(from.clone()),
                    ok: true,
                    error: None,
                    skipped: false,
                });
            }
            Err(err) => {
                failed += 1;
                changes.push(AppliedChange {
                    from: to.clone(),
                    to: Some(from.clone()),
                    ok: false,
                    error: Some(err),
                    skipped: false,
                });
            }
        }
    }

    if let Ok(raw) = serde_json::to_string_pretty(&log) {
        let _ = std::fs::write(&path, raw);
    }

    Ok(ApplyResult {
        plan_id: record.plan_id,
        applied,
        failed,
        skipped: 0,
        changes,
    })
}

#[cfg(test)]
mod tests {
    use super::plan::{plan_operations, Operation, Outcome};
    use std::fs;
    use std::path::PathBuf;

    struct Temp(PathBuf);
    impl Temp {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "sandbox-fs-{tag}-{}",
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

    /// The apply path without the Tauri state wrapper, so the write half is covered too.
    fn apply_plan_directly(plan: &super::Plan, allowed: &[PathBuf]) -> (usize, usize) {
        let mut applied = 0;
        let mut failed = 0;
        for change in &plan.changes {
            if change.outcome.blocks() || change.outcome == Outcome::NoChange {
                continue;
            }
            match super::apply_one(change, allowed) {
                Ok(()) => applied += 1,
                Err(_) => failed += 1,
            }
        }
        (applied, failed)
    }

    #[test]
    fn a_planned_rename_actually_renames_when_applied() {
        let t = Temp::new("apply");
        let root = t.0.join("library");
        fs::create_dir_all(&root).unwrap();
        let file = root.join("01 track.flac");
        fs::write(&file, b"x").unwrap();

        let allowed = vec![root.clone()];
        let plan = plan_operations(
            vec![Operation::Rename {
                path: file.clone(),
                to_name: "Intro.flac".into(),
            }],
            &allowed,
        );
        let (applied, failed) = apply_plan_directly(&plan, &allowed);

        assert_eq!((applied, failed), (1, 0));
        assert!(!file.exists());
        assert!(root.join("Intro.flac").exists());
    }

    #[test]
    fn a_blocked_change_is_not_carried_out() {
        let t = Temp::new("blocked");
        let root = t.0.join("library");
        let outside = t.0.join("elsewhere");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let stranger = outside.join("untouched.txt");
        fs::write(&stranger, b"x").unwrap();

        let allowed = vec![root];
        let plan = plan_operations(
            vec![Operation::Delete {
                path: stranger.clone(),
            }],
            &allowed,
        );
        let (applied, failed) = apply_plan_directly(&plan, &allowed);

        assert_eq!((applied, failed), (0, 0));
        assert!(stranger.exists(), "a file outside the roots must survive");
    }

    #[test]
    fn a_delete_removes_the_file_by_way_of_the_recycle_bin() {
        // The destructive path, covered deliberately. The file leaves its original location and is
        // recoverable from the bin rather than gone, which is the whole reason deletes route there.
        let t = Temp::new("delete");
        let root = t.0.join("library");
        fs::create_dir_all(&root).unwrap();
        let file = root.join("sandbox-test-delete-me.flac");
        fs::write(&file, b"x").unwrap();

        let allowed = vec![root];
        let plan = plan_operations(
            vec![Operation::Delete {
                path: file.clone(),
            }],
            &allowed,
        );
        assert_eq!(plan.changes[0].outcome, Outcome::Ok);
        let (applied, failed) = apply_plan_directly(&plan, &allowed);

        assert_eq!((applied, failed), (1, 0));
        assert!(!file.exists());
    }

    #[test]
    fn a_move_lands_the_file_in_the_new_folder() {
        let t = Temp::new("move");
        let root = t.0.join("library");
        let album = root.join("Album");
        fs::create_dir_all(&album).unwrap();
        let file = root.join("track.flac");
        fs::write(&file, b"x").unwrap();

        let allowed = vec![root.clone()];
        let plan = plan_operations(
            vec![Operation::Move {
                path: file.clone(),
                to_dir: album.clone(),
            }],
            &allowed,
        );
        let (applied, _) = apply_plan_directly(&plan, &allowed);

        assert_eq!(applied, 1);
        assert!(album.join("track.flac").exists());
        assert!(!file.exists());
    }
}
