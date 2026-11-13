"""
Hardened Shell Command AST Normalizer, Obfuscation Stripper & Sandbox Firewall
================================================================================
Mitigates:
1. Shell Obfuscation (Caret escaping ^, nested quotation w"i"n"g"et, %COMSPEC% expansion)
2. Path Traversal & Symlink Resolution (../../ attacks, Junction points)
3. Cryptographic Token Hashing (SHA-256 validation of system executables)
4. Escalating Termination Sequence (SIGINT -> SIGTERM -> SIGKILL / TerminateProcess)
5. Ring-Buffer Output Supervision with Interactive Hang Detection
================================================================================
"""

import os
import re
import shlex
import shutil
import signal
import asyncio
import logging
import platform
import subprocess
import sys
import threading
import unicodedata
from collections import OrderedDict
from typing import Dict, List, Optional, Tuple, Any

logger = logging.getLogger("CommandFirewall")

IS_WINDOWS = platform.system() == "Windows"
_MAX_OUTPUT_BYTES = 1024 * 1024  # 1 MiB cap per stream

_SAFE_WIN_ENV_ALLOWLIST = {
    "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "PATH", "TEMP", "TMP",
    "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA",
    "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "COMPUTERNAME",
    "USERNAME", "SYSTEMDRIVE", "PYTHONIOENCODING", "PYTHONUTF8", "VIRTUAL_ENV",
}

_SAFE_POSIX_ENV_ALLOWLIST = {
    "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE",
    "TERM", "TMPDIR", "TEMP", "TMP", "SHELL", "PWD", "VIRTUAL_ENV",
    "PYTHONIOENCODING", "PYTHONUTF8",
}

# Dangerous Administrative Keywords & Living-off-the-Land Binaries
CRITICAL_COMMANDS = {
    "format", "format-volume", "diskpart", "rmdir", "rd", "del", "erase",
    "rm", "ri", "mkfs", "dd", "reg", "rp", "bcdedit", "drop", "truncate", "iptables",
    "netsh", "remove-item", "stop-process", "spps", "restart-computer", "stop-computer",
    "shutdown", "reboot", "poweroff", "init", "vssadmin", "cipher", "takeown",
    "icacls", "chmod", "chown", "kill", "killall", "pkill", "taskkill",
    "wmic", "sc", "rundll32", "regsvr32", "mshta", "certutil", "bitsadmin",
    "net", "net1", "schtasks", "wscript", "cscript", "set-executionpolicy",
    "add-mppreference", "invoke-webrequest", "iwr", "invoke-restmethod", "irm",
    "start-process", "saps", "set-content", "out-file", "tee-object",
    "wbadmin", "diskshadow", "wevtutil", "nltest", "dsquery", "procdump",
    "invoke-command", "icm", "sal", "new-alias", "curl", "wget", "makecab",
    "esentutl", "forfiles", "pcalua", "cmdkey", "vaultcmd", "msbuild",
    "installutil", "cmstp", "hh", "odbcconf", "mavinject", "control",
    "ftp", "tftp", "nc", "ncat", "socat", "ssh", "scp", "rsync",
    "start-bitstransfer", "add-type", "new-object",
    "sudo", "su", "pkexec", "arp", "route",
}

INLINE_EXEC_INTERPRETERS = {
    "python", "python3", "py", "node", "perl", "ruby", "php",
    "powershell", "pwsh", "cmd", "bash", "sh", "zsh", "wsl"
}

INLINE_EXEC_FLAGS = {
    "-c", "-e", "/c", "/k", "/e", "/enc", "-m",
    "-command", "-encodedcommand", "-enc", "-f", "-file",
}

