export const PERMISSIONS_RETRY_LABEL = "再読み込み";

export function permissionsLoadPhase(
  config: unknown,
  loadError: string,
): "loading" | "error" | "form" {
  if (loadError) return "error";
  if (!config) return "loading";
  return "form";
}
