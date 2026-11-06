import time
import os
import sys
import zlib

# Ensure agent directory is importable directly
repo_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
agent_dir = os.path.join(repo_dir, "agent")
if agent_dir not in sys.path:
    sys.path.insert(0, agent_dir)

from crypto_handshake import PurePythonX25519, FastX25519, AuthenticatedCipher, derive_session_key
from command_ast_firewall import CommandASTFirewall

print("=========================================================================")
print("  CST NETCONTROLLER AI - QUANTITATIVE PERFORMANCE BENCHMARK SUITE")
print("=========================================================================\n")

# -------------------------------------------------------------
# 1. Crypto ECDH Key Exchange: Pure-Python vs FastX25519 C-Extension
# -------------------------------------------------------------
rounds_ecdh = 300
print(f"[Benchmark 1] X25519 ECDH Key Exchange ({rounds_ecdh} complete dual-party exchanges)...")

# Pure Python
t0 = time.perf_counter()
for _ in range(rounds_ecdh):
    h_priv = PurePythonX25519.generate_private_key()
    h_pub = PurePythonX25519.public_key_from_private(h_priv)
    c_priv = PurePythonX25519.generate_private_key()
    c_pub = PurePythonX25519.public_key_from_private(c_priv)
    h_sec = PurePythonX25519.compute_shared_secret(h_priv, c_pub)
    c_sec = PurePythonX25519.compute_shared_secret(c_priv, h_pub)
    assert h_sec == c_sec
pure_ecdh_ms = (time.perf_counter() - t0) * 1000
pure_ecdh_rate = rounds_ecdh / (pure_ecdh_ms / 1000)

# Fast Hardware C-extension
t0 = time.perf_counter()
for _ in range(rounds_ecdh):
    h_priv = FastX25519.generate_private_key()
    h_pub = FastX25519.public_key_from_private(h_priv)
    c_priv = FastX25519.generate_private_key()
    c_pub = FastX25519.public_key_from_private(c_priv)
    h_sec = FastX25519.compute_shared_secret(h_priv, c_pub)
    c_sec = FastX25519.compute_shared_secret(c_priv, h_pub)
    assert h_sec == c_sec
fast_ecdh_ms = (time.perf_counter() - t0) * 1000
fast_ecdh_rate = rounds_ecdh / (fast_ecdh_ms / 1000)
ecdh_speedup = pure_ecdh_ms / fast_ecdh_ms

print(f"  - Pure Python ECDH:     {pure_ecdh_ms:7.2f} ms ({pure_ecdh_rate:8.1f} exchanges/sec, {pure_ecdh_ms/rounds_ecdh:.4f} ms/op)")
print(f"  - Fast Hardware ECDH:   {fast_ecdh_ms:7.2f} ms ({fast_ecdh_rate:8.1f} exchanges/sec, {fast_ecdh_ms/rounds_ecdh:.4f} ms/op)")
print(f"  >>> Speedup: {ecdh_speedup:.1f}x FASTER (ECDH Latency reduced by {((pure_ecdh_ms - fast_ecdh_ms)/pure_ecdh_ms)*100:.1f}%)\n")


# -------------------------------------------------------------
# 2. ChaCha20-Poly1305 AEAD Stream (10,000 frames)
# -------------------------------------------------------------
aead_rounds = 10000
print(f"[Benchmark 2] ChaCha20-Poly1305 AEAD ({aead_rounds:,} telemetry frames)...")
salt = os.urandom(16)
key = derive_session_key(h_sec, salt)
cipher = AuthenticatedCipher(key)
payload = b"CST-TELEMETRY-PAYLOAD-SAMPLE-FRAME-DATA-CPU-RAM-120HZ"
nonce = os.urandom(12)
aad = b"HEADER_AAD_METADATA"

t0 = time.perf_counter()
for _ in range(aead_rounds):
    ct = cipher.encrypt(nonce, payload, aad=aad)
    pt = cipher.decrypt(nonce, ct, aad=aad)
    assert pt == payload
aead_ms = (time.perf_counter() - t0) * 1000
aead_rate = aead_rounds / (aead_ms / 1000)
print(f"  - ChaCha20-Poly1305:    {aead_ms:7.2f} ms ({aead_rate:8.1f} frames/sec, {aead_ms/aead_rounds:.5f} ms/frame)\n")


# -------------------------------------------------------------
# 3. Command AST Firewall: Uncached vs 2048-Entry LRU Cache (5,000 checks)
# -------------------------------------------------------------
ast_rounds = 5000
print(f"[Benchmark 3] Command AST Firewall ({ast_rounds:,} command inspections)...")
cmds = [
    "echo hello world",
    "Get-Process | Select-Object -First 10",
    "dir C:\\Windows",
    "ipconfig /all",
    "del /f /q C:\\Windows\\System32\\hal.dll",
    "format C: /fs:NTFS /y",
    'r^m -r"f" /',
    "p`o`w`e`r`s`h`e`l`l -enc JABzAD0A",
    "systeminfo",
    "netstat -ano"
]

# Uncached baseline
t0 = time.perf_counter()
for i in range(ast_rounds):
    cmd = cmds[i % len(cmds)]
    CommandASTFirewall._inspect_and_sanitize_uncached(cmd)
uncached_ast_ms = (time.perf_counter() - t0) * 1000
uncached_ast_rate = ast_rounds / (uncached_ast_ms / 1000)

