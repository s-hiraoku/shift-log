# ShiftLog

**ShiftLog** は PC とスマホの操作を許可制で観察し、十分ごとの窓にまとめてクラウドへ送り、Markdown の記憶とタイムラインにする — クラウドエージェントが続きを読むための作業記憶レイヤーです（OpenAI [Computer History](https://learn.chatgpt.com/docs/customization/computer-history) 互換の第一版実装）。

## 第一版の約束

| 方針 | 内容 |
| --- | --- |
| **デフォルトオフ** | 明示的に有効化し、Memories 相当がオンでないと動かない |
| **観察と記憶のみ** | Computer Use は入れない。エージェントは承認なしで操作しない |
| **スクショなし** | 画面録画・マイク・システム音声も取らない。全文キーログ禁止 |
| **四十八時間破棄** | 生イベントは 48 時間で破棄。残すのは人が読める Markdown 記憶だけ |
| **プライベートブラウズ** | 永久除外（Chrome 系はウィンドウのモード、Firefox / Edge などはタイトルで判定。Safari のプライベートウィンドウは判定できないので、Safari は `app_only` か除外を推奨） |
| **秘密と個人情報のマスク** | ウィンドウタイトルの API キー・トークン・パスワード・メール・電話番号・URL クエリを、コレクタと API の両方で保存前に置き換える。パスワード管理アプリはアプリ名だけ残す（[詳細](docs/window-titles.md#タイトルから消えるもの)） |
| **ログにタイトルを出さない** | コレクタのログは既定でタイトルの文字数だけ。`SHIFTLOG_DEBUG_TITLES=1` のときだけマスク済みタイトルを出す |
| **LLM は任意** | `SHIFTLOG_LLM_API_KEY` を設定したときだけ、マスク済みのタイトルとホスト名を外部 LLM に送る |
| **「続きやって」** | コンテキスト返却のみ。実行しない |

## モノレポ構成

```
apps/web        Next.js UI（設定 / 許可リスト / タイムライン / 記憶詳細）
apps/desktop    デスクトップコレクタ（メニューバー一時停止の骨格）
apps/mobile     スマホコレクタスタブ（コントロールセンター相当）
services/api    認証つきクラウド API（Hono / Vercel 対応）
packages/schema 共有 Zod スキーマ
skills/shift-log エージェント向け Skill（続きやって = context_only）
```

## エージェント Skill

クラウドエージェントが ShiftLog を作業記憶として使うための Skill を同梱しています。

- 本体: [`skills/shift-log/SKILL.md`](skills/shift-log/SKILL.md)
- API 詳細: [`skills/shift-log/api-reference.md`](skills/shift-log/api-reference.md)

Cursor などではリポジトリの Skill を有効化するか、`skills/shift-log` をエージェントの skill ディレクトリにコピーしてください。  
「続きやって」は必ず `/v1/agent/continue` → `mode: context_only` として扱い、Computer Use は行いません。

## データ形

- **十分窓**: `events.jsonl` 相当のイベント配列 + `metadata.json`
- **記憶 Markdown**: YAML フロントマターに `title`, `description`, `apps`, `device`, `window_start`, `window_end`
- 十分サマリと、UTC の 00/06/12/18 時で区切った六時間サマリ（同じ区間は同一 ID で上書き）
- 同一十分窓に PC とスマホがいれば `desk` / `mobile` の二レーン


## インストール（macOS）

Git と Node.js 20 以降（同梱の npm を使います）が必要です。pnpm は事前に入れなくてよく、`package.json` の `packageManager` で固定した版を `~/.local/share/shiftlog/toolchain` へ取り寄せます。グローバルの pnpm は変更しません。ワンライナーはソースを `~/.local/share/shiftlog/src` に置き、この 1 台だけのランダムな API トークンを `.env` に書いてキーチェーンへ登録し、`pnpm setup:launchd` まで実行します。SQLite は `~/.local/share/shiftlog/shiftlog.db` に残ります。API はループバック（`127.0.0.1:8787`）のみで待ち受けます。

```bash
curl -fsSL https://raw.githubusercontent.com/s-hiraoku/shift-log/main/scripts/install.sh | bash
```

更新（DB / `.env` / キーチェーンは消さない）:

```bash
curl -fsSL https://raw.githubusercontent.com/s-hiraoku/shift-log/main/scripts/install.sh | bash -s -- update
```

Linux では同じスクリプトがソース配置とビルドまで行い、常駐は [`docs/ops.md`](docs/ops.md) の systemd 手順を使います。開発用にリポジトリを直接 clone する場合は次の手順です。

## MVP クイックスタート

```bash
corepack enable
cp .env.example .env
pnpm install
pnpm --filter @shift-log/schema build
pnpm dev:api          # http://localhost:8787 （~/.local/share/shiftlog に永続化）
pnpm dev:web          # http://localhost:3000
```

Use the `packageManager` field in `package.json`. pnpm 9 installs without optional native bindings, then `pnpm test` fails. `corepack enable` makes `pnpm` honor that field. If corepack is unavailable:

```bash
npm exec --package="$(node -p "require('./package.json').packageManager")" -- pnpm install
```


`pnpm dev:api`, `pnpm dev:web`, and the desktop `dev` / `collect` / `demo` scripts read the repo-root `.env`. You do not need a symlink under `apps/web`. If `.env` is missing and `SHIFTLOG_API_TOKEN` is unset, the API still refuses to start (fail-closed).

1. ブラウザで http://localhost:3000 を開き、「有効化してデモデータを投入」
2. タイムラインで記憶を確認
3. （任意）連続収集デモ: `pnpm demo:desktop`
4. （任意）CLI シード: `pnpm seed`

### MVP でできること

- 設定で収集 ON/OFF・一時停止・履歴削除
- 十分窓のアップロード → Markdown 記憶化 → タイムライン/検索
- デスクトップ実収集（macOS: System Events / Linux: xdotool または xprop）。`--demo` は擬似イベント
- SQLite 永続化（既定 `~/.local/share/shiftlog/shiftlog.db`）または Postgres（`DATABASE_URL`）
- ユーザ単位のデータ分離（`SHIFTLOG_API_TOKENS`）。トークン未設定時は起動拒否（fail-closed）
- レート制限・アップロード上限・監査ログ・48h purge（自前ホスト + Vercel Cron）
- エージェント向け `context_only`（Computer Use なし）

運用手順（常駐・キーチェーン・Cron・署名）: [`docs/ops.md`](docs/ops.md)。macOS の常駐は `pnpm setup:launchd`（`node` のフルパスと `dist/*.js`。手で `YOU` を書き換えない）。

収集の質を上げるには: [ウィンドウタイトルに作業内容を出す](docs/window-titles.md)

### まだスタブのもの

- スマホネイティブ収集（対象外）
- 配布用インストーラのコード署名・公証（証明書は運用者側。手順は ops ガイド）


## セットアップ

```bash
corepack enable
pnpm install
pnpm --filter @shift-log/schema build
pnpm --filter @shift-log/api dev          # http://localhost:8787
pnpm --filter @shift-log/web dev          # http://localhost:3000
```

環境変数（サーバー側のみ — `NEXT_PUBLIC_*` にトークンを置かない）:

```bash
SHIFTLOG_API_TOKEN=dev-token          # 必須。未設定なら起動しない
# SHIFTLOG_API_TOKENS=alice:s1,bob:s2  # 任意。ユーザ単位でデータ分離
SHIFTLOG_API_ORIGIN=http://localhost:8787
# SHIFTLOG_DATA_DIR=./data             # 未設定時は ~/.local/share/shiftlog。相対パスはリポジトリルート基準
# DATABASE_URL=postgresql://...        # Vercel では必須（Postgres）
# CRON_SECRET=...                      # Vercel 毎時 purge
# SHIFTLOG_LLM_API_KEY=...             # 任意。十分サマリを LLM 化
```

実収集（設定で有効化したあと）:

```bash
pnpm --filter @shift-log/desktop credentials set "$SHIFTLOG_API_TOKEN"
pnpm --filter @shift-log/desktop collect
# メニュー: http://127.0.0.1:8791
```

macOS は初回にアクセシビリティ許可、Linux は `xdotool`（なければ `xprop`）が必要です。

## 読み取り専用 MCP

外部エージェントが記憶を読むための Streamable HTTP サーバです。書き込み、収集のオンオフ、OS 操作はありません。待受は `127.0.0.1:8790` です。API の既定はこれまでどおり `127.0.0.1:8787` です。

受信の Bearer は `SHIFTLOG_MCP_TOKEN` です。API を呼ぶときは、別の値である `SHIFTLOG_API_TOKEN` を使います。MCP トークンは 32 文字以上にしてください。`dev-token` では起動しません。

```bash
# .env に次の2行を書く。値は API トークンと違うものにする。
# SHIFTLOG_MCP_TOKEN=$(openssl rand -hex 32)
# SHIFTLOG_API_TOKEN は既存のまま。

pnpm --filter @shift-log/schema build
pnpm --filter @shift-log/mcp build
pnpm --filter @shift-log/mcp start
# ShiftLog MCP listening on http://127.0.0.1:8790/mcp
```

ポートは `--port` または `SHIFTLOG_MCP_PORT` で変えられます。開発中にファイルを見ながら動かすときは `pnpm dev:mcp` です。

`pnpm setup:launchd` は、`.env` に `SHIFTLOG_MCP_TOKEN` があるときだけ `com.shiftlog.mcp` を登録します。ログは `~/Library/Logs/shiftlog-mcp.log` です。トークンの行を消して同じコマンドを再実行すると、その LaunchAgent は外れます。API とコレクタの登録は今までどおりです。plist にはトークンを書きません。

Tailscale Funnel で外から届くようにする手順です。このリポジトリの変更では Funnel を有効にしません。実行するかは運用者の判断です。

```bash
tailscale funnel --bg 8790
tailscale funnel status
# 止めるときは tailscale funnel --help の off / reset に従う
```

注意:

- Funnel はインターネットに公開します。門は Bearer だけです。トークンは 32 バイトの乱数にして、コマンドラインではなくクライアント設定に置いてください。
- 公開するのは `8790` だけです。API の `8787` とコレクタメニューの `8791` は Funnel に載せないでください。API には書き込みと削除があります。
- クライアントが tailnet に入れるなら、`tailscale serve` のほうが公開範囲は狭いです。
- `*.ts.net` の名前は Certificate Transparency のログに残ります。URL は知られているものとして扱ってください。
- 記憶にはウィンドウタイトル、リポジトリ名、Slack チャンネル名が入ります。トークンを持つ人はそれらを読めます。
- トークンを回すときは `.env` を書き換えて `launchctl kickstart -k gui/$(id -u)/com.shiftlog.mcp` します。API とコレクタのトークンは別なので、そちらは動き続けます。

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
| GET | `/internal/cron/purge` | 48h 生イベント + 期限切れ十分記憶の破棄（`CRON_SECRET`） |

## Vercel

- Web: `apps/web` を Root Directory に設定
- API: `services/api` を別プロジェクトにし、`api/index.ts` をエントリに使用
- またはルートの `vercel.json` で API ルートを紐付け

Vercel + Postgres（Neon など）では、ウィンドウタイトルに含まれる業務情報（Slack のチャンネル名、社内ツールの案件名など）が社外のデータベースに保存されます。社内情報を扱う場合はセルフホスト（SQLite は `~/.local/share/shiftlog/shiftlog.db`、ファイル権限 0600）にするか、許可リストの「タイトル非記録アプリ」で `app_only`（#41）を指定してください。滞在時間は残し、チャンネル名などはコレクタが送る前に落とします。

## テスト

```bash
pnpm test
```

Claude Code のクラウドセッションでは `.claude/hooks/session-start.sh` が依存導入・schema ビルド・`.env` 作成を済ませます。UI まで通す検証は `verify-shift-log` スキル（[`.claude/skills/verify-shift-log/SKILL.md`](.claude/skills/verify-shift-log/SKILL.md)）を使います。十分サマリ（LLM 要約）の質は `eval-shift-log` スキル（[`.claude/skills/eval-shift-log/SKILL.md`](.claude/skills/eval-shift-log/SKILL.md)）の eval で測り、プロンプト変更は train/test 分割でヒルクライムします。

## レビュー

PR は CodeRabbit と Cursor Bugbot で自動レビューされます。

## 参考

- 公式仕様: https://learn.chatgpt.com/docs/customization/computer-history
- 繰り返し作業の `skill_candidate` フラグは立てるが、実装は後続の SkillCheck へ渡す前提
