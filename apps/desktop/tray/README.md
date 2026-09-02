# ShiftLog tray (optional)

Native menu-bar / system-tray helper. Talks to the collector control server at `http://127.0.0.1:8791`.

```bash
# collector first
pnpm --filter @shift-log/desktop collect

# then, on a machine with a desktop session:
sudo apt-get install -y libgtk-3-dev libayatana-appindicator3-dev   # Linux
cargo run --manifest-path apps/desktop/tray/Cargo.toml
```

Menu: 一時停止 / 再開 / タイムラインを開く / 終了.

Headless servers and CI do not need this binary — use the local HTML menu at `:8791` instead.
