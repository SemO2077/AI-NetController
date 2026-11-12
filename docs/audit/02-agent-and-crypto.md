# Track 2 Audit: Python Backend Agent & Mobile/Crypto (`fix/agent-and-crypto`)

> **Scope & Cross-References**
> Covers Python host daemon core, firewall, cryptography, media streaming, Windows packaging/integration, Python test safety, and Flutter/Dart/Android native mobile modules.
> **Prerequisite**: Read [`docs/audit/00-shared-contracts.md`](./00-shared-contracts.md) before modifying any opcode, frame parser, auth check, AEAD crypto, or HITL gate.
> **Cherry-pick Note**: In `backup/github-pushed-snapshot`, commit `7e68a18` modified **98 files** across all tracks in one monolithic commit. Do **NOT** run raw `git cherry-pick 7e68a18` onto `fix/agent-and-crypto`. Extract scoped file/hunk patches cleanly after Track 1 paths align (`git show backup/github-pushed-snapshot:<path>`).
> **Path Mapping Note**: On base `chore/audit-setup` (`72c84a4`), Dart files sit flat under `apps/mobile/lib/*.dart`. Track 1 (`chore/project-structure`) moves them under `apps/mobile/lib/{demo,protocol,security,services,theme,ui}/`. Both paths are shown where relevant.

---

## Part A — Python Host Agent Core, Security & Packaging (`agent/`)

### 1. `agent/agent.py` — `UnboundLocalError`, Pre-Auth Firewall & Auth Bugs
- **File Path(s):** `agent/agent.py` (`L642-683, L1035-1093, L1244-1299` at `0ccb8ec` / `L811-1590` in `7e68a18`)
- **Root Cause:**
  1. `_process_auth()` bound `client_ip` and `resolved_client_id` ONLY inside `if is_valid_hmac:`, raising `UnboundLocalError` on every invalid HMAC attempt at `_record_auth_failure(client_ip, resolved_client_id)` and skipping error reply + `ws.close(1008)` + auto-ban.
  2. `_get_valid_secrets()` unconditionally appended 3 publicly committed backdoors (`"cst_autonomous_lan_secret_2025"`, `"cst_thesis_2026_secret_key"`, `"ai_netcontroller_secret_2025"`) and `SHARED_SECRET` fell back to `"ai_netcontroller_secret_2025"` (`PIN` `"847291"`).
  3. 6-digit `pairing_pin` was accepted directly inside `_get_valid_secrets()`, lacked headless brute-force lockout (`self.gui_state is None`), and returned long-lived `"pairingToken"` upon PIN auth.
  4. JSON `PAIR`/`AUTHENTICATE` compared raw plaintext tokens without binding to per-connection `nonce` or enforcing `MAX_NONCE_AGE_SECONDS`; `handle_connection` used `continue` instead of `break` after `ws.close(1008)` on failed auth.
  5. Credential rotation desynchronized `self.pairing_token`/`pairing_pin` from `daemon_config.py`, keeping revoked credentials valid inside `_get_valid_secrets()`.
  6. Missing WebSocket `Origin` validation allowed Cross-Site WebSocket Hijacking (CSWSH).
- **Fix Steps:**
  1. Resolve `client_ip` and `resolved_client_id` unconditionally before `if is_valid_hmac:` and call `_record_auth_failure()` on all malformed/expired/invalid auth attempts (`00-shared-contracts.md §3.1`).
  2. Delete all hardcoded secret fallback strings and lists (`00-shared-contracts.md §4`); load active secrets from a single synchronized `daemon_config.py` source and revoke old secrets immediately on rotation.
  3. Require challenge-response HMAC/PAKE bound to connection `nonce`, enforce rate-limiting/auto-ban/geofencing inside `HostAgentDaemon` even headless, `break` immediately on auth failure, and enforce `_is_origin_allowed()` on WS handshakes (`00-shared-contracts.md §3.1-3.2`).
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `UnboundLocalError` (`L1560`), added `_is_origin_allowed()` (`L882`), removed hardcoded secret fallbacks in main paths, and fixed `break`. Verify `_get_valid_secrets()` (`L811` in `7e68a18`) and PIN brute-force / headless lockout + rotation revocation carefully when porting.
- **Safe Verification Command:**
  ```powershell
  python -m pytest agent/tests/test_agent_stress.py agent/tests/test_heartbeat.py
  ```

### 2. `agent/agent.py` — Viewport Resize, Media Pipeline, Crash & Lifecycle Bugs
- **File Path(s):** `agent/agent.py` (`L416-525, L630-815, L955-975, L1099-1212, L1492-1941` at `0ccb8ec`)
- **Root Cause:**
  1. `_process_viewport_resize` checked `if len(payload) >= 8:` before `elif payload.startswith(b'{'):`, causing every JSON resize payload (`>= 8` bytes) to unpack `'{"width"'` as `2065856361x1685350434` (`3840x2160`), while `OP_AUDIO` (`0x09`) had a brittle `len==8 or b'"width"'` resize overload.
  2. `_grab_and_compress()` returned scalar `None` when `mss` was unavailable, raising `TypeError` on tuple unpack and killing `_screen_stream_loop`.
  3. `kill_all_tasks()` (`Panic: Disconnect All`) terminated `JOB_SUPERVISOR.job_handle` without recreating the handle and left all active remote `self.clients` WebSockets connected.
  4. `CommandASTFirewall` dereference crashed with `AttributeError` if import failed (`None`); fire-and-forget `asyncio.create_task` and `run_coroutine_threadsafe` (in `_process_ollama_query`) leaked exceptions on disconnect.
  5. Thread-safety & lifecycle bugs: `AdaptiveScreenPipeline.close()` closed thread-local `mss` from wrong thread; `stop()` / `force_disconnect_client()` mutated event loop objects off-thread and never called `loop.stop()`; `_process_clipboard()` instantiated `tkinter.Tk()` on the asyncio loop thread; `_StdlibWsAdapter` lacked a write lock, yielded control frames (`0x09`/`0x0A`), and omitted close frames (`0x08`).
  6. Outbound `OP_FRAME`, `OP_TELEMETRY`, and `OP_ERR` emitted `seq=0` (bypassing client anti-replay).
  7. JSON `INPUT_EVENT` read `data.get("action")` (`"input_event"`) before `"type"`, dropping events; input lock matched `ip` instead of `ip:port`; `view_only_mode` was bypassed by `OP_AUDIO` (`lock_pc`), `OP_FILE_TRANSFER`, `OP_LLM_STREAM`, and `_process_clipboard`.
  8. Non-real/hardcoded behaviors: `_process_audio_control` ignored unpacked `vol_pct`, `client_ecdh_pubkey` was commented out (plaintext WS frames), `"8.8.8.8"` probe, `"qwen2.5-coder:32b"` / `127.0.0.1:11434`, `2.0%` fake idle CPU, and mDNS `_cst-agent._tcp.local.`.
