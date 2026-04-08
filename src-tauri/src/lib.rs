use std::fs::{create_dir_all, read, remove_file, write};
use std::path::PathBuf;
use std::sync::Mutex;

use reqwest::Url;
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_updater::UpdaterExt;

/// Managed state holding the sidecar child process handle and port.
#[allow(dead_code)]
struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    port: u16,
}

/// Managed state holding tray menu item handles for dynamic updates.
struct TrayState {
    agent_count_item: MenuItem<tauri::Wry>,
}

/// Managed state holding a pending update payload so the frontend can retrieve
/// it even if the Rust event fires before the JS listener is registered.
struct PendingUpdateState {
    payload: Mutex<Option<UpdateAvailablePayload>>,
    staged_payload: Mutex<Option<UpdateAvailablePayload>>,
    download_in_progress: Mutex<bool>,
    download_generation: Mutex<u64>,
}

/// Managed state holding updater preferences mirrored from client settings.
struct UpdatePreferencesState {
    prefs: Mutex<UpdatePreferences>,
}

#[derive(Clone, Deserialize)]
struct UpdatePreferences {
    auto_update: bool,
    channel: String,
}

/// Payload emitted to the frontend when an update is available.
#[derive(Clone, Serialize)]
struct UpdateAvailablePayload {
    version: String,
    current_version: String,
}

/// Payload emitted to the frontend during update download progress.
#[derive(Clone, Serialize)]
struct UpdateProgressPayload {
    /// Accumulated bytes downloaded so far.
    downloaded: u64,
    /// Total bytes (if known).
    total: Option<u64>,
}

#[derive(Clone, Serialize)]
struct UpdateStatePayload {
    channel: String,
    auto_update: bool,
    update_available: Option<UpdateAvailablePayload>,
    download_in_progress: bool,
    update_ready_for_restart: bool,
}

#[derive(Clone, Deserialize, Serialize)]
struct StagedUpdateMetadata {
    version: String,
    channel: String,
}

const STAGED_UPDATE_BYTES_FILE: &str = "staged-update.bin";
const STAGED_UPDATE_META_FILE: &str = "staged-update.json";
const STABLE_UPDATE_ENDPOINT: &str = "https://github.com/pgermishuys/weave-agent-fleet/releases/download/v{{current_version}}/latest.json";
const DEV_UPDATE_ENDPOINT: &str = "https://github.com/pgermishuys/weave-agent-fleet/releases/download/dev/latest.json";

fn normalize_channel(channel: &str) -> Option<&'static str> {
    match channel {
        "stable" => Some("stable"),
        "dev" => Some("dev"),
        _ => None,
    }
}

fn endpoint_for_channel(channel: &str) -> Result<Url, String> {
    let endpoint = match normalize_channel(channel) {
        Some("dev") => DEV_UPDATE_ENDPOINT,
        Some("stable") => STABLE_UPDATE_ENDPOINT,
        _ => return Err(format!("Unsupported update channel: {}", channel)),
    };

    Url::parse(endpoint).map_err(|e| format!("Invalid updater endpoint: {}", e))
}

fn should_update_for_channel(
    channel: &str,
    current: &Version,
    remote: &tauri_plugin_updater::RemoteRelease,
) -> bool {
    if remote.version > *current {
        return true;
    }

    let same_core = current.major == remote.version.major
        && current.minor == remote.version.minor
        && current.patch == remote.version.patch;

    match channel {
        "dev" => {
            if same_core && current.pre.is_empty() && !remote.version.pre.is_empty() {
                return true;
            }
            remote.version > *current
        }
        "stable" => same_core && !current.pre.is_empty() && remote.version.pre.is_empty(),
        _ => false,
    }
}

fn build_updater_for_channel(
    app: &tauri::AppHandle,
    channel: &str,
) -> Result<tauri_plugin_updater::Updater, String> {
    let normalized = normalize_channel(channel)
        .ok_or_else(|| format!("Unsupported update channel: {}", channel))?;
    let endpoint = endpoint_for_channel(normalized)?;

    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| format!("Failed to configure updater endpoint: {}", e))?
        .version_comparator(move |current, remote| {
            should_update_for_channel(normalized, &current, &remote)
        })
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))
}

fn staged_metadata(app: &tauri::AppHandle) -> Result<Option<StagedUpdateMetadata>, String> {
    let (_bytes_path, meta_path) = staged_update_paths(app)?;
    if !meta_path.exists() {
        return Ok(None);
    }

    let metadata = read(&meta_path).map_err(|e| format!("Failed to read staged metadata: {}", e))?;
    let parsed = serde_json::from_slice::<StagedUpdateMetadata>(&metadata)
        .map_err(|e| format!("Failed to parse staged metadata: {}", e))?;
    Ok(Some(parsed))
}

