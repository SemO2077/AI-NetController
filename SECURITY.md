# Security Policy

## Supported Versions

Security fixes are applied to the latest beta release branch (`0.32.x`).

| Version | Supported |
| :--- | :--- |
| `0.32.x` | Yes |
| `0.31.x` | Security fixes only |
| `< 0.31.0` | No |

---

## Security Architecture

- **Command Execution Whitelisting**: The Windows Host Agent (`agent/net_agent.py`) validates all incoming control commands against a strict allowlist and executes system tools (`netsh`, `powershell`, `tshark`) via parameterized argument lists (`shell=False`).
- **Privilege Separation**: When launched without Administrator privileges, the Host Agent automatically disables QoS mutation and raw socket capture, operating in read-only telemetry mode.
- **Local-First AI Privacy**: Network diagnostics can be run entirely offline via a local Ollama instance (`http://localhost:11434`). When cloud LLM providers are used, sensitive local identifiers are redacted before outbound requests.

---

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not open a public GitHub issue**.

Instead, report it privately via [GitHub Security Advisories](https://github.com/smehmedd/AI-NetController/security/advisories/new) with:
1. A description of the vulnerability and affected component (`agent/`, `apps/web/`, or `apps/mobile/`).
2. Steps or proof-of-concept code to reproduce the issue.
3. The potential impact (e.g., privilege escalation, unauthorized LAN access).

We aim to acknowledge reports within 48 hours and publish a fix in the next point release.
