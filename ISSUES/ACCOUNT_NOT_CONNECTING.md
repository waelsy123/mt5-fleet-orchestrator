# Account Not Connecting to Broker

## Symptoms

- Account shows "Disconnected" in orchestrator dashboard
- `GET /accounts/{server}/{login}/info` returns `ERROR|Not connected to broker`
- `GET /accounts/{server}/{login}/positions` returns `count=0` despite open trades
- Terminal log shows no `authorized on ...` or `connected to ...` lines
- Quotes return stale/cached data with frozen timestamps

## Root Causes

### 1. Broken DNS on VPS

Contabo Windows VPS instances often ship with only an **IPv6 DNS server** (`2a02:c207::1:53`) that doesn't respond. This means the MT5 terminal can't resolve any hostnames, including MetaQuotes' discovery infrastructure.

**How to diagnose:**
```powershell
# On the VPS via SSH
nslookup google.com
# If you see "No response from server" → DNS is broken
```

**Terminal log evidence:**
```
MQL5 Cloud Server "agent1.mql5.net:443" not found
MQL5 Cloud Server "agent2.mql5.net:443" not found
```

**Fix:**
```powershell
netsh interface ipv6 set dnsservers "Ethernet" static none
netsh interface ipv4 set dnsservers "Ethernet" static 8.8.8.8 primary
netsh interface ipv4 add dnsservers "Ethernet" 8.8.4.4 index=2
ipconfig /flushdns
```

**Automated:** `setup_vps.py` sets Google DNS during Phase 2 (SSH provisioning).

### 2. Generic Terminal Has No Broker Server Data

The MT5 `/auto` (silent) installer **always creates a generic MetaQuotes terminal** regardless of which broker's installer you download. No broker branding, no `origin.txt`, no `.srv` files, no broker server IP addresses. The `/auto` flag strips all broker customization.

The terminal reads `Server=AquaFunded-Server` from `startup.ini` but has no way to resolve that name to actual IP addresses. MT5 resolves server names using:

- **`.srv` files** — binary files with server IPs, created only via the GUI "Open Account" dialog
- **`servers.dat`** — encrypted cache of known servers and their addresses, accumulated over time

A fresh generic install has a small `servers.dat` (~28KB) with only MetaQuotes' own servers. A terminal that has connected to brokers before has a much larger one (~72KB+) with cached broker addresses.

**How to diagnose:**
```powershell
# Check servers.dat size — small = no broker data
dir "%APPDATA%\MetaQuotes\Terminal\{hash}\config\servers.dat"
# 28KB = generic only, 72KB+ = has broker data

# Check terminal log — should show "authorized on ..."
# If no auth line at all, the terminal doesn't know the server IPs
type "%APPDATA%\MetaQuotes\Terminal\{hash}\logs\{date}.log"
```

**Fix:** Copy `servers.dat` and `accounts.dat` from a working MT5 installation into the terminal's config directory, then restart the terminal.

**Automated:** `add_account()` in `mt5_multi_api.py` copies these files from `C:\MT5\mt5_config\` into each new terminal's data dir config.

## File Locations

### servers.dat (the key file)

| Location | Purpose |
|----------|---------|
| **Mac (source)** | `~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/config/servers.dat` |
| **Bundled in repo** | `mt5_config/servers.dat` (instance-account-api) / `python/mt5_config/servers.dat` (orchestrator) |
| **Deployed to VPS** | `C:\MT5\mt5_config\servers.dat` (copied during provisioning) |
| **Per-terminal** | `%APPDATA%\MetaQuotes\Terminal\{hash}\config\servers.dat` (copied during add_account) |

### accounts.dat

Same locations as `servers.dat`. Contains cached account/server mapping data.

## Adding a New Broker

If you need to connect to a broker that isn't in the current `servers.dat`:

1. Open MT5 on your local Mac
2. Go to File > Open an Account
3. Search for and connect to the new broker's server
4. Close MT5
5. Copy the updated `servers.dat` from your Mac:
   ```bash
   cp ~/Library/Application\ Support/net.metaquotes.wine.metatrader5/drive_c/Program\ Files/MetaTrader\ 5/config/servers.dat mt5_config/servers.dat
   ```
6. Redeploy to VPS:
   ```bash
   scp mt5_config/servers.dat Administrator@<vps-ip>:'C:\MT5\mt5_config\servers.dat'
   ```
7. Restart the terminal for the affected account

## Manual Recovery

If an existing account stops connecting:

```bash
# 1. Verify DNS
ssh Administrator@<vps-ip> "nslookup google.com"

# 2. If DNS broken, fix it
ssh Administrator@<vps-ip> "netsh interface ipv4 set dnsservers Ethernet static 8.8.8.8 primary & ipconfig /flushdns"

# 3. Copy fresh server config
scp mt5_config/servers.dat Administrator@<vps-ip>:'%APPDATA%\MetaQuotes\Terminal\{hash}\config\servers.dat'

# 4. Restart terminal
ssh Administrator@<vps-ip> "taskkill /f /im terminal64.exe"
ssh Administrator@<vps-ip> "schtasks /Run /TN StartMT5_{server}_{login}"

# 5. Check log for "authorized on ..."
ssh Administrator@<vps-ip> "type %APPDATA%\MetaQuotes\Terminal\{hash}\logs\{date}.log"
```

## Timeline of Discovery

This issue took 10+ attempts to diagnose because:

1. The EA responds to commands even when the broker is disconnected (local file bridge still works)
2. `POSITIONS` returns `OK|count=0` which looks like success (no positions) rather than failure
3. Cached/stale quote data makes it appear the terminal has live market data
4. The `/auto` installer behavior (stripping broker config) is undocumented
5. DNS failure was masked because SSH (which uses IP directly) worked fine
