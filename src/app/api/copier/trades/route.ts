import { NextRequest, NextResponse } from "next/server";
import { copierManager } from "@/lib/copier";
import { VpsClient } from "@/lib/vps-client";
import { prisma } from "@/lib/prisma";

const clientCache = new Map<string, VpsClient>();

async function getClient(vpsId: string): Promise<VpsClient> {
  const cached = clientCache.get(vpsId);
  if (cached) return cached;
  const vps = await prisma.vps.findUniqueOrThrow({ where: { id: vpsId } });
  const client = new VpsClient({ ip: vps.ip, apiPort: vps.apiPort });
  clientCache.set(vpsId, client);
  return client;
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    }

    const session = copierManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const status = session.status();
    if (!status.source) {
      return NextResponse.json({ error: "Session has no source" }, { status: 400 });
    }

    const mirrors = session.getMirrors();
    const sourcePositionData = session.getSourcePositionData();

    // Fetch source positions
    const sourceClient = await getClient(status.source.vpsId);
    let sourcePositions: {
      pos: string; symbol: string; type: string; volume: string;
      price: string; profit: string; sl: string; tp: string; comment: string;
    }[] = [];

    try {
      const result = await sourceClient.getPositions(status.source.server, status.source.login);
      sourcePositions = (result.positions ?? []).map((p) => ({
        pos: String(p.pos),
        symbol: String(p.symbol),
        type: String(p.type),
        volume: String(p.volume),
        price: String(p.price),
        profit: String(p.profit),
        sl: String(p.sl),
        tp: String(p.tp),
        comment: String(p.comment ?? ""),
      }));
    } catch {
      // Source offline
    }

    // Fetch all target positions in parallel
    const targetPositions: Record<string, {
      pos: string; symbol: string; type: string; volume: string;
      price: string; profit: string; comment: string;
    }[]> = {};

    await Promise.allSettled(
      status.targets.map(async (t) => {
        try {
          const client = await getClient(t.vpsId);
          const result = await client.getPositions(t.server, t.login);
          targetPositions[t.key] = (result.positions ?? []).map((p) => ({
            pos: String(p.pos),
            symbol: String(p.symbol),
            type: String(p.type),
            volume: String(p.volume),
            price: String(p.price),
            profit: String(p.profit),
            comment: String(p.comment ?? ""),
          }));
        } catch {
          targetPositions[t.key] = [];
        }
      })
    );

    // Build the trade tree: for each source position, find matching target positions
    interface TargetTrade {
      targetKey: string;
      login: string;
      server: string;
      mode: string;
      volumeMult: number;
      position: {
        ticket: string; symbol: string; type: string; volume: string;
        price: string; profit: string;
      } | null;
      mirrorStatus: string;
      mirrorError?: string;
    }

    interface MasterTrade {
      ticket: string;
      symbol: string;
      type: string;
      volume: string;
      price: string;
      profit: string;
      targets: TargetTrade[];
    }

    const trades: MasterTrade[] = [];

    for (const srcPos of sourcePositions) {
      const ticket = srcPos.pos;

      // Check if this is a tracked position (not pre-existing)
      if (!(ticket in sourcePositionData)) continue;

      const targetTrades: TargetTrade[] = [];

      for (const t of status.targets) {
        const targetMirrors = mirrors[t.key] ?? {};
        const mirror = targetMirrors[ticket];
        const tPositions = targetPositions[t.key] ?? [];

        // Find matching position on target by copy_* comment
        const matchedPos = tPositions.find((p) => p.comment === `copy_${ticket}`);

        targetTrades.push({
          targetKey: t.key,
          login: t.login,
          server: t.server,
          mode: t.mode,
          volumeMult: t.volumeMult,
          position: matchedPos ? {
            ticket: matchedPos.pos,
            symbol: matchedPos.symbol,
            type: matchedPos.type,
            volume: matchedPos.volume,
            price: matchedPos.price,
            profit: matchedPos.profit,
          } : null,
          mirrorStatus: mirror?.status ?? "unknown",
          mirrorError: mirror?.error,
        });
      }

      trades.push({
        ticket,
        symbol: srcPos.symbol,
        type: srcPos.type,
        volume: srcPos.volume,
        price: srcPos.price,
        profit: srcPos.profit,
        targets: targetTrades,
      });
    }

    return NextResponse.json({
      sessionId,
      source: {
        login: status.source.login,
        server: status.source.server,
        vpsId: status.source.vpsId,
      },
      targets: status.targets.map((t) => ({
        key: t.key,
        login: t.login,
        server: t.server,
        mode: t.mode,
        volumeMult: t.volumeMult,
      })),
      trades,
      totalSourcePositions: sourcePositions.length,
      trackedPositions: Object.keys(sourcePositionData).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
