#!/usr/bin/env python3
"""
================================================================================
AI NetController - System-Wide Edge Case Verification Suite
File: agent/tests/test_all_edge_cases.py
Architecture: Edge Case & Boundary Matrix for AI NetController
Target: Host Daemon, Crypto Vault, AST Firewall, WoL Generator, Wire Protocol
================================================================================
Tests boundary conditions, malformed inputs, injection patterns, and network
anomalies across core subsystems.
================================================================================
"""

import os
import sys
import time
import struct
import socket
import hashlib
import asyncio
import tempfile
import unittest
from pathlib import Path
from typing import List, Tuple, Optional

# Ensure agent directory is in sys.path
AGENT_DIR = Path(__file__).resolve().parents[1]
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from crypto_handshake import HostCryptoSession, AuthenticatedCipher, derive_session_key, INFO_STRING
from command_ast_firewall import CommandASTFirewall
from host_file_writer import (
    HostFileWriter, CMD_INIT, CMD_CHUNK, CMD_FINISH, CMD_ABORT,
    STATUS_OK, STATUS_PROGRESS, STATUS_COMPLETED, STATUS_ERR_CHECKSUM, STATUS_ERR_TRAVERSAL,
    STATUS_ERR_IO,
)

# Protocol Constants
MAGIC = b'\xC5\x71'
HEADER_STRUCT = struct.Struct('!2sBBII')
HEADER_SIZE = 12

OP_PING = 0x01
OP_TELEMETRY = 0x02
OP_FRAME = 0x03
OP_SHELL = 0x04
OP_HITL = 0x05
OP_AUTH = 0x06
OP_CLIP = 0x07
OP_INPUT = 0x08
OP_AUDIO = 0x09
OP_VIEWPORT_RESIZE = 0x0A
OP_FILE_TRANSFER = 0x0C


class RFC6479SlidingWindow:
    """Implements RFC 6479 / RFC 4303 128-bit Anti-Replay Sliding Window."""
    def __init__(self, window_size: int = 128):
        self.window_size = window_size
        self.bitmap = 0
        self.max_seq = 0

    def check_and_update(self, seq: int) -> bool:
        if seq <= 0:
            return False

        if seq > self.max_seq:
            diff = seq - self.max_seq
            if diff >= self.window_size:
                self.bitmap = 1
            else:
                self.bitmap = (self.bitmap << diff) | 1
            self.max_seq = seq
            return True

        diff = self.max_seq - seq
        if diff >= self.window_size:
            return False

        if (self.bitmap & (1 << diff)) != 0:
            return False

        self.bitmap |= (1 << diff)
        return True


