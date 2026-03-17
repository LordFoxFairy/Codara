// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Manager;

const SERVER_PORT: u16 = 23981;
const SERVER_POLL_INTERVAL: Duration = Duration::from_millis(200);
const SERVER_POLL_TIMEOUT: Duration = Duration::from_secs(30);

struct ServerProcess(Mutex<Option<Child>>);

/// Tauri command: returns the Bun server port so the frontend can connect.
#[tauri::command]
fn get_server_port() -> u16 {
    SERVER_PORT
}

/// Spawn `bun src/server/index.ts` and return the child handle.
/// The server script path is relative to the project root, so we resolve
/// it from the executable's location (src-tauri/target/debug/) upward.
fn spawn_server() -> Child {
    // In dev: executable is at src-tauri/target/debug/codara-desktop
    // In prod: executable is inside the app bundle
    // Either way, find the project root by looking for src/server/index.ts
    let project_root = find_project_root()
        .expect("could not find project root (looked for src/server/index.ts)");

    Command::new("bun")
        .args(["src/server/index.ts"])
        .current_dir(&project_root)
        .spawn()
        .expect("failed to start bun server — is bun installed and on PATH?")
}

/// Walk up from the current executable to find the project root.
fn find_project_root() -> Option<std::path::PathBuf> {
    // Try CARGO_MANIFEST_DIR first (set by cargo during dev builds)
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let root = std::path::Path::new(&manifest).parent()?;
        if root.join("src/server/index.ts").exists() {
            return Some(root.to_path_buf());
        }
    }

    // Fallback: walk up from current exe
    let exe = std::env::current_exe().ok()?;
    let mut dir = exe.parent()?;
    for _ in 0..10 {
        if dir.join("src/server/index.ts").exists() {
            return Some(dir.to_path_buf());
        }
        dir = dir.parent()?;
    }
    None
}

/// Block until `GET /api/status` returns 200, or panic on timeout.
fn wait_for_server_ready() {
    let url = format!("http://localhost:{}/api/status", SERVER_PORT);
    let deadline = std::time::Instant::now() + SERVER_POLL_TIMEOUT;

    while std::time::Instant::now() < deadline {
        // Use a short-lived TCP probe first (avoids pulling in reqwest).
        if let Ok(mut stream) =
            std::net::TcpStream::connect(format!("127.0.0.1:{}", SERVER_PORT))
        {
            use std::io::Write;
            let request = format!(
                "GET /api/status HTTP/1.1\r\nHost: localhost:{}\r\nConnection: close\r\n\r\n",
                SERVER_PORT
            );
            if stream.write_all(request.as_bytes()).is_ok() {
                use std::io::Read;
                let mut buf = [0u8; 512];
                if let Ok(n) = stream.read(&mut buf) {
                    let response = String::from_utf8_lossy(&buf[..n]);
                    if response.contains("200") {
                        return;
                    }
                }
            }
        }
        thread::sleep(SERVER_POLL_INTERVAL);
    }

    panic!(
        "Bun server did not become ready within {} seconds ({})",
        SERVER_POLL_TIMEOUT.as_secs(),
        url
    );
}

fn main() {
    // Spawn the Bun backend before Tauri initialises its window.
    let child = spawn_server();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerProcess(Mutex::new(Some(child))))
        .invoke_handler(tauri::generate_handler![get_server_port])
        .setup(|_app| {
            // Wait for the server to be reachable so the webview doesn't
            // render a connection-refused page.
            wait_for_server_ready();
            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill the sidecar when the last window closes.
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<ServerProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Codara desktop");
}
