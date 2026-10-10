import {
  isBrowserApp,
  isSensitiveApp,
  omitTitleFields,
  redactEvent,
  titleLooksPrivate,
  PermissionsConfigSchema,
  titlePolicyFor,
  type InteractionEvent,
  type PermissionsConfig,
  type WindowUpload,
} from "@shift-log/schema";

const defaultPermissions = PermissionsConfigSchema.parse({});

/**
 * Server-side trust boundary for prohibited capture.
 * Collectors also strip these, but uploads must not rely on client honesty.
 */
export function sanitizeWindowUpload(
  upload: WindowUpload,
  permissions: PermissionsConfig = defaultPermissions,
): WindowUpload {
  const events = upload.events
    .filter((event) => !isPrivateBrowsing(event))
    .map(stripProhibitedMeta)
    .map((event) => applyTitlePolicy(event, permissions))
    .map(redactEvent);

  return {
    metadata: {
      ...upload.metadata,
      event_count: events.length,
    },
    events,
  };
}

function isPrivateBrowsing(event: InteractionEvent): boolean {
  if (event.meta?.privateBrowsing === true) return true;
  const fromBrowser = event.site !== undefined || (event.app !== undefined && isBrowserApp(event.app));
  return fromBrowser && typeof event.summary === "string" && titleLooksPrivate(event.summary);
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

function applyTitlePolicy(
  event: InteractionEvent,
  permissions: PermissionsConfig,
): InteractionEvent {
  if (
    event.app &&
    (isSensitiveApp(event.app) || titlePolicyFor(permissions, event.app) === "app_only")
  ) {
    return omitTitleFields(event);
  }
  return event;
}
