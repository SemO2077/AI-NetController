# AI NetController v0.35.0 — Release Notes

**AI NetController v0.35.0** introduces a 4-mode GPU-accelerated **Moving Fluid Background Engine**, sharply distinct **Surface Material Presets** (including a 100% opaque **True Matte** surface), a reorganized **Settings & Command Architecture**, a collapsible bottom **Customization Studio**, fixed **Dropdown Stacking & Opaque Surfaces**, removed tab-switching haptic vibrations, and resolved text overflow/overlap across the **System & AI Center** and all mobile tabs.

---

## What's New in v0.35.0

### 1. Moving Fluid Background Engine (4 Selectable Modes)
- **Liquid Plasma (`fluid`)**: Multi-layered orbiting plasma spheres (`fluid-orbit-1`, `fluid-orbit-2`, `fluid-orbit-3`) and a rotating conic vortex (`fluid-vortex-spin`) running purely on GPU `transform: translate3d(...)` and `opacity` keyframes.
- **Northern Aurora (`aurora`)**: Sweeping diagonal aurora ribbons (`aurora-ribbon-sweep-1`, `aurora-ribbon-sweep-2`) with smooth multi-stop color transitions.
- **Cyber Grid Pulse (`cyber`)**: Architectural perspective grid overlay (`.cyber-grid-pattern`) paired with a vertical radar scanline sweep and breathing core pulse.
- **Static Deep Void (`minimal`)**: Zero-animation stealth dark canvas for maximum power efficiency.

### 2. Distinct Surface Material, Font & Accent Customization
- **Crystal Glass (`clear`)**: Ultra-transparent (`0.20` alpha) refractive surface with `blur(26px) saturate(240%)`, bright prismatic top/left rim highlights (`0.58` alpha), and specular inner reflections.
- **Liquid Glass (`balanced`)**: Balanced Apple Liquid Glass translucency (`0.52` alpha, `blur(18px) saturate(190%)`) with soft specular bevels.
- **True Matte (`frosted`)**: 100% opaque flat dark stealth surface (`#0c1220` / `#101829`), zero `backdrop-filter` blur, zero glossy reflection, and clean flat borders (`rgba(255, 255, 255, 0.065)`).
- **Bottom Hideable Customization Studio**: Relocated the **Appearance, Surface Material & Fluid Background Studio** to the bottom of the Settings tab with a persistent **Show Studio / Hide Studio** toggle (`isCustomizationOpen`).

### 3. Reorganized Settings Architecture & Dropdown Fixes
- **Top 4-Card Quick-Launch Command Bar**: Instant 1-tap access to **Pair Phone & PC**, **PC Daemon Center**, **System & AI Center**, and **Interactive Guide**.
- **Logical 2x2 Settings Grid**:
  1. *Connection, Network & Language*
  2. *AI Copilot Engine & Automation*
  3. *Security, Alerts & Diagnostics*
  4. *Wake-on-LAN Telemetry & Fleet Energy*
- **Dropdown Menu Surface & Stacking Fix**: Added `.dropdown-menu-surface` (`#060b16` opaque backing, high-contrast border, `z-index: 100`) and elevated parent card stacking contexts in `SettingsScreen.tsx` and `FleetDashboard.tsx` so dropdowns never bleed into or get overlapped by background cards.

### 4. Mobile Layout & Ergonomics Polish
- **System & AI Center Overhaul (`SystemUpdateModal.tsx`)**: Rebuilt header with `min-w-0 flex-1` and `break-words`, unified vertical scrolling across the AI Advisory, Compatibility Deck, Category Filter Bar, Component List, and Audit Log, and replaced single-line metadata strings with wrapping flex chips.
- **Tab-Switch Haptic Removal**: Removed `triggerHapticFeedback` from all main navigation tabs (`FloatingPillNav.tsx`, `App.tsx`) and modal/sub-window tab bars (`GeminiChatbot.tsx`, `CommandTerminal.tsx`, `PcDaemonGuiModal.tsx`, `WolModal.tsx`, `QuickSetupModal.tsx`, `WolHistoryLogViewer.tsx`, `CodeExportModal.tsx`).

---

## Release Assets

| File | Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.35.0_win64.exe` | Windows x64 | Standalone Windows Host Agent executable |
| `AI_NetController_HostAgent_v0.35.0_win64_portable.zip` | Windows x64 | Portable archive containing Host Agent and launchers |
| `AI_NetController_v0.35.0_arm64-v8a.apk` | Android ARM64 | Signed Android package optimized for `arm64-v8a` devices |
| `AI_NetController_v0.35.0.apk` | Android Universal | Universal Android installation package |
| `SHA256SUMS.txt` | All | SHA-256 checksums for all release artifacts |
