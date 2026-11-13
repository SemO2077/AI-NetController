# Track 3 Audit: Web Core, Backend Server, CSS & UI (`fix/web-core-and-ui`)

> **Scope & Cross-References**
> Covers TypeScript core workers/hooks/stores/services, Vite/HTML/CSS/fonts, Express server (`apps/web/server.ts`), and all 31 React UI components & modals under `apps/web/src/components/`.
> **Prerequisite**: Read [`docs/audit/00-shared-contracts.md`](./00-shared-contracts.md) before altering WebSocket opcodes, auth flows, PSK handling, or HITL gates.
> **Cherry-pick Note**: Commit `7e68a18` in `backup/github-pushed-snapshot` touched **98 files** across all tracks. Do **NOT** whole-commit cherry-pick `7e68a18`; inspect/extract targeted paths cleanly after Track 1 structure lands (`git show backup/github-pushed-snapshot:<path>`).
> **Path Mapping Note**: On base `chore/audit-setup` (`72c84a4`), components live flat at `apps/web/src/components/*.tsx` and fonts CSS is at `apps/web/src/fonts.css`. Track 1 (`chore/project-structure`) moves components into domain folders (`ai/`, `fleet/`, `layout/`, `modals/`, `settings/`, `telemetry/`, `terminal/`, `wol/`, `ui/`). Both are referenced clearly below.

---

## Part A — Core Workers, Hooks, Stores, Services & Utils

### 1. `apps/web/src/workers/networkWorker.ts` — Dead Heartbeat Watchdog, Pre-Auth Flush & Secret Hardcode
- **File Path(s):** `apps/web/src/workers/networkWorker.ts` (`L28-36, L114-208, L256-324, L364-394, L486-677` at `0ccb8ec`)
- **Root Cause:**
  1. **Dead Heartbeat Watchdog (`L183-208`)**: `startHeartbeat()` sets `setInterval(sendPing, 2000)`, and `sendPing()` clears `pongTimeoutTimer` before scheduling a `2200ms` timeout (`2000 < 2200`). The timeout is always cleared 200ms before it can fire, making `'degraded'` / `'unresponsive'` unreachable dead code!
  2. **Uncorrelated PONG & Reconnect Drift**: `handlePongReceived` never matches PONG `seq` against the pending PING (`under-reporting` RTT on delayed PONGs); `MAX_RECONNECT_ATTEMPTS = 3` contradicts `Ceiling after 8 attempts` comment; timeout calls `socket.close(1000)` instead of abnormal/heartbeat close.
  3. **Hardcoded Secret & Pre-Auth Send (`L298-316, L486`)**: Fell back to `'ai_netcontroller_secret_2025'`; transmitted raw JSON `token` over `ws://`, marked `STATUS: 'connected'` immediately in `ws.onopen`, and flushed `outboundQueue` *before* receiving `OK_AUTHENTICATED`.
  4. **Anti-Replay Bypass & Trailing Bytes**: Skipped `verifyInboundSequence` when `seq === 0` or `OP_HITL` (`00-shared-contracts.md §3.2`); `parseBinaryFrame` lacked exact `bytes.length !== HEADER_SIZE + length` + `MAX_PAYLOAD_SIZE` checks; `activeProtocolMode` flapped per message; `payload.token || currentToken` prevented clearing tokens; `Number(payload.opcode || 0x04)` corrupted `0x00`; raw Bulgarian strings in worker errors.
