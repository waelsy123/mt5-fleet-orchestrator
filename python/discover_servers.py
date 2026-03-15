#!/usr/bin/env python3
"""
MT5 Server Discovery via VNC — Automates the "Open Account" dialog
to discover broker servers that the terminal doesn't know about.

Usage: python3 discover_servers.py <vps-ip> <vnc-ip> <vnc-port> <password> <broker-search> <login>

The script:
1. Connects via VNC to the interactive desktop
2. Ensures a non-portable MT5 terminal is running
3. Opens File > Open an Account
4. Searches for the broker name
5. Selects the server to trigger .srv file download
6. Copies the .srv files to the portable install
7. Restarts the portable terminal

Prerequisites: pip3 install pycryptodome Pillow paramiko
"""
import socket, struct, time, sys, os

# ── Scancode table (US keyboard) ─────────────────────────────────────────
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
    'lalt': 0x38, 'space': 0x39, 'capslock': 0x3A,
    'f1': 0x3B, 'f2': 0x3C, 'f3': 0x3D, 'f4': 0x3E,
    'down': 0xE050, 'up': 0xE048, 'left': 0xE04B, 'right': 0xE04D,
}
SHIFT_MAP = {
    '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
    '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-',
    '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'",
    '<': ',', '>': '.', '?': '/',
}


# ── VNC connection ────────────────────────────────────────────────────────

def des_encrypt_block(key_bytes, data):
    from Crypto.Cipher import DES
    def reverse_bits(b):
        r = 0
        for i in range(8):
            if b & (1 << i): r |= 1 << (7 - i)
        return r
    return DES.new(bytes(reverse_bits(b) for b in key_bytes), DES.MODE_ECB).encrypt(data)


def vnc_connect(vnc_ip, vnc_port, password):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(15)
    sock.connect((vnc_ip, vnc_port))
    sock.recv(12)
    sock.send(b'RFB 003.008\n')
    num = struct.unpack('>B', sock.recv(1))[0]
    sock.recv(num)
    sock.send(bytes([2]))
    challenge = sock.recv(16)
    key = (password + '\0' * 8)[:8].encode('ascii')
    sock.send(des_encrypt_block(key, challenge[:8]) + des_encrypt_block(key, challenge[8:16]))
    if struct.unpack('>I', sock.recv(4))[0] != 0:
        raise Exception("VNC auth failed")
    sock.send(bytes([1]))
    si = sock.recv(24)
    w, h = struct.unpack('>HH', si[0:4])
    sock.recv(struct.unpack('>I', si[20:24])[0])
    encs = [-258, 0, -223, -224]
    sock.send(struct.pack('>BBH', 2, 0, len(encs)))
    for e in encs:
        sock.send(struct.pack('>i', e))
    return sock, w, h


def qemu_key(sock, sc, down):
    """Send QEMU extended key event (scancode-based)."""
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
    for ch in text: type_char(sock, ch)
    time.sleep(0.05)

def vnc_key(sock, keysym, down):
    """Regular VNC key event (keysym, CapsLock-independent)."""
    sock.send(struct.pack('>BBxxI', 4, 1 if down else 0, keysym))
    time.sleep(0.008)

def vnc_press(sock, keysym):
    vnc_key(sock, keysym, True); vnc_key(sock, keysym, False)

def type_str_safe(sock, text):
    for ch in text:
        vnc_press(sock, ord(ch))
    time.sleep(0.05)

def press_enter(sock): press(sock, SC['enter'])

def mouse_click(sock, x, y, button=1):
    """Click at position."""
    sock.send(struct.pack('>BBHH', 5, button, x, y))
    time.sleep(0.05)
    sock.send(struct.pack('>BBHH', 5, 0, x, y))
    time.sleep(0.1)

def capture(sock, w, h, filename):
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
    return img


# ── SSH helpers ───────────────────────────────────────────────────────────

def ssh_connect(ip, password):
    import paramiko
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(ip, username='Administrator', password=password, timeout=15)
    return client

def ssh_run(client, cmd, timeout=60):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    return stdout.read().decode(errors='replace').strip(), stderr.read().decode(errors='replace').strip()


# ── Main discovery flow ──────────────────────────────────────────────────

