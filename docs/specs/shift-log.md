---
spec_id: shift-log
version: 1
status: approved
title: ShiftLog API・MCP・Web モノレポのワークスペース検証とプライバシー境界
owner: "@s-hiraoku"
---

## 目的

ShiftLog（許可制アクティビティ記憶 API・MCP・Web UI・コレクタモノレポ）について、固定された Node.js / pnpm ツールチェーンのもとで共有スキーマのビルド、全ワークスペースのテストおよび型検査、ならびに秘密情報マスクと認可境界が承認済み仕様どおりに保たれていることを継続的に検証する。

## 受け入れ条件

- **AC-001**: `.nvmrc`（Node.js 24 系）および `package.json` の `packageManager` で固定した `pnpm` により、ワークスペース依存の復元と `@shift-log/schema` のビルドが再現可能に完了する。
- **AC-002**: 全ワークスペースのテスト（`pnpm -r run test`）、スクリプトテスト（`node --test scripts/*.test.mjs`）、および型検査（`pnpm typecheck`）がエラーなしで完了する。

## 不変条件

- **INV-001**: 秘密情報・個人情報のマスク（`packages/schema/src/redact.test.ts`）および API・BFF の認可とプライバシー境界（`services/api/src/app.test.ts`、`apps/web/lib/privacy.test.ts`、`apps/web/lib/bff-auth.test.ts`）がテストで常に成立する。