- **Fix Steps:**
  1. Per `00-shared-contracts.md §1–3`: assign `OP_DISPLAY_ENUM = 0x0D`, `OP_FRAME_SYNC = 0xED`, `OP_ERR = 0xEE`; check `payload.lstrip().startswith(b'{')` **before** `len(payload) == 8` in `_process_viewport_resize`; remove `OP_AUDIO` `len==8` heuristic; increment monotonic `seq >= 1` on post-auth outbound frames.
  2. Return `(None, False)` from `_grab_and_compress`; close all `self.clients` & recreate `JOB_SUPERVISOR` in `kill_all_tasks()`; guard `CommandASTFirewall is None`; serialize `_StdlibWsAdapter` writes with `asyncio.Lock` and handle `0x09`/`0x0A`/`0x08`; enforce `view_only_mode` + `ip:port` `inputAllowed` across all mutating opcodes; wire `HostCryptoVault` ECDH+AEAD session encryption cleanly.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `_process_viewport_resize` (`L2121`), `_grab_and_compress` (`L499`), `OP_DISPLAY_ENUM=0x0D` / `OP_FRAME_SYNC=0xED`, `frame_seq`/`telem_seq` monotonic counters (`L2241, L2290`), `OP_FILE_TRANSFER` view-only check (`L1505`), and `HostCryptoVault` AEAD integration (`INIT_ECDH_VAULT` `L1462`). Verify `_StdlibWsAdapter`, `kill_all_tasks()`, `clipboard`, and `vol_pct` on extraction.
- **Safe Verification Command:**
  ```powershell
  python -m py_compile agent/agent.py
  python -m pytest agent/tests/test_e2e_loopback.py
  ```

### 3. `agent/agent.py` — HITL Remote Self-Approval Bypass
- **File Path(s):** `agent/agent.py` (`L544-547, L1097, L1317-1350` at `0ccb8ec` / `L1648-1895` in `7e68a18`)
- **Root Cause:**
  1. `APPROVAL_REQUIRED` was sent to the same remote `ws` connection requesting the command, allowing the remote peer to approve its own `REQUIRES_BIOMETRIC` command with zero host confirmation (`00-shared-contracts.md §5`).
  2. `AstCommandInspector.inspect` downgraded `"BLOCKED"` commands to HITL prompts instead of immediate hard rejection; `pending_approvals` used client-chosen `command_id`.
- **Fix Steps:**
  1. Reject `"BLOCKED"` verdicts unconditionally (`00-shared-contracts.md §5`).
  2. Generate server-side `approval_id` and `challenge_nonce`; under `strict` profile allow resolution **only** via local host GUI operator (`resolve_local_hitl`); under standard profile require same `ws` session + constant-time `HMAC-SHA256(secret, "${approval_id}:${nonce}:${command}")`.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Yes** — `7e68a18` (`L1632-1895`) added `resolve_local_hitl`, server-generated `approval_id`/`challenge_nonce`, strict-mode local-only check, and HMAC proof verification (`_process_hitl_response`).
- **Safe Verification Command:**
  ```powershell
  python -c "import ast; ast.parse(open('agent/agent.py', encoding='utf-8').read()); print('agent.py AST OK')"
  ```

### 4. `agent/command_ast_firewall.py` & `agent/__init__.py`
- **File Path(s):** `agent/command_ast_firewall.py`, `agent/__init__.py`
- **Root Cause:**
  1. `import subprocess` was missing, causing `NameError` swallowed by `except Exception: pass` on Windows timeout `taskkill`.
  2. `from agent import JOB_SUPERVISOR` failed because `agent/__init__.py` didn't export `JOB_SUPERVISOR` and swallowed `ImportError`.
  3. `execute_sandboxed()` checked only `if not is_allowed:`, executing `"REQUIRES_BIOMETRIC"` commands with no approval flag.
  4. Evasion vectors: full-path interpreters (`C:\Windows\...\powershell.exe`) missed `split(".")[0]`; parentheses/redirection (`(del ...)`, `>`) weren't split; interstitial quotes (`Remove"-"Item`, `-"e"nc`, `"powershell.exe" -enc`), PowerShell backticks (``-`enc``), `/` or Unicode dashes, CMD substring slices (`%COMSPEC:~-7%`), `!VAR!`/`${IFS}`/`$env:`, and missing LOLBins (`iwr`, `irm`, `schtasks`, `wevtutil`, `msiexec`, `wmic`, `net`, `python -m`); frozen `sys.executable` re-launched daemon exe; unbounded `proc.communicate()` OOM risk; small blocklist `safe_env` + hardcoded `C:\Windows`.
