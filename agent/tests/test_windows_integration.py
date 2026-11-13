"""
AI NetController — Windows Integration Test Suite
================================================================================
Verifies checks and balances, single-instance mutex, port health verification,
desktop & start menu shortcut lifecycle, Windows uninstaller registry registration,
and GUI state cross-thread signal dispatch.
================================================================================
"""

import os
import sys
import socket
import unittest
import platform

_AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _AGENT_DIR not in sys.path:
    sys.path.insert(0, _AGENT_DIR)

from windows_integration import (
    SingleInstanceGuard,
    check_port_available,
    create_vbs_shortcut,
    create_desktop_shortcut,
    create_start_menu_shortcut,
    remove_shortcuts,
    set_windows_autostart,
    register_windows_uninstaller,
    unregister_windows_uninstaller,
    perform_full_uninstall,
    IS_WINDOWS,
    APP_NAME,
)
from agent_gui import HostDaemonState


class TestWindowsIntegration(unittest.TestCase):
    """Unit tests for Windows integration, shortcuts, registry, and checks & balances."""

    def test_01_single_instance_guard(self):
        """Verify single instance mutex prevents concurrent daemon instances."""
        test_mutex = f"Global\\AI_NetController_TestMutex_{os.getpid()}"
        guard1 = SingleInstanceGuard(mutex_name=test_mutex)
        self.assertTrue(guard1.acquire(), "First mutex acquire must succeed")
        self.assertFalse(guard1.is_already_running)

        if IS_WINDOWS:
            # Second acquire on same mutex should detect existing instance
            guard2 = SingleInstanceGuard(mutex_name=test_mutex)
            self.assertFalse(guard2.acquire(), "Duplicate mutex acquire must fail")
            self.assertTrue(guard2.is_already_running)
            guard2.release()

        guard1.release()

        # After release, acquire should succeed again
        guard3 = SingleInstanceGuard(mutex_name=test_mutex)
        self.assertTrue(guard3.acquire(), "Acquiring released mutex must succeed")
        guard3.release()

    def test_02_check_port_available(self):
        """Verify port availability detection and collision warning."""
        # Find an open port dynamically
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()

        # Port is now open
        avail, msg = check_port_available(port, "127.0.0.1")
        self.assertTrue(avail, f"Expected port {port} to be available: {msg}")

        # Now bind to port and re-test
        s2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s2.bind(("127.0.0.1", port))
        s2.listen(1)
        try:
            avail2, msg2 = check_port_available(port, "127.0.0.1")
            self.assertFalse(avail2, "Expected bound port to be reported unavailable")
        finally:
            s2.close()

    def test_03_create_and_remove_shortcuts(self):
        """Verify shortcut creation and removal inside a sandboxed temp directory (no host Desktop writes)."""
        import tempfile
        import windows_integration as wi
        from unittest.mock import patch

        with tempfile.TemporaryDirectory(prefix="ainet_shortcut_test_") as tmp:
            fake_desktop = os.path.join(tmp, "Desktop")
            os.makedirs(fake_desktop, exist_ok=True)

            def _fake_vbs(_target_exe, target_lnk, *_args, **_kwargs):
                os.makedirs(os.path.dirname(target_lnk), exist_ok=True)
                with open(target_lnk, "wb") as f:
                    f.write(b"LNK")
                return True

            with (
                patch.object(wi, "IS_WINDOWS", True),
                patch.object(wi, "_resolve_desktop_dir", return_value=fake_desktop),
                patch.object(wi, "create_vbs_shortcut", side_effect=_fake_vbs),
                patch.dict(os.environ, {"USERPROFILE": tmp, "APPDATA": tmp}),
            ):
                ok, msg = wi.create_desktop_shortcut()
                self.assertTrue(ok, f"Desktop shortcut creation failed: {msg}")
                lnk = os.path.join(fake_desktop, f"{APP_NAME}.lnk")
                self.assertTrue(os.path.exists(lnk), f"Shortcut file missing: {lnk}")

                ok2, msg2 = wi.create_start_menu_shortcut()
                self.assertTrue(ok2, f"Start Menu shortcut creation failed: {msg2}")
                sm_lnk = os.path.join(
                    tmp, "Microsoft", "Windows", "Start Menu", "Programs", APP_NAME, f"{APP_NAME}.lnk"
                )
                self.assertTrue(os.path.exists(sm_lnk), f"Start Menu shortcut missing: {sm_lnk}")

                count, _ = wi.remove_shortcuts()
                self.assertGreaterEqual(count, 2)
                self.assertFalse(os.path.exists(lnk), "Shortcut should be removed")
                self.assertFalse(os.path.exists(sm_lnk), "Start Menu shortcut should be removed")

    def test_04_windows_registry_autostart(self):
        """Verify Windows Run autostart registry toggle against an in-memory mock winreg store."""
        import windows_integration as wi
        from unittest.mock import patch

        reg_store = {wi.REG_RUN_KEY: {}}

        class _MockKey:
            def __init__(self, path):
                self.path = path
                reg_store.setdefault(path, {})

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        class _MockWinreg:
            HKEY_CURRENT_USER = object()
            KEY_SET_VALUE = 2
            KEY_READ = 1
            REG_SZ = 1
            REG_DWORD = 4

            @staticmethod
            def OpenKey(_root, subkey, *_args, **_kwargs):
                if subkey not in reg_store:
                    raise FileNotFoundError(subkey)
                return _MockKey(subkey)

            @staticmethod
            def CreateKey(_root, subkey):
                return _MockKey(subkey)

            @staticmethod
            def SetValueEx(key, name, _reserved, _typ, val):
                reg_store[key.path][name] = val

            @staticmethod
            def DeleteValue(key, name):
                if name not in reg_store.get(key.path, {}):
                    raise FileNotFoundError(name)
                del reg_store[key.path][name]

        with patch.object(wi, "IS_WINDOWS", True), patch.object(wi, "winreg", _MockWinreg):
            self.assertTrue(wi.set_windows_autostart(enabled=True))
            run_vals = reg_store.get(wi.REG_RUN_KEY, {})
            self.assertIn("AINetController", run_vals)
            self.assertTrue(wi.set_windows_autostart(enabled=False))
            self.assertNotIn("AINetController", run_vals)

    def test_05_windows_uninstaller_registration(self):
        """Verify Add/Remove programs uninstaller registration using an in-memory mock winreg store."""
        import windows_integration as wi
        from unittest.mock import patch

        reg_store = {}

        class _MockKey:
            def __init__(self, path):
                self.path = path
                reg_store.setdefault(path, {})

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        class _MockWinreg:
            HKEY_CURRENT_USER = object()
            REG_SZ = 1
            REG_DWORD = 4

            @staticmethod
            def OpenKey(_root, subkey, *_args, **_kwargs):
                if subkey not in reg_store:
                    raise FileNotFoundError(subkey)
                return _MockKey(subkey)

            @staticmethod
            def CreateKey(_root, subkey):
                return _MockKey(subkey)

            @staticmethod
            def SetValueEx(key, name, _reserved, _typ, val):
                reg_store[key.path][name] = val

            @staticmethod
            def QueryValueEx(key, name):
                if name not in reg_store.get(key.path, {}):
                    raise FileNotFoundError(name)
                return reg_store[key.path][name], 1

            @staticmethod
            def DeleteKey(_root, subkey):
                if subkey not in reg_store:
                    raise FileNotFoundError(subkey)
                del reg_store[subkey]

        key_path = wi.REG_UNINSTALL_KEY
        with patch.object(wi, "IS_WINDOWS", True), patch.object(wi, "winreg", _MockWinreg):
            self.assertTrue(wi.register_windows_uninstaller())
            self.assertIn(key_path, reg_store)
            self.assertEqual(reg_store[key_path]["DisplayName"], APP_NAME)
            self.assertIn("--uninstall", reg_store[key_path]["UninstallString"])

            self.assertTrue(wi.unregister_windows_uninstaller())
            self.assertNotIn(key_path, reg_store)

    def test_06_perform_full_uninstall(self):
        """Verify complete uninstallation routine in a sandboxed temp filesystem & mock registry."""
        import tempfile
        import windows_integration as wi
        from unittest.mock import patch

        reg_store = {wi.REG_RUN_KEY: {}}

        class _MockKey:
            def __init__(self, path):
                self.path = path
                reg_store.setdefault(path, {})

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        class _MockWinreg:
            HKEY_CURRENT_USER = object()
            KEY_SET_VALUE = 2
            REG_SZ = 1
            REG_DWORD = 4

            @staticmethod
            def OpenKey(_root, subkey, *_args, **_kwargs):
                if subkey not in reg_store:
                    raise FileNotFoundError(subkey)
                return _MockKey(subkey)

            @staticmethod
            def CreateKey(_root, subkey):
                return _MockKey(subkey)

            @staticmethod
            def SetValueEx(key, name, _reserved, _typ, val):
                reg_store[key.path][name] = val

            @staticmethod
            def DeleteValue(key, name):
                if name not in reg_store.get(key.path, {}):
                    raise FileNotFoundError(name)
                del reg_store[key.path][name]

            @staticmethod
            def DeleteKey(_root, subkey):
                if subkey not in reg_store:
                    raise FileNotFoundError(subkey)
                del reg_store[subkey]

        with tempfile.TemporaryDirectory(prefix="ainet_uninstall_test_") as tmp:
            fake_desktop = os.path.join(tmp, "Desktop")
            fake_local = os.path.join(tmp, "LocalAppData")
            fake_roam = os.path.join(tmp, "AppData")
            fake_install = os.path.join(fake_local, "Programs", APP_NAME)
            for p in (fake_desktop, fake_install):
                os.makedirs(p, exist_ok=True)
            with open(os.path.join(fake_desktop, f"{APP_NAME}.lnk"), "wb") as f:
                f.write(b"LNK")

            callback_called = []
            with (
                patch.object(wi, "IS_WINDOWS", True),
                patch.object(wi, "winreg", _MockWinreg),
                patch.object(wi, "_resolve_desktop_dir", return_value=fake_desktop),
                patch.object(wi, "get_default_install_dir", return_value=fake_install),
                patch.object(wi, "_stop_external_agent_processes", return_value=True),
                patch.dict(os.environ, {"USERPROFILE": tmp, "LOCALAPPDATA": fake_local, "APPDATA": fake_roam}),
            ):
                wi.register_windows_uninstaller()
                wi.set_windows_autostart(True)
                res = wi.perform_full_uninstall(
                    interactive=False,
                    on_complete=lambda: callback_called.append(True),
                )
            self.assertTrue(res["success"])
            self.assertTrue(res["removed_uninstaller"])
            self.assertTrue(res["removed_autostart"])
            self.assertEqual(len(callback_called), 1)
            self.assertFalse(os.path.exists(os.path.join(fake_desktop, f"{APP_NAME}.lnk")))
            self.assertNotIn(wi.REG_UNINSTALL_KEY, reg_store)
            self.assertNotIn("AINetController", reg_store.get(wi.REG_RUN_KEY, {}))

    def test_07_gui_cross_thread_requests(self):
        """Verify HostDaemonState handles thread-safe cross-thread UI requests."""
        state = HostDaemonState()
        self.assertFalse(state._show_window_requested)
        self.assertFalse(state._hide_window_requested)
        self.assertFalse(state._uninstall_requested)
        self.assertFalse(state._exit_requested)

        state.request_show_window()
        self.assertTrue(state._show_window_requested)

        state.request_hide_window()
        self.assertTrue(state._hide_window_requested)

        state.request_uninstall()
        self.assertTrue(state._uninstall_requested)

        state.request_full_exit()
        self.assertTrue(state._exit_requested)


if __name__ == "__main__":
    unittest.main()
