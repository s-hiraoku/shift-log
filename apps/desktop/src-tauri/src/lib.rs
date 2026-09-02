use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/// Check GitHub Releases for a newer version, then download, install and
/// relaunch. The updater verifies each artifact against the embedded public
/// key before writing anything to disk, so a bad/forged update is rejected.
async fn check_for_updates(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    let updater = app.updater()?;
    match updater.check().await? {
        Some(update) => {
            let version = update.version.clone();
            println!("[updater] update available: {version} — downloading");
            let mut downloaded = 0usize;
            update
                .download_and_install(
                    |chunk, total| {
                        downloaded += chunk;
                        if let Some(total) = total {
                            println!("[updater] {downloaded}/{total} bytes");
                        }
                    },
                    || println!("[updater] download finished, installing"),
                )
                .await?;
            println!("[updater] {version} installed — relaunching");
            app.restart();
        }
        None => println!("[updater] already up to date"),
    }
    Ok(())
}

/// Background collector agent (PoC placeholder).
///
/// ShiftLog v1 ships the collector as a stub — real OS hooks (foreground app,
/// browser navigations, notifications; never screenshots/keylog) are wired in
/// later. This heartbeat marks where that agent runs inside the desktop app.
fn spawn_collector_agent() {
    std::thread::spawn(|| loop {
        println!("[collector] tick — captures=off, keylog=forbidden (OS hooks not yet wired)");
        std::thread::sleep(Duration::from_secs(60));
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            spawn_collector_agent();

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = check_for_updates(handle).await {
                    eprintln!("[updater] check failed: {err}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ShiftLog desktop app");
}
