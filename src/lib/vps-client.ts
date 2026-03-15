import type {
  AddAccountRequest,
  CopierStartRequest,
  TradeRequest,
  VpsAccountInfo,
  VpsDashboardAccount,
  VpsDashboardData,
  VpsPositions,
} from "./types";

const DEFAULT_TIMEOUT_MS = 5000;

export class VpsClient {
  private baseUrl: string;

  constructor({ ip, apiPort }: { ip: string; apiPort: number }) {
    this.baseUrl = `http://${ip}:${apiPort}`;
  }

  private async request<T = unknown>(
    path: string,
    options: RequestInit = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
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
          info: Record<string, string>;
          positions: { status: string; positions?: unknown[] };
        }
      >
    >("/dashboard/data", {}, 60_000);

    const accounts: VpsDashboardAccount[] = Object.values(raw).map((acct) => ({
      login: acct.login,
      server: acct.server,
      broker: "",
      connected: acct.info?.status === "OK",
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
    }, 300_000); // 5 min — downloads + installs MT5
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
    return this.request(
      `/accounts/${encodeURIComponent(server)}/${login}/buy`,
      {
        method: "POST",
        body: JSON.stringify(trade),
      }
    );
  }

  async sell(
    server: string,
    login: string,
    trade: TradeRequest
  ): Promise<unknown> {
    return this.request(
      `/accounts/${encodeURIComponent(server)}/${login}/sell`,
      {
        method: "POST",
        body: JSON.stringify(trade),
      }
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
      {
        method: "POST",
        body,
      }
    );
  }

  async getCopierStatus(): Promise<unknown> {
    return this.request("/copier/status");
  }

  async startCopier(req: CopierStartRequest): Promise<unknown> {
    return this.request("/copier/start", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async stopCopier(): Promise<unknown> {
    return this.request("/copier/stop", {
      method: "POST",
    });
  }

  async getBrokers(): Promise<unknown> {
    return this.request("/brokers");
  }
}
