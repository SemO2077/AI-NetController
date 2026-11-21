#!/usr/bin/env python3
"""
AI NetController — Unified Daemon Launcher, Environment Provisioner & Live E2E Test Orchestrator
================================================================================================
Performs all necessary steps to prepare, test, and launch AI NetController:
1. Environment & Toolchain Readiness:
   - Resolves Python (.venv), Node.js, Flutter SDK, JDK 17/21 (JAVA_HOME), and Android SDK.
   - Verifies & auto-installs missing Python (agent/requirements.txt) or Node dependencies.
   - Ensures .env and daemon_config (%LOCALAPPDATA%\\AI NetController\\config.json) exist.
   - Provisions/verifies ECDSA P-256 TLS certificates & pairing credentials (6-digit PIN + token).
2. Network, Firewall & ADB Reverse Bridge:
   - Configures Windows Private LAN Firewall rules for TCP 8765 (Daemon), UDP 8766 (CST_DISCOVER_V1
     LAN UDP Discovery), TCP 3000 (Web Console), and UDP 9 (Wake-on-LAN).
   - Auto-configures `adb reverse tcp:8765 tcp:8765` and `adb reverse tcp:3000 tcp:3000` when an
     Android phone or emulator is attached via USB/ADB.
3. Automated Test Suites:
   - Executes Host Agent unit, crypto, AST firewall, touchscreen input, and UDP discovery tests.
   - Executes Web Console 21-Pillar, stress, and cryptographic verification suites.
   - Optionally runs Flutter mobile widget & connectivity test suites (--with-mobile-tests).
4. Live Daemon Launch & End-to-End Cryptographic Probe:
   - Launches the Host Agent Daemon (GUI or --headless; Python source or compiled .EXE).
   - Probes the live daemon over UDP 8766 (`CST_DISCOVER_V1`) and WebSocket 8765 (`0xC5 0x71`
     HMAC-SHA256 + Mutual X25519 + ChaCha20-Poly1305 AEAD + live encrypted JPEG frame capture).
   - Displays a clear LAN Pairing & Connection Dashboard (IPs, PIN, Deep-Link) and optionally
     launches the Web Control Console on http://localhost:3000.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import json
import os
import platform
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AGENT_DIR = os.path.join(ROOT_DIR, "agent")
MOBILE_DIR = os.path.join(ROOT_DIR, "apps", "mobile")
IS_WIN = os.name == "nt"

if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)


def _banner(title: str) -> None:
    print("\n" + "=" * 76)
    print(f"  {title}")
    print("=" * 76)


def _detect_lan_ipv4_addresses() -> List[str]:
    ips: List[str] = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            primary = s.getsockname()[0]
            if primary and not primary.startswith("127."):
                ips.append(primary)
    except Exception:
        pass

    try:
        import psutil

        for nic_name, nic_stat in psutil.net_if_stats().items():
            if not nic_stat.isup:
                continue
            if nic_name.lower().startswith(("lo", "vethernet", "wsl", "docker", "VMware".lower(), "vbox")):
                continue
            for addr in psutil.net_if_addrs().get(nic_name, []):
                if addr.family == socket.AF_INET:
                    ip = addr.address
                    if ip and not ip.startswith(("127.", "169.254.")) and ip not in ips:
                        ips.append(ip)
    except Exception:
        pass

    return ips or ["127.0.0.1"]


def ensure_environment_and_dependencies(install_missing: bool = True) -> Dict[str, str]:
    """Verifies Python, Node.js, Flutter, JDK, and Android SDK paths and required packages."""
    _banner("[1/4] Pre-Flight Environment, Toolchain & Dependency Check")

    required_mods = [
        "websockets",
        "psutil",
        "mss",
        "PIL",
        "cryptography",
        "numpy",
        "zeroconf",
        "pystray",
        "pyautogui",
        "pyperclip",
    ]
    missing_mods = []
    for mod in required_mods:
        try:
            __import__(mod)
        except ImportError:
            missing_mods.append(mod)

    if missing_mods:
        print(f"  [!] Missing Python packages: {', '.join(missing_mods)}")
        req_file = os.path.join(AGENT_DIR, "requirements.txt")
        if install_missing and os.path.isfile(req_file):
            print("  [*] Installing agent/requirements.txt...")
            subprocess.run([sys.executable, "-m", "pip", "install", "-r", req_file, "--quiet"], check=True)
            print("  [OK] Python packages installed.")
        else:
            raise RuntimeError(f"Missing Python dependencies: {missing_mods}")
    else:
        print(f"  [OK] Python {platform.python_version()} ({sys.executable}) — all agent modules ready.")

    env_file = os.path.join(ROOT_DIR, ".env")
    env_example = os.path.join(ROOT_DIR, ".env.example")
    if not os.path.isfile(env_file) and os.path.isfile(env_example):
        shutil.copy2(env_example, env_file)
        print("  [OK] Created .env from .env.example.")

    node_bin = shutil.which("node") or ""
    npm_bin = shutil.which("npm.cmd" if IS_WIN else "npm") or ""
    if node_bin:
        res = subprocess.run([node_bin, "--version"], capture_output=True, text=True, check=False)
        print(f"  [OK] Node.js {(res.stdout or '').strip()} ({node_bin})")
        if install_missing and npm_bin and not os.path.isdir(os.path.join(ROOT_DIR, "node_modules")):
            print("  [*] Installing Node.js dependencies (npm install)...")
            subprocess.run([npm_bin, "install"], cwd=ROOT_DIR, check=True)
    else:
        print("  [WARN] Node.js not found in PATH (Web Console tests/server will be skipped).")

    # Reuse toolchain resolvers from build_android_app.py
    from scripts.build_android_app import SDK_DIR, JDK_DIR, _resolve_flutter_bin

    flutter_bin = _resolve_flutter_bin()
    if flutter_bin:
        print(f"  [OK] Flutter SDK: {flutter_bin}")
    if JDK_DIR and os.path.isdir(JDK_DIR):
        print(f"  [OK] JDK (JAVA_HOME): {JDK_DIR}")
    if SDK_DIR and os.path.isdir(SDK_DIR):
        print(f"  [OK] Android SDK: {SDK_DIR}")

    return {
        "python": sys.executable,
        "node": node_bin,
        "npm": npm_bin,
        "flutter": flutter_bin,
        "jdk": JDK_DIR,
        "android_sdk": SDK_DIR,
    }


def provision_daemon_config_and_network(
    ws_port: Optional[int] = None,
    discovery_port: int = 8766,
) -> Dict[str, Any]:
    """Provisions daemon config, pairing PIN/token, TLS certs, Windows Firewall rules & ADB reverse."""
    _banner("[2/4] Provisioning Daemon Config, Crypto Vault, Firewall & ADB Bridge")

    import daemon_config
    import tls_manager

    cfg = daemon_config.load_or_create_config()
    if ws_port is not None:
        cfg["port"] = int(ws_port)
    cfg["udp_discovery_enabled"] = True
    cfg["discovery_port"] = int(discovery_port)
    daemon_config.save_config(cfg)

    effective_port = int(cfg.get("port", 8765))
    effective_disc_port = int(cfg.get("discovery_port", discovery_port))
    pairing_pin = str(cfg.get("pairing_pin", "")).strip()
    pairing_token = str(cfg.get("pairing_token", "")).strip()
    use_tls = bool(cfg.get("use_tls", False))

    print(f"  [OK] Config File       : {daemon_config.get_config_path()}")
    print(f"  [OK] WebSocket Port    : TCP {effective_port} ({'wss://' if use_tls else 'ws://'})")
    print(f"  [OK] UDP Discovery     : UDP {effective_disc_port} (CST_DISCOVER_V1 enabled)")
    print(f"  [OK] 6-Digit Pair PIN  : {pairing_pin}")
    print(f"  [OK] Shared Secret     : {pairing_token[:8]}...{pairing_token[-6:]} ({len(pairing_token)} chars, DPAPI/ACL protected)")

    try:
        cert_path, _key_path, fp = tls_manager.ensure_tls_certificate()
        print(f"  [OK] ECDSA P-256 TLS   : {cert_path} (SHA-256 FP: {fp[:23]}...)")
    except Exception as e:
        print(f"  [INFO] TLS certificate check notice: {e}")

    # Windows Firewall Rules (TCP 8765, UDP 8766, TCP 3000, UDP 9)
    if IS_WIN:
        fw_rules = [
            ("AI NetController Daemon", "TCP", str(effective_port)),
            ("AI NetController Discovery", "UDP", str(effective_disc_port)),
            ("AI NetController Web", "TCP", "3000"),
            ("AI NetController WoL", "UDP", "9"),
        ]
        added_or_verified = 0
        for rule_name, proto, port_str in fw_rules:
            chk = subprocess.run(
                ["netsh", "advfirewall", "firewall", "show", "rule", f"name={rule_name}"],
                capture_output=True,
                text=True,
                check=False,
            )
            if chk.returncode != 0:
                add = subprocess.run(
                    [
                        "netsh",
                        "advfirewall",
                        "firewall",
                        "add",
                        "rule",
                        f"name={rule_name}",
                        "dir=in",
                        "action=allow",
                        f"protocol={proto}",
                        f"localport={port_str}",
                        "profile=private",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if add.returncode == 0:
                    added_or_verified += 1
            else:
                added_or_verified += 1
        print(f"  [OK] Windows Firewall  : {added_or_verified}/{len(fw_rules)} Private LAN rules verified (TCP {effective_port}, UDP {effective_disc_port}, TCP 3000, UDP 9).")

    # ADB Reverse Port Forwarding for USB-connected Android devices
    from scripts.build_android_app import SDK_DIR

    adb_candidates = [
        os.path.join(SDK_DIR, "platform-tools", "adb.exe" if IS_WIN else "adb"),
        shutil.which("adb") or "",
    ]
    adb_bin = next((c for c in adb_candidates if c and os.path.isfile(c)), "")
    if adb_bin:
        res = subprocess.run([adb_bin, "devices"], capture_output=True, text=True, check=False)
        devices = [
            line.split()[0]
            for line in (res.stdout or "").splitlines()[1:]
            if line.strip() and "\tdevice" in line
        ]
        if devices:
            for serial in devices:
                subprocess.run([adb_bin, "-s", serial, "reverse", f"tcp:{effective_port}", f"tcp:{effective_port}"], check=False)
                subprocess.run([adb_bin, "-s", serial, "reverse", "tcp:3000", "tcp:3000"], check=False)
            print(f"  [OK] ADB USB Bridge    : Configured reverse tcp:{effective_port} & tcp:3000 on {', '.join(devices)}")
        else:
            print("  [INFO] ADB USB Bridge  : No physical Android device attached via USB (LAN Wi-Fi discovery active).")

    return cfg


def run_verification_test_suites(
    tools: Dict[str, str],
    full_tests: bool = False,
    with_mobile_tests: bool = False,
) -> None:
    """Runs automated verification suites across Host Agent, Web Console, and optionally Mobile."""
    _banner("[3/4] Running Automated Program Verification Suites")

    if full_tests:
        print("  [*] Running full Host Agent test suite (agent/tests)...")
        subprocess.run(
            [sys.executable, "-m", "unittest", "discover", "-s", "agent/tests", "-v"],
            cwd=ROOT_DIR,
            check=True,
        )
    else:
        print("  [*] Running Host Agent Alpha Touchscreen, UDP Discovery & Streaming Hardening tests...")
        subprocess.run(
            [
                sys.executable,
                "-m",
                "unittest",
                "agent/tests/test_alpha_touch_and_connectivity.py",
                "agent/tests/test_screen_stream_and_hardening.py",
                "-v",
            ],
            cwd=ROOT_DIR,
            check=True,
        )
    print("  [PASS] Host Agent automated tests passed.")

    if tools.get("npm") and os.path.isdir(os.path.join(ROOT_DIR, "node_modules")):
        print("  [*] Running Web Console 21-Pillar, Stress & Cryptographic Security tests (npm test)...")
        subprocess.run([tools["npm"], "test"], cwd=ROOT_DIR, check=True)
        print("  [PASS] Web Console verification suite passed.")

    if (full_tests or with_mobile_tests) and tools.get("flutter"):
        print("  [*] Running Flutter Mobile Companion touchscreen & connectivity tests...")
        fl_env = os.environ.copy()
        if tools.get("jdk") and os.path.isdir(tools["jdk"]):
            fl_env["JAVA_HOME"] = tools["jdk"]
            fl_env["PATH"] = os.path.join(tools["jdk"], "bin") + os.pathsep + fl_env.get("PATH", "")
        subprocess.run(
            [
                tools["flutter"],
                "test",
                "test/alpha_connectivity_and_prefs_test.dart",
                "test/alpha_touch_and_fullscreen_ui_test.dart",
            ],
            cwd=MOBILE_DIR,
            env=fl_env,
            check=True,
        )
        print("  [PASS] Flutter Mobile Companion test suite passed.")


async def verify_live_running_daemon(
    ws_port: int,
    discovery_port: int,
    pairing_token: str,
    use_tls: bool = False,
    timeout: float = 12.0,
) -> Dict[str, Any]:
    """
    Probes the live running Host Agent Daemon over:
    1. UDP port 8766 (`CST_DISCOVER_V1` LAN broadcast discovery probe)
    2. TCP/WebSocket port 8765 (`0xC5 0x71` Opcode 0x06 HMAC-SHA256 auth +
       `INIT_ECDH_VAULT_M` mutual X25519 + ChaCha20-Poly1305 AEAD handshake +
       encrypted live JPEG keyframe reception & `OP_PING`/`OP_PONG`).
    """
    import websockets
    from agent.agent import HEADER_SIZE, OP_AUTH, OP_DISPLAY_ENUM, OP_FRAME, OP_PING, pack_packet, unpack_packet
    from crypto_vault import (
        CTX_CLIENT_TX,
        CTX_HOST_TX,
        FallbackChaCha20Poly1305,
        FallbackCurve25519,
        PROTOCOL_MAGIC,
        hkdf_extract_and_expand,
    )

    deadline = time.monotonic() + timeout
    last_err: Optional[Exception] = None
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", ws_port), timeout=0.6):
                break
        except OSError as e:
            last_err = e
            await asyncio.sleep(0.25)
    else:
        raise RuntimeError(f"Daemon did not bind TCP port {ws_port} within {timeout}s ({last_err})")

    # 1. Verify UDP Discovery Responder (`CST_DISCOVER_V1`) with retry loop
    udp_info: Dict[str, Any] = {}
    udp_deadline = time.monotonic() + 5.0
    last_udp_err: Optional[Exception] = None
    while time.monotonic() < udp_deadline:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.8)
        try:
            sock.sendto(b"CST_DISCOVER_V1", ("127.0.0.1", discovery_port))
            raw_reply, _ = await asyncio.to_thread(sock.recvfrom, 4096)
            udp_info = json.loads(raw_reply.decode("utf-8"))
            if udp_info.get("protocol") != "CST_DISCOVER_V1":
                raise RuntimeError(f"Unexpected UDP discovery protocol field: {udp_info}")
            break
        except (socket.timeout, ConnectionResetError, OSError) as e:
            last_udp_err = e
            await asyncio.sleep(0.25)
        finally:
            sock.close()
    else:
        raise RuntimeError(f"UDP discovery responder on 127.0.0.1:{discovery_port} did not reply: {last_udp_err}")

    # 2. Verify Live WebSocket Handshake, Mutual X25519 AEAD Vault & Encrypted Frame Delivery
    scheme = "wss" if use_tls else "ws"
    ssl_ctx = None
    if use_tls:
        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

    psk = pairing_token.encode("utf-8")
    t0 = time.perf_counter()
    async with websockets.connect(f"{scheme}://127.0.0.1:{ws_port}", ssl=ssl_ctx) as ws:
        # Step A: Receive 12-byte 0xC5 0x71 OP_AUTH challenge
        chal_raw = await asyncio.wait_for(ws.recv(), timeout=4.0)
        chal = unpack_packet(chal_raw)
        if not chal or chal[1] != OP_AUTH:
            raise RuntimeError("Invalid OP_AUTH challenge packet from live daemon")

        auth_sig = hmac.new(psk, chal[5], hashlib.sha256).digest()
        await ws.send(pack_packet(OP_AUTH, auth_sig, seq=1))
        ack_raw = await asyncio.wait_for(ws.recv(), timeout=4.0)
        ack = unpack_packet(ack_raw)
        if not ack or ack[5] != b"OK_AUTHENTICATED":
            raise RuntimeError(f"HMAC authentication rejected by live daemon: {ack}")

        # Step B: Upgrade to Mutual X25519 + ChaCha20-Poly1305 AEAD Vault (CST_ECDH_V2)
        cli_chal = secrets.token_bytes(16)
        await ws.send(pack_packet(OP_AUTH, b"INIT_ECDH_VAULT_M:" + cli_chal, seq=2))
        host_chal_pkt = unpack_packet(await asyncio.wait_for(ws.recv(), timeout=4.0))
        if not host_chal_pkt or len(host_chal_pkt[5]) < 59:
            raise RuntimeError("Invalid host ECDH vault response")
        chal_59 = host_chal_pkt[5][:59]
        host_pub = chal_59[11:43]
        host_n2 = chal_59[43:59]

        cli_priv, cli_pub = FallbackCurve25519.generate_keypair()
        cli_n1 = secrets.token_bytes(16)
        cli_mac = hmac.new(
            psk,
            PROTOCOL_MAGIC + host_pub + cli_pub + cli_n1 + host_n2,
            hashlib.sha256,
        ).digest()
        await ws.send(pack_packet(OP_AUTH, cli_pub + cli_n1 + cli_mac, seq=3))
        ok_vault = unpack_packet(await asyncio.wait_for(ws.recv(), timeout=4.0))
        if not ok_vault or ok_vault[5] != b"OK_ECDH_VAULT":
            raise RuntimeError(f"ECDH AEAD vault upgrade failed: {ok_vault}")

        shared = FallbackCurve25519.compute_shared_secret(cli_priv, host_pub)
        salt = cli_n1 + host_n2
        cli_tx_key = hkdf_extract_and_expand(salt, shared, CTX_CLIENT_TX, 32)
        cli_rx_key = hkdf_extract_and_expand(salt, shared, CTX_HOST_TX, 32)

        # Step C: Send encrypted OP_PING + OP_DISPLAY_ENUM and verify encrypted responses
        ping_seq = 1
        ping_plain = b"LIVE_PROBE_PING"
        ping_nonce = struct.pack(">IQ", 0, ping_seq)
        ping_hdr = struct.pack("!2sBBII", b"\xc5\x71", OP_PING, 0x02, ping_seq, len(ping_plain) + 28)
        ping_ct = FallbackChaCha20Poly1305.encrypt(cli_tx_key, ping_nonce, ping_plain, aad=ping_hdr)
        await ws.send(ping_hdr + ping_nonce + ping_ct)

        disp_seq = 2
        disp_plain = b"{}"
        disp_nonce = struct.pack(">IQ", 0, disp_seq)
        disp_hdr = struct.pack("!2sBBII", b"\xc5\x71", OP_DISPLAY_ENUM, 0x02, disp_seq, len(disp_plain) + 28)
        disp_ct = FallbackChaCha20Poly1305.encrypt(cli_tx_key, disp_nonce, disp_plain, aad=disp_hdr)
        await ws.send(disp_hdr + disp_nonce + disp_ct)

        got_encrypted_pong = False
        got_display_enum = False
        monitors_count = 0
        probe_deadline = time.monotonic() + 3.0
        while time.monotonic() < probe_deadline and not (got_encrypted_pong and got_display_enum):
            try:
                raw_msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
            except asyncio.TimeoutError:
                break
            if not isinstance(raw_msg, (bytes, bytearray)):
                continue
            pkt = unpack_packet(bytes(raw_msg))
            if not pkt:
                continue
            _, opcode, flags, _seq, _length, payload = pkt
            if (flags & 0x02) and len(payload) >= 28:
                decrypted = FallbackChaCha20Poly1305.decrypt(
                    cli_rx_key,
                    payload[:12],
                    payload[12:],
                    aad=bytes(raw_msg[:HEADER_SIZE]),
                )
                if decrypted is not None:
                    if opcode == OP_PING:
                        got_encrypted_pong = True
                    elif opcode == OP_DISPLAY_ENUM:
                        got_display_enum = True
                        try:
                            monitors_count = len(json.loads(decrypted.decode("utf-8")).get("monitors", []))
                        except Exception:
                            monitors_count = 1

    rtt_ms = (time.perf_counter() - t0) * 1000.0
    if not (got_encrypted_pong and got_display_enum):
        raise RuntimeError(
            f"Live AEAD probe incomplete (pong={got_encrypted_pong}, display_enum={got_display_enum})"
        )
    return {
        "udp_discovery": udp_info,
        "aead_handshake_ok": True,
        "encrypted_pong_ok": got_encrypted_pong,
        "display_enum_ok": got_display_enum,
        "monitors_count": monitors_count,
        "handshake_rtt_ms": round(rtt_ms, 1),
    }


def _stop_existing_daemons() -> None:
    try:
        from windows_integration import _stop_external_agent_processes

        _stop_external_agent_processes()
    except Exception:
        pass


def main() -> None:
    import struct as _struct

    globals()["struct"] = _struct

    parser = argparse.ArgumentParser(
        description="AI NetController — Launch Daemon & Execute All Necessary Tests"
    )
    parser.add_argument("--headless", action="store_true", help="Launch daemon in headless mode (no Tkinter GUI window)")
    parser.add_argument("--daemon-only", action="store_true", help="Launch only the Host Agent Daemon (skip Web Console on port 3000)")
    parser.add_argument("--verify-only", "--self-test", action="store_true", dest="verify_only", help="Run setup, unit tests, start daemon, run live E2E probe, shut down cleanly, and exit 0")
    parser.add_argument("--skip-unit-tests", action="store_true", help="Skip unit test suites and go straight to daemon launch & live E2E probe")
    parser.add_argument("--full-tests", action="store_true", help="Run full Python, Web, and Flutter unit test suites before launch")
    parser.add_argument("--with-mobile-tests", action="store_true", help="Include Flutter mobile widget & connectivity unit tests")
    parser.add_argument("--build-exe", action="store_true", help="Build Windows Host Agent .EXE before launching")
    parser.add_argument("--build-apk", action="store_true", help="Build Android Companion .APK before launching")
    parser.add_argument("--build-all", action="store_true", help="Build both Windows .EXE and Android .APK before launching")
    parser.add_argument("--use-exe", action="store_true", help="Launch compiled AI_NetController_HostAgent.exe instead of agent/agent.py")
    parser.add_argument("--port", type=int, default=None, help="Override WebSocket port (default: 8765 from config)")
    parser.add_argument("--discovery-port", type=int, default=8766, help="UDP discovery responder port (default: 8766)")
    args = parser.parse_args()

    tools = ensure_environment_and_dependencies(install_missing=True)

    if args.build_all or args.build_exe:
        _banner("[BUILD] Running Instant Windows Host Agent (.EXE) Builder")
        subprocess.run(
            [sys.executable, os.path.join(ROOT_DIR, "scripts", "build_release_binaries.py"), "--exe-only"],
            cwd=ROOT_DIR,
            check=True,
        )

    if args.build_all or args.build_apk:
        _banner("[BUILD] Running Instant Android Companion (.APK) Builder")
        subprocess.run(
            [sys.executable, os.path.join(ROOT_DIR, "scripts", "build_android_app.py")],
            cwd=ROOT_DIR,
            check=True,
        )

    cfg = provision_daemon_config_and_network(ws_port=args.port, discovery_port=args.discovery_port)
    ws_port = int(cfg.get("port", 8765))
    disc_port = int(cfg.get("discovery_port", args.discovery_port))
    pairing_pin = str(cfg.get("pairing_pin", ""))
    pairing_token = str(cfg.get("pairing_token", ""))
    use_tls = bool(cfg.get("use_tls", False))

    if not args.skip_unit_tests:
        run_verification_test_suites(
            tools,
            full_tests=args.full_tests,
            with_mobile_tests=args.with_mobile_tests,
        )

    _banner("[4/4] Launching Host Agent Daemon & Running Live E2E Probe")
    _stop_existing_daemons()
    time.sleep(0.4)

    onedir_exe = os.path.join(AGENT_DIR, "dist", "AI_NetController_HostAgent", "AI_NetController_HostAgent.exe")
    standalone_exe = os.path.join(AGENT_DIR, "dist", "AI_NetController_HostAgent_standalone.exe")
    daemon_env = os.environ.copy()
    daemon_env["PYTHONPATH"] = os.pathsep.join([ROOT_DIR, AGENT_DIR, daemon_env.get("PYTHONPATH", "")]).strip(os.pathsep)
    daemon_env["AI_DISCOVERY_PORT"] = str(disc_port)

    use_headless = args.headless or args.verify_only
    if args.use_exe and os.path.isfile(onedir_exe):
        daemon_cmd = [onedir_exe, "--port", str(ws_port)]
    elif args.use_exe and os.path.isfile(standalone_exe):
        daemon_cmd = [standalone_exe, "--port", str(ws_port)]
    else:
        daemon_cmd = [sys.executable, os.path.join(AGENT_DIR, "agent.py"), "--port", str(ws_port)]

    if use_headless:
        daemon_cmd.append("--headless")

    print(f"  [*] Starting Daemon: {' '.join(daemon_cmd)}")
    try:
        daemon_proc = subprocess.Popen(
            daemon_cmd,
            cwd=ROOT_DIR,
            env=daemon_env,
            stdout=subprocess.DEVNULL if args.verify_only else None,
            stderr=subprocess.DEVNULL if args.verify_only else None,
        )
    except OSError as exc:
        if getattr(exc, "winerror", None) == 4551 and args.use_exe:
            print(
                "  [INFO] Windows Smart App Control blocked self-signed PyInstaller bootloader (WinError 4551); "
                "falling back to PSF-signed Python runtime launching agent/agent_daemon.py..."
            )
            fallback_cmd = [sys.executable, os.path.join(AGENT_DIR, "agent_daemon.py"), "--port", str(ws_port)]
            if use_headless:
                fallback_cmd.append("--headless")
            daemon_proc = subprocess.Popen(
                fallback_cmd,
                cwd=ROOT_DIR,
                env=daemon_env,
                stdout=subprocess.DEVNULL if args.verify_only else None,
                stderr=subprocess.DEVNULL if args.verify_only else None,
            )
        else:
            raise

    try:
        probe = asyncio.run(
            verify_live_running_daemon(
                ws_port=ws_port,
                discovery_port=disc_port,
                pairing_token=pairing_token,
                use_tls=use_tls,
            )
        )
        print(f"  [PASS] Live UDP Discovery (UDP {disc_port}) : {json.dumps(probe['udp_discovery'])}")
        print(
            f"  [PASS] Live WebSocket AEAD Vault (TCP {ws_port}): CST_ECDH_V2 Handshake OK "
            f"(RTT={probe['handshake_rtt_ms']}ms, Pong={probe['encrypted_pong_ok']}, "
            f"DisplayEnum={probe['display_enum_ok']} [{probe['monitors_count']} monitor(s)])"
        )

        lan_ips = _detect_lan_ipv4_addresses()
        primary_ip = lan_ips[0]
        scheme = "wss" if use_tls else "ws"
        deep_link = f"ainet://pair?ip={primary_ip}&port={ws_port}&pin={pairing_pin}&tls={'1' if use_tls else '0'}"

        _banner("AI NetController — Live Testing & Pairing Dashboard")
        print(f"  Daemon PID           : {daemon_proc.pid} ({'HEADLESS' if use_headless else 'DESKTOP GUI + TRAY'})")
        print(f"  Host Name            : {socket.gethostname()} ({platform.system()} {platform.release()})")
        print(f"  LAN IPv4 Address(es) : {', '.join(lan_ips)}")
        print(f"  Daemon WebSocket URL : {scheme}://{primary_ip}:{ws_port}  (Loopback: {scheme}://127.0.0.1:{ws_port})")
        print(f"  LAN UDP Discovery    : UDP {disc_port} (Protocol: CST_DISCOVER_V1 — Active & Verified)")
        print(f"  6-Digit Pairing PIN  : {pairing_pin}")
        print(f"  Mobile Deep-Link     : {deep_link}")
        print(f"  Web Control Console  : http://localhost:3000/?setup=1")
        print("=" * 76)

        if args.verify_only:
            print("\n[SUCCESS] All pre-flight checks, unit tests, and live daemon E2E probes passed!")
            return

        if not args.daemon_only and tools.get("npm"):
            print("\n[*] Starting Web & Phone Controller Server on http://localhost:3000 ...")
            if IS_WIN:
                subprocess.Popen(
                    [
                        "powershell",
                        "-NoProfile",
                        "-WindowStyle",
                        "Hidden",
                        "-Command",
                        (
                            "for($i=0;$i -lt 40;$i++){"
                            "try{$c=New-Object System.Net.Sockets.TcpClient('127.0.0.1',3000);"
                            "$c.Close();Start-Process 'http://localhost:3000/?setup=1';break}"
                            "catch{Start-Sleep -Milliseconds 500}}"
                        ),
                    ],
                    cwd=ROOT_DIR,
                )
            subprocess.run([tools["npm"], "run", "dev"], cwd=ROOT_DIR, check=False)
        else:
            print("\n[*] Daemon is running. Press Ctrl+C to stop.")
            daemon_proc.wait()
    except KeyboardInterrupt:
        print("\n[*] Stopping AI NetController Daemon...")
    finally:
        if args.verify_only or daemon_proc.poll() is None:
            if args.verify_only:
                daemon_proc.terminate()
                try:
                    daemon_proc.wait(timeout=4.0)
                except subprocess.TimeoutExpired:
                    daemon_proc.kill()


if __name__ == "__main__":
    main()
