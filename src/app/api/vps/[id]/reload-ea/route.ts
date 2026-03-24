import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { spawn } from "child_process";
import { join } from "path";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const vps = await prisma.vps.findUniqueOrThrow({ where: { id } });
    const password = decrypt(vps.password);

    const scriptPath = join(process.cwd(), "python", "update_agent.py");
    const env = { ...process.env };

    const output = await new Promise<string>((resolve, reject) => {
      const logs: string[] = [];
      const child = spawn("python3", ["-u", scriptPath, vps.ip, password], { env });

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

    return NextResponse.json({
      vpsId: id,
      vpsName: vps.name,
      status: "ok",
      output,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
