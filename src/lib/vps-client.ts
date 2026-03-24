import type {
  AddAccountRequest,
  CopierStartRequest,
  TradeRequest,
  VpsAccountInfo,
  VpsDashboardAccount,
  VpsDashboardData,
  VpsPositions,
  VpsSymbolInfo,
  VpsSystemStats,
} from "./types";

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRIES = 2; // 3 total attempts
const RETRY_BASE_MS = 1000; // 1s, 2s backoff

export class VpsClient {
  private baseUrl: string;

  constructor({ ip, apiPort }: { ip: string; apiPort: number }) {
    this.baseUrl = `http://${ip}:${apiPort}`;
  }

  private async request<T = unknown>(
    path: string,
    options: RequestInit = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    retries: number = DEFAULT_RETRIES
  ): Promise<T> {
    let lastError: unknown;
    const apiKey = process.env.VPS_API_KEY;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          ...options,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { "X-Api-Key": apiKey } : {}),
            ...options.headers,
          },
        });

        clearTimeout(timer);

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        return (await res.json()) as T;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;

        // Don't retry on HTTP errors (4xx/5xx) — only on network/timeout errors
        if (err instanceof Error && err.message.startsWith("HTTP ")) throw err;

        // Don't retry on the last attempt
        if (attempt < retries) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }

  async ping(): Promise<boolean> {
    try {
      await this.request("/accounts");
      return true;
    } catch {
      return false;
    }
  }

  async getDashboardData(): Promise<VpsDashboardData> {
    // The VPS API returns { "server/login": { account_id, login, server, info, positions } }
    // Transform into our normalized format
    const raw = await this.request<
      Record<
        string,
        {
          account_id: string;
          login: string;
          server: string;
          connected?: boolean;
          info: Record<string, string>;
          positions: { status: string; positions?: unknown[] };
        }
      >
    >("/dashboard/data", {}, 60_000, 0); // no retries — slow EA call

    const accounts: VpsDashboardAccount[] = Object.values(raw).map((acct) => ({
      login: acct.login,
      server: acct.server,
      broker: "",
      connected: acct.connected ?? (acct.info?.status === "OK" || acct.positions?.status === "OK"),
      balance: parseFloat(acct.info?.balance || "0"),
      equity: parseFloat(acct.info?.equity || "0"),
      free_margin: parseFloat(acct.info?.free_margin || "0"),
      profit:
        parseFloat(acct.info?.equity || "0") -
        parseFloat(acct.info?.balance || "0"),
      positions: acct.positions?.positions?.length ?? 0,
    }));

    return { status: "ok", accounts };
  }

  async getAccounts(): Promise<
    Record<string, { account_id: string; login: string; server: string; install_dir: string; files_dir: string }>
  > {
    return this.request("/accounts");
  }

  async addAccount(req: AddAccountRequest): Promise<unknown> {
    return this.request("/accounts/add", {
      method: "POST",
      body: JSON.stringify(req),
    }, 300_000, 0); // 5 min — downloads + installs MT5, no retries
  }

  async removeAccount(login: string): Promise<unknown> {
    return this.request(`/accounts/${login}`, {
      method: "DELETE",
    });
  }

  async getAccountInfo(
    server: string,
    login: string,
    symbol?: string
  ): Promise<VpsAccountInfo> {
    const params = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
    return this.request<VpsAccountInfo>(
      `/accounts/${encodeURIComponent(server)}/${login}/info${params}`
    );
  }

  async getPositions(server: string, login: string): Promise<VpsPositions> {
    return this.request<VpsPositions>(
      `/accounts/${encodeURIComponent(server)}/${login}/positions`
    );
  }

  async buy(
    server: string,
    login: string,
    trade: TradeRequest
  ): Promise<unknown> {
    // No retries — retrying a trade could open duplicate positions
    return this.request(
      `/accounts/${encodeURIComponent(server)}/${login}/buy`,
      { method: "POST", body: JSON.stringify(trade) },
      DEFAULT_TIMEOUT_MS, 0
    );
  }

  async sell(
    server: string,
    login: string,
    trade: TradeRequest
  ): Promise<unknown> {
    return this.request(
      `/accounts/${encodeURIComponent(server)}/${login}/sell`,
      { method: "POST", body: JSON.stringify(trade) },
      DEFAULT_TIMEOUT_MS, 0
    );
  }

  async close(
    server: string,
    login: string,
    symbol?: string
  ): Promise<unknown> {
    const body = symbol ? JSON.stringify({ symbol }) : undefined;
    return this.request(
      `/accounts/${encodeURIComponent(server)}/${login}/close`,
      { method: "POST", body },
      DEFAULT_TIMEOUT_MS, 0
    );
  }

  async closeTicket(
    server: string,
    login: string,
    ticket: number,
    volume?: number
  ): Promise<unknown> {
    const body: Record<string, unknown> = { ticket };
    if (volume !== undefined) body.volume = volume;
    return this.request(
      `/accounts/${encodeURIComponent(server)}/${login}/close-ticket`,
      { method: "POST", body: JSON.stringify(body) },
      DEFAULT_TIMEOUT_MS, 0
    );
  }

  async updateEa(content: string): Promise<{ reloaded: number; total: number; results: unknown[] }> {
    return this.request(
      "/ea/update",
      { method: "POST", body: JSON.stringify({ content }) },
      120_000, 0 // 2 min timeout (compilation takes time), no retries
    );
  }

  async getSymbolInfo(
    server: string,
    login: string,
    symbol: string
  ): Promise<VpsSymbolInfo> {
    return this.request<VpsSymbolInfo>(
      `/accounts/${encodeURIComponent(server)}/${login}/symbol-info?symbol=${encodeURIComponent(symbol)}`,
      {},
      10_000, 0 // 10s timeout, no retries
    );
  }

  async getSystemStats(): Promise<VpsSystemStats> {
    return this.request<VpsSystemStats>("/system/stats", {}, 15_000, 0); // wmic can be slow on fresh VPS
  }

  async getCopierStatus(): Promise<unknown> {
    return this.request("/copier/status");
  }

  async startCopier(req: CopierStartRequest): Promise<unknown> {
    return this.request("/copier/start", {
      method: "POST",
      body: JSON.stringify(req),
    }, DEFAULT_TIMEOUT_MS, 0); // no retries — could start duplicate sessions
  }

  async stopCopier(): Promise<unknown> {
    return this.request("/copier/stop", {
      method: "POST",
    }, DEFAULT_TIMEOUT_MS, 0);
  }

  async getBrokers(): Promise<unknown> {
    return this.request("/brokers");
  }

  async getDeals(
    server: string,
    login: string,
    days = 30
  ): Promise<unknown> {
    return this.request(
      `/accounts/${encodeURIComponent(server)}/${login}/deals?days=${days}`,
      {},
      30_000, 0 // 30s timeout, no retries — can be slow for large history
    );
  }
}
