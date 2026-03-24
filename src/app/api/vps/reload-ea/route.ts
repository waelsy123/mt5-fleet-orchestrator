import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VpsClient } from "@/lib/vps-client";
import { readFileSync } from "fs";
import { join } from "path";

export async function POST() {
  try {
    const eaPath = join(process.cwd(), "python", "PythonBridge.mq5");
    const content = readFileSync(eaPath, "utf-8");

    const vpsList = await prisma.vps.findMany({
      where: { status: { in: ["ONLINE", "OFFLINE"] } },
    });

    const results = await Promise.allSettled(
      vpsList.map(async (vps) => {
        const client = new VpsClient({ ip: vps.ip, apiPort: vps.apiPort });
        const result = await client.updateEa(content);
        return { vpsId: vps.id, vpsName: vps.name, ...result };
      })
    );

    const summary = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { vpsId: vpsList[i].id, vpsName: vpsList[i].name, error: String(r.reason) }
    );

    const succeeded = summary.filter((s) => !("error" in s)).length;

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
