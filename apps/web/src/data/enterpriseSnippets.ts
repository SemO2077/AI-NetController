export const ENTERPRISE_SNIPPETS = [
  {
    "filename": "agent/crypto_vault.py",
    "language": "python",
    "category": "backend",
    "description": "Hardened Curve25519, HKDF-SHA256, ChaCha20-Poly1305 AEAD & RFC 6479 128-Bit Sliding Replay Window",
    "code": `"""
Hardened Cryptographic Engine & Zero-Trust Protocol Pipeline
RFC 7748 (Curve25519 / X25519 Ephemeral ECDH)
RFC 5869 (HKDF-SHA256 Key Derivation - Twin Directional Session Keys)
RFC 8439 (ChaCha20-Poly1305 AEAD)
RFC 6479 (128-Bit Sliding Window Anti-Replay Protection)
"""

import hmac
import hashlib
import secrets
from typing import Tuple, Optional

KEY_SIZE = 32
NONCE_SIZE = 12
TAG_SIZE = 16
WINDOW_SIZE = 128

class SlidingWindowReplayProtector:
    """RFC 6479 Bitmap Sliding Window Replay Protection."""
    def __init__(self, window_size: int = 128):
        self.window_size = window_size
        self.max_seq: int = 0
        self.bitmap: int = 0
        self.initialized = False

    def validate_and_update(self, seq: int) -> bool:
        if not self.initialized:
            self.max_seq = seq
            self.bitmap = 1
            self.initialized = True
            return True

        diff = seq - self.max_seq
        if diff > 0:
            if diff < self.window_size:
                self.bitmap = (self.bitmap << diff) | 1
            else:
                self.bitmap = 1
            self.max_seq = seq
            self.bitmap &= (1 << self.window_size) - 1
            return True
        else:
            abs_diff = -diff
            if abs_diff >= self.window_size:
                return False
            bit_mask = 1 << abs_diff
            if (self.bitmap & bit_mask) != 0:
                return False
            self.bitmap |= bit_mask
            return True
`
  },
  {
    "filename": "apps/mobile/lib/crypto_engine.dart",
    "language": "dart",
    "category": "crossplatform",
    "description": "Flutter Client X25519 Ephemeral Key Exchange & HKDF Key Derivation Pipeline",
    "code": `import 'dart:typed_data';
import 'package:crypto/crypto.dart';

class CryptoEngine {
  static Uint8List deriveSessionKey(List<int> sharedSecret, List<int> salt, List<int> info) {
    final hmac = Hmac(sha256, salt);
    final prk = hmac.convert(sharedSecret).bytes;
    final hkdfExpand = Hmac(sha256, prk);
    return Uint8List.fromList(hkdfExpand.convert([...info, 0x01]).bytes.sublist(0, 32));
  }
}
`
  },
  {
    "filename": "agent/command_ast_firewall.py",
    "language": "python",
    "category": "backend",
    "description": "Hardened Shell Command AST Normalizer, Obfuscation Stripper & Sandbox Firewall",
    "code": `import re, os, shlex, platform

IS_WINDOWS = platform.system() == "Windows"
_RE_CARET = re.compile(r"\\^")
_RE_INTERSTITIAL_QUOTES = re.compile(r'(?<=\\w)["\\'](?=\\w)')

class CommandASTFirewall:
    @staticmethod
    def strip_obfuscation(raw_cmd: str) -> str:
        cleaned = raw_cmd.strip()
        if IS_WINDOWS:
            cleaned = os.path.expandvars(cleaned)
        cleaned = _RE_CARET.sub("", cleaned)
        cleaned = _RE_INTERSTITIAL_QUOTES.sub("", cleaned)
        return cleaned
`
  },
  {
    "filename": "apps/mobile/lib/thermal_governor.dart",
    "language": "dart",
    "category": "crossplatform",
    "description": "Thermal & Battery Throttling Governor for High-FPS Mobile Stream Rendering",
    "code": `class ThermalGovernor {
  int computeTargetFPS({required double batteryLevel, required bool isThermalThrottled}) {
    if (isThermalThrottled || batteryLevel < 0.15) return 15;
    if (batteryLevel < 0.30) return 30;
    return 60;
  }
}
`
  },
  {
    "filename": "agent/agent_gui.py",
    "language": "python",
    "category": "backend",
    "description": "Native Tkinter/TTK PC Daemon Desktop Control Center GUI (Telemetry, Pairing Key, View-Only Lock, NIC Check & AV Transparency)",
    "code": `"""
AI NetController - Native PC Daemon Desktop GUI Control Center (v0.27.0)
Provides a visible HWND desktop window so Windows Defender & SmartScreen classify
the binary as an interactive administrative tool rather than a hidden listener.
"""

import os, sys, time, socket, secrets, threading, platform
import psutil

try:
    import tkinter as tk
    from tkinter import ttk, messagebox
    HAS_TK = True
except ImportError:
    HAS_TK = False

class HostDaemonState:
    def __init__(self, host="0.0.0.0", port=8765):
        self.host = host
        self.port = port
        self.is_running = True
        self.is_paused = False
        self.view_only_mode = False
        self.require_hitl_approval = True
        self.pairing_token = f"AI-{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}"
        self.cpu_percent = 0.0
        self.ram_percent = 0.0
        self.disk_percent = 0.0

    def sample_telemetry(self):
        self.cpu_percent = round(psutil.cpu_percent(interval=None), 1)
        self.ram_percent = round(psutil.virtual_memory().percent, 1)
`
  },
  {
    "filename": "agent/sign_binary.ps1",
    "language": "powershell",
    "category": "backend",
    "description": "Windows Authenticode SHA-256 Code Signing & Windows Defender MpCmdRun Verification Script",
    "code": `param(
    [string]$BinaryPath = "dist\\CST_HostAgent\\AI_NetController_HostAgent.exe"
)
$ErrorActionPreference = "Stop"
$CertSubject = "CN=AI NetController, O=AI NetController, C=BG"
$Cert = Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert | Where-Object { $_.Subject -eq $CertSubject } | Select-Object -First 1
if (-not $Cert) {
    $Cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $CertSubject -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -CertStoreLocation "Cert:\\CurrentUser\\My"
}
Set-AuthenticodeSignature -FilePath $BinaryPath -Certificate $Cert -HashAlgorithm SHA256
`
  },
  {
    "filename": "PATCH_NOTES.md",
    "language": "markdown",
    "category": "docs",
    "description": "v0.27.0 Release Patch Notes — PC Daemon Desktop GUI, AV False-Positive Hardening & Native APK/EXE Releases",
    "code": `# Patch Notes — AI NetController v0.27.0

**Release Date:** October 24, 2026
**Version:** v0.27.0
**Protocol Version:** AI-NET/3.0-SECURE

## 1. Native PC Daemon Control Center GUI (agent_gui.py & PcDaemonGuiModal.tsx)
- Interactive Desktop Control Center with live CPU/RAM/Disk/FPS telemetry, 1-click WebSocket URI & Pairing Key copy/rotate, Start/Pause toggle, View-Only Mode (remote input lock), HITL approval gate, native NIC & WoL check, Panic Disconnect All, and live event console.

## 2. Antivirus False-Positive Elimination & Binary Hardening
- Zero UPX Compression (upx=False on both EXE and COLLECT in build_agent.spec).
- Visible top-level HWND window via Tkinter/TTK instead of a headless background listener.
- Pure Python psutil/socket NIC diagnostics replacing hidden powershell.exe / cmd.exe subprocesses.
- SHA-256 Authenticode Code Signing & Windows Defender MpCmdRun scan verification (sign_binary.ps1).
`
  }
];