- **Fix Steps:**
  1. Export `JOB_SUPERVISOR` cleanly in `agent/__init__.py` with fallback logging.
  2. Add `import subprocess` (`CREATE_NO_WINDOW`), enforce `biometric_approved: bool = False` in `execute_sandboxed()` (`00-shared-contracts.md §5`), normalize full paths via `os.path.basename` across all chained segments, normalize Unicode NFKC + dashes, split `( ) < > , @`, reject CMD slice/variable obfuscation, avoid `sys.executable` when `getattr(sys, "frozen", False)`, cap stdout/stderr streams, and build `safe_env` via an explicit allowlist.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `import subprocess`, `JOB_SUPERVISOR` export & import fallback (`agent/__init__.py:8`, `command_ast_firewall.py:250`), and `biometric_approved: bool = False` in `execute_sandboxed` (`L296, L314`). Verify full-path / parenthesis / slice evasions & `frozen` `sys.executable` handling carefully.
- **Safe Verification Command:**
  ```powershell
  python -c "from agent.command_ast_firewall import CommandASTFirewall; print(CommandASTFirewall.inspect_and_sanitize('(del /f secret.txt)'))"
  ```

### 5. `agent/agent_daemon.py`
- **File Path(s):** `agent/agent_daemon.py`
- **Root Cause:**
  1. Emitted raw TCP `0x55 0xAA` with wrong `opcode=0x01` (`OP_PING`) and no client RX loop; hardcoded `"CST_SECURE_TOKEN_2026"` ignoring `daemon_config.py`; zero geofencing/rate-limiting/blacklist.
  2. `DaemonServer.stop()` hung inside `loop.sock_accept(sock)`; `SHM_NAME = "cst_frame_shm_v1"` leaked on crash; `WindowsJobObjectGuard` leaked job handle; startup token copy went stale after rotation.
  3. Missing `ctypes` `restype`/`argtypes` for `HDESK`/`DWORD` (`OpenInputDesktop`/`CloseDesktop`/`WTSGetActiveConsoleSessionId`) truncated 64-bit handles; unused `get_active_console_session()`; UDP `s4`/`s6` handle leaks + hardcoded IPv6 `scope_id=0`; 30 FPS idle CPU burn with 0 clients; raw `b"LOCKED"` frame corruption; placeholder `WoLDoctor.audit_hardware_configuration()` forcing `"wol_ready": True`.
- **Fix Steps:**
  1. Align headers with `00-shared-contracts.md §1–2` (`0xC5 0x71`, `0x03`), remove `"CST_SECURE_TOKEN_2026"` (`§4`), load secret from `daemon_config.py`, cancel accept task & close listening socket in `stop()`, unlink SHM via `atexit`, define exact `wintypes` signatures, use `with socket.socket(...)`, gate capture on connected clients, and report real WoL capability results.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `0xC5 0x71`, removed `"CST_SECURE_TOKEN_2026"`, and improved `WoLDoctor` (`L237, L342`) + `sock.close()`; remaining `DaemonServer` RX/lifecycle & ctypes items need verification.
- **Safe Verification Command:**
  ```powershell
  python -m py_compile agent/agent_daemon.py
  ```

### 6. `agent/daemon_config.py`
- **File Path(s):** `agent/daemon_config.py`
- **Root Cause:**
  1. Used non-atomic `os.remove(cfg_path)` + `os.rename()` fallback on `OSError`, creating a config-loss window, and lacked `threading.RLock()` around read-modify-write ops (`rotate_token`, `regenerate_pin`).
  2. `config.update(loaded)` lacked schema/type bounds checking; `DEFAULT_TOKEN_FALLBACK = "cst_autonomous_lan_secret_2025"` was hardcoded; divergent token prefix (`cst_sec_` vs `ai_sec_` in `agent_gui.py`); secrets stored plaintext without POSIX `0o600` or Windows DPAPI (`CryptProtectData`).
