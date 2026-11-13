# Track 1 Audit: Project Structure, Path Normalization & Encoding (`chore/project-structure`)

> **STRICT TRACK BOUNDARY (STRUCTURE ONLY)**
> This track covers **ONLY** folder reorganization, file renames, UTF-8/CRLF line-ending normalization, dead legacy file cleanup, and updated import/build/packaging path references across `MainActivity.java` (embedded in `scripts/build_android_app.py`), `scripts/*.py`, launchers, `.env.example`, and `package.json`.
> **DO NOT** alter runtime business logic, binary opcodes, cryptography, WebSocket handlers, HITL checks, or UI state behavior in this branch. Keep wire-level constants/contracts untouched and aligned with [`docs/audit/00-shared-contracts.md`](./00-shared-contracts.md).

---

## 1. Web Component Directory Modularization & Barrel Exports

- **File Path(s):**
  - Base (`72c84a4`): 29 flat files in `apps/web/src/components/*.tsx`, `apps/web/src/App.tsx`, `apps/web/src/store/uiStore.ts`
  - Target structure: `apps/web/src/components/{ai,fleet,layout,modals,settings,telemetry,terminal,wol,ui}/index.ts` and `apps/web/src/components/index.ts`
- **Root Cause:**
  All 29 TSX feature components, modals, charts, and layout wrappers sit flat inside `apps/web/src/components/`, making domain ownership unclear and coupling imports to flat relative filenames. Note `vite.config.ts` (`L12`) also sets `@` alias to `apps/web/` root rather than `apps/web/src/`.
- **Fix Steps:**
  1. Group components cleanly into domain subdirectories (`ai/`, `fleet/`, `layout/`, `modals/`, `settings/`, `telemetry/`, `terminal/`, `wol/`) with barrel `index.ts` files and root `components/index.ts` (keep `00-shared-contracts.md` IPC/WS behavior unchanged).
  2. Update relative imports inside `apps/web/src/App.tsx`, `apps/web/src/store/uiStore.ts`, and moved component files.
  3. Normalize `@` alias in `apps/web/vite.config.ts` if used consistently (verify no import breaks).
- **Exists in `backup/github-pushed-snapshot`?:**
  **Yes** — implemented cleanly in commit `07fdb22` (pure move + import updates). Can be cherry-picked cleanly: `git cherry-pick -n 07fdb22` (reviewing `screenFrameService.ts` and `apps/web/src/` moves; exclude non-structure changes if cherry-picking later commits).
- **Safe Verification Command:**
  ```powershell
  npm run lint
  npm run build
  ```

---

## 2. Mobile Flutter Directory & Library Export Modularization

- **File Path(s):**
  - Base (`72c84a4`): 34 flat Dart files in `apps/mobile/lib/*.dart`, `apps/mobile/lib/main.dart`, `apps/mobile/test/*.dart`, `apps/mobile/integration_test/app_verification_test.dart`
  - Target structure: `apps/mobile/lib/{demo,protocol,security,services,theme,ui}/*.dart` and `apps/mobile/lib/ai_netcontroller.dart`
- **Root Cause:**
  At `BASE_COMMIT` (`72c84a4`), 14 duplicate/superseded screen & theme files (`adaptive_layout.dart`, `adaptive_stream_viewer.dart`, `app_theme_tokens.dart`, `batch_fleet_manager.dart`, `console_detail_view.dart`, `console_screen.dart`, `console_view.dart`, `fleet_master_view.dart`, `fleet_screen.dart`, `fleet_view.dart`, `glass_container.dart`, `glass_pill_nav.dart`, `glass_theme.dart`, `hold_to_confirm_button.dart`, `responsive_scaffold.dart`, `responsive_sidebar.dart`) coexist beside the active files in `apps/mobile/lib/`.
