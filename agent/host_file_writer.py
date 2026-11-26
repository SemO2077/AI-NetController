"""
AI NetController Host Agent
Host File Writer Service (Opcode 0x0C - OP_FILE_TRANSFER)
================================================================================
Handles streaming, chunked, and encrypted binary file transfers from mobile
clients to the Host PC. Features:
  - Zero-Trust Path Traversal Defense (chroot validation against Downloads folder)
  - 64KB Chunked Binary Streaming with rolling SHA-256 integrity verification
  - Low-Memory Streaming Architecture (<2MB RAM utilization during 500MB+ transfers)
  - Structured Binary Acknowledgment protocol
================================================================================
"""

import asyncio
import bisect
import hashlib
import logging
import os
import re
import secrets
import shutil
import stat
import struct
import threading
import time
from pathlib import Path
from typing import Dict, Optional, Union

logger = logging.getLogger("HostFileWriter")

# Protocol Constants
OP_FILE_TRANSFER = 0x0C
MAGIC = b'\xC5\x71'
HEADER_STRUCT = struct.Struct('!2sBBII')
HEADER_SIZE = HEADER_STRUCT.size
_TRANSFER_ID_STRUCT = struct.Struct('!I')
_U64_STRUCT = struct.Struct('!Q')
_ACK_PAYLOAD_STRUCT = struct.Struct('!IBQ')
_MAX_WRITTEN_INTERVALS = 8192

# Transfer Sub-Commands (first byte of Opcode 0x0C payload)
CMD_INIT = 0x01      # Initiate transfer with metadata (filename, size, checksum)
CMD_CHUNK = 0x02     # 64KB data chunk
CMD_FINISH = 0x03    # Finalize and verify SHA-256
CMD_ABORT = 0x04     # Cancel transfer and purge temp file

# Transfer Status Codes
STATUS_OK = 0x00
STATUS_PROGRESS = 0x01
STATUS_COMPLETED = 0x02
STATUS_ERR_TRAVERSAL = 0x10
STATUS_ERR_SIZE_LIMIT = 0x11
STATUS_ERR_CHECKSUM = 0x12
STATUS_ERR_IO = 0x13

MAX_FILE_SIZE = 500 * 1024 * 1024  # 500 MB hard limit
MAX_CONCURRENT_TRANSFERS = 8
MIN_DISK_RESERVE_BYTES = 50 * 1024 * 1024  # Reserve 50 MB free disk buffer
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_DANGEROUS_EXECUTABLES = {
    ".exe", ".bat", ".cmd", ".ps1", ".psm1", ".psd1", ".vbs", ".vbe",
    ".js", ".jse", ".wsf", ".wsh", ".msi", ".msp", ".scr", ".pif",
    ".com", ".hta", ".cpl", ".dll", ".sys", ".lnk", ".scf", ".url", ".reg",
    ".py", ".pyw", ".sh", ".chm", ".iso", ".img", ".vhd", ".vhdx", ".inf",
    ".appx", ".msix",
}


def _is_symlink_or_reparse(path: Path) -> bool:
    """Checks for POSIX symlinks and Windows NTFS junctions / reparse points (including broken links)."""
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return False
    except OSError:
        return True
    if stat.S_ISLNK(st.st_mode):
        return True
    reparse_attr = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    if reparse_attr and (getattr(st, "st_file_attributes", 0) & reparse_attr):
        return True
    return False


_RENAME_LOCK = threading.Lock()


