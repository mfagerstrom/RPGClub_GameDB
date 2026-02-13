type RawModalLogLevel = "info" | "warn" | "error";

type RawModalLogMeta = {
  sessionId?: string;
  feature?: string;
  flow?: string;
  userId?: string;
  customId?: string;
  reason?: string;
  error?: unknown;
};

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatMeta(meta: RawModalLogMeta): string {
  const parts: string[] = [];
  if (meta.sessionId) parts.push(`session=${meta.sessionId}`);
  if (meta.feature) parts.push(`feature=${meta.feature}`);
  if (meta.flow) parts.push(`flow=${meta.flow}`);
  if (meta.userId) parts.push(`user=${meta.userId}`);
  if (meta.customId) parts.push(`customId=${meta.customId}`);
  if (meta.reason) parts.push(`reason=${meta.reason}`);
  if (meta.error) parts.push(`error=${stringifyError(meta.error)}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export function logRawModal(
  level: RawModalLogLevel,
  event: string,
  meta: RawModalLogMeta = {},
): void {
  const line = `[RawModal] ${event}${formatMeta(meta)}`;

  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