- **Fix Steps:**
  1. Track pending `{ seq, sentAt }` (or deadline check `< interval` / elapsed threshold) so `pongTimeoutTimer` actually fires on missed PONGs and `handlePongReceived` verifies `seq`.
  2. Remove hardcoded secret fallback (`00-shared-contracts.md §4`), wait for `OK_AUTHENTICATED` before setting `'connected'` and flushing `outboundQueue` (`§3.1`), add HMAC challenge-response + `replayBitmap` check on `seq >= 1` (`§3.2`), enforce `bytes.length === 12 + length` & `MAX_PAYLOAD_SIZE`, align `OP_DISPLAY_ENUM = 0x0D` / `OP_FRAME_SYNC = 0xED` / `OP_ERR = 0xEE` (`§2`), and import shared framing helpers instead of duplicating logic.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` removed the hardcoded secret, added pure-JS SHA-256/HMAC fallback (`L467, L521`), added RFC 6479 `replayBitmap` (`L49-72`), `OP_DISPLAY_ENUM` (`L675`), `OP_FRAME_SYNC = 0xED` (`L595, L683`), and exact frame length checks. Verify `pongTimeoutTimer` timing math (`startHeartbeat` vs timeout period), `seq === 0` bypass removal, and `activeProtocolMode` stability carefully on extraction.
- **Safe Verification Command:**
  ```powershell
  npm run lint
  npm run test
  ```

### 2. `apps/web/src/hooks/useWorkerEngine.ts` & `apps/web/src/store/screenStore.ts` — Inverted HITL Gate & Blob Race
- **File Path(s):** `apps/web/src/hooks/useWorkerEngine.ts` (`L105-255, L296, L382-490, L526-555`), `apps/web/src/store/screenStore.ts` (`L10-24`)
- **Root Cause:**
  1. **INVERTED HITL GATE (`L382`)**: `if (verdict.requiresHoldConfirmation && !isConnected)` **skipped** client-side HITL confirmation whenever the WebSocket *was* connected, only triggering it when offline (`00-shared-contracts.md §5`)!
  2. **Quarantine Bypass (`L296`)**: `!cmd.prompt.toLowerCase().includes('status')` allowed bypassing host quarantine by appending `# status`.
  3. **Stripped Command Metadata (`L397-407`)**: `EXECUTE_PROMPT` omitted `cmd.target_id` and `cmd.command_type`; `JSON_FRAME` ignored `ERROR` (leaving `isSendingCommand` stuck `true`), `AUTHENTICATED`, `CLIPBOARD_SYNC`, and `LLM_STREAM`; circuit breaker applied to `targetIdRef.current` instead of `data.target_id`.
  4. **State/Blob/Memo Bugs**: `METRICS` hardcoded `status: 'healthy'` and coerced `null` RTT to `minLatencyMs: 0`; `disconnect()` omitted resetting `isSendingCommand`/`isCapturingScreen`/`heartbeatStatus`/`activeHitlEvent`; `requestScreenRefresh` sent hardcoded `{ width: 1280, height: 720 }` via `0x0A` every `500ms`; unmount revoked `currentBlobUrlRef.current` without clearing `screenStore.screenBase64` (`blob:` race with `ScreenViewerModal`); volatile memos re-bound `App.tsx` global key listeners every 2s.
  5. **HITL Signing Gap**: Remote `HITL_RESPONSE` sends `{ approved }` without the HMAC `signature` required by hardened `agent.py:1886` under non-strict mode (`00-shared-contracts.md §5`).
- **Fix Steps:**
  1. Change HITL guard to `if (verdict.requiresHoldConfirmation)` (`00-shared-contracts.md §5`) and lock quarantine bypass to strict exact allowlist.
  2. Include `target_id` & `command_type` in `EXECUTE_PROMPT`, handle `ERROR` to clear `isSendingCommand`, reset all transient state in `disconnect()`, clear `useScreenStore` on unmount/revocation, sign HITL responses via worker/session HMAC when required, and send real viewport dimensions via `ResizeObserver` instead of `500ms` `1280x720` polling.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed the inverted HITL gate (`L410: if (verdict.requiresHoldConfirmation)`); `target_id`/HITL HMAC signing/blob cleanup/memo churn still require full fix.
- **Safe Verification Command:**
  ```powershell
  npm run lint
  ```

### 3. `apps/web/src/store/uiStore.ts` — Fictional AI Model Names & Default Language
- **File Path(s):** `apps/web/src/store/uiStore.ts` (`L93-119`)
- **Root Cause:**
  `getInitialModel` / default model rewrote valid Gemini models (`gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-2.5-flash`) to fictional `'gemini-3.8-flash'` / `'gemini-3.1-flash-lite'`, causing Gemini API requests to fail and fall back to regex replies. `getInitialLanguage()` also fell back to `'bg'` for non-Bulgarian browsers (`navigator.language === 'en-US'`).
