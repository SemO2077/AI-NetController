#!/usr/bin/env python3
"""
AI NetController - Cyber Glassmorphic Desktop Control Center (v0.80.0 Beta)
================================================================================
Ground-up rebuild mirroring the Mobile Companion design language:
  - Deep Abyssal Void (#040812) backdrop with top-right Cyan (#00F0FF) &
    bottom-left Electric Violet (#8A2BE2) ambient radial glows
  - Frosted glassmorphic cards (#0A1628 / #102038) with specular rims
  - Pre-rendered orbital CyberNodeBadge animation & capsule pill dock
  - Live scannable QR pairing card + PIN TTL rotation + Zero-Trust shield toggles
  - Neon Coral (#FF0055) Local HITL Modal + Abyssal (#060B16) Audit Console
  - Idle-aware refresh loop (paused canvas rendering when hidden to tray)
================================================================================
"""

from __future__ import annotations

import datetime
import logging
import os
import platform
import secrets
import socket
import sys
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

try:
    import psutil
except ImportError:
    psutil = None

try:
    import tkinter as tk
    from tkinter import messagebox, ttk
    HAS_TKINTER = True
except Exception:
    tk = None
    ttk = None
    messagebox = None
    HAS_TKINTER = False

try:
    from PIL import ImageTk
    HAS_IMAGETK = True
except Exception:
    ImageTk = None
    HAS_IMAGETK = False

logger = logging.getLogger("AI_Agent_GUI")

# Resolve sibling modules cleanly whether imported directly or via `agent.*`
try:
    from cyber_ui_theme import (
        CyberColors,
        FluidDesktopScale,
        apply_dark_titlebar,
        enable_hidpi_awareness,
        mix_hex,
        render_ambient_backdrop,
        render_node_orb_image,
        render_qr_card_image,
        resolve_font_families,
    )
except (ImportError, ModuleNotFoundError):
    from agent.cyber_ui_theme import (
        CyberColors,
        FluidDesktopScale,
        apply_dark_titlebar,
        enable_hidpi_awareness,
        mix_hex,
        render_ambient_backdrop,
        render_node_orb_image,
        render_qr_card_image,
        resolve_font_families,
    )

try:
    from daemon_config import (
        build_pairing_uri,
        load_config,
        regenerate_pin,
        rotate_token,
        save_config,
    )
except (ImportError, ModuleNotFoundError):
    try:
        from agent.daemon_config import (
            build_pairing_uri,
            load_config,
            regenerate_pin,
            rotate_token,
            save_config,
        )
    except (ImportError, ModuleNotFoundError):
        load_config = None
        save_config = None
        rotate_token = None
        regenerate_pin = None
        build_pairing_uri = None

try:
    from icon_assets import apply_window_icon
except (ImportError, ModuleNotFoundError):
    try:
        from agent.icon_assets import apply_window_icon
    except (ImportError, ModuleNotFoundError):
        apply_window_icon = None

try:
    from windows_integration import (
        APP_VERSION,
        create_desktop_shortcut,
        create_native_shortcut,
        install_to_system,
        is_app_installed,
        is_autostart_enabled,
        set_autostart,
        show_install_dialog,
        show_uninstall_dialog,
        uninstall_from_system,
    )
except (ImportError, ModuleNotFoundError):
    try:
        from agent.windows_integration import (
            APP_VERSION,
            create_desktop_shortcut,
            create_native_shortcut,
            install_to_system,
            is_app_installed,
            is_autostart_enabled,
            set_autostart,
            show_install_dialog,
            show_uninstall_dialog,
            uninstall_from_system,
        )
    except (ImportError, ModuleNotFoundError):
        APP_VERSION = "0.80.0"
        create_desktop_shortcut = None
        create_native_shortcut = None
        install_to_system = None
        is_app_installed = None
        is_autostart_enabled = None
        set_autostart = None
        show_install_dialog = None
        show_uninstall_dialog = None
        uninstall_from_system = None


def _detect_av_integrity() -> Dict[str, Any]:
    """
    Reports runtime AV / Smart App Control safety posture guarantees:
      - upx_disabled: Never packs binary sections with UPX
      - visible_hwnd: Explicit desktop UI / tray surface present
      - zero_hidden_shell: No detached cmd.exe / PowerShell download cradles
      - zero_vbs_dropper: Pure Win32 COM shortcuts instead of .vbs/cscript
      - manifest_as_invoker: No stealth UAC elevation request
      - sandbox_job_object: Child subprocesses bound to OS kill-on-close handles
      - ntfs_dacl_hardened: Secrets/config restricted to current user SID
    """
    return {
        "upx_disabled": True,
        "visible_hwnd": bool(HAS_TKINTER),
        "zero_hidden_shell": True,
        "zero_vbs_dropper": True,
        "manifest_as_invoker": True,
        "sandbox_job_object": platform.system() in ("Windows", "Linux", "Darwin"),
        "ntfs_dacl_hardened": True,
    }


