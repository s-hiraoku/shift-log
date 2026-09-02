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
- 十分サマリと、最大 36 本を束ねた六時間サマリ
- 同一十分窓に PC とスマホがいれば `desk` / `mobile` の二レーン


## MVP クイックスタート

```bash
cp .env.example .env
pnpm install
pnpm --filter @shift-log/schema build
pnpm dev:api          # http://localhost:8787 （data/ に永続化）
pnpm dev:web          # http://localhost:3000
```

1. ブラウザで http://localhost:3000 を開き、「有効化してデモデータを投入」
2. タイムラインで記憶を確認
3. （任意）連続収集デモ: `pnpm demo:desktop`
4. （任意）CLI シード: `pnpm seed`

### MVP でできること

- 設定で収集 ON/OFF・一時停止・履歴削除
- 十分窓のアップロード → Markdown 記憶化 → タイムライン/検索
- デスクトップ実収集（macOS: System Events / Linux: xdotool または xprop）。`--demo` は擬似イベント
- SQLite 永続化（`SHIFTLOG_DATA_DIR/shiftlog.db`）または Postgres（`DATABASE_URL`）
- ユーザ単位のデータ分離（`SHIFTLOG_API_TOKENS`）。トークン未設定時は起動拒否（fail-closed）
- レート制限・アップロード上限・監査ログ・48h purge（自前ホスト + Vercel Cron）
- エージェント向け `context_only`（Computer Use なし）

運用手順（常駐・キーチェーン・Cron・署名）: [`docs/ops.md`](docs/ops.md)

### まだスタブのもの

- スマホネイティブ収集（対象外）
- 配布用インストーラのコード署名・公証（証明書は運用者側。手順は ops ガイド）


## セットアップ

```bash
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
SHIFTLOG_DATA_DIR=./data               # SQLite: data/shiftlog.db
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
| GET | `/internal/cron/purge` | 48h 生イベント破棄（`CRON_SECRET`） |

## Vercel

- Web: `apps/web` を Root Directory に設定
- API: `services/api` を別プロジェクトにし、`api/index.ts` をエントリに使用
- またはルートの `vercel.json` で API ルートを紐付け

## テスト

```bash
pnpm test
```

## 参考

- 公式仕様: https://learn.chatgpt.com/docs/customization/computer-history
- 繰り返し作業の `skill_candidate` フラグは立てるが、実装は後続の SkillCheck へ渡す前提
