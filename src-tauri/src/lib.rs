use std::sync::Mutex;

use tauri::Manager;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandEvent;

/// Managed state holding the sidecar child process handle and port.
struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    port: u16,
}

/// Find a free TCP port by binding to port 0.
fn find_free_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("Failed to bind to find a free port");
    listener.local_addr().unwrap().port()
}

/// Check if the `opencode` CLI is available on PATH.
fn check_opencode_available() -> bool {
    std::process::Command::new("opencode")
        .arg("version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok()
}

/// Open the fleet UI in the user's default browser.
fn open_browser(port: u16) {
    let url = format!("http://127.0.0.1:{}", port);
    if let Err(e) = open::that(&url) {
        eprintln!("[weave-fleet] Failed to open browser: {}", e);
    }
}

pub fn run() {
    tauri::Builder::default()
        // --- Plugins (must be registered before setup) ---
        .plugin(
            tauri_plugin_single_instance::init(|app, _args, _cwd| {
                // Second instance: open browser instead of spawning a duplicate tray
                if let Some(state) = app.try_state::<SidecarState>() {
                    open_browser(state.port);
                }
            }),
        )
        .plugin(tauri_plugin_shell::init())
        // --- Setup ---
        .setup(|app| {
            // (a) Check for opencode CLI
            if !check_opencode_available() {
                eprintln!(
                    "[weave-fleet] WARNING: 'opencode' CLI not found on PATH. \
                     Agent sessions will not be able to spawn."
                );
            }

            // (b) Find free port
            let port = find_free_port();
            println!("[weave-fleet] Using port {}", port);

            // (c) Spawn sidecar (production only)
            #[cfg(not(debug_assertions))]
            {
                let resource_dir = app.path().resource_dir()
                    .expect("Failed to get resource directory");
                let server_js = resource_dir.join("app").join("server.js");

                // Validate server.js path
                if !server_js.exists() || !server_js.is_file() {
                    panic!("server.js not found at {:?}", server_js);
                }
                if !server_js.starts_with(&resource_dir) {
                    panic!("server.js path escapes resource directory: {:?}", server_js);
                }

                let sidecar = app
                    .shell()
                    .sidecar("node")
                    .expect("Failed to create sidecar command")
                    .args([server_js.to_str().unwrap()])
                    .env("PORT", port.to_string())
                    .env("HOSTNAME", "127.0.0.1")
                    .env("NODE_ENV", "production");

                let (mut rx, child) = sidecar.spawn().expect("Failed to spawn sidecar");

                // Store child handle for cleanup
                app.manage(SidecarState {
                    child: Mutex::new(Some(child)),
                    port,
                });

                // Drain stdout/stderr in background
                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                let line = String::from_utf8_lossy(&line);
                                println!("[sidecar] {}", line);
                            }
                            CommandEvent::Stderr(line) => {
                                let line = String::from_utf8_lossy(&line);
                                eprintln!("[sidecar] {}", line);
                            }
                            CommandEvent::Terminated(status) => {
                                eprintln!("[sidecar] terminated: {:?}", status);
                                break;
                            }
                            _ => {}
                        }
                    }
                });
            }

            // In dev mode, manage a dummy SidecarState so shutdown doesn't panic
            #[cfg(debug_assertions)]
            {
                app.manage(SidecarState {
                    child: Mutex::new(None),
                    port,
                });
            }

            // (d) Health check + auto-open browser (production only)
            #[cfg(not(debug_assertions))]
            {
                tauri::async_runtime::spawn(async move {
                    let health_url = format!("http://127.0.0.1:{}/api/version", port);
                    let client = reqwest::Client::new();
                    let start = std::time::Instant::now();

                    loop {
                        if start.elapsed() > std::time::Duration::from_secs(30) {
                            eprintln!(
                                "[weave-fleet] Sidecar failed to start within 30 seconds"
                            );
                            return;
                        }
                        match client.get(&health_url).send().await {
                            Ok(resp) if resp.status().is_success() => break,
                            _ => {
                                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                            }
                        }
                    }

                    println!("[weave-fleet] Sidecar ready on port {}", port);
                    open_browser(port);
                });
            }

            // (e) System tray
            let open_item =
                MenuItem::with_id(app, "open", "Open Weave Fleet", true, None::<&str>)?;
            let quit =
                MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;

            let menu = Menu::with_items(app, &[&open_item, &sep, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Weave Fleet")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(state) = app.try_state::<SidecarState>() {
                            open_browser(state.port);
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(state) = app.try_state::<SidecarState>() {
                            open_browser(state.port);
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // --- Kill sidecar on exit ---
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<SidecarState>() {
                    if let Ok(mut child) = state.child.lock() {
                        if let Some(child) = child.take() {
                            println!("[weave-fleet] Killing sidecar on exit");
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}
