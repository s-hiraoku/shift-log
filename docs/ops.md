# ShiftLog 運用ガイド（個人〜少数ユーザ）

このリポジトリを自分の PC で回すための手順です。モバイルネイティブ収集は対象外です。

## 最小構成

1. API（このマシンまたは Vercel + Postgres）
2. Web UI（任意。設定とタイムライン）
3. デスクトップコレクタ（macOS / Linux）

```bash
cp .env.example .env
# SHIFTLOG_API_TOKEN を推測されにくい値に変更する
pnpm install
pnpm --filter @shift-log/schema build
pnpm --filter @shift-log/api build
pnpm --filter @shift-log/api start    # :8787
pnpm --filter @shift-log/web dev      # :3000（任意）
```

トークンを OS キーチェーンへ（以降コレクタは env なしで読める）:

```bash
pnpm --filter @shift-log/desktop credentials set "$SHIFTLOG_API_TOKEN"
pnpm --filter @shift-log/desktop collect
```

メニュー: ブラウザで http://127.0.0.1:8791 （一時停止 / 再開 / 終了）。  
任意で `pnpm --filter @shift-log/desktop menu` または `pnpm --filter @shift-log/desktop tray`。

## 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `SHIFTLOG_API_TOKEN` | はい | Bearer。未設定なら API は起動しない |
| `SHIFTLOG_API_TOKENS` | 任意 | `user:token,...` でテナント分離 |
| `SHIFTLOG_ALLOW_INSECURE_DEV` | 開発のみ | `1` のとき暗黙 `dev-token` |
| `SHIFTLOG_DATA_DIR` | 自前ホスト | SQLite `shiftlog.db` |
| `DATABASE_URL` | Vercel では必須 | `postgres://` / `postgresql://` |
| `CRON_SECRET` | Vercel Cron | `/internal/cron/purge` の共有秘密 |
| `SHIFTLOG_CORS_ORIGINS` | 任意 | カンマ区切り。未設定は `*` |
| `SHIFTLOG_RATE_LIMIT_PER_MIN` | 任意 | 既定 60 |
| `SHIFTLOG_MAX_UPLOAD_BYTES` | 任意 | 既定 512000 |
| `SHIFTLOG_LLM_API_KEY` | 任意 | あるとき十分サマリを LLM 化 |
| `SHIFTLOG_LLM_BASE_URL` | 任意 | 既定 `https://api.openai.com/v1` |
| `SHIFTLOG_LLM_MODEL` | 任意 | 既定 `gpt-4o-mini` |
| `SHIFTLOG_CONTROL_PORT` | 任意 | コレクタメニュー。既定 8791 |

`NEXT_PUBLIC_*` にトークンを置かない。

## 保持と監査

- 生イベントは **キャプチャ時刻（window_end）から 48 時間** で破棄。Markdown 記憶は残る
- 自前ホストは起動時 + 1 時間ごとに purge
- Vercel は毎時 `GET /internal/cron/purge`（`Authorization: Bearer $CRON_SECRET`）
- 監査は stdout の 1 行 JSON（トークンと生イベントは出さない）
- `/v1/*` はテナント単位のレート制限。過大 POST は 413

SQLite バックアップ: `SHIFTLOG_DATA_DIR/shiftlog.db` を止めてコピーするか、`sqlite3 ... ".backup backup.db"`。

## ログイン・常駐

### Linux（ユーザ systemd）

```bash
mkdir -p ~/.config/shiftlog ~/.config/systemd/user
cp packaging/linux/shiftlog-collector.service ~/.config/systemd/user/
# WorkingDirectory をクローン先に直す
printf 'SHIFTLOG_API_ORIGIN=https://YOUR_API\n' > ~/.config/shiftlog/collector.env
# トークンはキーチェーン推奨
systemctl --user daemon-reload
systemctl --user enable --now shiftlog-collector.service
```

自前 API も動かす場合は `packaging/linux/shiftlog-api.service` を同じ手順で。  
Linux 収集には `xdotool`（なければ `xprop`）が必要です。

### macOS（launchd）

```bash
# WorkingDirectory / ログパスの YOU を置き換える
cp packaging/macos/com.shiftlog.collector.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.shiftlog.collector.plist
```

初回はシステム設定 → プライバシーとセキュリティ → アクセシビリティで Node / ターミナルを許可。

## Vercel

- Web: Root Directory `apps/web`
- API: Root Directory `services/api`（`api/index.ts`）。`vercel.json` の Cron が毎時 purge
- API 環境変数: `SHIFTLOG_API_TOKEN`（または `SHIFTLOG_API_TOKENS`）、`DATABASE_URL`、`CRON_SECRET`、必要なら `SHIFTLOG_LLM_*` / `SHIFTLOG_CORS_ORIGINS`
- SQLite は使わない（サーバレスでディスクが消える）

## 署名・公証（任意）

この PR のコレクタは Node プロセスなので、個人利用では署名なしで運用できます。  
配布用インストーラ（別 PR の Tauri）を出すときだけ、次を用意します。

| 用途 | 用意するもの |
| --- | --- |
| macOS 署名 | Apple Developer ID Application 証明書 |
| macOS 公証 | App Store Connect API キー（Issuer / Key ID / `.p8`） |
| Tauri updater | `tauri signer generate` の秘密鍵。GitHub secret `TAURI_SIGNING_PRIVATE_KEY`（とパスワード） |
| GitHub Releases | 公開リポジトリ、または private + トークン付き updater |

証明書が無い状態で CI に公証ジョブを置くと毎回失敗するので、キーを入れたあとで workflow を有効化してください。

## まだやらないこと

- スマホのネイティブ収集
- Computer Use / 画面操作
- スクショ・マイク・全文キーログ
