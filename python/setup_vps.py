#!/usr/bin/env python3
"""
Full VPS Setup — takes a fresh Contabo Windows VPS from zero to running MT5 API.

Usage: python3 setup_vps.py <vps-ip> <vnc-ip> <vnc-port> <password>

Example: python3 setup_vps.py 185.211.5.75 213.136.68.101 63089 AQPoS96mqT9x

Prerequisites: pip3 install pycryptodome Pillow paramiko
"""
import socket, struct, time, sys, os

# ── Config ──────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FILES_TO_COPY = {
    "mt5_multi_api.py": "C:/MT5/mt5_multi_api.py",
    "PythonBridge.mq5": "C:/MT5/PythonBridge.mq5",
    "brokers.json": "C:/MT5/brokers.json",
    "static/index.html": "C:/MT5/static/index.html",
    "mt5_config/servers.dat": "C:/MT5/mt5_config/servers.dat",
    "mt5_config/accounts.dat": "C:/MT5/mt5_config/accounts.dat",
}
PYTHON_URL = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"
PYTHON_EXE = r"C:\Program Files\Python312\python.exe"

# ── XT Set 1 Scancodes (US keyboard) ───────────────────────────────────────
SC = {
    'esc': 0x01, '1': 0x02, '2': 0x03, '3': 0x04, '4': 0x05, '5': 0x06,
    '6': 0x07, '7': 0x08, '8': 0x09, '9': 0x0A, '0': 0x0B, '-': 0x0C,
    '=': 0x0D, 'backspace': 0x0E, 'tab': 0x0F,
    'q': 0x10, 'w': 0x11, 'e': 0x12, 'r': 0x13, 't': 0x14, 'y': 0x15,
    'u': 0x16, 'i': 0x17, 'o': 0x18, 'p': 0x19, '[': 0x1A, ']': 0x1B,
    'enter': 0x1C, 'lctrl': 0x1D,
    'a': 0x1E, 's': 0x1F, 'd': 0x20, 'f': 0x21, 'g': 0x22, 'h': 0x23,
    'j': 0x24, 'k': 0x25, 'l': 0x26, ';': 0x27, "'": 0x28, '`': 0x29,
    'lshift': 0x2A, '\\': 0x2B,
    'z': 0x2C, 'x': 0x2D, 'c': 0x2E, 'v': 0x2F, 'b': 0x30, 'n': 0x31,
    'm': 0x32, ',': 0x33, '.': 0x34, '/': 0x35, 'rshift': 0x36,
    'space': 0x39, 'capslock': 0x3A,
}
SHIFT_MAP = {
    '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
    '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-',
    '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'",
    '<': ',', '>': '.', '?': '/',
}


# ══════════════════════════════════════════════════════════════════════════════
# Phase 1: VNC — Unlock Windows, enable SSH
# ══════════════════════════════════════════════════════════════════════════════

def des_encrypt_block(key_bytes, data):
    from Crypto.Cipher import DES
    def reverse_bits(b):
        r = 0
        for i in range(8):
            if b & (1 << i): r |= 1 << (7 - i)
        return r
    return DES.new(bytes(reverse_bits(b) for b in key_bytes), DES.MODE_ECB).encrypt(data)


