# MT5 Trading Leaderboard — Build Spec for New Team

## What You're Building

A **trading leaderboard platform** where users register, connect their MT5 trading accounts, and track/share their performance (PNL, payouts, deposits, open positions). Users control what data is public via privacy settings. A public leaderboard ranks traders by various metrics.

## Architecture

```
┌────────────────────────┐     ┌──────────────────────────────┐
│  Leaderboard Frontend  │────▶│   Leaderboard Backend (new)  │
│  (Next.js / React)     │     │   (Next.js API / Node.js)    │
│  - Public leaderboard  │     │   - User auth (email/pass)   │
│  - User dashboard      │     │   - Account linking           │
│  - Privacy settings    │     │   - PNL calculations          │
│  - Trade history       │     │   - Leaderboard rankings      │
└────────────────────────┘     │   - Background sync jobs      │
                               └──────────┬───────────────────┘
                                          │ HTTP + X-Api-Key header
                                          ▼
                               ┌──────────────────────────────┐
                               │  MT5 Fleet Orchestrator       │
                               │  (existing — READ ONLY)       │
                               │  Railway: mt5-fleet-orch      │
                               │                               │
                               │  Data available:              │
                               │  - Live balance/equity/PNL    │
                               │  - Open positions + profit    │
                               │  - Closed deals (realized PNL)│
                               │  - Historical snapshots (60d) │
                               │  - Account list per VPS       │
                               └──────────────────────────────┘
```

**Key principle:** Your backend is the **only** service that calls the Fleet Orchestrator API. Your frontend never calls the orchestrator directly. This avoids CORS issues and gives you full control over caching, auth, and rate limiting.

## Fleet Orchestrator API Reference

**Base URL:** `https://mt5-fleet-orchestrator-production.up.railway.app`
**Auth:** All requests require header `X-Api-Key: <key>` (you'll receive this key). Alternatively, use cookie-based auth via `POST /api/auth/login`.

### Endpoints Your Backend Will Consume

#### 1. List All Accounts
```
GET /api/accounts
Response: [
  {
    "id": "cuid",
    "vpsId": "cuid",
    "login": "576984",
    "server": "AquaFunded-Server",
    "broker": "aquafunded",
    "status": "ACTIVE",      // SETUP | ACTIVE | FAILED
    "balance": 100000.00,
    "equity": 100450.25,
    "freeMargin": 98500.00,
    "profit": 450.25,         // unrealized PNL
    "connected": true,
    "lastSynced": "2026-03-21T20:24:17.093Z",
    "vpsName": "VPS1"
  }
]
```

#### 2. Live Account Info (real-time balance, equity)
```
GET /api/accounts/{vpsId}/{server}/{login}
Response: {
  "status": "OK",
  "login": "576984",
  "balance": "100000.00",
  "equity": "100450.25",
  "margin": "1500.00",
  "free_margin": "98500.00",
  "leverage": "100",
  "server": "AquaFunded-Server",
  "bid": "1.08525",
  "ask": "1.08527"
}
```

#### 3. Open Positions (unrealized PNL per trade)
```
GET /api/accounts/{vpsId}/{server}/{login}/positions
Response: [
  {
    "ticket": "12345678",
    "symbol": "EURUSD",
    "type": "BUY",
    "volume": 0.50,
    "openPrice": 1.08400,
    "profit": 62.50,
    "sl": 1.08200,
    "tp": 1.08800
  }
]
```

#### 4. Closed Deals / Trade History (realized PNL) ⭐ KEY ENDPOINT
```
GET /api/accounts/{vpsId}/{server}/{login}/deals?days=30
Response: {
  "count": 47,
  "deals": [
    {
      "deal": 98765432,        // unique deal ID
      "order": 12345678,       // order that triggered this deal
      "symbol": "EURUSD",
      "type": "BUY",           // BUY | SELL | BALANCE | CREDIT | COMMISSION
      "entry": "OUT",          // IN = open, OUT = close, INOUT = reverse
      "volume": 0.50,
      "price": 1.08525,
      "profit": 62.50,         // realized profit for this deal
      "swap": -1.25,
      "commission": -3.50,
      "comment": "api",
      "time": 1711051457,      // unix timestamp
      "positionId": 12345678   // links IN and OUT deals for same position
    },
    {
      "type": "BALANCE",       // <-- This is a deposit or withdrawal!
      "profit": 50000.00,      // positive = deposit, negative = withdrawal
      "time": 1710446400,
      ...
    }
  ]
}
```

**How to compute realized PNL:**
- Filter deals where `entry === "OUT"` → these are closed trades
- Sum their `profit + swap + commission` = net realized PNL
- Filter deals where `type === "BALANCE"` → these are deposits/withdrawals
- `profit > 0` = deposit, `profit < 0` = withdrawal/payout

#### 5. Historical Snapshots (equity curve)
```
GET /api/accounts/{vpsId}/{server}/{login}/snapshots?hours=168
Response: [
  {
    "id": "cuid",
    "balance": 100000.00,
    "equity": 100450.25,
    "profit": 450.25,
    "positions": 3,
    "timestamp": "2026-03-21T20:20:00.000Z"
  }
]
// 5-minute intervals, up to 168 hours (7 days) per request, 60 days total retention
```

#### 6. Dashboard (all accounts summary in one call)
```
GET /api/dashboard
Response: {
  "fleet": { "total": 2, "online": 2, "offline": 0 },
  "accounts": {
    "total": 4, "connected": 4, "disconnected": 0,
    "totalBalance": 400000.00,
    "totalEquity": 401250.50,
    "totalProfit": 1250.50
  },
  "alerts": [],
  "copier": { "activeSessions": 0, "activeTargets": 0, "activeTrades": 0 }
}
```

## What You Need to Build

### Database Schema (your own PostgreSQL)

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  displayName   String
  avatarUrl     String?
  createdAt     DateTime  @default(now())

  accounts      LinkedAccount[]
  settings      UserSettings?
}

