"""
MT5 Multi-Account API
Manages multiple MetaTrader 5 instances on one VPS via file-based bridge.
Dashboard at / | Swagger UI at /docs
"""
import json
import os
import re
import ssl
import time
import shutil
import subprocess
import threading
import urllib.request
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

BASE_DIR = os.environ.get("MT5_BASE_DIR", r"C:\MT5")
BROKERS_FILE = Path(__file__).parent / "brokers.json"
TIMEOUT = 15
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(
    title="MT5 Multi-Account API",
    description="Trade on multiple MetaTrader 5 accounts via file-based bridge (PythonBridge EA).",
    version="1.0.0",
)

# Per-account locks to prevent concurrent commands to the same EA
_locks: dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()


def get_lock(files_dir: str) -> threading.Lock:
    with _locks_lock:
        if files_dir not in _locks:
            _locks[files_dir] = threading.Lock()
        return _locks[files_dir]


# --- Models ---

class TradeRequest(BaseModel):
    symbol: str
    volume: float
    sl: float = 0
    tp: float = 0
    comment: str = "api"

class CloseRequest(BaseModel):
    symbol: str = ""

class CopierStartRequest(BaseModel):
    source: str  # "server/login"
    target: str  # "server/login"
    volume_mult: float = 1.0

class AddAccountRequest(BaseModel):
    login: str
    password: str
    server: str = ""          # Auto-filled from broker config if broker provided
    broker: str = ""          # Broker key from brokers.json (e.g. "ftmo", "aquafunded")
    installer_url: str = ""   # MQL5 CDN URL — auto-filled from broker config
    installer_path: str = ""  # Local path to already-downloaded installer

class SearchInstallerRequest(BaseModel):
    broker_name: str

class DownloadInstallerRequest(BaseModel):
    url: str


# --- Account Registry ---

def registry_path():
    return os.path.join(BASE_DIR, "accounts.txt")


def load_accounts():
    """Load account registry mapping server/login to files directory."""
    accounts = {}
    path = registry_path()
    if not os.path.exists(path):
        return accounts
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("|")
            if len(parts) >= 4:
                acc_id, login, server, install_dir = parts[0], parts[1], parts[2], parts[3]
                if os.path.exists(os.path.join(install_dir, "MQL5", "Files")):
                    files_dir = os.path.join(install_dir, "MQL5", "Files")
                else:
                    files_dir = install_dir
                accounts[f"{server}/{login}"] = {
                    "account_id": acc_id,
                    "login": login,
                    "server": server,
                    "install_dir": install_dir,
                    "files_dir": files_dir,
                }
    return accounts


def save_accounts_raw(lines: list[str]):
    os.makedirs(BASE_DIR, exist_ok=True)
    with open(registry_path(), "w") as f:
        f.write("\n".join(lines) + "\n")


def get_account(server: str, login: str):
    accounts = load_accounts()
    key = f"{server}/{login}"
    if key not in accounts:
        raise HTTPException(status_code=404, detail=f"Account {key} not found. Available: {list(accounts.keys())}")
    return accounts[key]


# --- Bridge ---

def send_command(files_dir: str, cmd: str, timeout: int = TIMEOUT) -> dict:
    cmd_file = os.path.join(files_dir, "command.txt")
    result_file = os.path.join(files_dir, "result.txt")

    if not os.path.exists(files_dir):
        return {"status": "ERROR", "message": f"Files dir not found: {files_dir}"}

    lock = get_lock(files_dir)
    with lock:
        if os.path.exists(result_file):
            os.remove(result_file)

        with open(cmd_file, "w") as f:
            f.write(cmd)

        start = time.time()
        while time.time() - start < timeout:
            if os.path.exists(result_file):
                time.sleep(0.1)
                with open(result_file, "r") as f:
                    result = f.read().strip()
                os.remove(result_file)
                return parse_result(result)
            time.sleep(0.2)

    return {"status": "ERROR", "message": "Timeout waiting for EA response"}


