"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { MemoryRecord } from "@shift-log/schema";
import { serializeMemoryMarkdown } from "@shift-log/schema";
import { apiFetch } from "@/lib/api";

export default function MemoryDetailPage() {
  const params = useParams<{ id: string }>();
  const [memory, setMemory] = useState<MemoryRecord | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!params.id) return;
    apiFetch<MemoryRecord>(`/v1/memories/${params.id}`)
      .then(setMemory)
      .catch((e) => setError(String(e)));
  }, [params.id]);

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
