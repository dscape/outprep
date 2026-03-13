export async function register() {
  // Auto-start the eval service in development
  if (process.env.NODE_ENV === "development" && process.env.NEXT_RUNTIME === "nodejs") {
    const { startEvalServiceProcess } = await import("@/lib/forge-process");
    const result = startEvalServiceProcess();
    if (result.started) {
      console.log("[forge] Eval service auto-started");
    }
    if (result.error) {
      console.error("[forge] Eval service failed to start:", result.error);
    }
  }
}
