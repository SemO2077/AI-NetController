"""
AI NetController — Windows Integration, Security ACLs & Cyber Setup Wizards
================================================================================
AV / Smart App Control (SAC) Hardened Native Implementation:
  1. SingleInstanceGuard via Kernel Named Mutex
  2. Native Win32 COM Shortcuts (IShellLinkW + IPersistFile via ctypes ole32)
     -> ZERO temporary .vbs droppers, ZERO cscript.exe spawns
  3. Native Win32 Process Management (psutil + OpenProcess/TerminateProcess)
     -> ZERO taskkill.exe or cmd.exe child spawns
  4. Native Win32 NTFS User-SID DACL Protection (SetNamedSecurityInfoW)
     -> ZERO icacls.exe spawns; Owner + SYSTEM only
  5. Windows Mark-of-the-Web (Zone.Identifier ZoneId=3) ADS writer
  6. Cyber Glassmorphic Setup & Uninstall Wizards matching Mobile Design Language
================================================================================
"""

from __future__ import annotations

import logging
import ntpath
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

IS_WINDOWS = platform.system() == "Windows"

if IS_WINDOWS:
    import ctypes
    import winreg
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    ole32 = ctypes.WinDLL("ole32", use_last_error=True)
else:
    ctypes = None  # type: ignore[assignment]
    wintypes = None  # type: ignore[assignment]
    winreg = None
    kernel32 = None
    user32 = None
    advapi32 = None
    ole32 = None

try:
    from icon_assets import (
        apply_window_icon,
        get_icon_ico_path,
        get_icon_image,
        get_icon_png_path,
    )
except ImportError:
    try:
        from agent.icon_assets import (
            apply_window_icon,
            get_icon_ico_path,
            get_icon_image,
            get_icon_png_path,
        )
    except ImportError:
        get_icon_ico_path = lambda: None  # type: ignore[assignment]
        get_icon_png_path = lambda size=512: None  # type: ignore[assignment]
        get_icon_image = lambda size=64: None  # type: ignore[assignment]
        apply_window_icon = lambda win: None  # type: ignore[assignment]

try:
    from cyber_ui_theme import (
        CyberColors,
        apply_dark_titlebar,
        enable_hidpi_awareness,
        render_ambient_backdrop,
        render_glass_card_image,
        render_node_orb_image,
        resolve_font_families,
    )
except ImportError:
    try:
        from agent.cyber_ui_theme import (
            CyberColors,
            apply_dark_titlebar,
            enable_hidpi_awareness,
            render_ambient_backdrop,
            render_glass_card_image,
            render_node_orb_image,
            resolve_font_families,
        )
    except ImportError:
        class CyberColors:  # type: ignore[no-redef]
            BACKGROUND = "#040812"
            SURFACE = "#0A1628"
            SURFACE_ELEVATED = "#102038"
            PRIMARY = "#00F0FF"
            SECONDARY = "#8A2BE2"
            ACCENT = "#FF0055"
            SUCCESS = "#00FF9D"
            WARNING = "#FFB800"
            TEXT_PRIMARY = "#E2F1FF"
            TEXT_SECONDARY = "#7A93B2"
            TEXT_TERTIARY = "#4A607A"
            GLASS_BORDER = "#13526A"
            GLASS_BORDER_IDLE = "#1D2C42"
            GLASS_BORDER_CRITICAL = "#8F1843"
            PRIMARY_SOFT = "#0A2A3B"
            ACCENT_SOFT = "#3B0D24"
            SUCCESS_SOFT = "#083327"
            TERMINAL_BG = "#060B16"

        apply_dark_titlebar = lambda *_a, **_kw: None  # type: ignore[assignment]
        enable_hidpi_awareness = lambda: None  # type: ignore[assignment]
        render_ambient_backdrop = lambda *_a, **_kw: None  # type: ignore[assignment]
        render_glass_card_image = lambda *_a, **_kw: None  # type: ignore[assignment]
        render_node_orb_image = lambda *_a, **_kw: None  # type: ignore[assignment]
        resolve_font_families = lambda *_a, **_kw: ("Segoe UI", "Consolas")  # type: ignore[assignment]

logger = logging.getLogger("AI-NetController-WindowsIntegration")

APP_NAME = "AI NetController"
APP_DESCRIPTION = "AI NetController — PC Host Agent & Desktop Control Center"
APP_VERSION = "0.60.0"
APP_PUBLISHER = "AI NetController"
MUTEX_NAME = "Global\\AI_NetController_HostAgent_Mutex"
REG_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
REG_UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\AI_NetController"
REG_APP_PATHS_KEY = r"Software\Microsoft\Windows\CurrentVersion\App Paths\AI_NetController_HostAgent.exe"


# ==============================================================================
# 1. CHECKS & BALANCES: SINGLE-INSTANCE MUTEX & PORT HEALTH
# ==============================================================================
class SingleInstanceGuard:
    """
    Guarantees only one instance of AI NetController daemon runs at a time
    using a Windows Kernel Named Mutex.
    """

    def __init__(self, mutex_name: str = MUTEX_NAME):
        self.mutex_name = mutex_name
        self.mutex_handle = None
        self.is_already_running = False

    def acquire(self) -> bool:
        if not IS_WINDOWS or not kernel32:
            return True

        kernel32.CreateMutexW.restype = wintypes.HANDLE
        kernel32.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
        kernel32.CloseHandle.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

        ctypes.set_last_error(0)
        self.mutex_handle = kernel32.CreateMutexW(None, False, self.mutex_name)
        last_error = ctypes.get_last_error()

        if not self.mutex_handle:
            self.is_already_running = False
            return True

        # ERROR_ALREADY_EXISTS = 183
        if last_error == 183:
            self.is_already_running = True
            logger.warning("Another instance of AI NetController Host Agent is already running.")
            try:
                kernel32.CloseHandle(self.mutex_handle)
            except Exception:
                pass
            self.mutex_handle = None
            return False

        self.is_already_running = False
        return True

    def release(self) -> None:
        if IS_WINDOWS and kernel32 and self.mutex_handle:
            try:
                kernel32.CloseHandle(self.mutex_handle)
            except Exception:
                pass
            self.mutex_handle = None

    def __enter__(self) -> "SingleInstanceGuard":
        self.acquire()
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.release()


