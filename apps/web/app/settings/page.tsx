"use client";

import { useEffect, useState } from "react";
import type { PermissionsConfig } from "@shift-log/schema";
import { apiFetch } from "@/lib/api";

const empty: PermissionsConfig = {
  enabled: false,
  memories_enabled: false,
  paused: false,
  apps: { mode: "exclude_listed", exclude: [], include_only: [] },
  sites: { mode: "exclude_listed", exclude: [], include_only: [] },
  private_browsing_excluded: true,
  capture_policy: {
    screenshots: false,
    screen_recording: false,
    microphone: false,
    system_audio: false,
    full_keylog: false,
  },
};

export default function SettingsPage() {
  const [config, setConfig] = useState<PermissionsConfig>(empty);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<PermissionsConfig>("/v1/permissions")
      .then(setConfig)
      .catch((e) => setStatus(String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setStatus("保存中…");
    try {
      const saved = await apiFetch<PermissionsConfig>("/v1/permissions", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      setConfig(saved);
      setStatus("保存しました");
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function seedDemo() {
    setStatus("デモデータ投入中…");
    try {
      const result = await apiFetch<{
        windows: number;
        memories: number;
      }>("/v1/demo/seed", {
        method: "POST",
        body: JSON.stringify({ enable: true }),
      });
      const saved = await apiFetch<PermissionsConfig>("/v1/permissions");
      setConfig(saved);
      setStatus(
        `デモ投入完了: windows=${result.windows}, memories=${result.memories}`,
      );
    } catch (e) {
      setStatus(String(e));
    }
  }

  async function deleteHistory(scope: string) {
    setStatus("削除中…");
    try {
      const result = await apiFetch<{
        deleted_windows: number;
        deleted_memories: number;
      }>("/v1/history/delete", {
        method: "POST",
        body: JSON.stringify({ scope }),
      });
      setStatus(
        `削除完了: windows=${result.deleted_windows}, memories=${result.deleted_memories}`,
      );
    } catch (e) {
      setStatus(String(e));
    }
  }

  if (loading) return <p className="muted">読み込み中…</p>;

  return (
    <div className="stack">
      <section className="card stack">
        <h1>設定</h1>
        <p className="muted">
          デフォルトオフ。Memories 相当がオンでないと収集しません。スクショ等は常に無効です。
        </p>

        <label>
          <span className="row">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />
            ShiftLog を有効化
          </span>
        </label>

        <label>
          <span className="row">
            <input
              type="checkbox"
              checked={config.memories_enabled}
              onChange={(e) =>
                setConfig({ ...config, memories_enabled: e.target.checked })
              }
            />
            Memories 相当を有効化（必須）
          </span>
        </label>

        <label>
          <span className="row">
            <input
              type="checkbox"
              checked={config.paused}
              onChange={(e) => setConfig({ ...config, paused: e.target.checked })}
            />
            一時停止（メニューバー / コントロールセンター相当）
          </span>
        </label>

        <div className="row">
          <span className="badge off">screenshots: off</span>
          <span className="badge off">screen_recording: off</span>
          <span className="badge off">microphone: off</span>
          <span className="badge off">system_audio: off</span>
          <span className="badge off">full_keylog: off</span>
          <span className="badge ok">private_browsing: permanently excluded</span>
        </div>

        <button type="button" onClick={save}>
          保存
        </button>
        {status ? <p className="muted">{status}</p> : null}
      </section>

      <section className="card stack">
        <h2>デモ</h2>
        <p className="muted">収集をオンにし、サンプルの十分窓と記憶を投入します。</p>
        <button type="button" onClick={() => void seedDemo()}>
          デモデータを投入
        </button>
      </section>

      <section className="card stack">
        <h2>履歴削除</h2>
        <p className="muted">消したらイベントも記憶も消えます。取り消せません。</p>
        <div className="row">
          <button type="button" className="danger" onClick={() => deleteHistory("last_10_minutes")}>
            直近十分
          </button>
          <button type="button" className="danger" onClick={() => deleteHistory("last_hour")}>
            一時間
          </button>
          <button type="button" className="danger" onClick={() => deleteHistory("last_day")}>
            一日
          </button>
          <button type="button" className="danger" onClick={() => deleteHistory("all")}>
            全部
          </button>
        </div>
      </section>
    </div>
  );
}
