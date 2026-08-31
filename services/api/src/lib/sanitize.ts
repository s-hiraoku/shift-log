import type { InteractionEvent, WindowUpload } from "@shift-log/schema";

/**
 * Server-side trust boundary for prohibited capture.
 * Collectors also strip these, but uploads must not rely on client honesty.
 */
export function sanitizeWindowUpload(upload: WindowUpload): WindowUpload {
  const events = upload.events
    .filter((event) => !isPrivateBrowsing(event))
    .map(stripProhibitedMeta);

  return {
    metadata: {
      ...upload.metadata,
      event_count: events.length,
    },
    events,
  };
}

function isPrivateBrowsing(event: InteractionEvent): boolean {
  return event.meta?.privateBrowsing === true;
}

function stripProhibitedMeta(event: InteractionEvent): InteractionEvent {
  if (!event.meta || typeof event.meta.keyText !== "string") {
    return event;
  }
  const { keyText: _removed, ...rest } = event.meta;
  return {
    ...event,
    meta: Object.keys(rest).length > 0 ? rest : undefined,
  };
}
