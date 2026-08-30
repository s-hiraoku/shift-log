import type {
  DeleteScope,
  InteractionEvent,
  MemoryRecord,
  PermissionsConfig,
  WindowMetadata,
  WindowUpload,
} from "@shift-log/schema";
import { PermissionsConfigSchema, RAW_EVENT_RETENTION_HOURS } from "@shift-log/schema";

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
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "all":
      return null;
  }
}

/**
 * In-memory store for v1 / local & serverless demos.
 * Replace with durable storage (e.g. Neon/Blob) for production.
 */
export class MemoryStore {
  windows = new Map<string, StoredWindow>();
  memories = new Map<string, MemoryRecord>();
  permissions: PermissionsConfig = PermissionsConfigSchema.parse({});

  reset(): void {
    this.windows.clear();
    this.memories.clear();
    this.permissions = PermissionsConfigSchema.parse({});
  }

  putWindow(upload: WindowUpload): StoredWindow {
    const stored: StoredWindow = {
      metadata: upload.metadata,
      events: upload.events,
      uploaded_at: new Date().toISOString(),
    };
    this.windows.set(upload.metadata.window_id, stored);
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
  }

  /** Discard raw events older than 48h. Markdown memories are kept. */
  purgeExpiredRawEvents(now = new Date()): number {
    const cutoff = hoursAgo(RAW_EVENT_RETENTION_HOURS, now);
    let removed = 0;
    for (const [id, w] of this.windows) {
      if (new Date(w.uploaded_at) < cutoff) {
        this.windows.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Clearing history deletes matching interaction events AND memories.
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
      const start = new Date(w.metadata.window_start);
      if (cutoff === null || start >= cutoff) {
        this.windows.delete(id);
        deleted_windows += 1;
      }
    }

    for (const [id, m] of this.memories) {
      const start = new Date(m.front_matter.window_start);
      if (cutoff === null || start >= cutoff) {
        this.memories.delete(id);
        deleted_memories += 1;
      }
    }

    return { deleted_windows, deleted_memories };
  }
}

export const store = new MemoryStore();