# Cached (with LRU)
t0 = time.perf_counter()
for i in range(ast_rounds):
    cmd = cmds[i % len(cmds)]
    CommandASTFirewall.inspect_and_sanitize(cmd)
cached_ast_ms = (time.perf_counter() - t0) * 1000
cached_ast_rate = ast_rounds / (cached_ast_ms / 1000)
ast_speedup = uncached_ast_ms / cached_ast_ms

print(f"  - Uncached AST Checks:  {uncached_ast_ms:7.2f} ms ({uncached_ast_rate:8.1f} checks/sec, {uncached_ast_ms/ast_rounds:.4f} ms/op)")
print(f"  - LRU-Cached AST:       {cached_ast_ms:7.2f} ms ({cached_ast_rate:8.1f} checks/sec, {cached_ast_ms/ast_rounds:.4f} ms/op)")
print(f"  >>> Speedup: {ast_speedup:.1f}x FASTER (AST Inspection Overhead reduced by {((uncached_ast_ms - cached_ast_ms)/uncached_ast_ms)*100:.1f}%)\n")


# -------------------------------------------------------------
# 4. Screen Spatial Delta Pipeline: Full CRC32 Grid vs Static Short-Circuit (500 frames)
# -------------------------------------------------------------
delta_rounds = 500
print(f"[Benchmark 4] Screen Spatial Delta Pipeline ({delta_rounds} frames @ 1080p 8.3MB)...")
raw_sample = bytearray(1920 * 1080 * 4) # 8.3 MB frame
w_shot, h_shot = 1920, 1080
grid_rows, grid_cols = 8, 8
block_h, block_w = h_shot // grid_rows, w_shot // grid_cols
raw_mv = memoryview(raw_sample)

# Full 64-block CRC32 recalculation baseline
t0 = time.perf_counter()
for _ in range(delta_rounds):
    current_hash = zlib.adler32(bytes(raw_mv[::2048]))
    new_grid = []
    for r in range(grid_rows):
        for c in range(grid_cols):
            sample_offset = (r * block_h * w_shot + c * block_w) * 4
            sample_slice = raw_mv[sample_offset:sample_offset + (block_w * 4)]
            new_grid.append(zlib.crc32(sample_slice))
full_delta_ms = (time.perf_counter() - t0) * 1000
full_delta_rate = delta_rounds / (full_delta_ms / 1000)

# Optimized static frame short-circuit (Desktop idle pipeline)
last_hash = zlib.adler32(bytes(raw_mv[::2048]))
consecutive_static = 5
t0 = time.perf_counter()
for _ in range(delta_rounds):
    current_hash = zlib.adler32(bytes(raw_mv[::2048]))
    is_static = (current_hash == last_hash)
    if is_static and consecutive_static > 3:
        pass # Short-circuit frame
    else:
        new_grid = []
        for r in range(grid_rows):
            for c in range(grid_cols):
                sample_offset = (r * block_h * w_shot + c * block_w) * 4
                sample_slice = raw_mv[sample_offset:sample_offset + (block_w * 4)]
                new_grid.append(zlib.crc32(sample_slice))
opt_delta_ms = (time.perf_counter() - t0) * 1000
opt_delta_rate = delta_rounds / (opt_delta_ms / 1000)
delta_speedup = full_delta_ms / opt_delta_ms

print(f"  - Full 64-Block CRC32:  {full_delta_ms:7.2f} ms ({full_delta_rate:8.1f} frames/sec, {full_delta_ms/delta_rounds:.4f} ms/frame)")
print(f"  - Static Short-Circuit: {opt_delta_ms:7.2f} ms ({opt_delta_rate:8.1f} frames/sec, {opt_delta_ms/delta_rounds:.4f} ms/frame)")
print(f"  >>> Speedup: {delta_speedup:.1f}x FASTER (Frame Delta Evaluation Overhead reduced by {((full_delta_ms - opt_delta_ms)/full_delta_ms)*100:.1f}%)\n")


# -------------------------------------------------------------
# Summary Comparison Table
# -------------------------------------------------------------
print("=========================================================================")
print("  QUANTITATIVE PERFORMANCE SUMMARY (HOST AGENT RUNTIME)")
print("=========================================================================")
print(f"  {'Subsystem / Operation':<32} | {'Before':<10} | {'After':<10} | {'Improvement':<12}")
print("  " + "-"*32 + "-+-" + "-"*10 + "-+-" + "-"*10 + "-+-" + "-"*12)
print(f"  {'X25519 ECDH (300 exchanges)':<32} | {pure_ecdh_ms:7.1f} ms | {fast_ecdh_ms:7.1f} ms | {ecdh_speedup:4.1f}x faster")
print(f"  {'AST Firewall (5,000 checks)':<32} | {uncached_ast_ms:7.1f} ms | {cached_ast_ms:7.1f} ms | {ast_speedup:4.1f}x faster")
print(f"  {'Screen Delta Hash (500 frames)':<32} | {full_delta_ms:7.1f} ms | {opt_delta_ms:7.1f} ms | {delta_speedup:4.1f}x faster")
print(f"  {'ChaCha20-Poly1305 (10,000 pkts)':<32} | {'--':>7}    | {aead_ms:7.1f} ms | {aead_rate:7.0f} pkt/s")
print("=========================================================================\n")
