# Mandatory Git & Verification Workflow Rules

All future sessions, subagents, and automated workflows working in this repository MUST follow these rules without exception:

1. **Never Commit or Push Directly to `main`**
   - Always work on a scoped `chore/*` or `fix/*` branch created from a clean base. Direct commits or direct pushes to `main` are forbidden.

2. **Never Run `git push` Unless Explicitly Instructed in the User's Current Prompt**
   - Commit verified work locally on the active feature branch and stop so the user can review before pushing or opening a PR.

3. **Never Mix Directory Restructuring With Bug Fixes or Feature Logic in the Same Branch**
   - Keep `chore/project-structure` strictly limited to folder moves, file renames, UTF-8/CRLF normalization, and import/build path updates.
   - Keep runtime bug fixes, protocol alignment, and security hardening separated on their dedicated fix branches (`fix/agent-and-crypto`, `fix/web-core-and-ui`).

4. **Read `@docs/audit/00-shared-contracts.md` Before Modifying Any Wire Opcode, Auth Handshake, or Crypto Logic**
   - [`docs/audit/00-shared-contracts.md`](../../docs/audit/00-shared-contracts.md) is the canonical cross-stack contract across Python, TypeScript, and Dart. Do not invent new opcodes, alter framing headers, relax trailing-byte/auth checks, or change nonce/replay rules without consulting it first.

5. **Never Run Tests That Mutate the Host Windows Registry, Shortcuts, or System State Unless OS Calls Are Mocked**
   - In particular, `agent/tests/test_windows_integration.py` and `agent/tests/test_installer_and_branding.py` (or any test invoking `winreg`, `CreateShortcut`, `taskkill`, or `perform_full_uninstall()`) MUST NOT be executed against a real Windows host unless all registry, filesystem, and process calls are mocked or isolated inside temporary test fixtures.
