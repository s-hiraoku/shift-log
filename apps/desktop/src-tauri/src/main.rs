// Prevents an extra console window on Windows in release. macOS/Linux ignore it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    shiftlog_desktop_lib::run();
}
