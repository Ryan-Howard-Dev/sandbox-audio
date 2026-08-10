/*!
Library roots, and the rule that nothing may act outside one.

The desktop had no idea where your files were. It played from the server's blob store or from a
URL, and the Rust side owned no filesystem operation beyond creating its own config directory. A
manager that can rename and move files needs to know which folders it is allowed to touch, and
needs that boundary to be the first thing every operation passes through rather than a check each
new command remembers to make.

Confinement resolves symlinks before comparing, because a link inside the library pointing at
C:\Windows is otherwise a perfectly ordinary way for a rename rule to leave the library.
*/

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Which station a folder feeds. A root belongs to one; a library with music and audiobooks in the
/// same tree is two roots pointing at different subfolders, not one root serving both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RootKind {
    Music,
    Podcast,
    Audiobook,
    Document,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    pub id: String,
    /// Stored as the canonical path, so two roots added by different routes to the same folder
    /// compare equal instead of quietly both existing.
    pub path: PathBuf,
    pub kind: RootKind,
    pub added_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRootStore {
    #[serde(default)]
    pub roots: Vec<LibraryRoot>,
}

fn store_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("library_roots.json")
}

pub fn load_roots(app: &AppHandle) -> LibraryRootStore {
    let path = store_path(app);
    if !path.exists() {
        return LibraryRootStore::default();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_roots(app: &AppHandle, store: &LibraryRootStore) -> Result<(), String> {
    let path = store_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

pub fn root_paths(store: &LibraryRootStore) -> Vec<PathBuf> {
    store.roots.iter().map(|r| r.path.clone()).collect()
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfineError {
    /// The path resolved to somewhere no root covers. The common case, and the one that matters.
    OutsideRoots,
    /// The path cannot be resolved at all — a missing parent directory, or a permission wall.
    Unresolvable,
    /// There are no roots, so nothing is permitted. Distinguished from OutsideRoots because the
    /// answer for a person seeing it is "add a folder", not "that folder is not allowed".
    NoRoots,
}

impl ConfineError {
    pub fn message(&self) -> &'static str {
        match self {
            ConfineError::OutsideRoots => "That path is outside every library folder",
            ConfineError::Unresolvable => "That path could not be resolved",
            ConfineError::NoRoots => "No library folder has been added yet",
        }
    }
}

/// Resolve a path that must already exist, and prove it sits inside a root.
pub fn confine_existing(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, ConfineError> {
    if roots.is_empty() {
        return Err(ConfineError::NoRoots);
    }
    let resolved = std::fs::canonicalize(path).map_err(|_| ConfineError::Unresolvable)?;
    if roots.iter().any(|root| is_within(&resolved, root)) {
        Ok(resolved)
    } else {
        Err(ConfineError::OutsideRoots)
    }
}

/// Resolve a path that does not exist yet — a destination for a move or rename.
///
/// canonicalize fails on anything absent, so the parent is resolved and the final component
/// appended. That also stops `..` in the last component from being treated as a name.
pub fn confine_target(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, ConfineError> {
    if roots.is_empty() {
        return Err(ConfineError::NoRoots);
    }
    let parent = path.parent().ok_or(ConfineError::Unresolvable)?;
    let name = path.file_name().ok_or(ConfineError::Unresolvable)?;
    if name == std::ffi::OsStr::new("..") || name == std::ffi::OsStr::new(".") {
        return Err(ConfineError::Unresolvable);
    }
    let resolved_parent = confine_existing(parent, roots)?;
    Ok(resolved_parent.join(name))
}

/// True when `path` is the root itself or sits beneath it.
///
/// Compares whole components rather than string prefixes, so a sibling folder whose name merely
/// starts with the root's name is not mistaken for a child of it.
fn is_within(path: &Path, root: &Path) -> bool {
    let root = match std::fs::canonicalize(root) {
        Ok(resolved) => resolved,
        Err(_) => root.to_path_buf(),
    };
    path == root || path.starts_with(&root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Temp(PathBuf);

    impl Temp {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "sandbox-roots-{tag}-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&base).unwrap();
            Temp(base)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn accepts_a_file_inside_a_root() {
        let tmp = Temp::new("inside");
        let root = tmp.path().join("library");
        fs::create_dir_all(&root).unwrap();
        let file = root.join("track.flac");
        fs::write(&file, b"x").unwrap();

        let roots = vec![root.clone()];
        assert!(confine_existing(&file, &roots).is_ok());
    }

    #[test]
    fn accepts_the_root_itself() {
        let tmp = Temp::new("self");
        let root = tmp.path().join("library");
        fs::create_dir_all(&root).unwrap();

        let roots = vec![root.clone()];
        assert!(confine_existing(&root, &roots).is_ok());
    }

    #[test]
    fn rejects_a_sibling_of_the_root() {
        let tmp = Temp::new("sibling");
        let root = tmp.path().join("library");
        let other = tmp.path().join("elsewhere");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&other).unwrap();
        let file = other.join("secret.txt");
        fs::write(&file, b"x").unwrap();

        let roots = vec![root];
        assert_eq!(confine_existing(&file, &roots), Err(ConfineError::OutsideRoots));
    }

    #[test]
    fn rejects_a_folder_whose_name_merely_starts_with_the_root_name() {
        // "library-backup" shares a string prefix with "library" and is not inside it. A
        // starts_with on the raw string would let this through.
        let tmp = Temp::new("prefix");
        let root = tmp.path().join("library");
        let lookalike = tmp.path().join("library-backup");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&lookalike).unwrap();
        let file = lookalike.join("track.flac");
        fs::write(&file, b"x").unwrap();

        let roots = vec![root];
        assert_eq!(confine_existing(&file, &roots), Err(ConfineError::OutsideRoots));
    }

    #[test]
    fn rejects_climbing_out_with_dot_dot() {
        let tmp = Temp::new("climb");
        let root = tmp.path().join("library");
        let other = tmp.path().join("elsewhere");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&other).unwrap();
        let file = other.join("secret.txt");
        fs::write(&file, b"x").unwrap();

        let escape = root.join("..").join("elsewhere").join("secret.txt");
        let roots = vec![root];
        assert_eq!(confine_existing(&escape, &roots), Err(ConfineError::OutsideRoots));
    }

    #[test]
    fn refuses_everything_when_no_root_is_registered() {
        let tmp = Temp::new("empty");
        let file = tmp.path().join("track.flac");
        fs::write(&file, b"x").unwrap();

        assert_eq!(confine_existing(&file, &[]), Err(ConfineError::NoRoots));
    }

    #[test]
    fn target_resolves_a_name_that_does_not_exist_yet() {
        let tmp = Temp::new("target");
        let root = tmp.path().join("library");
        fs::create_dir_all(&root).unwrap();

        let roots = vec![root.clone()];
        let target = root.join("renamed.flac");
        let resolved = confine_target(&target, &roots).unwrap();
        assert!(resolved.ends_with("renamed.flac"));
    }

    #[test]
    fn target_rejects_a_destination_outside_the_roots() {
        let tmp = Temp::new("target-out");
        let root = tmp.path().join("library");
        let other = tmp.path().join("elsewhere");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&other).unwrap();

        let roots = vec![root];
        let target = other.join("smuggled.flac");
        assert_eq!(confine_target(&target, &roots), Err(ConfineError::OutsideRoots));
    }

    #[test]
    fn target_rejects_dot_dot_as_the_final_component() {
        let tmp = Temp::new("target-dotdot");
        let root = tmp.path().join("library");
        fs::create_dir_all(&root).unwrap();

        let roots = vec![root.clone()];
        assert_eq!(
            confine_target(&root.join(".."), &roots),
            Err(ConfineError::Unresolvable)
        );
    }
}
