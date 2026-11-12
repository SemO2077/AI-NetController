"""
AI NetController — Host Agent Persistent Configuration Manager
================================================================================
Manages persistent host agent settings across daemon restarts, including:
- 6-digit Pairing PIN
- HMAC-SHA256 Shared Secret / Pairing Token
- Host Port & Bind Host
- Security Policies (View-Only, Auto-ban, HITL approval, Subnet geofencing)
- AV-Safe and System Integration settings

Config is stored in:
- Windows: %LOCALAPPDATA%\\AI NetController\\config.json
- Unix/macOS: ~/.ai_netcontroller/config.json
================================================================================
"""

import base64
import ctypes
from ctypes import wintypes
import json
import logging
import os
import platform
import secrets
import sys
import threading
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("AI-NetController-Config")

DEFAULT_PORT = 8765
DEFAULT_HOST = "0.0.0.0"
_CONFIG_LOCK = threading.RLock()
_DPAPI_PREFIX = "dpapi_v1:"
_DPAPI_ENTROPY = b"AI_NetController_Config_DPAPI_v1"
_IS_WINDOWS = platform.system() == "Windows"


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _dpapi_protect(plaintext: str) -> str:
    """Encrypts a secret string using Windows DPAPI; returns plaintext unchanged on non-Windows."""
    if not _IS_WINDOWS or not plaintext or plaintext.startswith(_DPAPI_PREFIX):
        return plaintext
    try:
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        raw = plaintext.encode("utf-8")
        entropy_buf = (ctypes.c_ubyte * len(_DPAPI_ENTROPY)).from_buffer_copy(_DPAPI_ENTROPY)
        data_buf = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
        in_blob = _DATA_BLOB(len(raw), data_buf)
        entropy_blob = _DATA_BLOB(len(_DPAPI_ENTROPY), entropy_buf)
        out_blob = _DATA_BLOB()
        # CRYPTPROTECT_UI_FORBIDDEN = 0x01
        if crypt32.CryptProtectData(
            ctypes.byref(in_blob),
            None,
            ctypes.byref(entropy_blob),
            None,
            None,
            0x01,
            ctypes.byref(out_blob),
        ):
            try:
                enc = ctypes.string_at(out_blob.pbData, out_blob.cbData)
                return _DPAPI_PREFIX + base64.b64encode(enc).decode("ascii")
            finally:
                kernel32.LocalFree(out_blob.pbData)
    except Exception as exc:
        logger.debug("DPAPI protect unavailable (%s); storing with OS file permissions", exc)
    return plaintext


def _dpapi_unprotect(stored: str) -> Optional[str]:
    """Decrypts a dpapi_v1:-prefixed secret string on Windows; passes through legacy plaintext."""
    if not isinstance(stored, str) or not stored:
        return None
    if not stored.startswith(_DPAPI_PREFIX):
        return stored
    if not _IS_WINDOWS:
        logger.warning("Encrypted Windows DPAPI secret cannot be decrypted on non-Windows host")
        return None
    try:
        raw_enc = base64.b64decode(stored[len(_DPAPI_PREFIX):].encode("ascii"))
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        enc_buf = (ctypes.c_ubyte * len(raw_enc)).from_buffer_copy(raw_enc)
        entropy_buf = (ctypes.c_ubyte * len(_DPAPI_ENTROPY)).from_buffer_copy(_DPAPI_ENTROPY)
        in_blob = _DATA_BLOB(len(raw_enc), enc_buf)
        entropy_blob = _DATA_BLOB(len(_DPAPI_ENTROPY), entropy_buf)
        out_blob = _DATA_BLOB()
        if crypt32.CryptUnprotectData(
            ctypes.byref(in_blob),
            None,
            ctypes.byref(entropy_blob),
            None,
            None,
            0x01,
            ctypes.byref(out_blob),
        ):
            try:
                dec = ctypes.string_at(out_blob.pbData, out_blob.cbData)
                return dec.decode("utf-8")
            finally:
                kernel32.LocalFree(out_blob.pbData)
    except Exception as exc:
        logger.warning("Failed to decrypt stored DPAPI secret: %s", exc)
    return None


