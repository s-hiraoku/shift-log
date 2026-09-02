"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MemoryRecord } from "@shift-log/schema";
import { apiFetch } from "@/lib/api";

export default function TimelinePage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [error, setError] = useState("");

  async function load(query = q) {
    try {
      const path = query
        ? `/v1/search?q=${encodeURIComponent(query)}`
        : "/v1/timeline";
      const data = await apiFetch<{ items: MemoryRecord[] }>(path);
      setItems(data.items);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack">
      <section className="card stack">
        <h1>タイムライン</h1>
        <div className="row">
          <input
            placeholder="検索（タイトル・本文・アプリ）"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
          />
          <button type="button" onClick={() => load()}>
            検索
          </button>
        </div>
        {error ? <p className="muted">{error}</p> : null}
      </section>

      <section className="card">
        <ul className="clean">
          {items.length === 0 ? (
            <li className="muted">まだ記憶がありません。収集を有効化して窓をアップロードしてください。</li>
          ) : (
            items.map((m) => (
              <li key={m.id}>
                <div className="row">
                  <Link href={`/memories?id=${encodeURIComponent(m.id)}`}>
                    <strong>{m.front_matter.title}</strong>
                  </Link>
                  <span className="badge">{m.front_matter.kind}</span>
                  <span className="badge">{m.front_matter.device}</span>
                  {m.front_matter.skill_candidate ? (
                    <span className="badge ok">skill_candidate</span>
                  ) : null}
                </div>
                <p className="muted">{m.front_matter.description}</p>
                <p className="muted">
                  {m.front_matter.window_start} → {m.front_matter.window_end}
                </p>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
