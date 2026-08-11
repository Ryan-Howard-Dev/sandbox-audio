/*!
Rust holds the files, the player streams them over loopback.

The desktop could see library files and could not play them. A WebView will not load
`file:///C:/Music/x.flac` into an audio element, and Tauri's asset protocol would mean handing the
whole filesystem to the page. So the bytes are served instead, from a server bound to 127.0.0.1
that only ever opens paths already confined to a library root.

This is the same shape the Android side already uses through the Sandbox Server, and the reason it
is worth doing rather than pushing decoded audio across the boundary: the player gets a plain HTTP
source it already knows how to buffer, seek and hardware-decode, and Rust keeps the decisions about
which files exist and which may be opened.

Two rules make it safe to run on a shared machine:

  - Loopback only. Not reachable from the network, whatever else is on it.
  - A random token per launch, required on every request. Anything else on the machine can reach
    127.0.0.1, and without a secret it could walk the library by guessing paths.

Range requests are the point of the whole thing. Without them a seek re-downloads from zero and a
two hour audiobook is unusable.
*/

use parking_lot::Mutex;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Arc;

use super::roots::confine_existing;

pub struct MediaServerState {
    inner: Mutex<Option<Running>>,
}

struct Running {
    port: u16,
    token: String,
}

impl MediaServerState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

impl Default for MediaServerState {
    fn default() -> Self {
        Self::new()
    }
}

fn random_token() -> String {
    // Not cryptographic key material — a per-launch value that another local process cannot guess
    // before the app is closed and it changes again.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    let mixed = nanos
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(pid.wrapping_mul(0xBF58_476D_1CE4_E5B9));
    format!("{mixed:032x}")
}

/// The content type for an extension, so a player knows what it is being handed.
fn content_type_for(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "m4a" | "m4b" | "mp4" => "audio/mp4",
        "aac" => "audio/aac",
        "webm" => "audio/webm",
        "aiff" | "aif" => "audio/aiff",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        _ => "application/octet-stream",
    }
}

/// Parse `bytes=start-end`, returning the inclusive range clamped to the file.
///
/// Returns None for anything not understood, which is answered with the whole file rather than an
/// error: a malformed Range from some player is not a reason to refuse to play.
pub fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    // Multiple ranges are legal and no audio player asks for them; the first is enough.
    let first = spec.split(',').next()?.trim();
    let (start_text, end_text) = first.split_once('-')?;

    if start_text.is_empty() {
        // `bytes=-500` means the last 500 bytes.
        let tail: u64 = end_text.parse().ok()?;
        if tail == 0 || len == 0 {
            return None;
        }
        let start = len.saturating_sub(tail);
        return Some((start, len - 1));
    }

    let start: u64 = start_text.parse().ok()?;
    if start >= len {
        return None;
    }
    let end = if end_text.is_empty() {
        len - 1
    } else {
        end_text.parse::<u64>().ok()?.min(len - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

/// Pull `t` and `p` out of a request path. Percent-decoding is done by hand; the only escapes that
/// matter are the ones a Windows path produces.
pub fn parse_query(url: &str) -> (Option<String>, Option<String>) {
    let Some((_, query)) = url.split_once('?') else {
        return (None, None);
    };
    let mut token = None;
    let mut path = None;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        match key {
            "t" => token = Some(percent_decode(value)),
            "p" => path = Some(percent_decode(value)),
            _ => {}
        }
    }
    (token, path)
}

pub fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        // '+' is a form encoding, not a path encoding, and a real file can be named "a+b".
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Start the server if it is not already running, and return its port and token.
pub fn ensure_running(
    state: &MediaServerState,
    roots: Arc<dyn Fn() -> Vec<PathBuf> + Send + Sync>,
) -> Result<(u16, String), String> {
    let mut guard = state.inner.lock();
    if let Some(running) = guard.as_ref() {
        return Ok((running.port, running.token.clone()));
    }

    // Port 0 asks the OS for a free one. A fixed port collides with whatever else the machine runs.
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("no address")?
        .port();
    let token = random_token();
    let expected = token.clone();

    std::thread::Builder::new()
        .name("sandbox-media-server".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                let allowed = roots();
                serve(request, &expected, &allowed);
            }
        })
        .map_err(|e| e.to_string())?;

    *guard = Some(Running {
        port,
        token: token.clone(),
    });
    Ok((port, token))
}

fn respond_status(request: tiny_http::Request, code: u16) {
    let _ = request.respond(tiny_http::Response::empty(code));
}

