# Contributing to AI NetController

Thank you for your interest in contributing to **AI NetController**. This guide outlines the development workflow, coding standards, and testing procedures required for submitting contributions.

---

## 1. Development Environment Setup

### Prerequisites

| Tool | Version Requirement | Purpose |
| :--- | :--- | :--- |
| **Node.js** | v20.0.0 or higher | Web Console, Express server, and frontend tooling |
| **npm** | v10.0.0 or higher | Node package manager |
| **Python** | v3.11 or higher | Windows Host Agent daemon and scripts |
| **Android SDK** (Optional) | Platform 34, Build-Tools 35.0.0 | Native Android APK compilation |
| **JDK** (Optional) | JDK 17 or higher | Android DEX compilation and APK signing |

### Clone and Installation

```bash
git clone https://github.com/SemO2077/AI-NetController.git
cd AI-NetController

# Install Node.js dependencies
npm install

# Install Python agent dependencies
pip install -r agent/requirements.txt
```

---

## 2. Repository Layout

```text
AI-NetController/
├── .github/workflows/ci.yml       # GitHub Actions automated CI workflow
├── agent/                         # Python Host Agent source code
│   ├── agent.py                   # Main daemon and WebSocket server
│   ├── agent_daemon.py            # Background service and tray integration
│   ├── agent_gui.py               # Tkinter desktop GUI
│   ├── command_ast_firewall.py    # Command parser and process supervisor
│   ├── crypto_handshake.py        # Authentication handshake
│   ├── crypto_vault.py            # DPAPI credential store
│   ├── daemon_config.py           # Host configuration manager
│   ├── host_file_writer.py        # Chunked file writer
│   ├── multi_monitor_streamer.py  # Screen capture engine
│   ├── network_fuzzer_shield.py   # Frame validator and rate limiter
│   ├── windows_integration.py     # Registry autorun and Job Objects
│   └── tests/                     # Agent unit and security tests
├── apps/
│   ├── web/                       # Control server and React dashboard
│   │   ├── server.ts              # Express API server
│   │   ├── src/                   # React components and Zustand stores
│   │   └── src/tests/             # Pillar tests and stress benchmarks
│   └── mobile/                    # Android companion application
├── docs/                          # Technical setup and compilation guides
├── public/releases/               # Versioned binaries and release manifests
└── scripts/                       # Packaging and release automation scripts
```

---

## 3. Pre-Submission Verification

Before submitting a Pull Request, all automated checks must pass locally without warnings or errors.

### Static Analysis and Type Checking
```bash
npm run lint
```

### Frontend and Architectural Verification Suites
```bash
npm test
```
*Ensures all 40 verification pillars and 23 performance stress benchmarks pass.*

### Python Host Agent Test Suite
```bash
python -m unittest discover -s agent/tests
```
*Ensures all 73 agent unit, security, and edge-case tests pass.*

### Production Build Verification
```bash
npm run build
```

---

## 4. Pull Request Workflow

1. **Create a Feature Branch**:
   Create a branch off `main` with a descriptive name:
   ```bash
   git checkout -b feat/directed-wol-subnet
   # or
   git checkout -b fix/ast-caret-parsing
   ```

2. **Commit Hygiene**:
   Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
   - `feat: add IPv6 support to UDP WoL broadcaster`
   - `fix: resolve race condition in token bucket rate limiter`
   - `docs: update compilation guide with JDK 21 notes`
   - `test: add unit test for sliding-window anti-replay bitmap`
   - `refactor: optimize binary frame unpack allocation path`

3. **Security Standards**:
   - Never commit sensitive tokens, `.env` files, private keys, or credentials.
   - Do not bypass input sanitization or firewall verification rules.
   - Any new command execution paths must integrate with `CommandASTFirewall`.

4. **Submit a Pull Request**:
   - Push your branch to GitHub:
     ```bash
     git push origin feat/directed-wol-subnet
     ```
   - Open a Pull Request targeting `main` on [GitHub](https://github.com/SemO2077/AI-NetController/pulls).
   - Provide a clear summary of changes, motivation, and test verification output in the PR description.