class ActiveTransfer:
    """Tracks state and open file descriptor for an active file upload."""
    def __init__(self, transfer_id: int, filename: str, total_size: int, expected_sha256: str, target_path: Path):
        self.transfer_id = transfer_id
        self.filename = filename
        self.total_size = total_size
        self.expected_sha256 = expected_sha256.lower()
        self.target_path = target_path
        unique_suffix = secrets.token_hex(4)
        self.temp_path = target_path.with_name(f".{target_path.name}.{transfer_id}.{unique_suffix}.cst_part")
        self.bytes_written = 0
        self.max_offset_written = 0
        self.file_handle = None
        self.last_activity = time.monotonic()
        self._written_intervals: list = []
        self._aborted = threading.Event()
        self.last_error_message: str = ""

    def open(self, truncate: bool = False):
        # Ensure parent directory exists and neither target nor temp path is a symlink/junction
        self.temp_path.parent.mkdir(parents=True, exist_ok=True)
        if _is_symlink_or_reparse(self.temp_path.parent) or _is_symlink_or_reparse(self.temp_path):
            raise ValueError("Unsafe symlink or reparse point detected for transfer temp path")
        # Match POSIX access mode to fdopen mode (O_WRONLY for "wb", O_RDWR for "r+b")
        access_flag = os.O_WRONLY if truncate else os.O_RDWR
        flags = access_flag | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
        if truncate:
            flags |= os.O_TRUNC
        fd = os.open(str(self.temp_path), flags, 0o600)
        try:
            self.file_handle = os.fdopen(fd, "wb" if truncate else "r+b")
        except Exception:
            os.close(fd)
            raise

    def _record_written_range(self, start: int, end: int) -> None:
        if end <= start:
            return
        intervals = self._written_intervals
        # O(1) fast path for sequential / adjacent / overlapping trailing writes
        if not intervals:
            intervals.append((start, end))
            self.bytes_written = end - start
            return
        last_s, last_e = intervals[-1]
        if start >= last_s:
            if start <= last_e:
                if end > last_e:
                    intervals[-1] = (last_s, end)
                    self.bytes_written += end - last_e
                return
            if len(intervals) >= _MAX_WRITTEN_INTERVALS:
                raise ValueError("Excessive fragmented chunk ranges in file transfer")
            intervals.append((start, end))
            self.bytes_written += end - start
            return

        # Out-of-order insertion with bisect + local merge
        idx = bisect.bisect_left(intervals, (start, end))
        if len(intervals) >= _MAX_WRITTEN_INTERVALS:
            raise ValueError("Excessive fragmented chunk ranges in file transfer")
        intervals.insert(idx, (start, end))
        merged = [intervals[0]]
        for cur_s, cur_e in intervals[1:]:
            prev_s, prev_e = merged[-1]
            if cur_s <= prev_e:
                merged[-1] = (prev_s, max(prev_e, cur_e))
            else:
                merged.append((cur_s, cur_e))
        self._written_intervals = merged
        self.bytes_written = sum(e - s for s, e in merged)

    def write_chunk(self, offset: int, data: bytes):
        if offset < 0 or offset + len(data) > self.total_size or offset + len(data) > MAX_FILE_SIZE:
            raise ValueError(
                f"Chunk offset {offset} + len {len(data)} exceeds declared bounds ({self.total_size} / {MAX_FILE_SIZE})"
            )
        if not self.file_handle:
            self.open()
        self.file_handle.seek(offset)
        self.file_handle.write(data)
        self.last_activity = time.monotonic()
        self._record_written_range(offset, offset + len(data))
        if offset + len(data) > self.max_offset_written:
            self.max_offset_written = offset + len(data)

    def close(self):
        if self.file_handle and not self.file_handle.closed:
            try:
                self.file_handle.flush()
            except Exception:
                pass
            self.file_handle.close()
        self.file_handle = None

    def _unlink_temp_safely(self) -> None:
        if self.temp_path.exists() and not _is_symlink_or_reparse(self.temp_path):
            try:
                self.temp_path.unlink()
            except OSError:
                pass

    def finalize(self) -> bool:
        self.close()
        self.last_error_message = ""
        if self._aborted.is_set():
            self.last_error_message = "Transfer aborted"
            self._unlink_temp_safely()
            return False
        if _is_symlink_or_reparse(self.temp_path):
            self.last_error_message = "Unsafe symlink or reparse point detected"
            logger.error("Aborted finalize: temp file became symlink/reparse point: %s", self.temp_path)
            return False

        # Verify file size and SHA-256 over sequential bytes written to disk
        hasher = hashlib.sha256()
        try:
            actual_size = self.temp_path.stat().st_size
            if actual_size != self.total_size:
                self.last_error_message = f"Incomplete transfer: expected {self.total_size} bytes, got {actual_size}"
                logger.error("Size mismatch for %s: expected %d bytes, got %d", self.filename, self.total_size, actual_size)
                self._unlink_temp_safely()
                return False
            with open(self.temp_path, "rb") as f:
                while chunk := f.read(65536):
                    if self._aborted.is_set():
                        self.last_error_message = "Transfer aborted"
                        break
                    hasher.update(chunk)
            if self._aborted.is_set():
                self._unlink_temp_safely()
                return False
            calculated_sha = hasher.hexdigest().lower()
        except Exception as e:
            self.last_error_message = f"Checksum I/O error: {e}"
            logger.error("Failed to calculate checksum for %s: %s", self.filename, e)
            self._unlink_temp_safely()
            return False

        if calculated_sha != self.expected_sha256:
            self.last_error_message = "SHA-256 mismatch"
            logger.error(
                "Checksum mismatch for %s! Expected %s, got %s",
                self.filename,
                self.expected_sha256,
                calculated_sha,
            )
            self._unlink_temp_safely()
            return False

        # Atomic rename part file to final filename (serialized to prevent concurrent collision races)
        try:
            with _RENAME_LOCK:
                if self._aborted.is_set():
                    self.last_error_message = "Transfer aborted"
                    self._unlink_temp_safely()
                    return False
                if self.target_path.exists() or _is_symlink_or_reparse(self.target_path):
                    stem = self.target_path.stem
                    ext = self.target_path.suffix
                    counter = 1
                    while self.target_path.exists() or _is_symlink_or_reparse(self.target_path):
                        self.target_path = self.target_path.with_name(f"{stem} ({counter}){ext}")
                        counter += 1
                self.temp_path.replace(self.target_path)
        except OSError as exc:
            self.last_error_message = f"Failed to save finalized file: {exc}"
            logger.error("Failed to finalize atomic rename for %s: %s", self.filename, exc)
            self._unlink_temp_safely()
            return False
        try:
            try:
                from windows_integration import apply_mark_of_the_web
            except ImportError:
                from agent.windows_integration import apply_mark_of_the_web
            apply_mark_of_the_web(str(self.target_path), zone_id=3)
        except Exception:
            pass
        logger.info("File successfully received and verified: %s (%d bytes)", self.target_path, self.bytes_written)
        return True

    def abort(self):
        self._aborted.set()
        self.close()
        self._unlink_temp_safely()