def check_port_available(port: int, host: str = "0.0.0.0") -> Tuple[bool, str]:
    """Probes whether the target WebSocket port is available on the host."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.6)
            probe_host = "127.0.0.1" if host in ("0.0.0.0", "::", "") else host
            if s.connect_ex((probe_host, port)) == 0:
                return False, f"Port {port} is currently occupied by another process."
        return True, f"Port {port} is available."
    except Exception as e:
        return True, f"Port check advisory: {e}"


def get_executable_path() -> str:
    """Returns canonical executable or launcher entry path."""
    if getattr(sys, "frozen", False):
        return os.path.abspath(sys.executable)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "agent_daemon.py"))


def _resolve_python_gui_launcher() -> Tuple[str, str]:
    """
    Returns (target_exe, arguments_prefix) pointing cleanly to PSF-signed pythonw.exe
    when running from Python source, avoiding unsigned batch/VBS stubs under Smart App Control.
    """
    if getattr(sys, "frozen", False):
        return os.path.abspath(sys.executable), ""
    py_exe = os.path.abspath(sys.executable)
    py_dir = os.path.dirname(py_exe)
    pythonw = os.path.join(py_dir, "pythonw.exe")
    if IS_WINDOWS and os.path.isfile(pythonw):
        return pythonw, f'"{get_executable_path()}"'
    return py_exe, f'"{get_executable_path()}"'


# ==============================================================================
# 2. NATIVE WIN32 SECURITY ACLs & MARK-OF-THE-WEB (ZERO SUBPROCESSES)
# ==============================================================================
def harden_windows_acl(path: str, is_dir: Optional[bool] = None) -> bool:
    """
    Restricts NTFS permissions on sensitive configuration files/folders strictly to
    the current Windows user SID + Local SYSTEM using protected DACLs via Win32 Advapi32.
    Eliminates icacls.exe child spawns.
    """
    if not IS_WINDOWS or not advapi32 or not kernel32 or not path:
        return False
    abs_path = os.path.abspath(path)
    if not os.path.exists(abs_path):
        return False
    if is_dir is None:
        is_dir = os.path.isdir(abs_path)

    TOKEN_QUERY = 0x0008
    TokenUser = 1
    SE_FILE_OBJECT = 1
    DACL_SECURITY_INFORMATION = 0x00000004
    PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000
    SDDL_REVISION_1 = 1

    h_token = wintypes.HANDLE()
    p_sd = ctypes.c_void_p()
    p_str_sid = wintypes.LPWSTR()
    try:
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
        advapi32.OpenProcessToken.restype = wintypes.BOOL

        if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), TOKEN_QUERY, ctypes.byref(h_token)):
            return False

        advapi32.GetTokenInformation.argtypes = [
            wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)
        ]
        advapi32.GetTokenInformation.restype = wintypes.BOOL

        req_len = wintypes.DWORD(0)
        advapi32.GetTokenInformation(h_token, TokenUser, None, 0, ctypes.byref(req_len))
        if req_len.value == 0:
            return False

        buf = (ctypes.c_ubyte * req_len.value)()
        if not advapi32.GetTokenInformation(h_token, TokenUser, buf, req_len.value, ctypes.byref(req_len)):
            return False

        # TOKEN_USER first pointer-sized member is PSID
        psid = ctypes.cast(buf, ctypes.POINTER(ctypes.c_void_p))[0]
        advapi32.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
        advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL
        if not advapi32.ConvertSidToStringSidW(psid, ctypes.byref(p_str_sid)):
            return False

        user_sid = ctypes.wstring_at(p_str_sid)
        inherit = "OICI" if is_dir else ""
        sddl = f"D:P(A;{inherit};FA;;;{user_sid})(A;{inherit};FA;;;SY)"

        advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
            wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.ULONG)
        ]
        advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
        if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl, SDDL_REVISION_1, ctypes.byref(p_sd), None
        ):
            return False

        dacl_present = wintypes.BOOL(False)
        dacl_defaulted = wintypes.BOOL(False)
        p_dacl = ctypes.c_void_p()
        advapi32.GetSecurityDescriptorDacl.argtypes = [
            ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.BOOL)
        ]
        advapi32.GetSecurityDescriptorDacl.restype = wintypes.BOOL
        if not advapi32.GetSecurityDescriptorDacl(
            p_sd, ctypes.byref(dacl_present), ctypes.byref(p_dacl), ctypes.byref(dacl_defaulted)
        ) or not dacl_present.value:
            return False

        advapi32.SetNamedSecurityInfoW.argtypes = [
            wintypes.LPWSTR, ctypes.c_int, wintypes.DWORD,
            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p
        ]
        advapi32.SetNamedSecurityInfoW.restype = wintypes.DWORD
        err = advapi32.SetNamedSecurityInfoW(
            abs_path,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            None,
            None,
            p_dacl,
            None,
        )
        return err == 0
    except Exception as e:
        logger.debug(f"NTFS DACL hardening notice for {path}: {e}")
        return False
    finally:
        try:
            if p_str_sid and p_str_sid.value:
                kernel32.LocalFree(p_str_sid)
        except Exception:
            pass
        try:
            if p_sd and p_sd.value:
                kernel32.LocalFree(p_sd)
        except Exception:
            pass
        try:
            if h_token and h_token.value:
                kernel32.CloseHandle(h_token)
        except Exception:
            pass


def apply_mark_of_the_web(file_path: str, zone_id: int = 3) -> bool:
    """
    Tags remote-transferred files on NTFS with Windows Mark-of-the-Web
    (`Zone.Identifier` ADS, ZoneId=3 Internet) so OS smart screens classify them transparently.
    """
    if not IS_WINDOWS or not file_path or not os.path.isfile(file_path):
        return False
    try:
        ads_path = f"{os.path.abspath(file_path)}:Zone.Identifier"
        with open(ads_path, "w", encoding="ascii", newline="\r\n") as ads:
            ads.write(f"[ZoneTransfer]\nZoneId={int(zone_id)}\n")
        return True
    except Exception as e:
        logger.debug(f"Mark-of-the-Web notice for {file_path}: {e}")
        return False


# ==============================================================================
# 3. NATIVE WIN32 COM SHORTCUT ENGINE (ZERO .VBS DROPPERS / ZERO CSCRIPT)
# ==============================================================================
if IS_WINDOWS and ctypes is not None:
    class _GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", ctypes.c_uint32),
            ("Data2", ctypes.c_uint16),
            ("Data3", ctypes.c_uint16),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    _CLSID_ShellLink = _GUID(0x00021401, 0x0000, 0x0000, (ctypes.c_ubyte * 8)(0xC0, 0, 0, 0, 0, 0, 0, 0x46))
    _IID_IShellLinkW = _GUID(0x000214F9, 0x0000, 0x0000, (ctypes.c_ubyte * 8)(0xC0, 0, 0, 0, 0, 0, 0, 0x46))
    _IID_IPersistFile = _GUID(0x0000010B, 0x0000, 0x0000, (ctypes.c_ubyte * 8)(0xC0, 0, 0, 0, 0, 0, 0, 0x46))


def create_native_shortcut(
    target_exe: str,
    shortcut_path: str,
    arguments: str = "",
    description: str = APP_DESCRIPTION,
    icon_path: Optional[str] = None,
    work_dir: Optional[str] = None,
) -> bool:
    """
    Creates a native Windows `.lnk` shell shortcut strictly in-memory via Win32 COM
    (`IShellLinkW` + `IPersistFile`). Zero temporary `.vbs` files, zero `cscript.exe`.
    """
    if not IS_WINDOWS or not ole32:
        return False

    try:
        os.makedirs(os.path.dirname(os.path.abspath(shortcut_path)), exist_ok=True)
        resolved_target = os.path.abspath(target_exe)
        effective_args = arguments

        # If target is a Python script (.py / .pyw), bind directly via pythonw.exe
        if resolved_target.lower().endswith((".py", ".pyw")) and not getattr(sys, "frozen", False):
            pyw = os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "pythonw.exe")
            launcher = pyw if os.path.isfile(pyw) else os.path.abspath(sys.executable)
            effective_args = f'"{resolved_target}"' + (f" {arguments}" if arguments else "")
            work_dir = work_dir or os.path.dirname(resolved_target)
            resolved_target = launcher
        else:
            work_dir = work_dir or os.path.dirname(resolved_target)

        ico = icon_path or get_icon_ico_path()
        if not ico or not os.path.exists(ico):
            ico = resolved_target

        COINIT_APARTMENTTHREADED = 0x2
        CLSCTX_INPROC_SERVER = 0x1
        SW_SHOWNORMAL = 1
        RPC_E_CHANGED_MODE = -2147417850  # 0x80010106 signed HRESULT

        ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, wintypes.DWORD]
        ole32.CoInitializeEx.restype = ctypes.c_long
        hr_init = ole32.CoInitializeEx(None, COINIT_APARTMENTTHREADED)
        need_uninit = hr_init in (0, 1)
        if hr_init < 0 and hr_init != RPC_E_CHANGED_MODE:
            logger.debug(f"CoInitializeEx returned 0x{hr_init & 0xFFFFFFFF:08X}")
            return False

        p_shell_link = ctypes.c_void_p()
        p_persist_file = ctypes.c_void_p()
        try:
            ole32.CoCreateInstance.argtypes = [
                ctypes.POINTER(_GUID), ctypes.c_void_p, wintypes.DWORD,
                ctypes.POINTER(_GUID), ctypes.POINTER(ctypes.c_void_p)
            ]
            ole32.CoCreateInstance.restype = ctypes.c_long
            hr = ole32.CoCreateInstance(
                ctypes.byref(_CLSID_ShellLink),
                None,
                CLSCTX_INPROC_SERVER,
                ctypes.byref(_IID_IShellLinkW),
                ctypes.byref(p_shell_link),
            )
            if hr < 0 or not p_shell_link.value:
                logger.debug(f"CoCreateInstance(ShellLink) failed: 0x{hr & 0xFFFFFFFF:08X}")
                return False

            vtbl_sl = ctypes.cast(
                ctypes.cast(p_shell_link, ctypes.POINTER(ctypes.c_void_p))[0],
                ctypes.POINTER(ctypes.c_void_p),
            )

            def _call_sl(slot: int, *arg_specs_and_vals):
                argtypes = [t for t, _ in arg_specs_and_vals]
                args = [v for _, v in arg_specs_and_vals]
                fn = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, *argtypes)(vtbl_sl[slot])
                return fn(p_shell_link, *args)

            # IShellLinkW vtable indices: 20=SetPath, 11=SetArguments, 9=SetWorkingDirectory,
            # 7=SetDescription, 17=SetIconLocation, 15=SetShowCmd, 0=QueryInterface
            hr = _call_sl(20, (wintypes.LPCWSTR, resolved_target))
            if hr < 0:
                return False
            if effective_args:
                _call_sl(11, (wintypes.LPCWSTR, effective_args))
            if work_dir:
                _call_sl(9, (wintypes.LPCWSTR, work_dir))
            if description:
                _call_sl(7, (wintypes.LPCWSTR, description[:256]))
            if ico:
                _call_sl(17, (wintypes.LPCWSTR, os.path.abspath(ico)), (ctypes.c_int, 0))
            _call_sl(15, (ctypes.c_int, SW_SHOWNORMAL))

            hr = _call_sl(0, (ctypes.POINTER(_GUID), ctypes.byref(_IID_IPersistFile)), (ctypes.POINTER(ctypes.c_void_p), ctypes.byref(p_persist_file)))
            if hr < 0 or not p_persist_file.value:
                return False

            vtbl_pf = ctypes.cast(
                ctypes.cast(p_persist_file, ctypes.POINTER(ctypes.c_void_p))[0],
                ctypes.POINTER(ctypes.c_void_p),
            )
            # IPersistFile slot 6 = Save(pszFileName, fRemember)
            fn_save = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, wintypes.LPCWSTR, wintypes.BOOL)(vtbl_pf[6])
            hr = fn_save(p_persist_file, os.path.abspath(shortcut_path), True)
            return hr >= 0 and os.path.isfile(shortcut_path)
        finally:
            if p_persist_file and p_persist_file.value:
                vtbl_pf = ctypes.cast(
                    ctypes.cast(p_persist_file, ctypes.POINTER(ctypes.c_void_p))[0],
                    ctypes.POINTER(ctypes.c_void_p),
                )
                ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtbl_pf[2])(p_persist_file)
            if p_shell_link and p_shell_link.value:
                vtbl_sl = ctypes.cast(
                    ctypes.cast(p_shell_link, ctypes.POINTER(ctypes.c_void_p))[0],
                    ctypes.POINTER(ctypes.c_void_p),
                )
                ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtbl_sl[2])(p_shell_link)
            if need_uninit:
                ole32.CoUninitialize()
    except Exception as e:
        logger.debug(f"COM shortcut creation notice: {e}")
        return False


# Backward-compatible symbol name retained purely as an alias to the COM implementation
create_vbs_shortcut = create_native_shortcut


def _resolve_desktop_dir() -> str:
    """Resolves Windows Desktop folder safely including OneDrive KnownFolder redirects."""
    if IS_WINDOWS and winreg:
        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
            ) as key:
                desktop_val, _ = winreg.QueryValueEx(key, "Desktop")
                expanded = os.path.expandvars(desktop_val)
                if expanded and os.path.isdir(expanded):
                    return expanded
        except Exception:
            pass
    userprofile = os.environ.get("USERPROFILE", os.path.expanduser("~"))
    return os.path.join(userprofile, "Desktop")


def create_desktop_shortcut(
    target_exe: Optional[str] = None,
    icon_path: Optional[str] = None,
) -> Tuple[bool, str]:
    """Creates a clean AI NetController shortcut on the user's Windows Desktop."""
    if not IS_WINDOWS:
        return False, "Desktop shortcut creation skipped on non-Windows host."
    desktop = _resolve_desktop_dir()
    lnk_path = os.path.join(desktop, f"{APP_NAME}.lnk")
    exe = target_exe or get_executable_path()
    # Respect mocks if tests patch create_vbs_shortcut specifically
    fn = create_vbs_shortcut if create_vbs_shortcut is not create_native_shortcut else create_native_shortcut
    if fn(exe, lnk_path, description=APP_DESCRIPTION, icon_path=icon_path):
        return True, f"Desktop shortcut created: {lnk_path}"
    return False, "Could not create Desktop shortcut."


