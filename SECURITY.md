# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.5.x   | :white_check_mark: |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of AI NetController seriously. If you discover a vulnerability or security issue:

1. **Do NOT open a public GitHub issue.**
2. Send an email describing the issue, impact, and reproduction steps to `security@ai-netcontroller.com`.
3. You will receive an acknowledgment within 24 hours.
4. Valid issues will be addressed with a patch released within 7 days.

## Security Architecture Highlights

* **Wire Protocol**: AI-NET/3.0-SECURE binary protocol with constant-time HMAC-SHA256 authentication (`0xC5 0x71`).
* **Anti-Replay**: RFC 6479 128-bit sliding window sequence verification.
* **AST Command Firewall**: Pre-compiled regex AST analyzer preventing command injection and shell escape vectors.
* **Human-in-the-Loop (HITL)**: Risk gate for high-risk system commands requiring explicit confirmation or biometric WebAuthn verification.
* **Sandbox Execution**: Windows Kernel Job Object memory containment (256MB hard cap) with escalating termination supervision (`SIGINT -> SIGTERM -> SIGKILL`).