fn staged_update_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create app data dir: {}", e))?;
    Ok((
        app_data_dir.join(STAGED_UPDATE_BYTES_FILE),
        app_data_dir.join(STAGED_UPDATE_META_FILE),
    ))
}

fn clear_staged_update_artifacts(app: &tauri::AppHandle) -> Result<(), String> {
    let (bytes_path, meta_path) = staged_update_paths(app)?;
    if bytes_path.exists() {
        remove_file(&bytes_path)
            .map_err(|e| format!("Failed to remove staged update bytes: {}", e))?;
    }
    if meta_path.exists() {
        remove_file(&meta_path).map_err(|e| format!("Failed to remove staged metadata: {}", e))?;
    }
    Ok(())
}

/// Tauri command: returns any pending update that was discovered at startup.
/// The frontend calls this on mount to avoid the event-delivery race condition.
#[tauri::command]
fn check_for_update(state: tauri::State<'_, PendingUpdateState>) -> Option<UpdateAvailablePayload> {
    state.payload.lock().unwrap().clone()
}

#[tauri::command]
fn set_update_preferences(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdatePreferencesState>,
    pending_state: tauri::State<'_, PendingUpdateState>,
    auto_update: bool,
    channel: String,
) -> Result<(), String> {
    let normalized = normalize_channel(&channel)
        .ok_or_else(|| format!("Unsupported update channel: {}", channel))?;
    let mut prefs = state.prefs.lock().unwrap();
    let channel_changed = prefs.channel != normalized;
    prefs.auto_update = auto_update;
    prefs.channel = normalized.to_string();

    if channel_changed {
        let mut generation = pending_state.download_generation.lock().unwrap();
        *generation += 1;
        *pending_state.payload.lock().unwrap() = None;
        *pending_state.staged_payload.lock().unwrap() = None;
        clear_staged_update_artifacts(&app)?;
    }

    Ok(())
}

#[tauri::command]
fn get_update_state(
    pending_state: tauri::State<'_, PendingUpdateState>,
    prefs_state: tauri::State<'_, UpdatePreferencesState>,
) -> UpdateStatePayload {
    let prefs = prefs_state.prefs.lock().unwrap().clone();
    let update_available = pending_state.payload.lock().unwrap().clone();
    let download_in_progress = *pending_state.download_in_progress.lock().unwrap();
    let update_ready_for_restart = pending_state.staged_payload.lock().unwrap().is_some();

    UpdateStatePayload {
        channel: prefs.channel,
        auto_update: prefs.auto_update,
        update_available,
        download_in_progress,
        update_ready_for_restart,
    }
}

async fn check_for_updates_internal(
    app: &tauri::AppHandle,
    pending_state: &PendingUpdateState,
    channel: &str,
) -> Result<Option<UpdateAvailablePayload>, String> {
    let updater = build_updater_for_channel(app, channel)?;
    match updater.check().await {
        Ok(Some(update)) => {
            let payload = UpdateAvailablePayload {
                version: update.version.clone(),
                current_version: update.current_version.clone(),
            };
            *pending_state.payload.lock().unwrap() = Some(payload.clone());
            let _ = app.emit("update-available", payload.clone());
            Ok(Some(payload))
        }
        Ok(None) => {
            *pending_state.payload.lock().unwrap() = None;
            Ok(None)
        }
        Err(e) => Err(format!("Update check failed: {}", e)),
    }
}

