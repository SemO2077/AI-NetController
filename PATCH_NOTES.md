# AI NetController v0.34.0 — Release Notes

**AI NetController v0.34.0** introduces an **Apple Liquid Glass** visual aesthetic, vibrant multi-tone ambient aurora lighting, smooth 120 Hz GPU-composited animations, and a built-in **Appearance & Customization Studio**.

---

## What's New in v0.34.0

### Apple Liquid Glass & Vibrant Aurora Aesthetic
- **Refractive Liquid Glass Surfaces (`index.css`)**: Cards, floating bars, search controls, and modals feature translucent multi-stop glass gradients, `saturate(185%)` backdrop refraction, and crisp top/left specular bevel highlights.
- **GPU-Composited Aurora Canvas (`App.tsx`)**: Multi-tone radial aurora light pools gently illuminate the background behind translucent cards using pure `transform: translate3d(...)` compositor animations with zero pixel-blur shader overhead or scroll lag.
- **Vibrant Telemetry & Tactile Animations (`HostCard.tsx` & `FloatingPillNav.tsx`)**: Multi-stop glowing gradient bars for CPU and RAM telemetry, spring-animated navigation icons, and luminous active capsule indicators.

### Full Appearance & Customization Studio (`SettingsScreen.tsx`)
Customize the entire interface in real time from **Settings → Liquid Glass & Appearance**:
- **6 Accent Color Palettes**: *Cyber Cyan*, *Ultraviolet*, *Bio Mint*, *Crimson*, *Solar Gold*, and *Sapphire* — dynamically re-themes buttons, badges, charts, glass rims, and ambient aurora lighting across the entire app.
- **4 Typography Presets**: Switch instantly between *Onest* (Geometric), *Plus Jakarta Sans* (Editorial), *SF System* (Native OS), and *JetBrains Mono* (Developer Console).
- **3 Glass Translucency Levels**: *Crystal* (high transparency), *Liquid* (balanced vision glass), and *Frosted* (high-contrast smoked glass).
- **3 Ambient Aurora & Motion Modes**: *Vibrant* (living aurora + spring motion), *Subtle* (calm stationary glow), and *Minimal* (stealth).

---

## Release Assets

| File | Platform | Description |
| :--- | :--- | :--- |
| `AI_NetController_HostAgent_v0.34.0_win64.exe` | Windows x64 | Standalone Windows Host Agent executable |
| `AI_NetController_HostAgent_v0.34.0_win64_portable.zip` | Windows x64 | Portable archive containing Host Agent and launchers |
| `AI_NetController_v0.34.0_arm64-v8a.apk` | Android ARM64 | Signed Android package optimized for `arm64-v8a` devices |
| `AI_NetController_v0.34.0.apk` | Android Universal | Universal Android installation package |
| `RELEASE_MANIFEST.json` | All | Build metadata and asset manifest |
| `SHA256SUMS.txt` | All | SHA-256 checksums for all release binaries |