model UserSettings {
  id              String   @id @default(cuid())
  userId          String   @unique
  showPnl         Boolean  @default(false)  // share PNL publicly
  showPayouts     Boolean  @default(false)  // share deposits/withdrawals
  showPositions   Boolean  @default(false)  // share open positions
  showDeposits    Boolean  @default(false)  // share deposit amounts

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model LinkedAccount {
  id              String   @id @default(cuid())
  userId          String
  // Fields from orchestrator — these identify the account
  orchestratorAccountId String   // Account.id from fleet orchestrator
  vpsId           String
  server          String
  login           String
  broker          String?

  // Cached latest data (synced every 5 min)
  balance         Float    @default(0)
  equity          Float    @default(0)
  unrealizedPnl   Float    @default(0)
  realizedPnl     Float    @default(0)   // computed from deals
  totalDeposits   Float    @default(0)   // sum of BALANCE deals > 0
  totalWithdrawals Float   @default(0)   // sum of BALANCE deals < 0
  roi             Float    @default(0)   // realized / totalDeposits * 100
  lastSyncedAt    DateTime?

  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  snapshots       PnlSnapshot[]
  deals           Deal[]

  @@unique([userId, server, login])
}

model Deal {
  id              String   @id @default(cuid())
  accountId       String
  dealTicket      BigInt   @unique  // deal ID from MT5 — deduplicate on sync
  orderTicket     BigInt?
  symbol          String
  type            String   // BUY, SELL, BALANCE, CREDIT
  entry           String   // IN, OUT, INOUT
  volume          Float
  price           Float
  profit          Float
  swap            Float    @default(0)
  commission      Float    @default(0)
  comment         String   @default("")
  positionId      BigInt?
  closedAt        DateTime

  account         LinkedAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, closedAt])
}

