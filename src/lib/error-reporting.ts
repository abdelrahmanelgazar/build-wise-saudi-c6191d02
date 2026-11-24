export type ErrorContext = Record<string, unknown>;

export function reportRuntimeError(error: unknown, context: ErrorContext = {}) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown runtime error";
  const stack = error instanceof Error ? error.stack : undefined;

  console.error("[Taqdiri Runtime Error]", {
    message,
    stack,
    context,
    timestamp: new Date().toISOString(),
  });
}
