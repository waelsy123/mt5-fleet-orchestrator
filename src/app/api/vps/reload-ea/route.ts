import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { spawn } from "child_process";
import { join } from "path";

function runUpdate(ip: string, password: string): Promise<string> {
  const scriptPath = join(process.cwd(), "python", "update_agent.py");
  const env = { ...process.env };

  return new Promise((resolve, reject) => {
    const logs: string[] = [];
    const child = spawn("python3", ["-u", scriptPath, ip, password], { env });

    child.stdout.on("data", (data) => logs.push(data.toString()));
    child.stderr.on("data", (data) => logs.push(data.toString()));

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Timeout after 3 minutes"));
    }, 180_000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(logs.join(""));
      else reject(new Error(`Exit code ${code}: ${logs.join("")}`));
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function POST() {
  try {
    const vpsList = await prisma.vps.findMany({
      where: { status: { in: ["ONLINE", "OFFLINE"] } },
    });

    const results = await Promise.allSettled(
      vpsList.map(async (vps) => {
        const password = decrypt(vps.password);
        const output = await runUpdate(vps.ip, password);
        return { vpsId: vps.id, vpsName: vps.name, status: "ok", output };
      })
    );

    const summary = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { vpsId: vpsList[i].id, vpsName: vpsList[i].name, status: "error", error: String(r.reason) }
    );

    const succeeded = summary.filter((s) => s.status === "ok").length;

    return NextResponse.json({
      total: vpsList.length,
      succeeded,
      failed: vpsList.length - succeeded,
      results: summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
