import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { VpsClient } from "@/lib/vps-client";

export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ vpsId: string; server: string; login: string }> }
) {
  try {
    const { vpsId, server, login } = await params;
    const daysParam = request.nextUrl.searchParams.get("days");
    const days = Math.min(Math.max(parseInt(daysParam || "30", 10) || 30, 1), 90);

    const vps = await prisma.vps.findUniqueOrThrow({ where: { id: vpsId } });
    const client = new VpsClient({ ip: vps.ip, apiPort: vps.apiPort });
    const result = (await client.getDeals(server, login, days)) as {
      status: string;
      count?: string;
      positions?: Array<Record<string, string>>;
      [key: string]: unknown;
    };

    if (result.status !== "OK") {
      return NextResponse.json({ error: result }, { status: 502 });
    }

    // Parse the pipe-delimited deals from the raw response
    const raw = (result as Record<string, string>).raw || "";
    const parts = raw.split("|").slice(1); // skip "OK"
    const deals: Record<string, string>[] = [];

    for (const part of parts) {
      if (part.includes(";") && part.includes("=")) {
        const deal: Record<string, string> = {};
        for (const kv of part.split(";")) {
          const eq = kv.indexOf("=");
          if (eq > 0) deal[kv.slice(0, eq)] = kv.slice(eq + 1);
        }
        if (deal.deal) deals.push(deal);
      }
    }

    const normalized = deals.map((d) => ({
      deal: Number(d.deal),
      order: Number(d.order),
      symbol: d.symbol || "",
      type: d.type || "",
      entry: d.entry || "",
      volume: Number(d.volume || 0),
      price: Number(d.price || 0),
      profit: Number(d.profit || 0),
      swap: Number(d.swap || 0),
      commission: Number(d.commission || 0),
      comment: d.comment || "",
      time: Number(d.time || 0),
      positionId: Number(d.position || 0),
    }));

    return NextResponse.json({
      count: normalized.length,
      deals: normalized,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
