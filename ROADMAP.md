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
- `Account` - MT5 trading accounts (login, server, broker, balance, equity, connected)
- `AccountSnapshot` - Historical balance/equity/profit data (every 5 min)
- `ProvisionLog` - VPS provisioning progress logs
- `CopierSession` - Copy trading sessions (source, targets, running state)
- `CopierLog` - Copy trading action audit trail

**Key modules:**
- `src/lib/copier.ts` - Copy trading engine (follow/opposite modes, volume multipliers, mirror reconstruction)
- `src/lib/polling.ts` - Background polling (10s interval, syncs accounts, creates snapshots)
- `src/lib/vps-client.ts` - HTTP client for VPS instance API
- `src/lib/provisioner.ts` - VPS provisioning (spawns setup_vps.py)
- `src/lib/account-setup.ts` - Account setup job tracker
- `src/lib/notify.ts` - Telegram notifications
- `src/middleware.ts` - Cookie-based auth (AUTH_SECRET)
- `src/instrumentation.ts` - App startup (start polling, restore copier sessions)

**30+ API routes** covering VPS management, account CRUD, trading (buy/sell/close), copy trading, server search, dashboard, and health.

### mt5-instance-account-api

Single-VPS agent. Python FastAPI server running on each Windows VPS at port 8000.

**Key files:**
- `mt5_multi_api.py` (1166 lines) - FastAPI server, all routes and logic
- `PythonBridge.mq5` - MQL5 Expert Advisor (file-based command bridge)
- `setup_vps.py` - Full VPS provisioning automation (VNC phase + SSH phase)
- `brokers.json` - 12 pre-configured broker installer URLs

**How it works:**
- Each MT5 account runs its own terminal copy at `C:\MT5\{server}_{login}\`
- The PythonBridge EA polls `command.txt` every 200ms, executes commands, writes `result.txt`
- This file-based bridge works around the broken MT5 Python IPC (-10005 error)
- Accounts registered in `accounts.txt` (one line per account)
- Processes kept alive via Windows `schtasks` (survives SSH disconnect)

**API endpoints:** account management, trading (buy/sell/close/positions), broker installer search/download, opposite copy trading, system stats.

### Key Design Decisions

1. **Non-portable MT5 mode** - Portable mode broken on build 5687+. Terminals install to Program Files, data to AppData.
2. **File-based EA bridge** - Official MT5 Python package has fatal IPC bug. PythonBridge EA + command.txt is the workaround.
3. **schtasks for long-running processes** - SSH child processes die when session closes. Task Scheduler runs in interactive desktop session.
4. **SFTP for file deployment** - PowerShell string escaping corrupts `\"` in scripts. SFTP bypasses encoding issues.
5. **Duplicated files** - The orchestrator's `python/` dir contains copies of `mt5_multi_api.py`, `PythonBridge.mq5`, `brokers.json` that get deployed to each VPS during provisioning.

---

## Development Plan

### Phase 1: Reliability & Resilience

- [x] **Retry logic in VpsClient** - Exponential backoff (3 attempts, 1s/2s delays). Only retries network/timeout errors, not HTTP errors.
- [x] **Health-aware polling** - Tracks consecutive failures per VPS. After 3+ failures, backs off to polling every 60s instead of 10s. Resets on success.
- [x] **Auto-retry failed copier trades** - Failed trade copies are automatically retried after a 30s cooldown each poll cycle. No more lost trades from transient VPS issues.
- [x] **Graceful shutdown** - SIGTERM/SIGINT handlers stop polling and copier sessions cleanly before exit.
- [ ] **Auto-retry disconnected accounts** - If an MT5 terminal disconnects, auto-restart it via the instance API. Requires adding a restart endpoint to mt5-instance-account-api first.

### Phase 2: Security

- [ ] **TLS between orchestrator and VPS** - Trade credentials and commands go over plain HTTP on port 8000. Add TLS or WireGuard tunnel.
- [ ] **Proper authentication** - Replace single shared AUTH_SECRET token with JWT or session-based auth (user accounts, rotation, expiry).
- [ ] **Encrypt sensitive DB fields** - VNC passwords stored in plaintext in the Vps table.

### Phase 3: Performance & Scalability

- [x] **Parallel VPS polling** - `pollAll` already uses `Promise.allSettled` to poll all VPS in parallel. (Was already implemented.)
- [ ] **Cache dashboard data** - `/dashboard/data` is slow (60s timeout, calls every EA). Serve stale data while refreshing in background.
- [ ] **Configurable copier poll interval** - Currently 1s per session. With many sessions this creates heavy load. Allow per-session tuning.

### Phase 4: Operational Improvements

- [x] **Telegram alerts for copy trade failures** - Both `log()` and `addTargetLog()` already send Telegram notifications on ERROR and FAIL actions. (Was already implemented.)
- [ ] **Snapshot retention policy** - AccountSnapshot grows indefinitely. Add cleanup (e.g. keep 30 days, aggregate older data).
- [ ] **P&L tracking per copier session** - Track how much each copy session made/lost, not just individual account equity.
- [ ] **Dry-run mode for copier** - Test copy trading config without executing real trades.

### Phase 5: Code Quality

- [ ] **Split mt5_multi_api.py** - 1166 lines in one file. Break into modules (routes, bridge, account manager, copier).
- [ ] **Add tests** - Zero test files in both projects. Priority: copier logic (mirror tracking, partial closes, volume calculation) since bugs lose real money.
- [ ] **Single source of truth for shared files** - `mt5_multi_api.py`, `PythonBridge.mq5`, `brokers.json` exist in both repos and can drift. Make the orchestrator pull from the instance API repo or a shared package.
