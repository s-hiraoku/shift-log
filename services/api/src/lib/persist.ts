import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
import type { MemoryRecord, PermissionsConfig } from "@shift-log/schema";
import { PermissionsConfigSchema } from "@shift-log/schema";
import type { StoredWindow } from "./store.js";

export type TenantSnapshot = {
  permissions: PermissionsConfig;
  windows: StoredWindow[];
  memories: MemoryRecord[];
};

export function isPersistEnabled(): boolean {
  if (process.env.VITEST) return false;
  if (process.env.SHIFTLOG_PERSIST === "0") return false;
  return Boolean(process.env.DATABASE_URL || process.env.SHIFTLOG_DATA_DIR);
}

export function isPostgresUrl(url = process.env.DATABASE_URL ?? ""): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

export function emptySnapshot(): TenantSnapshot {
  return {
    permissions: PermissionsConfigSchema.parse({}),
    windows: [],
    memories: [],
  };
}

export function parseSnapshot(raw: unknown): TenantSnapshot {
  const data = (raw ?? {}) as Partial<TenantSnapshot>;
  return {
    permissions: PermissionsConfigSchema.parse(data.permissions ?? {}),
    windows: Array.isArray(data.windows) ? data.windows : [],
    memories: Array.isArray(data.memories) ? data.memories : [],
  };
}

const DDL = `CREATE TABLE IF NOT EXISTS tenants (
  user_id TEXT PRIMARY KEY,
  snapshot TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

type SqliteDb = InstanceType<(typeof import("node:sqlite"))["DatabaseSync"]>;

class SqliteBackend {
  private db: SqliteDb;

  constructor(file: string) {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(DDL);
    this.migrateLegacyJson(file);
  }

  private migrateLegacyJson(dbFile: string): void {
    const legacy = path.join(path.dirname(dbFile), "store.json");
    if (!existsSync(legacy)) return;
    if (this.load("default")) return;
    try {
      const raw = JSON.parse(readFileSync(legacy, "utf8"));
      this.save("default", parseSnapshot(raw));
      renameSync(legacy, `${legacy}.migrated`);
      console.log("[persist] migrated store.json → sqlite tenant 'default'");
    } catch (err) {
      console.error("[persist] legacy store.json migration failed:", err);
    }
  }

  load(userId: string): TenantSnapshot | null {
    const row = this.db
      .prepare("SELECT snapshot FROM tenants WHERE user_id = ?")
      .get(userId) as { snapshot: string } | undefined;
    if (!row) return null;
    return parseSnapshot(JSON.parse(row.snapshot));
  }

  save(userId: string, snapshot: TenantSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO tenants(user_id, snapshot, updated_at) VALUES(?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
      )
      .run(userId, JSON.stringify(snapshot), new Date().toISOString());
  }

  listUserIds(): string[] {
    const rows = this.db.prepare("SELECT user_id FROM tenants").all() as {
      user_id: string;
    }[];
    return rows.map((r) => r.user_id);
  }
}

class PostgresBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pool: any;
  private ready: Promise<void>;

  constructor(url: string) {
    const { Pool } = require("pg") as typeof import("pg");
    this.pool = new Pool({ connectionString: url });
    this.ready = this.pool.query(DDL).then(() => undefined);
  }

  async load(userId: string): Promise<TenantSnapshot | null> {
    await this.ready;
    const res = await this.pool.query("SELECT snapshot FROM tenants WHERE user_id = $1", [
      userId,
    ]);
    if (!res.rows[0]) return null;
    return parseSnapshot(JSON.parse(res.rows[0].snapshot as string));
  }

  async save(userId: string, snapshot: TenantSnapshot): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO tenants(user_id, snapshot, updated_at) VALUES($1, $2, $3)
       ON CONFLICT(user_id) DO UPDATE SET snapshot = excluded.snapshot, updated_at = excluded.updated_at`,
      [userId, JSON.stringify(snapshot), new Date().toISOString()],
    );
  }

  async listUserIds(): Promise<string[]> {
    await this.ready;
    const res = await this.pool.query("SELECT user_id FROM tenants");
    return res.rows.map((r: { user_id: string }) => r.user_id);
  }
}

class JsonFileBackend {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(userId: string): string {
    const safe = userId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.dir, `tenant-${safe}.json`);
  }

  load(userId: string): TenantSnapshot | null {
    const file = this.file(userId);
    const legacy = path.join(this.dir, "store.json");
    const target =
      existsSync(file) ? file : userId === "default" && existsSync(legacy) ? legacy : null;
    if (!target) return null;
    return parseSnapshot(JSON.parse(readFileSync(target, "utf8")));
  }

  save(userId: string, snapshot: TenantSnapshot): void {
    writeFileSync(this.file(userId), JSON.stringify(snapshot, null, 2), "utf8");
  }

  listUserIds(): string[] {
    return [];
  }
}

type SyncBackend = SqliteBackend | JsonFileBackend;
type Backend = SyncBackend | PostgresBackend;

let cached: Backend | null | undefined;

function openBackend(): Backend | null {
  if (!isPersistEnabled()) return null;
  if (cached !== undefined) return cached;
  if (isPostgresUrl()) {
    cached = new PostgresBackend(process.env.DATABASE_URL!);
    return cached;
  }
  const dir = process.env.SHIFTLOG_DATA_DIR ?? path.resolve("data");
  try {
    cached = new SqliteBackend(path.join(dir, "shiftlog.db"));
    return cached;
  } catch (err) {
    console.warn("[persist] sqlite unavailable, falling back to JSON files:", err);
    cached = new JsonFileBackend(dir);
    return cached;
  }
}

export function resetPersistCache(): void {
  cached = undefined;
}

export function loadTenantSync(userId: string): TenantSnapshot {
  const backend = openBackend();
  if (!backend || backend instanceof PostgresBackend) return emptySnapshot();
  return backend.load(userId) ?? emptySnapshot();
}

export function saveTenantSync(userId: string, snapshot: TenantSnapshot): void {
  const backend = openBackend();
  if (!backend) return;
  if (backend instanceof PostgresBackend) {
    void backend.save(userId, snapshot).catch((err) => {
      console.error("[persist] postgres save failed:", err);
    });
    return;
  }
  backend.save(userId, snapshot);
}

export async function loadTenantAsync(userId: string): Promise<TenantSnapshot> {
  const backend = openBackend();
  if (!backend) return emptySnapshot();
  if (backend instanceof PostgresBackend) {
    return (await backend.load(userId)) ?? emptySnapshot();
  }
  return backend.load(userId) ?? emptySnapshot();
}

export async function saveTenantAsync(
  userId: string,
  snapshot: TenantSnapshot,
): Promise<void> {
  const backend = openBackend();
  if (!backend) return;
  if (backend instanceof PostgresBackend) {
    await backend.save(userId, snapshot);
    return;
  }
  backend.save(userId, snapshot);
}

export function listPersistedUserIdsSync(): string[] {
  const backend = openBackend();
  if (!backend || backend instanceof PostgresBackend) return [];
  return backend.listUserIds();
}

export async function listPersistedUserIdsAsync(): Promise<string[]> {
  const backend = openBackend();
  if (!backend) return [];
  if (backend instanceof PostgresBackend) return backend.listUserIds();
  return backend.listUserIds();
}
