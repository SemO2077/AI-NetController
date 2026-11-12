# AI NetController v0.35.0 — Release Notes

**AI NetController v0.35.0** delivers a major update focused on user experience refinement, visual polish, layout reliability across mobile form factors, and release packaging standardization.

---

## What's New in v0.35.0

### 1. Composited Background Animation Engine
- Introduced four GPU-composited background motion presets:
  - **Liquid Plasma (`fluid`)**: Multi-layered orbiting radial elements and conic rotation composited via CSS 3D transforms.
  - **Northern Aurora (`aurora`)**: Sweeping diagonal aurora ribbons with multi-stop color transitions.
  - **Cyber Grid (`cyber`)**: Geometric perspective grid overlay with coordinated vertical scan sweeps.
  - **Static Dark Void (`minimal`)**: Minimalist, zero-animation canvas for low-power operation.

### 2. Surface Material & Customization Presets
- Refined translucent and opaque surface styling:
  - **Crystal Clear (`clear`)**: High-transparency surface with backdrop blur and specular highlights.
  - **Balanced (`balanced`)**: Moderate translucency with ambient diffuse lighting.
  - **True Matte (`frosted`)**: 100% opaque dark surface (`#0c1220`) with no backdrop filter blur or reflections.
- Added collapsible **Appearance & Customization Studio** positioned at the base of the Settings view, controlled by a persistent toggle (`isCustomizationOpen`).

### 3. Settings View Restructuring & Dropdown Fixes
- Added a 4-card Quick-Launch Command Bar for instant access to primary operational workflows:
  - **Pair Phone & PC**
  - **PC Daemon Center**
  - **System & AI Center**
  - **Interactive Guide**
- Reorganized system configuration into a clean 2x2 section grid:
  1. *Connection, Network & Localization*
  2. *AI Copilot Engine & Automation*
  3. *Security Policies, Alerts & Diagnostics*
  4. *Wake-on-LAN Schedules & Energy Accounting*
- Resolved dropdown menu stacking conflicts: added `.dropdown-menu-surface` with solid `#060b16` backing and elevated z-index stacking contexts in `SettingsScreen.tsx` and `FleetDashboard.tsx` to prevent clipping beneath adjacent cards.

### 4. Mobile Viewport & Ergonomics Refinements
- **System & AI Center Polish (`SystemUpdateModal.tsx`)**: Rebuilt modal header using responsive flex wrapping (`min-w-0 flex-1 break-words`) and unified scrolling across AI Advisory, Component Inventory, Category Filters, and Audit Logs.
- **Haptic Tuning**: Removed redundant haptic trigger events from main navigation tabs (`FloatingPillNav.tsx`, `App.tsx`) and sub-modal tab headers to reduce vibration fatigue.

---

## Release Deliverables

| File | Target Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.35.0_win64.exe` | Windows 10/11 x64 | Standalone PE32+ Host Agent executable with system tray & GUI |
| `AI_NetController_HostAgent_v0.35.0_win64_portable.zip` | Windows x64 | Portable archive containing Host Agent source, spec files, and launchers |
| `AI_NetController_v0.35.0_arm64-v8a.apk` | Android 10+ (arm64-v8a) | Signed native Android APK package |
| `AI_NetController_v0.35.0.apk` | Android Universal | Signed universal APK package |
| `SHA256SUMS.txt` | All | SHA-256 cryptographic digests for release validation |
| `RELEASE_MANIFEST.json` | All | Machine-readable release metadata and asset manifest |