def _restrict_file_permissions(path: str, is_dir: bool = False) -> None:
    if _IS_WINDOWS:
        return
    try:
        os.chmod(path, 0o700 if is_dir else 0o600)
    except Exception as exc:
        logger.debug("Could not chmod %s: %s", path, exc)


def get_config_dir() -> str:
    """Returns absolute path to AI NetController user configuration folder."""
    if _IS_WINDOWS:
        base = os.environ.get("LOCALAPPDATA") or os.path.join(
            os.environ.get("USERPROFILE", ""), "AppData", "Local"
        )
        if not base or not os.path.isdir(base):
            base = os.path.expanduser("~")
        config_dir = os.path.join(base, "AI NetController")
    else:
        config_dir = os.path.join(os.path.expanduser("~"), ".ai_netcontroller")

    try:
        os.makedirs(config_dir, exist_ok=True)
        _restrict_file_permissions(config_dir, is_dir=True)
    except Exception as e:
        logger.debug("Could not create config dir %s: %s", config_dir, e)
    return config_dir


def get_config_path() -> str:
    """Returns absolute path to config.json."""
    return os.path.join(get_config_dir(), "config.json")


def _generate_default_config() -> Dict[str, Any]:
    """Generates initial configuration with high-entropy CSPRNG credentials."""
    env_secret = os.environ.get("AI_AGENT_SECRET") or os.environ.get("CST_AGENT_SECRET")
    pairing_token = env_secret.strip() if env_secret and env_secret.strip() else f"ainet_{secrets.token_hex(24)}"
    pairing_pin = f"{secrets.randbelow(900000) + 100000}"

    return {
        "version": "0.50.0",
        "protocol": "AI-NET/3.0-SECURE",
        "bind_host": DEFAULT_HOST,
        "port": DEFAULT_PORT,
        "pairing_pin": pairing_pin,
        "pairing_token": pairing_token,
        "pin_issued_at": int(time.time()),
        "view_only_mode": False,
        "require_hitl_approval": True,
        "clipboard_sync_allowed": True,
        "auto_lock_on_disconnect": False,
        "auto_ban_intrusion": True,
        "subnet_geofence_only": True,
        "security_profile": "balanced",
        "blacklisted_devices": [],
        "setup_completed": False,
    }


def _validate_and_sanitize_config(raw: Dict[str, Any], defaults: Dict[str, Any]) -> Dict[str, Any]:
    """Enforces schema types and safe ranges on loaded JSON config."""
    merged = dict(defaults)

    # Boolean policy fields
    for bool_key in (
        "view_only_mode",
        "require_hitl_approval",
        "clipboard_sync_allowed",
        "auto_lock_on_disconnect",
        "auto_ban_intrusion",
        "subnet_geofence_only",
        "setup_completed",
    ):
        val = raw.get(bool_key)
        if isinstance(val, bool):
            merged[bool_key] = val

    # String metadata & bind settings
    if isinstance(raw.get("bind_host"), str) and raw["bind_host"].strip():
        merged["bind_host"] = raw["bind_host"].strip()
    if isinstance(raw.get("security_profile"), str) and raw["security_profile"] in ("strict", "balanced", "relaxed"):
        merged["security_profile"] = raw["security_profile"]
    if isinstance(raw.get("protocol"), str) and raw["protocol"].strip():
        merged["protocol"] = raw["protocol"].strip()

    # Valid TCP port range
    raw_port = raw.get("port")
    if isinstance(raw_port, int) and not isinstance(raw_port, bool) and 1 <= raw_port <= 65535:
        merged["port"] = raw_port

    # PIN issued timestamp
    raw_ts = raw.get("pin_issued_at")
    if isinstance(raw_ts, int) and not isinstance(raw_ts, bool) and raw_ts > 0:
        merged["pin_issued_at"] = raw_ts

    # Blacklisted devices/IPs
    raw_bl = raw.get("blacklisted_devices")
    if isinstance(raw_bl, list):
        merged["blacklisted_devices"] = [str(item).strip() for item in raw_bl if isinstance(item, str) and item.strip()]

    # Decrypt or migrate secrets
    env_secret = os.environ.get("AI_AGENT_SECRET") or os.environ.get("CST_AGENT_SECRET")
    if env_secret and env_secret.strip():
        merged["pairing_token"] = env_secret.strip()
    else:
        raw_tok = raw.get("pairing_token")
        unprot_tok = _dpapi_unprotect(raw_tok) if isinstance(raw_tok, str) else None
        if unprot_tok and len(unprot_tok.strip()) >= 16:
            merged["pairing_token"] = unprot_tok.strip()

    raw_pin = raw.get("pairing_pin")
    unprot_pin = _dpapi_unprotect(raw_pin) if isinstance(raw_pin, str) else None
    if unprot_pin and len(unprot_pin.strip()) == 6 and unprot_pin.strip().isdigit():
        merged["pairing_pin"] = unprot_pin.strip()

    merged["version"] = "0.50.0"
    return merged