- **Fix Steps:**
  1. Replace fictional `'gemini-3.8-flash'` / `'gemini-3.1-flash-lite'` with real valid Gemini model IDs (`'gemini-2.5-flash'`, `'gemini-2.5-pro'`, `'gemini-2.0-flash'`).
  2. Default non-`bg*` browsers to `'en'` in `getInitialLanguage()`.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` changed the fallback returns (`L114, L119`) to `'gemini-2.5-flash'`, **but left `'gemini-3.8-flash'` and `'gemini-3.1-flash-lite'` inside the allowlist check at `L111-112`**. Clean completely.
- **Safe Verification Command:**
  ```powershell
  npm run lint
  ```

### 4. `apps/web/src/hooks/useFleetState.ts`, `apps/web/src/App.tsx`, `securityService.ts`, `wolService.ts`, `utils/*`, `i18n/*`, `data/*`, `tests/*`
- **File Path(s):**
  - `apps/web/src/hooks/useFleetState.ts`, `apps/web/src/App.tsx`
  - `apps/web/src/services/{securityService,wolService,screenFrameService,hapticService}.ts`
  - `apps/web/src/utils/{binaryFramer,viewportScale,heartbeatRingBuffer,ringBuffer,clipboard}.ts`
  - `apps/web/src/i18n/{translations,useTranslation}.ts`, `apps/web/src/store/{logStore,wolHistoryStore}.ts`
  - `apps/web/src/constants/commandPresets.ts`, `apps/web/src/data/{mockHosts,codeSnippets,enterpriseSnippets}.ts`
  - `apps/web/src/tests/{verifyPillars,stressTest}.ts`
- **Root Cause:**
  1. **`App.tsx`**: `syncAgentWithHost` didn't call `agent.connect()` on host switch; QR auto-pairing dropped `pairPort`; `?pair_token=` URL query parameter leaked credentials into history/logs (`00-shared-contracts.md §4`); `qolToast` (`z-[88]`) was occluded by `unreachableAlert` (`z-[90]`); passed `screenBase64={null}` to `CommandTerminal`.
  2. **`useFleetState.ts`**: Forced reset broke tag selectors (`"[Windows]"`); `updateHostTelemetry` omitted `lastSeen`/`specStatus`/IP-ID matching and fabricated `ping ?? 4`; `scanMdns` dropped duplicate `'00:00:00:00:00:00'` hosts and didn't refresh existing hosts; `sendWolPacket` logged success before validation and dropped `secureOn`; `deleteHost` called `setSelectedTarget` inside `setHosts` updater (`StrictMode` impure); no background scheduler executed `wolSchedules`.
  3. **`securityService.ts` & `wolService.ts`**: `shel32` typo; missing `/s` regex flag; FIFO cache; plaintext `localStorage` auth token (`cst_auth_token_v1`); `wolService` `'Wake Lab PCs (08:00 AM)'` mismatch; `parseSixHexBytes` skipped non-hex garbage accepting invalid MACs; `calculateNextRun` floored `<60s` to `0m`.
  4. **`binaryFramer.ts`, `viewportScale.ts`, `ringBuffer.ts`, `i18n/`, `data/`, `tests/`**: `binaryFramer.ts` aliased `OP_PONG = 0x02` (`OP_TELEMETRY`) and mutated shared `SCRATCH_HEADER`/`POOL_CONTROL_BUFFER`; `viewportScale.ts` `isShortLandscape` shadowed `isUltrawide`, `recommendedFleetColumns` contradicted CSS grid, and `computeContainedScreenRect` was unused by `ScreenViewerModal`; `ringBuffer.ts` missed `NaN` in `capacity <= 0`; `translations.ts` had 78 unused keys while hooks/modals hardcoded inline BG strings & `logStore` hardcoded `'bg-BG'`; `commandPresets.ts` marked reboot/sleep non-destructive; `codeSnippets.ts` shipped 138KB of wrong opcodes (`OP_ERR=8, OP_VIEWPORT_RESIZE=9`); `screenFrameService.ts` held dead sim types; `verifyPillars.ts`/`stressTest.ts` tested local inline re-implementations instead of real modules.
- **Fix Steps:**
  1. Connect active WS on host switch (`agent.connect`), store `pairPort`, replace `?pair_token=` query params with URL `#` fragments or short-TTL OTP (`00-shared-contracts.md §4`), fix banner z-index/stacking.
  2. Fix `useFleetState.ts` (`ping ?? null`, MAC dedup edge case, pure state updates, `secureOn` forwarding, server-backed WoL scheduler).
  3. Fix `binaryFramer.ts` (`00-shared-contracts.md §1–2`: remove `OP_PONG = 0x02`, eliminate shared mutable pools), wire `computeContainedScreenRect`, fix `securityService.ts` (`shell32`, `/s`) & `wolService.ts` strict hex parsing, move test fixtures to `tests/fixtures/`, replace `codeSnippets.ts` static snapshots with `/api/source-files`, and import real modules in `verifyPillars.ts`/`stressTest.ts`.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `agent.connect()` in `App.tsx` (`L196`), removed `ping ?? 4` & added `cleanMac.length !== 12` in `useFleetState.ts`, fixed `wolService.ts` `'Morning Schedule'`, and added `codeSnippets` updates. **Still unfixed in `7e68a18`**: `?pair_token=` in `App.tsx`, `shel32` typo (`securityService.ts:46`), `OP_PONG = 0x02` (`binaryFramer.ts:21`), `TEST_WOL_SCHEDULES` in runtime (`wolService.ts:8`), unused `computeContainedScreenRect`.
- **Safe Verification Command:**
  ```powershell
  npm run lint
  npm run test
  ```

---

## Part B — CSS, Fonts, PWA Config & Backend Server

### 5. `apps/web/src/index.css` & `apps/web/src/fonts.css` — Specificity Override & Cyrillic Font Gaps
- **File Path(s):**
  - `apps/web/src/index.css` (`L7-10, L74, L282-334, L662-668`)
  - `apps/web/src/fonts.css` (moved/copied to `apps/web/public/fonts.css` in `7e68a18`)
- **Root Cause:**
  1. **CSS Specificity Override Bug (`index.css`)**: `:root, :root[data-accent="cyan"]` (`L7-8` / `L10,74`) has specificity **`0,2,0`** (and circular `rem` inside `:root { font-size: clamp(13.5px, 0.85rem + 0.22vw, 16px) }`), which **overrides all 8 responsive `@media` `:root { font-size: ... }` breakpoints at `L279-334` (`0,1,0`)** whenever the default `cyan` accent is active!
  2. `:root[data-glass="frosted"] .glass-liquid` uses `!important` with flat opaque `#0c1220` fill instead of translucent glass.
  3. **Cyrillic Font Gap (`fonts.css`)**: `Plus Jakarta Sans` (`L323-441`) ONLY defines `cyrillic-ext`, `latin-ext`, and `latin` `@font-face` blocks — **missing `/* cyrillic */` (`U+0400-045F`) ranges completely**, causing Bulgarian/Cyrillic headings (`h1`/`h2`/`font-display`) to fall back to generic system sans fonts! Meanwhile `/fonts/*.woff2` root-relative URLs failed under `vite.config.ts` `base: './'`.
- **Fix Steps:**
  1. Move `font-size` out of `:root[data-accent="cyan"]` onto plain `:root` (specificity `0,1,0`), replace circular `0.85rem` on `:root` with `%`/`vw`/`px`, and wrap default `:root` before the responsive `@media` rules so breakpoints win cleanly.
  2. Download & declare `Plus_Jakarta_Sans_cyrillic_{500,600,700,800}_normal.woff2` with `unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;` in `fonts.css` and use `./fonts/*.woff2` URLs.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `./fonts/` relative URLs (`apps/web/public/fonts.css`), **but BOTH the `:root[data-accent="cyan"]` specificity bug (`index.css:7-8`) AND the missing `Plus Jakarta Sans` `/* cyrillic */` blocks (`fonts.css:324-441`) remain unfixed in `7e68a18`!**
- **Safe Verification Command:**
  ```powershell
  npm run build
  ```

### 6. `apps/web/index.html`, `apps/web/public/manifest.json`, `apps/web/vite.config.ts`
- **File Path(s):** `apps/web/index.html`, `apps/web/public/manifest.json`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`
- **Root Cause:**
  1. `index.html`: `user-scalable=no` blocks accessibility zoom; deprecated `apple-mobile-web-app-capable`; external Google Fonts `<link>` breaks air-gapped LAN setups; `/manifest.json`, `/icon-192.svg`, `/src/main.tsx` conflict with `base: './'`; `bg-[#050811]` conflicts with CSS `#030712`.
  2. `manifest.json`: root-relative `start_url`/`src` fail under subpath hosting; locks `portrait-primary`; uses `"purpose": "any maskable"` without 192/512 PNG icons.
  3. `vite.config.ts`: `@` alias points to `apps/web/` instead of `apps/web/src/`; hardcoded `hmr: false` disables dev HMR unconditionally.
  4. `main.tsx`: suppresses `@vite/client` unhandled rejections even in production.