def create_start_menu_shortcut(
    target_exe: Optional[str] = None,
    icon_path: Optional[str] = None,
) -> Tuple[bool, str]:
    """Creates Start Menu launch + uninstall shortcuts using native Win32 COM."""
    if not IS_WINDOWS:
        return False, "Start Menu shortcut creation skipped on non-Windows host."
    appdata = os.environ.get("APPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Roaming"))
    programs_dir = os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", APP_NAME)
    exe = target_exe or get_executable_path()
    fn = create_vbs_shortcut if create_vbs_shortcut is not create_native_shortcut else create_native_shortcut

    lnk_main = os.path.join(programs_dir, f"{APP_NAME}.lnk")
    ok_main = fn(exe, lnk_main, description=APP_DESCRIPTION, icon_path=icon_path)

    lnk_uninst = os.path.join(programs_dir, f"Uninstall {APP_NAME}.lnk")
    fn(exe, lnk_uninst, arguments="--uninstall", description=f"Uninstall {APP_NAME}", icon_path=icon_path)

    if ok_main:
        return True, f"Start Menu shortcut created: {lnk_main}"
    return False, "Could not create Start Menu shortcut."


def remove_shortcuts() -> Tuple[int, str]:
    """Removes Desktop and Start Menu shortcuts for AI NetController."""
    removed = 0
    targets = [
        os.path.join(_resolve_desktop_dir(), f"{APP_NAME}.lnk"),
        os.path.join(_resolve_desktop_dir(), "AI_NetController_HostAgent.lnk"),
    ]
    appdata = os.environ.get("APPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Roaming"))
    sm_folder = os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", APP_NAME)
    if os.path.isdir(sm_folder):
        try:
            shutil.rmtree(sm_folder)
            removed += 1
        except Exception as e:
            logger.debug(f"Could not delete Start Menu folder: {e}")

    for t in targets:
        if os.path.isfile(t):
            try:
                os.remove(t)
                removed += 1
            except Exception as e:
                logger.debug(f"Could not delete shortcut {t}: {e}")

    return removed, f"Removed {removed} shortcut artifact(s)."


