import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Cache the MetaQuotes server list in memory
let cachedServers: string[] = [];
let cacheTime = 0;
const CACHE_TTL = 3600_000; // 1 hour

// Load brokers.json for installer URL matching
function loadBrokers(): Record<
  string,
  { name: string; servers: string[]; installer_url: string }
> {
  try {
    const brokersPath = path.join(process.cwd(), "python", "brokers.json");
    return JSON.parse(fs.readFileSync(brokersPath, "utf-8"));
  } catch {
    return {};
  }
}

async function fetchMt5Servers(): Promise<string[]> {
  if (cachedServers.length > 0 && Date.now() - cacheTime < CACHE_TTL) {
    return cachedServers;
  }
  try {
    const res = await fetch(
      "https://metatraderweb.app/trade/servers?version=5",
      { signal: AbortSignal.timeout(15_000) }
    );
    const data = await res.json();
    cachedServers = data.mt5 || [];
    cacheTime = Date.now();
  } catch {
    // Return stale cache or empty
  }
  return cachedServers;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") || "";
  if (q.length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 }
    );
  }

  const servers = await fetchMt5Servers();
  const qLower = q.toLowerCase();
  const matches = servers.filter((s) => s.toLowerCase().includes(qLower));

  // Build server -> installer_url lookup from brokers.json
  const brokers = loadBrokers();
  const serverToInstaller: Record<string, string> = {};
  for (const cfg of Object.values(brokers)) {
    for (const srv of cfg.servers) {
      serverToInstaller[srv] = cfg.installer_url;
    }
  }

  const results = matches.slice(0, 50).map((s) => ({
    server: s,
    installer_url: serverToInstaller[s] || "",
  }));

  return NextResponse.json({ query: q, total: matches.length, results });
}
