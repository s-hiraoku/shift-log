import type {
  DeleteScope,
  InteractionEvent,
  MemoryRecord,
  PermissionsConfig,
  WindowMetadata,
  WindowUpload,
} from "@shift-log/schema";
import { PermissionsConfigSchema, RAW_EVENT_RETENTION_HOURS } from "@shift-log/schema";
import {
  isPersistEnabled,
  isPostgresUrl,
  listPersistedUserIdsSync,
  loadTenantSync,
  saveTenantSync,
  type TenantSnapshot,
} from "./persist.js";

export type StoredWindow = {
  metadata: WindowMetadata;
  events: InteractionEvent[];
  uploaded_at: string;
};

function hoursAgo(hours: number, from = new Date()): Date {
  return new Date(from.getTime() - hours * 60 * 60 * 1000);
}

function scopeCutoff(scope: DeleteScope, now = new Date()): Date | null {
  switch (scope) {
    case "last_10_minutes":
      return new Date(now.getTime() - 10 * 60 * 1000);
    case "last_hour":
      return new Date(now.getTime() - 60 * 60 * 1000);
    case "last_day":
      return new Date(now.getTime() - 24 * 60 * 1000);
    case "all":
      return null;
  }
}

/** Interval [start, end] overlaps [cutoff, now] when end >= cutoff. */
function overlapsCutoff(
  windowStart: string,
  windowEnd: string,
  cutoff: Date | null,
): boolean {
  if (cutoff === null) return true;
  void windowStart;
  return new Date(windowEnd) >= cutoff;
}

/** Raw retention is based on capture time (window_end), not upload time. */
export function isRawWindowExpired(
  metadata: Pick<WindowMetadata, "window_end">,
  now = new Date(),
): boolean {
  return new Date(metadata.window_end) < hoursAgo(RAW_EVENT_RETENTION_HOURS, now);
}

/**
 * Per-user store. Durable backend is SQLite (SHIFTLOG_DATA_DIR/shiftlog.db)
 * or Postgres (DATABASE_URL). Tests stay in-memory (VITEST / SHIFTLOG_PERSIST=0).
 */
export class MemoryStore {
  windows = new Map<string, StoredWindow>();
  memories = new Map<string, MemoryRecord>();
  permissions: PermissionsConfig = PermissionsConfigSchema.parse({});
  private hydrated = false;

  constructor(readonly userId = "default") {
    if (isPersistEnabled() && !isPostgresUrl()) {
      this.hydrate(loadTenantSync(userId));
    }
  }

  hydrate(snapshot: TenantSnapshot): void {
    this.permissions = snapshot.permissions;
    this.windows = new Map(snapshot.windows.map((w) => [w.metadata.window_id, w]));
    this.memories = new Map(snapshot.memories.map((m) => [m.id, m]));
    this.purgeExpiredRawEvents();
    this.hydrated = true;
  }

  private snapshot(): TenantSnapshot {
    return {
      permissions: this.permissions,
      windows: [...this.windows.values()],
      memories: [...this.memories.values()],
    };
  }

  persist(): void {
    if (!isPersistEnabled()) return;
    saveTenantSync(this.userId, this.snapshot());
  }

  reset(): void {
    this.windows.clear();
    this.memories.clear();
    this.permissions = PermissionsConfigSchema.parse({});
    this.persist();
  }

  putWindow(upload: WindowUpload, now = new Date()): StoredWindow | null {
    if (isRawWindowExpired(upload.metadata, now)) {
      return null;
    }
    const stored: StoredWindow = {
      metadata: upload.metadata,
      events: upload.events,
      uploaded_at: now.toISOString(),
    };
    this.windows.set(upload.metadata.window_id, stored);
    this.persist();
    return stored;
  }

  listMemories(opts: { q?: string; limit: number }): MemoryRecord[] {
    let items = [...this.memories.values()].sort((a, b) =>
      b.front_matter.window_start.localeCompare(a.front_matter.window_start),
    );
    if (opts.q) {
      const q = opts.q.toLowerCase();
      items = items.filter((m) => {
        const hay = [
          m.front_matter.title,
          m.front_matter.description,
          m.body,
          ...m.front_matter.apps,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return items.slice(0, opts.limit);
  }

  getMemory(id: string): MemoryRecord | undefined {
    return this.memories.get(id);
  }

  putMemory(record: MemoryRecord): void {
    this.memories.set(record.id, record);
    this.persist();
  }

  /** Discard raw events whose capture window ended more than 48h ago. */
  purgeExpiredRawEvents(now = new Date()): number {
    let removed = 0;
    for (const [id, w] of this.windows) {
      if (isRawWindowExpired(w.metadata, now)) {
        this.windows.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.persist();
    return removed;
  }

  /**
   * Clearing history deletes matching interaction events AND memories.
   * Match any interval that overlaps the selected period (window_end >= cutoff).
   * This cannot be undone (matches Computer History semantics).
   */
  deleteByScope(scope: DeleteScope, now = new Date()): {
    deleted_windows: number;
    deleted_memories: number;
  } {
    const cutoff = scopeCutoff(scope, now);
    let deleted_windows = 0;
    let deleted_memories = 0;

    for (const [id, w] of this.windows) {
      if (
        overlapsCutoff(w.metadata.window_start, w.metadata.window_end, cutoff)
      ) {
        this.windows.delete(id);
        deleted_windows += 1;
      }
    }

    for (const [id, m] of this.memories) {
      if (
        overlapsCutoff(
          m.front_matter.window_start,
          m.front_matter.window_end,
          cutoff,
        )
      ) {
        this.memories.delete(id);
        deleted_memories += 1;
      }
    }

    this.persist();
    return { deleted_windows, deleted_memories };
  }

  /** Replace permissions and persist. */
  setPermissions(next: PermissionsConfig): void {
    this.permissions = next;
    this.persist();
  }
}

const cache = new Map<string, MemoryStore>();

export function storeFor(userId: string): MemoryStore {
  let existing = cache.get(userId);
  if (!existing) {
    existing = new MemoryStore(userId);
    cache.set(userId, existing);
  }
  return existing;
}

/** Default tenant — used by tests and single-token setups. */
export const store = storeFor("default");

export function resetStoreCache(): void {
  cache.clear();
}

/** Sweep every persisted tenant (sqlite / json). Postgres tenants are purged on request. */
export function purgeAllTenants(now = new Date()): number {
  let removed = 0;
  const ids = new Set<string>(["default", ...listPersistedUserIdsSync(), ...cache.keys()]);
  for (const id of ids) {
    removed += storeFor(id).purgeExpiredRawEvents(now);
  }
  return removed;
}
