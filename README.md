# MT5 Fleet Orchestrator

Next.js web app to manage a fleet of Windows VPS instances running MetaTrader 5 trading accounts. Provisions VPS servers from scratch (VNC + SSH automation), deploys trading APIs, and provides a unified dashboard to monitor and trade across all accounts.

**Deployed on Railway**: https://just-stillness-production.up.railway.app

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  Railway (Next.js + PostgreSQL)                        │
│                                                        │
│  Fleet Orchestrator                                    │
│    ├── Dashboard UI        ← manage all VPS & accounts │
│    ├── VPS provisioning    ← automated setup via VNC   │
│    ├── Account management  ← add/remove MT5 accounts   │
│    ├── Server search       ← MetaQuotes directory API  │
│    └── PostgreSQL DB       ← VPS, accounts, snapshots  │
└────────────────────────────────────────────────────────┘
        │                           │
        ▼                           ▼
┌──────────────┐         ┌──────────────┐
│  Windows VPS 1│         │  Windows VPS 2│  ...
│  FastAPI :8000│         │  FastAPI :8000│
│  MT5 terminals│         │  MT5 terminals│
└──────────────┘         └──────────────┘
```

Each Windows VPS runs the [MT5 Instance Account API](https://github.com/waelsy123/mt5-instance-account-api) — a FastAPI server with file-based EA bridge for trading.

## Features

- **VPS Management** — Add, provision, and monitor Windows VPS instances
- **Auto-Provisioning** — One-click VPS setup: VNC login → SSH install → API deploy (via `setup_vps.py`)
- **Account Management** — Add MT5 trading accounts with searchable server dropdown (3000+ MetaQuotes servers)
- **Server Search** — Search MetaQuotes directory with auto-detected installer URLs from `brokers.json`
- **Live Dashboard** — Overview of all accounts across all VPS instances
- **Trading** — Execute trades (buy/sell/close) from the web UI
- **Copy Trading** — Opposite copier between accounts (source BUY → target SELL)

## Tech Stack

- **Frontend**: Next.js 15, React, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API routes, Prisma ORM
- **Database**: PostgreSQL (Railway)
- **VPS Agent**: Python FastAPI (`python/mt5_multi_api.py`)
- **Provisioning**: Python VNC/SSH automation (`python/setup_vps.py`)
- **Deployment**: Railway (Docker)

## Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — overview of all VPS and accounts |
| `/vps` | VPS list — status, account counts, actions |
| `/vps/new` | Add new VPS (IP, VNC, password) |
| `/vps/[id]` | VPS detail — accounts, add account with server search dropdown |
| `/accounts` | All accounts across all VPS instances |
| `/trade` | Trading interface — buy/sell/close on any account |
| `/copier` | Opposite copy trading setup and monitoring |

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/vps` | List all VPS instances |
| POST | `/api/vps` | Add and provision a new VPS |
| GET | `/api/vps/[id]` | Get VPS details with accounts |
| DELETE | `/api/vps/[id]` | Remove VPS and its accounts |
| GET | `/api/accounts` | List all accounts |
| GET | `/api/accounts/[vpsId]` | Accounts for a specific VPS |
| GET | `/api/servers/search?q=` | Search MetaQuotes server directory |
| GET | `/api/dashboard` | Aggregated dashboard data |
| GET | `/api/health` | Health check |

## Database Schema

- **Vps** — id, name, ip, vncIp, vncPort, password, apiPort, status (PENDING/PROVISIONING/ONLINE/OFFLINE/ERROR)
- **Account** — id, vpsId, login, server, broker, balance, equity, freeMargin, profit, connected
- **AccountSnapshot** — periodic balance/equity/profit snapshots for history
- **ProvisionLog** — VPS provisioning step logs with timestamps

## Local Development

```bash
npm install
cp .env.example .env  # Set DATABASE_URL
npx prisma migrate dev
npm run dev
```

## Deployment

Deployed via Railway CLI:

```bash
railway up
```

Or push to GitHub — Railway auto-deploys from the connected repo.

## Python Scripts (VPS Agent)

The `python/` directory contains scripts deployed to each Windows VPS:

| File | Purpose |
|------|---------|
| `mt5_multi_api.py` | FastAPI trading API with file-based EA bridge |
| `setup_vps.py` | Automated VPS provisioning (VNC + SSH) |
| `PythonBridge.mq5` | MQL5 Expert Advisor for MT5 terminals |
| `brokers.json` | Pre-configured broker installer URLs |
| `discover_servers.py` | VNC-based MT5 server discovery automation |

## Development

All development status, roadmap, and planning is tracked in [`ROADMAP.md`](./ROADMAP.md).

The roadmap includes:
- Full project architecture (orchestrator + per-VPS agent)
- Database models and key modules
- Phased development plan (reliability, security, performance, operations, code quality)

### Project Architecture

```
┌──────────────────────────────────────────────┐
│  mt5-fleet-orchestrator (Railway)            │
│  Next.js 16 + PostgreSQL + React Dashboard   │
│  Central management of all VPS instances      │
│                                              │
│  - Web UI (VPS fleet, accounts, trading)     │
│  - Copy trading engine (multi-session)       │
│  - Background polling of all VPS             │
│  - Account snapshots & history charts        │
│  - Telegram notifications                    │
│  - VPS provisioning (VNC/SSH automation)     │
│  - OpenAPI docs at /docs                     │
└──────────┬───────────┬───────────┬───────────┘
           │ HTTP :8000 │           │
     ┌─────▼──┐   ┌────▼───┐  ┌───▼────┐
     │ VPS 1  │   │ VPS 2  │  │ VPS N  │
     │        │   │        │  │        │
     │  mt5-instance-account-api (FastAPI)     │
     │  Per-VPS agent managing MT5 terminals   │
     │  - Account install & setup              │
     │  - Trade execution via EA bridge        │
     │  - System stats (CPU, mem, disk)        │
     └────────────────────────────────────────┘
```

## Key Design Decisions

- **Non-portable MT5 mode**: Portable mode (`/portable`) is broken on MT5 build 5687+. Terminals install to Program Files, data goes to AppData.
- **File-based EA bridge**: The official MT5 Python package has a fatal IPC bug (-10005). PythonBridge EA polls `command.txt` every 200ms instead.
- **schtasks for processes**: SSH child processes die when the session closes. Scheduled tasks run in the interactive desktop session and survive.
- **SFTP for file generation**: Writing scripts via SSH PowerShell corrupts `\"` escaping. SFTP bypasses this.
