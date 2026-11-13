# Security Policy

## Supported Versions

Security updates and patches are actively maintained for the current release series.

| Version Branch | Supported | Notes |
| :--- | :--- | :--- |
| `0.51.x` (Beta `0.51.00`) | Yes | Active maintenance and security patches |
| `0.50.x` | Limited | Security patches migrated to `v0.51.0` |
| `< 0.50.0` | No | End of life; upgrade to `v0.51.0` (Beta `0.51.00`) or newer |

---

## Security Architecture & Defenses

AI NetController implements defense-in-depth across the Host Agent, Control Server, and Mobile Companion.

### 1. Command AST Firewall & Syntax Sanitization
- **Pre-Execution De-Obfuscation**: Normalizes common shell evasion techniques prior to evaluation, including Windows Command Prompt caret escapes (`c^a^l^c`), PowerShell backtick evasion, and environment variable substring slicing (`%COMSPEC:~0,1%`).
- **Administrative Keyword Filtering**: Blocks commands containing destructive primitives (`format`, `diskpart`, `rmdir /s /q`, `vssadmin`, `cipher`, `takeown`, `icacls`).
- **Living-off-the-Land Binary (LOLBin) Defense**: Detects and intercepts attempts to invoke remote payload fetchers via system binaries (`certutil -urlcache`, `bitsadmin /transfer`, `mshta http://...`, `regsvr32 /i:http`).
- **Implementations**:
  - Python Host Agent: `agent/command_ast_firewall.py`
  - Control Server: `apps/web/server.ts` and `apps/web/src/services/securityService.ts`

### 2. Process Sandboxing & Secret Scrubbing
- **Windows Job Object Isolation**: Processes executed by the Host Agent are assigned to a Windows Job Object configured with a `256 MB` memory limit and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. When the supervisor terminates, all descendant processes are automatically terminated.
- **Tree Termination**: Timeouts trigger escalating termination (`SIGINT` → `SIGTERM` → `taskkill /F /T`) to prevent orphaned background tasks.
- **Secret Scrubbing**: Child process environments are stripped of sensitive variables (`AI_AGENT_SECRET`, `GEMINI_API_KEY`, `GITHUB_TOKEN`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
- **Credential Storage**: Persistent host secrets and paired client tokens are protected using the Windows Data Protection API (DPAPI) via `agent/crypto_vault.py`.

### 3. Binary Protocol Shielding & Mutual Authentication
- **Framing Integrity**: All WebSocket messages must strictly adhere to the 12-byte packed binary header (`0xC5 0x71` magic bytes, opcode, flags, sequence number, payload length).
- **Anti-Replay Defense**: Evaluates incoming frames against an RFC 6479 128-bit sliding-window bitmap (`agent/network_fuzzer_shield.py`), rejecting duplicate or replayed sequence numbers.
- **Mutual Handshake**: Initial connection requires an HMAC-SHA256 challenge-response handshake (`OP_AUTH`, `agent/crypto_handshake.py`). Unauthenticated connections are disconnected within a strict 3000ms SLA.
- **Rate Limiting**: Enforces token-bucket rate limiting on WebSocket wire frames (300 pkts/sec) and HTTP REST endpoints (120 req/min per IP).

### 4. Human-in-the-Loop (HITL) Approval Gate
- High-risk administrative actions (service restarts, system shutdown, configuration alterations) require explicit operator authorization via `OP_HITL` frames before execution proceeds.

### 5. Local-First AI Privacy
- Diagnostic queries can be routed entirely to a local Ollama instance (`http://localhost:11434`), ensuring that sensitive host diagnostics, IP addresses, and process trees never leave the local network.

---

## Reporting a Vulnerability

We appreciate the responsible disclosure of security issues. If you identify a vulnerability:

1. **Do not create a public GitHub issue.**
2. Report the vulnerability privately via **[GitHub Security Advisories](https://github.com/SemO2077/AI-NetController/security/advisories/new)**.
3. Include the following details:
   - Affected component (`agent/`, `apps/web/`, or `apps/mobile/`)
   - Step-by-step reproduction instructions or proof-of-concept script
   - Assessment of potential impact (e.g., arbitrary code execution, privilege escalation, authentication bypass)
   - Proposed mitigation, if available

### Response Timeline
- **Initial Acknowledgment**: Within 48 hours.
- **Status Assessment**: Within 5 business days.
- **Remediation**: Security patches are prioritized and released in the next patch update (`v0.51.x`).
