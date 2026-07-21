use parking_lot::Mutex;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

const PORT_START: u16 = 13789;
const PORT_TRIES: u16 = 20;

pub struct CastBrowserServerState {
    url: Mutex<Option<String>>,
    stop: Arc<AtomicBool>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl CastBrowserServerState {
    pub fn new() -> Self {
        Self {
            url: Mutex::new(None),
            stop: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
        }
    }
}

fn resolve_dist_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = app.path().resolve("index.html", BaseDirectory::Resource) {
        if path.exists() {
            return path
                .parent()
                .map(|p| p.to_path_buf())
                .ok_or_else(|| "resource index.html has no parent".to_string());
        }
    }
    if let Ok(path) = app.path().resolve("dist/index.html", BaseDirectory::Resource) {
        if path.exists() {
            return path
                .parent()
                .map(|p| p.to_path_buf())
                .ok_or_else(|| "dist resource path has no parent".to_string());
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..10 {
            let Some(current) = dir else { break };
            let candidates = [
                current.join("dist"),
                current.join("../dist"),
                current.join("../../dist"),
                current.join("../../../dist"),
            ];
            for candidate in candidates {
                let normalized = normalize_path(&candidate);
                if normalized.join("index.html").exists() {
                    return Ok(normalized);
                }
            }
            dir = current.parent().map(|p| p.to_path_buf());
        }
    }

    Err(
        "Sandbox Music UI bundle not found on disk. Reinstall the desktop app or run npm run dev for development."
            .to_string(),
    )
}

fn normalize_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "map" => "application/json",
        _ => "application/octet-stream",
    }
}

fn safe_file_path(root: &Path, request_path: &str) -> Option<PathBuf> {
    let trimmed = request_path.trim_start_matches('/');
    let rel = if trimmed.is_empty() {
        PathBuf::from("index.html")
    } else {
        PathBuf::from(trimmed)
    };
    let joined = root.join(rel);
    let normalized = normalize_path(&joined);
    let root_norm = normalize_path(root);
    if normalized.starts_with(&root_norm) && normalized.is_file() {
        return Some(normalized);
    }
    None
}

fn write_response(stream: &mut TcpStream, status: &str, body: &[u8], mime: &str) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

fn handle_connection(mut stream: TcpStream, root: PathBuf) {
    let mut buffer = [0_u8; 4096];
    let read = match stream.read(&mut buffer) {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let request = String::from_utf8_lossy(&buffer[..read]);
    let request_line = request.lines().next().unwrap_or("");
    let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/");

    if let Some(file_path) = safe_file_path(&root, path) {
        match fs::read(&file_path) {
            Ok(body) => {
                write_response(&mut stream, "200 OK", &body, content_type(&file_path));
                return;
            }
            Err(_) => {
                write_response(
                    &mut stream,
                    "500 Internal Server Error",
                    b"read failed",
                    "text/plain",
                );
                return;
            }
        }
    }

    if path != "/" && !path.ends_with(".html") {
        if let Some(index) = safe_file_path(&root, "/index.html") {
            if let Ok(body) = fs::read(index) {
                write_response(&mut stream, "200 OK", &body, "text/html; charset=utf-8");
                return;
            }
        }
    }

    write_response(&mut stream, "404 Not Found", b"not found", "text/plain");
}

fn spawn_server(root: PathBuf, stop: Arc<AtomicBool>) -> Result<(JoinHandle<()>, u16), String> {
    for offset in 0..PORT_TRIES {
        let port = PORT_START.saturating_add(offset);
        let addr = format!("127.0.0.1:{port}");
        let listener = match TcpListener::bind(&addr) {
            Ok(l) => l,
            Err(_) => continue,
        };

        let root_clone = root.clone();
        let stop_clone = stop.clone();
        let handle = thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                if stop_clone.load(Ordering::Relaxed) {
                    break;
                }
                let root_for_conn = root_clone.clone();
                thread::spawn(move || handle_connection(stream, root_for_conn));
            }
        });

        return Ok((handle, port));
    }

    Err(format!(
        "Could not bind cast browser server on ports {PORT_START}–{}",
        PORT_START + PORT_TRIES - 1
    ))
}

pub fn ensure_cast_browser_server(
    app: &AppHandle,
    state: &CastBrowserServerState,
) -> Result<String, String> {
    if let Some(url) = state.url.lock().clone() {
        return Ok(url);
    }

    let root = resolve_dist_root(app)?;
    state.stop.store(false, Ordering::Relaxed);

    let (handle, port) = spawn_server(root, state.stop.clone())?;
    let url = format!("http://127.0.0.1:{port}/");
    *state.handle.lock() = Some(handle);
    *state.url.lock() = Some(url.clone());
    Ok(url)
}

#[cfg(windows)]
fn try_launch(paths: &[&str], url: &str) -> bool {
    use std::process::Command;
    for path in paths {
        if !Path::new(path).exists() {
            continue;
        }
        if Command::new(path).arg(url).spawn().is_ok() {
            return true;
        }
    }
    false
}

pub fn open_url_in_browser(url: &str, browser: Option<&str>) -> Result<(), String> {
    let browser = browser.unwrap_or("default");

    #[cfg(windows)]
    {
        use std::process::Command;
        match browser {
            "chrome" => {
                if try_launch(
                    &[
                        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                    ],
                    url,
                ) {
                    return Ok(());
                }
            }
            "edge" => {
                if try_launch(
                    &[
                        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                    ],
                    url,
                ) {
                    return Ok(());
                }
            }
            "firefox" => {
                if try_launch(
                    &[
                        r"C:\Program Files\Mozilla Firefox\firefox.exe",
                        r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
                    ],
                    url,
                ) {
                    return Ok(());
                }
            }
            _ => {}
        }
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let program = match browser {
            "chrome" => {
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".to_string()
            }
            "edge" => "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge".to_string(),
            "firefox" => "/Applications/Firefox.app/Contents/MacOS/firefox".to_string(),
            _ => "open".to_string(),
        };
        if program == "open" {
            Command::new("open")
                .arg(url)
                .spawn()
                .map_err(|e| format!("Failed to open browser: {e}"))?;
        } else if Path::new(&program).exists() {
            Command::new(program)
                .arg(url)
                .spawn()
                .map_err(|e| format!("Failed to open browser: {e}"))?;
        } else {
            Command::new("open")
                .arg(url)
                .spawn()
                .map_err(|e| format!("Failed to open browser: {e}"))?;
        }
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        use std::process::Command;
        let program = match browser {
            "chrome" => "google-chrome",
            "edge" => "microsoft-edge",
            "firefox" => "firefox",
            _ => "xdg-open",
        };
        if program == "xdg-open" {
            Command::new("xdg-open")
                .arg(url)
                .spawn()
                .map_err(|e| format!("Failed to open browser: {e}"))?;
        } else {
            Command::new(program)
                .arg(url)
                .spawn()
                .or_else(|_| Command::new("xdg-open").arg(url).spawn())
                .map_err(|e| format!("Failed to open browser: {e}"))?;
        }
        return Ok(());
    }
}
