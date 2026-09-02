# ShiftLog

**ShiftLog** は PC とスマホの操作を許可制で観察し、十分ごとの窓にまとめてクラウドへ送り、Markdown の記憶とタイムラインにする — クラウドエージェントが続きを読むための作業記憶レイヤーです（OpenAI [Computer History](https://learn.chatgpt.com/docs/customization/computer-history) 互換の第一版実装）。

## 第一版の約束

| 方針 | 内容 |
| --- | --- |
| **デフォルトオフ** | 明示的に有効化し、Memories 相当がオンでないと動かない |
| **観察と記憶のみ** | Computer Use は入れない。エージェントは承認なしで操作しない |
| **スクショなし** | 画面録画・マイク・システム音声も取らない。全文キーログ禁止 |
| **四十八時間破棄** | 生イベントは 48 時間で破棄。残すのは人が読める Markdown 記憶だけ |
| **プライベートブラウズ** | 永久除外 |
| **「続きやって」** | コンテキスト返却のみ。実行しない |

## モノレポ構成

```
apps/web        Next.js UI（設定 / 許可リスト / タイムライン / 記憶詳細）
apps/desktop    デスクトップコレクタ（メニューバー一時停止の骨格）
apps/mobile     スマホコレクタスタブ（コントロールセンター相当）
services/api    認証つきクラウド API（Hono / Vercel 対応）
packages/schema 共有 Zod スキーマ
```

## データ形

- **十分窓**: `events.jsonl` 相当のイベント配列 + `metadata.json`
- **記憶 Markdown**: YAML フロントマターに `title`, `description`, `apps`, `device`, `window_start`, `window_end`
- 十分サマリと、最大 36 本を束ねた六時間サマリ
- 同一十分窓に PC とスマホがいれば `desk` / `mobile` の二レーン

## セットアップ

```bash
pnpm install
pnpm --filter @shift-log/schema build
pnpm --filter @shift-log/api dev          # http://localhost:8787
pnpm --filter @shift-log/web dev          # http://localhost:3000
```

環境変数（サーバー側のみ — `NEXT_PUBLIC_*` にトークンを置かない）:

```bash
SHIFTLOG_API_TOKEN=dev-token
SHIFTLOG_API_ORIGIN=http://localhost:8787
```

Web UI は `/api/*` の Route Handler 経由で API を呼び、Bearer トークンはサーバー側で付与します。

## API（認証: Bearer）

| Method | Path | 説明 |
| --- | --- | --- |
| GET/PUT | `/v1/permissions` | 設定・許可 |
| POST | `/v1/windows` | 十分窓アップロード → 要約ジョブ |
| GET | `/v1/timeline` | タイムライン一覧 |
| GET | `/v1/memories/:id` | 記憶詳細 |
| GET | `/v1/search?q=` | 検索 |
| POST | `/v1/history/delete` | 直近十分 / 一時間 / 一日 / 全部（イベントも記憶も削除） |
| GET | `/v1/agent/recent` | エージェント向け直近記憶（読み取り） |
| POST | `/v1/agent/continue` | 「続きやって」→ `mode: context_only` |

## Vercel

- Web: `apps/web` を Root Directory に設定
- API: `services/api` を別プロジェクトにし、`api/index.ts` をエントリに使用
- またはルートの `vercel.json` で API ルートを紐付け

## デスクトップアプリ（Tauri v2 / macOS・Linux）

`apps/desktop` は Next.js の UI を同梱した Tauri v2 アプリで、バックグラウンド収集エージェント（v1 はスタブ）を起動し、**GitHub Releases 経由で自動更新**します。

エンドユーザ向けのインストール手順は [デスクトップアプリ インストールガイド](docs/desktop-install-guide.md) を参照してください。

### 開発

```bash
# Linux ビルド依存（Ubuntu 例）
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  patchelf libayatana-appindicator3-dev xdg-utils

# UI を直接叩く API のオリジン/トークン（未署名 PoC 用）
export NEXT_PUBLIC_SHIFTLOG_API_BASE=http://localhost:8787
export NEXT_PUBLIC_SHIFTLOG_API_TOKEN=dev-token

pnpm --filter @shift-log/desktop app:dev     # 開発起動（devUrl: :3000）
pnpm --filter @shift-log/desktop app:build    # インストーラ + updater 生成
```

Web ビルドは非破壊です。`SHIFTLOG_DESKTOP=1` のときだけ Next.js が `output: "export"` になり、`build:desktop` が静的エクスポート（`apps/web/out`）を生成します。デスクトップは `/api` プロキシを使わず API を直接呼ぶため、トークンはビルド時に埋め込みます（PoC のみ。製品版は Tauri/OS キーチェーン側で保持してください）。

### リリースと自動更新

1. 更新用署名鍵を生成: `pnpm --filter @shift-log/desktop tauri signer generate`
2. リポジトリに Secrets を登録:
   - `TAURI_SIGNING_PRIVATE_KEY`（秘密鍵の中身）
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（無ければ空）
   - `SHIFTLOG_API_TOKEN` と Variables `SHIFTLOG_API_BASE`
3. 公開鍵を `apps/desktop/src-tauri/tauri.conf.json` の `plugins.updater.pubkey` に設定
4. タグを push: `git tag desktop-v0.1.0 && git push --tags`
   - GitHub Actions（`.github/workflows/desktop-release.yml`）が mac/linux をビルドし、
     `latest.json` 付きで Release にアップロード
5. 既存インストールは次回起動時に自動更新（署名検証つき）

未署名 PoC のため、OS のコード署名/公証（Apple Developer 証明書・Windows 署名）は未対応です。配布時の警告を消すには別途証明書が必要です。

## テスト

```bash
pnpm test
```

## 参考

- 公式仕様: https://learn.chatgpt.com/docs/customization/computer-history
- 繰り返し作業の `skill_candidate` フラグは立てるが、実装は後続の SkillCheck へ渡す前提