- **Fix Steps:**
  1. Move active Dart modules into domain folders (`demo/`, `protocol/`, `security/`, `services/`, `theme/`, `ui/`) and remove the obsolete unreferenced legacy flat UI files.
  2. Export the modularized libraries from `apps/mobile/lib/ai_netcontroller.dart` (renamed from `cst_netcontroller.dart`, matching `08facb7`) without altering `BinaryOpcode` values (opcode collision fixes live in Track 2 per `00-shared-contracts.md §2`).
  3. Update imports in `apps/mobile/lib/main.dart`, moved Dart files, `apps/mobile/test/binary_protocol_unit_test.dart`, `apps/mobile/test/crypto_channel_unit_test.dart`, and `apps/mobile/integration_test/app_verification_test.dart`.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Yes** — structural moves in commit `07fdb22` and library rename `cst_netcontroller.dart` -> `ai_netcontroller.dart` in `08facb7`.
- **Safe Verification Command:**
  ```powershell
  Push-Location apps/mobile
  flutter analyze
  flutter test test/
  Pop-Location
  ```
  *(Note: `integration_test/app_verification_test.dart` contains Track 2 protocol assertions that wait on Track 2 fixes.)*

---

## 3. Release Directory Renaming, Versioning Paths & Obsolete Script Cleanup

- **File Path(s):**
  - `public/releases/v2.8.0` .. `public/releases/v3.1.0-beta.3` -> `public/releases/v0.28.0` .. `public/releases/v0.31.3`
  - Obsolete scripts to remove: `scripts/bump_version_29.py`, `scripts/package_v290_assets.py`, `scripts/publish_release_v290.py`, `scripts/publish_release_v300.py`, `scripts/publish_release_v310.py`, `scripts/publish_release_v310_beta2.py`, `scripts/publish_release_v310_beta3.py`, `scripts/update_docs_v29.py`, `scripts/verify_releases_v29.py`
  - Obsolete spec / duplicate docs / lockfile: `agent/CST_HostAgent_v2.9.0_win64.spec`, `docs/OPEN_SOURCE_MODELS_ARCH.md`, `docs/PROJECT_GUIDE.md`, `docs/SECURITY_AUDIT_REPORT.md`, `bun.lock`
- **Root Cause:**
  Nine single-version release/bump Python scripts (`*v29*`, `*v300*`, `*v310*`), a legacy `.spec` (`CST_HostAgent_v2.9.0_win64.spec`), duplicate docs, and `bun.lock` (alongside npm `package.json`) clutter the repo and hardcode `v2.9`/`v3.0`/`v3.1` paths after the project standardized on `0.xx.xx` beta versioning and `AI NetController` naming.
- **Fix Steps:**
  1. Rename `public/releases/v2.8.0..v3.1.0-beta.3` folders to `v0.28.0..v0.31.3` and standardize release manifest/doc metadata strings to `AI NetController` (`08facb7`, `08cf5b3`).
  2. Delete the 9 single-version `scripts/*_v29/300/310*.py` scripts, `agent/CST_HostAgent_v2.9.0_win64.spec`, duplicate docs (`ef01161`), and `bun.lock`. Keep unified parameterized `scripts/publish_release.py` (with `--platform` / `--tag`).
  3. Preserve `agent/app_manifest.xml` checked in cleanly (do not add `with open('app_manifest.xml', 'w')` side-effects inside `agent/build_agent.spec`).
- **Exists in `backup/github-pushed-snapshot`?:**
  **Yes** — spread across commits `07fdb22`, `08facb7`, `08cf5b3`, and `ef01161`. Can be cherry-picked carefully (`git cherry-pick -n 07fdb22 08facb7 08cf5b3 ef01161`) while excluding `.gitlab-ci.yml` unless requested.
- **Safe Verification Command:**
  ```powershell
  python -c "import json, glob; [json.load(open(p, encoding='utf-8')) for p in glob.glob('public/releases/*/RELEASE_MANIFEST.json')]; print('Manifests valid')"
  ```

---

## 4. `scripts/build_android_app.py` & Embedded `MainActivity.java` Path/File Separation

- **File Path(s):**
  - `scripts/build_android_app.py` (1,576 lines at `72c84a4`; contains embedded `java_content = r"""package com.cst.autonomouslan; ..."""` starting at `L224`)
  - Target extracted path (Track 1 option): `apps/mobile/android_webview_shell/src/com/cst/autonomouslan/MainActivity.java`
  - Target build output path: keep Android WebView wrapper APK output separate from Flutter's `apps/mobile/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`