- **Fix Steps:**
  1. Add module-level `threading.RLock()`, use CSPRNG token generation without static fallback (`00-shared-contracts.md §4`), validate field types/ranges on load, retry `os.replace()` without deleting `cfg_path`, enforce `0o700`/`0o600` on Unix + DPAPI/user-SID ACLs on Windows, and consolidate token rotation to one helper.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` added `_CONFIG_LOCK = threading.RLock()` (`L34`), `os.chmod(..., 0o700/0o600)` (`L121`), and removed `DEFAULT_TOKEN_FALLBACK`. Windows DPAPI is still absent (`crypto_vault.py` & `daemon_config.py`).
- **Safe Verification Command:**
  ```powershell
  python -c "import tempfile, agent.daemon_config as dc; print(dc.DEFAULT_CONFIG.keys())"
  ```

### 7. `agent/agent_gui.py` & `agent/windows_integration.py`
- **File Path(s):** `agent/agent_gui.py`, `agent/windows_integration.py`
- **Root Cause:**
  1. `launch_gui_with_background_daemon()` launched incompatible raw-TCP `DaemonServer` on `state.local_ip` instead of `HostAgentDaemon` on `0.0.0.0`, with a no-op `on_disconnect_all` lambda.
  2. `_prompt_uninstall` / `show_uninstall_dialog()` ran `on_complete` before `messagebox.showinfo(..., parent=win)` (causing `TclError`) and invoked `on_exit()` twice; `perform_full_uninstall()` reported `"stopped_daemon": True` without killing daemons or removing files.
  3. `perform_full_install()` ran `taskkill /F /IM AI_NetController_HostAgent.exe` (self-killing the installer if run outside target dir); missing `use_last_error=True` on `kernel32` broke `SingleInstanceGuard` & leaked `mutex_handle`; missing `ImageTk` triggered silent install; cross-thread `win.after` omitted `pct=pct, msg=msg` defaults and `winfo_exists()`; GUI startup unconditionally mutated registry & `USERPROFILE\Desktop` (ignoring OneDrive Desktop); VBS shortcut generator escaped quotes but not `\r\n`.
  4. `agent_gui.py` faked `capture_fps: 120`, exposed plaintext `pair_token` in `?pair_token=` URLs and logs, kept `ban_id` random collisions (`BAN-100..999`) in RAM only, and wired Setup Wizard "Save" directly to `win.destroy()`.
- **Fix Steps:**
  1. Wire `HostAgentDaemon` in `launch_gui_with_background_daemon()` with real `kill_all_tasks` / `force_disconnect_client` / `resolve_local_hitl` callbacks.
  2. Fix `SingleInstanceGuard` (`WinDLL('kernel32', use_last_error=True)`, close handle on duplicate), terminate processes by exact executable path (`!= os.getpid()`) rather than `/IM`, implement real cleanup in `perform_full_uninstall()`, fix `on_exit` ordering, reject `\r\n` (or use `IShellLinkW`), isolate `ImageTk` import, resolve Known Folder Desktop, and bind real FPS + persistent bans/settings (`00-shared-contracts.md §4-5`).
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `use_last_error=True` (`windows_integration.py:41`), real `capture_fps: 0.0` (`agent_gui.py:188`), and `stopped_daemon` tracking (`windows_integration.py:457`); `launch_gui_with_background_daemon` still uses `DaemonServer` (`L1692`) and Setup Wizard `win.destroy()` (`L1382`) in `7e68a18`.
- **Safe Verification Command:**
  ```powershell
  python -m py_compile agent/agent_gui.py agent/windows_integration.py
  ```
  > **DO NOT** run un-mocked installer/uninstall/registry functions directly against the developer workstation!

### 8. `agent/crypto_handshake.py` & `agent/crypto_vault.py`
- **File Path(s):** `agent/crypto_handshake.py`, `agent/crypto_vault.py`
- **Root Cause:**
  1. `crypto_handshake.py` derived a single `self.session_key` and unpacked `rx_counter, _ = struct.unpack('!QI', nonce)` ignoring the 4-byte sender tag (enabling packet reflection & nonce reuse), omitted `handshake_timestamp` from HMAC proof & expiry check, blocked neither re-handshake nor out-of-order packets (`_rx_last_nonce_counter`), skipped 32-byte input checks in `PurePythonX25519`, and hid invalid keys behind bare `except` in `FastX25519`.
  2. `crypto_vault.py` allowed `complete_handshake()` after `close()` using the zeroed `bytearray` PSK (all-zero HMAC bypass!), crashed on `SlidingWindowReplayProtector(window_size <= 0)` (`negative shift count`), lacked `threading.Lock`, allowed caller `seq=0` or nonce reuse in `encrypt_frame()`, ignored epoch bytes in `>IQ`, no-op'd on `bytes` in `scrub_memory()`, lacked DPAPI/mutual auth, and wasn't bundled/used by `agent.py` on `72c84a4`.
- **Fix Steps:**
  1. Enforce `00-shared-contracts.md §3.2`: separate directional keys (`CTX_HOST_TX` / `CTX_CLIENT_TX`), validate sender tag on decrypt, include timestamp in HMAC + enforce TTL, add `_closed` guard & `self._priv_obj = None` in `close()`, validate `window_size >= 1` under `threading.Lock`, forbid caller-specified `seq` reuse (`tx_seq += 1` internally), validate all-zero shared secrets and 32-byte key lengths cleanly, and scrub mutable buffers safely.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` added `_HOST_SENDER_TAG`/`_CLIENT_SENDER_TAGS` check (`crypto_handshake.py:472,496`) + `_HANDSHAKE_TTL_SEC` (`L419`), and added `self._closed` + internal `self.tx_seq` (`crypto_vault.py:355,455`). `window_size <= 0` guard in `crypto_vault.py` still missing in `7e68a18`.
- **Safe Verification Command:**
  ```powershell
  python -m py_compile agent/crypto_handshake.py agent/crypto_vault.py
  python -m pytest agent/tests/test_all_edge_cases.py
  ```

### 9. `agent/network_fuzzer_shield.py`, `agent/host_file_writer.py`, `agent/multi_monitor_streamer.py`, `agent/icon_assets.py`
- **File Path(s):**
  - `agent/network_fuzzer_shield.py`
  - `agent/host_file_writer.py`
  - `agent/multi_monitor_streamer.py`
  - `agent/icon_assets.py`
- **Root Cause:**
  1. `network_fuzzer_shield.py`: `OP_FRAME_SYNC = 0xEE` collided with `OP_ERR = 0xEE` and silently dropped all `0xEE` packets even with chaos disabled; checked `raw_packet[2]` before `MAGIC`; leaked `client_states` entries; orphaned 3s watchdog timers; trapped last packet forever in `_reorder_buffer`; stalled WS reader with `asyncio.sleep`; missed `asyncio.Task` in `iscoroutine()`; clobbered root logging with `logging.basicConfig`; failed to enforce `ConnectionState` in `filter_incoming_packet`.
  2. `host_file_writer.py`: `write_chunk` omitted `offset + len(data) <= self.total_size` and `temp_path` symlink/`O_NOFOLLOW` verification (allowing NTFS junction/symlink overwrite via `.cst_part`); colliding `.cst_part` names across concurrent transfers; leaked open file handles on aborted/disconnected transfers; synchronous 500MB SHA-256 stalled event loop; missed broken symlinks (`is_symlink()`), hex regex on `sha256_hex`, `seq` echo in `_build_ack`, and `CONIN$`/`CONOUT$`/255-byte/executable filename guards.
  3. `multi_monitor_streamer.py`: dead module unused by `agent.py`; hardcoded `0x0B` (`00-shared-contracts.md §2` assigns `0x0D`); uncaught `mss.MSS()` crash headless; thread-local `mss` GDI handle leak (no `close()`); 1-monitor `IndexError` outside `try`; lacked DPI awareness (`SetProcessDpiAwarenessContext(-4)`) and lock-screen handling; color extraction race + `1920x1080` fake fallback; missing `numpy`/`PyTurboJPEG` dependencies.
  4. `icon_assets.py`: used `os.path.exists` instead of `os.path.isfile`; skipped in-memory fallback icon when PNG files were absent; `iconbitmap(default=...)` mutated global default icon.
