# MT5 Fleet System - Roadmap

## Project Overview

### Architecture

```
┌──────────────────────────────────────────────┐
│  mt5-fleet-orchestrator (Railway)            │
│  Next.js 16 + PostgreSQL + React Dashboard   │
│  Central management of all VPS instances      │
│                                              │
│  - Web UI (VPS fleet, accounts, trading)     │
│  - Copy trading engine (multi-session)       │
│  - 10s background polling of all VPS         │
│  - Account snapshots & history               │
│  - Telegram notifications                    │
│  - VPS provisioning (VNC/SSH automation)     │
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

### mt5-fleet-orchestrator

Central dashboard and orchestration layer. Deployed on Railway (Docker, Node 20 + Python 3.12).

**Tech stack:** Next.js 16, React 19, Prisma 6 + PostgreSQL, Tailwind CSS, shadcn/ui, TypeScript 5.

**Database models (6):**
- `Vps` - Windows VPS instances (ip, vnc credentials, status, apiPort)
- `Account` - MT5 trading accounts (login, server, broker, balance, equity, connected, status: SETUP/ACTIVE/FAILED)
- `AccountSnapshot` - Historical balance/equity/profit data (every 5 min)
- `ProvisionLog` - VPS provisioning progress logs
- `CopierSession` - Copy trading sessions (source, targets, running state)
- `CopierLog` - Copy trading action audit trail

**Key modules:**
- `src/lib/copier.ts` - Copy trading engine (follow/opposite modes, volume multipliers, mirror reconstruction)
- `src/lib/polling.ts` - Background polling (10s interval, syncs accounts, creates snapshots, snapshot cleanup)
- `src/lib/vps-client.ts` - HTTP client for VPS instance API
- `src/lib/provisioner.ts` - VPS provisioning (spawns setup_vps.py)
- `src/lib/account-setup.ts` - Account setup job tracker
- `src/lib/notify.ts` - Telegram notifications
- `src/middleware.ts` - Cookie-based auth (AUTH_SECRET)
- `src/instrumentation.ts` - App startup (start polling, restore copier sessions)

**30+ API routes** covering VPS management, account CRUD, trading (buy/sell/close), copy trading, server search, dashboard, and health.

### VPS Agent (python/)

Python FastAPI server deployed to each Windows VPS at port 8000. Previously a separate repo (`mt5-instance-account-api`, now archived). All code lives in the orchestrator's `python/` directory. See `docs/VPS_AGENT.md` for full architecture details.

**Key files:**
- `python/mt5_multi_api.py` - FastAPI server, all routes and logic
- `python/PythonBridge.mq5` - MQL5 Expert Advisor (file-based command bridge)
- `python/setup_vps.py` - Full VPS provisioning automation (VNC phase + SSH phase)
- `python/brokers.json` - 12 pre-configured broker installer URLs

**How it works:**
- Each MT5 account runs its own terminal copy at `C:\MT5\{server}_{login}\`
- The PythonBridge EA polls `command.txt` every 200ms, executes commands, writes `result.txt`
- This file-based bridge works around the broken MT5 Python IPC (-10005 error)
- Accounts registered in `accounts.txt` (one line per account)
- Processes kept alive via Windows `schtasks` (survives SSH disconnect)

**API endpoints:** account management, trading (buy/sell/close/positions), broker installer search/download, opposite copy trading, system stats.

**Troubleshooting:** See `docs/ACCOUNT_NOT_CONNECTING.md` for broker connection issues (DNS, servers.dat, manual recovery).

### Key Design Decisions

1. **Non-portable MT5 mode** - Portable mode broken on build 5687+. Terminals install to Program Files, data to AppData.
2. **File-based EA bridge** - Official MT5 Python package has fatal IPC bug. PythonBridge EA + command.txt is the workaround.
3. **schtasks for long-running processes** - SSH child processes die when session closes. Task Scheduler runs in interactive desktop session.
4. **SFTP for file deployment** - PowerShell string escaping corrupts `\"` in scripts. SFTP bypasses encoding issues.
5. **Self-contained repo** - The orchestrator's `python/` dir is the single source of truth for `mt5_multi_api.py`, `PythonBridge.mq5`, `brokers.json`. The old `mt5-instance-account-api` repo is archived.

