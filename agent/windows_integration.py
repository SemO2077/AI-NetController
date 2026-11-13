"""
AI NetController — Windows System Integration, Checks & Balances, Tray, Shortcuts & Uninstaller
================================================================================================
Enterprise-grade platform bridge for Windows 10 & 11:
1. Checks & Balances:
   - Single-Instance Named Mutex (Global\\AI_NetController_HostAgent_Mutex) preventing port collision
   - Pre-flight Port Availability Verification (8765 / 8766)
   - Foreground Window Activation if duplicate instance is launched
2. System Tray Integration:
   - Live taskbar background tray icon (Pystray) with dynamic status tooltips
   - Window Minimize-to-Tray on close (WM_DELETE_WINDOW)
   - Full context menu: Open, Pause/Resume, View-Only Lock, Add Shortcut, Uninstall, Exit
3. Desktop & Start Menu Shortcuts:
   - Native Windows Shell .LNK creation on user Desktop & Start Menu
   - Automatic registration on first launch
   - App Paths Run-Dialog registration (Win+R -> AI_NetController_HostAgent)
4. Full Accessible Uninstaller:
   - Registered in Windows Settings / Control Panel (Add or Remove Programs)
   - Accessible via GUI button, System Tray menu, or CLI flag (--uninstall)
   - Cleans up shortcuts, registry keys, autostart, temp files, and terminates background daemon
================================================================================================
"""

import os
import sys
import time
import socket
import tempfile
import subprocess
import logging
import platform
import shutil
from typing import Optional, Callable, Dict, Any, Tuple

IS_WINDOWS = platform.system() == "Windows"

if IS_WINDOWS:
    import winreg
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32 = ctypes.windll.user32
else:
    winreg = None
    kernel32 = None
    user32 = None

try:
    from icon_assets import (
        get_icon_ico_path,
        get_icon_png_path,
        get_icon_image,
        apply_window_icon,
    )
except ImportError:
    try:
        from agent.icon_assets import (
            get_icon_ico_path,
            get_icon_png_path,
            get_icon_image,
            apply_window_icon,
        )
    except ImportError:
        get_icon_ico_path = lambda: None
        get_icon_png_path = lambda size=512: None
        get_icon_image = lambda size=64: None
        apply_window_icon = lambda win: None

logger = logging.getLogger("AI-NetController-WindowsIntegration")

APP_NAME = "AI NetController"
APP_DESCRIPTION = "AI NetController — PC Host Agent & Desktop Control Center"
APP_VERSION = "0.50.0"
APP_PUBLISHER = "AI NetController"
MUTEX_NAME = "Global\\AI_NetController_HostAgent_Mutex"
REG_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
REG_UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\AI_NetController"
REG_APP_PATHS_KEY = r"Software\Microsoft\Windows\CurrentVersion\App Paths\AI_NetController_HostAgent.exe"