- **Fix Steps:**
  1. Per `00-shared-contracts.md §1–2`: move `OP_FRAME_SYNC` to `0xED` and pass `OP_ERR = 0xEE` cleanly; check `MAGIC` first and reject unauthenticated state in `NetworkFuzzerShield`.
  2. Bound `offset + len(data) <= self.total_size`, use randomized temp staging files opened via `os.O_NOFOLLOW` + parent `.resolve()`, add idle transfer cleanup + disconnect cleanup, validate 64-char hex SHA-256 at `CMD_INIT`, and offload `finalize()` hashing to `run_in_executor`.
  3. Add `close()` + headless `try/except` + DPI awareness + `0x0D` alignment in `MultiMonitorStreamer` and wire it cleanly into `agent.py` (or deprecate dead duplication).
  4. Fix `os.path.isfile`, RGBA normalization, and fallback generation in `icon_assets.py`.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Yes (mostly)** — `7e68a18` fixed `OP_FRAME_SYNC = 0xED` (`network_fuzzer_shield.py:41`), unique `.cst_part` + `O_NOFOLLOW` + `.resolve()` (`host_file_writer.py:82,92,192`), and `close()` + `SetProcessDpiAwarenessContext` + `0x0D` (`multi_monitor_streamer.py:5,51,99`). Verify `offset + len(data) <= total_size`, `is_symlink()`, and `NetworkFuzzerShield` reorder/state fixes carefully.
- **Safe Verification Command:**
  ```powershell
  python -m py_compile agent/network_fuzzer_shield.py agent/host_file_writer.py agent/multi_monitor_streamer.py agent/icon_assets.py
  ```

### 10. `agent/build_agent.spec`, `agent/build_exe.bat`, `agent/sign_binary.ps1`, `agent/version_info.txt`, `agent/app_manifest.xml`, `agent/requirements.txt`
- **File Path(s):** As listed above (`agent/`)
- **Root Cause:**
  1. `build_agent.spec` excluded `'email'` (`L115`), breaking stdlib `urllib.request`, `http.client`, and `websockets.server` in frozen EXEs (failing `_process_ollama_query` with `ModuleNotFoundError: email`); overwrote `agent/app_manifest.xml` with `version="3.0.0.0"`; omitted `network_fuzzer_shield`, `crypto_handshake`, `__init__.py`, and PNG icons.
  2. `sign_binary.ps1` lacked `-TimestampServer`, ignored `$sig.Status -eq 'Valid'` (`| Out-Null`), and swallowed Defender exit code `2`; `build_exe.bat` didn't verify `pyinstaller` exit codes before signing stale `.exe` or sign `_standalone.exe`, and blocked CI with unconditional `pause`.
  3. `version_info.txt` & `app_manifest.xml` drifted (`0.35.0` / `3.0.0.0`, lacking `<longPathAware>true</longPathAware>`); `requirements.txt` omitted `numpy` and `PyTurboJPEG`, kept unused `aiohttp`, and mixed build-only `pyinstaller` with runtime deps.