---

## Development Plan

### Phase 1: Reliability & Resilience (Done)

- [x] **Retry logic in VpsClient** - Exponential backoff (3 attempts, 1s/2s delays). Only retries read-only operations. Trade mutations (buy/sell/close) skip retries to prevent duplicates.
- [x] **Health-aware polling** - Tracks consecutive failures per VPS. After 3+ failures, backs off to polling every 60s instead of 10s. Resets on success.
- [x] **Auto-retry failed copier trades** - Failed trade copies are automatically retried after a 30s cooldown each poll cycle.
- [x] **Graceful shutdown** - SIGTERM/SIGINT handlers stop polling and copier sessions cleanly before exit.
- [x] **Fix stopSession race condition** - `stopSession` now awaits `stopAndClose()` before removing session from map. Prevents conflicts during position closing.
- [x] **VpsClient cache TTL** - Copier's client cache expires after 5 minutes. Picks up VPS IP changes without restart.
- [ ] **Auto-retry disconnected accounts** - If an MT5 terminal disconnects, auto-restart it via the instance API. Requires adding a restart endpoint first.

### Phase 1.5: UX & Operational (Done)

- [x] **Account setup status tracking** - New `AccountStatus` enum (SETUP/ACTIVE/FAILED). Account appears in UI immediately as "Setting up..." when setup starts. Polling auto-promotes to ACTIVE once connected with balance.
- [x] **Account status badges** - Yellow "Setting up...", red "Setup Failed", green "Connected", red "Disconnected" shown on accounts page and VPS detail page.
- [x] **VPS stats timeout fix** - Increased `getSystemStats` timeout to 15s (wmic cpu is slow on fresh Windows VPS).
- [x] **Auto-refresh pages** - VPS list (30s), VPS detail (30s), accounts page (30s). Data no longer goes stale.
- [x] **Snapshot retention** - Deletes AccountSnapshot rows older than 60 days. Cleanup runs daily in the polling loop.
- [x] **P&L sign fix** - Negative P&L now shows `-$37.95` instead of `$37.95`. Dashboard uses TrendingDown icon for losses.
- [x] **Copier log naming** - Renamed "Trade History" / "Recent Activity" to "Copier Log" / "Recent Copier Activity" across nav, dashboard, and page title.
- [x] **Copier poll interval** - Reduced from 2s to 1s for faster trade copying.
- [x] **Polling interval** - Reduced from 30s to 10s for faster status updates.
- [x] **Archive mt5-instance-account-api** - All code absorbed into orchestrator's `python/` dir. Old repo archived with redirect. Docs migrated to `docs/`.

### Phase 2: Security

- [ ] **TLS between orchestrator and VPS** - Trade credentials and commands go over plain HTTP on port 8000. Add TLS or WireGuard tunnel.
- [ ] **Proper authentication** - Replace single shared AUTH_SECRET token with JWT or session-based auth (user accounts, rotation, expiry).
- [ ] **Encrypt sensitive DB fields** - VNC passwords stored in plaintext in the Vps table.

### Phase 3: Performance & Scalability

- [x] **Parallel VPS polling** - `pollAll` uses `Promise.allSettled` to poll all VPS in parallel.
- [ ] **Cache dashboard data** - `/dashboard/data` is slow (60s timeout, calls every EA). Serve stale data while refreshing in background.
- [ ] **Configurable copier poll interval** - Currently 1s per session. With many sessions this creates heavy load. Allow per-session tuning.

### Phase 4: Operational Improvements

- [x] **Telegram alerts for copy trade failures** - `log()` and `addTargetLog()` send Telegram notifications on ERROR and FAIL actions.
- [ ] **P&L tracking per copier session** - Track how much each copy session made/lost, not just individual account equity.
- [ ] **Dry-run mode for copier** - Test copy trading config without executing real trades.
- [ ] **Account detail charts** - Show equity/balance charts from snapshot data on the account detail page.

### Phase 5: Code Quality

- [ ] **Split mt5_multi_api.py** - 1166 lines in one file. Break into modules (routes, bridge, account manager, copier).
- [ ] **Add tests** - Zero test files. Priority: copier logic (mirror tracking, partial closes, volume calculation) since bugs lose real money.
