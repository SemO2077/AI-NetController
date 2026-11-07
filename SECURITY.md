# Security Policy

## Supported Versions

Security fixes are applied to the latest beta release branch (`0.34.x`).

| Version | Supported |
| :--- | :--- |
| `0.34.x` | Yes |
| `0.33.x` | Security fixes only |
| `< 0.33.0` | No |

---

## Security Architecture

- **AST Command Firewall & De-Obfuscation**: Both the Windows Host Agent (`agent/command_ast_firewall.py`) and the Express Control Server (`apps/web/server.ts`, `apps/web/src/services/securityService.ts`) normalize shell obfuscation tricks (`^`, backticks, env slices) and block destructive commands and LOLBin payload downloads prior to execution.
- **Secret Scrubbing & Process Sandboxing**: Child processes spawned by the Host Agent or Control Server strip sensitive environment variables (`GEMINI_API_KEY`, `AI_AGENT_SECRET`, `GITHUB_TOKEN`, etc.) and run inside memory-capped Windows Job Objects (`256 MB` limit, `KILL_ON_JOB_CLOSE`).
- **Zero-Trust Wire Protocol**: Sessions support ephemeral X25519 key exchange, ChaCha20-Poly1305 AEAD encryption, and RFC 6479 128-bit sliding-window anti-replay bitmaps (`agent/zero_trust_pairing.py`).
- **Local-First AI Privacy**: Network diagnostics can run entirely offline via a local Ollama instance (`http://localhost:11434`).

---

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not open a public GitHub issue**.

Instead, report it privately via [GitHub Security Advisories](https://github.com/smehmedd/AI-NetController/security/advisories/new) with:
1. A description of the vulnerability and affected component (`agent/`, `apps/web/`, or `apps/mobile/`).
2. Steps or proof-of-concept code to reproduce the issue.
3. The potential impact (e.g., privilege escalation, unauthorized LAN access).

We aim to acknowledge reports within 48 hours and publish a fix in the next point release.
