"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { MemoryRecord } from "@shift-log/schema";
import { serializeMemoryMarkdown } from "@shift-log/schema";
import { apiFetch } from "@/lib/api";

/**
 * Memory detail is a query-param route (`/memories?id=…`) rather than a
 * dynamic path segment. A single static page works reliably as an SPA in
 * both the web build and the Tauri static export (no per-id HTML files,
 * so client-side navigation never falls through to a missing asset).
 */
function MemoryDetail() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const [memory, setMemory] = useState<MemoryRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    setMemory(null);
    setError("");
    apiFetch<MemoryRecord>(`/v1/memories/${id}`)
      .then(setMemory)
      .catch((e) => setError(String(e)));
  }, [id]);

  if (!id) {
    return (
      <div className="card">
        <p className="muted">記憶が選択されていません。</p>
        <Link href="/timeline">タイムラインへ</Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p>{error}</p>
        <Link href="/timeline">タイムラインへ戻る</Link>
      </div>
    );
  }

  if (!memory) return <p className="muted">読み込み中…</p>;

  return (
    <div className="stack">
      <section className="card stack">
        <Link href="/timeline">← タイムライン</Link>
        <h1>{memory.front_matter.title}</h1>
        <div className="row">
          <span className="badge">{memory.front_matter.kind}</span>
          <span className="badge">{memory.front_matter.device}</span>
          {memory.front_matter.apps.map((app) => (
            <span key={app} className="badge">
              {app}
            </span>
          ))}
          {memory.front_matter.skill_candidate ? (
            <span className="badge ok">skill_candidate（SkillCheck へ後続）</span>
          ) : null}
        </div>
        <p className="muted">{memory.front_matter.description}</p>
      </section>
      <section className="card">
        <h2>Markdown 記憶</h2>
        <pre className="memory">{serializeMemoryMarkdown(memory)}</pre>
      </section>
    </div>
  );
}

export default function MemoryDetailPage() {
  return (
    <Suspense fallback={<p className="muted">読み込み中…</p>}>
      <MemoryDetail />
    </Suspense>
  );
}