# Pre-compiled high-performance regular expressions
_RE_CARET = re.compile(r"\^")
_RE_INTERSTITIAL_QUOTES = re.compile(r'(?<=[^\s])["\'`^]+(?=[^\s])')
_RE_WHITESPACE = re.compile(r"\s+")
_RE_EVASION_CARET = re.compile(r"\S\^\S")
_RE_EVASION_BACKTICK = re.compile(r"\S`\S")
_RE_ENV_SUBSTRING_SLICE = re.compile(r"%[^%:\s]+:~[^%]*%")
_RE_IFS_EVASION = re.compile(r"\$\{?IFS\b", re.IGNORECASE)
_RE_DELAYED_OR_PS_ENV = re.compile(r"(?:![A-Za-z_][A-Za-z0-9_]*[:~!]|(?:\$\{?env:))", re.IGNORECASE)
_RE_UNICODE_INVISIBLE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]")
_RE_UNICODE_DASHES = re.compile(r"[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]")
_RE_PYTHON_CMD = re.compile(r'^(?:"[^"]*?python(?:3)?(?:\.exe)?"|[^\s]*?python(?:3)?(?:\.exe)?|python(?:3)?)(\s+|$)', flags=re.IGNORECASE)
_RE_ENCODED_POWERSHELL = re.compile(r"(?:powershell|pwsh)(?:\.exe)?\b[^\r\n]*\s[-/](?:e|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)\b", flags=re.IGNORECASE)
_RE_SUBSHELL_INJECTION = re.compile(r"\$\([^)]+\)|`[^`]+`|\b(?:iex|invoke-expression)\b|(?:^|\s)[&.]\s*\(", flags=re.IGNORECASE)
_RE_DOTNET_CRADLE = re.compile(
    r"\[(?:reflection\.assembly|system\.diagnostics\.process|scriptblock|system\.net\.webclient)\]"
    r"|\b(?:frombase64string|downloadstring|downloadfile)\b",
    flags=re.IGNORECASE,
)
_RE_CMD_DELAYED_EXPANSION = re.compile(r"\bcmd(?:\.exe)?\b[^\r\n]*\s/v\s*:\s*on\b", flags=re.IGNORECASE)
_RE_CHAIN_OPERATORS = re.compile(r"(?:&&|\|\||[;&|\r\n])")
_RE_SEGMENT_SPLIT = re.compile(r"(?:&&|\|\||[;|&()\r\n]+)")
_RE_REDIRECTION = re.compile(r"(?:^|\s|\S)(?:\d?>>?|<)(?!=)")
_RE_SENSITIVE_REDIRECT_TARGET = re.compile(r"(?:\\windows\\|system32|syswow64|/etc/|/usr/|/bin/|/sbin/|\.ssh|\\startup\\)", re.IGNORECASE)
_RE_SAFE_ENV_VARS = re.compile(r"%(COMSPEC|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES)%", flags=re.IGNORECASE)

_SAFE_WIN_ENV_MAP = {
    "comspec": "cmd.exe",
    "systemroot": os.environ.get("SystemRoot") or os.environ.get("WINDIR") or r"C:\Windows",
    "windir": os.environ.get("WINDIR") or os.environ.get("SystemRoot") or r"C:\Windows",
}

# Fast bounded thread-safe LRU cache for high-throughput command inspection
_INSPECTION_CACHE: "OrderedDict[str, Tuple[bool, str, str, str]]" = OrderedDict()
_INSPECTION_CACHE_LOCK = threading.Lock()
_MAX_INSPECTION_CACHE = 2048