def parse_result(raw: str) -> dict:
    parts = raw.split("|")
    result = {"status": parts[0], "raw": raw}
    for part in parts[1:]:
        if ";" in part and "=" in part:
            if "positions" not in result:
                result["positions"] = []
            pos = {}
            for kv in part.split(";"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    pos[k] = v
            result["positions"].append(pos)
        elif "=" in part:
            key, val = part.split("=", 1)
            result[key] = val
    return result


def activate_symbol(files_dir: str, symbol: str):
    send_command(files_dir, f"QUOTE|{symbol}", timeout=5)


# --- Dashboard ---

@app.get("/", include_in_schema=False)
def dashboard():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/dashboard/data", summary="Get all account info and positions in one call")
def dashboard_data():
    """Fetches info + positions for every account sequentially to avoid race conditions."""
    accounts = load_accounts()
    result = {}
    for key, acc in accounts.items():
        info = send_command(acc["files_dir"], f"INFO|EURUSD")
        positions = send_command(acc["files_dir"], "POSITIONS")
        result[key] = {
            "account_id": acc["account_id"],
            "login": acc["login"],
            "server": acc["server"],
            "info": info,
            "positions": positions,
        }
    return result


# --- Account Management Routes ---

@app.get("/brokers", summary="List pre-configured brokers")
def list_brokers():
    """Returns all brokers from brokers.json with their server names and installer URLs."""
    return load_brokers()


@app.get("/accounts", summary="List all registered accounts")
def list_accounts():
    return load_accounts()


def load_brokers() -> dict:
    """Load broker configurations from brokers.json."""
    if BROKERS_FILE.exists():
        with open(BROKERS_FILE) as f:
            return json.load(f)
    return {}


def _download_file(url: str, dest: str):
    """Download a file, bypassing SSL cert issues on fresh Windows."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"User-Agent": "MT5API/1.0"})
    with urllib.request.urlopen(req, context=ctx, timeout=120) as resp:
        with open(dest, "wb") as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)


def _find_terminal_for_server(server: str) -> str | None:
    """Find an existing terminal64.exe from another account on the same broker server."""
    accounts = load_accounts()
    for key, acc in accounts.items():
        if acc["server"] == server:
            terminal = os.path.join(acc["install_dir"], "terminal64.exe")
            if os.path.exists(terminal):
                return terminal
    return None


def _find_installed_terminal() -> str | None:
    """Find terminal64.exe in common install locations after running an installer."""
    search_dirs = [
        r"C:\Program Files",
        r"C:\Program Files (x86)",
    ]
    for base in search_dirs:
        if not os.path.exists(base):
            continue
        for entry in os.listdir(base):
            candidate = os.path.join(base, entry, "terminal64.exe")
            if os.path.exists(candidate):
                return candidate
    return None


def _install_terminal(install_dir: str, installer_path: str):
    """Run MT5 installer and copy terminal to portable directory.

    MT5 installers ignore /dir: flag and install to Program Files.
    So we run the installer, find where it went, and copy everything.
    """
    # Run installer silently
    subprocess.run(
        ["powershell", "-Command",
         f'Start-Process -FilePath "{installer_path}" -ArgumentList "/auto" -Wait'],
        timeout=180,
        capture_output=True,
    )

    # Find where it installed
    installed = _find_installed_terminal()
    if not installed:
        return False

    src_dir = os.path.dirname(installed)
    # Copy entire installation to portable dir
    if os.path.normpath(src_dir) != os.path.normpath(install_dir):
        shutil.copytree(src_dir, install_dir, dirs_exist_ok=True)

    return True


def _start_terminal(install_dir: str, login: str):
    """Create scheduled task and start the terminal."""
    task_name = f"StartMT5_{login}"
    terminal = os.path.join(install_dir, "terminal64.exe")
    ini = os.path.join(install_dir, "startup.ini")

    subprocess.run(
        ["schtasks", "/Create", "/TN", task_name,
         "/TR", f'"{terminal}" /portable /config:"{ini}"',
         "/SC", "ONLOGON", "/RL", "HIGHEST", "/F"],
        capture_output=True, timeout=30,
    )
    subprocess.run(
        ["schtasks", "/Run", "/TN", task_name],
        capture_output=True, timeout=15,
    )


def _wait_for_ea(files_dir: str, timeout: int = 60) -> bool:
    """Wait for the PythonBridge EA to start responding."""
    for _ in range(timeout // 3):
        result = send_command(files_dir, "INFO|EURUSD", timeout=3)
        if result.get("status") == "OK":
            return True
        time.sleep(3)
    return False


@app.post("/accounts/add", summary="Add a new trading account (fully automated setup)")
def add_account(req: AddAccountRequest):
    """Fully automated account setup:

    1. Gets terminal (from existing account on same server, installer URL, or local installer)
    2. Creates portable directory with configs and PythonBridge EA
    3. Registers account, creates scheduled task, starts terminal
    4. Waits for EA to connect and verifies broker connection
    """
    # ── Resolve broker config ────────────────────────────────────────────
    if req.broker:
        brokers = load_brokers()
        # Match by key or by name (case-insensitive)
        broker_cfg = brokers.get(req.broker)
        if not broker_cfg:
            for k, v in brokers.items():
                if v["name"].lower() == req.broker.lower():
                    broker_cfg = v
                    break
        if not broker_cfg:
            available = [f"{k} ({v['name']})" for k, v in brokers.items()]
            raise HTTPException(status_code=400, detail=f"Unknown broker '{req.broker}'. Available: {available}")
        if not req.server:
            req.server = broker_cfg["servers"][0]
        if not req.installer_url:
            req.installer_url = broker_cfg["installer_url"]

    if not req.server:
        raise HTTPException(status_code=400, detail="server is required (or provide broker name)")

    install_dir = os.path.join(BASE_DIR, req.login)
    files_dir = os.path.join(install_dir, "MQL5", "Files")
    experts_dir = os.path.join(install_dir, "MQL5", "Experts")
    config_dir = os.path.join(install_dir, "config")
    terminal_path = os.path.join(install_dir, "terminal64.exe")
    steps = []

    # ── Step 1: Get terminal binary ──────────────────────────────────────
    if os.path.exists(terminal_path):
        steps.append("Terminal already exists")
    else:
        # Try reusing terminal from another account on the same server
        existing = _find_terminal_for_server(req.server)
        if existing:
            existing_dir = os.path.dirname(existing)
            shutil.copytree(existing_dir, install_dir, dirs_exist_ok=True)
            steps.append(f"Copied terminal from existing account ({existing_dir})")
        else:
            # Download installer if URL provided
            installer_path = req.installer_path
            if req.installer_url and not installer_path:
                filename = req.installer_url.split("/")[-1]
                installer_path = os.path.join(BASE_DIR, filename)
                if not os.path.exists(installer_path):
                    try:
                        _download_file(req.installer_url, installer_path)
                        steps.append(f"Downloaded installer ({os.path.getsize(installer_path) // 1024 // 1024}MB)")
                    except Exception as e:
                        raise HTTPException(status_code=400, detail=f"Download failed: {e}")
                else:
                    steps.append("Installer already downloaded")

            if installer_path:
                if not os.path.exists(installer_path):
                    raise HTTPException(status_code=400, detail=f"Installer not found: {installer_path}")
                if _install_terminal(install_dir, installer_path):
                    steps.append("Installed terminal from installer")
                else:
                    raise HTTPException(status_code=500, detail="Installer ran but terminal64.exe not found")
            else:
                raise HTTPException(
                    status_code=400,
                    detail="No terminal available. Provide installer_url or installer_path, "
                           "or add another account on the same server first.",
                )

    # ── Step 2: Create directories and configs ───────────────────────────
    for d in [files_dir, experts_dir, config_dir]:
        os.makedirs(d, exist_ok=True)

    # Copy PythonBridge EA
    ea_source = Path(__file__).parent / "PythonBridge.mq5"
    if ea_source.exists():
        shutil.copy2(str(ea_source), os.path.join(experts_dir, "PythonBridge.mq5"))

    # Create startup.ini
    with open(os.path.join(install_dir, "startup.ini"), "w", newline="") as f:
        f.write(
            f"[Common]\r\n"
            f"Login={req.login}\r\n"
            f"Password={req.password}\r\n"
            f"Server={req.server}\r\n"
            f"ExpertsEnable=1\r\n"
            f"ExpertsDllImport=1\r\n"
            f"ExpertsExpImport=1\r\n"
            f"ExpertsTrades=1\r\n"
            f"ExpertsAutoTrading=1\r\n"
            f"[StartUp]\r\n"
            f"Expert=PythonBridge\r\n"
            f"ExpertParameters=\r\n"
            f"Symbol=EURUSD\r\n"
            f"Period=H1\r\n"
        )

    # Create common.ini
    with open(os.path.join(config_dir, "common.ini"), "w", newline="") as f:
        f.write(
            "[Common]\r\n"
            "ExpertsEnable=1\r\n"
            "ExpertsDllImport=1\r\n"
            "ExpertsExpImport=1\r\n"
            "ExpertsTrades=1\r\n"
            "ExpertsAutoTrading=1\r\n"
            "[Experts]\r\n"
            "AllowDllImport=1\r\n"
            "Enabled=1\r\n"
            "Account=1\r\n"
            "Profile=1\r\n"
            "Chart=1\r\n"
            "Api=1\r\n"
        )
    steps.append("Configs created")

    # ── Step 3: Register account ─────────────────────────────────────────
    path = registry_path()
    lines = []
    if os.path.exists(path):
        with open(path, "r") as f:
            lines = [l.strip() for l in f if l.strip()]
    lines = [l for l in lines if not l.startswith(f"{req.login}|")]
    lines.append(f"{req.login}|{req.login}|{req.server}|{install_dir}")
    save_accounts_raw(lines)
    steps.append("Account registered")

    # ── Step 4: Start terminal ───────────────────────────────────────────
    # Kill any existing instance for this account
    subprocess.run(["taskkill", "/f", "/im", "terminal64.exe"],
                   capture_output=True, timeout=10)
    time.sleep(2)

    _start_terminal(install_dir, req.login)
    steps.append("Terminal started (first run — compiling EA)")

    # ── Step 5: Wait for EA, restart if needed ───────────────────────────
    # First run: terminal recompiles all MQL5 files and may miss the EA.
    # Wait 20s for compilation, then check. If EA not responding, restart.
    time.sleep(20)

    if _wait_for_ea(files_dir, timeout=15):
        steps.append("EA connected on first run")
    else:
        # Restart terminal (EA is now compiled from first run)
        steps.append("EA not ready — restarting terminal")
        subprocess.run(["taskkill", "/f", "/im", "terminal64.exe"],
                       capture_output=True, timeout=10)
        time.sleep(3)
        _start_terminal(install_dir, req.login)
        time.sleep(15)

        if _wait_for_ea(files_dir, timeout=30):
            steps.append("EA connected after restart")
        else:
            steps.append("WARNING: EA not responding — check terminal logs")

    # ── Step 6: Verify broker connection ─────────────────────────────────
    result = send_command(files_dir, f"INFO|EURUSD", timeout=10)
    connected = result.get("status") == "OK"
    if connected:
        steps.append(f"Connected to {req.server} — balance: {result.get('balance', '?')}")
    else:
        steps.append(f"WARNING: Not connected to broker ({result.get('message', 'timeout')})")

    return {
        "status": "OK" if connected else "PARTIAL",
        "message": f"Account {req.login} set up at {install_dir}",
        "install_dir": install_dir,
        "connected": connected,
        "steps": steps,
        "account_info": result if connected else None,
    }


# --- Installer Finder ---

def _generate_slugs(broker_name: str) -> list[str]:
    """Generate possible MQL5 CDN slugs from a broker name."""
    clean = re.sub(r'[^a-zA-Z0-9\s]', '', broker_name).strip()
    words = clean.lower().split()
    if not words:
        return []
    joined = ''.join(words)
    dotted = '.'.join(words)
    slugs = set()
    for base in [joined, dotted]:
        slugs.add(base)
        for suffix in ['.ltd', '.llc', '.inc', '.com', '.s.r.o', '.pty.ltd']:
            slugs.add(base + suffix)
    # Also try with common suffixes removed/added
    if len(words) > 1:
        slugs.add(words[0])
        slugs.add(words[0] + '.ltd')
    return list(slugs)


def _check_url(url: str, timeout: int = 5) -> bool:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        req = urllib.request.Request(url, method='HEAD', headers={"User-Agent": "MT5API/1.0"})
        resp = urllib.request.urlopen(req, context=ctx, timeout=timeout)
        return resp.status == 200
    except Exception:
        return False


@app.post("/installer/search", summary="Search for broker MT5 installer on MQL5 CDN")
def search_installer(req: SearchInstallerRequest):
    slugs = _generate_slugs(req.broker_name)
    found = []
    for slug in slugs:
        name = slug.replace('.', '')
        url = f"https://download.mql5.com/cdn/web/{slug}/mt5/{name}5setup.exe"
        if _check_url(url):
            found.append({"slug": slug, "url": url})
    return {"status": "OK", "broker_name": req.broker_name, "results": found}


@app.post("/installer/download", summary="Download installer from URL to VPS")
def download_installer(req: DownloadInstallerRequest):
    os.makedirs(BASE_DIR, exist_ok=True)
    filename = req.url.split("/")[-1]
    dest = os.path.join(BASE_DIR, filename)
    try:
        _download_file(req.url, dest)
        size_mb = os.path.getsize(dest) / 1024 / 1024
        return {"status": "OK", "path": dest, "size_mb": round(size_mb, 1)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Download failed: {e}")


@app.get("/installer/list", summary="List downloaded installers on VPS")
def list_installers():
    installers = []
    if os.path.exists(BASE_DIR):
        for f in os.listdir(BASE_DIR):
            if f.endswith("setup.exe"):
                full = os.path.join(BASE_DIR, f)
                installers.append({"name": f, "path": full, "size_mb": round(os.path.getsize(full) / 1024 / 1024, 1)})
    return {"installers": installers}


@app.delete("/accounts/{login}", summary="Remove an account from the registry")
def remove_account(login: str):
    path = registry_path()
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="No accounts registered")
    with open(path, "r") as f:
        lines = [l.strip() for l in f if l.strip()]
    new_lines = [l for l in lines if not l.startswith(f"{login}|")]
    if len(new_lines) == len(lines):
        raise HTTPException(status_code=404, detail=f"Account {login} not found")
    save_accounts_raw(new_lines)
    return {"status": "OK", "message": f"Account {login} removed"}


# --- Trading Routes ---

@app.get("/accounts/{server}/{login}/info", summary="Get account info")
def account_info(server: str, login: str, symbol: str = "EURUSD"):
    acc = get_account(server, login)
    return send_command(acc["files_dir"], f"INFO|{symbol}")


@app.get("/accounts/{server}/{login}/positions", summary="Get open positions")
def get_positions(server: str, login: str):
    acc = get_account(server, login)
    return send_command(acc["files_dir"], "POSITIONS")


@app.get("/accounts/{server}/{login}/quote", summary="Get symbol quote")
def get_quote(server: str, login: str, symbol: str = "EURUSD"):
    acc = get_account(server, login)
    return send_command(acc["files_dir"], f"QUOTE|{symbol}")


@app.post("/accounts/{server}/{login}/buy", summary="Open a BUY position")
def buy(server: str, login: str, trade: TradeRequest):
    acc = get_account(server, login)
    activate_symbol(acc["files_dir"], trade.symbol)
    return send_command(
        acc["files_dir"],
        f"BUY|{trade.symbol}|{trade.volume}|0|{trade.sl}|{trade.tp}|{trade.comment}",
    )


@app.post("/accounts/{server}/{login}/sell", summary="Open a SELL position")
def sell(server: str, login: str, trade: TradeRequest):
    acc = get_account(server, login)
    activate_symbol(acc["files_dir"], trade.symbol)
    return send_command(
        acc["files_dir"],
        f"SELL|{trade.symbol}|{trade.volume}|0|{trade.sl}|{trade.tp}|{trade.comment}",
    )


@app.post("/accounts/{server}/{login}/close", summary="Close positions")
def close(server: str, login: str, req: CloseRequest):
    acc = get_account(server, login)
    return send_command(acc["files_dir"], f"CLOSE|{req.symbol}")


# --- Opposite Copier Engine ---

class OppositeCopier:
    """Polls source account, mirrors trades inverted on target."""

    def __init__(self):
        self.running = False
        self.source = None      # "server/login"
        self.target = None
        self.volume_mult = 1.0
        self.thread = None
        self.known_positions = {}  # ticket -> {symbol, type, volume}
        self.log = []             # [{time, action, detail}, ...]
        self.max_log = 200

    def _log(self, action, detail):
        import datetime
        entry = {
            "time": datetime.datetime.now().strftime("%H:%M:%S"),
            "action": action,
            "detail": detail,
        }
        self.log.append(entry)
        if len(self.log) > self.max_log:
            self.log = self.log[-self.max_log:]
        print(f"[COPIER] {action}: {detail}")

    def start(self, source, target, volume_mult=1.0):
        if self.running:
            self.stop()
        self.source = source
        self.target = target
        self.volume_mult = volume_mult
        self.known_positions = {}
        self.running = True
        self.log = []
        self._log("START", f"Source: {source} → Target: {target} (x{volume_mult}, opposite)")

        # Snapshot current positions so we don't copy pre-existing ones
        self._snapshot_existing()

        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
            self.thread = None
        self._log("STOP", "Copier stopped")

    def _get_acc(self, key):
        server, login = key.split("/", 1)
        return get_account(server, login)

    def _snapshot_existing(self):
        """Record existing positions so they aren't copied."""
        try:
            acc = self._get_acc(self.source)
            result = send_command(acc["files_dir"], "POSITIONS", timeout=10)
            if result.get("positions"):
                for p in result["positions"]:
                    ticket = p.get("pos", "")
                    if ticket:
                        self.known_positions[ticket] = {
                            "symbol": p.get("symbol", ""),
                            "type": p.get("type", ""),
                            "volume": p.get("volume", "0"),
                        }
            self._log("SNAPSHOT", f"Tracking {len(self.known_positions)} existing position(s)")
        except Exception as e:
            self._log("ERROR", f"Snapshot failed: {e}")

    def _loop(self):
        while self.running:
            try:
                self._poll()
            except Exception as e:
                self._log("ERROR", str(e))
            time.sleep(0.2)

    def _poll(self):
        acc = self._get_acc(self.source)
        result = send_command(acc["files_dir"], "POSITIONS", timeout=10)

        current = {}
        if result.get("positions"):
            for p in result["positions"]:
                ticket = p.get("pos", "")
                if ticket:
                    current[ticket] = {
                        "symbol": p.get("symbol", ""),
                        "type": p.get("type", ""),
                        "volume": p.get("volume", "0"),
                    }

        # Detect new positions
        for ticket, pos in current.items():
            if ticket not in self.known_positions:
                self._on_new_position(ticket, pos)

        # Detect closed positions
        for ticket, pos in list(self.known_positions.items()):
            if ticket not in current:
                self._on_closed_position(ticket, pos)

        self.known_positions = current

    def _on_new_position(self, ticket, pos):
        symbol = pos["symbol"]
        src_type = pos["type"]
        volume = round(float(pos["volume"]) * self.volume_mult, 2)
        # Opposite: BUY → SELL, SELL → BUY
        opp_type = "SELL" if src_type == "BUY" else "BUY"

        self._log("NEW", f"Source opened {src_type} {pos['volume']} {symbol} (#{ticket}) → Copying as {opp_type} {volume}")

        try:
            target_acc = self._get_acc(self.target)
            activate_symbol(target_acc["files_dir"], symbol)
            cmd = f"{opp_type}|{symbol}|{volume}|0|0|0|copy_{ticket}"
            result = send_command(target_acc["files_dir"], cmd)
            if result.get("status") == "OK":
                self._log("COPIED", f"{opp_type} {volume} {symbol} @ {result.get('price', '?')} — Deal #{result.get('deal', '?')}")
            else:
                self._log("FAIL", f"Copy failed: {result.get('message', result.get('raw', ''))}")
        except Exception as e:
            self._log("ERROR", f"Copy trade failed: {e}")

    def _on_closed_position(self, ticket, pos):
        symbol = pos["symbol"]
        self._log("CLOSED", f"Source closed {pos['type']} {pos['volume']} {symbol} (#{ticket}) → Closing opposite on target")

        try:
            target_acc = self._get_acc(self.target)
            # Close positions on the same symbol that were opened by the copier
            result = send_command(target_acc["files_dir"], f"CLOSE|{symbol}")
            if result.get("status") == "OK":
                self._log("CLOSED_TARGET", f"Closed {symbol} on target — {result.get('closed', '?')} position(s)")
            else:
                self._log("FAIL", f"Close target failed: {result.get('message', result.get('raw', ''))}")
        except Exception as e:
            self._log("ERROR", f"Close target failed: {e}")

    def status(self):
        return {
            "running": self.running,
            "source": self.source,
            "target": self.target,
            "volume_mult": self.volume_mult,
            "tracked_positions": len(self.known_positions),
            "log": self.log[-50:],
        }


copier = OppositeCopier()


@app.post("/copier/start", summary="Start opposite copy trading")
def copier_start(req: CopierStartRequest):
    # Validate accounts exist
    for key in [req.source, req.target]:
        server, login = key.split("/", 1)
        get_account(server, login)
    if req.source == req.target:
        raise HTTPException(status_code=400, detail="Source and target must be different accounts")
    copier.start(req.source, req.target, req.volume_mult)
    return {"status": "OK", "message": f"Copier started: {req.source} → {req.target}"}


@app.post("/copier/stop", summary="Stop opposite copy trading")
def copier_stop():
    copier.stop()
    return {"status": "OK", "message": "Copier stopped"}


@app.get("/copier/status", summary="Get copier status and log")
def copier_status():
    return copier.status()


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