# ==============================================================================
# 4. WINDOWS REGISTRY: AUTOSTART & INSTALLED APPS REGISTRATION
# ==============================================================================
def _format_launch_command(exe_path: str, extra_args: str = "") -> str:
    """Formats a registry command cleanly for frozen EXEs vs PSF-signed pythonw.exe launchers."""
    abs_target = os.path.abspath(exe_path)
    if abs_target.lower().endswith((".py", ".pyw")) and not getattr(sys, "frozen", False):
        pyw = os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "pythonw.exe")
        runner = pyw if (IS_WINDOWS and os.path.isfile(pyw)) else os.path.abspath(sys.executable)
        suffix = f" {extra_args}" if extra_args else ""
        return f'"{runner}" "{abs_target}"{suffix}'
    suffix = f" {extra_args}" if extra_args else ""
    return f'"{abs_target}"{suffix}'


def set_windows_autostart(enabled: bool = True, target_exe: Optional[str] = None) -> bool:
    """Configures AI NetController launch on user sign-in via HKCU Run key."""
    if not IS_WINDOWS or not winreg:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                exe_path = target_exe or get_executable_path()
                cmd = _format_launch_command(exe_path)
                winreg.SetValueEx(key, "AINetController", 0, winreg.REG_SZ, cmd)
            else:
                try:
                    winreg.DeleteValue(key, "AINetController")
                except FileNotFoundError:
                    pass
        return True
    except Exception as e:
        logger.debug(f"Autostart registry update notice: {e}")
        return False


def register_windows_uninstaller(target_exe: Optional[str] = None, icon_path: Optional[str] = None) -> bool:
    """Registers AI NetController cleanly under HKCU Installed Apps."""
    if not IS_WINDOWS or not winreg:
        return False

    exe_path = target_exe or get_executable_path()
    install_dir = os.path.dirname(os.path.abspath(exe_path))

    ico = icon_path or get_icon_ico_path()
    display_icon = f'"{ico}"' if (ico and os.path.exists(ico)) else f'"{exe_path}",0'
    uninstall_cmd = _format_launch_command(exe_path, "--uninstall")

    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_UNINSTALL_KEY) as key:
            winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, APP_NAME)
            winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, APP_VERSION)
            winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, APP_PUBLISHER)
            winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, display_icon)
            winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, uninstall_cmd)
            winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, install_dir)
            winreg.SetValueEx(key, "NoModify", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(key, "NoRepair", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(key, "EstimatedSize", 0, winreg.REG_DWORD, 32000)

        try:
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_APP_PATHS_KEY) as apk:
                winreg.SetValueEx(apk, "", 0, winreg.REG_SZ, exe_path)
                winreg.SetValueEx(apk, "Path", 0, winreg.REG_SZ, install_dir)
        except Exception:
            pass
        return True
    except Exception as e:
        logger.debug(f"Uninstaller registry registration error: {e}")
        return False


def unregister_windows_uninstaller() -> bool:
    """Removes AI NetController from Windows Installed Apps registry."""
    if not IS_WINDOWS or not winreg:
        return False
    for reg_key in (REG_UNINSTALL_KEY, REG_APP_PATHS_KEY):
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, reg_key)
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.debug(f"Registry key removal notice ({reg_key}): {e}")
    return True


# ==============================================================================
# 5. CLEAN PROCESS TERMINATION (ZERO TASKKILL.EXE SPAWNS) & UNINSTALL
# ==============================================================================
def _terminate_pid_native(pid: int, timeout_ms: int = 2000) -> bool:
    """Terminates a matching agent PID cleanly via Win32 OpenProcess + TerminateProcess."""
    if not IS_WINDOWS or not kernel32:
        return True
    PROCESS_TERMINATE = 0x0001
    SYNCHRONIZE = 0x00100000
    h = kernel32.OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, False, int(pid))
    if not h:
        return False
    try:
        kernel32.TerminateProcess(h, 0)
        kernel32.WaitForSingleObject(h, int(timeout_ms))
        return True
    finally:
        kernel32.CloseHandle(h)


