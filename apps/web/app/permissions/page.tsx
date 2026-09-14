"use client";

import { useEffect, useState } from "react";
import type { PermissionsConfig } from "@shift-log/schema";
import { apiFetch } from "@/lib/api";

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function PermissionsPage() {
  const [config, setConfig] = useState<PermissionsConfig | null>(null);
  const [appsExclude, setAppsExclude] = useState("");
  const [appsInclude, setAppsInclude] = useState("");
  const [appsTitleOnly, setAppsTitleOnly] = useState("");
  const [sitesExclude, setSitesExclude] = useState("");
  const [sitesInclude, setSitesInclude] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    apiFetch<PermissionsConfig>("/v1/permissions").then((c) => {
      setConfig(c);
      setAppsExclude(c.apps.exclude.join("\n"));
      setAppsInclude(c.apps.include_only.join("\n"));
      setAppsTitleOnly(
        Object.entries(c.title_policy)
          .filter(([, policy]) => policy === "app_only")
          .map(([name]) => name)
          .join("\n"),
      );
      setSitesExclude(c.sites.exclude.join("\n"));
      setSitesInclude(c.sites.include_only.join("\n"));
    });
  }, []);

  async function save() {
    if (!config) return;
    const title_policy: PermissionsConfig["title_policy"] = {};
    for (const name of splitLines(appsTitleOnly)) {
      title_policy[name] = "app_only";
    }
    const next: PermissionsConfig = {
      ...config,
      apps: {
        ...config.apps,
        exclude: splitLines(appsExclude),
        include_only: splitLines(appsInclude),
      },
      sites: {
        ...config.sites,
        exclude: splitLines(sitesExclude),
        include_only: splitLines(sitesInclude),
      },
      title_policy,
    };
    const saved = await apiFetch<PermissionsConfig>("/v1/permissions", {
      method: "PUT",
      body: JSON.stringify(next),
    });
    setConfig(saved);
    setStatus("許可リストを保存しました");
  }

  if (!config) return <p className="muted">読み込み中…</p>;

  return (
    <div className="stack">
      <section className="card stack">
        <h1>許可リスト</h1>
        <p className="muted">
          アプリ単位・サイト単位。除外、タイトル非記録、通常記録の3段階。プライベートブラウズは永久除外。
        </p>

        <label>
          アプリモード
          <select
            value={config.apps.mode}
            onChange={(e) =>
              setConfig({
                ...config,
                apps: {
                  ...config.apps,
                  mode: e.target.value as PermissionsConfig["apps"]["mode"],
                },
              })
            }
          >
            <option value="exclude_listed">Exclude listed（除外以外を許可）</option>
            <option value="include_only">Include only（明示したアプリのみ）</option>
          </select>
        </label>

        <label>
          除外アプリ（1行1件）
          <textarea rows={4} value={appsExclude} onChange={(e) => setAppsExclude(e.target.value)} />
        </label>
        <label>
          許可のみアプリ（include_only 時）
          <textarea rows={4} value={appsInclude} onChange={(e) => setAppsInclude(e.target.value)} />
        </label>
        <label>
          タイトル非記録アプリ（1行1件）
          <textarea
            rows={4}
            value={appsTitleOnly}
            onChange={(e) => setAppsTitleOnly(e.target.value)}
          />
        </label>
        <p className="muted">
          タイトル非記録のアプリは滞在時間だけ残します。チャンネル名や DM 相手はサーバに送りません。
        </p>

        <label>
          サイトモード
          <select
            value={config.sites.mode}
            onChange={(e) =>
              setConfig({
                ...config,
                sites: {
                  ...config.sites,
                  mode: e.target.value as PermissionsConfig["sites"]["mode"],
                },
              })
            }
          >
            <option value="exclude_listed">Exclude listed</option>
            <option value="include_only">Include only</option>
          </select>
        </label>
        <label>
          除外サイト
          <textarea rows={4} value={sitesExclude} onChange={(e) => setSitesExclude(e.target.value)} />
        </label>
        <label>
          許可のみサイト
          <textarea rows={4} value={sitesInclude} onChange={(e) => setSitesInclude(e.target.value)} />
        </label>

        <button type="button" onClick={save}>
          保存
        </button>
        {status ? <p className="muted">{status}</p> : null}
      </section>
    </div>
  );
}
