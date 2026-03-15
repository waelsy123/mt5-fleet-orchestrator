import { spawn } from "child_process";
import path from "path";
import { prisma } from "./prisma";

export async function startProvisioning(
  vpsId: string,
  ip: string,
  vncIp: string,
  vncPort: number,
  password: string
): Promise<string> {
  const scriptPath = path.resolve(process.cwd(), "python", "setup_vps.py");

  // Create the provision log entry
  const log = await prisma.provisionLog.create({
    data: { vpsId, status: "RUNNING" },
  });

  // Mark VPS as provisioning
  await prisma.vps.update({
    where: { id: vpsId },
    data: { status: "PROVISIONING" },
  });

  const child = spawn("python3", [
    "-u", // unbuffered output so logs stream in real-time
    scriptPath,
    ip,
    vncIp,
    String(vncPort),
    password,
  ]);

  let buffer = "";
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  const flushLogs = async () => {
    if (buffer.length === 0) return;
    const chunk = buffer;
    buffer = "";
    try {
      const current = await prisma.provisionLog.findUnique({
        where: { id: log.id },
        select: { logs: true },
      });
      await prisma.provisionLog.update({
        where: { id: log.id },
        data: { logs: (current?.logs ?? "") + chunk },
      });
    } catch {
      // DB write failed; re-buffer for next flush
      buffer = chunk + buffer;
    }
  };

  // Batch log writes every 2 seconds
  flushTimer = setInterval(flushLogs, 2000);

  child.stdout.on("data", (data: Buffer) => {
    buffer += data.toString();
  });

  child.stderr.on("data", (data: Buffer) => {
    buffer += data.toString();
  });

  child.on("close", async (code) => {
    if (flushTimer) clearInterval(flushTimer);
    // Final flush
    await flushLogs();

    const success = code === 0;

    try {
      await prisma.provisionLog.update({
        where: { id: log.id },
        data: {
          status: success ? "SUCCESS" : "FAILED",
          finishedAt: new Date(),
        },
      });

      await prisma.vps.update({
        where: { id: vpsId },
        data: {
          status: success ? "ONLINE" : "ERROR",
          lastError: success ? null : `Provisioning exited with code ${code}`,
        },
      });
    } catch (err) {
      console.error("Failed to update provision status:", err);
    }
  });

  child.on("error", async (err) => {
    if (flushTimer) clearInterval(flushTimer);
    buffer += `\nSpawn error: ${err.message}\n`;
    await flushLogs();

    try {
      await prisma.provisionLog.update({
        where: { id: log.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
        },
      });

      await prisma.vps.update({
        where: { id: vpsId },
        data: {
          status: "ERROR",
          lastError: `Spawn error: ${err.message}`,
        },
      });
    } catch (dbErr) {
      console.error(
        "Failed to update provision status after spawn error:",
        dbErr
      );
    }
  });

  return log.id;
}