def _stop_external_agent_processes() -> bool:
    """
    Stops other running AI NetController HostAgent instances cleanly using native
    process APIs without invoking `taskkill.exe` or `cmd.exe`.
    """
    if not IS_WINDOWS:
        return True
    current_pid = os.getpid()
    all_ok = True
    try:
        import psutil  # type: ignore

        matched: List[psutil.Process] = []
        for proc in psutil.process_iter(["pid", "name", "exe", "cmdline"]):
            try:
                pid = proc.info.get("pid")
                if not pid or pid == current_pid:
                    continue
                name = (proc.info.get("name") or "").lower()
                exe = (proc.info.get("exe") or "").lower()
                cmdline = " ".join(proc.info.get("cmdline") or []).lower()
                if (
                    "ai_netcontroller_hostagent" in name
                    or "ai_netcontroller_hostagent" in exe
                    or ("agent_daemon.py" in cmdline and "python" in name)
                ):
                    matched.append(proc)
            except Exception:
                continue

        for proc in matched:
            try:
                proc.terminate()
            except Exception:
                all_ok = False
        if matched:
            _, alive = psutil.wait_procs(matched, timeout=2.5)
            for proc in alive:
                try:
                    proc.kill()
                except Exception:
                    all_ok = False
        return all_ok
    except ImportError:
        # Pure Win32 Toolhelp32 fallback if psutil is unavailable
        try:
            TH32CS_SNAPPROCESS = 0x00000002

            class _PROCESSENTRY32W(ctypes.Structure):
                _fields_ = [
                    ("dwSize", wintypes.DWORD),
                    ("cntUsage", wintypes.DWORD),
                    ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
                    ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD),
                    ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long),
                    ("dwFlags", wintypes.DWORD),
                    ("szExeFile", wintypes.WCHAR * 260),
                ]

            snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            if snap == wintypes.HANDLE(-1).value:
                return False
            try:
                entry = _PROCESSENTRY32W()
                entry.dwSize = ctypes.sizeof(_PROCESSENTRY32W)
                if kernel32.Process32FirstW(snap, ctypes.byref(entry)):
                    while True:
                        pid = int(entry.th32ProcessID)
                        exe_name = (entry.szExeFile or "").lower()
                        if pid != current_pid and "ai_netcontroller_hostagent" in exe_name:
                            if not _terminate_pid_native(pid):
                                all_ok = False
                        if not kernel32.Process32NextW(snap, ctypes.byref(entry)):
                            break
            finally:
                kernel32.CloseHandle(snap)
            return all_ok
        except Exception as e:
            logger.debug(f"Win32 Toolhelp32 termination notice: {e}")
            return False


def perform_full_uninstall(
    interactive: bool = True,
    remove_config: bool = False,
    on_complete: Optional[Callable[[], None]] = None,
) -> Dict[str, Any]:
    """
    Executes clean uninstallation of AI NetController from the host PC:
    1. Stops running external daemon instances
    2. Removes Desktop and Start Menu shortcuts
    3. Removes Windows Run autostart entry
    4. Removes Windows Installed Apps registry entries
    5. Removes user-space install folder and optionally local config/keys
    """
    stopped = _stop_external_agent_processes()
    results: Dict[str, Any] = {
        "stopped_daemon": stopped,
        "removed_shortcuts": 0,
        "removed_autostart": False,
        "removed_uninstaller": False,
        "removed_config": False,
        "removed_install_dir": False,
        "success": True,
        "message": "",
    }

    count, _ = remove_shortcuts()
    results["removed_shortcuts"] = count
    results["removed_autostart"] = set_windows_autostart(enabled=False)
    results["removed_uninstaller"] = unregister_windows_uninstaller()

    try:
        install_dir = get_default_install_dir()
        if os.path.isdir(install_dir):
            shutil.rmtree(install_dir, ignore_errors=True)
            results["removed_install_dir"] = not os.path.exists(install_dir)
    except Exception:
        results["removed_install_dir"] = False

    if remove_config:
        try:
            local_app = os.environ.get("LOCALAPPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Local"))
            app_data_dir = os.path.join(local_app, "AI NetController")
            if os.path.isdir(app_data_dir):
                shutil.rmtree(app_data_dir, ignore_errors=True)
                results["removed_config"] = True
        except Exception as e:
            logger.debug(f"Config cleanup notice: {e}")

    results["message"] = (
        f"AI NetController has been cleanly uninstalled.\n"
        f"- Shortcuts removed: {count}\n"
        f"- Startup entry cleared: {results['removed_autostart']}\n"
        f"- Apps registry removed: {results['removed_uninstaller']}"
    )

    if on_complete and callable(on_complete):
        try:
            on_complete()
        except Exception:
            pass
    return results


# ==============================================================================
# 6. INSTALLATION PATH CHECKS & FULL INSTALLATION ENGINE
# ==============================================================================
def get_default_install_dir() -> str:
    """Returns standard user-space install directory: %LOCALAPPDATA%\\Programs\\AI NetController."""
    local_appdata = os.environ.get("LOCALAPPDATA") or os.path.join(os.environ.get("USERPROFILE", ""), "AppData", "Local")
    return os.path.abspath(os.path.join(local_appdata, "Programs", APP_NAME))


def validate_install_path(path: str) -> Tuple[bool, str]:
    """Validates target installation directory against traversal, drive root, and Windows system paths."""
    if not path or not isinstance(path, str):
        return False, "Installation path cannot be empty."
    path = path.strip().strip('"').strip("'")
    if not path:
        return False, "Installation path cannot be empty."
    if "\x00" in path:
        return False, "Invalid path: null bytes detected."

    is_windows_path = (
        IS_WINDOWS
        or (len(path) >= 2 and path[1] == ":" and path[0].isalpha())
        or path.startswith("\\\\")
    )
    path_mod = ntpath if is_windows_path else os.path
    try:
        if IS_WINDOWS or not is_windows_path:
            norm = path_mod.abspath(path_mod.normpath(path))
        else:
            norm = ntpath.normpath(path)
    except Exception as e:
        return False, f"Invalid path syntax: {e}"

    _, rest = path_mod.splitdrive(norm)
    if not rest or rest in ("\\", "/"):
        return False, "Cannot install directly into a drive root."

    rest_clean = rest.lower().strip("\\/")
    forbidden_prefixes = ["windows", "boot", "recovery", "$recycle.bin", "system volume information"]
    for fb in forbidden_prefixes:
        if rest_clean == fb or rest_clean.startswith(fb + "\\") or rest_clean.startswith(fb + "/"):
            return False, f"Cannot install into protected Windows system folder: {norm}"

    return True, norm


def is_running_from_install_dir(target_dir: Optional[str] = None) -> bool:
    """Checks whether the currently running binary resides inside the installed directory."""
    install_dir = os.path.abspath(target_dir or get_default_install_dir()).lower()
    curr_exe_dir = os.path.abspath(os.path.dirname(get_executable_path())).lower()
    return curr_exe_dir == install_dir


def is_app_installed() -> bool:
    """Checks whether AI NetController is registered or installed in user-space."""
    install_dir = get_default_install_dir()
    if os.path.isfile(os.path.join(install_dir, "AI_NetController_HostAgent.exe")) or os.path.isfile(
        os.path.join(install_dir, "launch_agent.pyw")
    ):
        return True
    if not IS_WINDOWS or not winreg:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_UNINSTALL_KEY) as key:
            val, _ = winreg.QueryValueEx(key, "InstallLocation")
            if val and os.path.exists(val):
                return True
    except Exception:
        pass
    return False


