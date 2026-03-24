#!/usr/bin/env python3
"""
Hot-update VPS agent and EA — pushes new files via SSH and restarts.

Usage: python3 update_agent.py <vps-ip> <password>

Skips Python/firewall setup (assumes already provisioned).
"""
import os, sys, time, socket

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PYTHON_EXE = r"C:\Program Files\Python312\python.exe"

FILES_TO_COPY = {
    "mt5_multi_api.py": "C:/MT5/mt5_multi_api.py",
    "PythonBridge.mq5": "C:/MT5/PythonBridge.mq5",
    "brokers.json": "C:/MT5/brokers.json",
    "static/index.html": "C:/MT5/static/index.html",
}


def ssh_run(client, cmd, timeout=60):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors='replace').strip()
    err = stderr.read().decode(errors='replace').strip()
    return out, err


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 update_agent.py <vps-ip> <password>")
        sys.exit(1)

    vps_ip = sys.argv[1]
    password = sys.argv[2]

    import paramiko

    print(f"[1/4] Connecting SSH to {vps_ip}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(vps_ip, username='Administrator', password=password, timeout=15)
    print("  Connected!")

    print("[2/4] Uploading files via SFTP...")
    sftp = client.open_sftp()
    for local, remote in FILES_TO_COPY.items():
        local_path = os.path.join(SCRIPT_DIR, local)
        if os.path.exists(local_path):
            sftp.put(local_path, remote)
            print(f"  {local} -> {remote}")
    # Regenerate start_api.ps1
    with sftp.open("C:/MT5/start_api.ps1", "w") as f:
        f.write(
            f'Start-Process "{PYTHON_EXE}" '
            f'-ArgumentList "C:\\MT5\\mt5_multi_api.py" '
            f'-WindowStyle Hidden\r\n'
        )
    sftp.close()
    print("  Done!")

    print("[3/4] Restarting API...")
    ssh_run(client, r'taskkill /f /im python.exe 2>nul', timeout=10)
    time.sleep(2)
    ssh_run(client, r'schtasks /Run /TN MT5API')
    time.sleep(5)

    print("[4/4] Verifying API...")
    import urllib.request
    api_up = False
    for attempt in range(8):
        try:
            resp = urllib.request.urlopen(f"http://{vps_ip}:8000/accounts", timeout=5)
            if resp.status == 200:
                print("  API is running!")
                api_up = True
                break
        except Exception:
            time.sleep(3)

    if api_up:
        # Now call /ea/update to distribute EA to all terminals
        print("[+] Distributing EA to terminals via /ea/update...")
        try:
            ea_path = os.path.join(SCRIPT_DIR, "PythonBridge.mq5")
            with open(ea_path, "r") as f:
                ea_content = f.read()
            import json
            req = urllib.request.Request(
                f"http://{vps_ip}:8000/ea/update",
                data=json.dumps({"content": ea_content}).encode(),
                headers={"Content-Type": "application/json"},
            )
            api_key = os.environ.get("VPS_API_KEY", "")
            if api_key:
                req.add_header("X-Api-Key", api_key)
            resp = urllib.request.urlopen(req, timeout=120)
            result = json.loads(resp.read())
            print(f"  EA reloaded: {result.get('reloaded', '?')}/{result.get('total', '?')} terminals")
        except Exception as e:
            print(f"  EA reload via API failed: {e}")
            print("  (Agent updated — EA reload can be triggered manually later)")
    else:
        print("  WARNING: API not responding — check VPS manually")

    client.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
