/*!
The drop folder: what has arrived, and telling the app when something new lands.

Two halves. Listing what is sitting in the folder with its tags already read, so the decision can be
made against what the file actually says rather than what its name suggests; and a watcher that
says "something changed" so nobody has to press a button.

The watcher deliberately reports nothing about *what* changed. Filesystem events are unreliable in
the details -- a copy in progress fires several times, an editor writes through a temp file, a
network share coalesces events -- so treating an event as a fact about one file is how an importer
ends up reading a half-written download. It is a nudge to look again, and looking again is a scan.

Settling matters for the same reason. A file being copied in is visible long before it is complete,
and reading its tags mid-copy gets either an error or, worse, a partial tag. Nothing is offered
until its size has stopped changing.
*/

use notify::{RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};

use super::tags::read_tags;

/// How long a file's size must hold steady before it is considered finished arriving.
pub const SETTLE_SECONDS: u64 = 3;

/// The event the app listens for. Carries no detail, on purpose — see the module note.
pub const INGEST_EVENT: &str = "sandbox://ingest-changed";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestCandidate {
    pub path: PathBuf,
    pub name: String,
    pub extension: String,
    pub size: u64,
    /// False while the file is still growing, so a screen can show it as arriving rather than
    /// offering to file something half copied.
    pub settled: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub release_year: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
}

fn modified_age_seconds(path: &Path) -> Option<u64> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    SystemTime::now().duration_since(modified).ok().map(|d| d.as_secs())
}

/// Everything sitting in the drop folder, with whatever each file says about itself.
///
/// Not confined to the library roots: a drop folder is deliberately somewhere else, usually a
/// downloads directory, and confining it to the library would defeat the point. Nothing here writes
/// anything — the move that follows goes through the ordinary plan and apply path, which is
/// confined.
pub fn scan_drop_folder(dir: &Path, limit: usize) -> Result<Vec<IngestCandidate>, String> {
    if !dir.is_dir() {
        return Err("That is not a folder".into());
    }

    let mut out = Vec::new();
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        if out.len() >= limit {
            break;
        }
        let path = entry.path();
        if path.is_dir() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };

        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        // Partial downloads announce themselves; there is no point reading a tag from one.
        if name.starts_with('.') || name.ends_with(".part") || name.ends_with(".crdownload") {
            continue;
        }

        let settled = modified_age_seconds(&path).map(|age| age >= SETTLE_SECONDS).unwrap_or(false);

        // Only read a tag once the file has stopped moving. Mid-copy gives an error at best and a
        // partial tag at worst, and a partial tag is the one that gets believed.
        let tags = if settled { read_tags(&path).ok() } else { None };

        out.push(IngestCandidate {
            name,
            extension: path
                .extension()
                .map(|e| e.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default(),
            size: meta.len(),
            settled,
            title: tags.as_ref().and_then(|t| t.title.clone()),
            artist: tags.as_ref().and_then(|t| t.artist.clone()),
            album_artist: tags.as_ref().and_then(|t| t.album_artist.clone()),
            album: tags.as_ref().and_then(|t| t.album.clone()),
            release_year: tags.as_ref().and_then(|t| t.year.clone()),
            track_number: tags.as_ref().and_then(|t| t.track_number),
            disc_number: tags.as_ref().and_then(|t| t.disc_number),
            path: super::roots::tidy_display(&path),
        });
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

pub struct IngestWatchState {
    inner: Mutex<Option<WatchHandle>>,
}

struct WatchHandle {
    dir: PathBuf,
    /// Dropping this stops the watcher thread's channel and ends it.
    _stop: mpsc::Sender<()>,
}

impl IngestWatchState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub fn watching(&self) -> Option<PathBuf> {
        self.inner.lock().as_ref().map(|h| h.dir.clone())
    }
}

impl Default for IngestWatchState {
    fn default() -> Self {
        Self::new()
    }
}

/**
 * Watch a folder, emitting a nudge when anything in it changes.
 *
 * Coalesced: a copy fires many events and an editor writing through a temp file fires several more,
 * so events inside a short window become one. Without that, dropping an album in emits an event per
 * file per write and the app rescans a dozen times while the copy is still running.
 */
