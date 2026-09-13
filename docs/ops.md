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
| `SHIFTLOG_DATA_DIR` | 自前ホスト | SQLite。未設定時は `~/.local/share/shiftlog`。相対パスはリポジトリルート基準 |
| `DATABASE_URL` | Vercel では必須 | `postgres://` / `postgresql://` |
| `CRON_SECRET` | Vercel Cron | `/internal/cron/purge` の共有秘密 |
| `SHIFTLOG_CORS_ORIGINS` | 任意 | カンマ区切り。未設定は `*` |
| `SHIFTLOG_RATE_LIMIT_PER_MIN` | 任意 | 既定 60 |
| `SHIFTLOG_MAX_UPLOAD_BYTES` | 任意 | 既定 512000 |
| `SHIFTLOG_LLM_API_KEY` | 任意 | あるとき十分サマリを LLM 化 |
| `SHIFTLOG_LLM_BASE_URL` | 任意 | 既定 `https://api.openai.com/v1` |
| `SHIFTLOG_LLM_MODEL` | 任意 | 既定 `gpt-4o-mini` |
| `SHIFTLOG_TEN_MINUTE_RETENTION_DAYS` | 任意 | 十分記憶の保持日数。既定 14。六時間記憶は残る |
| `SHIFTLOG_CONTROL_PORT` | 任意 | コレクタメニュー。既定 8791 |

`NEXT_PUBLIC_*` にトークンを置かない。

## 保持と監査

- 生イベントは **キャプチャ時刻（window_end）から 48 時間** で破棄
- 十分記憶は `window_end` から N 日（既定 14）で破棄。六時間記憶は残る
- persist はスナップショット書き込みサイズを `[persist] snapshot user=… bytes=…` に出す
- 自前ホストは起動時 + 1 時間ごとに purge
- Vercel は毎時 `GET /internal/cron/purge`（`Authorization: Bearer $CRON_SECRET`）
- 監査は stdout の 1 行 JSON（トークンと生イベントは出さない）
- `/v1/*` はテナント単位のレート制限。過大 POST は 413

SQLite バックアップ: `SHIFTLOG_DATA_DIR/shiftlog.db`（既定 `~/.local/share/shiftlog/shiftlog.db`）を止めてコピーするか、`sqlite3 ... ".backup backup.db"`。新規作成時のファイル権限は `0600`。以前の cwd 相対 `./data`（`pnpm dev:api` では `services/api/data/shiftlog.db` になりがちだった）を使っていた場合は、そのファイルを新しい場所へ移す。

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

`packaging/macos/*.plist` はそのままでは動きません。`pnpm` は launchd の PATH に無く、API の `start` は `node dist/server.js` なので先に `pnpm build` が必要です。次のコマンドが両方をやります。

```bash
pnpm install
cp .env.example .env
# SHIFTLOG_API_TOKEN を推測されにくい値に変更する
pnpm --filter @shift-log/desktop credentials set "$SHIFTLOG_API_TOKEN"
pnpm setup:launchd
```

`pnpm setup:launchd` は `pnpm build` のあと、このマシンの `node` フルパスとリポジトリパスで plist を生成し、`~/Library/LaunchAgents` へ書いて `launchctl bootstrap` します。再実行しても同じ状態に収束します。

コレクタのトークンはキーチェーン（または `~/.config/shiftlog/credentials.json`）から読むので、コレクタ側 plist には書きません。API のトークンはリポジトリ直下の `.env` を `scripts/load-root-env.mjs` 経由で読みます。plist に `SHIFTLOG_API_TOKEN` は入りません。

確認:

- `~/Library/Logs/shiftlog-api.log` に `ShiftLog API listening on http://localhost:8787`
- `~/Library/Logs/shiftlog-collector.log` に `[desktop] collector ready`
- 収集を設定で有効化すると、約 10 分後に窓が API へ届く

生成だけして登録しない場合は `pnpm setup:launchd --skip-bootstrap` です。Linux では bootstrap を自動で飛ばします。

#### アクセシビリティを実行ファイル単位で再許可する

macOS のアクセシビリティ許可は実行ファイル単位です。ターミナルや `pnpm collect` で一度許可していても、launchd が呼ぶ `node` には別の許可が要ります。

1. `pnpm setup:launchd` を実行する
2. システム設定 → プライバシーとセキュリティ → アクセシビリティ を開く
3. 生成 plist の `ProgramArguments` 先頭と同じ `node`（例: `/opt/homebrew/bin/node` や volta のパス）を追加して許可する
4. コレクタをやり直す: `launchctl kickstart -k gui/$(id -u)/com.shiftlog.collector`

許可した `node` と plist のパスが違うと、窓タイトルは取れずログに `front window unavailable` が出ます。Node を入れ直したあとも、新しいバイナリに対して同じ手順を繰り返してください。

## Vercel

- Web: Root Directory `apps/web`
- API: Root Directory `services/api`（`api/index.ts`）。`vercel.json` の Cron が毎時 purge
- API 環境変数: `SHIFTLOG_API_TOKEN`（または `SHIFTLOG_API_TOKENS`）、`DATABASE_URL`、`CRON_SECRET`、必要なら `SHIFTLOG_LLM_*` / `SHIFTLOG_CORS_ORIGINS`
- SQLite は使わない（サーバレスでディスクが消える）

Vercel + Postgres では、ウィンドウタイトルに含まれる業務情報（Slack のチャンネル名、社内ツールの案件名など）が Neon など社外の DB に保存されます。社内情報を扱う場合はセルフホストにするか、アプリ名だけを残してタイトルを落とす `app_only`（#41、未実装）を検討してください。

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
