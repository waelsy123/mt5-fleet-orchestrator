# VPS Agent (mt5_multi_api.py)

## Overview

REST API that runs on each Windows VPS to manage multiple MetaTrader 5 trading accounts. Uses a **file-based bridge** (not the broken official MT5 Python package) — a PythonBridge EA polls `command.txt` every 200ms and writes results to `result.txt`.

## Architecture

```
Fleet Orchestrator (Railway)       Windows VPS (Contabo)
────────────────────────────       ─────────────────────
setup_vps.py ──VNC──> Enable SSH   FastAPI (port 8000)
             ──SSH──> Deploy API     ├── /accounts/{server}/{login}/buy|sell|close|info|positions
                                     ├── /copier/start|stop|status
                                     ├── /accounts/add (full automated MT5 setup)
                                     └── / (dashboard UI)

                                   MT5 Terminal (non-portable mode, per-account)
                                     └── PythonBridge EA <-> command.txt / result.txt
```

## Key Files (in `python/` directory)

| File | Purpose |
|------|---------|
| `setup_vps.py` | Full VPS setup from zero (VNC login -> SSH -> Python -> API deploy) |
| `mt5_multi_api.py` | FastAPI server — trading routes, account management, opposite copier |
| `PythonBridge.mq5` | MQL5 EA — file-based bridge inside each MT5 terminal |
| `brokers.json` | Pre-configured broker installer URLs and server names |

## VPS Setup Flow (`setup_vps.py`)

**Phase 1 — VNC:** Boot wait -> Win+L -> Ctrl+Alt+Del -> password -> blind password-change flow -> Win+L -> login -> Win+R -> PowerShell -> install OpenSSH -> start sshd

**Phase 2 — SSH:** Install Python 3.12 -> pip install fastapi uvicorn -> SFTP copy files -> write start_api.ps1 via SFTP -> firewall port 8000 -> scheduled task -> start API -> HTTP verification

## Critical Patterns

- **SFTP for file generation**: Always use SFTP (not SSH PowerShell escaping) to write generated files like `start_api.ps1` — avoids `\"` escaping corruption through cmd.exe -> PowerShell pipeline
- **schtasks for process start, NOT Start-Process**: `Start-Process` via SSH creates a child process that gets killed when the SSH session closes. Use `schtasks /Run` instead — it runs in the interactive desktop session from the VNC login and survives SSH disconnection
- **VNC password typing**: Use `type_str_safe()` (VNC keysym events) for passwords — CapsLock-independent. Use `type_str()` (scancodes) for PowerShell commands
- **Never toggle CapsLock** in VNC scripts — state persists, causes cascading failures
- **Non-portable mode**: Each MT5 account runs in non-portable mode. Portable mode (`/portable` flag) is broken on MT5 build 5687+ (terminal starts but never connects to broker)
- **Symbol activation**: Send QUOTE before first trade on a symbol (auto-done by buy/sell endpoints)
- **Python full path**: Use `C:\Program Files\Python312\python.exe` — not in SSH PATH

## Command Protocol

```
Command:  ACTION|SYMBOL|VOLUME|PRICE|SL|TP|COMMENT
Response: STATUS|key=value|key=value|...
```

Actions: `INFO`, `QUOTE`, `BUY`, `SELL`, `CLOSE`, `CLOSE_TICKET`, `POSITIONS`

## File Structure on VPS

```
C:\MT5\
├── mt5_multi_api.py          # API server
├── PythonBridge.mq5          # EA source (copied into each account's data dir)
├── brokers.json              # Broker configurations
├── start_api.ps1             # API startup script (generated)
├── accounts.txt              # Account registry (login|login|server|data_dir)
├── static\index.html         # Dashboard
├── mt5_config\
│   ├── servers.dat           # Broker server IP cache (critical for connection)
│   └── accounts.dat          # Account/server mapping cache
└── {server}_{login}\         # Per-account terminal copy
    ├── terminal64.exe
    ├── startup.ini           # Login credentials + EA config
    └── config\common.ini     # EA permissions (AutoTrading, DllImport)

%APPDATA%\MetaQuotes\Terminal\{hash}\
└── MQL5\
    ├── Experts\PythonBridge.ex5  # Compiled EA
    └── Files\                    # command.txt / result.txt bridge
```