fn serve(request: tiny_http::Request, expected_token: &str, roots: &[PathBuf]) {
    let (token, path) = parse_query(request.url());

    /*
     * Token first, before the path is even looked at. A wrong token must not be able to learn
     * whether a file exists from the difference between "forbidden" and "not found".
     */
    if token.as_deref() != Some(expected_token) {
        respond_status(request, 403);
        return;
    }
    let Some(path) = path else {
        respond_status(request, 400);
        return;
    };

    // The same confinement every other operation uses. The path arrived over HTTP, so it is
    // attacker-supplied by definition, and this is the only thing standing between a guessed
    // request and any file on the machine.
    let Ok(resolved) = confine_existing(&PathBuf::from(&path), roots) else {
        respond_status(request, 403);
        return;
    };

    let Ok(mut file) = std::fs::File::open(&resolved) else {
        respond_status(request, 404);
        return;
    };
    let Ok(meta) = file.metadata() else {
        respond_status(request, 500);
        return;
    };
    if meta.is_dir() {
        respond_status(request, 403);
        return;
    }
    let len = meta.len();

    let range_header = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str().to_string());

    let content_type = tiny_http::Header::from_bytes(
        &b"Content-Type"[..],
        content_type_for(&resolved).as_bytes(),
    )
    .expect("static header");
    let accept_ranges =
        tiny_http::Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).expect("static header");

    match range_header.as_deref().and_then(|h| parse_range(h, len)) {
        Some((start, end)) => {
            let span = end - start + 1;
            if file.seek(SeekFrom::Start(start)).is_err() {
                respond_status(request, 500);
                return;
            }
            let content_range = tiny_http::Header::from_bytes(
                &b"Content-Range"[..],
                format!("bytes {start}-{end}/{len}").as_bytes(),
            )
            .expect("valid header");
            let body = file.take(span);
            let response = tiny_http::Response::new(
                tiny_http::StatusCode(206),
                vec![content_type, accept_ranges, content_range],
                body,
                Some(span as usize),
                None,
            );
            let _ = request.respond(response);
        }
        None => {
            let response = tiny_http::Response::new(
                tiny_http::StatusCode(200),
                vec![content_type, accept_ranges],
                file,
                Some(len as usize),
                None,
            );
            let _ = request.respond(response);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_an_open_ended_range() {
        assert_eq!(parse_range("bytes=100-", 1000), Some((100, 999)));
    }

    #[test]
    fn parses_a_closed_range() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
    }

    #[test]
    fn clamps_an_end_past_the_file() {
        assert_eq!(parse_range("bytes=900-99999", 1000), Some((900, 999)));
    }

    #[test]
    fn understands_a_suffix_range() {
        // "the last 500 bytes" — what a player asks for to read a trailing tag.
        assert_eq!(parse_range("bytes=-500", 1000), Some((500, 999)));
    }

    #[test]
    fn takes_only_the_first_of_several_ranges() {
        assert_eq!(parse_range("bytes=0-99,200-299", 1000), Some((0, 99)));
    }

    #[test]
    fn refuses_a_start_past_the_end_of_the_file() {
        assert_eq!(parse_range("bytes=5000-", 1000), None);
    }

    #[test]
    fn refuses_a_backwards_range() {
        assert_eq!(parse_range("bytes=500-100", 1000), None);
    }

    #[test]
    fn ignores_a_range_it_cannot_understand_rather_than_failing() {
        // Answered with the whole file. A malformed header from some player is not a reason to
        // refuse to play it.
        assert_eq!(parse_range("seconds=1-2", 1000), None);
        assert_eq!(parse_range("bytes=abc-def", 1000), None);
    }

    #[test]
    fn pulls_the_token_and_path_out_of_a_query() {
        let (token, path) = parse_query("/media?t=abc123&p=C%3A%2FMusic%2Fa.flac");
        assert_eq!(token.as_deref(), Some("abc123"));
        assert_eq!(path.as_deref(), Some("C:/Music/a.flac"));
    }

    #[test]
    fn survives_a_query_with_no_parameters() {
        assert_eq!(parse_query("/media"), (None, None));
    }

    #[test]
    fn round_trips_a_path_with_spaces_and_symbols() {
        let path = "C:/My Music/Sigur Rós/01 — Svefn-g-englar.flac";
        assert_eq!(percent_decode(&percent_encode(path)), path);
    }

    #[test]
    fn leaves_a_plus_alone_because_a_file_can_be_named_with_one() {
        assert_eq!(percent_decode("a+b.flac"), "a+b.flac");
    }

    /*
     * Against a real socket, because everything that matters here is the wire behaviour: the status
     * code, the Content-Range header and the exact bytes. A unit test of parse_range proves the
     * arithmetic and proves nothing about whether a player can seek.
     */
    mod over_the_wire {
        use super::super::*;
        use std::io::{Read as _, Write as _};
        use std::net::TcpStream;

        struct Temp(std::path::PathBuf);
        impl Drop for Temp {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        fn request(port: u16, path_and_query: &str, range: Option<&str>) -> (String, Vec<u8>) {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
            let crlf = "\r\n";
            let mut req =
                format!("GET {path_and_query} HTTP/1.1{crlf}Host: 127.0.0.1{crlf}Connection: close{crlf}");
            if let Some(value) = range {
                req.push_str(&format!("Range: {value}{crlf}"));
            }
            req.push_str(crlf);
            stream.write_all(req.as_bytes()).expect("write");
            /*
             * A read timeout rather than reading to EOF. tiny_http may hold a keep-alive socket
             * open regardless of the Connection header, and a test that waits forever for a close
             * that never comes looks exactly like a server that hung.
             */
            stream
                .set_read_timeout(Some(std::time::Duration::from_millis(1500)))
                .expect("timeout");
            let mut raw = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => raw.extend_from_slice(&chunk[..n]),
                    Err(_) => break,
                }
            }
            let split = raw
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
                .expect("headers end");
            let head = String::from_utf8_lossy(&raw[..split]).to_string();
            (head, raw[split + 4..].to_vec())
        }

        #[test]
        fn serves_ranges_and_refuses_everything_outside_the_library() {
            let base = std::env::temp_dir().join(format!(
                "sandbox-media-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let root = base.join("library");
            let outside = base.join("elsewhere");
            std::fs::create_dir_all(&root).unwrap();
            std::fs::create_dir_all(&outside).unwrap();
            let _cleanup = Temp(base.clone());

            let track = root.join("track.flac");
            std::fs::write(&track, b"0123456789").unwrap();
            let secret = outside.join("secret.txt");
            std::fs::write(&secret, b"private").unwrap();

            let root_for_closure = root.clone();
            let state = MediaServerState::new();
            let (port, token) = ensure_running(
                &state,
                std::sync::Arc::new(move || vec![root_for_closure.clone()]),
            )
            .expect("server starts");

            let track_path = std::fs::canonicalize(&track).unwrap();
            let url = format!(
                "/media?t={}&p={}",
                percent_encode(&token),
                percent_encode(&track_path.to_string_lossy())
            );

            let (head, body) = request(port, &url, None);
            assert!(head.starts_with("HTTP/1.1 200"), "{head}");
            assert!(head.contains("Accept-Ranges: bytes"), "{head}");
            assert_eq!(body, b"0123456789");

            // The header a player needs to seek, and the exact slice it asked for.
            let (head, body) = request(port, &url, Some("bytes=3-5"));
            assert!(head.starts_with("HTTP/1.1 206"), "{head}");
            assert!(head.contains("Content-Range: bytes 3-5/10"), "{head}");
            assert_eq!(body, b"345");

            let (head, body) = request(port, &url, Some("bytes=7-"));
            assert!(head.starts_with("HTTP/1.1 206"), "{head}");
            assert_eq!(body, b"789");

            // A wrong token learns nothing, not even whether the file exists.
            let bad_token = format!(
                "/media?t=wrong&p={}",
                percent_encode(&track_path.to_string_lossy())
            );
            let (head, _) = request(port, &bad_token, None);
            assert!(head.starts_with("HTTP/1.1 403"), "{head}");

            // The path arrives over HTTP, so confinement is the only thing standing between a
            // guessed request and any file on the machine.
            let secret_path = std::fs::canonicalize(&secret).unwrap();
            let escape = format!(
                "/media?t={}&p={}",
                percent_encode(&token),
                percent_encode(&secret_path.to_string_lossy())
            );
            let (head, body) = request(port, &escape, None);
            assert!(head.starts_with("HTTP/1.1 403"), "{head}");
            assert!(body.is_empty());
        }
    }

    #[test]
    fn names_the_content_type_from_the_extension() {
        assert_eq!(content_type_for(std::path::Path::new("a.flac")), "audio/flac");
        assert_eq!(content_type_for(std::path::Path::new("a.M4B")), "audio/mp4");
        assert_eq!(
            content_type_for(std::path::Path::new("a.xyz")),
            "application/octet-stream"
        );
    }
}