- **Fix Steps:**
  1. Remove `'email'` from `excludes`, add missing modules/assets/icons (`icon_32.png`, `icon_64.png`, `crypto_handshake`, `network_fuzzer_shield`), and preserve `app_manifest.xml` without overwriting it.
  2. Fail `sign_binary.ps1` unless `$sig.Status -eq 'Valid'` and `MpCmdRun.exe` returns clean exit code; add RFC 3161 TSA timestamp option & PFX CI support; check `%ERRORLEVEL%` after every step in `build_exe.bat`.
  3. Align `version_info.txt` & `app_manifest.xml` (adding `<longPathAware>true</longPathAware>`); add `numpy`/`PyTurboJPEG` and separate `pyinstaller` cleanly (`requirements-build.txt` or conditional note).
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` removed `'email'` from `build_agent.spec`, stopped overwriting `app_manifest.xml` when present (`L16`), added `exit 1` in `sign_binary.ps1`, added `numpy`/`PyTurboJPEG` to `requirements.txt`, and updated `version_info.txt` to `0.50`. Note `sign_binary.ps1` still lacks `-TimestampServer`/`Valid` check in `7e68a18`, and `requirements.txt` still retains `aiohttp` and `pyinstaller`.
- **Safe Verification Command:**
  ```powershell
  python -c "import ast; ast.parse(open('agent/build_agent.spec', encoding='utf-8').read()); print('spec OK')"
  ```

### 11. `agent/tests/` — UNSAFE Host-Mutating Tests & Re-implemented Mock Tests
- **File Path(s):**
  - **UNSAFE UN-MOCKED:** `agent/tests/test_windows_integration.py` (added post-`72c84a4`), `agent/tests/test_installer_and_branding.py` (added post-`72c84a4`), `agent/tests/test_android_app_connection_and_control.py`
  - **Mock/Divergent:** `agent/tests/test_e2e_loopback.py`, `agent/tests/test_heartbeat.py`, `agent/tests/test_host_diagnostics.py`, `agent/tests/test_all_edge_cases.py`, `agent/tests/test_full_system_stress.py`
- **Root Cause:**
  1. **`test_windows_integration.py` (`L83-153` in `0ccb8ec`/`7e68a18`) and `test_installer_and_branding.py` (`L136-140`) invoke real `winreg`, desktop/startup shortcut creation, and `perform_full_uninstall()` directly on the live Windows host registry and user folders!**
  2. `test_e2e_loopback.py` & `test_heartbeat.py` test a custom mock `IsolatedHostDaemon` sending `[16B nonce + 32B host_pub]` instead of `agent.py`, use `OP_DISPLAY_ENUM = 0x0B`, and print fabricated pass summaries.
  3. `test_host_diagnostics.py` & `test_all_edge_cases.py` re-implement local copies of WoL/binary/RFC6479/CRC32/HITL functions instead of importing real `agent/*.py` modules (`test_host_diagnostics.py` forces `wol_capable = True`); `test_android_app_connection_and_control.py` hardcodes `"cst_thesis_2026_secret_key"` over `ws://`.
- **Fix Steps:**
  1. **Mock all OS mutations** (`winreg`, `SHGetKnownFolderPath`/shortcut COM/VBS creation, `os.remove`/`shutil.rmtree` inside `%LOCALAPPDATA%` & `Desktop`, `taskkill`) using `unittest.mock.patch` + `tmp_path` fixtures before ever allowing `test_windows_integration.py` or `test_installer_and_branding.py` in CI or local pytest runs.
  2. Update `test_e2e_loopback.py` opcode `0x0B -> 0x0D` (`00-shared-contracts.md §2`), test real `agent` imports (`CommandASTFirewall`, `HostCryptoVault`, `HostFileTransferManager`, `HostAgentDaemon`) rather than local re-implementations, and remove hardcoded `cst_thesis_2026_secret_key`.
- **Exists in `backup/github-pushed-snapshot`?:**
  **No** — verified directly in `7e68a18`: `test_windows_integration.py` (`L1-177`) and `test_installer_and_branding.py` (`L1-144`) **STILL import `winreg` and call real `perform_full_uninstall` without mocking!**
- **Safe Verification Command:**
  > **CRITICAL WARNING — UNSAFE TO RUN UN-MOCKED ON WINDOWS:**
  > **NEVER** run bare `pytest agent/tests/` or `python agent/tests/test_windows_integration.py` / `test_installer_and_branding.py` until `winreg`, shortcut creation, and `perform_full_uninstall` are fully mocked!
  ```powershell
  # Safe subset ONLY (excludes Windows registry/installer mutating tests):
  python -m pytest agent/tests/test_agent_stress.py agent/tests/test_all_edge_cases.py agent/tests/test_e2e_loopback.py agent/tests/test_heartbeat.py
  ```

---

## Part B — Mobile Flutter / Dart & Native Android (`apps/mobile/` + WebView Shell)

### 12. `crypto_channel.dart` & `crypto_engine.dart` — Pre-MAC Replay DoS, PSK & Reflection Flaws
- **File Path(s):**
  - `apps/mobile/lib/security/crypto_channel.dart` (at `72c84a4`: `apps/mobile/lib/crypto_channel.dart`)
  - `apps/mobile/lib/security/crypto_engine.dart` (at `72c84a4`: `apps/mobile/lib/crypto_engine.dart`)
- **Root Cause:**
  1. **Pre-MAC Replay Counter Poisoning (DoS)**: `crypto_channel.dart` (`L462`) updated `_rxLastNonceCounter = rxCounter` *before* `ChaCha20Poly1305.decrypt`, and `crypto_engine.dart` (`L480`) called `_replayGuard.validateAndUpdate(seq)` *before* `ChaCha20Poly1305.decrypt`. One forged packet with `seq = 0xFFFFFFFF` blocked all future traffic (`00-shared-contracts.md §3.2`).
  2. **UTF-16 vs UTF-8 PSK Mismatch**: `crypto_engine.dart` (`L420`) encoded PSK with `.codeUnits` (UTF-16) instead of `utf8.encode()`, breaking non-ASCII PSKs vs Python `.encode('utf-8')`, plus hardcoded `'CST_SECURE_TOKEN_2026'`.
  3. **RFC 7748 Gaps**: `crypto_engine.dart` (`L133`) omitted Curve25519 bit-255 masking (`u & ((1<<255)-1)`), and both files lacked all-zero `sharedSecret` rejection (`crypto_channel.dart` still lacks it in `7e68a18`).
  4. **Single-Key Reflection & Missing Handshake Checks (`crypto_channel.dart`)**: Uses one shared `_sessionKey` for both TX and RX, ignores the 4-byte nonce sender suffix (`0x484F5354`/`0x4D4F424C`), skips `kHandshakeMagic` + timestamp validation, and misses `seq <= 0` in `crypto_engine.dart` `SlidingWindowReplayGuard`.
- **Fix Steps:**
  1. Enforce post-MAC replay commit (`00-shared-contracts.md §3.2`): non-mutating replay eligibility check -> `ChaCha20Poly1305.decrypt` -> commit counter/bitmap ONLY on success.
  2. Enforce `utf8.encode(psk)`, remove `'CST_SECURE_TOKEN_2026'`, mask bit 255 in `Curve25519.scalarMult`, reject all-zero `sharedSecret` in both files, validate `kHandshakeMagic` + bounded timestamp in `crypto_channel.dart`, derive distinct directional keys (`CTX_CLIENT_TX` / `CTX_HOST_TX`), verify sender role tag on decrypt, and reject `seq <= 0` in `SlidingWindowReplayGuard`.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed post-MAC replay commit (`crypto_channel.dart:482`, `crypto_engine.dart:499`), `utf8.encode`, bit-255 masking, removed `'CST_SECURE_TOKEN_2026'`, and exact header length in `crypto_channel.dart` (`L456`). **Still missing in `7e68a18`**: `crypto_channel.dart` still uses single `_sessionKey` (`L370`), skips `kHandshakeMagic`/timestamp checks (`L358-365`), and skips all-zero `sharedSecret` check (`L367`).
- **Safe Verification Command:**
  ```powershell
  Push-Location apps/mobile
  flutter test test/crypto_channel_unit_test.dart
  Pop-Location
  ```

### 13. `viewport_stream_widget.dart` — Pre-Auth Bypass, Trailing Bytes & Hardcoded Secret
- **File Path(s):** `apps/mobile/lib/ui/viewport_stream_widget.dart` (at `72c84a4`: `apps/mobile/lib/viewport_stream_widget.dart`)
- **Root Cause:**
  1. **Critical Pre-Auth Bypass**: Used `statusStr.contains('AUTH') || statusStr.contains('OK')` — accepting `'AUTH_FAILED'`, `'AUTH_REQUIRED'`, and `'NOT_OK'` as authenticated — AND flipped `_isConnected = true` as soon as any `StreamOpcode.frame` (`0x03`) arrived even before auth!
  2. Hardcoded `_defaultSharedSecret = 'cst_thesis_2026_secret_key'`.
  3. `StreamBinaryPacket.parse()` checked `bytes.length < _streamHeaderSize + length` (`L71`), allowing trailing garbage bytes and directly failing `app_verification_test.dart:100-111`.
  4. Forced `16:9` aspect height (`renderWidth * 9 / 16`), leaked `textCtrl` in `_showKeyboardDialog()`, unref-counted `WakelockPlus`, ignored non-frame opcodes, and didn't wire `onRequestKeyframe` (`0xED`).
- **Fix Steps:**
  1. Match exact confirmation tokens (`'AUTH_OK'` / `'OK_AUTHENTICATED'`) **only**, and refuse/drop `StreamOpcode.frame` packets until `_isConnected == true` (`00-shared-contracts.md §3.1` — note unsolicited `OP_FRAME` acceptance at `L237-249` still exists in `7e68a18`!).
  2. Remove `_defaultSharedSecret` (`00-shared-contracts.md §4`) and require explicit pairing secret before opening socket.
  3. Enforce `bytes.length != _streamHeaderSize + length` (`00-shared-contracts.md §1.2`) and `displayEnum = 0x0D` / `frameSync = 0xED` (`§2`).
  4. Dispose dialog `TextEditingController`, ref-count `WakelockPlus`, wire `onRequestKeyframe`, and use dynamic frame aspect ratios.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `.contains('AUTH')`/`.contains('OK')`, removed `_defaultSharedSecret`, and updated `0x0D`/`0xED`, **but STILL leaves `bytes.length < _streamHeaderSize + length` (`L71`) AND unsolicited `OP_FRAME` flipping `_isConnected = true` (`L242`) unfixed!**
- **Safe Verification Command:**
  ```powershell
  Push-Location apps/mobile
  flutter analyze lib/ui/viewport_stream_widget.dart
  Pop-Location
  ```

### 14. `binary_protocol.dart`, `fragmentation_engine.dart`, `network_framer.dart`
- **File Path(s):**
  - `apps/mobile/lib/protocol/binary_protocol.dart` (`72c84a4`: `lib/binary_protocol.dart`)
  - `apps/mobile/lib/protocol/fragmentation_engine.dart` (`72c84a4`: `lib/fragmentation_engine.dart`)
  - `apps/mobile/lib/protocol/network_framer.dart` (`72c84a4`: `lib/network_framer.dart`)
- **Root Cause:**
  1. `binary_protocol.dart`: colliding opcodes (`displayEnum = 0x0B`, `frameSync = 0xEE`) and permissive `< kHeaderSize + payloadLength` trailing-byte bug (`L102`).
  2. `fragmentation_engine.dart`: `static int _nextMessageId` shared across all instances and opcodes triggered false `frameSync` requests whenever telemetry/file chunks interleaved video frames.
  3. `network_framer.dart`: declared `kSyncByte0 = 0x55`, `kSyncByte1 = 0xAA`, and incremented `bytesReceived += slice.length` without chunk-offset deduplication (duplicate chunks emit corrupted partial buffers).
- **Fix Steps:**
  1. Set `displayEnum = 0x0D`, `frameSync = 0xED`, `error = 0xEE` (`00-shared-contracts.md §2`) and enforce `rawBytes.length != kHeaderSize + payloadLength` (`§1.2`).
  2. Replace `static _nextMessageId` with instance/per-opcode monotonic counters.
  3. Set `kSyncByte0 = 0xC5`, `kSyncByte1 = 0x71`, and deduplicate reassembly intervals/offsets before completing messages.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed opcodes `0x0D`/`0xED` in `binary_protocol.dart`, **but `< kHeaderSize + payloadLength` (`binary_protocol.dart:102`), `static _nextMessageId` (`fragmentation_engine.dart`), and `0x55 0xAA` / duplicate chunk bug (`network_framer.dart`) remain unfixed in `7e68a18`**.
- **Safe Verification Command:**
  ```powershell
  Push-Location apps/mobile
  flutter test test/binary_protocol_unit_test.dart
  Pop-Location
  ```

### 15. `biometric_security_gate.dart`, `main.dart`, Stubbed Mobile Modules & Native Android Config
- **File Path(s):**
  - `apps/mobile/lib/main.dart`, `biometric_security_gate.dart`, `ai_netcontroller.dart`
  - Stubbed services/widgets: `file_transfer_engine.dart`, `os_integrations_manager.dart`, `thermal_governor.dart`, `zero_gc_video_pipeline.dart`, `demo/demo_sandbox.dart`, `ui/pip_stream_viewer.dart`, `ui/responsive_device_card.dart`, `ui/adaptive_layout_builder.dart`
  - Android native: `apps/mobile/android/app/src/main/kotlin/com/cst/autonomouslan/MainActivity.kt`, `AndroidManifest.xml`, `build.gradle`, `res/values/styles.xml`, `gradle.properties`, `apps/mobile/pubspec.yaml`
- **Root Cause:**
  1. **Dead Protocol/Security Modules in `main.dart`**: `main.dart` only imports UI/theme widgets and **never uses** `CryptoChannel`, `CryptoEngine`, `BiometricSecurityGate`, `BinaryProtocol`, `FileTransferEngine`, or `ThermalGovernor`. `_dispatchCommand()` only logs `'Dispatched over ...'` locally; `_scanForPcs()` runs raw TCP probes and hardcodes `'00:00:00:00:00:00'`; `_sendWakeOnLan()` hardcodes `192.168.1.255:9`; `'ghost_devices'` Hive box is read-only.
  2. **Biometric Bypass & Broken Android Host**: `BiometricSecurityGate` allows `allowFallbackWhenUnavailable` & `biometricOnly: false` (PIN fallback); `MainActivity.kt` extended `FlutterActivity` instead of `FlutterFragmentActivity` (breaking `local_auth`); `getHighRefreshRateModeId()` ignores `physicalWidth`/`physicalHeight`; `AndroidManifest.xml` omits `USE_BIOMETRIC`, `ACCESS_FINE_LOCATION`, `NEARBY_WIFI_DEVICES`, uses deprecated `package=`, sets bogus feature `android.hardware.render_ahead`, and enables `android:usesCleartextTraffic="true"` globally (`00-shared-contracts.md §3.3`); `styles.xml` uses `Theme.AppCompat.Light.NoActionBar`; `build.gradle` signs `release` with `signingConfigs.debug` and `minifyEnabled false`.
  3. **Stubbed Modules**: `FileTransferEngine` ignores `ackStream` (`Future.delayed(1ms)`); `OsIntegrationsManager` sends L2 ARP payloads over UDP ports 67/9 with hardcoded fallback MAC/IPs; `ThermalGovernor` is purely synthetic; `ZeroGcVideoRenderer` validates JPEG SOI `0xFFD8` without EOI `0xFFD9` and recurses in `finally`; `DemoSandboxEngine.dispose()` permanently closes singleton `StreamController`s; `ResponsiveDeviceCard` clips inside `mainAxisExtent: 118`; expanded `NavigationRail` tabs are dead in `main.dart`; `TextEditingController`s leak in dialogs.
- **Fix Steps:**
  1. Switch `BiometricSecurityGate` to `biometricOnly: true` without silent hardware-missing approval; wire `CryptoEngine`/`CryptoChannel` + `BinaryProtocol` + `BiometricSecurityGate` into `main.dart` for real authenticated WebSocket control/discovery/WoL.
  2. Fix `MainActivity.kt` (`FlutterFragmentActivity` + resolution-matching refresh mode), `AndroidManifest.xml` (`USE_BIOMETRIC`, clean cleartext scope via `network_security_config` or `wss://`), dark splash `styles.xml`, external release keystore env config in `build.gradle`, and remove `enableJetifier`.
  3. Wire real chunk ACKs (`0x0C`) in `FileTransferEngine`, remove fake ARP-over-UDP and hardcoded MACs, check JPEG EOI (`0xFFD9`) and iterate rather than recursing in `ZeroGcVideoRenderer`, fix card overflow & expanded tabs in `main.dart`.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `MainActivity.kt` `FlutterFragmentActivity` (`L6-8`), `versionName`/`versionCode` in `build.gradle`, and `FileTransferEngine` `0x0C` packet packing (`L113`), **while `usesCleartextTraffic="true"`, missing `USE_BIOMETRIC`, `signingConfigs.debug`, missing resolution filter in `MainActivity.kt`, dead `main.dart` wiring, `OsIntegrationsManager`, `ThermalGovernor`, and `ResponsiveDeviceCard` remain unfixed in `7e68a18`**.
- **Safe Verification Command:**
  ```powershell
  Push-Location apps/mobile
  flutter analyze
  flutter test test/
  Pop-Location
  ```

### 16. Critical Architectural Divergence: Flutter (`apps/mobile/lib/`) vs Java WebView Shell (`scripts/build_android_app.py`)
- **File Path(s):** `scripts/build_android_app.py` (embedded `MainActivity.java`) vs `apps/mobile/lib/`
- **Root Cause:**
  1. Running `scripts/build_android_app.py` does **not** compile the Dart/Flutter codebase in `apps/mobile/lib/`. Instead, it builds the React web bundle (`apps/web/dist/`) into an Android Java `WebView` + localhost `ServerSocket` HTTP/WS bridge APK, signs it with `~/.android/debug.keystore`, and overwrites Flutter's build path `apps/mobile/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`.
  2. At `72c84a4` / `0ccb8ec`, the embedded Java HTTP bridge had release WebView debugging enabled (`setWebContentsDebuggingEnabled(true)`), Origin prefix bypass (`url.startsWith("http://127.0.0.1")` allowing `127.0.0.1.attacker.com`), `Access-Control-Allow-Origin: *`, weak 31-bit `daemonToken`, hand-rolled JSON/regex injection bugs, HTTP/stream leaks, `/24` scanner cutoff (`3800ms` pool shutdown), `"os"` vs `"osName"` key mismatch, stale bundled `RELEASE_MANIFEST.json`, and 100% mocked `/api/pc-control/execute`, `/api/chat`, `/api/update/*`, `/api/ai/models`, `/api/daemon/*` responses!
- **Fix Steps:**
  1. Pick and formalize the canonical Android release strategy: either build & distribute the real Flutter APK (`flutter build apk --release`) once Track 2 wires `main.dart`, OR clearly separate the WebView wrapper output/filename from Flutter's `flutter-apk/`.
  2. In the Java WebView shell (`MainActivity.java`): disable `setWebContentsDebuggingEnabled` in release (`BuildConfig.DEBUG` / `ApplicationInfo.FLAG_DEBUGGABLE`), validate exact parsed `Uri` (`host == "127.0.0.1" && port == localPort`), restrict CORS and generate CSPRNG tokens (`16+` bytes), serialize JSON via `org.json.JSONObject`, return honest `501 REMOTE_WS_REQUIRED` (or bridge via authenticated WS to host agent) instead of fake `200 OK` control responses, fix `osName` + `try-with-resources`, require release keystore env vars for release builds, and fix manifest freshness.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `setWebContentsDebuggingEnabled(isDebuggable)` (`L557`), `org.json.JSONObject` (`L358`), `generateHexToken("ai_sec_", 16)` (`L416`), `osName` lookup (`L975`), real `/api/chat` Gemini forwarding (`L1812`), and honest `501 REMOTE_WS_REQUIRED` on `/api/pc-control/execute` (`L1805`), **while `debug.keystore` signing (`L74`), overwriting `flutter-apk/`, and ignoring `apps/mobile/lib/` remain in `7e68a18`**.
- **Safe Verification Command:**
  ```powershell
  python -m py_compile scripts/build_android_app.py
  ```