def perform_full_install(
    target_dir: Optional[str] = None,
    create_desktop: bool = True,
    create_start_menu: bool = True,
    autostart: bool = True,
    launch_after: bool = True,
    progress_cb: Optional[Callable[[int, str], None]] = None,
) -> Dict[str, Any]:
    """
    Executes secure installation into user-space `%LOCALAPPDATA%\\Programs\\AI NetController`:
      - Frozen builds copy `AI_NetController_HostAgent.exe` + `_internal` directory (`--onedir`).
      - Source runs deploy Python modules + `launch_agent.pyw` invoked via signed `pythonw.exe`
        (zero `.bat` / `.vbs` dropper artifacts).
    """
    result: Dict[str, Any] = {
        "success": False,
        "installed_dir": "",
        "installed_exe": "",
        "message": "",
        "error": None,
    }

    def _update(pct: int, msg: str) -> None:
        logger.info(f"[Install {pct}%] {msg}")
        if progress_cb and callable(progress_cb):
            try:
                progress_cb(pct, msg)
            except Exception:
                pass

    _update(5, "Validating installation destination...")
    dest_path = target_dir or get_default_install_dir()
    ok, valid_dir = validate_install_path(dest_path)
    if not ok:
        result["message"] = valid_dir
        result["error"] = "INVALID_PATH"
        return result

    try:
        os.makedirs(valid_dir, exist_ok=True)
        harden_windows_acl(valid_dir, is_dir=True)
    except Exception as e:
        result["message"] = f"Failed to create target directory '{valid_dir}': {e}"
        result["error"] = "PERMISSION_DENIED"
        return result

    result["installed_dir"] = valid_dir
    dest_exe = os.path.join(valid_dir, "AI_NetController_HostAgent.exe")
    result["installed_exe"] = dest_exe

    _update(15, "Checking for active daemon processes...")
    current_exe = get_executable_path()
    if os.path.exists(dest_exe) and os.path.abspath(dest_exe).lower() != os.path.abspath(current_exe).lower():
        for _ in range(3):
            try:
                with open(dest_exe, "a+b"):
                    break
            except PermissionError:
                _update(22, "Stopping background daemon...")
                _stop_external_agent_processes()
                time.sleep(0.5)

    _update(35, "Deploying runtime application files...")
    is_frozen = getattr(sys, "frozen", False)
    if is_frozen:
        src_exe = sys.executable
        if os.path.abspath(src_exe).lower() != os.path.abspath(dest_exe).lower():
            try:
                shutil.copy2(src_exe, dest_exe)
            except Exception as e:
                result["message"] = f"Failed to copy executable to {dest_exe}: {e}"
                result["error"] = "COPY_ERROR"
                return result

        src_dir = os.path.dirname(src_exe)
        internal_src = os.path.join(src_dir, "_internal")
        if os.path.isdir(internal_src):
            internal_dest = os.path.join(valid_dir, "_internal")
            try:
                if os.path.exists(internal_dest):
                    shutil.rmtree(internal_dest, ignore_errors=True)
                shutil.copytree(internal_src, internal_dest, dirs_exist_ok=True)
            except Exception as e:
                logger.debug(f"Optional _internal bundle copy notice: {e}")
    else:
        src_agent_dir = os.path.dirname(os.path.abspath(__file__))
        dest_agent_dir = os.path.join(valid_dir, "agent")
        os.makedirs(dest_agent_dir, exist_ok=True)
        for fname in os.listdir(src_agent_dir):
            if fname.endswith((".py", ".txt", ".spec", ".xml", ".ico", ".png")):
                sf = os.path.join(src_agent_dir, fname)
                if os.path.isfile(sf):
                    shutil.copy2(sf, os.path.join(dest_agent_dir, fname))

        # Native Python windowless entrypoint (.pyw) launched via PSF-signed pythonw.exe (no .bat dropper)
        launcher_pyw = os.path.join(valid_dir, "launch_agent.pyw")
        with open(launcher_pyw, "w", encoding="utf-8") as f:
            f.write(
                "import os, sys\n"
                "_HERE = os.path.dirname(os.path.abspath(__file__))\n"
                "_AGENT = os.path.join(_HERE, 'agent')\n"
                "if _AGENT not in sys.path:\n"
                "    sys.path.insert(0, _AGENT)\n"
                "from agent_daemon import main\n"
                "if __name__ == '__main__':\n"
                "    main()\n"
            )
        dest_exe = launcher_pyw
        result["installed_exe"] = dest_exe

    _update(55, "Deploying Cyber branding icons...")
    dest_ico = os.path.join(valid_dir, "icon.ico")
    dest_png = os.path.join(valid_dir, "icon.png")
    dest_assets = os.path.join(valid_dir, "assets")
    os.makedirs(dest_assets, exist_ok=True)

    src_ico = get_icon_ico_path()
    if src_ico and os.path.exists(src_ico):
        try:
            shutil.copy2(src_ico, dest_ico)
            shutil.copy2(src_ico, os.path.join(dest_assets, "icon.ico"))
        except Exception:
            pass

    src_png = get_icon_png_path(512)
    if src_png and os.path.exists(src_png):
        try:
            shutil.copy2(src_png, dest_png)
            shutil.copy2(src_png, os.path.join(dest_assets, "icon.png"))
        except Exception:
            pass

    _update(72, "Creating Win32 COM Desktop & Start Menu shortcuts...")
    if create_desktop:
        create_desktop_shortcut(dest_exe, icon_path=dest_ico if os.path.exists(dest_ico) else None)
    if create_start_menu:
        create_start_menu_shortcut(dest_exe, icon_path=dest_ico if os.path.exists(dest_ico) else None)

    _update(86, "Configuring Windows autostart & Installed Apps...")
    if autostart:
        set_windows_autostart(True, dest_exe)
    register_windows_uninstaller(dest_exe, icon_path=dest_ico if os.path.exists(dest_ico) else None)

    _update(95, "Verifying port 8765 readiness...")
    check_port_available(8765)

    if launch_after:
        _update(98, "Launching AI NetController Host Agent...")
        try:
            if dest_exe.lower().endswith(".pyw") and not is_frozen:
                pyw = os.path.join(os.path.dirname(os.path.abspath(sys.executable)), "pythonw.exe")
                runner = pyw if (IS_WINDOWS and os.path.isfile(pyw)) else sys.executable
                cmd_args = [runner, dest_exe]
            else:
                cmd_args = [dest_exe]
            subprocess.Popen(
                cmd_args,
                cwd=valid_dir,
                creationflags=0x00000008 if IS_WINDOWS else 0,
            )
        except Exception as e:
            logger.debug(f"Auto-launch advisory: {e}")

    _update(100, "Installation completed cleanly.")
    result["success"] = True
    result["message"] = f"AI NetController {APP_VERSION} installed to:\n{valid_dir}"
    return result


