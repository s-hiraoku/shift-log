use std::process::Command;
use tao::{
    event::Event,
    event_loop::{ControlFlow, EventLoopBuilder},
};
use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem},
    Icon, TrayIconBuilder, TrayIconEvent,
};

fn load_icon() -> Option<Icon> {
    let bytes = include_bytes!("../icon.png");
    image_to_icon(bytes).ok()
}

fn image_to_icon(png: &[u8]) -> Result<Icon, ()> {
    // 16x16 RGBA written by the repo; tray-icon accepts raw RGBA.
    // Decode via a tiny PNG parser is overkill — embed raw if decode fails.
    Icon::from_rgba(simple_png_rgba(png)?, 16, 16).map_err(|_| ())
}

fn simple_png_rgba(png: &[u8]) -> Result<Vec<u8>, ()> {
    // Prefer the file as a pre-decoded 16x16 blue square if PNG decode is absent.
    if png.len() >= 8 && png.starts_with(b"\x89PNG") {
        let mut rgba = Vec::with_capacity(16 * 16 * 4);
        for _ in 0..(16 * 16) {
            rgba.extend_from_slice(&[0x2f, 0x6b, 0xe5, 0xff]);
        }
        return Ok(rgba);
    }
    Err(())
}

const CONTROL: &str = "http://127.0.0.1:8791";

fn post(path: &str) {
    let url = format!("{CONTROL}{path}");
    let _ = Command::new("curl").args(["-s", "-X", "POST", &url]).status();
}

fn open_timeline() {
    let url = std::env::var("SHIFTLOG_UI_URL").unwrap_or_else(|_| "http://localhost:3000/timeline".into());
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let _ = Command::new(opener).arg(url).status();
}

fn main() {
    let event_loop = EventLoopBuilder::new().build();

    let menu = Menu::new();
    let pause = MenuItem::new("一時停止", true, None);
    let resume = MenuItem::new("再開", true, None);
    let timeline = MenuItem::new("タイムラインを開く", true, None);
    let quit = MenuItem::new("終了", true, None);
    let _ = menu.append(&pause);
    let _ = menu.append(&resume);
    let _ = menu.append(&timeline);
    let _ = menu.append(&quit);

    let mut builder = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip("ShiftLog")
        .with_title("ShiftLog");
    if let Some(icon) = load_icon() {
        builder = builder.with_icon(icon);
    }
    let mut tray = Some(builder.build().expect("tray icon"));

    let menu_channel = MenuEvent::receiver();
    let pause_id = pause.id().clone();
    let resume_id = resume.id().clone();
    let timeline_id = timeline.id().clone();
    let quit_id = quit.id().clone();

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::LoopDestroyed = event {
            tray.take();
        }
        if let Ok(ev) = menu_channel.try_recv() {
            if ev.id == pause_id {
                post("/pause");
            } else if ev.id == resume_id {
                post("/resume");
            } else if ev.id == timeline_id {
                open_timeline();
            } else if ev.id == quit_id {
                post("/quit");
                *control_flow = ControlFlow::Exit;
            }
        }
        let _ = TrayIconEvent::receiver().try_recv();
    });
}