def load_config() -> Dict[str, Any]:
    """
    Loads persistent configuration from disk cleanly with schema validation and DPAPI decryption.
    Initializes with fresh CSPRNG credentials if absent or unreadable.
    """
    with _CONFIG_LOCK:
        cfg_path = get_config_path()
        defaults = _generate_default_config()

        if os.path.isfile(cfg_path):
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                if isinstance(loaded, dict):
                    sanitized = _validate_and_sanitize_config(loaded, defaults)
                    # Migrate legacy plaintext secrets on Windows to DPAPI storage automatically
                    raw_tok = loaded.get("pairing_token")
                    if _IS_WINDOWS and isinstance(raw_tok, str) and not raw_tok.startswith(_DPAPI_PREFIX):
                        save_config(sanitized)
                    return sanitized
            except Exception as e:
                logger.warning("Failed to read config from %s, re-initializing: %s", cfg_path, e)

        save_config(defaults)
        return defaults


def save_config(config: Dict[str, Any]) -> bool:
    """Thread-safe atomic configuration persistence with DPAPI secret sealing on Windows."""
    with _CONFIG_LOCK:
        cfg_path = get_config_path()
        tmp_path = f"{cfg_path}.tmp.{secrets.token_hex(4)}"
        try:
            cfg_dir = os.path.dirname(cfg_path)
            os.makedirs(cfg_dir, exist_ok=True)
            _restrict_file_permissions(cfg_dir, is_dir=True)

            defaults = _generate_default_config()
            to_write = _validate_and_sanitize_config(config, defaults)
            # Keep caller-specified setup_completed boolean if provided
            if isinstance(config.get("setup_completed"), bool):
                to_write["setup_completed"] = config["setup_completed"]
            if _IS_WINDOWS:
                to_write["pairing_token"] = _dpapi_protect(to_write["pairing_token"])
                to_write["pairing_pin"] = _dpapi_protect(to_write["pairing_pin"])

            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(to_write, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            _restrict_file_permissions(tmp_path, is_dir=False)

            last_err: Optional[OSError] = None
            for attempt in range(5):
                try:
                    os.replace(tmp_path, cfg_path)
                    _restrict_file_permissions(cfg_path, is_dir=False)
                    return True
                except OSError as exc:
                    last_err = exc
                    time.sleep(0.02 * (attempt + 1))

            if last_err is not None:
                raise last_err
            return True
        except Exception as e:
            logger.error("Error saving config to %s: %s", cfg_path, e)
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass
            return False


def rotate_token() -> str:
    """Rotates pairing token, persists sealed secret to disk, and returns new token."""
    with _CONFIG_LOCK:
        cfg = load_config()
        new_token = f"ainet_{secrets.token_hex(24)}"
        cfg["pairing_token"] = new_token
        save_config(cfg)
        return new_token


def regenerate_pin() -> str:
    """Regenerates 6-digit pairing PIN with fresh timestamp and returns new PIN."""
    with _CONFIG_LOCK:
        cfg = load_config()
        new_pin = f"{secrets.randbelow(900000) + 100000}"
        cfg["pairing_pin"] = new_pin
        cfg["pin_issued_at"] = int(time.time())
        save_config(cfg)
        return new_pin