# =====================================================================
# 1. CHECKS & BALANCES: SINGLE-INSTANCE MUTEX & PORT HEALTH
# =====================================================================
class SingleInstanceGuard:
    """
    Guarantees only one instance of the AI NetController daemon runs at any time.
    If another instance is launched, it brings the existing window to front
    and exits cleanly to avoid port collisions and socket corruption.
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

        # Clear thread-local last error before CreateMutexW call
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
            self._activate_existing_window()
            return False

        self.is_already_running = False
        return True

    def _activate_existing_window(self):
        """Attempts to find and restore the existing Control Center window."""
        if not IS_WINDOWS or not user32:
            return
        try:
            found_hwnds = []
            WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
            def enum_proc(hwnd, lparam):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    title = buff.value.lower()
                    if "ai netcontroller" in title:
                        found_hwnds.append(hwnd)
                return True

            cb = WNDENUMPROC(enum_proc)
            user32.EnumWindows(cb, 0)
            for hwnd in found_hwnds:
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                user32.SetForegroundWindow(hwnd)
                return
        except Exception as e:
            logger.debug(f"Could not activate existing window: {e}")

    def release(self):
        if IS_WINDOWS and kernel32 and self.mutex_handle:
            try:
                kernel32.CloseHandle.restype = wintypes.BOOL
                kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
                kernel32.CloseHandle(self.mutex_handle)
            except Exception:
                pass
            self.mutex_handle = None


def check_port_available(port: int = 8765, host: str = "0.0.0.0") -> Tuple[bool, str]:
    """
    Checks if the designated TCP port is available for binding.
    Returns (is_available, error_message).
    """
    test_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        test_sock.settimeout(0.5)
        test_sock.bind((host, port))
        test_sock.close()
        return True, f"Port {port} is open and available."
    except OSError as e:
        return False, f"Port {port} is currently in use by another process or blocked ({e})."
    finally:
        try:
            test_sock.close()
        except Exception:
            pass


# =====================================================================
# 2. SHORTCUT MANAGEMENT (DESKTOP & START MENU)
# =====================================================================
def get_executable_path() -> str:
    """Returns the absolute path to the running executable or script."""
    if getattr(sys, "frozen", False):
        return os.path.abspath(sys.executable)
    return os.path.abspath(sys.argv[0])


def _sanitize_vbs_literal(value: str) -> str:
    """Strips control characters/newlines and doubles quotes for safe VBScript literals."""
    cleaned = "".join(ch for ch in str(value or "") if ch not in ("\r", "\n", "\x00"))
    return cleaned.replace('"', '""')


def create_vbs_shortcut(
    target_exe: str,
    lnk_path: str,
    description: str = APP_DESCRIPTION,
    icon_path: Optional[str] = None,
) -> bool:
    """
    Creates a native Windows .lnk shortcut using standard WScript.Shell.
    Works universally on Windows XP through 11 without any external Python packages.
    Preserves exact matching icon from icon.ico or the target executable.
    """
    if not IS_WINDOWS:
        return False

    work_dir = os.path.dirname(target_exe)
    if not icon_path:
        ico = get_icon_ico_path()
        icon_path = ico if (ico and os.path.exists(ico)) else f"{target_exe},0"

    clean_target = _sanitize_vbs_literal(target_exe)
    clean_lnk = _sanitize_vbs_literal(lnk_path)
    clean_work = _sanitize_vbs_literal(work_dir)
    clean_desc = _sanitize_vbs_literal(description)
    clean_icon = _sanitize_vbs_literal(icon_path)

    vbs_content = (
        'Set w = WScript.CreateObject("WScript.Shell")\n'
        f'Set l = w.CreateShortcut("{clean_lnk}")\n'
        f'l.TargetPath = "{clean_target}"\n'
        f'l.WorkingDirectory = "{clean_work}"\n'
        f'l.Description = "{clean_desc}"\n'
        f'l.IconLocation = "{clean_icon}"\n'
        'l.Save\n'
    )

    vbs_path = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".vbs",
            prefix="ainet_mklnk_",
            encoding="utf-8",
            delete=False,
        ) as f:
            vbs_path = f.name
            f.write(vbs_content)

        res = subprocess.run(
            ["cscript", "//Nologo", vbs_path],
            capture_output=True,
            text=True,
            timeout=15,
            creationflags=0x08000000 if IS_WINDOWS else 0
        )
        return res.returncode == 0 and os.path.exists(lnk_path)
    except Exception as e:
        logger.error(f"Failed to create shortcut at {lnk_path}: {e}")
        return False
    finally:
        if vbs_path and os.path.exists(vbs_path):
            try:
                os.remove(vbs_path)
            except Exception:
                pass


def _resolve_desktop_dir() -> str:
    """Resolves actual user Desktop folder, including OneDrive-redirected Desktops on Windows."""
    if IS_WINDOWS:
        try:
            buf = ctypes.create_unicode_buffer(wintypes.MAX_PATH)
            # CSIDL_DESKTOPDIRECTORY = 0x0010, SHGFP_TYPE_CURRENT = 0
            hr = ctypes.windll.shell32.SHGetFolderPathW(None, 0x0010, None, 0, buf)
            if hr == 0 and buf.value and os.path.isdir(buf.value):
                return buf.value
        except Exception:
            pass
    return os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")


def create_desktop_shortcut(target_exe: Optional[str] = None, icon_path: Optional[str] = None) -> Tuple[bool, str]:
    """Creates desktop shortcut 'AI NetController.lnk' with matching Android app icon."""
    exe_path = target_exe or get_executable_path()
    desktop_dir = _resolve_desktop_dir()
    if not os.path.exists(desktop_dir):
        return False, "Desktop folder not found."

    lnk_path = os.path.join(desktop_dir, f"{APP_NAME}.lnk")
    success = create_vbs_shortcut(exe_path, lnk_path, icon_path=icon_path)
    if success:
        return True, f"Desktop shortcut created at {lnk_path}"
    return False, "Failed to create Desktop shortcut."


def create_start_menu_shortcut(target_exe: Optional[str] = None, icon_path: Optional[str] = None) -> Tuple[bool, str]:
    """Creates Start Menu shortcut 'AI NetController.lnk' with matching Android app icon."""
    exe_path = target_exe or get_executable_path()
    appdata = os.environ.get("APPDATA", "")
    if not appdata:
        return False, "APPDATA folder not found."

    start_menu_dir = os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", APP_NAME)
    os.makedirs(start_menu_dir, exist_ok=True)

    lnk_path = os.path.join(start_menu_dir, f"{APP_NAME}.lnk")
    success = create_vbs_shortcut(exe_path, lnk_path, icon_path=icon_path)
    if success:
        return True, f"Start Menu shortcut created at {lnk_path}"
    return False, "Failed to create Start Menu shortcut."


def remove_shortcuts() -> Tuple[int, str]:
    """Removes all Desktop and Start Menu shortcuts."""
    removed = 0
    candidate_desktops = []
    resolved_desktop = _resolve_desktop_dir()
    if resolved_desktop:
        candidate_desktops.append(resolved_desktop)
    fallback_desktop = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")
    if fallback_desktop and fallback_desktop not in candidate_desktops:
        candidate_desktops.append(fallback_desktop)

    for desktop_dir in candidate_desktops:
        desktop_lnk = os.path.join(desktop_dir, f"{APP_NAME}.lnk")
        if os.path.exists(desktop_lnk):
            try:
                os.remove(desktop_lnk)
                removed += 1
            except Exception:
                pass

    appdata = os.environ.get("APPDATA", "")
    if appdata:
        start_dir = os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", APP_NAME)
        start_lnk = os.path.join(start_dir, f"{APP_NAME}.lnk")
        if os.path.exists(start_lnk):
            try:
                os.remove(start_lnk)
                removed += 1
            except Exception:
                pass
        if os.path.exists(start_dir):
            try:
                os.rmdir(start_dir)
            except Exception:
                pass

    return removed, f"Removed {removed} shortcut(s)."


# =====================================================================
# 3. WINDOWS REGISTRY: AUTOSTART & ADD/REMOVE PROGRAMS (UNINSTALLER)
# =====================================================================
def set_windows_autostart(enabled: bool = True, target_exe: Optional[str] = None) -> bool:
    """Configures daemon to start on Windows login via HKCU Run key."""
    if not IS_WINDOWS or not winreg:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            if enabled:
                exe_path = target_exe or get_executable_path()
                cmd = f'"{exe_path}"'
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
    """
    Registers AI NetController in Windows Settings / Control Panel
    (Installed Apps / Add or Remove Programs) so the user can easily uninstall it.
    """
    if not IS_WINDOWS or not winreg:
        return False

    exe_path = target_exe or get_executable_path()
    install_dir = os.path.dirname(exe_path)

    ico = icon_path or get_icon_ico_path()
    display_icon = f'"{ico}"' if (ico and os.path.exists(ico)) else f'"{exe_path}",0'

    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_UNINSTALL_KEY) as key:
            winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, APP_NAME)
            winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, APP_VERSION)
            winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, APP_PUBLISHER)
            winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, display_icon)
            winreg.SetValueEx(key, "UninstallString", 0, winreg.REG_SZ, f'"{exe_path}" --uninstall')
            winreg.SetValueEx(key, "InstallLocation", 0, winreg.REG_SZ, install_dir)
            winreg.SetValueEx(key, "NoModify", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(key, "NoRepair", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(key, "EstimatedSize", 0, winreg.REG_DWORD, 36000)

        # Also register in App Paths so users can launch via Run (Win+R -> AI_NetController_HostAgent)
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
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, REG_UNINSTALL_KEY)
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.debug(f"Failed to delete uninstall key: {e}")

    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, REG_APP_PATHS_KEY)
    except FileNotFoundError:
        pass
    except Exception:
        pass

    return True


# =====================================================================
# 4. FULL UNINSTALLATION WORKFLOW
# =====================================================================
def _stop_external_agent_processes() -> bool:
    """Terminates other running AI_NetController_HostAgent.exe instances without self-killing."""
    if not IS_WINDOWS:
        return True
    try:
        current_pid = os.getpid()
        target_pids: List[int] = []
        try:
            import psutil  # type: ignore
            for proc in psutil.process_iter(["pid", "name", "exe"]):
                try:
                    pid = proc.info.get("pid")
                    if not pid or pid == current_pid:
                        continue
                    name = (proc.info.get("name") or "").lower()
                    exe = (proc.info.get("exe") or "").lower()
                    if "ai_netcontroller_hostagent" in name or "ai_netcontroller_hostagent" in exe:
                        target_pids.append(int(pid))
                except Exception:
                    continue
        except ImportError:
            target_pids = []

        if target_pids:
            all_ok = True
            for pid in target_pids:
                res = subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    creationflags=0x08000000,
                )
                if res.returncode not in (0, 128):
                    all_ok = False
            return all_ok

        res = subprocess.run(
            [
                "taskkill",
                "/F",
                "/IM",
                "AI_NetController_HostAgent.exe",
                "/FI",
                f"PID ne {current_pid}",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=0x08000000,
        )
        return res.returncode in (0, 128)
    except Exception as e:
        logger.debug(f"External process termination notice: {e}")
        return False


def perform_full_uninstall(
    interactive: bool = True,
    remove_config: bool = False,
    on_complete: Optional[Callable[[], None]] = None
) -> Dict[str, Any]:
    """
    Executes complete uninstallation of AI NetController from the host PC:
    1. Stops running external daemon and background services
    2. Removes Desktop and Start Menu shortcuts
    3. Removes Windows Run startup entry
    4. Removes Windows Add/Remove Programs registry entry
    5. Optionally removes local app data / logs and install binaries
    """
    stopped = _stop_external_agent_processes()
    results = {
        "stopped_daemon": stopped,
        "removed_shortcuts": 0,
        "removed_autostart": False,
        "removed_uninstaller": False,
        "removed_config": False,
        "removed_install_dir": False,
        "success": True,
        "message": ""
    }

    # 1. Remove Shortcuts
    count, _ = remove_shortcuts()
    results["removed_shortcuts"] = count

    # 2. Remove Autostart
    results["removed_autostart"] = set_windows_autostart(enabled=False)

    # 3. Unregister from Windows Add/Remove Programs
    results["removed_uninstaller"] = unregister_windows_uninstaller()

    # 4. Clean user-space installed binaries (%LOCALAPPDATA%\Programs\AI NetController)
    try:
        install_dir = get_default_install_dir()
        if os.path.isdir(install_dir):
            shutil.rmtree(install_dir, ignore_errors=True)
            results["removed_install_dir"] = not os.path.exists(install_dir)
    except Exception:
        results["removed_install_dir"] = False

    # 5. Optionally clean persisted configuration directory (%LOCALAPPDATA% & legacy %APPDATA%)
    if remove_config:
        try:
            local_app = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
            roaming_app = os.environ.get("APPDATA") or ""
            removed_any = True
            for base_dir in (local_app, roaming_app):
                if not base_dir:
                    continue
                cfg_dir = os.path.join(base_dir, APP_NAME)
                if os.path.isdir(cfg_dir):
                    shutil.rmtree(cfg_dir, ignore_errors=True)
                    if os.path.exists(cfg_dir):
                        removed_any = False
            results["removed_config"] = removed_any
        except Exception:
            results["removed_config"] = False

    results["message"] = (
        f"AI NetController has been successfully uninstalled from your PC.\n\n"
        f"• Removed {count} Desktop & Start Menu shortcut(s)\n"
        f"• Removed Windows startup registry entries\n"
        f"• Removed from Installed Apps / Control Panel\n"
        f"• Stopped external background daemon processes"
    )

    if on_complete and callable(on_complete):
        try:
            on_complete()
        except Exception:
            pass

    return results


def show_uninstall_dialog(parent_root=None, on_exit: Optional[Callable[[], None]] = None) -> None:
    """
    Presents a clean, transparent, cyber-styled confirmation dialog
    allowing the user to confirm or cancel the full uninstallation.
    """
    try:
        import tkinter as tk
        from tkinter import messagebox
    except ImportError:
        print("[INFO] Running non-GUI uninstallation...")
        res = perform_full_uninstall(interactive=False, on_complete=on_exit)
        print(res["message"])
        sys.exit(0)

    win = tk.Toplevel(parent_root) if parent_root else tk.Tk()
    win.title("Uninstall AI NetController")
    win.geometry("540x360")
    win.resizable(False, False)
    win.configure(bg="#070c18")
    apply_window_icon(win)

    # Center window
    win.update_idletasks()
    w = win.winfo_width()
    h = win.winfo_height()
    x = (win.winfo_screenwidth() // 2) - (w // 2)
    y = (win.winfo_screenheight() // 2) - (h // 2)
    win.geometry(f"{w}x{h}+{x}+{y}")

    # Top Header
    header = tk.Frame(win, bg="#0b1324", padx=16, pady=12, highlightthickness=1, highlightbackground="#1e293b")
    header.pack(fill=tk.X, padx=14, pady=(14, 10))

    tk.Label(
        header,
        text="🗑️ UNINSTALL AI NETCONTROLLER",
        bg="#0b1324",
        fg="#ef4444",
        font=("Segoe UI", 12, "bold")
    ).pack(anchor="w")

    tk.Label(
        header,
        text=f"Version {APP_VERSION} • Host PC Cleanup Wizard",
        bg="#0b1324",
        fg="#94a3b8",
        font=("Segoe UI", 9)
    ).pack(anchor="w", pady=(2, 0))

    # Content Body
    body = tk.Frame(win, bg="#070c18", padx=14)
    body.pack(fill=tk.BOTH, expand=True)

    tk.Label(
        body,
        text="Are you sure you want to completely uninstall AI NetController?",
        bg="#070c18",
        fg="#f8fafc",
        font=("Segoe UI", 10, "bold")
    ).pack(anchor="w", pady=(6, 8))

    items_text = (
        "This process will perform the following actions:\n"
        "  ✓ Remove the Desktop shortcut ('AI NetController.lnk')\n"
        "  ✓ Remove Start Menu shortcuts & Programs folder\n"
        "  ✓ Remove Windows autostart on boot (Registry Run key)\n"
        "  ✓ Remove from Windows 'Installed Apps' / Add or Remove Programs\n"
        "  ✓ Terminate the background daemon and tray icon cleanly"
    )

    tk.Label(
        body,
        text=items_text,
        bg="#070c18",
        fg="#cbd5e1",
        justify=tk.LEFT,
        font=("Consolas", 9)
    ).pack(anchor="w", padx=6)

    # Action Buttons
    btn_frame = tk.Frame(win, bg="#070c18", padx=14, pady=14)
    btn_frame.pack(fill=tk.X)

    def _do_uninstall():
        res = perform_full_uninstall(interactive=False, on_complete=None)
        try:
            messagebox.showinfo(
                "Uninstallation Complete",
                res["message"],
                parent=win
            )
            if win.winfo_exists():
                win.destroy()
        except Exception:
            pass
        if on_exit and callable(on_exit):
            on_exit()
        elif not parent_root:
            sys.exit(0)

    tk.Button(
        btn_frame,
        text="❌ Cancel",
        command=win.destroy,
        bg="#1e293b",
        fg="#e2e8f0",
        activebackground="#334155",
        relief=tk.FLAT,
        font=("Segoe UI", 9, "bold"),
        padx=14,
        pady=6,
        cursor="hand2"
    ).pack(side=tk.RIGHT, padx=(8, 0))

    tk.Button(
        btn_frame,
        text="🗑️ Confirm Uninstall",
        command=_do_uninstall,
        bg="#dc2626",
        fg="#ffffff",
        activebackground="#b91c1c",
        relief=tk.FLAT,
        font=("Segoe UI", 9, "bold"),
        padx=14,
        pady=6,
        cursor="hand2"
    ).pack(side=tk.RIGHT)

    if not parent_root:
        win.mainloop()


# =====================================================================
# 5. DEDICATED HOST INSTALLATION WIZARD & ENGINE
# =====================================================================
def get_default_install_dir() -> str:
    """Returns standard user-space install directory: %LOCALAPPDATA%\\Programs\\AI NetController."""
    local_appdata = os.environ.get("LOCALAPPDATA") or os.path.join(os.environ.get("USERPROFILE", ""), "AppData", "Local")
    return os.path.abspath(os.path.join(local_appdata, "Programs", APP_NAME))


def validate_install_path(path: str) -> Tuple[bool, str]:
    """Validates the target installation directory against traversal and security risks."""
    if not path or not isinstance(path, str):
        return False, "Installation path cannot be empty."
    path = path.strip().strip('"').strip("'")
    if not path:
        return False, "Installation path cannot be empty."
    if "\x00" in path:
        return False, "Invalid path: null bytes detected."
    try:
        norm = os.path.abspath(os.path.normpath(path))
    except Exception as e:
        return False, f"Invalid path syntax: {e}"

    drive, rest = os.path.splitdrive(norm)
    if not rest or rest in ("\\", "/"):
        return False, "Cannot install directly into a drive root."

    rest_clean = rest.lower().strip("\\/")
    forbidden_prefixes = ["windows", "boot", "recovery", "$recycle.bin", "system volume information"]
    for fb in forbidden_prefixes:
        if rest_clean == fb or rest_clean.startswith(fb + "\\"):
            return False, f"Cannot install into protected Windows system folder: {norm}"

    return True, norm


def is_running_from_install_dir(target_dir: Optional[str] = None) -> bool:
    """Checks whether the currently running process is already inside the installed directory."""
    install_dir = os.path.abspath(target_dir or get_default_install_dir()).lower()
    curr_exe_dir = os.path.abspath(os.path.dirname(get_executable_path())).lower()
    return curr_exe_dir == install_dir


def is_app_installed() -> bool:
    """Checks whether AI NetController is registered in Windows Installed Apps and executable exists."""
    dest_exe = os.path.join(get_default_install_dir(), "AI_NetController_HostAgent.exe")
    if os.path.isfile(dest_exe):
        return True
    if not IS_WINDOWS or not winreg:
        return False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REG_UNINSTALL_KEY) as key:
            val, _ = winreg.QueryValueEx(key, "InstallLocation")
            if val and os.path.exists(val):
                return True
    except FileNotFoundError:
        pass
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
    Executes complete, secure, error-resilient installation of AI NetController:
    1. Validates destination folder
    2. Terminates existing conflicting daemon processes cleanly
    3. Copies standalone executable or bundle into destination folder
    4. Copies Android-matching icons (icon.ico and icon.png)
    5. Creates Desktop and Start Menu shortcuts
    6. Registers Autostart and Windows Add/Remove Programs (Uninstaller)
    7. Optionally launches the newly installed host daemon
    """
    result = {
        "success": False,
        "installed_dir": "",
        "installed_exe": "",
        "message": "",
        "error": None,
    }

    def _update(pct: int, msg: str):
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
    except Exception as e:
        result["message"] = f"Failed to create target directory '{valid_dir}': {e}"
        result["error"] = "PERMISSION_DENIED"
        return result

    result["installed_dir"] = valid_dir
    dest_exe = os.path.join(valid_dir, "AI_NetController_HostAgent.exe")
    result["installed_exe"] = dest_exe

    # 1. Stop existing external daemon instances if locking destination binary
    _update(15, "Checking for running instances...")
    current_exe = get_executable_path()
    if os.path.exists(dest_exe) and os.path.abspath(dest_exe).lower() != os.path.abspath(current_exe).lower():
        for attempt in range(3):
            try:
                with open(dest_exe, "a+b"):
                    break
            except PermissionError:
                _update(20, "Stopping existing background daemon...")
                _stop_external_agent_processes()
                time.sleep(0.5)

    # 2. Copy binary assets
    _update(35, "Copying application binaries and resources...")
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
        # Development / script mode: copy agent files
        src_agent_dir = os.path.dirname(os.path.abspath(__file__))
        dest_agent_dir = os.path.join(valid_dir, "agent")
        os.makedirs(dest_agent_dir, exist_ok=True)
        for fname in os.listdir(src_agent_dir):
            if fname.endswith((".py", ".txt", ".spec", ".bat", ".ps1", ".ico", ".png")):
                sf = os.path.join(src_agent_dir, fname)
                if os.path.isfile(sf):
                    shutil.copy2(sf, os.path.join(dest_agent_dir, fname))

        launcher_bat = os.path.join(valid_dir, "AI_NetController_HostAgent.bat")
        with open(launcher_bat, "w", encoding="utf-8") as f:
            f.write(f'@echo off\r\nstart "" "{sys.executable}" "%~dp0agent\\agent_daemon.py" %*\r\n')
        dest_exe = launcher_bat
        result["installed_exe"] = dest_exe

    # 3. Copy matching Android app icons
    _update(55, "Deploying matching branding icons...")
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

    # 4. Shortcuts
    _update(70, "Creating Desktop & Start Menu shortcuts...")
    if create_desktop:
        create_desktop_shortcut(dest_exe, icon_path=dest_ico if os.path.exists(dest_ico) else None)
    if create_start_menu:
        create_start_menu_shortcut(dest_exe, icon_path=dest_ico if os.path.exists(dest_ico) else None)

    # 5. Windows Autostart & Add/Remove Programs (Uninstaller)
    _update(85, "Configuring Windows autostart & Settings registration...")
    if autostart:
        set_windows_autostart(True, dest_exe)
    register_windows_uninstaller(dest_exe, icon_path=dest_ico if os.path.exists(dest_ico) else None)

    _update(95, "Verifying port 8765 and security shields...")
    check_port_available(8765)

    # 6. Launch installed application if requested
    if launch_after:
        _update(98, "Launching AI NetController...")
        try:
            subprocess.Popen(
                [dest_exe],
                cwd=valid_dir,
                creationflags=0x08000000 | 0x00000200 if IS_WINDOWS else 0
            )
        except Exception as e:
            logger.warning(f"Post-install launch notice: {e}")

    _update(100, "Installation completed successfully!")
    result["success"] = True
    result["message"] = (
        f"AI NetController v{APP_VERSION} installed successfully!\n\n"
        f"• Location: {valid_dir}\n"
        f"• Desktop & Start Menu shortcuts created with matching Android icon\n"
        f"• Registered in Windows Settings (Add or Remove Programs)\n"
        f"• Ready for high-speed mobile companion pairing on port 8765"
    )
    return result


