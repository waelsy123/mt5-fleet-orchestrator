export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPolling } = await import("./lib/polling");
    const { restoreCopierFromDb } = await import("./lib/copier");
    startPolling();
    restoreCopierFromDb();
  }
}
