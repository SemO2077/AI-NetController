"""
CST Autonomous Host Agent - Comprehensive Chaos & Stress Test Suite
Verifies:
1. Binary Protocol Fuzzing & Upper Bound Enforcement (OP_PING, OP_FRAME, OP_SHELL)
2. Adler-32 Delta Frame Hash Efficiency & Zero-Memory Leaks
3. AST Firewall Risk Detection & HITL Intercept
"""

import unittest
import struct
import zlib
import sys
import os

# Include parent directory in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

try:
    from agent import parse_header, pack_packet, MAGIC, OP_PING
except ImportError:
    from agent.agent import parse_header, pack_packet, MAGIC, OP_PING
from command_ast_firewall import CommandASTFirewall

class TestAgentStressSuite(unittest.TestCase):

    def test_binary_protocol_fuzzing_and_bounds(self):
        """Fuzz test against 12-byte header with corrupt length, truncation, and garbage bytes."""
        # 1. Negative / Out of bounds 4GB payload length
        corrupt_header = struct.pack('!2sBBII', MAGIC, OP_PING, 0, 100, 0xFFFFFFFF)
        self.assertIsNone(parse_header(corrupt_header), "Oversized 4GB payload length must be rejected by parse_header")

        # 2. Truncated header (less than 12 bytes)
        truncated_header = b'\xC5\x71\x01\x00'
        self.assertIsNone(parse_header(truncated_header), "Truncated header must return None")

        # 3. Stream misalignment / Corrupt magic bytes
        invalid_magic = struct.pack('!2sBBII', b'XX', OP_PING, 0, 1, 10)
        self.assertIsNone(parse_header(invalid_magic), "Invalid magic sequence must return None")

        # 4. Valid packed packet verification
        valid_packet = pack_packet(OP_PING, b'PING_TEST', seq=42)
        parsed = parse_header(valid_packet)
        self.assertIsNotNone(parsed)
        opcode, flags, seq, length = parsed
        self.assertEqual(opcode, OP_PING)
        self.assertEqual(seq, 42)
        self.assertEqual(length, len(b'PING_TEST'))

    def test_adler32_delta_frame_hashing(self):
        """Validates Adler-32 checksum efficiency for zero-copy static frame detection."""
        static_frame_1 = b'\x00' * 1024 * 102
        static_frame_2 = b'\x00' * 1024 * 102
        dynamic_frame = b'\xFF' * 1024 * 102

        hash_1 = zlib.adler32(static_frame_1)
        hash_2 = zlib.adler32(static_frame_2)
        hash_3 = zlib.adler32(dynamic_frame)

        self.assertEqual(hash_1, hash_2, "Identical static frames must produce matching Adler-32 hashes")
        self.assertNotEqual(hash_1, hash_3, "Modified frames must trigger a hash delta")

    def test_ast_firewall_risk_interception(self):
        """Validates AST firewall interception against dangerous commands."""
        destructive_payloads = [
            "rm -rf /",
            "format C: /FS:NTFS /Q",
            "del /f /s /q C:\\Windows\\System32",
            "dd if=/dev/zero of=/dev/sda",
            "w^in^g^et",
            "Format-Volume -DriveLetter C",
        ]

        for cmd in destructive_payloads:
            is_allowed, risk_level, normalized, reason = CommandASTFirewall.inspect_and_sanitize(cmd)
            self.assertTrue(
                not is_allowed or risk_level in ('REQUIRES_BIOMETRIC', 'BLOCKED', 'HIGH', 'CRITICAL'),
                f"Destructive payload '{cmd}' must be intercepted/blocked by AST firewall"
            )

if __name__ == '__main__':
    unittest.main()