def ensure_terminal_running(ssh, login):
    """Make sure the non-portable (Program Files) terminal is running on the interactive desktop."""
    out, _ = ssh_run(ssh, 'powershell -Command "Get-Process terminal64 -ErrorAction SilentlyContinue | Select-Object Id"')
    if 'Id' in out and len(out.strip().split('\n')) > 2:
        print("  Terminal already running")
        return True

    print("  Starting terminal via schtasks...")
    # Write a launcher bat
    sftp = ssh.open_sftp()
    with sftp.open("C:/MT5/launch_discover.bat", "w") as f:
        f.write(f'"C:\\Program Files\\MetaTrader 5\\terminal64.exe" /config:"C:\\MT5\\{login}\\startup.ini"\r\n')
    sftp.close()

    ssh_run(ssh, 'schtasks /Create /TN "DiscoverServers" /TR "C:\\MT5\\launch_discover.bat" /SC ONCE /ST 00:00 /RL HIGHEST /F')
    ssh_run(ssh, 'schtasks /Run /TN "DiscoverServers"')
    print("  Terminal launched, waiting 20s for startup...")
    time.sleep(20)
    return True


def copy_srv_files(ssh, login):
    """Find .srv files created by the non-portable terminal and copy them to the portable install."""
    out, _ = ssh_run(ssh, 'powershell -Command "Get-ChildItem C:\\Users\\Administrator\\AppData\\Roaming\\MetaQuotes\\Terminal -Recurse -Filter *.srv -ErrorAction SilentlyContinue | Select-Object FullName"')
    srv_files = [line.strip() for line in out.split('\n') if '.srv' in line and '\\' in line]

    if not srv_files:
        print("  No .srv files found")
        return False

    print(f"  Found {len(srv_files)} .srv file(s)")

    # Create portable config/servers dir
    portable_servers = f"C:\\MT5\\{login}\\config\\servers"
    ssh_run(ssh, f'powershell -Command "New-Item -ItemType Directory -Path \'{portable_servers}\' -Force"')

    # Copy each .srv file
    for srv in srv_files:
        filename = srv.strip().split('\\')[-1]
        dest = f"{portable_servers}\\{filename}"
        ssh_run(ssh, f'powershell -Command "Copy-Item \'{srv.strip()}\' \'{dest}\' -Force"')
        print(f"  Copied {filename} to portable install")

    return True


def restart_portable_terminal(ssh, login):
    """Kill all terminals and start the portable one."""
    print("  Stopping all terminals...")
    ssh_run(ssh, 'powershell -Command "Stop-Process -Name terminal64 -Force -ErrorAction SilentlyContinue"')
    time.sleep(3)

    print("  Starting portable terminal...")
    ssh_run(ssh, f'schtasks /Run /TN "StartMT5_{login}"')
    time.sleep(10)


def discover_servers_vnc(sock, w, h, broker_search):
    """Automate the MT5 Open Account dialog to discover broker servers.

    MT5 "Open Account" wizard flow:
    1. File > Open an Account (or right-click Navigator > Open an Account)
    2. Search field appears with broker list
    3. Type broker name → terminal scans MetaQuotes directory
    4. Select broker → terminal downloads .srv files
    5. Click Next → shows server list
    6. Cancel to exit

    We use keyboard navigation: Alt+F (File menu) → O (Open Account).
    """
    print("  Opening File menu...")
    # Alt+F to open File menu
    qemu_key(sock, SC['lalt'], True)
    press(sock, SC['f'])
    qemu_key(sock, SC['lalt'], False)
    time.sleep(1)

    capture(sock, w, h, "/tmp/vnc_file_menu.png")
    print("  Saved /tmp/vnc_file_menu.png")

    # "Open an Account" is typically the 2nd item in File menu
    # Navigate: press Down twice then Enter
    # Actually in MT5, "Open an Account" shortcut varies.
    # Let's use the menu: press 'a' for "Open an Account" or navigate with arrows
    print("  Selecting 'Open an Account'...")
    # Press down arrow a couple times to reach "Open an Account"
    press(sock, SC['down'])
    time.sleep(0.2)
    press(sock, SC['down'])
    time.sleep(0.2)
    press_enter(sock)
    time.sleep(3)

    capture(sock, w, h, "/tmp/vnc_open_account.png")
    print("  Saved /tmp/vnc_open_account.png")

    # The "Open an Account" dialog should now be visible with a search box
    # The search/filter field is usually at the top and has focus
    # Type the broker search term
    print(f"  Typing broker search: '{broker_search}'...")
    # Select all existing text first (Ctrl+A) then type
    qemu_key(sock, SC['lctrl'], True)
    press(sock, SC['a'])
    qemu_key(sock, SC['lctrl'], False)
    time.sleep(0.3)

    type_str_safe(sock, broker_search)
    time.sleep(1)

    # Press Enter or the scan button to search
    press_enter(sock)
    print("  Scanning for broker servers (waiting 15s)...")
    time.sleep(15)

    capture(sock, w, h, "/tmp/vnc_scan_results.png")
    print("  Saved /tmp/vnc_scan_results.png")

    # Results should show the broker. Click on the first result (it may already be selected)
    # Then press "Next" to advance — this triggers .srv download
    print("  Pressing Next to download server configs...")
    # Tab to the Next button and press Enter
    # In MT5, Tab cycles through controls. Next button is after the server list.
    press(sock, SC['tab'])
    time.sleep(0.3)
    press(sock, SC['tab'])
    time.sleep(0.3)
    press_enter(sock)
    time.sleep(5)

    capture(sock, w, h, "/tmp/vnc_next_step.png")
    print("  Saved /tmp/vnc_next_step.png")

    # Now we should be on the "Account details" page with server dropdown
    # The .srv files have been downloaded. Cancel the wizard.
    print("  Cancelling wizard...")
    press(sock, SC['esc'])
    time.sleep(2)

    capture(sock, w, h, "/tmp/vnc_done.png")
    print("  Saved /tmp/vnc_done.png")