model PnlSnapshot {
  id              String   @id @default(cuid())
  accountId       String
  balance         Float
  equity          Float
  realizedPnl     Float
  unrealizedPnl   Float
  timestamp       DateTime @default(now())

  account         LinkedAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, timestamp])
}
```

### Background Sync Job (runs every 5 minutes)

```
1. Fetch GET /api/accounts from orchestrator
2. For each LinkedAccount in your DB:
   a. Match by vpsId + server + login
   b. Update balance, equity, unrealizedPnl from orchestrator data
   c. Fetch GET /api/accounts/{vpsId}/{server}/{login}/deals?days=7
   d. Upsert deals by dealTicket (deduplicate)
   e. Recompute: realizedPnl = SUM(profit+swap+commission) WHERE entry=OUT
   f. Recompute: totalDeposits = SUM(profit) WHERE type=BALANCE AND profit>0
   g. Recompute: totalWithdrawals = ABS(SUM(profit)) WHERE type=BALANCE AND profit<0
   h. Recompute: roi = realizedPnl / totalDeposits * 100
   i. Create PnlSnapshot for equity curve
```

### API Endpoints (your backend)

**Public (no auth):**
- `GET /api/leaderboard?sort=realizedPnl&period=30d&limit=50` — public rankings
- `GET /api/users/{id}/profile` — public profile (respects privacy settings)
- `GET /api/users/{id}/equity-curve` — public equity chart data

**Authenticated (user's own data):**
- `POST /api/auth/register` — email + password signup
- `POST /api/auth/login` — returns JWT
- `GET /api/me` — current user profile
- `PATCH /api/me/settings` — update privacy settings
- `POST /api/me/accounts` — link an MT5 account (provide server + login, backend verifies it exists in orchestrator)
- `DELETE /api/me/accounts/{id}` — unlink account
- `GET /api/me/accounts` — list linked accounts with full PNL data
- `GET /api/me/accounts/{id}/deals` — trade history
- `GET /api/me/accounts/{id}/positions` — live open positions (proxied from orchestrator)

### Leaderboard Ranking Logic

```typescript
// Suggested ranking metrics:
interface LeaderboardEntry {
  userId: string;
  displayName: string;
  // Aggregate across all user's linked accounts:
  totalRealizedPnl: number;    // sum of all closed trade profits
  totalRoi: number;            // realized / deposits * 100
  totalBalance: number;
  totalEquity: number;
  winRate: number;             // % of OUT deals with profit > 0
  totalTrades: number;         // count of OUT deals
  maxDrawdown: number;         // computed from equity snapshots
  sharpeRatio: number;         // daily returns volatility
}

// Sort options: realizedPnl, roi, winRate, sharpeRatio
// Period filters: 7d, 30d, 90d, all-time
```

### Account Linking Flow

```
1. User enters: server name + login number
2. Backend calls GET /api/accounts from orchestrator
3. Find matching account by server + login
4. If found: create LinkedAccount record, start syncing
5. If not found: show error "Account not found in fleet"

Note: Users can only link accounts that are already managed
by the fleet orchestrator. They don't need VPS passwords or
MT5 credentials — the orchestrator already has access.
```

## Tech Stack Recommendation

- **Framework:** Next.js 15+ (App Router) — same stack as orchestrator
- **Database:** PostgreSQL on Railway (separate instance)
- **ORM:** Prisma 6
- **Auth:** NextAuth.js or custom JWT (email/password)
- **Deployment:** Railway (same project, separate service)
- **Background jobs:** Node.js cron via `node-cron` or Railway cron job
- **Charts:** Recharts or Lightweight Charts (TradingView) for equity curves

## Environment Variables

```env
DATABASE_URL=postgresql://...           # Your own database
ORCHESTRATOR_URL=https://mt5-fleet-orchestrator-production.up.railway.app
ORCHESTRATOR_API_KEY=<provided>         # X-Api-Key for orchestrator
JWT_SECRET=<generate>                   # For user auth tokens
```

## Key Constraints

1. **Read-only access** to orchestrator — you cannot create accounts, execute trades, or modify VPS config
2. **5-minute data freshness** — snapshots are taken every 5 min; live data available via positions endpoint
3. **60-day snapshot retention** — orchestrator cleans up snapshots older than 60 days; persist your own PnlSnapshots for longer history
4. **500 deals per request** — the deals endpoint returns the last 500 deals per call; for full history, sync daily and store in your DB
5. **API key auth** — include `X-Api-Key` header on every request to the orchestrator; DO NOT expose this key to your frontend
6. **Account identification** — accounts are identified by `vpsId + server + login` triplet; the `vpsId` is an internal ID, use `server + login` for user-facing display
