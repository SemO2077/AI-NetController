export interface CodeSnippetEntry {
  filename: string;
  language: string;
  category: 'backend' | 'crossplatform' | 'android' | 'frontend' | 'docs';
  description: string;
  code: string;
}

export const CODE_SNIPPETS: CodeSnippetEntry[] = [
  {
    filename: 'agent/build_exe.bat',
    language: 'bat',
    category: 'backend',
    description: 'Instant Windows Host Agent Builder (Warm-Cache PyInstaller --onedir + Standalone EXE, Zero UPX, Cached Authenticode Sign)',
    code: `@echo off
cd /d "%~dp0"
"..\\.venv\\Scripts\\python.exe" "..\\scripts\\build_release_binaries.py" --exe-only %*
`,
  },
  {
    filename: 'apps/mobile/build_apk.bat',
    language: 'bat',
    category: 'crossplatform',
    description: 'Instant Flutter Split-ABI & Universal Release APK Builder (Auto JDK/SDK + Warm Gradle Cache)',
    code: `@echo off
cd /d "%~dp0"
"..\\..\\.venv\\Scripts\\python.exe" "..\\..\\scripts\\build_android_app.py" %*
`,
  },
  {
    filename: 'LAUNCH_AND_TEST.bat',
    language: 'bat',
    category: 'backend',
    description: 'Unified Daemon Launcher, Firewall/TLS/ADB Provisioner & Live E2E Probe Suite',
    code: `@echo off
cd /d "%~dp0"
".venv\\Scripts\\python.exe" "scripts\\launch_and_test_daemon.py" %*
`,
  },
  {
    filename: 'apps/mobile/android/app/src/main/AndroidManifest.xml',
    language: 'xml',
    category: 'android',
    description: 'Android Manifest: LAN WebSocket / Multicast Discovery, Keystore & Biometric Auth',
    code: `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.cst.autonomouslan">
    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE"/>
    <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE"/>
    <uses-permission android:name="android.permission.WAKE_LOCK"/>
    <uses-permission android:name="android.permission.VIBRATE"/>
    <uses-permission android:name="android.permission.USE_BIOMETRIC"/>
</manifest>
`,
  },
  {
    filename: 'docs/ARCHITECTURE.md',
    language: 'markdown',
    category: 'docs',
    description: 'Three-tier system architecture & security containment overview',
    code: `# System Architecture

AI NetController coordinates the Python Host Agent (\`agent/\`), Flutter Mobile Companion (\`apps/mobile/\`),
and local Express + React Control Console (\`apps/web/\`) over a framed binary WebSocket protocol (\`0xC5 0x71\`).
See docs/ARCHITECTURE.md and docs/PROTOCOL.md in the repository for complete module contracts.
`,
  },
  {
    filename: 'docs/PROTOCOL.md',
    language: 'markdown',
    category: 'docs',
    description: 'Canonical 12-byte binary frame format, opcodes (0x01-0xEE) & ECDH AEAD handshake',
    code: `# Binary Wire Protocol

Every binary frame uses a 12-byte big-endian header: magic (0xC571), opcode (uint8), flags (uint8),
seq (uint32), length (uint32 <= 10 MiB), followed by payload bytes.

Opcodes: 0x01 OP_PING, 0x02 OP_TELEMETRY, 0x03 OP_FRAME, 0x04 OP_SHELL, 0x05 OP_HITL,
0x06 OP_AUTH, 0x07 OP_CLIP, 0x08 OP_INPUT, 0x09 OP_AUDIO, 0x0A OP_VIEWPORT_RESIZE,
0x0B OP_LLM_STREAM, 0x0C OP_FILE_TRANSFER, 0x0D OP_DISPLAY_ENUM, 0xED OP_FRAME_SYNC, 0xEE OP_ERR.
`,
  },
];