- **Fix Steps:**
  Remove `user-scalable=no` & external CDN fonts link, align `./` relative paths across `index.html` and `manifest.json`, add PNG icons, point `@` alias to `apps/web/src/`, gate `hmr` on `DISABLE_HMR`, and guard `@vite/client` suppression behind `import.meta.env.DEV`.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` modified `index.html` & `manifest.json`; verify `user-scalable`, CDN link removal, `vite.config.ts` `@` alias & `hmr` cleanly.
- **Safe Verification Command:**
  ```powershell
  npm run build
  ```

### 7. `apps/web/server.ts` — Auth, RCE/Firewall Bypass, SSRF, Fake Daemon & Fake PC Control
- **File Path(s):** `apps/web/server.ts` (2,541 lines at `0ccb8ec` / 2,797 lines in `7e68a18`)
- **Root Cause:**
  1. **Security Issues (`0ccb8ec`)**: Bound `0.0.0.0` with **zero authentication** on all `/api/*` endpoints; `/api/command/execute` accepted client `"confirmed": true` (`L1649`) to bypass HITL and ran local `exec()` on the Node host instead of the target agent; `/api/chat` `autoExecute=true` triggered OS shell execution on prompt injection; `inspectCommandSecurity` missed redirection (`>`), `${IFS}`, backslashes, inline code (`python -c`), and `GITLAB_TOKEN`/`GL_TOKEN` scrubbing; hardcoded `'cst_autonomous_lan_secret_2025'` fallback (`L580`); exposed `pairingPin`/`pairingToken` on unauthenticated GET routes & batch file interpolation (`&`/`|`/`%`); permissive `*.run.app` CORS; SSRF missing RFC1918/CGNAT/ULA/`dns.lookup` & `ollama` bypass; unvalidated `/api/wol` unicast UDP destinations.
  2. **100% Simulated/Fake Functionality (`0ccb8ec`)**: `executePcControlAction` faked all mouse/keyboard/capture actions in RAM; `pcDaemonState` (`isRunning: true`, `avIntegrity`, `toggle_autostart`, `update_port`, `blacklist_client`) was disconnected from Python `agent.py`; `/api/update/*` & `/api/ai/models/test` returned fabricated progress and random `15–40ms` latencies; `/api/hosts/scan` forced self online via `|| snap.isRunning` with hardcoded `ping: 1` / `ping: 4` and `os: 'windows'`.
  3. **Bugs**: `rotate_token` reverted from `config.json`; `rebuild` crashed on unguarded `JSON.parse` & 25s timeout; `req.body` destructuring crashed on empty bodies; unknown `/api/*` returned SPA HTML instead of JSON `404`; static `import vite` ran even in production.
- **Fix Steps:**
  1. Enforce loopback-first bind (`127.0.0.1` unless `ALLOW_LAN_WEB`), explicit `ALLOWED_ORIGINS` CORS, CSPRNG token auth (`requireControlAuth` + non-loopback session token rather than blind LAN bypass), DNS/CIDR-enforcing SSRF filter, and subnet-broadcast/port validation on `/api/wol`.
  2. Remove local shell `exec()` and client `"confirmed": true` bypass (`00-shared-contracts.md §5`); forward commands/PC-control/daemon actions to the authenticated Python `agent.py` WebSocket / IPC channel (or return explicit `503`/`501` if disconnected); run real HTTP/Ollama probes for `/api/ai/models/test`, `/api/update/*`, and `POST /api/hosts/scan` (real RTT + OS); load `vite` dynamically in dev mode only.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Yes (significantly improved in `7e68a18`)** — `7e68a18` added `requireControlAuth` (`L399`), `127.0.0.1` default bind (`L27`), `ALLOWED_ORIGINS` (`L75`), removed hardcoded `'ai_netcontroller_secret_2025'`, added JSON `404` catch-all (`L2763`), and wired real daemon bridge/probes. Audit `requireControlAuth` (`isLoopbackIp`), SSRF DNS checks, and persistent WoL scheduler carefully when extracting `apps/web/server.ts`.
- **Safe Verification Command:**
  ```powershell
  npm run lint
  npx tsx -e "console.log('server syntax check requires isolated start or tsc --noEmit')"
  ```

---

## Part C — UI Components & Modals (`apps/web/src/components/`)

> *(Cross-check [`02-agent-and-crypto.md §13`](./02-agent-and-crypto.md#13-viewport_stream_widgetdart--pre-auth-bypass-trailing-bytes--hardcoded-secret) for Flutter's `ViewportStreamWidget` pre-auth bypass, which shares the exact `OP_AUTH`/`OP_FRAME` fail-closed contract with `ScreenViewerModal.tsx` below.)*

### 8. `ai/GeminiChatbot.tsx`
- **File Path(s):** `apps/web/src/components/ai/GeminiChatbot.tsx` (`72c84a4`: `apps/web/src/components/GeminiChatbot.tsx`)
- **Root Cause:**
  1. Dead props `onSendWol` and `onSelectHost` declared (and passed by `App.tsx`) but never destructured (`L86-87, L104-117`).
  2. Clearing chat history called `localStorage.removeItem`, immediately overwritten by `[messages]` `useEffect` persisting `[fresh]`.
  3. `handleExecuteActionItem` (`L546-578`) **double-dispatched** via BOTH WS (`onSendCommand`/`onSendInputOpcode`) AND HTTP `fetch('/api/pc-control/execute')`, fell back to `primaryHost` instead of `action.target`, ignored `!res.ok`, and swallowed errors.
  4. `executionResults` shape mismatch (`Array.isArray(data.executionResults)` checked against server's `Record<string, any>` object!) marked failed WoL actions as `isSuccess = true` (`L731-735`).
  5. Stale closure in `pendingChatPrompt` `useEffect` (`handleSendMessage` missing from deps).
- **Fix Steps:**
  Destructure `onSendWol` & `onSelectHost`, guard clear-history persistence cleanly, route live actions via WS *or* authenticated HTTP (never both) with real `!res.ok` error display, index `data.executionResults?.[act.id]` defaulting falsy on missing result, and stabilize `handleSendMessage` via `useCallback`/ref.
- **Exists in `backup/github-pushed-snapshot`?:**
  **No** — verified in `7e68a18`: `Array.isArray(data.executionResults)` (`L761`), dead `onSendWol`/`onSelectHost` (`L87-88`), and dual WS + `/api/pc-control/execute` (`L571`) are **still unfixed in `7e68a18`**.
- **Safe Verification Command:**
  ```powershell
  npm run lint
  ```

### 9. `fleet/FleetDashboard.tsx` & `fleet/HostCard.tsx`
- **File Path(s):**
  - `apps/web/src/components/fleet/FleetDashboard.tsx` (`72c84a4`: `components/FleetDashboard.tsx`)
  - `apps/web/src/components/fleet/HostCard.tsx` (`72c84a4`: `components/HostCard.tsx`)
- **Root Cause:**
  1. `FleetDashboard.tsx`: dead `onSendWol` prop (`L50`); started 45-second `setWakingCountdown` immediately on opening `WolModal` before any Magic Packet was sent (`L331-334`); omitted `language` argument in latency sort `getLatencyConfig(a.ping, a.isOnline, a.id)`.
  2. `HostCard.tsx`: dead `onInspectWolPacket` prop (`L49`); uncleaned `setTimeout`s (`L188-218`); showed `"Sent"` indicator even without `onQuickCommand`; `Flush DNS` ran destructive `wsreset.exe` and `Restart Host` ran reboot in 1 click without confirmation; invalid nested `<button>` inside `<div role="button">` (`L312-375`); drew minimum `4%` filled bar when CPU/RAM = `0%` (`L546, L569`); hardcoded `ws://` URI (`00-shared-contracts.md §3.3`); incomplete `React.memo` comparator.
- **Fix Steps:**
  Start `wakingCountdown` strictly inside a confirmed packet-sent callback, pass `language` to `getLatencyConfig`, fix `HostCard` interactive semantics (replace outer `role="button"` wrapper), remove `wsreset.exe`, gate `Restart Host` behind confirmation, render `0%` bar when value is `0`, track & clear feedback timers on unmount, and update `React.memo`.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` fixed `wsreset.exe` and `role="button"` in `HostCard.tsx`, **but premature `setWakingCountdown` (`FleetDashboard.tsx:334`), dead `onSendWol`/`onInspectWolPacket`, omitted `language` (`L439`), and `Math.max(4, ...)` bars (`HostCard.tsx:551,574`) remain unfixed in `7e68a18`**.
- **Safe Verification Command:**
  ```powershell
  npm run lint
  ```

### 10. `terminal/CommandTerminal.tsx`, `terminal/CommandOmnibar.tsx` & `telemetry/NetworkTopologyGraph.tsx`
- **File Path(s):**
  - `apps/web/src/components/terminal/CommandTerminal.tsx` (`72c84a4`: `components/CommandTerminal.tsx`)
  - `apps/web/src/components/terminal/CommandOmnibar.tsx` (`72c84a4`: `components/CommandOmnibar.tsx`)
  - `apps/web/src/components/telemetry/NetworkTopologyGraph.tsx` (`72c84a4`: `components/NetworkTopologyGraph.tsx`)
- **Root Cause:**
  1. `CommandTerminal.tsx`: unused `screenBase64`/`onRefreshScreen`/`isCapturingScreen` props (`L35-37`); attributed global execution results using local `lastSubmittedPromptRef.current` (mislabelling commands initiated from `HostCard`, `CommandOmnibar`, or `GeminiChatbot`); `dedupKey` could collide within 1s; dispatched natural-language prose via JSON `EXECUTE_PROMPT`.
  2. `CommandOmnibar.tsx`: imported `DEMO_PRESET_COMMANDS` (`L17`); omitted `onSendWolDirect` from `filteredItems` `useMemo` deps; mutated `document.body.style.overflow`.
  3. `NetworkTopologyGraph.tsx`: included `selectedHostId` inside `topologySignature` (`L92-101`), forcing the entire D3 `forceSimulation` to reset & re-scatter nodes on every click; injected a synthetic hardcoded gateway `'cst-gateway'` (`192.168.1.1`) in `0ccb8ec`.
- **Fix Steps:**
  Correlate terminal logs by returned `command_id` / `command` rather than `lastSubmittedPromptRef`, separate shell commands from AI prompt presets, remove `DEMO_PRESET_COMMANDS`, remove `selectedHostId` from `topologySignature` (style selection via an isolated D3 attribute update), and compute real subnet/gateway topology from fleet data.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` removed synthetic `'cst-gateway'` (`NetworkTopologyGraph.tsx`), **but `selectedHostId` in `topologySignature` (`L56`), `lastSubmittedPromptRef` (`CommandTerminal.tsx:91`), and dead `screenBase64` (`L35`) remain unfixed in `7e68a18`**.
- **Safe Verification Command:**
  ```powershell
  npm run lint
  ```

### 11. `wol/WolEnergyCalculator.tsx`, `wol/WolEnergyWeeklyChart.tsx`, `wol/WolHistoryLogViewer.tsx`
- **File Path(s):**
  - `apps/web/src/components/wol/WolEnergyCalculator.tsx` (`72c84a4`: `components/WolEnergyCalculator.tsx`)
  - `apps/web/src/components/wol/WolEnergyWeeklyChart.tsx` (`72c84a4`: `components/WolEnergyWeeklyChart.tsx`)
  - `apps/web/src/components/wol/WolHistoryLogViewer.tsx` (`72c84a4`: `components/WolHistoryLogViewer.tsx`)
- **Root Cause:**
  1. **`WolEnergyWeeklyChart.tsx` Broken Slider (`L61-71, L338-346`)**: `const effectiveActiveHoursPerDay = activeHoursPerDay ?? scheduledDayActiveHours;`. Because `WolEnergyCalculator.tsx` (`L481`) always passes `activeHoursPerDay`, changing the chart's own `"Active hrs/day"` slider mutates `scheduledDayActiveHours` label while the bars & energy savings never change! Also renders fake active schedule styling (`idx < effectiveDaysPerWeek`) when `enabledSchedules.length === 0`, remounts inline `CustomTooltip` on every render, and clips multi-character currency units on `YAxis` (`margin={{ left: -15 }}`).
  2. **`WolEnergyCalculator.tsx`**: `handleSyncWithSchedules` ignores `activeHoursPerDay` (`L92-107`); `setKwhRate(Number(...))` allows `0`/`NaN` (`L471`).
  3. **`WolHistoryLogViewer.tsx`**: dead `hosts` prop; uncleaned `setTimeout`s; standalone `handleRetryPacket` appends fake `status: 'success'` without dispatching UDP; `.slice(11)` assumes fixed timestamp length; 1-click wipe without confirmation.
- **Fix Steps:**
  Sync or elevate the `scheduledDayActiveHours` state cleanly (allowing chart slider interaction to update active hours or drive callback to calculator), render empty-schedule state honestly when 0 schedules exist, hoist `CustomTooltip` outside render, fix `YAxis` left margin, clamp `kwhRate >= 0.01`, require real `/api/wol` dispatch in retry (no fake `'success'`), and add confirm dialog before clearing history.
- **Exists in `backup/github-pushed-snapshot`?:**
  **No** — verified in `7e68a18`: `WolEnergyWeeklyChart.tsx:71` (`activeHoursPerDay ?? scheduledDayActiveHours`) and `WolHistoryLogViewer.tsx:93,266` (`status: 'success'`, `slice(11)`) remain **unfixed in `7e68a18`**.
- **Safe Verification Command:**
  ```powershell
  npm run lint
  ```

### 12. `modals/ScreenViewerModal.tsx`
- **File Path(s):** `apps/web/src/components/modals/ScreenViewerModal.tsx` (`72c84a4`: `components/ScreenViewerModal.tsx`)
- **Root Cause:**
  1. **Coordinate Drift (`L404-463, L965-994, L1486`)**: Mapped pointer clicks onto hardcoded `1920x1080` against letterboxed `screenStageRef` bounds with shifting `transformOrigin: '${cursorPos.x}% ${cursorPos.y}%'`.
  2. **`blob:` Revocation Race (`L575-589`)**: `handleCapture` waited `250ms` in uncleaned `setTimeout` while `screenStore` (`500ms` refresh) could revoke the `blob:` URL before `a.click()`.
  3. **Dual Dispatch & Fake Controls**: Dispatched both WS and fake `/api/pc-control/execute`; dead `simWindow` state & quality selector (`useWorkerEngine` forced `1280x720`); endless spinner when disconnected; missing `F`/`I` shortcuts advertised by `KeyboardShortcutsModal.tsx`; hardcoded `gemini-3.8-flash` & honest-missing `'TLS 1.3'` badge (`00-shared-contracts.md §3.3`); uncleaned ripple timeout.
- **Fix Steps:**
  Use rendered `<img>` rect (`computeContainedScreenRect`) + live host resolution, click/convert screenshot Blob synchronously before revocation, require active authenticated WS for input/capture (zero fake HTTP fallback, `00-shared-contracts.md §3.1`), remove dead `simWindow` state, wire `F`/`I` shortcuts or update `KeyboardShortcutsModal`, show real `wss://` vs `ws://` transport state, and show disconnected CTA instead of spinning indefinitely.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` updated `ScreenViewerModal.tsx` (`+406/-...`: wired `img.getBoundingClientRect()`, `aspectPreset`, removed `simWindow` and wired `F`/`I` shortcuts at `L597-600`). Check capture `blob:` clone safety and honest TLS badge carefully.
- **Safe Verification Command:**
  ```powershell
  npm run lint
  ```

### 13. `modals/PcDaemonGuiModal.tsx`, `modals/QuickSetupModal.tsx`, `modals/SystemUpdateModal.tsx`, `modals/CodeExportModal.tsx`
- **File Path(s):**
  - `apps/web/src/components/modals/{PcDaemonGuiModal,QuickSetupModal,SystemUpdateModal,CodeExportModal}.tsx` (`72c84a4`: `components/*.tsx`)
- **Root Cause:**
  1. `PcDaemonGuiModal.tsx`: backed by `server.ts` mock `pcDaemonState` instead of real Python daemon; offline `catch` left `FALLBACK_DAEMON_STATE` showing `ONLINE`; optimistic fake error handling for bans/disconnects; static `avChecks` ignoring `daemon.avIntegrity`; phantom `"Simulate New Peer"` text (`L1089`); fake `'A4:83:E7:21:9B:04'` fallback (`L1117`).
  2. `QuickSetupModal.tsx`: fell back to hardcoded `'cst_autonomous_lan_secret_2025'` (mismatched `agent.py` default `'ai_netcontroller_secret_2025'`); embedded long-lived secret in `?pair_token=` QR URL (`00-shared-contracts.md §4`); rendered always-green readiness cards without checking daemon/port health or MAC validity; hardcoded `pair_os: 'windows'`.
  3. `SystemUpdateModal.tsx`: `v0.35.0 → v0.35.0` bogus drift & mixed `v2.4.2` versions; lexicographic `'v2.4.2' > 'v0.35.0'` check triggered permanent false compatibility error; `250ms` fake check `setTimeout`s; `catch` block faked 100% upgrade completion.
  4. `CodeExportModal.tsx`: uncancelled `fetch` without `AbortController`/`res.ok` & swallowed rebuild errors; hardcoded `v0.35.0`, `'pending_build'` SHA-256 placeholders, wrong artifact sizes, dead `'frontend'` tab button omission, and exported stale `codeSnippets.ts` (`OP_ERR=8`).
- **Fix Steps:**
  Remove hardcoded PSKs and `?pair_token=` URL secret params (`00-shared-contracts.md §4`), show real offline/error states in `PcDaemonGuiModal` & `SystemUpdateModal` (replace lexicographic compare with numeric semver parser, remove fake `setTimeout` checks & `catch` completion fakes), bind `avChecks` & readiness cards to real daemon/TCP probes, fetch live snippets via `/api/source-files` with `AbortController`, and align version from manifest/API.
- **Exists in `backup/github-pushed-snapshot`?:**
  **Partial** — `7e68a18` removed hardcoded `'cst_autonomous_lan_secret_2025'` & `?pair_token=` from `QuickSetupModal.tsx`, removed `'pending_build'` & `'v0.35.0'` from `CodeExportModal.tsx`, and removed `'v2.4.2'` / fake `setTimeout` from `SystemUpdateModal.tsx`. **Still unfixed in `7e68a18`**: `PcDaemonGuiModal.tsx` still retains `FALLBACK_DAEMON_STATE` (`L125`), `'A4:83:E7:21:9B:04'` (`L1147`), and `"Simulate New Peer"` mention (`L1119`), and `CodeExportModal.tsx` still keeps empty `'frontend'` filter (`L60`).
- **Safe Verification Command:**
  ```powershell
  npm run lint
  ```

### 14. Remaining Modals, Settings, Telemetry & UI Primitives
- **File Path(s):** `AddHostModal`, `HitlApprovalModal`, `HostDetailsModal`, `KeyboardShortcutsModal`, `ModalManager`, `OnboardingModal`, `WolModal`, `WsConfigModal`, `MemoryManager`, `SettingsScreen`, `HeartbeatSparkline`, `HostLatencySparkline`, `FloatingPillNav`, `GlobalErrorBoundary`, `BottomSheet`, `GlassContainer`, `LanguageToggle`
- **Root Cause & Fix Summary:**
  - `AddHostModal.tsx`: dead `existingHostsCount`; editing stripped live telemetry & overwrote `lastSeen: 'Active (Manual host added)'`; `if (!isOpen) return null` broke `<AnimatePresence>`; missing `Escape`/backdrop close. -> Preserve `...editingHost`, wrap inside `<AnimatePresence>`, add Esc/backdrop handlers. *(Unfixed in `7e68a18`)*
  - `HitlApprovalModal.tsx`: uncleaned `copied` timer, stale `copied` across events, missing `Escape` & `type="button"`. -> Clean timer, reset on `event?.command_id`, add Esc.
  - `HostDetailsModal.tsx`: hardcoded `'mDNS Active'`; silent copy buttons; ignored `host.cpu`/`host.ram`; `block flex` conflict; 1-click delete without confirm. -> Real discovery label, copy feedback, clamp metrics, confirm delete.
  - `KeyboardShortcutsModal.tsx`: killed exit animation; `v3.1 Beta` badge (`L101`); advertised missing `F`/`I` shortcuts before `7e68a18`. -> Move check inside `<AnimatePresence>` & match version (`v3.1` still in `7e68a18`!).
  - `ModalManager.tsx`: passed stale `payload` snapshot to `ScreenViewerModal` & `WolModal`; omitted fields in `WolPacketPayload`; marked QuickSetup hosts `isOnline: true` pre-handshake. -> Resolve live host from `hosts` & require handshake before `isOnline: true`.
  - `OnboardingModal.tsx`: `dontShowAgain` checkbox ignored (`setCompletedOnboarding()` always called — still unfixed in `7e68a18`!); stale closure; killed exit animation. -> Gate `if (dontShowAgain)`.
  - `WolModal.tsx`: form lacked inputs for `formBroadcastIp`/`formPort`/`formNotes`; empty MAC flashed error on mount; imported unused `TEST_WOL_SCHEDULES` (still in `7e68a18`!); fire-and-forget `450ms` close without awaiting result; missing Esc. -> Add fields, lazy-validate, await send result, add Esc.
  - `WsConfigModal.tsx`: `CST/2.4-SECURE`, uncleaned `localConnecting` timeout, `isSimulated={!connected}` (still in `7e68a18`), plaintext `localStorage` PSK. -> Remove fake sparkline mode & use `isConnecting` prop cleanly.
  - `SettingsScreen.tsx` & `MemoryManager.tsx`: 5 ephemeral toggles (`isAutoDiscovery`, `isHitlEnabled`, `isBiometricEnabled`, `isCommandConfirmations`, `isSystemStateAlerts`) never persisted or enforced; custom AI models not fetched from `GET /api/ai/models` (lost on tab switch — still absent or partial in `7e68a18`); `MemoryManager` lacked real `config.json` API persistence (`fetch()` absent in `7e68a18`) and leaked timer. -> Persist toggles/rules via backend config API & daemon sync.
  - `HeartbeatSparkline.tsx` & `HostLatencySparkline.tsx`: duplicate hardcoded SVG gradient IDs (`React.useId()` needed — `useId` still absent in `7e68a18`!); `preserveAspectRatio="none"` distorts dots (`still in 7e68a18`); synthetic waves/jitter (`0.6` still in `HostLatencySparkline.tsx:109`!).
  - `FloatingPillNav.tsx`, `GlobalErrorBoundary.tsx`, `BottomSheet.tsx`, `GlassContainer.tsx`, `LanguageToggle.tsx`: hardcoded EN tooltip / BG error screen (`useTranslation`), `BottomSheet` missing `Escape`, `GlassContainer` inner wrapper breaking `flex-1` children, `LanguageToggle` shared `layoutId` (`React.useId()`).
- **Safe Verification Command:**
  ```powershell
  npm run lint
  npm run build
  ```
