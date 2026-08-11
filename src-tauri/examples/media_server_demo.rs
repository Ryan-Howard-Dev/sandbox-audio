/*!
Run the media server on a folder and print the url, so a real browser can try to play it.

The socket test proves the status codes, the headers and the bytes. It cannot prove the thing that
actually matters — that a media element accepts the response and plays it — because that is a
decision Chromium makes about content type, ranges and framing, not something a raw socket can
answer.

    cargo run --example media_server_demo -- <folder> <file>
*/

use std::path::PathBuf;
use std::sync::Arc;

fn main() {
    let mut args = std::env::args().skip(1);
    let root = PathBuf::from(args.next().expect("usage: <folder> <file>"));
    let file = PathBuf::from(args.next().expect("usage: <folder> <file>"));

    let root = std::fs::canonicalize(&root).expect("folder exists");
    let file = std::fs::canonicalize(&file).expect("file exists");

    let roots = root.clone();
    let state = sovereign_music_console_lib::library_fs::media_server::MediaServerState::new();
    let (port, token) = sovereign_music_console_lib::library_fs::media_server::ensure_running(
        &state,
        Arc::new(move || vec![roots.clone()]),
    )
    .expect("server starts");

    println!(
        "http://127.0.0.1:{port}/media?t={}&p={}",
        sovereign_music_console_lib::library_fs::media_server::percent_encode(&token),
        sovereign_music_console_lib::library_fs::media_server::percent_encode(
            &file.to_string_lossy()
        )
    );

    // Held open so the url stays good while somebody points a player at it.
    std::thread::park();
}