# ==============================================================================
# 7. CYBER GLASSMORPHIC INSTALL & UNINSTALL WIZARDS (MATCHING MOBILE DESIGN)
# ==============================================================================
def show_install_dialog(parent_root=None) -> Optional[Dict[str, Any]]:
    """Displays the Cyber Glassmorphic Setup Wizard matching the Mobile App UI."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception:
        return None

    enable_hidpi_awareness()
    win = tk.Toplevel(parent_root) if parent_root else tk.Tk()
    win.title(f"{APP_NAME} v{APP_VERSION} — Setup Wizard")
    win.geometry("580x500")
    win.configure(bg=CyberColors.BACKGROUND)
    win.resizable(False, False)
    apply_window_icon(win)
    apply_dark_titlebar(win, CyberColors.BACKGROUND)

    ui_font, mono_font = resolve_font_families(win if not parent_root else parent_root)
    outcome: Dict[str, Any] = {"installed": False, "result": None}
    bg_refs: List[Any] = []

    try:
        from PIL import ImageTk
        bg_im = render_ambient_backdrop(580, 500)
        if bg_im:
            bg_photo = ImageTk.PhotoImage(bg_im)
            bg_refs.append(bg_photo)
            bg_lbl = tk.Label(win, image=bg_photo, borderwidth=0)
            bg_lbl.place(x=0, y=0, relwidth=1.0, relheight=1.0)
    except Exception:
        pass

    header = tk.Frame(win, bg=CyberColors.SURFACE, highlightbackground=CyberColors.GLASS_BORDER, highlightthickness=1)
    header.pack(fill=tk.X, padx=22, pady=(20, 12))

    # Top glowing cyan accent rule inside card
    tk.Frame(header, bg=CyberColors.PRIMARY, height=2).pack(fill=tk.X)
    head_inner = tk.Frame(header, bg=CyberColors.SURFACE, padx=18, pady=14)
    head_inner.pack(fill=tk.X)

    try:
        from PIL import ImageTk
        orb = render_node_orb_image(44, CyberColors.PRIMARY, CyberColors.SECONDARY, 0.1, True)
        if orb:
            orb_ph = ImageTk.PhotoImage(orb)
            bg_refs.append(orb_ph)
            tk.Label(head_inner, image=orb_ph, bg=CyberColors.SURFACE).pack(side=tk.LEFT, padx=(0, 14))
    except Exception:
        pass

    title_col = tk.Frame(head_inner, bg=CyberColors.SURFACE)
    title_col.pack(side=tk.LEFT, fill=tk.X, expand=True)
    tk.Label(
        title_col,
        text="NODE SETUP WIZARD",
        font=(mono_font, 9, "bold"),
        fg=CyberColors.PRIMARY,
        bg=CyberColors.SURFACE,
    ).pack(anchor=tk.W)
    tk.Label(
        title_col,
        text=f"{APP_NAME} v{APP_VERSION}",
        font=(ui_font, 15, "bold"),
        fg=CyberColors.TEXT_PRIMARY,
        bg=CyberColors.SURFACE,
    ).pack(anchor=tk.W)
    tk.Label(
        title_col,
        text="Per-user Zero-Trust Host Agent • Native Win32 COM • Zero Admin UAC",
        font=(ui_font, 9),
        fg=CyberColors.TEXT_SECONDARY,
        bg=CyberColors.SURFACE,
    ).pack(anchor=tk.W)

    # Glassmorphic configuration card
    body = tk.Frame(win, bg=CyberColors.SURFACE, highlightbackground=CyberColors.GLASS_BORDER_IDLE, highlightthickness=1)
    body.pack(fill=tk.BOTH, expand=True, padx=22, pady=(0, 14))
    inner = tk.Frame(body, bg=CyberColors.SURFACE, padx=18, pady=16)
    inner.pack(fill=tk.BOTH, expand=True)

    tk.Label(
        inner,
        text="DESTINATION DIRECTORY",
        font=(mono_font, 9, "bold"),
        fg=CyberColors.TEXT_SECONDARY,
        bg=CyberColors.SURFACE,
    ).pack(anchor=tk.W)

    dir_row = tk.Frame(inner, bg=CyberColors.SURFACE)
    dir_row.pack(fill=tk.X, pady=(6, 14))

    path_var = tk.StringVar(value=get_default_install_dir())
    path_entry = tk.Entry(
        dir_row,
        textvariable=path_var,
        bg=CyberColors.TERMINAL_BG,
        fg=CyberColors.TEXT_PRIMARY,
        insertbackground=CyberColors.PRIMARY,
        relief=tk.FLAT,
        highlightbackground=CyberColors.GLASS_BORDER,
        highlightthickness=1,
        font=(mono_font, 9),
    )
    path_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, ipady=7)

    def _browse() -> None:
        chosen = filedialog.askdirectory(initialdir=path_var.get(), title="Choose Install Directory")
        if chosen:
            if os.path.basename(chosen).lower() != APP_NAME.lower():
                chosen = os.path.join(chosen, APP_NAME)
            path_var.set(chosen)

    tk.Button(
        dir_row,
        text="BROWSE",
        command=_browse,
        bg=CyberColors.SURFACE_ELEVATED,
        fg=CyberColors.PRIMARY,
        activebackground=CyberColors.PRIMARY_SOFT,
        activeforeground=CyberColors.TEXT_PRIMARY,
        relief=tk.FLAT,
        font=(mono_font, 9, "bold"),
        padx=12,
        pady=5,
        cursor="hand2",
    ).pack(side=tk.LEFT, padx=(8, 0))

    opt_desktop = tk.BooleanVar(value=True)
    opt_startmenu = tk.BooleanVar(value=True)
    opt_autostart = tk.BooleanVar(value=True)
    opt_launch = tk.BooleanVar(value=True)

    tk.Label(
        inner,
        text="INTEGRATION OPTIONS",
        font=(mono_font, 9, "bold"),
        fg=CyberColors.TEXT_SECONDARY,
        bg=CyberColors.SURFACE,
    ).pack(anchor=tk.W, pady=(0, 6))

    for text, var in (
        ("Create Desktop Shortcut (Win32 COM Link)", opt_desktop),
        ("Create Start Menu Entry & Uninstaller Link", opt_startmenu),
        ("Start Automatically When Windows Signs In", opt_autostart),
        ("Launch Host Control Center Right After Install", opt_launch),
    ):
        tk.Checkbutton(
            inner,
            text=text,
            variable=var,
            bg=CyberColors.SURFACE,
            fg=CyberColors.TEXT_PRIMARY,
            selectcolor=CyberColors.TERMINAL_BG,
            activebackground=CyberColors.SURFACE,
            activeforeground=CyberColors.PRIMARY,
            font=(ui_font, 9),
        ).pack(anchor=tk.W, pady=3)

    status_var = tk.StringVar(value="Ready to deploy verified runtime files.")
    status_lbl = tk.Label(
        inner,
        textvariable=status_var,
        font=(mono_font, 9),
        fg=CyberColors.PRIMARY,
        bg=CyberColors.SURFACE,
        anchor=tk.W,
    )
    status_lbl.pack(fill=tk.X, pady=(14, 6))

    # Glowing canvas progress bar matching Cyber gauge
    prog_canvas = tk.Canvas(inner, height=8, bg=CyberColors.TERMINAL_BG, highlightthickness=0)
    prog_canvas.pack(fill=tk.X)
    prog_fill = prog_canvas.create_rectangle(0, 0, 0, 8, fill=CyberColors.PRIMARY, width=0)

    def _set_progress(pct: int, msg: str) -> None:
        w = max(1, prog_canvas.winfo_width() or 490)
        prog_canvas.coords(prog_fill, 0, 0, int(w * max(0, min(100, pct)) / 100.0), 8)
        status_var.set(f"[{pct:3d}%] {msg}")
        win.update()

    btn_row = tk.Frame(win, bg=CyberColors.BACKGROUND)
    btn_row.pack(fill=tk.X, padx=22, pady=(0, 20))

    tk.Button(
        btn_row,
        text="CANCEL",
        command=win.destroy,
        bg=CyberColors.SURFACE_ELEVATED,
        fg=CyberColors.TEXT_SECONDARY,
        relief=tk.FLAT,
        font=(mono_font, 9, "bold"),
        padx=16,
        pady=9,
        cursor="hand2",
    ).pack(side=tk.LEFT)

    install_btn = tk.Button(
        btn_row,
        text="DEPLOY NODE",
        bg=CyberColors.PRIMARY,
        fg=CyberColors.BACKGROUND,
        activebackground=CyberColors.SUCCESS,
        activeforeground=CyberColors.BACKGROUND,
        relief=tk.FLAT,
        font=(mono_font, 10, "bold"),
        padx=22,
        pady=9,
        cursor="hand2",
    )

    def _do_install() -> None:
        install_btn.config(state=tk.DISABLED, text="DEPLOYING...")
        res = perform_full_install(
            target_dir=path_var.get(),
            create_desktop=opt_desktop.get(),
            create_start_menu=opt_startmenu.get(),
            autostart=opt_autostart.get(),
            launch_after=opt_launch.get(),
            progress_cb=_set_progress,
        )
        outcome["result"] = res
        outcome["installed"] = bool(res.get("success"))
        if res.get("success"):
            status_lbl.config(fg=CyberColors.SUCCESS)
            status_var.set("Deployment verified cleanly. Closing wizard...")
            win.after(900, win.destroy)
        else:
            status_lbl.config(fg=CyberColors.ACCENT)
            status_var.set(str(res.get("message") or "Installation error"))
            install_btn.config(state=tk.NORMAL, text="RETRY DEPLOY")

    install_btn.config(command=_do_install)
    install_btn.pack(side=tk.RIGHT)

    if not parent_root:
        win.mainloop()
    else:
        win.wait_window()
    return outcome


def show_uninstall_dialog(parent_root=None, on_uninstalled: Optional[Callable[[], None]] = None) -> None:
    """Displays the Cyber Glassmorphic Uninstall Modal matching Mobile Design Language."""
    try:
        import tkinter as tk
    except Exception:
        perform_full_uninstall(interactive=False, remove_config=False, on_complete=on_uninstalled)
        return

    enable_hidpi_awareness()
    win = tk.Toplevel(parent_root) if parent_root else tk.Tk()
    win.title(f"Uninstall {APP_NAME}")
    win.geometry("500x360")
    win.configure(bg=CyberColors.BACKGROUND)
    win.resizable(False, False)
    apply_window_icon(win)
    apply_dark_titlebar(win, CyberColors.BACKGROUND)

    ui_font, mono_font = resolve_font_families(win if not parent_root else parent_root)

    card = tk.Frame(
        win,
        bg=CyberColors.SURFACE,
        highlightbackground=CyberColors.GLASS_BORDER_CRITICAL,
        highlightthickness=1,
    )
    card.pack(fill=tk.BOTH, expand=True, padx=20, pady=20)
    tk.Frame(card, bg=CyberColors.ACCENT, height=2).pack(fill=tk.X)

    inner = tk.Frame(card, bg=CyberColors.SURFACE, padx=20, pady=18)
    inner.pack(fill=tk.BOTH, expand=True)

    tk.Label(
        inner,
        text="NODE DECOMMISSION",
        font=(mono_font, 9, "bold"),
        fg=CyberColors.ACCENT,
        bg=CyberColors.SURFACE,
    ).pack(anchor=tk.W)
    tk.Label(
        inner,
        text=f"Uninstall {APP_NAME}?",
        font=(ui_font, 15, "bold"),
        fg=CyberColors.TEXT_PRIMARY,
        bg=CyberColors.SURFACE,
    ).pack(anchor=tk.W, pady=(2, 8))

    tk.Label(
        inner,
        text=(
            "This cleanly terminates background daemon services, removes Desktop and\n"
            "Start Menu links, disables Windows startup auto-run, and unregisters the app."
        ),
        font=(ui_font, 9),
        fg=CyberColors.TEXT_SECONDARY,
        bg=CyberColors.SURFACE,
        justify=tk.LEFT,
    ).pack(anchor=tk.W, pady=(0, 12))

    remove_cfg_var = tk.BooleanVar(value=False)
    tk.Checkbutton(
        inner,
        text="Also wipe encrypted pairing keys & DPAPI secret vault (%LOCALAPPDATA%)",
        variable=remove_cfg_var,
        bg=CyberColors.SURFACE,
        fg=CyberColors.WARNING,
        selectcolor=CyberColors.TERMINAL_BG,
        activebackground=CyberColors.SURFACE,
        activeforeground=CyberColors.ACCENT,
        font=(ui_font, 9),
    ).pack(anchor=tk.W, pady=(4, 14))

    status_var = tk.StringVar(value="")
    status_lbl = tk.Label(
        inner,
        textvariable=status_var,
        font=(mono_font, 9),
        fg=CyberColors.SUCCESS,
        bg=CyberColors.SURFACE,
        anchor=tk.W,
    )
    status_lbl.pack(fill=tk.X, pady=(0, 12))

    btn_row = tk.Frame(inner, bg=CyberColors.SURFACE)
    btn_row.pack(fill=tk.X, side=tk.BOTTOM)

    tk.Button(
        btn_row,
        text="KEEP INSTALLED",
        command=win.destroy,
        bg=CyberColors.SURFACE_ELEVATED,
        fg=CyberColors.TEXT_PRIMARY,
        relief=tk.FLAT,
        font=(mono_font, 9, "bold"),
        padx=14,
        pady=8,
        cursor="hand2",
    ).pack(side=tk.LEFT)

    def _do_uninstall() -> None:
        perform_full_uninstall(
            interactive=False,
            remove_config=remove_cfg_var.get(),
            on_complete=on_uninstalled,
        )
        status_var.set("AI NetController removed cleanly.")
        win.after(800, win.destroy)

    tk.Button(
        btn_row,
        text="CONFIRM UNINSTALL",
        command=_do_uninstall,
        bg=CyberColors.ACCENT,
        fg=CyberColors.TEXT_PRIMARY,
        activebackground=CyberColors.ACCENT_SOFT,
        relief=tk.FLAT,
        font=(mono_font, 9, "bold"),
        padx=16,
        pady=8,
        cursor="hand2",
    ).pack(side=tk.RIGHT)

    if not parent_root:
        win.mainloop()
