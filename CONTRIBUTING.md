# Contributing to AI NetController

Contributions across the Python host agent, React/Express web console, and Flutter mobile client are welcome on both [GitHub](https://github.com/SemO2077/AI-NetController) and [GitLab](https://gitlab.com/ryu-group7483245/ai-netcontroller).

## Development Environment

- **Node.js**: `>= 20.0.0` (`npm >= 10.0.0`) for `apps/web/`
- **Python**: `>= 3.11` (Windows recommended for Job Object isolation and Win32 integration tests)
- **Flutter**: `>= 3.29.0` (`Dart >= 3.7.0`) for `apps/mobile/`

## Workflow

1. Fork the repository on GitHub or GitLab and clone your fork.
2. Create a topic branch from `main` (e.g., `fix/wol-subnet-parsing` or `feat/display-selector`).
3. Keep wire protocol definitions (`0xC5 0x71`, opcodes, AEAD headers, and HITL contracts in [`docs/PROTOCOL.md`](docs/PROTOCOL.md)) synchronized across Python (`agent/`), TypeScript (`apps/web/`), and Dart (`apps/mobile/`).
4. Run the verification suites before opening a Pull Request or Merge Request:

```bash
# Web console & server
npm run lint
npm test
npm run build

# Python Host Agent
pip install -r agent/requirements.txt
python -m unittest discover -s agent/tests -v

# Flutter Mobile Companion (requires Python with agent/requirements.txt on PATH for E2E daemon test)
cd apps/mobile
flutter analyze
flutter test test/
```

## Code & Security Standards

- **No static secrets**: Never introduce hardcoded fallback PSKs, pairing PINs, or unauthenticated control routes.
- **Fail-closed security gates**: Dangerous or obfuscated shell inputs blocked by `CommandASTFirewall` must remain rejected unconditionally; `OP_HITL` challenges must never accept unsigned approvals.
- **Cross-platform paths**: Use normalized repo-relative paths in scripts and CI workflows; do not commit machine-local filesystem paths or generated artifacts.

## Reporting Security Issues

If you discover a vulnerability in authentication, encryption, command sandboxing, or WebView/API bindings, please avoid posting proof-of-concept tokens publicly and report it via a private security issue or maintainer contact first.