- **Root Cause:**
  1. `scripts/build_android_app.py` embeds over 1,100 lines of Java source (`MainActivity.java`) as a raw Python string (`L224+`), making Java syntax highlighting, static analysis, and git diffs unreadable.
  2. At `72c84a4`, lines `17–29` hardcode `SDK_DIR = r"C:\Users\Lenovo\AppData\Local\Android\Sdk"` and JDK paths directly without checking `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `JAVA_HOME` environment variables first.
  3. Lines `62–66` hardcode `public/releases/v3.1.0-beta.1` staging paths instead of resolving dynamically from `package.json` / CLI `--version`.
  4. `distribute_apk()` writes the non-Flutter Java WebView APK directly over Flutter's build path `apps/mobile/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`, masking the Flutter vs Java WebView divergence (see Track 2).
- **Fix Steps:**
  1. Extract verbatim `MainActivity.java` template text (without altering Java runtime/HTTP logic in Track 1) into `apps/mobile/android_webview_shell/src/com/cst/autonomouslan/MainActivity.java` and read it in `scripts/build_android_app.py` (substituting build-time placeholders like version name cleanly).
  2. Check `os.environ.get("ANDROID_HOME")`, `ANDROID_SDK_ROOT`, `JAVA_HOME`, and `shutil.which("javac")` **before** Windows local fallback directories (never hardcode user-specific `C:\Users\Lenovo\...` first).
  3. Resolve `ROOT_DIR` from `os.path.dirname(os.path.dirname(os.path.abspath(__file__)))` and release version dynamically from `package.json`, without changing `/api/*` Java handler logic (deferred to Track 2/3) or `00-shared-contracts.md` framing.
  4. Write the WebView wrapper APK to its own staging/release path (e.g., `apps/mobile/build/webview_apk/`) rather than overwriting Flutter's `flutter-apk/` output.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` updated env-var lookup priority (`L29`, `L61`) and read `package.json` version (`L160`), **but still keeps `MainActivity.java` inline (`L324+`) and still overwrites `flutter-apk/app-arm64-v8a-release.apk`**. Do **not** blindly extract `build_android_app.py` from `7e68a18` in Track 1 because `7e68a18` also modified Java HTTP/bridge logic (Track 2 scope). Extract only the path/env lookup improvements and move `MainActivity.java` cleanly.
- **Safe Verification Command:**
  ```powershell
  python -m py_compile scripts/build_android_app.py
  ```

---

## 5. `scripts/*.py` Path Normalization & Hardcoded Local Paths

- **File Path(s):**
  - `scripts/download_fonts.py` (`L5, L61`)
  - `scripts/measure_baseline.py`
  - `scripts/build_release_binaries.py`
  - `scripts/publish_release.py`, `scripts/publish_github_release.py`, `scripts/publish_gitlab_release.py` (`L80` in snapshot), `scripts/update_release_manifest.py` (`L8–59` in snapshot)
  - `agent/build_agent.spec` (`L47–64, L141–143, L171–173`)
- **Root Cause:**
  1. `scripts/download_fonts.py` uses `os.path.abspath('apps/web/...')` relative to CWD instead of anchoring paths to `__file__`, and writes CSS `url("/fonts/...")` conflicting with `apps/web/vite.config.ts` `base: './'` (`./fonts/`).
  2. `agent/build_agent.spec` uses relative paths that fail if `pyinstaller` is invoked from repo root instead of `agent/`, omits `agent/__init__.py` & `icon_32.png`/`icon_64.png`, and writes to `app_manifest.xml` in-place during build.
  3. `scripts/publish_gitlab_release.py` (`7e68a18` `L80`) hardcodes personal path `r"C:\Users\Lenovo\Documents\antigravity\Ai NetConroller"`; `scripts/update_release_manifest.py` hardcodes `v0.35.0` paths instead of deriving from `package.json`.
  4. Unused imports/variables accumulate alongside legacy release scripts.
- **Fix Steps:**
  1. Anchor `ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))` in `download_fonts.py`, `build_release_binaries.py`, `publish_release.py`, and `update_release_manifest.py` (using UTF-8 `encoding="utf-8"` on all file opens).
  2. In `download_fonts.py` / `apps/web/src/fonts.css` (`public/fonts.css`), normalize font URL paths consistently with Vite `base: './'` (`./fonts/...`) matching where static font files live (`apps/web/public/fonts/`).
  3. In `agent/build_agent.spec`, use `SPECPATH` for every path reference and stop rewriting `agent/app_manifest.xml` during build (only update data/binary asset paths in Track 1; `'email'` exclusion bug and `hiddenimports` runtime fixes are documented in Track 2).
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `download_fonts.py` (`0ccb8ec`), `SPECPATH` in `agent/build_agent.spec` (`7e68a18`), and `./fonts/` in `fonts.css` + `apps/web/public/fonts.css` (`7e68a18`) exist, while `update_release_manifest.py` / `publish_gitlab_release.py` still contain hardcoded version/local paths in `7e68a18`.
- **Safe Verification Command:**
  ```powershell
  python -m py_compile scripts/*.py
  ```

---

## 6. UTF-8 / CRLF Normalization & Launcher Hygiene (`.gitattributes`, `.bat`, `.sh`)

- **File Path(s):**
  - Missing: `.gitattributes` (does not exist at `72c84a4` or `7e68a18`)
  - `START_HERE_WINDOWS.bat`
  - `START_HERE_LINUX.sh`
  - `agent/build_exe.bat`
  - `apps/mobile/build_apk.bat`
  - `apps/mobile/android/gradlew.bat`
  - `agent/sign_binary.ps1`
- **Root Cause:**
  Verified directly on `72c84a4` (and still present on `backup/github-pushed-snapshot`):
  - **Every `.bat` file in the repository is committed with Unix `LF`-only line endings (`crlf=False, lf_only=True`)** and no `.gitattributes` enforces `eol=crlf` for Windows batch/PowerShell scripts or `eol=lf` for `.sh` scripts. Windows `cmd.exe` exhibits label-seek (`goto`) corruption and parsing glitches on LF-only `.bat` files.
  - `START_HERE_WINDOWS.bat` and `agent/build_exe.bat` contain **6 non-ASCII UTF-8 bytes** (`—` em-dash `U+2014`) without switching codepage (`chcp 65001`) or using plain ASCII `--`, causing `cmd.exe` console mojibake (`â€”`).
  - `START_HERE_WINDOWS.bat` references stale `CST_HostAgent.exe` path (`v2.9.0-LTS` banner) instead of unified `AI_NetController_HostAgent.exe` / `public/releases/<version>/` path, and `agent/build_exe.bat` omits `cd /d "%~dp0"` at line 1 so elevated/root-dir invocations run in the wrong CWD.
  - `START_HERE_LINUX.sh` retains `v2.9.0-LTS` / `CST` banner strings (note runtime process/firewall logic fixes stay outside Track 1 or are kept strictly path/banner level here).
- **Fix Steps:**
  1. Add root `.gitattributes`:
     ```gitattributes
     * text=auto
     *.bat text eol=crlf
     *.cmd text eol=crlf
     *.ps1 text eol=crlf
     *.sh text eol=lf
     *.py text eol=lf
     *.ts text eol=lf
     *.tsx text eol=lf
     *.dart text eol=lf
     ```
  2. Convert all `.bat` and `.ps1` files cleanly to CRLF (`\r\n`) and `.sh` / `.py` / `.ts` files to LF (`\n`), removing BOMs where unwanted and replacing non-ASCII punctuation (`—` -> `--`) in `.bat` files so `cmd.exe` renders cleanly under default codepages.
  3. Add `cd /d "%~dp0"` at top of `agent/build_exe.bat` and update renamed executable/script paths (`AI_NetController_HostAgent`, `CST` -> `AI NetController`, `v2.9.0-LTS` -> dynamic/matching version) in both launchers without altering behavioral control flow.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial (branding only)** — `08facb7` & `08cf5b3` updated `CST` -> `AI NetController` in launchers, **but `.gitattributes` does NOT exist and all `.bat` files remain LF-only with UTF-8 `—` bytes even in `7e68a18`**. Must be authored fresh on `chore/project-structure`.
- **Safe Verification Command:**
  ```powershell
  python -c "import glob; bats=glob.glob('**/*.bat', recursive=True); bad=[b for b in bats if b'\r\n' not in open(b,'rb').read() or any(x>=128 for x in open(b,'rb').read())]; print('Bad .bat:', bad); assert not bad"
  ```

---

## 7. `.env.example` Structure & Variable Standardization

- **File Path(s):**
  - `.env.example` (currently 2 lines: `GEMINI_API_KEY=` and `PORT=3000`)
- **Root Cause:**
  Only `GEMINI_API_KEY` and `PORT` are declared. Required configuration keys (`AI_AGENT_SECRET` / `CST_AGENT_SECRET` documented per `00-shared-contracts.md §4` with no hardcoded secret values, `AI_AGENT_PORT`, `HOST`, `ALLOW_LAN_WEB`, `ALLOWED_ORIGINS`, `NODE_ENV`, `GITHUB_TOKEN`, `GITLAB_TOKEN`, `ANDROID_KEYSTORE_PATH`) are undocumented, encouraging developers and code fallbacks to invent ad-hoc variable names.
- **Fix Steps:**
  1. Expand `.env.example` cleanly with empty placeholders (never real tokens or default PSKs), inline comments explaining localhost-first binding and how to generate a random PSK (`openssl rand -hex 24` / Python `secrets.token_hex(24)`).
  2. Ensure both LF line endings and UTF-8 without BOM.
- **Exists in `backup/github-pushed-snapshot`?:**
  **No** — `.env.example` remained 2 lines (`26` bytes) in `7e68a18`. Author fresh in Track 1.
- **Safe Verification Command:**
  ```powershell
  python -c "raw=open('.env.example','rb').read(); assert b'\r' not in raw and not any(s in raw for s in [b'secret_2025', b'CST_SECURE_TOKEN', b'glpat-', b'ghp_']); print('.env.example clean')"
  ```

---

## 8. `package.json` Structure, Scripts & Dependency Classification

- **File Path(s):**
  - `package.json` (`L1-51` at `72c84a4`)
- **Root Cause:**
  1. `name` (`"cst-netcontroller-ai"`) and `version` (`"3.1.0-beta.3"`) use pre-rename metadata (`08facb7` / `08cf5b3`).
  2. Build/dev tools (`vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tsx`, `@types/d3`) sit in `"dependencies"` rather than `"devDependencies"` (note Track 3 removes static `import 'vite'` from `server.ts` production path).
  3. `"preview": "vite preview --config apps/web/vite.config.ts"` omits the `apps/web` root argument (unlike `"build"` on the line above), causing `npm run preview` to fail looking for `./dist` instead of `apps/web/dist`.
  4. `"start"` runs `"tsx apps/web/server.ts"` identically to `"dev"` without `NODE_ENV=production` (note cross-platform `cross-env` or Node wrapper avoids `NODE_ENV=production` shell incompatibility on Windows CMD/PowerShell vs bash).
  5. `"build:releases"` uses `process.exit(res.status ?? 0)`, returning exit code `0` (false pass) when `spawnSync` fails to find `python` (`res.error` set, `res.status === null`).
- **Fix Steps:**
  1. Update `"name": "ai-netcontroller"`, `"version"`, and `"description"` cleanly (from `08facb7`/`08cf5b3`/`7e68a18`).
  2. Fix `"preview": "vite preview --config apps/web/vite.config.ts apps/web"` and `"build:releases"` (`res.error ? 1 : (res.status ?? 1)`).
  3. Move dev-only tooling (`@tailwindcss/vite`, `@types/d3`, `@vitejs/plugin-react`, `vite` — coordinating cleanly with Track 3 dynamic Vite import in `server.ts` or keeping `tsx` documented until production `node` bundle target is added) into `"devDependencies"`.
  4. Document cross-platform `NODE_ENV=production` invocation for `"start"` (e.g., tiny inline `node -e` spawning `tsx` with `{ env: { ...process.env, NODE_ENV: 'production' } }`).
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` updated `"name"`, `"version"`, `"description"`, **but left `"preview"` missing `apps/web`, `"start"` without `NODE_ENV=production`, `"build:releases"` `res.status ?? 0`, and `vite` in `"dependencies"`**.
- **Safe Verification Command:**
  ```powershell
  node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log(p.name, p.version, p.scripts.preview)"
  npm run build
  ```