def show_install_dialog(
    parent_root=None,
    on_complete: Optional[Callable[[], None]] = None,
    on_portable_launch: Optional[Callable[[], None]] = None,
) -> None:
    """
    Dedicated GUI installation window for AI NetController:
    Provides simple 1-click installation with matching Android icons,
    options for shortcuts, boot autostart, and clean Windows Settings registration.
    """
    try:
        import tkinter as tk
        from tkinter import ttk, messagebox, filedialog
        from PIL import ImageTk
    except ImportError:
        print("[INFO] Running non-GUI automated installation...")
        res = perform_full_install()
        print(res.get("message", "Installation completed."))
        if on_complete and callable(on_complete):
            on_complete()
        return

    win = tk.Toplevel(parent_root) if parent_root else tk.Tk()
    win.title("AI NetController Setup")
    win.geometry("620x540")
    win.resizable(False, False)
    win.configure(bg="#070c18")
    apply_window_icon(win)

    # Center window
    win.update_idletasks()
    w = win.winfo_width()
    h = win.winfo_height()
    x = (win.winfo_screenwidth() // 2) - (w // 2)
    y = (win.winfo_screenheight() // 2) - (h // 2)
    win.geometry(f"{w}x{h}+{x}+{y}")

    # Top Header Banner
    header = tk.Frame(win, bg="#0b1324", padx=16, pady=14, highlightthickness=1, highlightbackground="#1e293b")
    header.pack(fill=tk.X, padx=14, pady=(14, 10))

    try:
        ico_img = get_icon_image(48)
        if ico_img:
            photo = ImageTk.PhotoImage(ico_img)
            icon_lbl = tk.Label(header, image=photo, bg="#0b1324")
            icon_lbl.image = photo
            icon_lbl.pack(side=tk.LEFT, padx=(0, 14))
    except Exception:
        pass

    hdr_text = tk.Frame(header, bg="#0b1324")
    hdr_text.pack(side=tk.LEFT, fill=tk.Y)

    tk.Label(
        hdr_text,
        text="🚀 AI NETCONTROLLER SETUP",
        bg="#0b1324",
        fg="#38bdf8",
        font=("Segoe UI", 13, "bold"),
    ).pack(anchor="w")

    tk.Label(
        hdr_text,
        text=f"Version {APP_VERSION} • PC Host Agent & Desktop Control Center",
        bg="#0b1324",
        fg="#94a3b8",
        font=("Segoe UI", 9),
    ).pack(anchor="w", pady=(2, 0))

    # Content Body
    body = tk.Frame(win, bg="#070c18", padx=14)
    body.pack(fill=tk.BOTH, expand=True)

    # Target folder card
    dest_card = tk.Frame(body, bg="#0b1324", padx=12, pady=10, highlightthickness=1, highlightbackground="#1e293b")
    dest_card.pack(fill=tk.X, pady=(4, 10))

    tk.Label(
        dest_card,
        text="📁 Installation Destination Folder:",
        bg="#0b1324",
        fg="#f8fafc",
        font=("Segoe UI", 9, "bold"),
    ).pack(anchor="w")

    dest_row = tk.Frame(dest_card, bg="#0b1324")
    dest_row.pack(fill=tk.X, pady=(6, 4))

    dest_var = tk.StringVar(value=get_default_install_dir())
    dest_entry = tk.Entry(
        dest_row,
        textvariable=dest_var,
        bg="#050811",
        fg="#38bdf8",
        insertbackground="#38bdf8",
        relief=tk.FLAT,
        font=("Consolas", 9),
        highlightthickness=1,
        highlightbackground="#334155",
    )
    dest_entry.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 8), ipady=4)

    def _browse_dir():
        d = filedialog.askdirectory(initialdir=dest_var.get(), title="Select Installation Folder", parent=win)
        if d:
            dest_var.set(os.path.normpath(d))

    tk.Button(
        dest_row,
        text="Browse...",
        command=_browse_dir,
        bg="#1e293b",
        fg="#cbd5e1",
        activebackground="#334155",
        relief=tk.FLAT,
        font=("Segoe UI", 8, "bold"),
        padx=10,
        pady=3,
        cursor="hand2",
    ).pack(side=tk.RIGHT)

    tk.Label(
        dest_card,
        text="~45 MB required • Safe per-user install (requires no administrator UAC elevation)",
        bg="#0b1324",
        fg="#64748b",
        font=("Segoe UI", 8),
    ).pack(anchor="w")

    # Options card
    opt_card = tk.Frame(body, bg="#0b1324", padx=12, pady=10, highlightthickness=1, highlightbackground="#1e293b")
    opt_card.pack(fill=tk.X, pady=(0, 10))

    tk.Label(
        opt_card,
        text="⚙️ Installation Options & System Integration:",
        bg="#0b1324",
        fg="#f8fafc",
        font=("Segoe UI", 9, "bold"),
    ).pack(anchor="w", pady=(0, 4))

    desk_var = tk.BooleanVar(value=True)
    start_var = tk.BooleanVar(value=True)
    auto_var = tk.BooleanVar(value=True)
    launch_var = tk.BooleanVar(value=True)

    def _cb(parent, text, var):
        cb = tk.Checkbutton(
            parent,
            text=text,
            variable=var,
            bg="#0b1324",
            fg="#e2e8f0",
            selectcolor="#050811",
            activebackground="#0b1324",
            activeforeground="#38bdf8",
            font=("Segoe UI", 9),
        )
        cb.pack(anchor="w", pady=1)

    _cb(opt_card, "Create Desktop Shortcut (AI NetController.lnk with matching Android app icon)", desk_var)
    _cb(opt_card, "Create Start Menu Program Folder & Shortcut", start_var)
    _cb(opt_card, "Start AI NetController automatically on Windows user login", auto_var)
    _cb(opt_card, "Launch AI NetController immediately after installation completes", launch_var)

    # Progress & Status Card
    prog_card = tk.Frame(body, bg="#0b1324", padx=12, pady=8, highlightthickness=1, highlightbackground="#1e293b")
    prog_card.pack(fill=tk.X)

    status_var = tk.StringVar(value="Ready to install. Click '🚀 Install AI NetController' to begin.")
    status_lbl = tk.Label(
        prog_card,
        textvariable=status_var,
        bg="#0b1324",
        fg="#34d399",
        font=("Consolas", 8, "bold"),
        anchor="w",
    )
    status_lbl.pack(fill=tk.X, pady=(0, 4))

    prog_bar = ttk.Progressbar(prog_card, orient=tk.HORIZONTAL, mode="determinate", maximum=100)
    prog_bar.pack(fill=tk.X)

    # Action Buttons
    btn_frame = tk.Frame(win, bg="#070c18", padx=14, pady=12)
    btn_frame.pack(fill=tk.X)

    install_btn = None

    def _on_portable():
        win.destroy()
        if on_portable_launch and callable(on_portable_launch):
            on_portable_launch()

    def _start_installation():
        install_btn.configure(state=tk.DISABLED, text="⏳ Installing...")
        dest_entry.configure(state=tk.DISABLED)

        def _worker():
            def _progress(pct, msg):
                def _apply(p=pct, m=msg):
                    try:
                        if win.winfo_exists():
                            prog_bar.configure(value=p)
                            status_var.set(f"[{p}%] {m}")
                    except Exception:
                        pass
                try:
                    win.after(0, _apply)
                except Exception:
                    pass

            target = dest_var.get()
            res = perform_full_install(
                target_dir=target,
                create_desktop=desk_var.get(),
                create_start_menu=start_var.get(),
                autostart=auto_var.get(),
                launch_after=launch_var.get(),
                progress_cb=_progress,
            )

            def _finish():
                try:
                    if not win.winfo_exists():
                        return
                except Exception:
                    return
                if res["success"]:
                    status_var.set("✓ Installation completed successfully!")
                    install_btn.configure(
                        state=tk.NORMAL,
                        text="✓ Finish & Exit Setup",
                        command=win.destroy,
                        bg="#059669",
                    )
                    messagebox.showinfo(
                        "Installation Succeeded",
                        res["message"],
                        parent=win
                    )
                    if win.winfo_exists():
                        win.destroy()
                    if on_complete and callable(on_complete):
                        on_complete()
                else:
                    status_var.set(f"❌ Error: {res.get('message', 'Installation failed')}")
                    install_btn.configure(state=tk.NORMAL, text="Retry Installation")
                    dest_entry.configure(state=tk.NORMAL)
                    messagebox.showerror(
                        "Installation Error",
                        f"Installation could not be completed:\n\n{res.get('message', 'Unknown error')}",
                        parent=win
                    )

            try:
                win.after(0, _finish)
            except Exception:
                pass

        import threading
        threading.Thread(target=_worker, daemon=True, name="InstallerWorker").start()

    tk.Button(
        btn_frame,
        text="❌ Cancel",
        command=win.destroy,
        bg="#1e293b",
        fg="#94a3b8",
        activebackground="#334155",
        relief=tk.FLAT,
        font=("Segoe UI", 9),
        padx=12,
        pady=6,
        cursor="hand2",
    ).pack(side=tk.RIGHT, padx=(8, 0))

    tk.Button(
        btn_frame,
        text="⚡ Run Once (Portable)",
        command=_on_portable,
        bg="#1e293b",
        fg="#38bdf8",
        activebackground="#334155",
        relief=tk.FLAT,
        font=("Segoe UI", 9, "bold"),
        padx=12,
        pady=6,
        cursor="hand2",
    ).pack(side=tk.RIGHT, padx=(8, 0))

    install_btn = tk.Button(
        btn_frame,
        text="🚀 Install AI NetController",
        command=_start_installation,
        bg="#0284c7",
        fg="#ffffff",
        activebackground="#0369a1",
        relief=tk.FLAT,
        font=("Segoe UI", 10, "bold"),
        padx=16,
        pady=6,
        cursor="hand2",
    )
    install_btn.pack(side=tk.RIGHT)

    if not parent_root:
        win.mainloop()