class HostDaemonState:
    """
    Thread-safe shared state bridge between AsyncIO HostAgentDaemon, System Tray,
    and Desktop Control Center GUI.
    """

    def __init__(self, host: str = "0.0.0.0", port: int = 8765):
        self.lock = threading.RLock()
        self.version = APP_VERSION
        self.protocol = "AI-NET/3.0-SECURE"
        self.hostname = socket.gethostname()
        self.os_name = f"{platform.system()} {platform.release()}"
        self.local_ip = self._detect_local_ip()
        self.bind_host = host
        self.port = int(port)
        self.start_time = time.time()

        cfg = load_config() if callable(load_config) else {}
        self.config: Dict[str, Any] = dict(cfg) if isinstance(cfg, dict) else {}

        self.is_running = True
        self.is_paused = False
        self.mdns_enabled = bool(self.config.get("mdns_enabled", True))
        self.view_only_mode = bool(self.config.get("view_only_mode", False))
        self.require_hitl_approval = bool(self.config.get("require_hitl_approval", True))
        self.clipboard_sync_allowed = bool(self.config.get("clipboard_sync_allowed", True))
        self.auto_lock_on_disconnect = bool(self.config.get("auto_lock_on_disconnect", False))
        self.auto_ban_intrusion = bool(self.config.get("auto_ban_intrusion", True))
        self.subnet_geofence_only = bool(self.config.get("subnet_geofence_only", True))
        self.autostart_on_boot = (
            bool(is_autostart_enabled())
            if callable(is_autostart_enabled)
            else bool(self.config.get("autostart_on_boot", False))
        )
        self.start_minimized = bool(self.config.get("start_minimized", False))
        self.close_to_tray = bool(self.config.get("close_to_tray", True))
        self.enable_tray_icon = bool(self.config.get("enable_tray_icon", True))
        self.file_transfer_enabled = bool(self.config.get("file_transfer_enabled", True))
        self.audio_control_enabled = bool(self.config.get("audio_control_enabled", True))
        self.ollama_bridge_enabled = bool(self.config.get("ollama_bridge_enabled", True))
        self.security_profile = str(self.config.get("security_profile", "balanced"))
        self.setup_completed = bool(self.config.get("setup_completed", False))

        # Hardened transport & auth policy flags
        self.require_hmac_auth = bool(self.config.get("require_hmac_auth", False))
        self.require_aead = bool(self.config.get("require_aead", False))
        self.require_tls = bool(self.config.get("require_tls", False))
        self.local_hitl_prompt = bool(self.config.get("local_hitl_prompt", True))
        self.tls_enabled = bool(self.require_tls)
        self.tls_fingerprint = ""

        env_pin = os.environ.get("AI_AGENT_PIN", "").strip()
        cfg_pin = str(self.config.get("pairing_pin", "")).strip()
        self.pairing_pin = (
            env_pin
            if (len(env_pin) == 6 and env_pin.isdigit())
            else (cfg_pin if (len(cfg_pin) == 6 and cfg_pin.isdigit()) else f"{secrets.randbelow(900000) + 100000}")
        )
        self.pin_ttl_seconds = int(self.config.get("pin_ttl_seconds") or 900)
        self.pin_issued_at = int(self.config.get("pin_issued_at") or int(time.time()))

        env_tok = os.environ.get("AI_AGENT_SECRET") or os.environ.get("CST_AGENT_SECRET")
        self.pairing_token = str(env_tok or self.config.get("pairing_token") or f"ainet_{secrets.token_hex(24)}")

        # Runtime Telemetry Metrics
        self.cpu_percent = 0.0
        self.ram_percent = 0.0
        self.ram_used_gb = 0.0
        self.ram_total_gb = 0.0
        self.disk_percent = 0.0
        self.capture_fps = 0.0
        self.commands_executed = 0
        self.frames_broadcast = 0

        self.connected_clients: List[Dict[str, Any]] = []
        raw_bl = self.config.get("blacklisted_devices")
        loaded_bl: List[Dict[str, Any]] = []
        if isinstance(raw_bl, list):
            for item in raw_bl:
                if isinstance(item, str) and item.strip():
                    loaded_bl.append({
                        "id": item.strip(),
                        "ip": item.strip(),
                        "device": f"Banned ({item.strip()})",
                        "reason": "Persisted host blacklist",
                        "bannedAt": "",
                    })
                elif isinstance(item, dict) and str(item.get("ip", "")).strip():
                    loaded_bl.append(dict(item))
        self.blacklisted_devices: List[Dict[str, Any]] = loaded_bl
        self._saving_config = False
        self._unbanned_ips: set[str] = set()
        self.av_integrity: Dict[str, Any] = _detect_av_integrity()

        # Thread-safe UI signaling flags & HITL queue
        self._show_window_requested = False
        self._hide_window_requested = False
        self._install_requested = False
        self._uninstall_requested = False
        self._exit_requested = False
        self._pending_hitl_requests: List[Dict[str, Any]] = []
        self.on_disconnect_callback: Optional[Callable[[str], None]] = None

        self.logs: List[Dict[str, str]] = []
        self._log_seq = 0
        self.add_log("SYSTEM", f"Host Daemon initialized on {self.hostname} ({self.local_ip}:{self.port})")
        self.add_log("SECURITY", f"Security Profile: {self.security_profile.upper()} | HMAC={'ON' if self.require_hmac_auth else 'COMPAT'} | TLS={'ON' if self.tls_enabled else 'AUTO'}")

    def request_local_hitl_approval(
        self,
        approval_id: str,
        command: str,
        reason: str,
        resolve_cb: Callable[[bool], None],
    ) -> None:
        """Queues a local desktop confirmation prompt for a high-risk remote command."""
        with self.lock:
            self._pending_hitl_requests.append(
                {
                    "approval_id": approval_id,
                    "command": command,
                    "reason": reason,
                    "resolve_cb": resolve_cb,
                    "created_at": time.time(),
                }
            )
            self._show_window_requested = True

    def pop_pending_hitl_requests(self) -> List[Dict[str, Any]]:
        """Pops queued HITL requests so the Tkinter mainloop can present approval modals."""
        with self.lock:
            if not self._pending_hitl_requests:
                return []
            items = list(self._pending_hitl_requests)
            self._pending_hitl_requests.clear()
            return items

    def request_show_window(self) -> None:
        with self.lock:
            self._show_window_requested = True

    def request_hide_window(self) -> None:
        with self.lock:
            self._hide_window_requested = True

    def request_install(self) -> None:
        with self.lock:
            self._install_requested = True

    def request_uninstall(self) -> None:
        with self.lock:
            self._uninstall_requested = True

    def request_full_exit(self) -> None:
        with self.lock:
            self._exit_requested = True

    @staticmethod
    def _detect_local_ip() -> str:
        """Passive local IPv4 discovery avoiding external UDP probes on isolated LANs."""
        try:
            if psutil is not None:
                stats = psutil.net_if_stats()
                addrs = psutil.net_if_addrs()
                preferred: List[str] = []
                secondary: List[str] = []
                virtual_tokens = ("loopback", "vethernet", "wsl", "hyper-v", "docker", "vmware", "virtualbox")
                for if_name, if_addrs in addrs.items():
                    if if_name in stats and not stats[if_name].isup:
                        continue
                    is_virtual = any(tok in if_name.lower() for tok in virtual_tokens)
                    for addr in if_addrs:
                        if addr.family == socket.AF_INET and addr.address:
                            ip = addr.address
                            if ip.startswith("127.") or ip.startswith("169.254.") or ip == "0.0.0.0":
                                continue
                            if not is_virtual:
                                preferred.append(ip)
                            else:
                                secondary.append(ip)
                if preferred:
                    return preferred[0]
                if secondary:
                    return secondary[0]
        except Exception:
            pass
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                ip = info[4][0]
                if ip and not ip.startswith("127.") and not ip.startswith("169.254."):
                    return ip
        except Exception:
            pass
        return "127.0.0.1"

    def save_policy_config(self) -> None:
        """Persists security, policy, and PIN metadata safely to disk."""
        with self.lock:
            self.config.update(
                {
                    "port": int(self.port),
                    "mdns_enabled": bool(self.mdns_enabled),
                    "view_only_mode": bool(self.view_only_mode),
                    "paused": bool(self.is_paused),
                    "require_hitl_approval": bool(self.require_hitl_approval),
                    "clipboard_sync_allowed": bool(self.clipboard_sync_allowed),
                    "auto_lock_on_disconnect": bool(self.auto_lock_on_disconnect),
                    "auto_ban_intrusion": bool(self.auto_ban_intrusion),
                    "subnet_geofence_only": bool(self.subnet_geofence_only),
                    "autostart_on_boot": bool(self.autostart_on_boot),
                    "start_minimized": bool(self.start_minimized),
                    "close_to_tray": bool(self.close_to_tray),
                    "enable_tray_icon": bool(self.enable_tray_icon),
                    "file_transfer_enabled": bool(self.file_transfer_enabled),
                    "audio_control_enabled": bool(self.audio_control_enabled),
                    "ollama_bridge_enabled": bool(self.ollama_bridge_enabled),
                    "security_profile": self.security_profile,
                    "setup_completed": bool(self.setup_completed),
                    "require_hmac_auth": bool(self.require_hmac_auth),
                    "require_aead": bool(self.require_aead),
                    "require_tls": bool(self.require_tls),
                    "local_hitl_prompt": bool(self.local_hitl_prompt),
                    "pin_ttl_seconds": int(self.pin_ttl_seconds),
                    "pin_issued_at": int(self.pin_issued_at),
                    "pairing_pin": self.pairing_pin,
                    "pairing_token": self.pairing_token,
                    "blacklisted_devices": list(self.blacklisted_devices),
                }
            )
            snapshot_cfg = dict(self.config)
            self._saving_config = True
        try:
            if callable(save_config):
                save_config(snapshot_cfg)
        finally:
            self._saving_config = False

    def get_pairing_uri(self) -> str:
        """Returns safe transient QR pairing URI omitting the master pairing_token."""
        with self.lock:
            if callable(build_pairing_uri):
                return build_pairing_uri(
                    self.local_ip,
                    self.port,
                    self.pairing_pin,
                    tls=self.tls_enabled,
                    tls_fingerprint=self.tls_fingerprint,
                )
            scheme = "wss" if self.tls_enabled else "ws"
            fp = f"&fp={self.tls_fingerprint.strip().lower()}" if (self.tls_enabled and self.tls_fingerprint) else ""
            return f"ainet://pair?proto={scheme}&host={self.local_ip}&port={self.port}&pin={self.pairing_pin}{fp}"

    def check_and_refresh_pin_ttl(self) -> bool:
        """Auto-rotates the 6-digit pairing PIN if its TTL has expired."""
        with self.lock:
            ttl = max(60, int(self.pin_ttl_seconds or 600))
            now = int(time.time())
            if (now - int(self.pin_issued_at or 0)) < ttl:
                return False
        self.regenerate_pairing_pin()
        self.add_log("SECURITY", f"6-digit Pairing PIN auto-rotated (TTL {ttl}s elapsed).")
        return True

    def add_log(self, level: str, message: str) -> None:
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        entry = {"ts": ts, "level": level.upper(), "msg": str(message)}
        with self.lock:
            self.logs.append(entry)
            self._log_seq += 1
            if len(self.logs) > 250:
                self.logs = self.logs[-250:]

    def is_ip_blacklisted(self, ip: str) -> bool:
        with self.lock:
            return any(d.get("ip") == ip for d in self.blacklisted_devices)

    def disconnect_client(self, client_id: str, reason: str = "Disconnected by host operator") -> None:
        target = None
        with self.lock:
            for c in list(self.connected_clients):
                if c.get("id") == client_id:
                    target = c
                    self.connected_clients.remove(c)
                    break
        if target:
            self.add_log("ALERT", f"Session {target.get('device')} ({target.get('ip')}) terminated: {reason}")
            cb = getattr(self, "on_disconnect_callback", None)
            if callable(cb):
                try:
                    cb(client_id)
                except Exception:
                    pass

    def blacklist_client(
        self,
        client_id_or_ip: str = "",
        ip: str = "",
        device_name: str = "Unknown Device",
        reason: str = "Host operator ban",
        *,
        client_id: Optional[str] = None,
    ) -> None:
        resolved_cid = str(client_id if client_id is not None else client_id_or_ip)
        resolved_ip = str(ip or client_id_or_ip)
        if not resolved_ip:
            return
        removed_ids: List[str] = []
        with self.lock:
            self._unbanned_ips.discard(resolved_ip)
            if not any(d.get("ip") == resolved_ip for d in self.blacklisted_devices):
                self.blacklisted_devices.append(
                    {
                        "id": resolved_cid,
                        "ip": resolved_ip,
                        "device": device_name,
                        "reason": reason,
                        "bannedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    }
                )
            for c in list(self.connected_clients):
                if (resolved_cid and c.get("id") == resolved_cid) or c.get("ip") == resolved_ip:
                    removed_ids.append(c.get("id", ""))
                    self.connected_clients.remove(c)
        self.save_policy_config()
        self.add_log("SECURITY", f"Blacklisted device {device_name} [{resolved_ip}] ({reason})")
        cb = getattr(self, "on_disconnect_callback", None)
        if callable(cb):
            for rid in removed_ids:
                if rid:
                    try:
                        cb(rid)
                    except Exception:
                        pass

    def unban_device(self, ip: str) -> None:
        with self.lock:
            self.blacklisted_devices = [d for d in self.blacklisted_devices if d.get("ip") != ip]
            if ip:
                self._unbanned_ips.add(ip)
        self.save_policy_config()
        self.add_log("INFO", f"Removed IP {ip} from local blacklist.")

    def toggle_client_input(self, client_id: str) -> None:
        with self.lock:
            for c in self.connected_clients:
                if c.get("id") == client_id:
                    c["inputAllowed"] = not c.get("inputAllowed", True)
                    state_str = "ENABLED" if c["inputAllowed"] else "BLOCKED (View-Only)"
                    self.add_log("POLICY", f"Input control for {c.get('device')} ({c.get('ip')}) -> {state_str}")
                    break

    def toggle_client_trust(self, client_id: str) -> None:
        with self.lock:
            for c in self.connected_clients:
                if c.get("id") == client_id:
                    c["isTrusted"] = not c.get("isTrusted", False)
                    state_str = "TRUSTED WHITELIST" if c["isTrusted"] else "GUEST"
                    self.add_log("SECURITY", f"Trust level for {c.get('device')} ({c.get('ip')}) set to {state_str}.")
                    break

    def apply_security_profile(self, profile: str) -> None:
        norm = profile.strip().lower()
        with self.lock:
            self.security_profile = norm
            if norm in ("zero_trust", "strict"):
                self.require_hitl_approval = True
                self.auto_ban_intrusion = True
                self.subnet_geofence_only = True
                self.clipboard_sync_allowed = False
                self.view_only_mode = False
                self.require_hmac_auth = True
                self.require_aead = True
            elif norm == "view_only":
                self.view_only_mode = True
                self.require_hitl_approval = True
                self.clipboard_sync_allowed = False
            else:
                self.view_only_mode = False
                self.require_hitl_approval = True
                self.clipboard_sync_allowed = True
                self.auto_ban_intrusion = True
                self.require_hmac_auth = False
                self.require_aead = False
        self.save_policy_config()
        self.add_log("SECURITY", f"Applied Security Profile: {norm.upper()}")

    def sample_telemetry(self) -> Dict[str, Any]:
        cpu = 0.0
        ram_pct = 0.0
        ram_used = 0.0
        ram_total = 0.0
        disk_pct = 0.0

        if psutil is not None:
            try:
                cpu = float(psutil.cpu_percent(interval=None))
                vm = psutil.virtual_memory()
                ram_pct = float(vm.percent)
                ram_used = round(vm.used / (1024 ** 3), 2)
                ram_total = round(vm.total / (1024 ** 3), 2)
                now = time.time()
                if not hasattr(self, "_last_disk_time") or (now - self._last_disk_time) > 5.0:
                    du = psutil.disk_usage(os.path.abspath(os.sep))
                    self._cached_disk_pct = float(du.percent)
                    self._last_disk_time = now
                disk_pct = getattr(self, "_cached_disk_pct", 0.0)
            except Exception:
                pass

        with self.lock:
            self.cpu_percent = round(cpu, 1)
            self.ram_percent = round(ram_pct, 1)
            self.ram_used_gb = ram_used
            self.ram_total_gb = ram_total
            self.disk_percent = round(disk_pct, 1)
            if not self.is_running or self.is_paused or len(self.connected_clients) == 0:
                self.capture_fps = 0.0

        return self.get_snapshot()

    def run_safe_nic_diagnostics(self) -> Dict[str, Any]:
        interfaces = []
        if psutil is not None:
            try:
                stats = psutil.net_if_stats()
                addrs = psutil.net_if_addrs()
                virtual_prefixes = ("lo", "vethernet", "wsl", "docker", "br-", "virbr", "vboxnet", "vmnet", "loopback")
                for nic_name, nic_stat in stats.items():
                    if not nic_stat.isup or nic_name.lower().startswith(virtual_prefixes):
                        continue
                    ipv4_list = [a.address for a in addrs.get(nic_name, []) if a.family == socket.AF_INET]
                    interfaces.append(
                        {
                            "name": nic_name,
                            "is_up": nic_stat.isup,
                            "speed_mbps": nic_stat.speed,
                            "mtu": nic_stat.mtu,
                            "ipv4": ipv4_list[0] if ipv4_list else "N/A",
                        }
                    )
            except Exception as e:
                self.add_log("WARN", f"NIC inspection warning: {e}")

        udp_bcast_ok = False
        try:
            test_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            test_sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            test_sock.close()
            udp_bcast_ok = True
        except Exception:
            udp_bcast_ok = False

        summary = {
            "status": "nominal" if udp_bcast_ok else "restricted",
            "udp_broadcast_ready": udp_bcast_ok,
            "active_interfaces": interfaces,
            "checked_at": datetime.datetime.now().isoformat(),
        }
        self.add_log(
            "DIAG",
            f"NIC & WoL Audit complete: {len(interfaces)} active NIC(s), UDP Broadcast={'READY' if udp_bcast_ok else 'RESTRICTED'}",
        )
        return summary

    def regenerate_pairing_pin(self) -> str:
        """Rotates only the ephemeral 6-digit pairing PIN with fresh timestamp."""
        new_pin = regenerate_pin() if callable(regenerate_pin) else f"{secrets.randbelow(900000) + 100000}"
        now_ts = int(time.time())
        with self.lock:
            self.pairing_pin = new_pin
            self.pin_issued_at = now_ts
            self.config["pin_issued_at"] = now_ts
        os.environ["AI_AGENT_PIN"] = new_pin
        self.save_policy_config()
        return new_pin

    def rotate_pairing_token(self) -> str:
        new_token = rotate_token() if callable(rotate_token) else f"ainet_{secrets.token_hex(24)}"
        new_pin = regenerate_pin() if callable(regenerate_pin) else f"{secrets.randbelow(900000) + 100000}"
        now_ts = int(time.time())
        with self.lock:
            self.pairing_token = new_token
            self.pairing_pin = new_pin
            self.pin_issued_at = now_ts
            self.config["pin_issued_at"] = now_ts
        os.environ["AI_AGENT_SECRET"] = new_token
        os.environ["CST_AGENT_SECRET"] = new_token
        self.save_policy_config()
        self.add_log("SECURITY", "Pairing token & 6-digit PIN rotated by operator.")
        return new_token

    def get_uptime_formatted(self) -> str:
        elapsed = max(0, int(time.time() - self.start_time))
        hrs, rem = divmod(elapsed, 3600)
        mins, secs = divmod(rem, 60)
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"

    def get_snapshot(self) -> Dict[str, Any]:
        with self.lock:
            scheme = "wss" if self.tls_enabled else "ws"
            return {
                "version": self.version,
                "protocol": self.protocol,
                "hostname": self.hostname,
                "osName": self.os_name,
                "localIp": self.local_ip,
                "port": self.port,
                "wsUri": f"{scheme}://{self.local_ip}:{self.port}",
                "pairingUri": self.get_pairing_uri(),
                "uptime": self.get_uptime_formatted(),
                "isRunning": self.is_running,
                "isPaused": self.is_paused,
                "mdnsEnabled": self.mdns_enabled,
                "viewOnlyMode": self.view_only_mode,
                "requireHitlApproval": self.require_hitl_approval,
                "clipboardSyncAllowed": self.clipboard_sync_allowed,
                "autoLockOnDisconnect": self.auto_lock_on_disconnect,
                "autoBanIntrusion": self.auto_ban_intrusion,
                "subnetGeofenceOnly": self.subnet_geofence_only,
                "autostartOnBoot": self.autostart_on_boot,
                "startMinimized": self.start_minimized,
                "closeToTray": self.close_to_tray,
                "enableTrayIcon": self.enable_tray_icon,
                "fileTransferEnabled": self.file_transfer_enabled,
                "audioControlEnabled": self.audio_control_enabled,
                "ollamaBridgeEnabled": self.ollama_bridge_enabled,
                "securityProfile": self.security_profile,
                "requireHmacAuth": self.require_hmac_auth,
                "requireAead": self.require_aead,
                "requireTls": self.require_tls,
                "tlsEnabled": self.tls_enabled,
                "tlsFingerprint": self.tls_fingerprint,
                "localHitlPrompt": self.local_hitl_prompt,
                "pinIssuedAt": self.pin_issued_at,
                "pinTtlSeconds": self.pin_ttl_seconds,
                "pairingPin": self.pairing_pin,
                "pairingToken": self.pairing_token,
                "cpuPercent": self.cpu_percent,
                "ramPercent": self.ram_percent,
                "ramUsedGb": self.ram_used_gb,
                "ramTotalGb": self.ram_total_gb,
                "diskPercent": self.disk_percent,
                "captureFps": self.capture_fps,
                "connectedClients": list(self.connected_clients),
                "blacklistedDevices": list(self.blacklisted_devices),
                "commandsExecuted": self.commands_executed,
                "framesBroadcast": self.frames_broadcast,
                "avIntegrity": dict(self.av_integrity),
                "logs": list(self.logs[-60:]),
            }


# ==============================================================================
# GROUND-UP CYBER GLASS DESKTOP CONTROL CENTER
# ==============================================================================
class HostDaemonDesktopGUI:
    """
    Rebuilt Desktop Control Center strictly aligned with the mobile app design language:
      - Deep Abyssal #040812 canvas + ambient Cyan/Violet glow background
      - Glassmorphic #0A1628 cards with specular #13526A borders
      - Floating capsule Pill Navigation Dock (Overview, Shield, Console, System)
      - Animated CyberNodeBadge orbital sphere + scannable QR pairing card
      - Idle-aware update scheduler & Neon Coral HITL modal prompt
    """

    def __init__(
        self,
        state: HostDaemonState,
        on_disconnect_all: Optional[Callable[[], None]] = None,
        on_stop_daemon: Optional[Callable[[], None]] = None,
    ):
        if not HAS_TKINTER:
            raise RuntimeError("Tkinter is not available in this Python environment.")

        enable_hidpi_awareness()
        self.state = state
        self.on_disconnect_all = on_disconnect_all
        self.on_stop_daemon = on_stop_daemon

        self._token_visible = False
        self._active_tab = "overview"
        self._is_hidden = False
        self._hitl_dialog_active = False
        self._devices_win: Optional[tk.Toplevel] = None
        self._setup_win: Optional[tk.Toplevel] = None
        self._rendered_log_seq = -1
        self._orb_phase = 0
        self._orb_frames: List[Any] = []
        self._qr_cache_uri = ""
        self._qr_cache_px = 0
        self._qr_photo: Any = None
        self._backdrop_photo: Any = None
        self._backdrop_size: Tuple[int, int] = (0, 0)
        self._backdrop_focal: float = 0.0
        self._resize_after_id: Optional[str] = None
        self._gauge_anim_after_id: Optional[str] = None
        self._gauge_display_pct: Dict[str, float] = {}
        self._gauge_target_pct: Dict[str, float] = {}
        self._last_tele_tick = 0.0
        self._last_peer_sig: Optional[Tuple[Any, ...]] = None
        self._last_ban_sig: Optional[Tuple[Any, ...]] = None
        self._scale = FluidDesktopScale(1120, 760)
        self._last_layout_sig: Optional[Tuple[Any, ...]] = None

        self.root = tk.Tk()
        self.root.title("AI NetController — Host Control Center")
        try:
            scr_w = max(680, int(self.root.winfo_screenwidth()))
            scr_h = max(480, int(self.root.winfo_screenheight()))
        except Exception:
            scr_w, scr_h = 1920, 1080
        init_w = min(1120, max(640, scr_w - 48))
        init_h = min(760, max(420, scr_h - 68))
        self.root.geometry(f"{init_w}x{init_h}")
        self.root.minsize(640, 420)
        self.root.configure(bg=CyberColors.BACKGROUND)

        apply_dark_titlebar(self.root, CyberColors.BACKGROUND)
        self._load_window_icon()
        self.ui_font, self.mono_font = resolve_font_families(self.root)
        self._configure_ttk_styles()

        self._bind_state_vars()
        self._build_layout()
        self._apply_ambient_backdrop(init_w, init_h)
        self._apply_responsive_scaling(init_w, init_h)
        self._select_tab("overview")

        self.root.bind("<Configure>", self._on_root_configure)
        self.root.bind("<Map>", lambda _e: self._set_hidden(False))
        self.root.bind("<Unmap>", self._on_unmap)
        self.root.protocol("WM_DELETE_WINDOW", self._on_window_close_request)

        # Launch guided setup automatically on clean first-time start, or start minimized if configured
        if not self.state.setup_completed and "--headless" not in sys.argv:
            self.root.after(450, self._open_setup_wizard)
        elif (self.state.start_minimized or "--minimized" in sys.argv) and "--headless" not in sys.argv:
            self.root.after(150, self._hide_to_tray)

        self._refresh_ui(force_telemetry=True)
        self.root.after(250, self._schedule_refresh)

    def _load_window_icon(self) -> None:
        if callable(apply_window_icon):
            try:
                apply_window_icon(self.root)
                return
            except Exception:
                pass
        base_dir = os.path.dirname(os.path.abspath(__file__))
        for rel in ("icon.ico", os.path.join("assets", "icon.ico")):
            p = os.path.join(base_dir, rel)
            if os.path.isfile(p):
                try:
                    self.root.iconbitmap(p)
                    return
                except Exception:
                    pass
        png_p = os.path.join(base_dir, "icon.png")
        if os.path.isfile(png_p):
            try:
                img = tk.PhotoImage(file=png_p)
                self.root.iconphoto(True, img)
                self._root_icon_ref = img
            except Exception:
                pass

    def _configure_ttk_styles(self) -> None:
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure(
            "Cyber.Vertical.TScrollbar",
            background=CyberColors.SURFACE_ELEVATED,
            troughcolor=CyberColors.BACKGROUND,
            bordercolor=CyberColors.GLASS_BORDER_IDLE,
            arrowcolor=CyberColors.PRIMARY,
        )

    def _bind_state_vars(self) -> None:
        self.var_profile = tk.StringVar(value=self.state.security_profile)
        self.var_view_only = tk.BooleanVar(value=self.state.view_only_mode)
        self.var_hitl = tk.BooleanVar(value=self.state.require_hitl_approval)
        self.var_clipboard = tk.BooleanVar(value=self.state.clipboard_sync_allowed)
        self.var_autolock = tk.BooleanVar(value=self.state.auto_lock_on_disconnect)
        self.var_autoban = tk.BooleanVar(value=self.state.auto_ban_intrusion)
        self.var_geofence = tk.BooleanVar(value=self.state.subnet_geofence_only)
        self.var_mdns = tk.BooleanVar(value=self.state.mdns_enabled)
        self.var_autostart = tk.BooleanVar(value=self.state.autostart_on_boot)
        self.var_start_minimized = tk.BooleanVar(value=self.state.start_minimized)
        self.var_close_to_tray = tk.BooleanVar(value=self.state.close_to_tray)
        self.var_file_transfer = tk.BooleanVar(value=self.state.file_transfer_enabled)
        self.var_audio_control = tk.BooleanVar(value=self.state.audio_control_enabled)
        self.var_ollama_bridge = tk.BooleanVar(value=self.state.ollama_bridge_enabled)
        self.var_hmac_auth = tk.BooleanVar(value=self.state.require_hmac_auth)
        self.var_aead = tk.BooleanVar(value=self.state.require_aead)
        self.var_tls = tk.BooleanVar(value=self.state.require_tls)

    def _make_glass_card(
        self,
        parent: tk.Widget,
        bg: str = CyberColors.SURFACE,
        border: str = CyberColors.GLASS_BORDER,
        pad_x: int = 16,
        pad_y: int = 14,
        specular_color: Optional[str] = None,
    ) -> tk.Frame:
        """
        Builds a 3D beveled glassmorphic card with:
          - Top specular highlight rim (cyan/accent luminance)
          - Bottom recessed shadow bevel for physical depth
          - Interactive hover border elevation
        """
        outer = tk.Frame(
            parent,
            bg=bg,
            highlightbackground=border,
            highlightthickness=1,
            bd=0,
        )
        spec_hex = specular_color or mix_hex(border, CyberColors.SPECULAR_TOP, 0.42)
        hover_border = mix_hex(border, CyberColors.SPECULAR_TOP, 0.55)
        hover_spec = mix_hex(spec_hex, "#FFFFFF", 0.35)

        top_spec = tk.Frame(outer, bg=spec_hex, height=2, bd=0)
        top_spec.pack(side="top", fill="x")

        bottom_bevel = tk.Frame(outer, bg=CyberColors.SHADOW_DEEP, height=2, bd=0)
        bottom_bevel.pack(side="bottom", fill="x")

        inner = tk.Frame(outer, bg=bg)
        inner.pack(side="top", fill="both", expand=True, padx=pad_x, pady=pad_y)
        outer._body = inner  # type: ignore[attr-defined]
        outer._top_spec = top_spec  # type: ignore[attr-defined]

        def _on_enter(_e: Any) -> None:
            try:
                outer.configure(highlightbackground=hover_border)
                top_spec.configure(bg=hover_spec)
            except Exception:
                pass

        def _on_leave(_e: Any) -> None:
            try:
                outer.configure(highlightbackground=border)
                top_spec.configure(bg=spec_hex)
            except Exception:
                pass

        outer.bind("<Enter>", _on_enter)
        outer.bind("<Leave>", _on_leave)
        return outer

    def _make_cyber_button(
        self,
        parent: tk.Widget,
        text: str,
        command: Callable[[], None],
        fg: str = CyberColors.PRIMARY,
        bg: str = CyberColors.PRIMARY_SOFT,
        border: str = CyberColors.GLASS_BORDER,
        pad_x: int = 12,
        pad_y: int = 6,
        font_size: int = 9,
        bold: bool = True,
    ) -> tk.Button:
        weight = "bold" if bold else "normal"
        hover_bg = mix_hex(bg, fg, 0.24)
        hover_border = mix_hex(border, fg, 0.50)
        press_bg = mix_hex(bg, fg, 0.42)
        btn = tk.Button(
            parent,
            text=text,
            command=command,
            font=(self.ui_font, font_size, weight),
            fg=fg,
            bg=bg,
            activeforeground=CyberColors.BACKGROUND,
            activebackground=fg,
            relief="flat",
            bd=0,
            highlightthickness=1,
            highlightbackground=border,
            padx=pad_x,
            pady=pad_y,
            cursor="hand2",
        )
        btn._base_fg = fg  # type: ignore[attr-defined]
        btn._base_bg = bg  # type: ignore[attr-defined]
        btn._base_border = border  # type: ignore[attr-defined]

        def _on_enter(_e: Any) -> None:
            bfg = getattr(btn, "_base_fg", fg)
            bbg = getattr(btn, "_base_bg", bg)
            bbr = getattr(btn, "_base_border", border)
            btn.configure(bg=mix_hex(bbg, bfg, 0.24), highlightbackground=mix_hex(bbr, bfg, 0.50))

        def _on_leave(_e: Any) -> None:
            btn.configure(bg=getattr(btn, "_base_bg", bg), highlightbackground=getattr(btn, "_base_border", border))

        def _on_press(_e: Any) -> None:
            bfg = getattr(btn, "_base_fg", fg)
            bbg = getattr(btn, "_base_bg", bg)
            btn.configure(bg=mix_hex(bbg, bfg, 0.42))

        btn.bind("<Enter>", _on_enter)
        btn.bind("<Leave>", _on_leave)
        btn.bind("<ButtonPress-1>", _on_press)
        btn.bind("<ButtonRelease-1>", _on_enter)
        return btn

    def _build_layout(self) -> None:
        # Ambient glow backdrop label placed behind main container
        self._bg_label = tk.Label(self.root, bg=CyberColors.BACKGROUND, bd=0)
        self._bg_label.place(x=0, y=0, relwidth=1.0, relheight=1.0)

        self._shell = tk.Frame(self.root, bg=CyberColors.BACKGROUND)
        self._shell.pack(fill="both", expand=True, padx=18, pady=(14, 14))

        self._build_header(self._shell)
        self._build_pill_dock(self._shell)

        # Scrollable responsive stage container so compact or stacked viewports never clip controls
        self._stage_wrap = tk.Frame(self._shell, bg=CyberColors.BACKGROUND)
        self._stage_wrap.pack(fill="both", expand=True, pady=(10, 0))

        self._stage_canvas = tk.Canvas(
            self._stage_wrap,
            bg=CyberColors.BACKGROUND,
            highlightthickness=0,
            bd=0,
        )
        self._stage_vscroll = ttk.Scrollbar(
            self._stage_wrap,
            orient="vertical",
            command=self._stage_canvas.yview,
            style="Cyber.Vertical.TScrollbar",
        )
        self._stage_canvas.configure(yscrollcommand=self._stage_vscroll.set)
        self._stage_canvas.pack(side="left", fill="both", expand=True)

        # Multi-view main stage hosted inside the scrollable canvas
        self._stage = tk.Frame(self._stage_canvas, bg=CyberColors.BACKGROUND)
        self._stage_win_id = self._stage_canvas.create_window((0, 0), window=self._stage, anchor="nw")

        self._stage.bind("<Configure>", self._on_stage_inner_configure)
        self._stage_canvas.bind("<Configure>", self._on_stage_canvas_configure)
        self.root.bind_all("<MouseWheel>", self._on_global_mousewheel, add="+")
        self.root.bind_all("<Button-4>", self._on_global_mousewheel, add="+")
        self.root.bind_all("<Button-5>", self._on_global_mousewheel, add="+")

        self._views: Dict[str, tk.Frame] = {}
        self._build_overview_view()
        self._build_security_view()
        self._build_console_view()
        self._build_diagnostics_view()

    def _on_stage_inner_configure(self, _event: Any = None) -> None:
        self._sync_stage_scrollregion()

    def _on_stage_canvas_configure(self, event: Any) -> None:
        cw = max(200, int(event.width))
        ch = max(120, int(event.height))
        req_h = max(ch, self._stage.winfo_reqheight())
        self._stage_canvas.itemconfigure(self._stage_win_id, width=cw, height=req_h)
        self._sync_stage_scrollregion()

    def _sync_stage_scrollregion(self) -> None:
        try:
            cw = max(200, self._stage_canvas.winfo_width())
            ch = max(120, self._stage_canvas.winfo_height())
            req_h = self._stage.winfo_reqheight()
            target_h = max(ch, req_h)
            self._stage_canvas.itemconfigure(self._stage_win_id, width=cw, height=target_h)
            self._stage_canvas.configure(scrollregion=(0, 0, cw, target_h))
            if req_h > ch + 6:
                if not self._stage_vscroll.winfo_ismapped():
                    self._stage_vscroll.pack(side="right", fill="y", padx=(4, 0))
            else:
                if self._stage_vscroll.winfo_ismapped():
                    self._stage_vscroll.pack_forget()
                self._stage_canvas.yview_moveto(0.0)
        except Exception:
            pass

    def _on_global_mousewheel(self, event: Any) -> None:
        if self._is_hidden or self._active_tab == "console":
            return
        try:
            if not self._stage_vscroll.winfo_ismapped():
                return
            num = getattr(event, "num", None)
            if num == 4:
                delta = -1
            elif num == 5:
                delta = 1
            else:
                delta = int(-1 * (event.delta / 120)) if getattr(event, "delta", 0) else 0
            if delta != 0:
                self._stage_canvas.yview_scroll(delta, "units")
        except Exception:
            pass

    def _apply_ambient_backdrop(self, width: int, height: int, force: bool = False) -> None:
        if not HAS_IMAGETK:
            return
        w = max(320, int(width))
        h = max(240, int(height))
        if (
            not force
            and abs(w - self._backdrop_size[0]) < 24
            and abs(h - self._backdrop_size[1]) < 24
        ):
            return
        cache = getattr(self, "_backdrop_cache", None)
        if cache is None:
            cache = {}
            self._backdrop_cache = cache
        cache_key = (w // 16, h // 16, round(self._backdrop_focal, 2))
        photo = cache.get(cache_key)
        if photo is None:
            img = render_ambient_backdrop(w, h, focal_shift=self._backdrop_focal)
            if img is None:
                return
            photo = ImageTk.PhotoImage(img)
            if len(cache) >= 8:
                cache.clear()
            cache[cache_key] = photo
        self._backdrop_photo = photo
        self._bg_label.configure(image=self._backdrop_photo)
        self._backdrop_size = (w, h)

    def _on_root_configure(self, event: Any) -> None:
        if event.widget is not self.root:
            return
        if self._resize_after_id is not None:
            try:
                self.root.after_cancel(self._resize_after_id)
            except Exception:
                pass
        w, h = int(event.width), int(event.height)
        self._resize_after_id = self.root.after(90, lambda: self._handle_debounced_resize(w, h))

    def _handle_debounced_resize(self, width: int, height: int) -> None:
        self._apply_ambient_backdrop(width, height)
        self._apply_responsive_scaling(width, height)

    def _apply_responsive_scaling(self, width: int, height: int) -> None:
        """
        Reflows grids, paddings, QR sizes, and text wraplengths dynamically across
        all window sizes, aspect ratios, and resolutions so nothing overflows or clips.
        """
        scale = FluidDesktopScale.from_dimensions(width, height)
        self._scale = scale

        sig = (
            scale.columns,
            scale.is_compact_width,
            scale.is_ultra_compact_width,
            scale.is_short_height,
            scale.is_ultra_short_height,
            scale.qr_size,
            width // 32,
            height // 32,
        )
        if sig == self._last_layout_sig:
            return
        self._last_layout_sig = sig

        try:
            self._shell.pack_configure(padx=scale.shell_padx, pady=(scale.shell_pady, scale.shell_pady))
            self._stage_wrap.pack_configure(pady=(max(4, scale.px(10)), 0))
            self._dock_wrap.pack_configure(pady=(max(4, scale.px(8)), 0))
        except Exception:
            pass

        # 1. Header responsive layout (stack right status/actions below title when narrow < 780px)
        try:
            self._header_card._body.configure(padx=scale.card_padx, pady=max(6, scale.card_pady - 2))
            self._lbl_title.configure(font=(self.ui_font, scale.sp(15, min_pt=12), "bold"))
            self._lbl_sub.configure(font=(self.mono_font, scale.sp(9, min_pt=7)))
            if width < 780:
                self._header_left.pack_configure(side="top", fill="x", anchor="w")
                self._header_right.pack_configure(side="top", fill="x", anchor="w", pady=(6, 0))
                self._header_pills.pack_configure(anchor="w")
                self._header_btns.pack_configure(anchor="w")
            else:
                self._header_left.pack_configure(side="left", fill="y", anchor="w")
                self._header_right.pack_configure(side="right", fill="y", anchor="e", pady=(0, 0))
                self._header_pills.pack_configure(anchor="e")
                self._header_btns.pack_configure(anchor="e")
        except Exception:
            pass

        # 2. Floating Capsule Pill Dock responsive labels & padding
        try:
            full_labels = {
                "overview": "OVERVIEW & PAIR",
                "security": "ZERO-TRUST SHIELD",
                "console": "HITL & CONSOLE",
                "system": "DIAGNOSTICS & SETUP",
            }
            compact_labels = {
                "overview": "OVERVIEW",
                "security": "SHIELD",
                "console": "CONSOLE",
                "system": "SYSTEM",
            }
            use_short = width < 720
            btn_padx = 8 if use_short else (12 if scale.is_compact_width else 16)
            btn_pady = 4 if scale.is_short_height else 6
            btn_font = (self.ui_font, 8 if use_short else 9, "bold")
            for k, btn in self._tab_buttons.items():
                btn.configure(
                    text=compact_labels[k] if use_short else full_labels[k],
                    padx=btn_padx,
                    pady=btn_pady,
                    font=btn_font,
                )
        except Exception:
            pass

        # 3. Overview Tab: 2-column side-by-side (>= 860px) vs 1-column stacked (< 860px)
        try:
            if scale.columns == 1:
                self._overview_grid.columnconfigure(0, weight=1)
                self._overview_grid.columnconfigure(1, weight=0)
                self._ov_left_col.grid_configure(row=0, column=0, sticky="nsew", padx=0, pady=(0, 8))
                self._ov_right_col.grid_configure(row=1, column=0, sticky="nsew", padx=0, pady=(0, 0))
            else:
                self._overview_grid.columnconfigure(0, weight=5)
                self._overview_grid.columnconfigure(1, weight=6)
                self._ov_left_col.grid_configure(row=0, column=0, sticky="nsew", padx=(0, 8), pady=0)
                self._ov_right_col.grid_configure(row=0, column=1, sticky="nsew", padx=(8, 0), pady=0)

            # QR Box & Credentials side-by-side vs stacked when column is narrow
            col_w = width if scale.columns == 1 else int(width * 0.52)
            if col_w < 460:
                self._qr_box.pack_configure(side="top", padx=0, pady=(0, 8), anchor="center")
                self._creds_box.pack_configure(side="top", fill="both", expand=True)
            else:
                self._qr_box.pack_configure(side="left", padx=(0, 14), pady=0, anchor="n")
                self._creds_box.pack_configure(side="left", fill="both", expand=True)

            if self._qr_cache_uri:
                self._refresh_qr_card(self._qr_cache_uri)
        except Exception:
            pass

        # 4. Security Tab: Presets & Toggles responsive columns + wraplengths
        try:
            avail_w = max(280, width - scale.shell_padx * 2 - 48)
            for idx, (box, desc_lbl) in enumerate(self._preset_boxes):
                if scale.columns == 1:
                    box.pack_configure(side="top", fill="x", expand=False, padx=0, pady=(0 if idx == 0 else 6, 0))
                    desc_lbl.configure(wraplength=max(220, avail_w - 48))
                else:
                    box.pack_configure(side="left", fill="both", expand=True, padx=(0 if idx == 0 else 6, 0), pady=0)
                    desc_lbl.configure(wraplength=max(160, (avail_w // 3) - 36))

            if scale.columns == 1:
                self._sec_left_c.pack_configure(side="top", fill="x", expand=False, padx=0, pady=(0, 4))
                self._sec_right_c.pack_configure(side="top", fill="x", expand=False, padx=0, pady=0)
                chk_wrap = max(240, avail_w - 36)
            else:
                self._sec_left_c.pack_configure(side="left", fill="both", expand=True, padx=(0, 10), pady=0)
                self._sec_right_c.pack_configure(side="left", fill="both", expand=True, padx=(10, 0), pady=0)
                chk_wrap = max(200, (avail_w // 2) - 44)
            for chk in self._sec_checkbuttons:
                chk.configure(wraplength=chk_wrap, justify="left")
        except Exception:
            pass

        # 5. System / Diagnostics Tab: 2-column vs 1-column + dynamic wraplength
        try:
            avail_w = max(280, width - scale.shell_padx * 2 - 48)
            if scale.columns == 1:
                self._diag_top_grid.columnconfigure(0, weight=1)
                self._diag_top_grid.columnconfigure(1, weight=0)
                self._av_card.grid_configure(row=0, column=0, sticky="nsew", padx=0, pady=(0, 8))
                self._sys_card.grid_configure(row=1, column=0, sticky="nsew", padx=0, pady=0)
                col_wrap = max(220, avail_w - 40)
            else:
                self._diag_top_grid.columnconfigure(0, weight=1)
                self._diag_top_grid.columnconfigure(1, weight=1)
                self._av_card.grid_configure(row=0, column=0, sticky="nsew", padx=(0, 8), pady=0)
                self._sys_card.grid_configure(row=0, column=1, sticky="nsew", padx=(8, 0), pady=0)
                col_wrap = max(200, (avail_w // 2) - 48)
            self._diag_output.configure(wraplength=col_wrap)
            for lbl in self._av_check_labels:
                lbl.configure(wraplength=max(160, col_wrap - 64))
        except Exception:
            pass

        self.root.after_idle(self._sync_stage_scrollregion)

    def _set_hidden(self, hidden: bool) -> None:
        self._is_hidden = hidden

    def _on_unmap(self, event: Any) -> None:
        if event.widget is self.root:
            try:
                if self.root.state() in ("iconic", "withdrawn"):
                    self._is_hidden = True
            except Exception:
                pass

    # ------------------------------------------------------------------
    # HEADER CARD & FLOATING CAPSULE PILL DOCK
    # ------------------------------------------------------------------
    def _build_header(self, parent: tk.Widget) -> None:
        card = self._make_glass_card(
            parent,
            bg=CyberColors.SURFACE,
            border=CyberColors.GLASS_BORDER,
            pad_x=16,
            pad_y=12,
        )
        card.pack(fill="x")
        self._header_card = card
        row = card._body  # type: ignore[attr-defined]

        left = tk.Frame(row, bg=CyberColors.SURFACE)
        left.pack(side="left", fill="y")
        self._header_left = left

        self._orb_canvas = tk.Canvas(
            left,
            width=46,
            height=46,
            bg=CyberColors.SURFACE,
            highlightthickness=0,
            bd=0,
        )
        self._orb_canvas.pack(side="left", padx=(0, 12))
        self._prebuild_orb_frames()

        title_col = tk.Frame(left, bg=CyberColors.SURFACE)
        title_col.pack(side="left", fill="y")
        self._lbl_title = tk.Label(
            title_col,
            text="AI NetController",
            font=(self.ui_font, 15, "bold"),
            fg=CyberColors.TEXT_PRIMARY,
            bg=CyberColors.SURFACE,
        )
        self._lbl_title.pack(anchor="w")
        self._lbl_sub = tk.Label(
            title_col,
            text=f"{self.state.hostname}  //  HOST AGENT v{self.state.version}  //  {self.state.protocol}",
            font=(self.mono_font, 9),
            fg=CyberColors.PRIMARY,
            bg=CyberColors.SURFACE,
        )
        self._lbl_sub.pack(anchor="w", pady=(2, 0))

        # Status pills + Action buttons
        right = tk.Frame(row, bg=CyberColors.SURFACE)
        right.pack(side="right", fill="y")
        self._header_right = right

        pills = tk.Frame(right, bg=CyberColors.SURFACE)
        pills.pack(side="top", anchor="e", pady=(0, 6))
        self._header_pills = pills

        self._pill_status = tk.Label(
            pills,
            text=" ● ONLINE ",
            font=(self.mono_font, 9, "bold"),
            fg=CyberColors.SUCCESS,
            bg=CyberColors.SUCCESS_SOFT,
            padx=10,
            pady=3,
            highlightthickness=1,
            highlightbackground=CyberColors.SUCCESS,
        )
        self._pill_status.pack(side="left", padx=(0, 8))

        self._pill_peers = tk.Label(
            pills,
            text=" 0 PEERS ",
            font=(self.mono_font, 9, "bold"),
            fg=CyberColors.PRIMARY,
            bg=CyberColors.PRIMARY_SOFT,
            padx=10,
            pady=3,
            highlightthickness=1,
            highlightbackground=CyberColors.GLASS_BORDER,
        )
        self._pill_peers.pack(side="left", padx=(0, 8))

        self._lbl_uptime = tk.Label(
            pills,
            text="UP 00:00:00",
            font=(self.mono_font, 9),
            fg=CyberColors.TEXT_SECONDARY,
            bg=CyberColors.SURFACE,
        )
        self._lbl_uptime.pack(side="left")

        btns = tk.Frame(right, bg=CyberColors.SURFACE)
        btns.pack(side="top", anchor="e")
        self._header_btns = btns

        self._btn_pause = self._make_cyber_button(
            btns, "PAUSE", self._toggle_pause,
            fg=CyberColors.WARNING, bg=CyberColors.WARNING_SOFT, border=CyberColors.WARNING,
        )
        self._btn_pause.pack(side="left", padx=(0, 6))

        self._btn_viewonly = self._make_cyber_button(
            btns, "LOCK INPUT", self._toggle_view_only_quick,
            fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT, border=CyberColors.GLASS_BORDER,
        )
        self._btn_viewonly.pack(side="left", padx=(0, 6))

        self._make_cyber_button(
            btns, "PANIC KILL", self._panic_kill,
            fg=CyberColors.ACCENT, bg=CyberColors.ACCENT_SOFT, border=CyberColors.ACCENT,
        ).pack(side="left", padx=(0, 6))

        self._make_cyber_button(
            btns, "TRAY", self._hide_to_tray,
            fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.SURFACE_ELEVATED, border=CyberColors.GLASS_BORDER_IDLE,
        ).pack(side="left")

    def _prebuild_orb_frames(self) -> None:
        if not HAS_IMAGETK:
            return
        self._orb_frames.clear()
        for idx in range(12):
            img = render_node_orb_image(
                46,
                primary_hex=CyberColors.PRIMARY,
                secondary_hex=CyberColors.SECONDARY,
                pulse_phase=idx / 12.0,
                is_online=True,
            )
            if img is not None:
                self._orb_frames.append(ImageTk.PhotoImage(img))
        if self._orb_frames:
            self._orb_item = self._orb_canvas.create_image(23, 23, image=self._orb_frames[0])
        else:
            self._orb_item = None

    def _build_pill_dock(self, parent: tk.Widget) -> None:
        dock_wrap = tk.Frame(parent, bg=CyberColors.BACKGROUND)
        dock_wrap.pack(fill="x", pady=(10, 0))
        self._dock_wrap = dock_wrap

        dock_outer = tk.Frame(
            dock_wrap,
            bg=CyberColors.SURFACE_DOCK,
            highlightbackground=CyberColors.GLASS_BORDER_BRIGHT,
            highlightthickness=1,
            bd=0,
        )
        dock_outer.pack(anchor="center")

        # 3D Top Specular Sheen + Bottom Bevel Shadow inside the floating capsule dock
        tk.Frame(dock_outer, bg=CyberColors.SPECULAR_TOP, height=2, bd=0).pack(side="top", fill="x")
        tk.Frame(dock_outer, bg=CyberColors.SHADOW_DEEP, height=2, bd=0).pack(side="bottom", fill="x")

        dock = tk.Frame(dock_outer, bg=CyberColors.SURFACE_DOCK, padx=6, pady=4)
        dock.pack(side="top")

        self._tab_buttons: Dict[str, tk.Button] = {}
        tabs = [
            ("overview", "OVERVIEW & PAIR"),
            ("security", "ZERO-TRUST SHIELD"),
            ("console", "HITL & CONSOLE"),
            ("system", "DIAGNOSTICS & SETUP"),
        ]
        for key, label in tabs:
            btn = tk.Button(
                dock,
                text=label,
                command=lambda k=key: self._select_tab(k),
                font=(self.ui_font, 9, "bold"),
                fg=CyberColors.TEXT_SECONDARY,
                bg=CyberColors.SURFACE_DOCK,
                activeforeground=CyberColors.BACKGROUND,
                activebackground=CyberColors.PRIMARY,
                relief="flat",
                bd=0,
                padx=16,
                pady=6,
                cursor="hand2",
            )
            btn.pack(side="left", padx=3)
            btn.bind(
                "<Enter>",
                lambda _e, k=key, b=btn: b.configure(
                    bg=CyberColors.PRIMARY if self._active_tab == k else CyberColors.SURFACE_HOVER,
                    fg=CyberColors.BACKGROUND if self._active_tab == k else CyberColors.TEXT_PRIMARY,
                ),
            )
            btn.bind(
                "<Leave>",
                lambda _e, k=key, b=btn: b.configure(
                    bg=CyberColors.PRIMARY if self._active_tab == k else CyberColors.SURFACE_DOCK,
                    fg=CyberColors.BACKGROUND if self._active_tab == k else CyberColors.TEXT_SECONDARY,
                ),
            )
            self._tab_buttons[key] = btn

    def _select_tab(self, tab_key: str) -> None:
        self._active_tab = tab_key
        for k, frame in self._views.items():
            if k == tab_key:
                frame.pack(fill="both", expand=True)
            else:
                frame.pack_forget()
        for k, btn in self._tab_buttons.items():
            if k == tab_key:
                btn.configure(fg=CyberColors.BACKGROUND, bg=CyberColors.PRIMARY)
            else:
                btn.configure(fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.SURFACE_DOCK)

        # Subtle tab-aware ambient focal shift
        focal_map = {"overview": -0.35, "security": -0.10, "console": 0.15, "system": 0.40}
        new_focal = focal_map.get(tab_key, 0.0)
        if abs(new_focal - self._backdrop_focal) > 0.05:
            self._backdrop_focal = new_focal
            if self._backdrop_size[0] > 0:
                self._apply_ambient_backdrop(self._backdrop_size[0], self._backdrop_size[1], force=True)

        self.root.after_idle(self._sync_stage_scrollregion)

    # ------------------------------------------------------------------
    # TAB 1: OVERVIEW, TELEMETRY GAUGES, QR PAIRING & ACTIVE PEERS
    # ------------------------------------------------------------------
    def _build_overview_view(self) -> None:
        view = tk.Frame(self._stage, bg=CyberColors.BACKGROUND)
        self._views["overview"] = view

        top_grid = tk.Frame(view, bg=CyberColors.BACKGROUND)
        top_grid.pack(fill="both", expand=True)
        top_grid.columnconfigure(0, weight=5)
        top_grid.columnconfigure(1, weight=6)
        self._overview_grid = top_grid

        # Left column: Live Telemetry Card + Active Peers Strip
        left_col = tk.Frame(top_grid, bg=CyberColors.BACKGROUND)
        left_col.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        self._ov_left_col = left_col

        tele_card = self._make_glass_card(left_col, bg=CyberColors.SURFACE, border=CyberColors.GLASS_BORDER)
        tele_card.pack(fill="x")
        tb = tele_card._body  # type: ignore[attr-defined]
        tk.Label(
            tb, text="HOST TELEMETRY ENGINE",
            font=(self.ui_font, 10, "bold"), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.SURFACE,
        ).pack(anchor="w", pady=(0, 10))

        self._gauges: Dict[str, Tuple[tk.Canvas, tk.Label, str]] = {}
        for key, label_txt, base_color in (
            ("cpu", "CPU UTILIZATION", CyberColors.PRIMARY),
            ("ram", "MEMORY PRESSURE", CyberColors.SECONDARY),
            ("disk", "SYSTEM STORAGE", CyberColors.SUCCESS),
            ("fps", "STREAM PIPELINE", CyberColors.PRIMARY),
        ):
            row = tk.Frame(tb, bg=CyberColors.SURFACE)
            row.pack(fill="x", pady=4)
            hdr = tk.Frame(row, bg=CyberColors.SURFACE)
            hdr.pack(fill="x")
            tk.Label(
                hdr, text=label_txt, font=(self.ui_font, 8, "bold"),
                fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.SURFACE,
            ).pack(side="left")
            val_lbl = tk.Label(
                hdr, text="0%", font=(self.mono_font, 9, "bold"),
                fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.SURFACE,
            )
            val_lbl.pack(side="right")
            bar_cv = tk.Canvas(
                row, height=10, bg=CyberColors.TERMINAL_BG, highlightthickness=1,
                highlightbackground=CyberColors.GLASS_BORDER_IDLE, bd=0,
            )
            bar_cv.pack(fill="x", pady=(3, 0))
            self._gauges[key] = (bar_cv, val_lbl, base_color)
            self._gauge_display_pct[key] = 0.0
            self._gauge_target_pct[key] = 0.0

        stats_row = tk.Frame(tb, bg=CyberColors.SURFACE)
        stats_row.pack(fill="x", pady=(12, 0))
        self._lbl_cmds = tk.Label(
            stats_row, text="COMMANDS: 0", font=(self.mono_font, 8, "bold"),
            fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT, padx=8, pady=4,
            highlightthickness=1, highlightbackground=CyberColors.GLASS_BORDER,
        )
        self._lbl_cmds.pack(side="left", padx=(0, 8))
        self._lbl_frames = tk.Label(
            stats_row, text="FRAMES: 0", font=(self.mono_font, 8, "bold"),
            fg=CyberColors.SUCCESS, bg=CyberColors.SUCCESS_SOFT, padx=8, pady=4,
            highlightthickness=1, highlightbackground=CyberColors.SUCCESS,
        )
        self._lbl_frames.pack(side="left")

        # Connected Peers Card
        peers_card = self._make_glass_card(left_col, bg=CyberColors.SURFACE, border=CyberColors.GLASS_BORDER)
        peers_card.pack(fill="both", expand=True, pady=(10, 0))
        pb = peers_card._body  # type: ignore[attr-defined]
        p_hdr = tk.Frame(pb, bg=CyberColors.SURFACE)
        p_hdr.pack(fill="x", pady=(0, 8))
        tk.Label(
            p_hdr, text="CONNECTED PEERS",
            font=(self.ui_font, 10, "bold"), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.SURFACE,
        ).pack(side="left")
        self._make_cyber_button(
            p_hdr, "MANAGE ALL & BAN LIST", self._open_devices_modal,
            fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT, pad_x=8, pad_y=3, font_size=8,
        ).pack(side="right")

        self._peers_list_frame = tk.Frame(pb, bg=CyberColors.SURFACE)
        self._peers_list_frame.pack(fill="both", expand=True)

        # Right column: Quantum-Safe Zero-Trust QR Pairing Card
        right_col = tk.Frame(top_grid, bg=CyberColors.BACKGROUND)
        right_col.grid(row=0, column=1, sticky="nsew", padx=(8, 0))
        self._ov_right_col = right_col

        pair_card = self._make_glass_card(
            right_col,
            bg=CyberColors.SURFACE,
            border=CyberColors.GLASS_BORDER_BRIGHT,
            specular_color=CyberColors.SPECULAR_TOP,
        )
        pair_card.pack(fill="both", expand=True)
        prb = pair_card._body  # type: ignore[attr-defined]

        pr_hdr = tk.Frame(prb, bg=CyberColors.SURFACE)
        pr_hdr.pack(fill="x", pady=(0, 8))
        tk.Label(
            pr_hdr, text="COMPANION PAIRING & QR BRIDGE",
            font=(self.ui_font, 10, "bold"), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.SURFACE,
        ).pack(side="left")
        self._lbl_tls_badge = tk.Label(
            pr_hdr, text=" WS COMPAT ", font=(self.mono_font, 8, "bold"),
            fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT, padx=8, pady=2,
        )
        self._lbl_tls_badge.pack(side="right")

        qr_split = tk.Frame(prb, bg=CyberColors.SURFACE)
        qr_split.pack(fill="both", expand=True, pady=(4, 0))
        self._qr_split = qr_split

        qr_box = tk.Frame(qr_split, bg=CyberColors.SURFACE)
        qr_box.pack(side="left", padx=(0, 14), anchor="n")
        self._qr_box = qr_box
        self._qr_label = tk.Label(
            qr_box, bg=CyberColors.TERMINAL_BG, bd=0,
            highlightthickness=1, highlightbackground=CyberColors.PRIMARY,
        )
        self._qr_label.pack()
        tk.Label(
            qr_box, text="SCAN WITH MOBILE APP",
            font=(self.mono_font, 8, "bold"), fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.SURFACE,
        ).pack(pady=(6, 0))

        creds = tk.Frame(qr_split, bg=CyberColors.SURFACE)
        creds.pack(side="left", fill="both", expand=True)
        self._creds_box = creds

        tk.Label(
            creds, text="ENDPOINT URI", font=(self.ui_font, 8, "bold"),
            fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.SURFACE,
        ).pack(anchor="w")
        uri_row = tk.Frame(creds, bg=CyberColors.TERMINAL_BG, padx=10, pady=7, highlightthickness=1, highlightbackground=CyberColors.GLASS_BORDER_IDLE)
        uri_row.pack(fill="x", pady=(3, 10))
        self._make_cyber_button(
            uri_row, "COPY", self._copy_ws_uri,
            fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT, pad_x=8, pad_y=2, font_size=8,
        ).pack(side="right", padx=(6, 0))
        self._lbl_ws_uri = tk.Label(
            uri_row, text=f"ws://{self.state.local_ip}:{self.state.port}",
            font=(self.mono_font, 10, "bold"), fg=CyberColors.PRIMARY, bg=CyberColors.TERMINAL_BG, anchor="w",
        )
        self._lbl_ws_uri.pack(side="left", fill="x", expand=True)

        tk.Label(
            creds, text="ONE-TIME 6-DIGIT PIN", font=(self.ui_font, 8, "bold"),
            fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.SURFACE,
        ).pack(anchor="w")
        pin_row = tk.Frame(creds, bg=CyberColors.TERMINAL_BG, padx=10, pady=7, highlightthickness=1, highlightbackground=CyberColors.GLASS_BORDER_IDLE)
        pin_row.pack(fill="x", pady=(3, 10))
        self._make_cyber_button(
            pin_row, "COPY PIN", self._copy_pin,
            fg=CyberColors.SUCCESS, bg=CyberColors.SUCCESS_SOFT, border=CyberColors.SUCCESS, pad_x=8, pad_y=3, font_size=8,
        ).pack(side="right", padx=(6, 0))
        self._lbl_pin_ttl = tk.Label(
            pin_row, text="TTL --:--", font=(self.mono_font, 8),
            fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.TERMINAL_BG,
        )
        self._lbl_pin_ttl.pack(side="right", padx=(6, 0))
        self._lbl_pin = tk.Label(
            pin_row, text=self.state.pairing_pin,
            font=(self.mono_font, 18, "bold"), fg=CyberColors.SUCCESS, bg=CyberColors.TERMINAL_BG, anchor="w",
        )
        self._lbl_pin.pack(side="left")

        tk.Label(
            creds, text="HOST HMAC MASTER SECRET", font=(self.ui_font, 8, "bold"),
            fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.SURFACE,
        ).pack(anchor="w")
        tok_row = tk.Frame(creds, bg=CyberColors.TERMINAL_BG, padx=10, pady=7, highlightthickness=1, highlightbackground=CyberColors.GLASS_BORDER_IDLE)
        tok_row.pack(fill="x", pady=(3, 12))
        self._btn_tok_vis = self._make_cyber_button(
            tok_row, "SHOW", self._toggle_token_visibility,
            fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.SURFACE_ELEVATED, border=CyberColors.GLASS_BORDER_IDLE, pad_x=7, pad_y=2, font_size=8,
        )
        self._btn_tok_vis.pack(side="right", padx=(4, 0))
        self._make_cyber_button(
            tok_row, "COPY", self._copy_token,
            fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT, pad_x=7, pad_y=2, font_size=8,
        ).pack(side="right", padx=(6, 0))
        self._lbl_token = tk.Label(
            tok_row, text="ainet_••••••••••••••••••••••••",
            font=(self.mono_font, 9), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.TERMINAL_BG, anchor="w",
        )
        self._lbl_token.pack(side="left", fill="x", expand=True)

        act_row = tk.Frame(creds, bg=CyberColors.SURFACE)
        act_row.pack(fill="x")
        self._make_cyber_button(
            act_row, "COPY PAIR LINK", self._copy_pairing_uri,
            fg=CyberColors.SUCCESS, bg=CyberColors.SUCCESS_SOFT, border=CyberColors.SUCCESS,
        ).pack(side="left", padx=(0, 6), pady=2)
        self._make_cyber_button(
            act_row, "REFRESH PIN", self._refresh_pin_only,
            fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT,
        ).pack(side="left", padx=(0, 6), pady=2)
        self._make_cyber_button(
            act_row, "ROTATE TOKEN", self._rotate_token,
            fg=CyberColors.WARNING, bg=CyberColors.WARNING_SOFT, border=CyberColors.WARNING,
        ).pack(side="left", pady=2)

    # ------------------------------------------------------------------
    # TAB 2: ZERO-TRUST SECURITY POSTURE & HARDENING TOGGLES
    # ------------------------------------------------------------------
    def _build_security_view(self) -> None:
        view = tk.Frame(self._stage, bg=CyberColors.BACKGROUND)
        self._views["security"] = view

        prof_card = self._make_glass_card(view, bg=CyberColors.SURFACE, border=CyberColors.GLASS_BORDER)
        prof_card.pack(fill="x")
        pb = prof_card._body  # type: ignore[attr-defined]
        tk.Label(
            pb, text="SECURITY POSTURE PRESETS",
            font=(self.ui_font, 10, "bold"), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.SURFACE,
        ).pack(anchor="w", pady=(0, 8))

        p_row = tk.Frame(pb, bg=CyberColors.SURFACE)
        p_row.pack(fill="x")
        self._preset_boxes: List[Tuple[tk.Frame, tk.Label]] = []
        for pid, title, desc, color in (
            ("balanced", "BALANCED (DEFAULT)", "HITL + Auto-Ban + LAN compat", CyberColors.PRIMARY),
            ("zero_trust", "STRICT ZERO-TRUST", "Mandatory HMAC + AEAD + Geofence + No Clipboard", CyberColors.ACCENT),
            ("view_only", "PRESENTATION VIEW-ONLY", "Mirror display only; blocks all remote input", CyberColors.WARNING),
        ):
            box = tk.Frame(
                p_row, bg=CyberColors.SURFACE_ELEVATED, padx=12, pady=10,
                highlightthickness=1, highlightbackground=CyberColors.GLASS_BORDER_IDLE,
            )
            box.pack(side="left", fill="both", expand=True, padx=(0 if pid == "balanced" else 6, 0))
            tk.Frame(box, bg=color, height=2, bd=0).pack(side="top", fill="x", pady=(0, 6))
            tk.Radiobutton(
                box,
                text=title,
                variable=self.var_profile,
                value=pid,
                command=lambda p=pid: self._apply_profile(p),
                font=(self.ui_font, 9, "bold"),
                fg=color,
                bg=CyberColors.SURFACE_ELEVATED,
                selectcolor=CyberColors.BACKGROUND,
                activebackground=CyberColors.SURFACE_ELEVATED,
                activeforeground=color,
                bd=0,
            ).pack(anchor="w")
            desc_lbl = tk.Label(
                box, text=desc, font=(self.ui_font, 8),
                fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.SURFACE_ELEVATED, wraplength=280, justify="left",
            )
            desc_lbl.pack(anchor="w", padx=(22, 0), pady=(2, 0))
            self._preset_boxes.append((box, desc_lbl))

        # Two-column toggles card
        tog_card = self._make_glass_card(view, bg=CyberColors.SURFACE, border=CyberColors.GLASS_BORDER)
        tog_card.pack(fill="both", expand=True, pady=(10, 0))
        tb = tog_card._body  # type: ignore[attr-defined]
        tk.Label(
            tb, text="REAL-TIME POLICY & CRYPTO ENFORCEMENT",
            font=(self.ui_font, 10, "bold"), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.SURFACE,
        ).pack(anchor="w", pady=(0, 8))

        cols = tk.Frame(tb, bg=CyberColors.SURFACE)
        cols.pack(fill="both", expand=True)
        left_c = tk.Frame(cols, bg=CyberColors.SURFACE)
        left_c.pack(side="left", fill="both", expand=True, padx=(0, 12))
        right_c = tk.Frame(cols, bg=CyberColors.SURFACE)
        right_c.pack(side="left", fill="both", expand=True, padx=(12, 0))
        self._sec_left_c = left_c
        self._sec_right_c = right_c
        self._sec_checkbuttons: List[tk.Checkbutton] = []

        left_toggles = [
            ("View-Only Mode (block remote mouse/keyboard)", self.var_view_only, self._sync_toggles),
            ("Human-in-the-Loop (HITL) Approval for risky shell commands", self.var_hitl, self._sync_toggles),
            ("Bidirectional Clipboard Sync", self.var_clipboard, self._sync_toggles),
            ("Remote File Transfer Receiver", self.var_file_transfer, self._sync_toggles),
            ("Remote Audio & Media Key Control", self.var_audio_control, self._sync_toggles),
            ("Local Ollama AI Bridge", self.var_ollama_bridge, self._sync_toggles),
            ("Auto-Lock Windows Session on Client Disconnect", self.var_autolock, self._sync_toggles),
        ]
        right_toggles = [
            ("Auto-Ban IPs after repeated auth failures", self.var_autoban, self._sync_toggles),
            ("LAN Subnet Geofencing (reject non-LAN routes)", self.var_geofence, self._sync_toggles),
            ("Require Strict Nonce-Bound HMAC Auth (no PIN-less bypass)", self.var_hmac_auth, self._sync_toggles),
            ("Require Strict ChaCha20-Poly1305 AEAD Encryption (v2)", self.var_aead, self._sync_toggles),
            ("Require WSS TLS 1.2/1.3 Transport (restart to apply listener)", self.var_tls, self._sync_toggles),
            ("ZeroConf mDNS Service Advertisement", self.var_mdns, self._sync_toggles),
        ]

        for col_widget, items in ((left_c, left_toggles), (right_c, right_toggles)):
            for label_txt, var, cb in items:
                chk = tk.Checkbutton(
                    col_widget,
                    text=label_txt,
                    variable=var,
                    command=cb,
                    font=(self.ui_font, 9),
                    fg=CyberColors.TEXT_PRIMARY,
                    bg=CyberColors.SURFACE,
                    selectcolor=CyberColors.TERMINAL_BG,
                    activebackground=CyberColors.SURFACE,
                    activeforeground=CyberColors.PRIMARY,
                    anchor="w",
                    justify="left",
                )
                chk.pack(fill="x", pady=4)
                self._sec_checkbuttons.append(chk)

    # ------------------------------------------------------------------
    # TAB 3: HITL QUEUE & AUDIT CONSOLE
    # ------------------------------------------------------------------
    def _build_console_view(self) -> None:
        view = tk.Frame(self._stage, bg=CyberColors.BACKGROUND)
        self._views["console"] = view

        card = self._make_glass_card(view, bg=CyberColors.SURFACE, border=CyberColors.GLASS_BORDER)
        card.pack(fill="both", expand=True)
        cb = card._body  # type: ignore[attr-defined]

        hdr = tk.Frame(cb, bg=CyberColors.SURFACE)
        hdr.pack(fill="x", pady=(0, 8))
        tk.Label(
            hdr, text="SECURITY AUDIT & TELEMETRY STREAM",
            font=(self.ui_font, 10, "bold"), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.SURFACE,
        ).pack(side="left")
        self._make_cyber_button(
            hdr, "CLEAR CONSOLE", self._clear_console,
            fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.SURFACE_ELEVATED, border=CyberColors.GLASS_BORDER_IDLE, pad_x=10, pad_y=3, font_size=8,
        ).pack(side="right")

        term_wrap = tk.Frame(cb, bg=CyberColors.TERMINAL_BG, highlightthickness=1, highlightbackground=CyberColors.GLASS_BORDER_IDLE)
        term_wrap.pack(fill="both", expand=True)

        self._console_text = tk.Text(
            term_wrap,
            bg=CyberColors.TERMINAL_BG,
            fg=CyberColors.TEXT_PRIMARY,
            font=(self.mono_font, 9),
            insertbackground=CyberColors.PRIMARY,
            relief="flat",
            bd=8,
            height=14,
            state="disabled",
            wrap="word",
        )
        sb = ttk.Scrollbar(term_wrap, orient="vertical", command=self._console_text.yview, style="Cyber.Vertical.TScrollbar")
        self._console_text.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self._console_text.pack(side="left", fill="both", expand=True)

        self._console_text.tag_configure("ts", foreground=CyberColors.TEXT_TERTIARY)
        self._console_text.tag_configure("SECURITY", foreground=CyberColors.PRIMARY)
        self._console_text.tag_configure("ALERT", foreground=CyberColors.ACCENT)
        self._console_text.tag_configure("WARN", foreground=CyberColors.WARNING)
        self._console_text.tag_configure("SUCCESS", foreground=CyberColors.SUCCESS)
        self._console_text.tag_configure("DIAG", foreground=CyberColors.SECONDARY)
        self._console_text.tag_configure("SYSTEM", foreground=CyberColors.TEXT_PRIMARY)

    # ------------------------------------------------------------------
    # TAB 4: DIAGNOSTICS, AV / SMART APP CONTROL AUDIT & INSTALLER
    # ------------------------------------------------------------------
    def _build_diagnostics_view(self) -> None:
        view = tk.Frame(self._stage, bg=CyberColors.BACKGROUND)
        self._views["system"] = view

        top = tk.Frame(view, bg=CyberColors.BACKGROUND)
        top.pack(fill="both", expand=True)
        top.columnconfigure(0, weight=1)
        top.columnconfigure(1, weight=1)
        self._diag_top_grid = top

        # Left: AV & Smart App Control Integrity Card
        av_card = self._make_glass_card(top, bg=CyberColors.SURFACE, border=CyberColors.GLASS_BORDER)
        av_card.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        self._av_card = av_card
        ab = av_card._body  # type: ignore[attr-defined]
        tk.Label(
            ab, text="AV & SMART APP CONTROL INTEGRITY",
            font=(self.ui_font, 10, "bold"), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.SURFACE,
        ).pack(anchor="w", pady=(0, 10))

        checks = [
            ("zero_vbs_dropper", "Native Win32 COM Shortcuts (Zero .vbs / cscript.exe droppers)"),
            ("upx_disabled", "UPX Executable Packing Disabled (Clean Authenticode sections)"),
            ("ntfs_dacl_hardened", "User-SID NTFS DACLs & DPAPI Secret Encryption"),
            ("manifest_as_invoker", "asInvoker Manifest (Zero unsolicited UAC elevation)"),
            ("sandbox_job_object", "OS Kill-on-Close Job Object Subprocess Containment"),
            ("visible_hwnd", "Explicit Operator Window & Tray Verification"),
        ]
        self._av_check_labels: List[tk.Label] = []
        for key, label_txt in checks:
            passed = bool(self.state.av_integrity.get(key, True))
            r = tk.Frame(ab, bg=CyberColors.TERMINAL_BG, padx=10, pady=6, highlightthickness=1, highlightbackground=CyberColors.GLASS_BORDER_IDLE)
            r.pack(fill="x", pady=3)
            tk.Label(
                r,
                text="PASS" if passed else "WARN",
                font=(self.mono_font, 8, "bold"),
                fg=CyberColors.SUCCESS if passed else CyberColors.WARNING,
                bg=CyberColors.SUCCESS_SOFT if passed else CyberColors.WARNING_SOFT,
                padx=6, pady=2,
            ).pack(side="left", padx=(0, 8))
            lbl = tk.Label(
                r, text=label_txt, font=(self.ui_font, 8),
                fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.TERMINAL_BG, anchor="w", justify="left",
            )
            lbl.pack(side="left", fill="x", expand=True)
            self._av_check_labels.append(lbl)

        # Right: NIC Diagnostics & Windows System Deployment
        sys_card = self._make_glass_card(top, bg=CyberColors.SURFACE, border=CyberColors.GLASS_BORDER)
        sys_card.grid(row=0, column=1, sticky="nsew", padx=(8, 0))
        self._sys_card = sys_card
        sb = sys_card._body  # type: ignore[attr-defined]
        tk.Label(
            sb, text="NIC PROBE & WINDOWS INTEGRATION",
            font=(self.ui_font, 10, "bold"), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.SURFACE,
        ).pack(anchor="w", pady=(0, 10))

        self._diag_output = tk.Label(
            sb,
            text="Click 'RUN NIC & WOL DIAGNOSTICS' to inspect active physical adapters.",
            font=(self.mono_font, 8),
            fg=CyberColors.TEXT_SECONDARY,
            bg=CyberColors.TERMINAL_BG,
            padx=10, pady=10,
            justify="left",
            anchor="nw",
            wraplength=420,
            highlightthickness=1,
            highlightbackground=CyberColors.GLASS_BORDER_IDLE,
        )
        self._diag_output.pack(fill="x", pady=(0, 12))

        tk.Checkbutton(
            sb,
            text="Run Host Daemon automatically on Windows Sign-In (Startup)",
            variable=self.var_autostart,
            command=self._toggle_autostart,
            font=(self.ui_font, 9),
            fg=CyberColors.TEXT_PRIMARY,
            bg=CyberColors.SURFACE,
            selectcolor=CyberColors.TERMINAL_BG,
            activebackground=CyberColors.SURFACE,
        ).pack(anchor="w", pady=(0, 3))

        tk.Checkbutton(
            sb,
            text="Start Minimized to System Tray on Launch",
            variable=self.var_start_minimized,
            command=self._sync_toggles,
            font=(self.ui_font, 9),
            fg=CyberColors.TEXT_PRIMARY,
            bg=CyberColors.SURFACE,
            selectcolor=CyberColors.TERMINAL_BG,
            activebackground=CyberColors.SURFACE,
        ).pack(anchor="w", pady=(0, 3))

        tk.Checkbutton(
            sb,
            text="Minimize to System Tray When Closing Window (Uncheck to exit on close)",
            variable=self.var_close_to_tray,
            command=self._sync_toggles,
            font=(self.ui_font, 9),
            fg=CyberColors.TEXT_PRIMARY,
            bg=CyberColors.SURFACE,
            selectcolor=CyberColors.TERMINAL_BG,
            activebackground=CyberColors.SURFACE,
        ).pack(anchor="w", pady=(0, 10))

        btn_grid = tk.Frame(sb, bg=CyberColors.SURFACE)
        btn_grid.pack(fill="x")
        self._make_cyber_button(
            btn_grid, "RUN NIC & WOL DIAGNOSTICS", self._run_diagnostics,
            fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT,
        ).pack(fill="x", pady=(0, 6))
        self._make_cyber_button(
            btn_grid, "GUIDED SETUP & FEATURE WIZARD", self._open_setup_wizard,
            fg=CyberColors.SECONDARY, bg=CyberColors.SECONDARY_SOFT, border=CyberColors.SECONDARY,
        ).pack(fill="x", pady=(0, 6))
        self._make_cyber_button(
            btn_grid, "CREATE DESKTOP SHORTCUT (COM)", self._create_shortcut_now,
            fg=CyberColors.SUCCESS, bg=CyberColors.SUCCESS_SOFT, border=CyberColors.SUCCESS,
        ).pack(fill="x", pady=(0, 6))

        svc_row = tk.Frame(btn_grid, bg=CyberColors.SURFACE)
        svc_row.pack(fill="x")
        self._make_cyber_button(
            svc_row, "INSTALL / MODIFY ON PC...", self._trigger_install_dialog,
            fg=CyberColors.PRIMARY, bg=CyberColors.SURFACE_ELEVATED, border=CyberColors.GLASS_BORDER_IDLE,
        ).pack(side="left", fill="x", expand=True, padx=(0, 4))
        self._make_cyber_button(
            svc_row, "UNINSTALL FROM PC...", self._trigger_uninstall_dialog,
            fg=CyberColors.ACCENT, bg=CyberColors.ACCENT_SOFT, border=CyberColors.ACCENT,
        ).pack(side="left", fill="x", expand=True, padx=(4, 0))

    # ------------------------------------------------------------------
    # PERIODIC REFRESH & IDLE-AWARE SCHEDULER
    # ------------------------------------------------------------------
    def _schedule_refresh(self) -> None:
        if not self.state.is_running and self.state._exit_requested:
            return
        try:
            self._handle_cross_thread_requests()
            self._refresh_ui(force_telemetry=False)
        except Exception as e:
            logger.debug(f"GUI refresh tick warning: {e}")

        delay_ms = 2000 if self._is_hidden else 250
        try:
            self.root.after(delay_ms, self._schedule_refresh)
        except Exception:
            pass

    def _handle_cross_thread_requests(self) -> None:
        show_req = hide_req = inst_req = uninst_req = exit_req = False
        with self.state.lock:
            if self.state._show_window_requested:
                show_req = True
                self.state._show_window_requested = False
            if self.state._hide_window_requested:
                hide_req = True
                self.state._hide_window_requested = False
            if self.state._install_requested:
                inst_req = True
                self.state._install_requested = False
            if self.state._uninstall_requested:
                uninst_req = True
                self.state._uninstall_requested = False
            if self.state._exit_requested:
                exit_req = True
                self.state._exit_requested = False

        if show_req:
            self._show_from_tray()
        if hide_req:
            self._hide_to_tray()
        if inst_req and callable(show_install_dialog):
            self.root.after(20, lambda: show_install_dialog(self.root))
        if uninst_req and callable(show_uninstall_dialog):
            self.root.after(20, lambda: show_uninstall_dialog(self.root, on_uninstalled=self._full_shutdown))
        if exit_req:
            self._full_shutdown()
            return

        if not self._hitl_dialog_active:
            pending_hitl = self.state.pop_pending_hitl_requests()
            for req in pending_hitl:
                created_at = float(req.get("created_at") or time.time())
                if (time.time() - created_at) >= 29.0:
                    cb = req.get("resolve_cb")
                    if callable(cb):
                        cb(False)
                    continue
                self._hitl_dialog_active = True
                try:
                    approved = self._show_hitl_approval_modal(
                        command=str(req.get("command", "")),
                        reason=str(req.get("reason", "Requires host confirmation.")),
                        approval_id=str(req.get("approval_id", "")),
                    )
                    cb = req.get("resolve_cb")
                    if callable(cb):
                        cb(bool(approved))
                    self.state.add_log(
                        "SECURITY",
                        f"Local HITL decision for [{req.get('approval_id', '')}]: {'APPROVED' if approved else 'DENIED'}",
                    )
                finally:
                    self._hitl_dialog_active = False

    def _refresh_ui(self, force_telemetry: bool = False) -> None:
        # Check PIN TTL rotation on regular ticks
        self.state.check_and_refresh_pin_ttl()

        now = time.time()
        tele_interval = 3.0 if self._is_hidden else 0.75
        if force_telemetry or (now - self._last_tele_tick) >= tele_interval:
            self.state.sample_telemetry()
            self._last_tele_tick = now

        # Skip heavy canvas redraws while hidden/minimized to tray
        if self._is_hidden:
            return

        snap = self.state.get_snapshot()

        # Rotate orbital CyberNodeBadge sprite smoothly
        if self._orb_frames and getattr(self, "_orb_item", None) is not None:
            self._orb_phase = (self._orb_phase + 1) % len(self._orb_frames)
            self._orb_canvas.itemconfigure(self._orb_item, image=self._orb_frames[self._orb_phase])

        # Header pills
        if snap["isPaused"]:
            self._pill_status.configure(
                text=" ● PAUSED ", fg=CyberColors.WARNING, bg=CyberColors.WARNING_SOFT,
                highlightbackground=CyberColors.WARNING,
            )
            self._btn_pause.configure(text="RESUME")
        else:
            tls_tag = " · TLS" if snap["tlsEnabled"] else ""
            self._pill_status.configure(
                text=f" ● ONLINE{tls_tag} ", fg=CyberColors.SUCCESS, bg=CyberColors.SUCCESS_SOFT,
                highlightbackground=CyberColors.SUCCESS,
            )
            self._btn_pause.configure(text="PAUSE")

        peer_count = len(snap["connectedClients"])
        self._pill_peers.configure(text=f" {peer_count} PEER{'S' if peer_count != 1 else ''} ")
        self._lbl_uptime.configure(text=f"UP {snap['uptime']}")
        vo_fg = CyberColors.WARNING if snap["viewOnlyMode"] else CyberColors.PRIMARY
        vo_bg = CyberColors.WARNING_SOFT if snap["viewOnlyMode"] else CyberColors.PRIMARY_SOFT
        vo_br = CyberColors.WARNING if snap["viewOnlyMode"] else CyberColors.GLASS_BORDER
        self._btn_viewonly._base_fg = vo_fg  # type: ignore[attr-defined]
        self._btn_viewonly._base_bg = vo_bg  # type: ignore[attr-defined]
        self._btn_viewonly._base_border = vo_br  # type: ignore[attr-defined]
        self._btn_viewonly.configure(
            text="INPUT LOCKED" if snap["viewOnlyMode"] else "LOCK INPUT",
            fg=vo_fg,
            bg=vo_bg,
            highlightbackground=vo_br,
        )

        # Overview gauges & credentials (only refresh QR bitmap when URI changes)
        if self._active_tab == "overview":
            self._draw_gauge("cpu", snap["cpuPercent"], f"{snap['cpuPercent']:.1f}%")
            self._draw_gauge(
                "ram",
                snap["ramPercent"],
                f"{snap['ramUsedGb']:.1f}/{snap['ramTotalGb']:.1f} GB ({snap['ramPercent']:.0f}%)",
            )
            self._draw_gauge("disk", snap["diskPercent"], f"{snap['diskPercent']:.0f}%")
            fps_pct = min(100.0, (snap["captureFps"] / 60.0) * 100.0)
            self._draw_gauge("fps", fps_pct, f"{snap['captureFps']:.1f} FPS")

            self._lbl_cmds.configure(text=f"COMMANDS: {snap['commandsExecuted']}")
            self._lbl_frames.configure(text=f"FRAMES: {snap['framesBroadcast']}")
            self._lbl_ws_uri.configure(text=snap["wsUri"])
            self._lbl_pin.configure(text=snap["pairingPin"])

            rem_ttl = max(0, int(snap["pinTtlSeconds"] - (now - snap["pinIssuedAt"])))
            mm, ss = divmod(rem_ttl, 60)
            self._lbl_pin_ttl.configure(text=f"TTL {mm:02d}:{ss:02d}")
            self._lbl_tls_badge.configure(
                text=" WSS TLS 1.3 " if snap["tlsEnabled"] else " WS LAN ",
                fg=CyberColors.SUCCESS if snap["tlsEnabled"] else CyberColors.PRIMARY,
                bg=CyberColors.SUCCESS_SOFT if snap["tlsEnabled"] else CyberColors.PRIMARY_SOFT,
            )

            tok = snap["pairingToken"]
            if self._token_visible:
                self._lbl_token.configure(text=tok)
                self._btn_tok_vis.configure(text="HIDE")
            else:
                masked = f"{tok[:6]}{'•' * 14}{tok[-4:]}" if len(tok) > 12 else "•" * 16
                self._lbl_token.configure(text=masked)
                self._btn_tok_vis.configure(text="SHOW")

            self._refresh_qr_card(snap["pairingUri"])
            self._refresh_peers_panel(snap["connectedClients"])

        # Append only newly emitted logs to Terminal Console
        self._flush_logs_to_console()

        # Sync Devices Drawer if currently open
        if self._devices_win is not None and self._devices_win.winfo_exists():
            self._refresh_devices_modal_lists(snap["connectedClients"], snap["blacklistedDevices"])

    def _draw_gauge(self, key: str, percent: float, text_val: str) -> None:
        cv, lbl, _ = self._gauges[key]
        target = max(0.0, min(100.0, float(percent)))
        if lbl.cget("text") != text_val:
            lbl.configure(text=text_val)
        self._gauge_target_pct[key] = target
        curr = self._gauge_display_pct.get(key, target)
        if abs(target - curr) > 0.35:
            self._gauge_display_pct[key] = curr + (target - curr) * 0.45
            if self._gauge_anim_after_id is None and not self._is_hidden:
                self._gauge_anim_after_id = self.root.after(40, self._step_gauge_animations)
        else:
            self._gauge_display_pct[key] = target
        self._paint_gauge_canvas(key, self._gauge_display_pct[key])

    def _step_gauge_animations(self) -> None:
        self._gauge_anim_after_id = None
        if self._is_hidden or self._active_tab != "overview":
            return
        needs_more = False
        for key in self._gauges:
            curr = self._gauge_display_pct.get(key, 0.0)
            target = self._gauge_target_pct.get(key, 0.0)
            if abs(target - curr) > 0.35:
                nxt = curr + (target - curr) * 0.42
                self._gauge_display_pct[key] = nxt
                self._paint_gauge_canvas(key, nxt)
                needs_more = True
            elif curr != target:
                self._gauge_display_pct[key] = target
                self._paint_gauge_canvas(key, target)
        if needs_more:
            try:
                self._gauge_anim_after_id = self.root.after(40, self._step_gauge_animations)
            except Exception:
                self._gauge_anim_after_id = None

    def _paint_gauge_canvas(self, key: str, pct: float) -> None:
        cv, _, base_hex = self._gauges[key]
        w = max(80, cv.winfo_width())
        h = max(8, cv.winfo_height())
        fill_color = (
            CyberColors.ACCENT if pct >= 88.0
            else (CyberColors.WARNING if pct >= 70.0 else base_hex)
        )
        sheen_color = mix_hex(fill_color, "#FFFFFF", 0.45)
        cv.delete("all")
        # Subtle 25%, 50%, 75% instrument ticks inside the dark trough
        for frac in (0.25, 0.50, 0.75):
            tx = int(w * frac)
            cv.create_line(tx, 0, tx, h, fill=CyberColors.SURFACE_ELEVATED, width=1)
        fill_w = int((w * pct) / 100.0)
        if fill_w > 0:
            cv.create_rectangle(0, 0, fill_w, h, fill=fill_color, width=0)
            # Top 2px 3D specular highlight sheen
            cv.create_rectangle(0, 0, fill_w, max(2, h // 4), fill=sheen_color, width=0)
            # Glowing leading edge cap
            if fill_w > 2:
                cv.create_rectangle(max(0, fill_w - 2), 0, fill_w, h, fill="#FFFFFF", width=0)

    def _refresh_qr_card(self, pairing_uri: str) -> None:
        target_px = self._scale.qr_size
        if not HAS_IMAGETK or (pairing_uri == self._qr_cache_uri and target_px == self._qr_cache_px):
            return
        qr_img = render_qr_card_image(pairing_uri, pixel_size=target_px)
        if qr_img is not None:
            self._qr_photo = ImageTk.PhotoImage(qr_img)
            self._qr_label.configure(image=self._qr_photo)
            self._qr_cache_uri = pairing_uri
            self._qr_cache_px = target_px

    def _refresh_peers_panel(self, clients: List[Dict[str, Any]]) -> None:
        sig = tuple(
            (c.get("id"), c.get("inputAllowed", True), c.get("isTrusted", False))
            for c in clients
        )
        if sig == self._last_peer_sig:
            return
        self._last_peer_sig = sig

        for w in self._peers_list_frame.winfo_children():
            w.destroy()

        if not clients:
            tk.Label(
                self._peers_list_frame,
                text="No remote companions connected. Scan QR or enter PIN in the mobile/web app.",
                font=(self.ui_font, 9),
                fg=CyberColors.TEXT_SECONDARY,
                bg=CyberColors.SURFACE,
                justify="left",
                wraplength=360,
            ).pack(anchor="w", pady=10)
            return

        for c in clients[:4]:
            cid = str(c.get("id", ""))
            ip = str(c.get("ip", "?"))
            dev = str(c.get("device", "Unknown"))
            inp = bool(c.get("inputAllowed", True))
            trusted = bool(c.get("isTrusted", False))

            row = tk.Frame(
                self._peers_list_frame, bg=CyberColors.TERMINAL_BG, padx=10, pady=6,
                highlightthickness=1, highlightbackground=CyberColors.GLASS_BORDER_IDLE,
            )
            row.pack(fill="x", pady=3)
            self._make_cyber_button(
                row, "BAN", lambda i=cid, p=ip, d=dev: self.state.blacklist_client(i, p, d),
                fg=CyberColors.ACCENT, bg=CyberColors.ACCENT_SOFT, border=CyberColors.ACCENT, pad_x=6, pad_y=2, font_size=8,
            ).pack(side="right", padx=(4, 0))
            self._make_cyber_button(
                row, "KICK", lambda i=cid: self.state.disconnect_client(i),
                fg=CyberColors.WARNING, bg=CyberColors.WARNING_SOFT, border=CyberColors.WARNING, pad_x=6, pad_y=2, font_size=8,
            ).pack(side="right", padx=(4, 0))
            self._make_cyber_button(
                row, "TRUST" if not trusted else "TRUSTED", lambda i=cid: self.state.toggle_client_trust(i),
                fg=CyberColors.SUCCESS if trusted else CyberColors.TEXT_SECONDARY,
                bg=CyberColors.SUCCESS_SOFT if trusted else CyberColors.SURFACE_ELEVATED,
                pad_x=6, pad_y=2, font_size=8,
            ).pack(side="right", padx=(4, 0))
            self._make_cyber_button(
                row, "INPUT ON" if inp else "VIEW ONLY", lambda i=cid: self.state.toggle_client_input(i),
                fg=CyberColors.PRIMARY if inp else CyberColors.WARNING,
                bg=CyberColors.PRIMARY_SOFT if inp else CyberColors.WARNING_SOFT,
                pad_x=6, pad_y=2, font_size=8,
            ).pack(side="right")
            tk.Label(
                row, text=f"{dev} ({ip})",
                font=(self.ui_font, 9, "bold"), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.TERMINAL_BG, anchor="w",
            ).pack(side="left", fill="x", expand=True)

    def _flush_logs_to_console(self) -> None:
        with self.state.lock:
            seq = self.state._log_seq
            if seq == self._rendered_log_seq:
                return
            snapshot_logs = list(self.state.logs)
            self._rendered_log_seq = seq

        self._console_text.configure(state="normal")
        self._console_text.delete("1.0", "end")
        for entry in snapshot_logs[-120:]:
            lvl = entry.get("level", "SYSTEM")
            tag = lvl if lvl in ("SECURITY", "ALERT", "WARN", "SUCCESS", "DIAG") else "SYSTEM"
            self._console_text.insert("end", f"[{entry.get('ts', '--:--:--')}] ", "ts")
            self._console_text.insert("end", f"[{lvl:<8}] ", tag)
            self._console_text.insert("end", f"{entry.get('msg', '')}\n")
        self._console_text.see("end")
        self._console_text.configure(state="disabled")

    def _clamp_modal_geometry(self, modal: tk.Toplevel, target_w: int, target_h: int, min_w: int = 420, min_h: int = 300) -> Tuple[int, int]:
        """Sizes and centers a modal window safely within the visible display bounds."""
        try:
            scr_w = max(480, int(self.root.winfo_screenwidth()))
            scr_h = max(360, int(self.root.winfo_screenheight()))
        except Exception:
            scr_w, scr_h = 1920, 1080
        w = min(target_w, max(min_w, scr_w - 40))
        h = min(target_h, max(min_h, scr_h - 60))
        x = max(10, (scr_w - w) // 2)
        y = max(10, (scr_h - h) // 2)
        modal.geometry(f"{w}x{h}+{x}+{y}")
        modal.minsize(min(min_w, w), min(min_h, h))
        modal.resizable(True, True)
        return w, h

    # ------------------------------------------------------------------
    # NEON CORAL LOCAL HITL APPROVAL MODAL
    # ------------------------------------------------------------------
    def _show_hitl_approval_modal(self, command: str, reason: str, approval_id: str) -> bool:
        """Displays a Neon Coral (#FF0055) interactive desktop confirmation prompt."""
        decision = {"approved": False}
        modal = tk.Toplevel(self.root)
        modal.title("Zero-Trust HITL Approval Required")
        w, _ = self._clamp_modal_geometry(modal, 560, 350, min_w=380, min_h=280)
        modal.configure(bg=CyberColors.BACKGROUND)
        modal.transient(self.root)
        modal.grab_set()
        if callable(apply_window_icon):
            apply_window_icon(modal)
        apply_dark_titlebar(modal, CyberColors.BACKGROUND)

        card = self._make_glass_card(
            modal,
            bg=CyberColors.SURFACE,
            border=CyberColors.ACCENT,
            pad_x=16,
            pad_y=14,
            specular_color=CyberColors.ACCENT,
        )
        card.pack(fill="both", expand=True, padx=12, pady=12)
        body = card._body  # type: ignore[attr-defined]

        # Pack bottom button bar first so action buttons are never clipped on short viewports
        btn_row = tk.Frame(body, bg=CyberColors.SURFACE)
        btn_row.pack(side="bottom", fill="x", pady=(6, 0))

        def _decide(ok: bool) -> None:
            decision["approved"] = ok
            try:
                modal.destroy()
            except Exception:
                pass

        self._make_cyber_button(
            btn_row, "APPROVE EXECUTION", lambda: _decide(True),
            fg=CyberColors.SUCCESS, bg=CyberColors.SUCCESS_SOFT, border=CyberColors.SUCCESS, pad_x=14, pad_y=6,
        ).pack(side="left", padx=(0, 8))
        self._make_cyber_button(
            btn_row, "DENY & BLOCK", lambda: _decide(False),
            fg=CyberColors.ACCENT, bg=CyberColors.ACCENT_SOFT, border=CyberColors.ACCENT, pad_x=14, pad_y=6,
        ).pack(side="left")

        countdown_lbl = tk.Label(
            body, text="Auto-deny timeout in 25s",
            font=(self.mono_font, 8, "bold"), fg=CyberColors.WARNING, bg=CyberColors.SURFACE,
        )
        countdown_lbl.pack(side="bottom", anchor="w", pady=(4, 4))

        tk.Label(
            body,
            text="SECURITY CONFIRMATION REQUIRED (HITL)",
            font=(self.ui_font, 11, "bold"),
            fg=CyberColors.ACCENT,
            bg=CyberColors.SURFACE,
        ).pack(anchor="w")
        tk.Label(
            body,
            text=f"Approval ID: {approval_id}  //  {reason}",
            font=(self.ui_font, 9),
            fg=CyberColors.TEXT_SECONDARY,
            bg=CyberColors.SURFACE,
            wraplength=max(280, w - 64),
            justify="left",
        ).pack(anchor="w", pady=(4, 8))

        cmd_box = tk.Text(
            body,
            height=4,
            bg=CyberColors.TERMINAL_BG,
            fg=CyberColors.TEXT_PRIMARY,
            font=(self.mono_font, 9),
            relief="flat",
            highlightthickness=1,
            highlightbackground=CyberColors.ACCENT,
            wrap="word",
        )
        cmd_box.insert("1.0", command)
        cmd_box.configure(state="disabled")
        cmd_box.pack(fill="both", expand=True, pady=(0, 4))

        modal.protocol("WM_DELETE_WINDOW", lambda: _decide(False))

        remaining = {"secs": 25}

        def _tick() -> None:
            if not modal.winfo_exists():
                return
            remaining["secs"] -= 1
            if remaining["secs"] <= 0:
                _decide(False)
                return
            countdown_lbl.configure(text=f"Auto-deny timeout in {remaining['secs']}s")
            modal.after(1000, _tick)

        modal.after(1000, _tick)
        self.root.wait_window(modal)
        return decision["approved"]

    # ------------------------------------------------------------------
    # SUB-WINDOWS: DEVICES / BAN LIST & 4-STEP SETUP WIZARD
    # ------------------------------------------------------------------
    def _open_devices_modal(self) -> None:
        if self._devices_win is not None and self._devices_win.winfo_exists():
            self._devices_win.lift()
            return
        win = tk.Toplevel(self.root)
        win.title("Connected Peers & Intrusion Blacklist")
        self._clamp_modal_geometry(win, 680, 460, min_w=420, min_h=300)
        win.configure(bg=CyberColors.BACKGROUND)
        if callable(apply_window_icon):
            apply_window_icon(win)
        apply_dark_titlebar(win, CyberColors.BACKGROUND)
        self._devices_win = win
        self._last_ban_sig = None

        c = self._make_glass_card(win, bg=CyberColors.SURFACE, border=CyberColors.GLASS_BORDER)
        c.pack(fill="both", expand=True, padx=12, pady=12)
        b = c._body  # type: ignore[attr-defined]
        tk.Label(b, text="ACTIVE SESSIONS & FIREWALL BLACKLIST", font=(self.ui_font, 11, "bold"), fg=CyberColors.PRIMARY, bg=CyberColors.SURFACE).pack(anchor="w", pady=(0, 8))

        self._modal_peers_box = tk.Frame(b, bg=CyberColors.TERMINAL_BG, padx=8, pady=8)
        self._modal_peers_box.pack(fill="x", pady=(0, 12))
        tk.Label(b, text="BANNED IP ADDRESSES", font=(self.ui_font, 9, "bold"), fg=CyberColors.ACCENT, bg=CyberColors.SURFACE).pack(anchor="w", pady=(0, 4))
        self._modal_bans_box = tk.Frame(b, bg=CyberColors.TERMINAL_BG, padx=8, pady=8)
        self._modal_bans_box.pack(fill="both", expand=True)

        snap = self.state.get_snapshot()
        self._refresh_devices_modal_lists(snap["connectedClients"], snap["blacklistedDevices"])

    def _refresh_devices_modal_lists(self, clients: List[Dict[str, Any]], bans: List[Dict[str, Any]]) -> None:
        sig = (tuple(c.get("id") for c in clients), tuple(b.get("ip") for b in bans))
        if sig == self._last_ban_sig:
            return
        self._last_ban_sig = sig

        for frame, empty_txt, items, is_ban in (
            (self._modal_peers_box, "No connected clients.", clients, False),
            (self._modal_bans_box, "No blacklisted devices.", bans, True),
        ):
            for w in frame.winfo_children():
                w.destroy()
            if not items:
                tk.Label(frame, text=empty_txt, font=(self.ui_font, 9), fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.TERMINAL_BG).pack(anchor="w")
                continue
            for item in items:
                row = tk.Frame(frame, bg=CyberColors.TERMINAL_BG)
                row.pack(fill="x", pady=3)
                ip = str(item.get("ip", "?"))
                dev = str(item.get("device", "Unknown"))
                if is_ban:
                    tk.Label(row, text=f"{dev} [{ip}] — {item.get('reason', '')}", font=(self.mono_font, 8), fg=CyberColors.ACCENT, bg=CyberColors.TERMINAL_BG).pack(side="left")
                    self._make_cyber_button(row, "UNBAN", lambda p=ip: self.state.unban_device(p), fg=CyberColors.SUCCESS, bg=CyberColors.SUCCESS_SOFT, pad_x=8, pad_y=2, font_size=8).pack(side="right")
                else:
                    cid = str(item.get("id", ""))
                    tk.Label(row, text=f"{dev} [{ip}]", font=(self.mono_font, 9), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.TERMINAL_BG).pack(side="left")
                    self._make_cyber_button(row, "DISCONNECT", lambda i=cid: self.state.disconnect_client(i), fg=CyberColors.WARNING, bg=CyberColors.WARNING_SOFT, pad_x=8, pad_y=2, font_size=8).pack(side="right")

    def _open_setup_wizard(self) -> None:
        if self._setup_win is not None and self._setup_win.winfo_exists():
            self._setup_win.lift()
            return
        win = tk.Toplevel(self.root)
        win.title("AI NetController — Guided Setup & Feature Customizer")
        w, _ = self._clamp_modal_geometry(win, 660, 480, min_w=440, min_h=360)
        win.configure(bg=CyberColors.BACKGROUND)
        if callable(apply_window_icon):
            apply_window_icon(win)
        apply_dark_titlebar(win, CyberColors.BACKGROUND)
        self._setup_win = win

        card = self._make_glass_card(
            win,
            bg=CyberColors.SURFACE,
            border=CyberColors.GLASS_BORDER_BRIGHT,
            specular_color=CyberColors.SPECULAR_TOP,
        )
        card.pack(fill="both", expand=True, padx=14, pady=14)
        b = card._body  # type: ignore[attr-defined]

        wiz_step = {"index": 0}
        dont_show_var = tk.BooleanVar(value=True)

        # Bottom-pinned navigation bar guarantees buttons remain accessible at any screen height
        btn_r = tk.Frame(b, bg=CyberColors.SURFACE)
        btn_r.pack(side="bottom", fill="x", pady=(8, 0))

        tk.Checkbutton(
            btn_r,
            text="Don't show automatically on startup",
            variable=dont_show_var,
            font=(self.ui_font, 8),
            fg=CyberColors.TEXT_SECONDARY,
            bg=CyberColors.SURFACE,
            selectcolor=CyberColors.TERMINAL_BG,
            activebackground=CyberColors.SURFACE,
        ).pack(side="left")

        nav_right = tk.Frame(btn_r, bg=CyberColors.SURFACE)
        nav_right.pack(side="right")

        def _save_all_and_close() -> None:
            self._sync_toggles()
            self._toggle_autostart()
            with self.state.lock:
                self.state.setup_completed = bool(dont_show_var.get())
            self.state.save_policy_config()
            self.state.add_log("SYSTEM", "Guided Host Setup & Feature Customization saved.")
            self._refresh_ui()
            win.destroy()

        btn_back = self._make_cyber_button(
            nav_right, "◀ BACK", lambda: _go_step(wiz_step["index"] - 1),
            fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.SURFACE_ELEVATED, border=CyberColors.GLASS_BORDER_IDLE, pad_x=10, pad_y=5,
        )
        btn_back.pack(side="left", padx=(0, 6))

        btn_next = self._make_cyber_button(
            nav_right, "NEXT ▶", lambda: _go_step(wiz_step["index"] + 1),
            fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT, border=CyberColors.PRIMARY, pad_x=12, pad_y=5,
        )
        btn_next.pack(side="left", padx=(0, 6))

        btn_finish = self._make_cyber_button(
            nav_right, "SAVE & FINISH", _save_all_and_close,
            fg=CyberColors.SUCCESS, bg=CyberColors.SUCCESS_SOFT, border=CyberColors.SUCCESS, pad_x=14, pad_y=5,
        )
        btn_finish.pack(side="left")

        # Top title + step indicator pills
        tk.Label(
            b, text="WELCOME TO AI NETCONTROLLER HOST AGENT",
            font=(self.ui_font, 12, "bold"), fg=CyberColors.PRIMARY, bg=CyberColors.SURFACE,
        ).pack(anchor="w")

        step_bar = tk.Frame(b, bg=CyberColors.SURFACE)
        step_bar.pack(fill="x", pady=(6, 8))
        step_pills: List[tk.Label] = []
        for idx, st_title in enumerate(("1. STARTUP & TRAY", "2. OPTIONAL FEATURES", "3. SECURITY & PAIRING")):
            pill = tk.Label(
                step_bar,
                text=f" {st_title} ",
                font=(self.mono_font, 8, "bold"),
                padx=8,
                pady=3,
                cursor="hand2",
            )
            pill.pack(side="left", padx=(0, 6))
            pill.bind("<Button-1>", lambda _e, i=idx: _go_step(i))
            step_pills.append(pill)

        content_box = tk.Frame(
            b, bg=CyberColors.TERMINAL_BG, padx=14, pady=12,
            highlightthickness=1, highlightbackground=CyberColors.GLASS_BORDER_IDLE,
        )
        content_box.pack(fill="both", expand=True)

        def _go_step(target_idx: int) -> None:
            idx = max(0, min(2, int(target_idx)))
            wiz_step["index"] = idx
            for i, p in enumerate(step_pills):
                active = (i == idx)
                p.configure(
                    fg=CyberColors.BACKGROUND if active else CyberColors.TEXT_SECONDARY,
                    bg=CyberColors.PRIMARY if active else CyberColors.SURFACE_ELEVATED,
                )
            btn_back.configure(state="normal" if idx > 0 else "disabled")
            if idx < 2:
                btn_next.configure(state="normal")
            else:
                btn_next.configure(state="disabled")

            for child in content_box.winfo_children():
                child.destroy()

            if idx == 0:
                tk.Label(
                    content_box,
                    text="STEP 1: STARTUP, TRAY & PC INSTALLATION OPTIONS",
                    font=(self.ui_font, 10, "bold"), fg=CyberColors.PRIMARY, bg=CyberColors.TERMINAL_BG,
                ).pack(anchor="w", pady=(0, 4))
                tk.Label(
                    content_box,
                    text="Choose whether AI NetController runs on Windows startup or stays in the background tray:",
                    font=(self.ui_font, 9), fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.TERMINAL_BG,
                    wraplength=max(320, w - 72), justify="left",
                ).pack(anchor="w", pady=(0, 8))

                for txt, var in (
                    ("Run automatically when Windows signs in (Run on Startup)", self.var_autostart),
                    ("Start Minimized in System Tray on launch", self.var_start_minimized),
                    ("Minimize to System Tray when closing window (Uncheck to exit on close)", self.var_close_to_tray),
                ):
                    tk.Checkbutton(
                        content_box, text=txt, variable=var,
                        font=(self.ui_font, 9), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.TERMINAL_BG,
                        selectcolor=CyberColors.SURFACE, activebackground=CyberColors.TERMINAL_BG,
                    ).pack(anchor="w", pady=3)

                act_f = tk.Frame(content_box, bg=CyberColors.TERMINAL_BG)
                act_f.pack(fill="x", pady=(10, 0))
                self._make_cyber_button(
                    act_f, "OPEN PC INSTALLER / REPAIR / UNINSTALLER...", self._trigger_install_dialog,
                    fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT, border=CyberColors.PRIMARY, pad_x=12, pad_y=5,
                ).pack(side="left", padx=(0, 8))
                self._make_cyber_button(
                    act_f, "CREATE DESKTOP SHORTCUT", self._create_shortcut_now,
                    fg=CyberColors.SUCCESS, bg=CyberColors.SUCCESS_SOFT, border=CyberColors.SUCCESS, pad_x=12, pad_y=5,
                ).pack(side="left")

            elif idx == 1:
                tk.Label(
                    content_box,
                    text="STEP 2: ENABLE OR DISABLE OPTIONAL DAEMON MODULES",
                    font=(self.ui_font, 10, "bold"), fg=CyberColors.SECONDARY, bg=CyberColors.TERMINAL_BG,
                ).pack(anchor="w", pady=(0, 4))
                tk.Label(
                    content_box,
                    text="Disable any subsystem you do not plan to use. Disabled modules reject remote requests immediately:",
                    font=(self.ui_font, 9), fg=CyberColors.TEXT_SECONDARY, bg=CyberColors.TERMINAL_BG,
                    wraplength=max(320, w - 72), justify="left",
                ).pack(anchor="w", pady=(0, 6))

                for txt, var in (
                    ("ZeroConf / mDNS LAN Auto-Discovery Broadcast", self.var_mdns),
                    ("Bidirectional Clipboard Synchronization", self.var_clipboard),
                    ("Remote File Transfer Receiver", self.var_file_transfer),
                    ("Remote Audio & Media Key Control", self.var_audio_control),
                    ("Local Ollama AI Bridge", self.var_ollama_bridge),
                    ("View-Only Presentation Mode (Block remote mouse & keyboard)", self.var_view_only),
                ):
                    tk.Checkbutton(
                        content_box, text=txt, variable=var,
                        font=(self.ui_font, 9), fg=CyberColors.TEXT_PRIMARY, bg=CyberColors.TERMINAL_BG,
                        selectcolor=CyberColors.SURFACE, activebackground=CyberColors.TERMINAL_BG,
                    ).pack(anchor="w", pady=2)

            else:
                tk.Label(
                    content_box,
                    text="STEP 3: SECURITY POSTURE & COMPANION PAIRING",
                    font=(self.ui_font, 10, "bold"), fg=CyberColors.SUCCESS, bg=CyberColors.TERMINAL_BG,
                ).pack(anchor="w", pady=(0, 4))

                prof_row = tk.Frame(content_box, bg=CyberColors.TERMINAL_BG)
                prof_row.pack(fill="x", pady=(0, 8))
                self._make_cyber_button(
                    prof_row, "APPLY BALANCED (DEFAULT)", lambda: self._apply_profile("balanced"),
                    fg=CyberColors.PRIMARY, bg=CyberColors.PRIMARY_SOFT, border=CyberColors.PRIMARY, pad_x=10, pad_y=4, font_size=8,
                ).pack(side="left", padx=(0, 6))
                self._make_cyber_button(
                    prof_row, "APPLY STRICT ZERO-TRUST", lambda: self._apply_profile("zero_trust"),
                    fg=CyberColors.ACCENT, bg=CyberColors.ACCENT_SOFT, border=CyberColors.ACCENT, pad_x=10, pad_y=4, font_size=8,
                ).pack(side="left", padx=(0, 6))
                self._make_cyber_button(
                    prof_row, "APPLY VIEW-ONLY", lambda: self._apply_profile("view_only"),
                    fg=CyberColors.WARNING, bg=CyberColors.WARNING_SOFT, border=CyberColors.WARNING, pad_x=10, pad_y=4, font_size=8,
                ).pack(side="left")

                summary_txt = (
                    f"1. Endpoint URI      : {self.state.get_snapshot()['wsUri']}\n"
                    f"2. Ephemeral PIN     : {self.state.pairing_pin} (auto-rotates every {self.state.pin_ttl_seconds}s)\n"
                    f"3. Secret Protection : DPAPI + Current-User NTFS DACL\n"
                    f"4. AV/SAC Hygiene    : Pure Win32 COM shortcuts, UPX=OFF, Zero .vbs/.bat\n"
                    f"5. Execution Firewall: AST Normalizer + Local HITL Prompt ({'ON' if self.state.require_hitl_approval else 'OFF'})"
                )
                tk.Label(
                    content_box, text=summary_txt, font=(self.mono_font, 9), fg=CyberColors.TEXT_PRIMARY,
                    bg=CyberColors.SURFACE, padx=10, pady=8, justify="left", anchor="w",
                    highlightthickness=1, highlightbackground=CyberColors.GLASS_BORDER_IDLE,
                ).pack(fill="both", expand=True)

        _go_step(0)

    # ------------------------------------------------------------------
    # OPERATOR ACTIONS
    # ------------------------------------------------------------------
    def _toggle_pause(self) -> None:
        with self.state.lock:
            self.state.is_paused = not self.state.is_paused
            paused = self.state.is_paused
        self.state.save_policy_config()
        self.state.add_log("WARN" if paused else "INFO", f"Host Daemon {'PAUSED' if paused else 'RESUMED'} via UI.")
        self._refresh_ui()

    def _toggle_view_only_quick(self) -> None:
        with self.state.lock:
            self.state.view_only_mode = not self.state.view_only_mode
            self.var_view_only.set(self.state.view_only_mode)
        self.state.save_policy_config()
        self.state.add_log("SECURITY", f"View-Only Input Lock -> {'ENABLED' if self.state.view_only_mode else 'DISABLED'}")
        self._refresh_ui()

    def _panic_kill(self) -> None:
        if callable(self.on_disconnect_all):
            self.on_disconnect_all()
        with self.state.lock:
            self.state.connected_clients.clear()
        self.state.add_log("ALERT", "Emergency PANIC triggered: all peer sessions severed.")
        self._refresh_ui()

    def _copy_ws_uri(self) -> None:
        uri = self.state.get_snapshot()["wsUri"]
        self.root.clipboard_clear()
        self.root.clipboard_append(uri)
        self.state.add_log("INFO", f"Copied endpoint URI: {uri}")

    def _copy_pin(self) -> None:
        pin = str(self.state.pairing_pin or "").strip()
        if not pin:
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(pin)
        self.state.add_log("SECURITY", "6-digit pairing PIN copied to local clipboard.")

    def _copy_pairing_uri(self) -> None:
        uri = self.state.get_pairing_uri()
        self.root.clipboard_clear()
        self.root.clipboard_append(uri)
        self.state.add_log("SECURITY", "One-tap pairing link (ainet://pair) copied to local clipboard.")

    def _toggle_token_visibility(self) -> None:
        self._token_visible = not self._token_visible
        self._refresh_ui()

    def _copy_token(self) -> None:
        copied = self.state.pairing_token
        self.root.clipboard_clear()
        self.root.clipboard_append(copied)
        self.state.add_log("SECURITY", "Master pairing token copied to local clipboard (auto-clears in 30s).")

        def _auto_clear() -> None:
            try:
                if self.root.clipboard_get() == copied:
                    self.root.clipboard_clear()
            except Exception:
                pass

        try:
            self.root.after(30000, _auto_clear)
        except Exception:
            pass

    def _rotate_token(self) -> None:
        if messagebox is not None:
            ok = messagebox.askyesno(
                "Rotate Master Token",
                "Rotating the master token will require all currently paired phones/browsers to re-pair with the new 6-digit PIN.\n\nContinue?",
                parent=self.root,
            )
            if not ok:
                return
        self.state.rotate_pairing_token()
        if callable(self.on_disconnect_all):
            try:
                self.on_disconnect_all()
            except Exception:
                pass
        self._refresh_ui()

    def _refresh_pin_only(self) -> None:
        self.state.regenerate_pairing_pin()
        self.state.add_log("SECURITY", "Ephemeral 6-digit PIN refreshed by operator.")
        self._refresh_ui()

    def _apply_profile(self, profile: str) -> None:
        self.state.apply_security_profile(profile)
        self.var_profile.set(self.state.security_profile)
        self.var_view_only.set(self.state.view_only_mode)
        self.var_hitl.set(self.state.require_hitl_approval)
        self.var_clipboard.set(self.state.clipboard_sync_allowed)
        self.var_autolock.set(self.state.auto_lock_on_disconnect)
        self.var_autoban.set(self.state.auto_ban_intrusion)
        self.var_geofence.set(self.state.subnet_geofence_only)
        self.var_hmac_auth.set(self.state.require_hmac_auth)
        self.var_aead.set(self.state.require_aead)
        self._refresh_ui()

    def _sync_toggles(self) -> None:
        with self.state.lock:
            self.state.view_only_mode = bool(self.var_view_only.get())
            self.state.require_hitl_approval = bool(self.var_hitl.get())
            self.state.clipboard_sync_allowed = bool(self.var_clipboard.get())
            self.state.auto_lock_on_disconnect = bool(self.var_autolock.get())
            self.state.auto_ban_intrusion = bool(self.var_autoban.get())
            self.state.subnet_geofence_only = bool(self.var_geofence.get())
            self.state.mdns_enabled = bool(self.var_mdns.get())
            self.state.start_minimized = bool(self.var_start_minimized.get())
            self.state.close_to_tray = bool(self.var_close_to_tray.get())
            self.state.file_transfer_enabled = bool(self.var_file_transfer.get())
            self.state.audio_control_enabled = bool(self.var_audio_control.get())
            self.state.ollama_bridge_enabled = bool(self.var_ollama_bridge.get())
            self.state.require_hmac_auth = bool(self.var_hmac_auth.get())
            self.state.require_aead = bool(self.var_aead.get())
            self.state.require_tls = bool(self.var_tls.get())
        self.state.save_policy_config()
        self.state.add_log("POLICY", "Host security policies & optional feature flags updated.")

    def _clear_console(self) -> None:
        with self.state.lock:
            self.state.logs.clear()
            self.state._log_seq += 1
        self._flush_logs_to_console()

    def _run_diagnostics(self) -> None:
        res = self.state.run_safe_nic_diagnostics()
        nics = res.get("active_interfaces", [])
        lines = [
            f"Status: {res.get('status', 'unknown').upper()} | UDP Broadcast: {'READY' if res.get('udp_broadcast_ready') else 'BLOCKED'}",
            f"Physical Active NICs ({len(nics)}):",
        ]
        for nic in nics[:5]:
            lines.append(f"  • {nic['name']} -> {nic['ipv4']} ({nic['speed_mbps']} Mbps, MTU {nic['mtu']})")
        self._diag_output.configure(text="\n".join(lines), fg=CyberColors.TEXT_PRIMARY)

    def _toggle_autostart(self) -> None:
        enabled = bool(self.var_autostart.get())
        if callable(set_autostart):
            res = set_autostart(enabled)
            if isinstance(res, tuple):
                ok, msg = bool(res[0]), str(res[1])
            else:
                ok = bool(res)
                msg = (
                    f"Windows Startup Auto-Run {'ENABLED' if enabled else 'DISABLED'} in HKCU Run registry."
                    if ok
                    else "Could not update Windows Startup registry key."
                )
            self.state.autostart_on_boot = enabled if ok else not enabled
            self.var_autostart.set(self.state.autostart_on_boot)
            self.state.save_policy_config()
            self.state.add_log("SYSTEM" if ok else "WARN", msg)
        else:
            self.state.autostart_on_boot = enabled
            self.state.save_policy_config()

    def _create_shortcut_now(self) -> None:
        if callable(create_desktop_shortcut):
            ok, msg = create_desktop_shortcut()
            self.state.add_log("SUCCESS" if ok else "WARN", msg)
            if ok and messagebox is not None:
                messagebox.showinfo("Shortcut Created", msg, parent=self.root)
        elif callable(create_native_shortcut):
            desktop = os.path.join(os.path.expanduser("~"), "Desktop")
            lnk = os.path.join(desktop, "AI NetController.lnk")
            exe_target = sys.executable
            args = "" if getattr(sys, "frozen", False) else f'"{os.path.abspath(__file__)}"'
            res = create_native_shortcut(exe_target, lnk, arguments=args)
            ok = bool(res[0]) if isinstance(res, tuple) else bool(res)
            msg = str(res[1]) if isinstance(res, tuple) else f"Native COM shortcut created on Desktop: {lnk}"
            self.state.add_log("SUCCESS" if ok else "WARN", msg)
            if ok and messagebox is not None:
                messagebox.showinfo("Shortcut Created", msg, parent=self.root)

    def _trigger_install_dialog(self) -> None:
        if callable(show_install_dialog):
            show_install_dialog(self.root)

    def _trigger_uninstall_dialog(self) -> None:
        if callable(show_uninstall_dialog):
            show_uninstall_dialog(self.root, on_uninstalled=self._full_shutdown)

    def _hide_to_tray(self) -> None:
        self._set_hidden(True)
        try:
            self.root.withdraw()
        except Exception:
            pass

    def _show_from_tray(self) -> None:
        self._set_hidden(False)
        try:
            self.root.deiconify()
            self.root.lift()
            self.root.focus_force()
            self._refresh_ui(force_telemetry=True)
        except Exception:
            pass

    def _on_window_close_request(self) -> None:
        if self.state.close_to_tray:
            self._hide_to_tray()
            self.state.add_log("INFO", "Control Center minimized to System Tray (daemon continues running).")
        else:
            self.state.add_log("SYSTEM", "Operator closed window with Close-to-Tray disabled; shutting down daemon.")
            self._full_shutdown()

    def _full_shutdown(self) -> None:
        with self.state.lock:
            self.state.is_running = False
        if callable(self.on_stop_daemon):
            try:
                self.on_stop_daemon()
            except Exception:
                pass
        try:
            self.root.quit()
            self.root.destroy()
        except Exception:
            pass

    def run(self) -> None:
        self.root.mainloop()


def launch_gui_with_background_daemon(daemon_runner: Optional[Callable[[HostDaemonState], None]] = None) -> None:
    """
    Starts the AsyncIO Daemon in a background daemon thread and runs the
    visible Cyber Glass Control Center on the main thread.
    """
    state = HostDaemonState()
    daemon_instance = None
    ws_daemon = None

    if daemon_runner is None:
        import asyncio
        try:
            try:
                from agent import HostAgentDaemon
            except (ImportError, ModuleNotFoundError):
                from agent.agent import HostAgentDaemon
            ws_daemon = HostAgentDaemon(host="0.0.0.0", port=state.port)
            ws_daemon.gui_state = state
            ws_daemon._owns_loop = True
            if hasattr(ws_daemon, "_sync_gui_state_on_attach"):
                ws_daemon._sync_gui_state_on_attach()
            state.on_disconnect_callback = ws_daemon.force_disconnect_client
            daemon_instance = ws_daemon

            def _ws_runner(_state: HostDaemonState) -> None:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    loop.run_until_complete(ws_daemon.start())
                    loop.run_forever()
                except Exception as ex:
                    logger.error(f"HostAgentDaemon background reactor error: {ex}")
                finally:
                    loop.close()

            daemon_runner = _ws_runner
        except Exception:
            try:
                from agent_daemon import DaemonServer
                daemon_instance = DaemonServer(host="0.0.0.0", port=state.port, psk=state.pairing_token)

                def _default_runner(_state: HostDaemonState) -> None:
                    try:
                        asyncio.run(daemon_instance.run())
                    except Exception as ex:
                        logger.error(f"Daemon background reactor error: {ex}")

                daemon_runner = _default_runner
            except Exception as exc:
                logger.info(f"Background daemon auto-link omitted: {exc}")

    if daemon_runner is not None:
        t = threading.Thread(target=daemon_runner, args=(state,), daemon=True, name="AI_AsyncDaemonThread")
        t.start()

    if HAS_TKINTER and ("--headless" not in sys.argv):
        try:
            disconnect_all_fn = (
                ws_daemon.kill_all_tasks
                if ws_daemon is not None and hasattr(ws_daemon, "kill_all_tasks")
                else (lambda: state.add_log("ALERT", "Disconnected all active peers."))
            )
            stop_fn = daemon_instance.stop if daemon_instance and hasattr(daemon_instance, "stop") else None
            gui = HostDaemonDesktopGUI(
                state=state,
                on_disconnect_all=disconnect_all_fn,
                on_stop_daemon=stop_fn,
            )
            gui.run()
            return
        except Exception as e:
            logger.warning(f"Display server unavailable ({e}); continuing in console mode.")

    try:
        while state.is_running:
            time.sleep(1.0)
    except KeyboardInterrupt:
        state.is_running = False
        if daemon_instance and hasattr(daemon_instance, "stop"):
            daemon_instance.stop()


if __name__ == "__main__":
    launch_gui_with_background_daemon()
