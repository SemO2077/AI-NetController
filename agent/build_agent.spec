# -*- mode: python ; coding: utf-8 -*-
# AI NetController Host Agent - Production PyInstaller Specification
# Configured for --onedir + standalone --onefile, visible Tkinter GUI, and zero UPX packing
# to eliminate Windows Defender / heuristic antivirus false positives.

import sys
import os

SPEC_DIR = SPECPATH if 'SPECPATH' in globals() else os.getcwd()
MANIFEST_PATH = os.path.join(SPEC_DIR, 'app_manifest.xml')
VERSION_INFO_PATH = os.path.join(SPEC_DIR, 'version_info.txt')
ICON_PATH = os.path.join(SPEC_DIR, 'icon.ico')

block_cipher = None

# Only create app_manifest.xml if missing (preserve tracked manifest in repository)
if not os.path.isfile(MANIFEST_PATH):
    raise FileNotFoundError(f"Missing required Windows manifest: {MANIFEST_PATH}")

a = Analysis(
    [os.path.join(SPEC_DIR, 'agent_daemon.py')],
    pathex=[SPEC_DIR, os.path.dirname(SPEC_DIR)],
    binaries=[],
    datas=[
        (os.path.join(SPEC_DIR, '__init__.py'), '.'),
        (os.path.join(SPEC_DIR, 'crypto_vault.py'), '.'),
        (os.path.join(SPEC_DIR, 'crypto_handshake.py'), '.'),
        (os.path.join(SPEC_DIR, 'daemon_config.py'), '.'),
        (os.path.join(SPEC_DIR, 'windows_integration.py'), '.'),
        (os.path.join(SPEC_DIR, 'agent_gui.py'), '.'),
        (os.path.join(SPEC_DIR, 'agent.py'), '.'),
        (os.path.join(SPEC_DIR, 'icon_assets.py'), '.'),
        (os.path.join(SPEC_DIR, 'command_ast_firewall.py'), '.'),
        (os.path.join(SPEC_DIR, 'multi_monitor_streamer.py'), '.'),
        (os.path.join(SPEC_DIR, 'host_file_writer.py'), '.'),
        (os.path.join(SPEC_DIR, 'network_fuzzer_shield.py'), '.'),
        (os.path.join(SPEC_DIR, 'app_manifest.xml'), '.'),
        (os.path.join(SPEC_DIR, 'icon.ico'), '.'),
        (os.path.join(SPEC_DIR, 'icon.png'), '.'),
        (os.path.join(SPEC_DIR, 'assets', 'icon.ico'), 'assets'),
        (os.path.join(SPEC_DIR, 'assets', 'icon.png'), 'assets'),
        (os.path.join(SPEC_DIR, 'assets', 'icon_32.png'), 'assets'),
        (os.path.join(SPEC_DIR, 'assets', 'icon_64.png'), 'assets'),
    ],
    hiddenimports=[
        'crypto_vault',
        'agent.crypto_vault',
        'crypto_handshake',
        'agent.crypto_handshake',
        'daemon_config',
        'agent.daemon_config',
        'agent_gui',
        'agent.agent_gui',
        'agent',
        'agent.agent',
        'icon_assets',
        'agent.icon_assets',
        'windows_integration',
        'agent.windows_integration',
        'command_ast_firewall',
        'agent.command_ast_firewall',
        'multi_monitor_streamer',
        'agent.multi_monitor_streamer',
        'host_file_writer',
        'agent.host_file_writer',
        'network_fuzzer_shield',
        'agent.network_fuzzer_shield',
        'tkinter',
        'tkinter.ttk',
        'tkinter.messagebox',
        'tkinter.filedialog',
        'zeroconf',
        'zeroconf.asyncio',
        'websockets',
        'websockets.asyncio.server',
        'aiohttp',
        'pystray',
        'mss',
        'numpy',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'PIL.ImageTk',
        'PIL.ImageFilter',
        'turbojpeg',
        'psutil',
        'pyautogui',
        'pyperclip',
        'asyncio',
        'cryptography',
        'cryptography.hazmat',
        'cryptography.hazmat.primitives.asymmetric.x25519',
        'cryptography.hazmat.primitives.kdf.hkdf',
        'cryptography.hazmat.primitives.ciphers.aead',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'unittest',
        'http.server',
        'xmlrpc',
        'pydoc',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='AI_NetController_HostAgent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # Strictly disabled: UPX compression triggers heuristic AV false positives
    console=False,  # Launches visible Tkinter Desktop Control Center GUI window (HWND)
    disable_windowed_traceback=False,
    manifest=MANIFEST_PATH,
    version=VERSION_INFO_PATH,
    icon=ICON_PATH
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,  # Strictly disabled on all collected DLLs/PYDs to preserve Authenticode & AV trust
    upx_exclude=[],
    name='AI_NetController_HostAgent'
)

exe_onefile = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='AI_NetController_HostAgent_standalone',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    manifest=MANIFEST_PATH,
    version=VERSION_INFO_PATH,
    icon=ICON_PATH
)

