export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPolling, stopPolling } = await import("./lib/polling");
    const { restoreCopierFromDb, copierManager } = await import("./lib/copier");
    startPolling();
    restoreCopierFromDb();

    // Graceful shutdown: stop polling and copier sessions before exit
    const shutdown = async () => {
      console.log("[shutdown] Stopping polling and copier sessions...");
      stopPolling();
      for (const s of copierManager.statusAll()) {
        if (s.running) await copierManager.stopSession(s.id);
      }
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
