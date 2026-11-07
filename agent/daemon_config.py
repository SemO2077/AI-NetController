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

import json
import logging
import os
import platform
import secrets
import sys
from typing import Any, Dict, Optional

logger = logging.getLogger("AI-NetController-Config")

DEFAULT_PORT = 8765
DEFAULT_HOST = "0.0.0.0"
DEFAULT_TOKEN_FALLBACK = "cst_autonomous_lan_secret_2025"


def get_config_dir() -> str:
    """Returns absolute path to AI NetController user configuration folder."""
    if platform.system() == "Windows":
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
    except Exception as e:
        logger.debug(f"Could not create config dir {config_dir}: {e}")
    return config_dir


def get_config_path() -> str:
    """Returns absolute path to config.json."""
    return os.path.join(get_config_dir(), "config.json")


def _generate_default_config() -> Dict[str, Any]:
    """Generates initial configuration with strong persistent credentials."""
    env_secret = os.environ.get("AI_AGENT_SECRET", os.environ.get("CST_AGENT_SECRET"))
    pairing_token = env_secret if env_secret else f"cst_sec_{secrets.token_hex(16)}"
    pairing_pin = f"{secrets.randbelow(900000) + 100000}"

    return {
        "version": "0.35.0",
        "protocol": "AI-NET/3.0-SECURE",
        "bind_host": DEFAULT_HOST,
        "port": DEFAULT_PORT,
        "pairing_pin": pairing_pin,
        "pairing_token": pairing_token,
        "view_only_mode": False,
        "require_hitl_approval": True,
        "clipboard_sync_allowed": True,
        "auto_lock_on_disconnect": False,
        "auto_ban_intrusion": True,
        "subnet_geofence_only": True,
        "security_profile": "balanced",
        "setup_completed": True,
    }


def load_config() -> Dict[str, Any]:
    """
    Loads persistent configuration from disk.
    If file does not exist or is corrupted, initializes with secure defaults and writes to disk.
    """
    cfg_path = get_config_path()
    config = _generate_default_config()

    if os.path.isfile(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                config.update(loaded)
                # Ensure essential security tokens are present
                if not config.get("pairing_pin"):
                    config["pairing_pin"] = f"{secrets.randbelow(900000) + 100000}"
                if not config.get("pairing_token"):
                    env_secret = os.environ.get("AI_AGENT_SECRET", os.environ.get("CST_AGENT_SECRET"))
                    config["pairing_token"] = env_secret or f"cst_sec_{secrets.token_hex(16)}"
                return config
        except Exception as e:
            logger.warning(f"Failed to read config from {cfg_path}, re-initializing: {e}")

    # Save newly generated defaults
    save_config(config)
    return config


def save_config(config: Dict[str, Any]) -> bool:
    """Atomically saves configuration dictionary to disk."""
    cfg_path = get_config_path()
    tmp_path = f"{cfg_path}.tmp.{secrets.token_hex(4)}"
    try:
        cfg_dir = os.path.dirname(cfg_path)
        os.makedirs(cfg_dir, exist_ok=True)
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        if os.path.isfile(cfg_path):
            try:
                os.replace(tmp_path, cfg_path)
            except OSError:
                os.remove(cfg_path)
                os.rename(tmp_path, cfg_path)
        else:
            os.rename(tmp_path, cfg_path)
        return True
    except Exception as e:
        logger.error(f"Error saving config to {cfg_path}: {e}")
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
        return False


def rotate_token() -> str:
    """Rotates pairing token, updates config on disk, and returns new token."""
    cfg = load_config()
    new_token = f"cst_sec_{secrets.token_hex(16)}"
    cfg["pairing_token"] = new_token
    save_config(cfg)
    return new_token


def regenerate_pin() -> str:
    """Regenerates 6-digit pairing PIN, updates config on disk, and returns new PIN."""
    cfg = load_config()
    new_pin = f"{secrets.randbelow(900000) + 100000}"
    cfg["pairing_pin"] = new_pin
    save_config(cfg)
    return new_pin