async fn download_update_internal(
    app: &tauri::AppHandle,
    pending_state: &PendingUpdateState,
    prefs_state: &UpdatePreferencesState,
) -> Result<UpdateAvailablePayload, String> {
    {
        let mut download_in_progress = pending_state.download_in_progress.lock().unwrap();
        if *download_in_progress {
            return Err("Update download already in progress".to_string());
        }
        *download_in_progress = true;
    }

    let download_generation = *pending_state.download_generation.lock().unwrap();

    let is_invalidated = || {
        let current_generation = *pending_state.download_generation.lock().unwrap();
        current_generation != download_generation
    };

    if is_invalidated() {
        *pending_state.download_in_progress.lock().unwrap() = false;
        return Err("Update download invalidated before start".to_string());
    }

    let result = async {
        let channel = prefs_state.prefs.lock().unwrap().channel.clone();
        let updater = build_updater_for_channel(app, &channel)?;
        let update = updater
            .check()
            .await
            .map_err(|e| format!("Update check failed: {}", e))?
            .ok_or_else(|| "No update available".to_string())?;

        let payload = UpdateAvailablePayload {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
        };

        let progress_handle = app.clone();
        let mut bytes_downloaded: u64 = 0;
        let bytes = update
            .download(
                move |chunk_size, total| {
                    bytes_downloaded += chunk_size as u64;
                    let _ = progress_handle.emit(
                        "update-download-progress",
                        UpdateProgressPayload {
                            downloaded: bytes_downloaded,
                            total,
                        },
                    );
                },
                || {},
            )
            .await
            .map_err(|e| format!("Update download failed: {}", e))?;

        if is_invalidated() || prefs_state.prefs.lock().unwrap().channel != channel {
            return Err("Update download invalidated during transfer".to_string());
        }

        let (bytes_path, meta_path) = staged_update_paths(app)?;
        write(&bytes_path, &bytes)
            .map_err(|e| format!("Failed to persist staged update: {}", e))?;

        let prefs = prefs_state.prefs.lock().unwrap().clone();
        let metadata = StagedUpdateMetadata {
            version: payload.version.clone(),
            channel: prefs.channel,
        };
        let metadata_json = serde_json::to_vec(&metadata)
            .map_err(|e| format!("Failed to encode metadata: {}", e))?;
        write(&meta_path, metadata_json)
            .map_err(|e| format!("Failed to persist staged metadata: {}", e))?;

        if is_invalidated() || prefs_state.prefs.lock().unwrap().channel != channel {
            clear_staged_update_artifacts(app)?;
            return Err("Update download invalidated before staging".to_string());
        }

        *pending_state.staged_payload.lock().unwrap() = Some(payload.clone());
        let _ = app.emit("update-ready-for-restart", payload.clone());

        Ok::<UpdateAvailablePayload, String>(payload)
    }
    .await;

    *pending_state.download_in_progress.lock().unwrap() = false;
    result
}

async fn apply_staged_update_internal(
    app: &tauri::AppHandle,
    pending_state: &PendingUpdateState,
) -> Result<bool, String> {
    let (bytes_path, _meta_path) = staged_update_paths(app)?;
    if !bytes_path.exists() {
        return Ok(false);
    }

    let bytes = read(&bytes_path).map_err(|e| format!("Failed to read staged update bytes: {}", e))?;
    let metadata = staged_metadata(app)?.ok_or_else(|| "Missing staged update metadata".to_string())?;
    let updater = build_updater_for_channel(app, &metadata.channel)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed during apply: {}", e))?
        .ok_or_else(|| "No update available for staged apply".to_string())?;

    update
        .install(&bytes)
        .map_err(|e| format!("Failed to install staged update: {}", e))?;

    *pending_state.staged_payload.lock().unwrap() = None;
    *pending_state.payload.lock().unwrap() = None;
    clear_staged_update_artifacts(app)?;
    Ok(true)
}

#[tauri::command]
async fn check_for_updates(
    app: tauri::AppHandle,
    pending_state: tauri::State<'_, PendingUpdateState>,
    prefs_state: tauri::State<'_, UpdatePreferencesState>,
) -> Result<Option<UpdateAvailablePayload>, String> {
    let channel = prefs_state.prefs.lock().unwrap().channel.clone();
    check_for_updates_internal(&app, &pending_state, &channel).await
}

#[tauri::command]
async fn download_update(
    app: tauri::AppHandle,
    pending_state: tauri::State<'_, PendingUpdateState>,
    prefs_state: tauri::State<'_, UpdatePreferencesState>,
) -> Result<UpdateAvailablePayload, String> {
    download_update_internal(&app, &pending_state, &prefs_state).await
}

#[tauri::command]
async fn apply_staged_update(
    app: tauri::AppHandle,
    pending_state: tauri::State<'_, PendingUpdateState>,
) -> Result<bool, String> {
    apply_staged_update_internal(&app, &pending_state).await
}

