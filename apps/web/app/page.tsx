"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PermissionsConfig } from "@shift-log/schema";
import { apiFetch } from "@/lib/api";

export default function HomePage() {
  const [config, setConfig] = useState<PermissionsConfig | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const c = await apiFetch<PermissionsConfig>("/v1/permissions");
      setConfig(c);
    } catch (e) {
      setStatus(String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function enableAndSeed() {
    setBusy(true);
    setStatus("デモデータを投入中…");
    try {
      const result = await apiFetch<{
        ok: boolean;
        windows: number;
        memories: number;
        permissions_enabled: boolean;
      }>("/v1/demo/seed", {
        method: "POST",
        body: JSON.stringify({ enable: true }),
      });
      await refresh();
      setStatus(
        `準備完了: windows=${result.windows}, memories=${result.memories}. タイムラインを開いてください。`,
      );
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(config?.enabled && config?.memories_enabled);

  return (
    <div className="stack">
      <section className="card stack">
        <h1>ShiftLog</h1>
        <p>
          PC とスマホの操作を<strong>許可制</strong>で観察し、十分ごとの窓にまとめてクラウドへ送り、
          Markdown の記憶とタイムラインにする。クラウドエージェントが続きを読むための作業記憶レイヤー。
        </p>
        <p className="muted">
          OpenAI Computer History 互換（第一版は観察と記憶のみ。Computer Use は入れない）。
        </p>
        <div className="row">
          <span className={`badge ${ready ? "ok" : "off"}`}>
            {ready ? "収集オン" : "デフォルトオフ"}
          </span>
          <span className="badge off">screenshots: off</span>
          <span className="badge off">keylog: forbidden</span>
        </div>
        <div className="row">
          <button type="button" disabled={busy} onClick={() => void enableAndSeed()}>
            {busy ? "処理中…" : "有効化してデモデータを投入"}
          </button>
          <Link href="/timeline">タイムラインへ</Link>
          <Link href="/settings">設定へ</Link>
        </div>
        {status ? <p className="muted">{status}</p> : null}
      </section>

      <section className="card stack">
        <h2>MVP の使い方</h2>
        <ol>
          <li>上のボタンで収集を有効化し、デモ記憶を投入する</li>
          <li>
            デスクトップコレクタを回す:{" "}
            <code>pnpm --filter @shift-log/desktop demo</code>
          </li>
          <li>タイムラインで記憶を確認し、エージェントは「続きやって」で context_only を受け取る</li>
        </ol>
        <p className="muted">
          生イベントは capture の window_end から 48 時間で破棄。プライベートブラウズと全文キーログはサーバー側でも除外します。
        </p>
      </section>
    </div>
  );
}