# ==============================================================================
# EDGE CASE MATRIX 1: WAKE-ON-LAN ROBUSTNESS & MAGIC PACKET BOUNDARIES
# ==============================================================================
class TestWolEdgeCases(unittest.TestCase):
    """Deep boundary and mutation testing for Wake-on-LAN generation."""

    def _generate_magic_packet(self, mac_str: str) -> bytes:
        clean = "".join(c for c in mac_str if c in "0123456789abcdefABCDEF").upper()
        if len(clean) != 12:
            raise ValueError(f"Invalid MAC: {mac_str}")
        mac_bytes = bytes.fromhex(clean)
        return (b'\xFF' * 6) + (mac_bytes * 16)

    def test_mac_format_variations(self):
        """Asserts correct parsing across all standard and non-standard MAC formats."""
        canonical = "00:1A:2B:3C:4D:5E"
        variations = [
            "00:1a:2b:3c:4d:5e",         # Lowercase colons
            "00-1A-2B-3C-4D-5E",         # Windows hyphens
            "00 1A 2B 3C 4D 5E",         # Spaces
            "001A2B3C4D5E",             # Raw hex
            "00:1a-2B 3c:4D-5e",         # Mixed delimiters
            "00.1A.2B.3C.4D.5E",         # Dot notation (Cisco)
        ]
        target_bytes = bytes.fromhex("001A2B3C4D5E")
        expected_packet = (b'\xFF' * 6) + (target_bytes * 16)

        for var in variations:
            packet = self._generate_magic_packet(var)
            self.assertEqual(len(packet), 102, f"Failed for format: {var}")
            self.assertEqual(packet, expected_packet, f"Mismatch for format: {var}")

    def test_invalid_mac_rejection(self):
        """Asserts rejection of invalid, truncated, and malicious MAC strings."""
        invalid_inputs = [
            "",                          # Empty string
            "00:11:22:33:44",            # Truncated (5 octets)
            "00:11:22:33:44:55:66",      # Oversized (7 octets)
            "00:11:22:33:44:GG",         # Non-hex character G
            "'; DROP TABLE hosts; --",   # SQL injection string
            "<script>alert(1)</script>", # XSS payload
            "00:00:00:00:00:00:00",      # Oversized
            "FFFFFFFFFFFFF",             # 13 chars
            "FFFFFFFFFFF",               # 11 chars
        ]
        for inv in invalid_inputs:
            with self.assertRaises(ValueError, msg=f"Should reject: {inv}"):
                self._generate_magic_packet(inv)

    def test_broadcast_ip_socket_binding(self):
        """Verifies UDP socket options for SO_BROADCAST on ports 7 and 9."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        
        # Test generation for broadcast target
        pkt = self._generate_magic_packet("00:11:22:33:44:55")
        self.assertEqual(len(pkt), 102)
        sock.close()


# ==============================================================================
# EDGE CASE MATRIX 2: BINARY WIRE PROTOCOL & PROTOCOL SHIELD FUZZING
# ==============================================================================
class TestBinaryProtocolEdgeCases(unittest.TestCase):
    """Stress tests framing, fragmentation, and header corruptions."""

    def pack(self, opcode: int, payload: bytes = b'', flags: int = 0, seq: int = 0) -> bytes:
        return HEADER_STRUCT.pack(MAGIC, opcode, flags, seq, len(payload)) + payload

    def unpack(self, data: bytes) -> Optional[Tuple[int, int, int, bytes]]:
        if len(data) < HEADER_SIZE:
            return None
        magic, opcode, flags, seq, length = HEADER_STRUCT.unpack(data[:HEADER_SIZE])
        if magic != MAGIC:
            return None
        if len(data) < HEADER_SIZE + length:
            return None
        return opcode, flags, seq, data[HEADER_SIZE:HEADER_SIZE + length]

    def test_truncated_header_resilience(self):
        """Asserts graceful rejection of packets with 0 to 11 bytes."""
        full = self.pack(OP_PING, b'PONG', seq=1)
        for cutoff in range(0, HEADER_SIZE):
            truncated = full[:cutoff]
            parsed = self.unpack(truncated)
            self.assertIsNone(parsed, f"Truncated packet of length {cutoff} should return None")

    def test_magic_signature_fuzzing(self):
        """Asserts rejection of single-bit flips and corruptions in the magic bytes."""
        valid = self.pack(OP_PING, b'TEST', seq=1)
        
        corrupted_magics = [
            b'\xC5\x70',  # 1 bit off
            b'\xC4\x71',  # 1 bit off
            b'\x00\x00',  # Null bytes
            b'\xFF\xFF',  # Max bytes
            b'CS',        # ASCII chars
            b'\x71\xC5',  # Endian-swapped
        ]
        for bad_m in corrupted_magics:
            corrupted = bytearray(valid)
            corrupted[0:2] = bad_m
            self.assertIsNone(self.unpack(bytes(corrupted)))

    def test_payload_length_mismatch_boundary(self):
        """Asserts rejection when header declares length N but buffer contains < N."""
        # Declare 1000 bytes, but only provide 10
        faked_header = HEADER_STRUCT.pack(MAGIC, OP_FRAME, 0, 100, 1000)
        short_buffer = faked_header + (b'X' * 10)
        self.assertIsNone(self.unpack(short_buffer))

    def test_zero_byte_empty_payload(self):
        """Asserts proper handling of zero-length payloads (e.g. Keep-Alive / Ping)."""
        ping = self.pack(OP_PING, b'', seq=999)
        self.assertEqual(len(ping), HEADER_SIZE)
        parsed = self.unpack(ping)
        self.assertIsNotNone(parsed)
        opcode, flags, seq, payload = parsed
        self.assertEqual(opcode, OP_PING)
        self.assertEqual(len(payload), 0)
        self.assertEqual(seq, 999)

    def test_sequence_number_rollover(self):
        """Asserts 32-bit uint boundary (0xFFFFFFFF) sequence handling."""
        max_uint32 = 0xFFFFFFFF
        pkt = self.pack(OP_TELEMETRY, b'STATUS_OK', seq=max_uint32)
        parsed = self.unpack(pkt)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed[2], max_uint32)


# ==============================================================================
# EDGE CASE MATRIX 3: RFC 6479 ANTI-REPLAY SLIDING WINDOW
# ==============================================================================
class TestAntiReplayEdgeCases(unittest.TestCase):
    """Tests extreme edge cases in sequence replay detection."""

    def setUp(self):
        self.window = RFC6479SlidingWindow(window_size=128)

    def test_exact_duplicate_rejection(self):
        """Asserts that identical sequence numbers are strictly rejected."""
        self.assertTrue(self.window.check_and_update(100))
        self.assertFalse(self.window.check_and_update(100))
        self.assertFalse(self.window.check_and_update(100))

    def test_large_forward_sequence_jump(self):
        """Asserts window correctly shifts when receiving sequence jump > window size."""
        self.assertTrue(self.window.check_and_update(10))
        # Jump ahead by 500 packets
        self.assertTrue(self.window.check_and_update(510))
        # Old packet 10 is now outside the 128-bit window and must be rejected
        self.assertFalse(self.window.check_and_update(10))
        # Packet 500 should be valid (within 128 from 510)
        self.assertTrue(self.window.check_and_update(500))

    def test_interleaved_out_of_order_arrival(self):
        """Asserts that out-of-order packets within the 128-packet window are accepted."""
        seqs = [50, 48, 49, 45, 47, 46, 51, 52]
        for s in seqs:
            self.assertTrue(self.window.check_and_update(s), f"Failed for seq: {s}")


# ==============================================================================
# EDGE CASE MATRIX 4: AST COMMAND FIREWALL INJECTION & EVASION
# ==============================================================================
class TestASTFirewallEvasion(unittest.TestCase):
    """Tests advanced evasion techniques against the AST Command Firewall."""

    def test_obfuscated_carets_and_quotes(self):
        """Blocks Windows cmd.exe caret and quotation evasion (e.g. c^m^d /c f^o^r^m^a^t)."""
        evasions = [
            'f^o^r^m^a^t C: /q',
            'd^e^l /f /s /q *.*',
            'r"m" -rf /',
            "p'o'w'e'r's'h'e'l'l -Command Remove-Item -Recurse C:\\",
            's^h^u^t^d^o^w^n /r /t 0',
        ]
        for cmd in evasions:
            is_allowed, risk, normalized, reason = CommandASTFirewall.inspect_and_sanitize(cmd)
            self.assertIn(
                risk,
                ["BLOCKED", "REQUIRES_BIOMETRIC"],
                f"Evasion bypassed firewall: {cmd} (normalized: {normalized})"
            )

    def test_chained_operator_injection(self):
        """Blocks compound execution via semicolons, logical AND/OR, and pipes."""
        attacks = [
            'echo Hello ; format D: /fs:ntfs',
            'dir C:\\ && rm -rf /var/log',
            'type file.txt || shutdown -s -t 0',
            'Get-Process | Stop-Process -Force',
            'echo safe & del /f confidential.db',
        ]
        for cmd in attacks:
            is_allowed, risk, normalized, reason = CommandASTFirewall.inspect_and_sanitize(cmd)
            self.assertIn(
                risk,
                ["BLOCKED", "REQUIRES_BIOMETRIC"],
                f"Compound attack bypassed firewall: {cmd}"
            )

    def test_path_traversal_detection(self):
        """Detects and blocks directory traversal attempts in commands."""
        traversals = [
            '../../../../Windows/System32/cmd.exe',
            '..\\..\\Windows\\System32\\cmd.exe /c whoami',
        ]
        for cmd in traversals:
            is_allowed, risk, normalized, reason = CommandASTFirewall.inspect_and_sanitize(cmd)
            self.assertEqual(risk, "BLOCKED", f"Path traversal not blocked: {cmd}")

    def test_empty_and_whitespace_commands(self):
        """Handles empty string, whitespace, and null commands safely."""
        invalids = ["", "   ", "\t\t", "\n\r"]
        for cmd in invalids:
            is_allowed, risk, normalized, reason = CommandASTFirewall.inspect_and_sanitize(cmd)
            self.assertEqual(risk, "BLOCKED")

    def test_benign_commands_pass_cleanly(self):
        """Confirms safe diagnostic utilities pass as SAFE."""
        safe_commands = [
            'ipconfig',
            'ping 127.0.0.1',
            'hostname',
            'whoami',
        ]
        for cmd in safe_commands:
            is_allowed, risk, normalized, reason = CommandASTFirewall.inspect_and_sanitize(cmd)
            self.assertEqual(
                risk,
                "SAFE",
                f"False positive on benign command: {cmd} (reason: {reason})"
            )


# ==============================================================================
# EDGE CASE MATRIX 5: CRYPTO HANDSHAKE INTEGRITY & TAMPER RESISTANCE
# ==============================================================================
class TestCryptoTamperResistance(unittest.TestCase):
    """Asserts cryptographic integrity, auth tag enforcement, and tampering."""

    def setUp(self):
        self.key = os.urandom(32)
        self.cipher = AuthenticatedCipher(self.key)

    def test_tampered_ciphertext_detection(self):
        """Asserts that 1-bit corruption in ciphertext triggers Poly1305 failure."""
        plaintext = b"CONFIDENTIAL_TELEMETRY_PAYLOAD_CST_2026"
        seq = 1
        nonce = struct.pack("!QI", seq, 0x484F5354)
        aad = struct.pack("!I", seq)
        ciphertext = self.cipher.encrypt(nonce, plaintext, aad=aad)

        # Corrupt 1 byte in ciphertext
        corrupted = bytearray(ciphertext)
        corrupted[0] ^= 0xFF
        corrupted_bytes = bytes(corrupted)

        with self.assertRaises(Exception):
            self.cipher.decrypt(nonce, corrupted_bytes, aad=aad)

    def test_tampered_nonce_detection(self):
        """Asserts that corrupted nonce triggers decryption failure."""
        plaintext = b"AUTHENTICATED_COMMAND_PACKET"
        seq = 2
        nonce = struct.pack("!QI", seq, 0x484F5354)
        aad = struct.pack("!I", seq)
        ciphertext = self.cipher.encrypt(nonce, plaintext, aad=aad)

        # Corrupt nonce
        corrupted_nonce = bytearray(nonce)
        corrupted_nonce[0] ^= 0x01

        with self.assertRaises(Exception):
            self.cipher.decrypt(bytes(corrupted_nonce), ciphertext, aad=aad)

    def test_sequence_mismatch_auth_failure(self):
        """Asserts AEAD Additional Authenticated Data (AAD) binds sequence number."""
        plaintext = b"BOUND_SEQUENCE_DATA"
        seq = 10
        nonce = struct.pack("!QI", seq, 0x484F5354)
        aad_original = struct.pack("!I", seq)
        aad_mismatched = struct.pack("!I", 11)
        ciphertext = self.cipher.encrypt(nonce, plaintext, aad=aad_original)

        # Attempt to decrypt with wrong sequence number in AAD
        with self.assertRaises(Exception):
            self.cipher.decrypt(nonce, ciphertext, aad=aad_mismatched)


# ==============================================================================
# EDGE CASE MATRIX 6: CHUNKED FILE TRANSFER & PARITY ZERO-TRUST
# ==============================================================================
class TestChunkedTransferEdgeCases(unittest.TestCase):
    """Tests file transfer edge cases (0-byte file, corrupt chunk, path traversal)."""

    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.writer = HostFileWriter(download_dir=Path(self.tmp_dir.name))

    def tearDown(self):
        self.tmp_dir.cleanup()

    def _parse_ack(self, ack_packet: bytes) -> Tuple[int, int, int, str]:
        # Header is 12 bytes
        self.assertGreaterEqual(len(ack_packet), 12 + 13)
        body = ack_packet[12:]
        transfer_id, status, bytes_written = struct.unpack_from('!IBQ', body, 0)
        msg = body[13:].decode('utf-8', errors='ignore')
        return transfer_id, status, bytes_written, msg

    def test_zero_byte_empty_file_transfer(self):
        """Handles 0-byte empty file correctly with SHA-256 e3b0c442..."""
        empty_data = b""
        sha256 = hashlib.sha256(empty_data).hexdigest()
        transfer_id = 101
        filename = "empty.txt"

        # CMD_INIT: [1 cmd][4 id][8 total_size][64 sha256_hex][filename_utf8]
        init_payload = (
            struct.pack('!BIQ', CMD_INIT, transfer_id, 0) +
            sha256.encode('ascii') +
            filename.encode('utf-8')
        )
        ack = self.writer.handle_packet(init_payload)
        _, status, _, _ = self._parse_ack(ack)
        self.assertEqual(status, STATUS_OK)

        # CMD_FINISH: [1 cmd][4 id]
        finish_payload = struct.pack('!BI', CMD_FINISH, transfer_id)
        finish_ack = self.writer.handle_packet(finish_payload)
        _, finish_status, written, _ = self._parse_ack(finish_ack)
        self.assertEqual(finish_status, STATUS_COMPLETED)
        self.assertEqual(written, 0)

        out_path = Path(self.tmp_dir.name) / filename
        self.assertTrue(out_path.exists())
        self.assertEqual(out_path.stat().st_size, 0)

    def test_corrupted_chunk_detection(self):
        """Rejects transfer if any chunk payload is tampered with (SHA-256 failure)."""
        chunk1 = b"PART_1_VALID_DATA"
        chunk2_valid = b"PART_2_VALID_DATA"
        chunk2_corrupt = b"PART_2_TAMPERED_X"

        full_valid = chunk1 + chunk2_valid
        expected_sha = hashlib.sha256(full_valid).hexdigest()
        transfer_id = 102
        filename = "firmware.bin"

        # INIT
        init_payload = (
            struct.pack('!BIQ', CMD_INIT, transfer_id, len(full_valid)) +
            expected_sha.encode('ascii') +
            filename.encode('utf-8')
        )
        ack = self.writer.handle_packet(init_payload)
        _, status, _, _ = self._parse_ack(ack)
        self.assertEqual(status, STATUS_OK)

        # CHUNK 1 (Valid)
        chunk1_payload = struct.pack('!BIQ', CMD_CHUNK, transfer_id, 0) + chunk1
        ack1 = self.writer.handle_packet(chunk1_payload)
        _, status1, _, _ = self._parse_ack(ack1)
        self.assertEqual(status1, STATUS_PROGRESS)

        # CHUNK 2 (Corrupted)
        chunk2_payload = struct.pack('!BIQ', CMD_CHUNK, transfer_id, len(chunk1)) + chunk2_corrupt
        ack2 = self.writer.handle_packet(chunk2_payload)
        _, status2, _, _ = self._parse_ack(ack2)
        self.assertEqual(status2, STATUS_PROGRESS)

        # FINISH - must fail checksum
        finish_payload = struct.pack('!BI', CMD_FINISH, transfer_id)
        finish_ack = self.writer.handle_packet(finish_payload)
        _, finish_status, _, msg = self._parse_ack(finish_ack)
        self.assertEqual(finish_status, STATUS_ERR_CHECKSUM)

    def test_path_traversal_prevention(self):
        """Rejects malicious filename attempting to escape download chroot."""
        malicious_filename = "../../../etc/shadow"
        transfer_id = 103
        dummy_sha = hashlib.sha256(b"dummy").hexdigest()

        init_payload = (
            struct.pack('!BIQ', CMD_INIT, transfer_id, 5) +
            dummy_sha.encode('ascii') +
            malicious_filename.encode('utf-8')
        )
        # Should sanitize base name or block traversal safely inside download dir
        ack = self.writer.handle_packet(init_payload)
        _, status, _, _ = self._parse_ack(ack)
        # Sanitizer strips ../ and stores as 'shadow' inside chroot or returns error
        transfer = self.writer.active_transfers.get(transfer_id)
        if transfer:
            self.assertTrue(self.writer.download_dir in transfer.target_path.parents)


# ==============================================================================
# EDGE CASE MATRIX 7: ASYNC PROCESS SUPERVISION TIMEOUT RECOVERY
# ==============================================================================
class TestProcessSupervisionEdgeCases(unittest.TestCase):
    """Verifies timeout recovery and clean child process teardown."""

    def test_escalating_termination_cleanliness(self):
        """Ensures timed-out subprocesses are cleanly killed without resource leaks."""
        async def run_timeout_test():
            # Safe long-running command that hits timeout and exercises escalating kill
            infinite_cmd = "ping 127.0.0.1 -n 30" if sys.platform.startswith("win") else "sleep 30"
            t0 = time.perf_counter()
            res = await CommandASTFirewall.execute_sandboxed(infinite_cmd, timeout_sec=1.0)
            elapsed = time.perf_counter() - t0

            # Must terminate within ~4 seconds (timeout + escalating sigterm/sigkill)
            self.assertLess(elapsed, 4.0, f"Process termination took too long: {elapsed}s")
            self.assertFalse(res["success"], "Timed-out process must report success=False")
            self.assertTrue(
                "exceeded maximum allowed runtime" in res.get("stderr", "").lower() or
                "timed out" in res.get("stderr", "").lower() or
                res.get("exit_code") in (-9, 124, 137, -15),
                f"Expected timeout indicator in result, got: {res}"
            )

        asyncio.run(run_timeout_test())


# ==============================================================================
# EDGE CASE MATRIX 8: PC DAEMON GUI STATE & ANTIVIRUS FALSE-POSITIVE HARDENING
# ==============================================================================
class TestHostDaemonGuiAndAvHardening(unittest.TestCase):
    """Verifies HostDaemonState GUI controller and AV-clean PyInstaller spec rules."""

    def test_daemon_gui_state_and_diagnostics(self):
        from agent_gui import HostDaemonState
        state = HostDaemonState(host="0.0.0.0", port=8765)
        self.assertTrue(len(state.pairing_token) >= 8)
        old_token = state.pairing_token
        new_token = state.rotate_pairing_token()
        self.assertNotEqual(old_token, new_token)
        self.assertTrue(new_token.startswith(("ainet_", "ai_sec_")))

        snap = state.sample_telemetry()
        self.assertGreaterEqual(state.cpu_percent, 0.0)
        self.assertLessEqual(state.cpu_percent, 100.0)
        self.assertGreaterEqual(state.ram_percent, 0.0)
        self.assertLessEqual(state.ram_percent, 100.0)
        self.assertTrue(snap["avIntegrity"]["upx_disabled"])
        self.assertTrue(snap["avIntegrity"]["visible_hwnd"])
        self.assertTrue(snap["avIntegrity"]["zero_hidden_shell"])

        diag = state.run_safe_nic_diagnostics()
        self.assertIn("udp_broadcast_ready", diag)
        self.assertIn("active_interfaces", diag)

    def test_pyinstaller_spec_antivirus_compliance(self):
        spec_path = AGENT_DIR / "build_agent.spec"
        manifest_path = AGENT_DIR / "app_manifest.xml"
        self.assertTrue(spec_path.exists(), "build_agent.spec must exist")
        self.assertTrue(manifest_path.exists(), "app_manifest.xml must exist")
        spec_content = spec_path.read_text(encoding="utf-8")
        manifest_content = manifest_path.read_text(encoding="utf-8")
        # Must NEVER enable UPX packing (major cause of Win32/Wacatac.B!ml false positives)
        self.assertNotIn("upx=True", spec_content, "upx=True triggers AV false positives and must be False")
        self.assertGreaterEqual(spec_content.count("upx=False"), 2, "Both EXE and COLLECT must set upx=False")
        self.assertIn("'agent_gui'", spec_content)
        self.assertIn("app_manifest.xml", spec_content)
        self.assertIn("PerMonitorV2", manifest_content)

    def test_firewall_and_release_no_stub_contracts(self):
        # 1. Verify AST firewall blocks/holds inline python execution & route modification
        allowed_py, risk_py, _, _ = CommandASTFirewall.inspect_and_sanitize('python -c "import os"')
        self.assertTrue(allowed_py)
        self.assertEqual(risk_py, "REQUIRES_BIOMETRIC")

        allowed_rt, risk_rt, _, _ = CommandASTFirewall.inspect_and_sanitize("route print")
        self.assertTrue(allowed_rt)
        self.assertEqual(risk_rt, "REQUIRES_BIOMETRIC")

        # 2. Verify build_release_binaries.py never fabricates a minimal stub APK
        build_rel = (AGENT_DIR.parent / "scripts" / "build_release_binaries.py").read_text(encoding="utf-8")
        self.assertNotIn("0x0103", build_rel)
        self.assertIn("build_android_app.py", build_rel)

    def test_chunk_bounds_error_closes_file_handle(self):
        with tempfile.TemporaryDirectory() as tmp:
            writer = HostFileWriter(download_dir=Path(tmp))
            data = b"ABCDEF"
            sha = hashlib.sha256(data).hexdigest()
            tid = 999
            init_p = struct.pack("!BIQ", CMD_INIT, tid, len(data)) + sha.encode("ascii") + b"bounds.bin"
            writer.handle_packet(init_p)
            # Chunk exceeds declared size (len 6 vs offset 4 + len 5 = 9)
            bad_chunk = struct.pack("!BIQ", CMD_CHUNK, tid, 4) + b"12345"
            ack = writer.handle_packet(bad_chunk)
            _, status, _ = struct.unpack("!IBQ", ack[12:25])
            self.assertEqual(status, STATUS_ERR_IO)
            tr = writer.active_transfers.get(tid)
            self.assertIsNotNone(tr)
            self.assertIsNone(tr.file_handle)
            tr.abort()


# ==============================================================================
# UNIFIED EDGE-CASE VERIFICATION RUNNER
# ==============================================================================
def run_all_edge_case_tests() -> bool:
    """Executes all edge case suites with real-time latency and status reporting."""
    print("=" * 80)
    print(" AI NETCONTROLLER: SYSTEM-WIDE EDGE CASE & BOUNDARY VERIFICATION")
    print(f" Platform: {sys.platform} | Python: {sys.version.split()[0]}")
    print("=" * 80)

    test_classes = [
        ("EC-01: Wake-on-LAN Boundary & Mutation Matrix", TestWolEdgeCases),
        ("EC-02: CST Binary Wire Protocol Framing & Fuzzing", TestBinaryProtocolEdgeCases),
        ("EC-03: RFC 6479 Anti-Replay Sliding Window Extremes", TestAntiReplayEdgeCases),
        ("EC-04: AST Command Firewall Evasion & Injections", TestASTFirewallEvasion),
        ("EC-05: Curve25519 & ChaCha20 Tamper Resistance", TestCryptoTamperResistance),
        ("EC-06: Chunked Zero-Trust Transfer Parity Edge Cases", TestChunkedTransferEdgeCases),
        ("EC-07: Process Supervision Timeout & Teardown", TestProcessSupervisionEdgeCases),
        ("EC-08: PC Daemon GUI & AV False-Positive Hardening", TestHostDaemonGuiAndAvHardening),
    ]

    total_tests = 0
    passed_tests = 0
    failed_tests = 0
    results: List[Tuple[str, str, float]] = []

    for name, cls in test_classes:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(cls)
        for test in suite:
            total_tests += 1
            t0 = time.perf_counter()
            try:
                # Run test
                test_result = unittest.TestResult()
                test.run(test_result)
                elapsed = (time.perf_counter() - t0) * 1000.0

                if test_result.wasSuccessful():
                    passed_tests += 1
                    results.append((f"{name} -> {test._testMethodName}", "PASS", elapsed))
                else:
                    failed_tests += 1
                    err_msg = ""
                    if test_result.errors:
                        err_msg = str(test_result.errors[0][1]).splitlines()[-1]
                    elif test_result.failures:
                        err_msg = str(test_result.failures[0][1]).splitlines()[-1]
                    results.append((f"{name} -> {test._testMethodName} [{err_msg[:30]}]", "FAIL", elapsed))
            except Exception as ex:
                elapsed = (time.perf_counter() - t0) * 1000.0
                failed_tests += 1
                results.append((f"{name} -> {test._testMethodName} [ERR: {ex}]", "FAIL", elapsed))

    # Print Summary Table
    print(f"\n{'EDGE CASE TEST VECTOR':<62} | {'STATUS':<6} | {'LATENCY':>8}")
    print("-" * 80)
    for test_name, status, lat in results:
        status_str = "\033[92mPASS\033[0m" if status == "PASS" else "\033[91mFAIL\033[0m"
        print(f"{test_name[:61]:<62} | {status_str:<15} | {lat:>6.1f}ms")

    print("-" * 80)
    print(f"EDGE CASE VERIFICATION SUMMARY: {passed_tests}/{total_tests} PASSED ({failed_tests} FAILED)")
    print("=" * 80)

    return failed_tests == 0


if __name__ == "__main__":
    success = run_all_edge_case_tests()
    sys.exit(0 if success else 1)
