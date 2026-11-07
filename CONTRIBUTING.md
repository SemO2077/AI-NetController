# Contributing to AI NetController

Contributions, bug reports, and feature requests are welcome. This guide covers how to set up your development environment and submit changes.

---

## Development Setup

### Prerequisites
- **Node.js**: v20.x or newer
- **Python**: v3.11 or newer
- **Android SDK** (optional): Build-Tools 35.0.0 and Platform 34 for building the Android `.apk`

### Install Dependencies
```bash
git clone https://github.com/smehmedd/AI-NetController.git
cd AI-NetController
npm install
pip install -r agent/requirements.txt
```

---

## Project Layout

- `agent/` — Python Windows/Linux Host Agent (`agent.py`, `agent_gui.py`, `command_ast_firewall.py`, `tests/`)
- `apps/web/` — Express server (`server.ts`) and React 19 frontend (`src/`)
- `apps/mobile/` — Flutter client (`lib/`) and Native Android builder (`scripts/build_android_app.py`)
- `scripts/` — Build and verification scripts

---

## Running Checks Before Submitting a PR

Please make sure all checks pass locally before opening a pull request:

```bash
# 1. TypeScript compiler check
npm run lint

# 2. Frontend & server test suites
npm test

# 3. Python Host Agent unit tests
python -m unittest discover -s agent/tests
```

---

## Pull Request Guidelines

1. Create a feature branch from `main` (e.g., `git checkout -b feat/wol-schedule` or `fix/firewall-rule`).
2. Keep commits focused and write clear commit messages (`feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`).
3. Do not commit API keys, `.env` files, or local database files (`*.db`).
4. Update relevant tests if you modify telemetry parsing, security rules, or API routes.