def vnc_connect(vnc_ip, vnc_port, password):
    """Connect and authenticate to QEMU VNC."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(15)
    sock.connect((vnc_ip, vnc_port))
    sock.recv(12)  # server version
    sock.send(b'RFB 003.008\n')
    num = struct.unpack('>B', sock.recv(1))[0]
    sock.recv(num)  # security types
    sock.send(bytes([2]))  # VNC auth
    # DES challenge-response
    challenge = sock.recv(16)
    key = (password + '\0' * 8)[:8].encode('ascii')
    sock.send(des_encrypt_block(key, challenge[:8]) + des_encrypt_block(key, challenge[8:16]))
    if struct.unpack('>I', sock.recv(4))[0] != 0:
        raise Exception("VNC auth failed — check password")
    sock.send(bytes([1]))  # shared
    si = sock.recv(24)
    w, h = struct.unpack('>HH', si[0:4])
    sock.recv(struct.unpack('>I', si[20:24])[0])  # name
    # Request QEMU extended key events
    encs = [-258, 0, -223, -224]
    sock.send(struct.pack('>BBH', 2, 0, len(encs)))
    for e in encs:
        sock.send(struct.pack('>i', e))
    return sock, w, h


def qemu_key(sock, sc, down):
    sock.send(struct.pack('>BBHII', 255, 0, 1 if down else 0, 0, sc))
    time.sleep(0.008)

def press(sock, sc):
    qemu_key(sock, sc, True); qemu_key(sock, sc, False)

def type_char(sock, ch):
    if ch == ' ':
        press(sock, SC['space'])
    elif ch in SHIFT_MAP:
        sc = SC.get(SHIFT_MAP[ch])
        if sc:
            qemu_key(sock, SC['lshift'], True); press(sock, sc); qemu_key(sock, SC['lshift'], False)
    elif ch.isupper():
        sc = SC.get(ch.lower())
        if sc:
            qemu_key(sock, SC['lshift'], True); press(sock, sc); qemu_key(sock, SC['lshift'], False)
    else:
        sc = SC.get(ch)
        if sc: press(sock, sc)

def type_str(sock, text):
    """Type string using scancodes — use for PowerShell commands."""
    for ch in text: type_char(sock, ch)
    time.sleep(0.05)


def vnc_key(sock, keysym, down):
    """Send regular VNC key event (keysym-based, CapsLock-independent)."""
    sock.send(struct.pack('>BBxxI', 4, 1 if down else 0, keysym))
    time.sleep(0.008)

def vnc_press(sock, keysym):
    vnc_key(sock, keysym, True); vnc_key(sock, keysym, False)

def type_str_safe(sock, text):
    """Type string using VNC keysym events — CapsLock-independent.
    Use this for passwords and simple text (no special shell chars needed)."""
    for ch in text:
        vnc_press(sock, ord(ch))
    time.sleep(0.05)


def press_enter(sock): press(sock, SC['enter'])
def press_ctrl_c(sock):
    qemu_key(sock, SC['lctrl'], True); press(sock, SC['c']); qemu_key(sock, SC['lctrl'], False)

def capture(sock, w, h, filename):
    """Capture VNC screenshot for debugging."""
    from PIL import Image
    sock.send(struct.pack('>BBHHHH', 3, 0, 0, 0, w, h))
    img = Image.new('RGB', (w, h))
    px = img.load()
    deadline = time.time() + 10
    recv = 0
    while time.time() < deadline:
        sock.settimeout(3)
        try: mt = struct.unpack('>B', sock.recv(1))[0]
        except socket.timeout: break
        if mt == 0:
            sock.recv(1)
            for _ in range(struct.unpack('>H', sock.recv(2))[0]):
                rx, ry, rw, rh, enc = struct.unpack('>HHHHi', sock.recv(12))
                if enc == 0:
                    d = b''
                    need = rw * rh * 4
                    while len(d) < need:
                        c = sock.recv(min(need - len(d), 65536))
                        if not c: break
                        d += c
                    for py in range(rh):
                        for ppx in range(rw):
                            o = (py * rw + ppx) * 4
                            if o+3 <= len(d) and rx+ppx < w and ry+py < h:
                                px[rx+ppx, ry+py] = (d[o+2], d[o+1], d[o])
                    recv += rw * rh
                elif enc == -224: break
                elif enc in (-223, -258): pass
                else: break
            if recv >= w * h * 0.5: break
        elif mt == 1: sock.recv(5)
        elif mt == 2: pass
        elif mt == 3:
            sock.recv(3)
            sock.recv(struct.unpack('>I', sock.recv(4))[0])
    img.save(filename)


def send_ctrl_alt_del(sock):
    """Send Ctrl+Alt+Del via VNC key events."""
    sock.send(struct.pack('>BBxxI', 4, 1, 0xFFE3))  # Ctrl down
    sock.send(struct.pack('>BBxxI', 4, 1, 0xFFE9))  # Alt down
    sock.send(struct.pack('>BBxxI', 4, 1, 0xFFFF))  # Delete down
    time.sleep(0.1)
    sock.send(struct.pack('>BBxxI', 4, 0, 0xFFFF))
    sock.send(struct.pack('>BBxxI', 4, 0, 0xFFE9))
    sock.send(struct.pack('>BBxxI', 4, 0, 0xFFE3))


def send_win_r(sock):
    """Send Win+R via VNC key events."""
    sock.send(struct.pack('>BBxxI', 4, 1, 0xFFEB))  # Super/Win
    sock.send(struct.pack('>BBxxI', 4, 1, ord('r')))
    time.sleep(0.1)
    sock.send(struct.pack('>BBxxI', 4, 0, ord('r')))
    sock.send(struct.pack('>BBxxI', 4, 0, 0xFFEB))


def send_alt_y(sock):
    """Send Alt+Y (UAC accept)."""
    sock.send(struct.pack('>BBxxI', 4, 1, 0xFFE9))
    sock.send(struct.pack('>BBxxI', 4, 1, ord('y')))
    time.sleep(0.1)
    sock.send(struct.pack('>BBxxI', 4, 0, ord('y')))
    sock.send(struct.pack('>BBxxI', 4, 0, 0xFFE9))


def is_screen_black(sock, w, h):
    """Check if screen is all black (VPS still booting)."""
    from PIL import Image
    capture(sock, w, h, "/tmp/vnc_check.png")
    img = Image.open("/tmp/vnc_check.png")
    extrema = img.getextrema()
    return max(x[1] for x in extrema) < 20


def send_win_l(sock):
    """Send Win+L to lock the workstation."""
    sock.send(struct.pack('>BBxxI', 4, 1, 0xFFEB))  # Win down
    sock.send(struct.pack('>BBxxI', 4, 1, ord('l')))  # L down
    time.sleep(0.1)
    sock.send(struct.pack('>BBxxI', 4, 0, ord('l')))
    sock.send(struct.pack('>BBxxI', 4, 0, 0xFFEB))




def vnc_enable_ssh(sock, w, h, password):
    """Login to Windows and enable SSH via PowerShell.

    Uses a blind, robust strategy that works regardless of initial state:
    1. Win+L (lock) → Ctrl+Alt+Del → password → Enter (first login attempt)
    2. Blind password change flow (harmless if not needed)
    3. Win+L (lock again) → Ctrl+Alt+Del → password → Enter (definitive login)
    4. Open elevated PowerShell → install OpenSSH → start sshd
    """

    # Wait for VPS to show something (not black)
    print("  Waiting for VPS to boot...")
    time.sleep(10)  # Minimum wait — avoid false positive from BIOS/boot splash
    for i in range(36):  # 3 minutes max
        if not is_screen_black(sock, w, h):
            break
        time.sleep(5)
    else:
        print("  WARNING: Screen still black after 3 min")
        return

    # ══════════════════════════════════════════════════════════════════════
    # Robust login strategy: no screen detection needed.
    #
    # 1. Lock (Win+L) → guaranteed lock screen
    # 2. Ctrl+Alt+Del → type password → Enter
    # 3. Blindly run password change flow (harmless if not needed)
    # 4. Lock again (Win+L) → guaranteed lock screen
    # 5. Ctrl+Alt+Del → type password → Enter → wait for desktop
    #
    # This works because Win+L is safe from ANY state and always results
    # in the lock screen. The password change keystrokes on a loading
    # desktop are harmless (Enter, typing, Tab, Enter — no destructive ops).
    # ══════════════════════════════════════════════════════════════════════

    # ── Step 1: Lock + first login attempt ───────────────────────────────
    print("  Step 1: Lock → login...")
    send_win_l(sock)
    time.sleep(3)

    send_ctrl_alt_del(sock)
    time.sleep(3)
    type_str_safe(sock, password)
    press_enter(sock)
    time.sleep(5)
    capture(sock, w, h, "/tmp/vnc_step1.png")

    # ── Step 2: Password change flow (blind, harmless if not needed) ─────
    print("  Step 2: Password change flow (blind)...")
    # If "must change password" dialog: Enter → new pw fields → type pw+tab+pw → Enter → "changed" → Enter
    # If login succeeded: Enter on dark screen → harmless, typing → harmless
    press_enter(sock)
    time.sleep(2)
    type_str_safe(sock, password)
    press(sock, SC['tab'])
    type_str_safe(sock, password)
    press_enter(sock)
    # Wait long enough for "password changed" dialog to appear (can take 10-15s on fresh VPS)
    time.sleep(15)
    press_enter(sock)  # Dismiss "password changed" dialog
    time.sleep(3)
    # Escape to dismiss any remaining dialogs
    press(sock, SC['esc'])
    time.sleep(2)
    capture(sock, w, h, "/tmp/vnc_step2.png")

    # ── Step 3: Lock again + definitive login ────────────────────────────
    # Win+L ensures we're at lock screen regardless of what happened above
    print("  Step 3: Lock again → final login...")
    send_win_l(sock)
    time.sleep(3)

    send_ctrl_alt_del(sock)
    time.sleep(3)
    type_str_safe(sock, password)
    press_enter(sock)

    # Wait for desktop to fully load (up to 60s for first-time "Personalized Settings")
    print("  Waiting 60s for desktop to load...")
    time.sleep(60)
    capture(sock, w, h, "/tmp/vnc_desktop.png")

    # ── Open elevated PowerShell ────────────────────────────────────────
    print("  Opening PowerShell (Win+R)...")
    send_win_r(sock)
    time.sleep(2)
    type_str(sock, "powershell")
    press_enter(sock)
    time.sleep(3)

    # Elevate
    print("  Elevating to Admin...")
    type_str(sock, "Start-Process powershell -Verb RunAs")
    press_enter(sock)
    time.sleep(3)

    # Accept UAC
    send_alt_y(sock)
    time.sleep(3)

    # ── Install OpenSSH ─────────────────────────────────────────────────
    print("  Installing OpenSSH Server (takes ~60s)...")
    type_str(sock, 'Add-WindowsCapability -Online -Name "OpenSSH.Server~~~~0.0.1.0"')
    press_enter(sock)
    time.sleep(90)

    capture(sock, w, h, "/tmp/vnc_ssh_install.png")

    # Start and configure sshd
    print("  Starting sshd...")
    type_str(sock, "Start-Service sshd")
    press_enter(sock)
    time.sleep(8)

    type_str(sock, "Set-Service -Name sshd -StartupType Automatic")
    press_enter(sock)
    time.sleep(3)

    # Firewall rule
    print("  Adding firewall rule...")
    type_str(sock, "netsh advfirewall firewall add rule name=SSH dir=in action=allow protocol=tcp localport=22")
    press_enter(sock)
    time.sleep(3)

    capture(sock, w, h, "/tmp/vnc_ssh_done.png")


def phase1_vnc(vps_ip, vnc_ip, vnc_port, password):
    """Phase 1: Enable SSH via VNC."""
    print("\n" + "=" * 60)
    print("PHASE 1: Enable SSH via VNC")
    print("=" * 60)

    # Check if SSH already works
    print("\nChecking if SSH is already available...")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(5)
        s.connect((vps_ip, 22))
        s.close()
        print("  SSH port 22 is open — skipping VNC phase!")
        return True
    except:
        print("  SSH not available — proceeding with VNC setup...")

    # Connect to VNC
    print(f"\nConnecting to VNC {vnc_ip}:{vnc_port}...")
    try:
        sock, w, h = vnc_connect(vnc_ip, vnc_port, password)
        print(f"  Connected! Screen: {w}x{h}")
    except Exception as e:
        print(f"  VNC connection failed: {e}")
        return False

    try:
        vnc_enable_ssh(sock, w, h, password)
    finally:
        sock.close()

    # Verify SSH is now accessible
    print("\nVerifying SSH...")
    time.sleep(10)  # Give sshd time to fully start
    for attempt in range(12):  # Up to 60s
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(5)
            s.connect((vps_ip, 22))
            s.close()
            print("  SSH is up!")
            return True
        except Exception:
            if attempt < 11:
                time.sleep(5)
    print("  WARNING: SSH port not responding. Check VNC screenshots in /tmp/vnc_*.png")
    return False


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2: Deploy via SSH
# ══════════════════════════════════════════════════════════════════════════════

def ssh_run(client, cmd, timeout=60):
    """Run command via SSH, return stdout."""
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors='replace').strip()
    err = stderr.read().decode(errors='replace').strip()
    return out, err


def phase2_deploy(vps_ip, password):
    """Phase 2: Deploy MT5 API via SSH."""
    import paramiko

    print("\n" + "=" * 60)
    print("PHASE 2: Deploy MT5 API via SSH")
    print("=" * 60)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"\nConnecting SSH to {vps_ip}...")
    for attempt in range(3):
        try:
            client.connect(vps_ip, username='Administrator', password=password, timeout=15)
            print("  Connected!")
            break
        except Exception as e:
            if attempt < 2:
                print(f"  SSH connect attempt {attempt+1} failed ({e}), retrying in 10s...")
                time.sleep(10)
            else:
                raise

    # Step 0: Fix DNS (Contabo VPS often has broken IPv6-only DNS)
    print("\n[0/6] Fixing DNS...")
    ssh_run(client, 'netsh interface ipv6 set dnsservers "Ethernet" static none 2>nul')
    ssh_run(client, 'netsh interface ipv4 set dnsservers "Ethernet" static 8.8.8.8 primary')
    ssh_run(client, 'netsh interface ipv4 add dnsservers "Ethernet" 8.8.4.4 index=2')
    ssh_run(client, 'ipconfig /flushdns')
    out, _ = ssh_run(client, 'nslookup google.com 8.8.8.8')
    if 'google.com' in out.lower():
        print("  DNS configured (8.8.8.8)")
    else:
        print(f"  WARNING: DNS may not be working: {out[:100]}")

    # Step 1: Install Python
    print("\n[1/6] Installing Python...")
    out, _ = ssh_run(client, f'"{PYTHON_EXE}" --version')
    if 'Python' in out:
        print(f"  Already installed: {out}")
    else:
        print("  Downloading Python...")
        ssh_run(client, f'curl -sLo C:\\python_installer.exe {PYTHON_URL}', timeout=120)
        print("  Installing (this takes ~60s)...")
        ssh_run(client, r'C:\python_installer.exe /quiet InstallAllUsers=1 PrependPath=1', timeout=120)
        # Verify
        for _ in range(12):
            out, _ = ssh_run(client, f'"{PYTHON_EXE}" --version')
            if 'Python' in out:
                break
            time.sleep(5)
        print(f"  {out}")

    # Step 2: Install pip dependencies
    print("\n[2/6] Installing Python dependencies...")
    out, _ = ssh_run(client, f'"{PYTHON_EXE}" -m pip install fastapi uvicorn', timeout=120)
    if 'Successfully installed' in out or 'already satisfied' in out:
        print("  Done!")
    else:
        print(f"  {out[-200:]}")

    # Step 3: Create directories
    print("\n[3/6] Creating directories...")
    ssh_run(client, r'cmd /c "mkdir C:\MT5\static 2>nul & mkdir C:\MT5\mt5_config 2>nul"')
    print("  C:\\MT5\\static ready")
    print("  C:\\MT5\\mt5_config ready")

    # Step 4: Copy files via SFTP (including generated start_api.ps1)
    print("\n[4/6] Copying project files...")
    sftp = client.open_sftp()
    for local, remote in FILES_TO_COPY.items():
        local_path = os.path.join(SCRIPT_DIR, local)
        if os.path.exists(local_path):
            sftp.put(local_path, remote)
            print(f"  {local} -> {remote}")
        else:
            print(f"  WARNING: {local_path} not found, skipping")
    # Write start_api.ps1 via SFTP — avoids shell escaping issues completely
    with sftp.open("C:/MT5/start_api.ps1", "w") as f:
        f.write(
            f'Start-Process "{PYTHON_EXE}" '
            f'-ArgumentList "C:\\MT5\\mt5_multi_api.py" '
            f'-WindowStyle Hidden\r\n'
        )
    print("  Generated start_api.ps1 via SFTP")
    sftp.close()

    # Set API_KEY env var on VPS if VPS_API_KEY is configured in orchestrator
    api_key = os.environ.get("VPS_API_KEY", "")
    if api_key:
        ssh_run(client, f'setx /M API_KEY "{api_key}"')
        print("  API_KEY set as system environment variable")

    # Step 5: Firewall + scheduled task
    print("\n[5/6] Configuring firewall and scheduled task...")
    ssh_run(client, 'netsh advfirewall firewall add rule name=MT5API dir=in action=allow protocol=tcp localport=8000')
    print("  Firewall port 8000 opened")

    ssh_run(client, r'schtasks /Create /TN MT5API /TR "powershell -File C:\MT5\start_api.ps1" /SC ONLOGON /RL HIGHEST /F')
    print("  Scheduled task MT5API created")

    # Step 6: Start API
    print("\n[6/6] Starting API server...")
    # Kill any existing API process to avoid port conflict on re-runs
    ssh_run(client, r'taskkill /f /im python.exe 2>nul', timeout=10)
    time.sleep(2)
    # Start via scheduled task — runs in the interactive session from VNC login.
    # NOTE: Start-Process via SSH does NOT work (child processes die with SSH session).
    ssh_run(client, r'schtasks /Run /TN MT5API')
    time.sleep(8)

    # Verify API with HTTP check (not just port)
    print("  Verifying API...")
    import urllib.request
    api_up = False
    for attempt in range(8):
        try:
            resp = urllib.request.urlopen(f"http://{vps_ip}:8000/accounts", timeout=5)
            if resp.status == 200:
                print("  API is running and responding!")
                api_up = True
                break
        except Exception:
            if attempt < 7:
                time.sleep(3)
    if not api_up:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(5)
            s.connect((vps_ip, 8000))
            s.close()
            print("  API port is open (HTTP may need a few more seconds to initialize)")
        except Exception:
            print("  WARNING: API not responding — check VPS manually")

    client.close()
    return True


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

def main():
    if len(sys.argv) < 5:
        print("Usage: python3 setup_vps.py <vps-ip> <vnc-ip> <vnc-port> <password>")
        print("")
        print("Example: python3 setup_vps.py 185.211.5.75 213.136.68.101 63089 AQPoS96mqT9x")
        print("")
        print("Prerequisites: pip3 install pycryptodome Pillow paramiko")
        sys.exit(1)

    vps_ip = sys.argv[1]
    vnc_ip = sys.argv[2]
    vnc_port = int(sys.argv[3])
    password = sys.argv[4]

    print(f"╔══════════════════════════════════════════════════════════╗")
    print(f"║  MT5 API — Full VPS Setup                              ║")
    print(f"║  VPS: {vps_ip:<51}║")
    print(f"║  VNC: {vnc_ip}:{vnc_port:<39}║")
    print(f"╚══════════════════════════════════════════════════════════╝")

    # Phase 1: VNC → SSH
    if not phase1_vnc(vps_ip, vnc_ip, vnc_port, password):
        print("\nFATAL: Could not enable SSH. Check /tmp/vnc_*.png screenshots.")
        sys.exit(1)

    # Phase 2: SSH → Deploy
    phase2_deploy(vps_ip, password)

    print("\n" + "=" * 60)
    print("SETUP COMPLETE!")
    print("=" * 60)
    print(f"\n  Dashboard: http://{vps_ip}:8000/")
    print(f"  Swagger:   http://{vps_ip}:8000/docs")
    print(f"  SSH:       ssh Administrator@{vps_ip}")
    print(f"\nNext: Open the dashboard → Manage Accounts → Add your broker")

if __name__ == '__main__':
    main()
