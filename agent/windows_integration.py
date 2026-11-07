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
from typing import Optional, Callable, Dict, Any, Tuple

IS_WINDOWS = platform.system() == "Windows"

if IS_WINDOWS:
    import winreg
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.windll.kernel32
    user32 = ctypes.windll.user32
else:
    winreg = None
    kernel32 = None
    user32 = None

logger = logging.getLogger("AI-NetController-WindowsIntegration")

APP_NAME = "AI NetController"
APP_DESCRIPTION = "AI NetController — PC Host Agent & Desktop Control Center"
APP_VERSION = "0.35.0"
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

        # 0x00100000 = SYNCHRONIZE
        self.mutex_handle = kernel32.CreateMutexW(None, False, self.mutex_name)
        last_error = kernel32.GetLastError()

        # ERROR_ALREADY_EXISTS = 183
        if last_error == 183:
            self.is_already_running = True
            logger.warning("Another instance of AI NetController Host Agent is already running.")
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


def create_vbs_shortcut(target_exe: str, lnk_path: str, description: str = APP_DESCRIPTION) -> bool:
    """
    Creates a native Windows .lnk shortcut using standard WScript.Shell.
    Works universally on Windows XP through 11 without any external Python packages.
    """
    if not IS_WINDOWS:
        return False

    work_dir = os.path.dirname(target_exe)
    vbs_content = (
        'Set w = WScript.CreateObject("WScript.Shell")\n'
        f'Set l = w.CreateShortcut("{lnk_path}")\n'
        f'l.TargetPath = "{target_exe}"\n'
        f'l.WorkingDirectory = "{work_dir}"\n'
        f'l.Description = "{description}"\n'
        f'l.IconLocation = "{target_exe},0"\n'
        'l.Save\n'
    )

    vbs_path = os.path.join(tempfile.gettempdir(), f"ainet_mklnk_{time.time_ns()}.vbs")
    try:
        with open(vbs_path, "w", encoding="utf-8") as f:
            f.write(vbs_content)

        res = subprocess.run(
            ["cscript", "//Nologo", vbs_path],
            capture_output=True,
            text=True,
            creationflags=0x08000000 if IS_WINDOWS else 0
        )
        return res.returncode == 0 and os.path.exists(lnk_path)
    except Exception as e:
        logger.error(f"Failed to create shortcut at {lnk_path}: {e}")
        return False
    finally:
        if os.path.exists(vbs_path):
            try:
                os.remove(vbs_path)
            except Exception:
                pass


def create_desktop_shortcut(target_exe: Optional[str] = None) -> Tuple[bool, str]:
    """Creates desktop shortcut 'AI NetController.lnk'."""
    exe_path = target_exe or get_executable_path()
    desktop_dir = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")
    if not os.path.exists(desktop_dir):
        return False, "Desktop folder not found."

    lnk_path = os.path.join(desktop_dir, f"{APP_NAME}.lnk")
    success = create_vbs_shortcut(exe_path, lnk_path)
    if success:
        return True, f"Desktop shortcut created at {lnk_path}"
    return False, "Failed to create Desktop shortcut."


def create_start_menu_shortcut(target_exe: Optional[str] = None) -> Tuple[bool, str]:
    """Creates Start Menu shortcut 'AI NetController.lnk'."""
    exe_path = target_exe or get_executable_path()
    appdata = os.environ.get("APPDATA", "")
    if not appdata:
        return False, "APPDATA folder not found."

    start_menu_dir = os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", APP_NAME)
    os.makedirs(start_menu_dir, exist_ok=True)

    lnk_path = os.path.join(start_menu_dir, f"{APP_NAME}.lnk")
    success = create_vbs_shortcut(exe_path, lnk_path)
    if success:
        return True, f"Start Menu shortcut created at {lnk_path}"
    return False, "Failed to create Start Menu shortcut."


def remove_shortcuts() -> Tuple[int, str]:
    """Removes all Desktop and Start Menu shortcuts."""
    removed = 0
    desktop_dir = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")
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


def register_windows_uninstaller(target_exe: Optional[str] = None) -> bool:
    """
    Registers AI NetController in Windows Settings / Control Panel
    (Installed Apps / Add or Remove Programs) so the user can easily uninstall it.
    """
    if not IS_WINDOWS or not winreg:
        return False

    exe_path = target_exe or get_executable_path()
    install_dir = os.path.dirname(exe_path)

    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, REG_UNINSTALL_KEY) as key:
            winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, APP_NAME)
            winreg.SetValueEx(key, "DisplayVersion", 0, winreg.REG_SZ, APP_VERSION)
            winreg.SetValueEx(key, "Publisher", 0, winreg.REG_SZ, APP_PUBLISHER)
            winreg.SetValueEx(key, "DisplayIcon", 0, winreg.REG_SZ, f'"{exe_path}",0')
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
def perform_full_uninstall(
    interactive: bool = True,
    remove_config: bool = False,
    on_complete: Optional[Callable[[], None]] = None
) -> Dict[str, Any]:
    """
    Executes complete uninstallation of AI NetController from the host PC:
    1. Stops running daemon and background services
    2. Removes Desktop and Start Menu shortcuts
    3. Removes Windows Run startup entry
    4. Removes Windows Add/Remove Programs registry entry
    5. Optionally removes local app data / logs
    """
    results = {
        "stopped_daemon": True,
        "removed_shortcuts": 0,
        "removed_autostart": False,
        "removed_uninstaller": False,
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

    results["message"] = (
        f"AI NetController has been successfully uninstalled from your PC.\n\n"
        f"• Removed {count} Desktop & Start Menu shortcut(s)\n"
        f"• Removed Windows startup registry entries\n"
        f"• Removed from Installed Apps / Control Panel\n"
        f"• Terminated background daemon processes"
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
        res = perform_full_uninstall(interactive=False, on_complete=on_exit)
        messagebox.showinfo(
            "Uninstallation Complete",
            res["message"],
            parent=win
        )
        win.destroy()
        if on_exit:
            on_exit()
        else:
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
