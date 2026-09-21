/**
 * Plain-stdout/stderr logging so `docker logs` / Portainer's log viewer
 * actually shows what the book-search and series-detection pipeline is
 * doing — which provider was hit, how long it took, how many results
 * came back, whether a timeout/grace-period dropped something, and why
 * a series link did or didn't get made. One line per event, human-
 * scannable, with structured data appended as compact JSON.
 */
type Level = "info" | "warn" | "error";

function emit(level: Level, scope: string, message: string, data?: Record<string, unknown>) {
  const prefix = `[${new Date().toISOString()}] [${scope}]`;
  const suffix = data && Object.keys(data).length ? ` ${JSON.stringify(data)}` : "";
  const line = `${prefix} ${message}${suffix}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (scope: string, message: string, data?: Record<string, unknown>) =>
    emit("info", scope, message, data),
  warn: (scope: string, message: string, data?: Record<string, unknown>) =>
    emit("warn", scope, message, data),
  error: (scope: string, message: string, data?: Record<string, unknown>) =>
    emit("error", scope, message, data),
};