def main():
    if len(sys.argv) < 7:
        print("Usage: python3 discover_servers.py <vps-ip> <vnc-ip> <vnc-port> <password> <broker-search> <login>")
        print()
        print("Example: python3 discover_servers.py 167.86.102.187 5.189.128.199 63238 AQPoS96mqT9x AquaFunded 576984")
        sys.exit(1)

    vps_ip = sys.argv[1]
    vnc_ip = sys.argv[2]
    vnc_port = int(sys.argv[3])
    password = sys.argv[4]
    broker_search = sys.argv[5]
    login = sys.argv[6]

    print(f"╔══════════════════════════════════════════════════════════╗")
    print(f"║  MT5 Server Discovery                                   ║")
    print(f"║  VPS: {vps_ip:<51}║")
    print(f"║  Broker: {broker_search:<48}║")
    print(f"║  Login: {login:<49}║")
    print(f"╚══════════════════════════════════════════════════════════╝")

    # Step 1: Connect SSH and ensure terminal is running
    print("\n[1/5] Connecting SSH...")
    ssh = ssh_connect(vps_ip, password)
    print("  Connected!")

    # Step 2: Ensure non-portable terminal is running
    print("\n[2/5] Ensuring terminal is running on desktop...")
    ensure_terminal_running(ssh, login)

    # Step 3: Connect VNC and automate server discovery
    print(f"\n[3/5] Connecting VNC {vnc_ip}:{vnc_port}...")
    sock, w, h = vnc_connect(vnc_ip, vnc_port, password)
    print(f"  Connected! Screen: {w}x{h}")

    # Wiggle mouse to flush framebuffer
    sock.send(struct.pack('>BBHH', 5, 0, w//2, h//2))
    time.sleep(1)

    # Click on the terminal window to ensure focus (center of screen)
    print("  Clicking to focus terminal...")
    mouse_click(sock, w // 2, h // 2)
    time.sleep(1)

    print("\n[3/5] Automating Open Account dialog...")
    discover_servers_vnc(sock, w, h, broker_search)
    sock.close()

    # Step 4: Copy .srv files to portable install
    print("\n[4/5] Copying .srv files to portable install...")
    found = copy_srv_files(ssh, login)

    if not found:
        # Try again — .srv might be in the portable terminal's own config
        out, _ = ssh_run(ssh, f'powershell -Command "Get-ChildItem C:\\MT5\\{login}\\config\\servers -ErrorAction SilentlyContinue | Select-Object Name"')
        if '.srv' in out.lower():
            print("  .srv files already in portable config")
            found = True

    if not found:
        print("  WARNING: No .srv files found. The broker search may have failed.")
        print("  Check screenshots: /tmp/vnc_*.png")
        print("  You may need to try a different broker search term.")
        # Don't fail — the VNC screenshots will help debug

    # Step 5: Restart portable terminal
    print("\n[5/5] Restarting portable terminal...")
    restart_portable_terminal(ssh, login)

    # Verify connection
    print("\nVerifying broker connection...")
    time.sleep(15)
    out, _ = ssh_run(ssh, f'powershell -Command "type C:\\MT5\\{login}\\logs\\{time.strftime("%Y%m%d")}.log | Select-String -Pattern \"connected|authorized|AquaFunded\" | Select-Object -Last 5"')
    if out:
        print(f"  Log output:\n{out}")
    else:
        print("  No connection entries in log yet")

    ssh.close()

    print("\n" + "=" * 60)
    print("SERVER DISCOVERY COMPLETE")
    print("=" * 60)
    if found:
        print("Server configs (.srv files) copied to portable install.")
        print("The terminal should now be able to connect to the broker.")
    else:
        print("No .srv files were created. Check /tmp/vnc_*.png screenshots")
        print("and retry with a different search term if needed.")


if __name__ == '__main__':
    main()
