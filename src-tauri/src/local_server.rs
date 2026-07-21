use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub struct LocalServerState {
    child: Mutex<Option<Child>>,
}

impl LocalServerState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

fn tier34_entry_exists(root: &Path) -> bool {
    root.join("tier34-server/index.ts").exists()
}

fn bundled_node_executable() -> Option<PathBuf> {
    const NODE_NAMES: &[&str] = &["node.exe", "node"];

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for name in NODE_NAMES {
                for candidate in [
                    parent.join("_up_").join("resources").join("node").join(name),
                    parent.join("resources").join("node").join(name),
                    parent.join("_up_").join("node").join(name),
                    parent.join("node").join(name),
                ] {
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    if let Ok(dir) = std::env::var("SANDBOX_TIER34_RESOURCE") {
        for name in NODE_NAMES {
            let candidate = PathBuf::from(&dir)
                .join("resources")
                .join("node")
                .join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

fn resolve_node_executable() -> String {
    if let Some(path) = bundled_node_executable() {
        return path.to_string_lossy().into_owned();
    }
    if cfg!(windows) {
        "node.exe".to_string()
    } else {
        "node".to_string()
    }
}

fn bundled_tier34_entry() -> Option<PathBuf> {
    const NAMES: &[&str] = &["tier34-server.mjs", "tier34-server.cjs"];

    if let Ok(dir) = std::env::var("SANDBOX_TIER34_RESOURCE") {
        for name in NAMES {
            for candidate in [
                PathBuf::from(&dir).join(name),
                PathBuf::from(&dir).join("dist").join(name),
            ] {
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for name in NAMES {
                for candidate in [
                    parent.join(name),
                    parent.join("resources").join(name),
                    parent.join("resources").join("dist").join(name),
                    parent.join("_up_").join("resources").join(name),
                    parent.join("_up_").join("dist").join(name),
                ] {
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    None
}

fn find_project_root() -> Option<PathBuf> {
    if let Ok(root) = std::env::var("SANDBOX_TIER34_ROOT") {
        let p = PathBuf::from(&root);
        if tier34_entry_exists(&p)
            || p.join("tier34-server.mjs").is_file()
            || p.join("tier34-server.cjs").is_file()
        {
            return Some(p);
        }
    }

    if let Some(entry) = bundled_tier34_entry() {
        return entry.parent().map(|p| p.to_path_buf());
    }

    if let Ok(mut dir) = std::env::current_dir() {
        for _ in 0..10 {
            if tier34_entry_exists(&dir) {
                return Some(dir);
            }
            if !dir.pop() {
                break;
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent()?.to_path_buf();
        for _ in 0..10 {
            if tier34_entry_exists(&dir) {
                return Some(dir);
            }
            if !dir.pop() {
                break;
            }
        }
    }

    None
}

fn spawn_tier34_bundled(entry_path: &Path) -> Result<Child, String> {
    let work_dir = entry_path
        .parent()
        .ok_or_else(|| "Invalid bundled tier34 entry path".to_string())?;

    let node = resolve_node_executable();
    let bundled = bundled_node_executable().is_some();

    let mut cmd = Command::new(&node);
    cmd.arg(entry_path)
        .current_dir(work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("TIER34_PORT", "3001")
        .env("TIER34_CORS_ORIGIN", "http://localhost:3002");

    cmd.spawn().map_err(|e| {
        if bundled {
            format!(
                "Failed to spawn bundled Sandbox Server with included Node.js: {e}. \
                 Reinstall Sandbox Music or run tier34 manually on port 3001."
            )
        } else {
            format!(
                "Failed to spawn bundled Sandbox Server (Node.js required): {e}. \
                 Reinstall to include Node.js, install Node.js LTS on PATH, or run tier34 manually on port 3001."
            )
        }
    })
}

fn spawn_tier34(root: &Path) -> Result<Child, String> {
    if let Some(entry) = bundled_tier34_entry() {
        return spawn_tier34_bundled(&entry);
    }

    if !tier34_entry_exists(root) {
        return Err(
            "tier34-server not found — install Node.js LTS, enable Anchor mode in Settings → Vault, \
             or set SANDBOX_TIER34_ROOT to a folder containing tier34-server/."
                .to_string(),
        );
    }

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "npx", "tsx", "tier34-server/index.ts"]);
        c
    };

    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("npx");
        c.args(["tsx", "tier34-server/index.ts"]);
        c
    };

    cmd.current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("TIER34_PORT", "3001")
        .env("TIER34_CORS_ORIGIN", "http://localhost:3002");

    cmd.spawn().map_err(|e| {
        format!(
            "Failed to spawn tier34-server (Node.js + npm required): {e}. \
             On Linux use the same npx tsx path; set SANDBOX_TIER34_ROOT if needed."
        )
    })
}

fn clear_exited_child(state: &LocalServerState) {
    let mut guard = state.child.lock();
    if let Some(ref mut child) = *guard {
        if child.try_wait().ok().flatten().is_some() {
            *guard = None;
        }
    }
}

pub fn start_local_server(state: &LocalServerState) -> Result<(), String> {
    clear_exited_child(state);

    {
        let mut guard = state.child.lock();
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(None) => return Err("Sandbox Server is already running".to_string()),
                Ok(Some(_)) => *guard = None,
                Err(e) => return Err(format!("Server process check failed: {e}")),
            }
        }
    }

    let root = find_project_root().ok_or_else(|| {
        "Could not locate Sandbox Server. Packaged installs bundle tier34-server.mjs — \
         install Node.js LTS and enable Anchor mode in Settings → Vault. \
         Developers: set SANDBOX_TIER34_ROOT to the project root."
            .to_string()
    })?;

    let child = spawn_tier34(&root)?;
    *state.child.lock() = Some(child);
    Ok(())
}

pub fn stop_local_server(state: &LocalServerState) -> Result<(), String> {
    let mut guard = state.child.lock();
    if let Some(mut child) = guard.take() {
        child
            .kill()
            .map_err(|e| format!("Failed to stop Sandbox Server: {e}"))?;
        let _ = child.wait();
    }
    Ok(())
}

pub fn local_server_managed_running(state: &LocalServerState) -> bool {
    clear_exited_child(state);
    let mut guard = state.child.lock();
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => {
                *guard = None;
                false
            }
            Err(_) => false,
        }
    } else {
        false
    }
}
