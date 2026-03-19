// Types matching the VPS API (mt5_multi_api.py) responses

export interface VpsAccountInfo {
  status: string;
  login: number;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  leverage: number;
  server: string;
  bid: number;
  ask: number;
}

export interface VpsPosition {
  pos: number;
  symbol: string;
  type: string;
  volume: number;
  price: number;
  profit: number;
  sl: number;
  tp: number;
  comment: string;
}

export interface VpsPositions {
  status: string;
  count: number;
  positions: VpsPosition[];
}

export interface VpsDashboardAccount {
  login: string;
  server: string;
  broker: string;
  connected: boolean;
  balance: number;
  equity: number;
  free_margin: number;
  profit: number;
  positions: number;
}

export interface VpsDashboardData {
  status: string;
  accounts: VpsDashboardAccount[];
}

export interface TradeRequest {
  symbol: string;
  volume: number;
  sl?: number;
  tp?: number;
  comment?: string;
}

export interface AddAccountRequest {
  login: string;
  password: string;
  server: string;
  broker?: string;
  installer_url?: string;
  installer_path?: string;
}

export interface VpsSystemStats {
  cpuPercent: number | null;
  memoryPercent: number | null;
  memoryTotalMB: number | null;
  memoryUsedMB: number | null;
  memoryFreeMB: number | null;
  diskTotalGB: number | null;
  diskUsedGB: number | null;
  diskFreeGB: number | null;
  diskPercent: number | null;
  mt5Processes: number | null;
  uptimeSeconds: number | null;
}

export interface CopierStartRequest {
  source: string;
  target: string;
  volume_mult?: number;
}