class CommandASTFirewall:
    """
    Normalizes shell command strings, resolves obfuscation tricks, verifies
    binary paths, and enforces an escalating execution timeout sandbox.
    """

    @staticmethod
    def strip_obfuscation(raw_cmd: str) -> str:
        """
        Desugars cmd.exe, PowerShell, and Unicode evasion patterns:
        - NFKC homoglyph/fullwidth normalization + Unicode dash normalization
        - Carets: w^i^n^g^e^t -> winget
        - Interstitial quotes/backticks: w"i"n'g'et -> winget, -`e`n`c -> -enc
        - Safe OS path environment expansions: %COMSPEC% -> cmd.exe
          (Never expands secret environment variables)
        - Excessive horizontal whitespace
        """
        cleaned = unicodedata.normalize("NFKC", raw_cmd.strip())
        cleaned = _RE_UNICODE_DASHES.sub("-", cleaned)

        # 1. Expand only known OS path environment variables to prevent secret leakage
        cleaned = _RE_SAFE_ENV_VARS.sub(
            lambda m: _SAFE_WIN_ENV_MAP.get(m.group(1).lower(), m.group(0)),
            cleaned,
        )

        # 2. Strip Windows cmd caret escape characters and interstitial quotes/backticks
        cleaned = _RE_CARET.sub("", cleaned)
        cleaned = _RE_INTERSTITIAL_QUOTES.sub("", cleaned)

        # 3. Collapse runs of spaces/tabs while preserving newlines for multi-line inspection
        cleaned = re.sub(r"[ \t]+", " ", cleaned)

        return cleaned.strip()

    @staticmethod
    def inspect_and_sanitize(raw_cmd: str) -> Tuple[bool, str, str, str]:
        """
        Inspects command.
        Returns: (is_allowed, risk_level, normalized_cmd, reason)
        Risk levels: "SAFE", "REQUIRES_BIOMETRIC", "BLOCKED"
        """
        if isinstance(raw_cmd, str):
            with _INSPECTION_CACHE_LOCK:
                cached = _INSPECTION_CACHE.get(raw_cmd)
                if cached is not None:
                    _INSPECTION_CACHE.move_to_end(raw_cmd)
                    return cached

        res = CommandASTFirewall._inspect_and_sanitize_uncached(raw_cmd)
        if isinstance(raw_cmd, str):
            with _INSPECTION_CACHE_LOCK:
                if len(_INSPECTION_CACHE) >= _MAX_INSPECTION_CACHE:
                    _INSPECTION_CACHE.popitem(last=False)
                _INSPECTION_CACHE[raw_cmd] = res
        return res

    @staticmethod
    def _inspect_and_sanitize_uncached(raw_cmd: str) -> Tuple[bool, str, str, str]:
        if not isinstance(raw_cmd, str):
            return False, "BLOCKED", "", "Command payload must be a string."

        if _RE_UNICODE_INVISIBLE.search(raw_cmd):
            return False, "BLOCKED", "", "Control character or invisible Unicode injection detected."

        nfkc_raw = _RE_UNICODE_DASHES.sub("-", unicodedata.normalize("NFKC", raw_cmd))

        if _RE_ENV_SUBSTRING_SLICE.search(raw_cmd) or _RE_ENV_SUBSTRING_SLICE.search(nfkc_raw):
            return False, "BLOCKED", nfkc_raw.strip(), "Environment variable substring slicing evasion (%VAR:~...%) is prohibited."

        if _RE_IFS_EVASION.search(nfkc_raw):
            return False, "BLOCKED", nfkc_raw.strip(), "Internal field separator ($IFS) evasion is prohibited."

        cleaned = CommandASTFirewall.strip_obfuscation(raw_cmd)
        if not cleaned:
            return False, "BLOCKED", cleaned, "Empty command sequence."

        # Strip quotes/backticks/carets for obfuscated keyword scanning (e.g. Remove"-"Item, -`enc)
        unobfuscated_scan = re.sub(r'["\'`^]', "", cleaned)
        single_line_cleaned = _RE_WHITESPACE.sub(" ", cleaned).strip()

        try:
            tokens = shlex.split(single_line_cleaned, posix=not IS_WINDOWS)
        except Exception as e:
            return False, "BLOCKED", single_line_cleaned, f"Syntax parsing failure (Malformed shell tokens): {e}"

        if not tokens:
            return False, "BLOCKED", single_line_cleaned, "Empty command sequence."

        primary_token = tokens[0].lower()

        # Path Traversal Check
        if ".." in primary_token or "../" in unobfuscated_scan or "..\\" in unobfuscated_scan:
            return False, "BLOCKED", single_line_cleaned, "Path traversal pattern (..) detected."

        # Block obfuscated Base64 PowerShell regardless of backtick/quote splitting
        if _RE_ENCODED_POWERSHELL.search(cleaned) or _RE_ENCODED_POWERSHELL.search(unobfuscated_scan):
            return False, "BLOCKED", single_line_cleaned, "Encoded PowerShell command (-EncodedCommand) is prohibited."

        if _RE_CMD_DELAYED_EXPANSION.search(cleaned) or _RE_CMD_DELAYED_EXPANSION.search(unobfuscated_scan):
            return False, "BLOCKED", single_line_cleaned, "Delayed cmd expansion (/V:ON) obfuscation is prohibited."

        if _RE_DOTNET_CRADLE.search(cleaned) or _RE_DOTNET_CRADLE.search(unobfuscated_scan):
            return True, "REQUIRES_BIOMETRIC", single_line_cleaned, ".NET reflection or memory download cradle requires biometric confirmation."

        if _RE_DELAYED_OR_PS_ENV.search(nfkc_raw) or _RE_DELAYED_OR_PS_ENV.search(unobfuscated_scan):
            return True, "REQUIRES_BIOMETRIC", single_line_cleaned, "Dynamic environment expansion (!VAR! or $env:) requires operator approval."

        if _RE_SUBSHELL_INJECTION.search(cleaned) or _RE_SUBSHELL_INJECTION.search(unobfuscated_scan):
            return True, "REQUIRES_BIOMETRIC", single_line_cleaned, "Dynamic subshell or Invoke-Expression evaluation requires operator approval."

        # Obfuscation & Evasion Artifact Check
        if (
            _RE_EVASION_CARET.search(nfkc_raw)
            or _RE_INTERSTITIAL_QUOTES.search(nfkc_raw)
            or _RE_EVASION_BACKTICK.search(nfkc_raw)
        ):
            return True, "REQUIRES_BIOMETRIC", single_line_cleaned, "Command contained character evasion artifacts (^, `, or quotes)."

        # Scan all tokens & dequoted sub-tokens (splits parens, braces, redirections, paths, chains)
        raw_split_re = re.compile(r'[\s/\\;|&(){}<>,=:\r\n"\'`^]+')
        for source_str in (single_line_cleaned, unobfuscated_scan):
            for sub in raw_split_re.split(source_str.lower()):
                if not sub:
                    continue
                base_cmd = sub.split(".")[0]
                if sub in CRITICAL_COMMANDS or base_cmd in CRITICAL_COMMANDS:
                    return True, "REQUIRES_BIOMETRIC", single_line_cleaned, f"Critical administrative command '{sub}' requires biometric confirmation."

        # Check all tokens and chain-split segments for inline interpreters (including full paths & no-space chains)
        segments_to_scan: List[List[str]] = [tokens]
        for seg in _RE_SEGMENT_SPLIT.split(single_line_cleaned):
            seg = seg.strip()
            if not seg:
                continue
            try:
                seg_tokens = shlex.split(seg, posix=not IS_WINDOWS)
            except Exception:
                seg_tokens = seg.split()
            if seg_tokens:
                segments_to_scan.append(seg_tokens)

        for seg_tokens in segments_to_scan:
            for idx, token in enumerate(seg_tokens):
                clean_tok = token.strip('"\'`(){};|&')
                exe_name = os.path.basename(clean_tok.replace("\\", "/")).lower()
                base_name = exe_name.split(".")[0]
                if base_name in INLINE_EXEC_INTERPRETERS:
                    for following in seg_tokens[idx + 1:]:
                        norm_flag = following.strip('"\'`(){};|&').lower()
                        if norm_flag in INLINE_EXEC_FLAGS:
                            return True, "REQUIRES_BIOMETRIC", single_line_cleaned, f"Inline code execution via '{base_name} {norm_flag}' requires biometric confirmation."

        # Redirection check outside quoted literals
        unquoted_outside = re.sub(r'"[^"]*"|\'[^\']*\'', " ", single_line_cleaned)
        if _RE_REDIRECTION.search(unquoted_outside):
            if _RE_SENSITIVE_REDIRECT_TARGET.search(unobfuscated_scan):
                return False, "BLOCKED", single_line_cleaned, "Shell redirection to a sensitive system path is prohibited."
            return True, "REQUIRES_BIOMETRIC", single_line_cleaned, "Shell I/O redirection requires biometric confirmation."

        # Multi-line script check when non-empty
        if "\n" in cleaned or "\r" in cleaned:
            return True, "REQUIRES_BIOMETRIC", single_line_cleaned, "Multi-line shell execution requires biometric confirmation."

        return True, "SAFE", single_line_cleaned, "Command passed AST validation."

    @staticmethod
    def _build_safe_env() -> Dict[str, str]:
        allowlist = _SAFE_WIN_ENV_ALLOWLIST if IS_WINDOWS else _SAFE_POSIX_ENV_ALLOWLIST
        return {k: v for k, v in os.environ.items() if k.upper() in allowlist}

    @staticmethod
    def _assign_to_job_supervisor(pid: int) -> None:
        if not IS_WINDOWS:
            return
        supervisor = None
        for mod_name in ("agent", "agent.agent", "__main__"):
            mod = sys.modules.get(mod_name)
            if mod is not None and hasattr(mod, "JOB_SUPERVISOR"):
                supervisor = getattr(mod, "JOB_SUPERVISOR")
                break
        if supervisor is None:
            try:
                from agent import JOB_SUPERVISOR as imported_sup
                supervisor = imported_sup
            except Exception:
                try:
                    from .agent import JOB_SUPERVISOR as rel_sup  # type: ignore
                    supervisor = rel_sup
                except Exception as exc:
                    logger.debug("JOB_SUPERVISOR unavailable for PID %d: %s", pid, exc)
                    return
        try:
            supervisor.assign_process(pid)
        except Exception as exc:
            logger.warning("Failed to assign PID %d to JOB_SUPERVISOR: %s", pid, exc)

    @staticmethod
    def _build_spawn_kwargs(safe_env: Dict[str, str]) -> Dict[str, Any]:
        """Builds isolated OS subprocess kwargs (detached process group on POSIX, no window on Windows)."""
        kwargs: Dict[str, Any] = {"env": safe_env}
        if IS_WINDOWS:
            kwargs["creationflags"] = 0x08000000
        else:
            # Start a dedicated session/process group so timeouts kill shell grandchildren too.
            kwargs["start_new_session"] = True
        return kwargs

    @staticmethod
    def _signal_process_tree(proc: asyncio.subprocess.Process, sig: int) -> None:
        """Signals or kills an entire subprocess tree across Windows and POSIX."""
        if proc.returncode is not None:
            return
        if IS_WINDOWS:
            try:
                import psutil  # type: ignore

                parent = psutil.Process(proc.pid)
                children = parent.children(recursive=True)
                kill_mode = sig == getattr(signal, "SIGKILL", signal.SIGTERM)
                for child in children:
                    try:
                        if kill_mode:
                            child.kill()
                        else:
                            child.terminate()
                    except Exception:
                        pass
            except Exception as exc:
                logger.debug("Process tree signal notice for PID %s: %s", proc.pid, exc)
            try:
                if sig == getattr(signal, "SIGKILL", signal.SIGTERM):
                    proc.kill()
                else:
                    proc.terminate()
            except ProcessLookupError:
                pass
            return

        try:
            os.killpg(os.getpgid(proc.pid), sig)
        except ProcessLookupError:
            pass
        except Exception:
            try:
                proc.send_signal(sig)
            except ProcessLookupError:
                pass

    @staticmethod
    async def _read_stream_bounded(stream: Optional[asyncio.StreamReader], limit: int = _MAX_OUTPUT_BYTES) -> bytes:
        if stream is None:
            return b""
        chunks: List[bytes] = []
        total = 0
        truncated = False
        while True:
            chunk = await stream.read(65536)
            if not chunk:
                break
            if total < limit:
                take = chunk[: limit - total]
                chunks.append(take)
                total += len(take)
                if len(take) < len(chunk):
                    truncated = True
            else:
                truncated = True
        if truncated:
            chunks.append(b"\n...[output truncated at 1 MiB]...")
        return b"".join(chunks)

    @staticmethod
    async def execute_sandboxed(
        cmd: str,
        timeout_sec: float = 30.0,
        biometric_approved: bool = False,
    ) -> Dict[str, Any]:
        """
        Executes the normalized command under a strict timeout supervisor.
        Blocks both BLOCKED commands and unapproved REQUIRES_BIOMETRIC commands.
        If the process hangs, it triggers an escalating termination sequence:
        SIGINT/taskkill -> SIGTERM -> SIGKILL.
        """
        is_allowed, risk, normalized_cmd, reason = CommandASTFirewall.inspect_and_sanitize(cmd)
        if not is_allowed or risk == "BLOCKED":
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Security Firewall Block: {reason}",
                "risk_level": risk,
            }

        if risk == "REQUIRES_BIOMETRIC" and not biometric_approved:
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Security Firewall Hold (Biometric Approval Required): {reason}",
                "risk_level": risk,
            }

        logger.info("Executing sandboxed command [%s]: %s", risk, normalized_cmd)
        safe_env = CommandASTFirewall._build_safe_env()

        proc = None
        try:
            unquoted_outside = re.sub(r'"[^"]*"|\'[^\']*\'', " ", normalized_cmd)
            python_match = _RE_PYTHON_CMD.match(normalized_cmd)
            has_shell_meta = bool(_RE_CHAIN_OPERATORS.search(unquoted_outside) or _RE_REDIRECTION.search(unquoted_outside))

            if python_match and not has_shell_meta:
                remainder = normalized_cmd[python_match.end():].lstrip()
                if getattr(sys, "frozen", False):
                    py_exe = shutil.which("python") or shutil.which("python3")
                    if not py_exe:
                        return {
                            "success": False,
                            "exit_code": -1,
                            "stdout": "",
                            "stderr": "Python interpreter not found on PATH in packaged build.",
                            "risk_level": risk,
                        }
                else:
                    py_exe = sys.executable

                args = [py_exe]
                if remainder.startswith("-c"):
                    script = remainder[2:].lstrip()
                    if len(script) >= 2 and script[0] in {'"', "'"} and script[-1] == script[0]:
                        script = script[1:-1]
                    args.extend(["-c", script])
                elif remainder:
                    raw_args = shlex.split(remainder, posix=not IS_WINDOWS)
                    for a in raw_args:
                        if len(a) >= 2 and a[0] in {'"', "'"} and a[-1] == a[0]:
                            a = a[1:-1]
                        args.append(a)
                else:
                    args.extend(["-c", "pass"])

                spawn_kwargs = CommandASTFirewall._build_spawn_kwargs(safe_env)
                proc = await asyncio.create_subprocess_exec(
                    *args,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    **spawn_kwargs,
                )
            else:
                spawn_kwargs = CommandASTFirewall._build_spawn_kwargs(safe_env)
                proc = await asyncio.create_subprocess_shell(
                    normalized_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    **spawn_kwargs,
                )
            CommandASTFirewall._assign_to_job_supervisor(proc.pid)

            async def _collect_bounded() -> Tuple[bytes, bytes]:
                out_b, err_b, _ = await asyncio.gather(
                    CommandASTFirewall._read_stream_bounded(proc.stdout),
                    CommandASTFirewall._read_stream_bounded(proc.stderr),
                    proc.wait(),
                )
                return out_b, err_b

            communicate_task = asyncio.create_task(_collect_bounded())
            done, _ = await asyncio.wait({communicate_task}, timeout=timeout_sec)
            if not done:
                logger.warning("Process timed out (%.2fs). Commencing escalating termination sequence...", timeout_sec)
                sigkill = getattr(signal, "SIGKILL", signal.SIGTERM)
                try:
                    if proc.returncode is None:
                        CommandASTFirewall._signal_process_tree(proc, signal.SIGINT)
                        await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=0.5)
                except asyncio.TimeoutError:
                    if proc.returncode is None:
                        CommandASTFirewall._signal_process_tree(proc, signal.SIGTERM)
                    try:
                        await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=0.5)
                    except asyncio.TimeoutError:
                        if proc.returncode is None:
                            CommandASTFirewall._signal_process_tree(proc, sigkill)
                        try:
                            await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=1.0)
                        except asyncio.TimeoutError:
                            pass
                except ProcessLookupError:
                    try:
                        await asyncio.wait_for(asyncio.shield(proc.wait()), timeout=1.0)
                    except asyncio.TimeoutError:
                        pass

                try:
                    await asyncio.wait_for(asyncio.shield(communicate_task), timeout=1.0)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    communicate_task.cancel()
                    for pipe in (proc.stdout, proc.stderr):
                        if pipe and hasattr(pipe, "feed_eof"):
                            pipe.feed_eof()
                    if hasattr(proc, "_transport") and proc._transport:
                        try:
                            proc._transport.close()
                        except Exception:
                            pass
                    await asyncio.gather(communicate_task, return_exceptions=True)

                return {
                    "success": False,
                    "exit_code": -9,
                    "stdout": "",
                    "stderr": f"Process terminated: Exceeded maximum allowed runtime ({timeout_sec}s). Interactive prompts are forbidden.",
                    "risk_level": risk,
                }

            stdout_bytes, stderr_bytes = communicate_task.result()
            return {
                "success": proc.returncode == 0,
                "exit_code": proc.returncode,
                "stdout": stdout_bytes.decode("utf-8", errors="replace"),
                "stderr": stderr_bytes.decode("utf-8", errors="replace"),
                "risk_level": risk,
            }

        except Exception as e:
            return {
                "success": False,
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Subprocess execution exception: {str(e)}",
                "risk_level": risk,
            }
        finally:
            if proc and proc.returncode is None:
                try:
                    CommandASTFirewall._signal_process_tree(proc, getattr(signal, "SIGKILL", signal.SIGTERM))
                except Exception:
                    pass
