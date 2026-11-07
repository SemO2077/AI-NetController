# -*- mode: python ; coding: utf-8 -*-
# AI NetController Host Agent - Production PyInstaller Specification
# Configured for --onedir, visible Tkinter GUI, and zero UPX packing to eliminate
# Windows Defender / heuristic antivirus false positives.

import sys
import os

block_cipher = None

# Embedded Windows Application Manifest (asInvoker + PerMonitorV2 High-DPI Awareness)
MANIFEST_XML = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0" xmlns:asmv3="urn:schemas-microsoft-com:asm.v3">
  <assemblyIdentity
    version="3.0.0.0"
    processorArchitecture="amd64"
    name="AI.NetController.HostAgent"
    type="win32"
  />
  <description>AI NetController - PC Host Agent &amp; Desktop Control Center</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <asmv3:application>
    <asmv3:windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2,PerMonitor</dpiAwareness>
    </asmv3:windowsSettings>
  </asmv3:application>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- Windows 10 & Windows 11 -->
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
    </application>
  </compatibility>
</assembly>
'''

with open('app_manifest.xml', 'w', encoding='utf-8') as mf:
    mf.write(MANIFEST_XML)

a = Analysis(
    ['agent_daemon.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'agent_gui',
        'agent',
        'tkinter',
        'tkinter.ttk',
        'tkinter.messagebox',
        'zeroconf',
        'zeroconf.asyncio',
        'websockets',
        'websockets.asyncio.server',
        'pystray',
        'mss',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'turbojpeg',
        'psutil',
        'pyautogui',
        'pyperclip',
        'asyncio',
        'crypto_vault',
        'command_ast_firewall',
        'multi_monitor_streamer',
        'host_file_writer',
        'windows_integration',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'unittest',
        'email',
        'http.server',
        'xmlrpc',
        'pydoc',
        'distutils'
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
    manifest='app_manifest.xml',
    version='version_info.txt',
    icon=None
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
    manifest='app_manifest.xml',
    version='version_info.txt',
    icon=None
)