/// Tauri command: download + install the available update, then restart.
/// The frontend invokes this when the user clicks "Install Update".
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let channel = app
        .try_state::<UpdatePreferencesState>()
        .map(|state| state.prefs.lock().unwrap().channel.clone())
        .unwrap_or_else(|| "stable".to_string());
    let updater = build_updater_for_channel(&app, &channel)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update check failed: {}", e))?;

    let update = match update {
        Some(u) => u,
        None => return Err("No update available".into()),
    };

    println!("[weave-fleet] Downloading update {}", update.version);

    let progress_handle = app.clone();
    let restart_handle = app.clone();
    let mut bytes_downloaded: u64 = 0;

    update
        .download_and_install(
            move |chunk_size, total| {
                bytes_downloaded += chunk_size as u64;
                let _ = progress_handle.emit(
                    "update-download-progress",
                    UpdateProgressPayload {
                        downloaded: bytes_downloaded,
                        total,
                    },
                );
            },
            move || {
                println!("[weave-fleet] Update installed, restarting...");
                restart_handle.restart();
            },
        )
        .await
        .map_err(|e| format!("Update install failed: {}", e))?;

    // The on_download_finish closure calls restart() which diverges, so this
    // line is only reached if the platform defers the restart. Return Ok to
    // keep the type system happy.
    Ok(())
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
    let tray_only = std::env::args().any(|a| a == "--tray");
    if tray_only {
        println!("[weave-fleet] Starting in tray-only mode (--tray)");
    }

    tauri::Builder::default()
        // --- Tauri commands ---
        .invoke_handler(tauri::generate_handler![
            check_for_update,
            set_update_preferences,
            get_update_state,
            check_for_updates,
            download_update,
            apply_staged_update,
            install_update
        ])
        // --- Plugins (must be registered before setup) ---
        .plugin(
            tauri_plugin_single_instance::init(move |app, _args, _cwd| {
                if tray_only {
                    if let Some(state) = app.try_state::<SidecarState>() {
                        open_browser(state.port);
                    }
                } else if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // --- Setup ---
        .setup(move |app| {
            // (a) Check for opencode CLI
            if !check_opencode_available() {
                eprintln!(
                    "[weave-fleet] WARNING: 'opencode' CLI not found on PATH. \
                     Agent sessions will not be able to spawn."
                );
            }

            // Manage pending update state (for frontend pull-based check)
            if !tray_only {
                app.manage(PendingUpdateState {
                    payload: Mutex::new(None),
                    staged_payload: Mutex::new(None),
                    download_in_progress: Mutex::new(false),
                    download_generation: Mutex::new(0),
                });
                app.manage(UpdatePreferencesState {
                    prefs: Mutex::new(UpdatePreferences {
                        auto_update: false,
                        channel: "stable".to_string(),
                    }),
                });
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

            // (d) Health check + navigation
            if tray_only {
                // Tray mode: health check + open default browser
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
            } else {
                // Default mode: health check + webview navigation
                let window = app
                    .get_webview_window("main")
                    .expect("Failed to get main window");

                #[cfg(not(debug_assertions))]
                {
                    let window_clone = window.clone();
                    tauri::async_runtime::spawn(async move {
                        let health_url = format!("http://127.0.0.1:{}/api/version", port);
                        let client = reqwest::Client::new();
                        let start = std::time::Instant::now();

                        loop {
                            if start.elapsed() > std::time::Duration::from_secs(30) {
                                eprintln!(
                                    "[weave-fleet] Sidecar failed to start within 30 seconds"
                                );
                                // Show error in the placeholder page
                                let _ = window_clone.eval(
                                    "document.body.innerHTML = '<h2>Failed to start server</h2><p>The application server did not respond within 30 seconds.</p>';"
                                );
                                let _ = window_clone.show();
                                return;
                            }
                            match client.get(&health_url).send().await {
                                Ok(resp) if resp.status().is_success() => break,
                                _ => {
                                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                                }
                            }
                        }

                        // Navigate webview to the sidecar
                        let url = format!("http://127.0.0.1:{}", port);
                        println!("[weave-fleet] Sidecar ready, navigating to {}", url);
                        let _ = window_clone.navigate(url.parse().unwrap());
                        let _ = window_clone.show();
                    });
                }

                // In dev mode, window is shown immediately (devUrl handles it)
                #[cfg(debug_assertions)]
                {
                    let _ = window.show();
                }
            }

            // (e) System tray
            if tray_only {
                // Tray-only mode: simplified menu with browser-open
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
            } else {
                // Default mode: full tray with window management
                let show_hide =
                    MenuItem::with_id(app, "show_hide", "Show Window", true, None::<&str>)?;
                let agent_count =
                    MenuItem::with_id(app, "agent_count", "Agents: 0 active", false, None::<&str>)?;
                let quit =
                    MenuItem::with_id(app, "quit", "Quit Weave Fleet", true, None::<&str>)?;
                let sep1 = PredefinedMenuItem::separator(app)?;
                let sep2 = PredefinedMenuItem::separator(app)?;

                let menu =
                    Menu::with_items(app, &[&show_hide, &sep1, &agent_count, &sep2, &quit])?;

                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("Weave Fleet")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show_hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
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
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                // Store tray state for polling updates
                app.manage(TrayState {
                    agent_count_item: agent_count,
                });
            }

            // (f) Agent count polling (every 10 seconds) — default mode only
            if !tray_only {
                let handle = app.handle().clone();
                let fleet_url = format!("http://127.0.0.1:{}/api/fleet/summary", port);
                tauri::async_runtime::spawn(async move {
                    let client = reqwest::Client::new();
                    // Wait for sidecar to be ready before starting to poll
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    loop {
                        if let Ok(resp) = client.get(&fleet_url).send().await {
                            if let Ok(body) = resp.json::<serde_json::Value>().await {
                                if let Some(count) =
                                    body.get("activeSessions").and_then(|v| v.as_u64())
                                {
                                    let text = format!("Agents: {} active", count);
                                    if let Some(state) = handle.try_state::<TrayState>() {
                                        let _ = state.agent_count_item.set_text(&text);
                                    }
                                }
                            }
                        }
                        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                    }
                });
            }

            // (g) Apply staged update on startup, then check for updates — default mode only.
            if !tray_only {
                let update_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                if let Some(pending_state) = update_handle.try_state::<PendingUpdateState>() {
                    match apply_staged_update_internal(&update_handle, &pending_state).await {
                        Ok(true) => {
                            println!("[weave-fleet] Applied staged update, restarting...");
                            update_handle.restart();
                        }
                        Ok(false) => {}
                        Err(e) => {
                            eprintln!("[weave-fleet] Staged update apply failed: {}", e);
                        }
                    }

                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;

                    let channel = update_handle
                        .try_state::<UpdatePreferencesState>()
                        .map(|state| state.prefs.lock().unwrap().channel.clone())
                        .unwrap_or_else(|| "stable".to_string());

                    match check_for_updates_internal(&update_handle, &pending_state, &channel).await {
                        Ok(Some(payload)) => {
                            println!("[weave-fleet] Update available: {}", payload.version);
                            if let Some(prefs_state) =
                                update_handle.try_state::<UpdatePreferencesState>()
                            {
                                let auto_update = prefs_state.prefs.lock().unwrap().auto_update;
                                if auto_update {
                                    if let Err(e) =
                                        download_update_internal(&update_handle, &pending_state, &prefs_state)
                                            .await
                                    {
                                        eprintln!("[weave-fleet] Auto-download failed: {}", e);
                                    }
                                }
                            }
                        }
                        Ok(None) => {
                            println!("[weave-fleet] No update available");
                        }
                        Err(e) => {
                            eprintln!("[weave-fleet] Update check failed: {}", e);
                        }
                    }
                } else {
                    eprintln!("[weave-fleet] Pending update state unavailable");
                }
                });
            }

            Ok(())
        })
        // --- Minimize to tray on close (default mode only) ---
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !tray_only {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // In tray mode: let the default close behavior happen
                // (the window is never shown, so this is a no-op)
            }
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

#[cfg(test)]
mod tests {
    use super::should_update_for_channel;
    use reqwest::Url;
    use semver::Version;
    use tauri_plugin_updater::{ReleaseManifestPlatform, RemoteRelease, RemoteReleaseInner};

    fn release(version: &str) -> RemoteRelease {
        RemoteRelease {
            version: Version::parse(version).unwrap(),
            notes: None,
            pub_date: None,
            data: RemoteReleaseInner::Dynamic(ReleaseManifestPlatform {
                url: Url::parse("https://example.com/update.zip").unwrap(),
                signature: "sig".to_string(),
            }),
        }
    }

    #[test]
    fn dev_channel_accepts_same_core_prerelease_from_stable() {
        let current = Version::parse("0.11.3").unwrap();
        let remote = release("0.11.3-dev.42");
        assert!(should_update_for_channel("dev", &current, &remote));
    }

    #[test]
    fn stable_channel_accepts_same_core_release_from_dev() {
        let current = Version::parse("0.11.3-dev.42").unwrap();
        let remote = release("0.11.3");
        assert!(should_update_for_channel("stable", &current, &remote));
    }

    #[test]
    fn stable_channel_rejects_older_release() {
        let current = Version::parse("0.11.4-dev.1").unwrap();
        let remote = release("0.11.3");
        assert!(!should_update_for_channel("stable", &current, &remote));
    }
}