class HostFileWriter:
    """Zero-Trust Host File Transfer Receiver."""
    def __init__(self, download_dir: Optional[Union[Path, str]] = None, allow_executables: bool = False):
        if download_dir:
            self.download_dir = Path(download_dir).resolve()
        else:
            user_home = Path.home()
            self.download_dir = (user_home / "Downloads").resolve()

        self.allow_executables = allow_executables
        self.download_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.active_transfers: Dict[int, ActiveTransfer] = {}
        self._finalizing_transfers: set = set()
        logger.info("HostFileWriter initialized. Target chroot directory: %s", self.download_dir)

    _WINDOWS_RESERVED_NAMES = {
        "CON", "CONIN$", "CONOUT$", "PRN", "AUX", "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }

    def _sanitize_filename(self, filename: str) -> str:
        """Strip directory paths, enforce 255-byte limit, and block path traversal."""
        normalized = filename.replace("\\", "/")
        clean_name = os.path.basename(normalized)
        clean_name = re.sub(r'[\x00-\x1f\x7f]', '', clean_name)
        clean_name = re.sub(r'[<>:"/\\|?*]', '_', clean_name).strip(" .")
        # Cap sanitized filename to 255 UTF-8 bytes while preserving extension
        raw_utf8 = clean_name.encode("utf-8")
        if len(raw_utf8) > 255:
            stem, ext = os.path.splitext(clean_name)
            ext_bytes = ext.encode("utf-8")[:64]
            budget = max(1, 255 - len(ext_bytes))
            stem_trunc = stem.encode("utf-8")[:budget].decode("utf-8", errors="ignore").rstrip(" .")
            clean_name = f"{stem_trunc}{ext_bytes.decode('utf-8', errors='ignore')}"
        stem_upper = clean_name.split(".")[0].upper() if clean_name else ""
        if not clean_name or clean_name in {".", ".."} or stem_upper in self._WINDOWS_RESERVED_NAMES:
            clean_name = f"cst_received_{time.time_ns()}.bin"
        return clean_name

    def _verify_path_contained(self, target_path: Path) -> bool:
        """Verifies target_path is non-symlink/reparse and strictly contained inside download_dir."""
        try:
            if _is_symlink_or_reparse(self.download_dir) or _is_symlink_or_reparse(target_path):
                return False
            target_resolved = target_path.resolve()
            return self.download_dir in target_resolved.parents or target_resolved == self.download_dir
        except Exception:
            return False

    def _prepare_transfer(self, transfer_id: int, payload: bytes) -> bytes:
        if len(payload) < 1 + 4 + 8 + 64:
            return self._build_ack(transfer_id, STATUS_ERR_IO, 0, "INIT payload too small")

        total_size = _U64_STRUCT.unpack_from(payload, 5)[0]
        sha256_hex = payload[13:77].decode('ascii', errors='ignore').strip()
        raw_filename = payload[77:].decode('utf-8', errors='replace')

        if not _SHA256_RE.match(sha256_hex):
            return self._build_ack(transfer_id, STATUS_ERR_CHECKSUM, 0, "Invalid SHA-256 digest header")

        if total_size > MAX_FILE_SIZE or total_size < 0:
            logger.warning("Rejected transfer %s: size %d exceeds %d limit", transfer_id, total_size, MAX_FILE_SIZE)
            return self._build_ack(transfer_id, STATUS_ERR_SIZE_LIMIT, 0, "Exceeds 500MB maximum file limit")

        clean_name = self._sanitize_filename(raw_filename)
        ext = Path(clean_name).suffix.lower()
        if not self.allow_executables and ext in _DANGEROUS_EXECUTABLES:
            logger.warning("Blocked executable file transfer %s (%s)", transfer_id, clean_name)
            return self._build_ack(
                transfer_id,
                STATUS_ERR_TRAVERSAL,
                0,
                f"Blocked executable extension '{ext}' by security policy",
            )

        target_path = self.download_dir / clean_name
        if not self._verify_path_contained(target_path):
            logger.error("Path traversal blocked for transfer %s: %s -> %s", transfer_id, raw_filename, target_path)
            return self._build_ack(transfer_id, STATUS_ERR_TRAVERSAL, 0, "Access denied: path traversal attempt")

        with self._lock:
            existing = self.active_transfers.pop(transfer_id, None)
            if existing is not None:
                existing.abort()

            self.prune_stale_transfers(max_idle_sec=300.0)
            if len(self.active_transfers) >= MAX_CONCURRENT_TRANSFERS:
                return self._build_ack(transfer_id, STATUS_ERR_SIZE_LIMIT, 0, "Maximum concurrent transfers exceeded")

            reserved_bytes = sum(
                max(0, t.total_size - t.bytes_written) for t in self.active_transfers.values()
            )
            try:
                free_bytes = shutil.disk_usage(self.download_dir).free
                if total_size + reserved_bytes + MIN_DISK_RESERVE_BYTES > free_bytes:
                    return self._build_ack(transfer_id, STATUS_ERR_SIZE_LIMIT, 0, "Insufficient free disk space on host")
            except Exception:
                pass

            transfer: Optional[ActiveTransfer] = None
            try:
                transfer = ActiveTransfer(transfer_id, clean_name, total_size, sha256_hex, target_path)
                if not self._verify_path_contained(transfer.temp_path):
                    return self._build_ack(transfer_id, STATUS_ERR_TRAVERSAL, 0, "Access denied: unsafe temp path")
                transfer.open(truncate=True)
                transfer.close()
                self.active_transfers[transfer_id] = transfer
                logger.info("Transfer initiated: ID %s, File: '%s', Size: %d bytes", transfer_id, clean_name, total_size)
                return self._build_ack(transfer_id, STATUS_OK, 0, "Ready for chunks")
            except Exception as e:
                if transfer is not None:
                    transfer.abort()
                logger.error("Failed to initialize transfer %s: %s", transfer_id, e)
                return self._build_ack(transfer_id, STATUS_ERR_IO, 0, str(e))

    def handle_packet(self, payload: bytes) -> bytes:
        """
        Processes Opcode 0x0C payload synchronously and returns structured binary ACK packet.
        """
        if len(payload) < 5:
            return self._build_ack(0, STATUS_ERR_IO, 0, "Packet truncated")

        sub_cmd = payload[0]
        transfer_id = _TRANSFER_ID_STRUCT.unpack_from(payload, 1)[0]

        if sub_cmd == CMD_INIT:
            return self._prepare_transfer(transfer_id, payload)

        elif sub_cmd == CMD_CHUNK:
            with self._lock:
                transfer = self.active_transfers.get(transfer_id)
                if not transfer:
                    return self._build_ack(transfer_id, STATUS_ERR_IO, 0, "Unknown transfer ID")

                if len(payload) < 1 + 4 + 8:
                    return self._build_ack(transfer_id, STATUS_ERR_IO, transfer.bytes_written, "Chunk header truncated")

                offset = _U64_STRUCT.unpack_from(payload, 5)[0]
                chunk_data = payload[13:]

                try:
                    transfer.write_chunk(offset, chunk_data)
                    return self._build_ack(transfer_id, STATUS_PROGRESS, transfer.bytes_written, "Chunk accepted")
                except Exception as e:
                    transfer.close()
                    logger.error("IO error writing chunk for transfer %s: %s", transfer_id, e)
                    return self._build_ack(transfer_id, STATUS_ERR_IO, transfer.bytes_written, str(e))

        elif sub_cmd == CMD_FINISH:
            with self._lock:
                transfer = self.active_transfers.pop(transfer_id, None)
                if not transfer:
                    return self._build_ack(transfer_id, STATUS_ERR_IO, 0, "Unknown transfer ID")
                self._finalizing_transfers.add(transfer)

            try:
                success = transfer.finalize()
            finally:
                with self._lock:
                    self._finalizing_transfers.discard(transfer)
            if success:
                return self._build_ack(transfer_id, STATUS_COMPLETED, transfer.bytes_written, "File verified and saved")
            err_msg = transfer.last_error_message or "SHA-256 mismatch"
            return self._build_ack(transfer_id, STATUS_ERR_CHECKSUM, transfer.bytes_written, err_msg)

        elif sub_cmd == CMD_ABORT:
            with self._lock:
                transfer = self.active_transfers.pop(transfer_id, None)
            if transfer:
                transfer.abort()
            return self._build_ack(transfer_id, STATUS_OK, 0, "Transfer aborted")

        return self._build_ack(transfer_id, STATUS_ERR_IO, 0, "Unknown sub-command")

    async def handle_packet_async(self, payload: bytes) -> bytes:
        """
        Async-safe wrapper that offloads large-file SHA-256 finalization off the event loop.
        """
        if len(payload) >= 5 and payload[0] == CMD_FINISH:
            transfer_id = _TRANSFER_ID_STRUCT.unpack_from(payload, 1)[0]
            with self._lock:
                transfer = self.active_transfers.pop(transfer_id, None)
                if not transfer:
                    return self._build_ack(transfer_id, STATUS_ERR_IO, 0, "Unknown transfer ID")
                self._finalizing_transfers.add(transfer)
            try:
                success = await asyncio.to_thread(transfer.finalize)
            finally:
                with self._lock:
                    self._finalizing_transfers.discard(transfer)
            if success:
                return self._build_ack(transfer_id, STATUS_COMPLETED, transfer.bytes_written, "File verified and saved")
            err_msg = transfer.last_error_message or "SHA-256 mismatch"
            return self._build_ack(transfer_id, STATUS_ERR_CHECKSUM, transfer.bytes_written, err_msg)
        return self.handle_packet(payload)

    def abort_all(self) -> int:
        """Aborts and deletes temp files for all active and finalizing transfers (e.g., on disconnect)."""
        count = 0
        with self._lock:
            active_list = list(self.active_transfers.values())
            self.active_transfers.clear()
            finalizing_list = list(self._finalizing_transfers)
        for transfer in active_list:
            transfer.abort()
            count += 1
        for transfer in finalizing_list:
            transfer._aborted.set()
            count += 1
        return count

    def prune_stale_transfers(self, max_idle_sec: float = 3600.0) -> int:
        """Aborts transfers that have been idle longer than max_idle_sec."""
        now = time.monotonic()
        stale_transfers = []
        with self._lock:
            stale_ids = [
                tid for tid, t in self.active_transfers.items()
                if (now - t.last_activity) > max_idle_sec
            ]
            for tid in stale_ids:
                transfer = self.active_transfers.pop(tid, None)
                if transfer:
                    stale_transfers.append(transfer)
        for transfer in stale_transfers:
            transfer.abort()
        return len(stale_transfers)

    def get_active_transfers_summary(self) -> Dict[str, int]:
        """Returns a lightweight zero-secret summary of active and finalizing uploads."""
        with self._lock:
            active_vals = list(self.active_transfers.values())
            finalizing_count = len(self._finalizing_transfers)
        return {
            "active_count": len(active_vals),
            "finalizing_count": finalizing_count,
            "bytes_written": sum(t.bytes_written for t in active_vals),
            "bytes_expected": sum(t.total_size for t in active_vals),
        }

    def _build_ack(self, transfer_id: int, status: int, bytes_written: int, message: str, seq: int = 0) -> bytes:
        """
        Constructs an Opcode 0x0C ACK packet.
        Format: [2 magic][1 opcode][1 flags][4 seq][4 len] + [4 id][1 status][8 bytes_written][msg_utf8]
        """
        msg_bytes = message.encode('utf-8')
        ack_payload = _ACK_PAYLOAD_STRUCT.pack(transfer_id, status, bytes_written) + msg_bytes
        length = len(ack_payload)

        header = HEADER_STRUCT.pack(MAGIC, OP_FILE_TRANSFER, 0, seq, length)
        return header + ack_payload