pub fn start_watching(
    state: &IngestWatchState,
    app: AppHandle,
    dir: PathBuf,
) -> Result<(), String> {
    if !dir.is_dir() {
        return Err("That is not a folder".into());
    }

    stop_watching(state);

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (event_tx, event_rx) = mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            // The event's detail is deliberately discarded; see the module note.
            let _ = event_tx.send(());
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    std::thread::Builder::new()
        .name("sandbox-ingest-watch".into())
        .spawn(move || {
            // Moved in so it lives as long as the thread; dropping it unwatches.
            let _watcher = watcher;
            loop {
                if stop_rx.try_recv().is_ok() {
                    return;
                }
                match event_rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(()) => {
                        // Drain whatever else arrived in the same burst, then emit once.
                        while event_rx.recv_timeout(Duration::from_millis(400)).is_ok() {}
                        let _ = app.emit(INGEST_EVENT, ());
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
        })
        .map_err(|e| e.to_string())?;

    *state.inner.lock() = Some(WatchHandle {
        dir,
        _stop: stop_tx,
    });
    Ok(())
}

pub fn stop_watching(state: &IngestWatchState) {
    // Dropping the handle drops the stop sender, which disconnects the thread's channel.
    *state.inner.lock() = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Temp(PathBuf);
    impl Temp {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "sandbox-ingest-{tag}-{}",
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

    #[test]
    fn lists_what_is_sitting_in_the_folder() {
        let t = Temp::new("list");
        fs::write(t.0.join("b.mp3"), b"x").unwrap();
        fs::write(t.0.join("a.flac"), b"x").unwrap();

        let found = scan_drop_folder(&t.0, 100).expect("scan");
        // Sorted by name, so the same folder always reads the same way.
        assert_eq!(
            found.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["a.flac", "b.mp3"]
        );
    }

    #[test]
    fn ignores_partial_downloads_and_hidden_files() {
        // A .part file is a download in progress announcing itself. There is nothing to read.
        let t = Temp::new("partial");
        fs::write(t.0.join("song.mp3.part"), b"x").unwrap();
        fs::write(t.0.join("other.crdownload"), b"x").unwrap();
        fs::write(t.0.join(".hidden.mp3"), b"x").unwrap();
        fs::write(t.0.join("real.mp3"), b"x").unwrap();

        let found = scan_drop_folder(&t.0, 100).expect("scan");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "real.mp3");
    }

    #[test]
    fn marks_a_file_that_has_just_appeared_as_not_settled() {
        /*
         * A file being copied in is visible long before it is complete. Reading its tags mid-copy
         * gets an error at best and a partial tag at worst, and a partial tag is the one that gets
         * believed.
         */
        let t = Temp::new("settle");
        fs::write(t.0.join("arriving.mp3"), b"x").unwrap();

        let found = scan_drop_folder(&t.0, 100).expect("scan");
        assert!(!found[0].settled);
        assert!(found[0].title.is_none());
    }

    #[test]
    fn skips_folders() {
        let t = Temp::new("dirs");
        fs::create_dir_all(t.0.join("an-album")).unwrap();
        fs::write(t.0.join("track.mp3"), b"x").unwrap();

        let found = scan_drop_folder(&t.0, 100).expect("scan");
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn caps_what_it_returns() {
        let t = Temp::new("cap");
        for i in 0..10 {
            fs::write(t.0.join(format!("f{i}.mp3")), b"x").unwrap();
        }
        assert_eq!(scan_drop_folder(&t.0, 4).expect("scan").len(), 4);
    }

    #[test]
    fn says_so_rather_than_panicking_on_a_path_that_is_not_a_folder() {
        let t = Temp::new("notdir");
        let file = t.0.join("a.mp3");
        fs::write(&file, b"x").unwrap();
        assert!(scan_drop_folder(&file, 10).is_err());
        assert!(scan_drop_folder(&t.0.join("nope"), 10).is_err());
    }

    #[test]
    fn reports_the_extension_lowercased_for_the_classifier() {
        let t = Temp::new("ext");
        fs::write(t.0.join("Track.FLAC"), b"x").unwrap();
        let found = scan_drop_folder(&t.0, 10).expect("scan");
        assert_eq!(found[0].extension, "flac");
    }
}
