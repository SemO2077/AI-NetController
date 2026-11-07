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
        """Verify shortcut creation and removal."""
        if not IS_WINDOWS:
            self.skipTest("Shortcut test requires Windows")

        # Test desktop shortcut creation
        ok, msg = create_desktop_shortcut()
        self.assertTrue(ok, f"Desktop shortcut creation failed: {msg}")

        desktop = os.path.join(os.environ.get("USERPROFILE", ""), "Desktop")
        lnk = os.path.join(desktop, f"{APP_NAME}.lnk")
        self.assertTrue(os.path.exists(lnk), f"Shortcut file missing: {lnk}")

        # Test start menu shortcut creation
        ok2, msg2 = create_start_menu_shortcut()
        self.assertTrue(ok2, f"Start Menu shortcut creation failed: {msg2}")

        # Test remove_shortcuts cleans them both up
        count, r_msg = remove_shortcuts()
        self.assertGreaterEqual(count, 1)
        self.assertFalse(os.path.exists(lnk), "Shortcut should be removed")

    def test_04_windows_registry_autostart(self):
        """Verify Windows Run autostart registry toggle."""
        if not IS_WINDOWS:
            self.skipTest("Registry test requires Windows")

        # Enable autostart
        self.assertTrue(set_windows_autostart(enabled=True))
        # Disable autostart
        self.assertTrue(set_windows_autostart(enabled=False))

    def test_05_windows_uninstaller_registration(self):
        """Verify Add/Remove programs uninstaller registration and deregistration."""
        if not IS_WINDOWS:
            self.skipTest("Uninstaller test requires Windows")

        # Register uninstaller
        self.assertTrue(register_windows_uninstaller())

        # Verify key exists in registry
        import winreg
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\AI_NetController"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as k:
            display_name, _ = winreg.QueryValueEx(k, "DisplayName")
            self.assertEqual(display_name, APP_NAME)
            uninstall_str, _ = winreg.QueryValueEx(k, "UninstallString")
            self.assertIn("--uninstall", uninstall_str)

        # Deregister uninstaller
        self.assertTrue(unregister_windows_uninstaller())

        # Key should no longer exist
        with self.assertRaises(FileNotFoundError):
            winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path)

    def test_06_perform_full_uninstall(self):
        """Verify complete uninstallation routine cleans registry and shortcuts."""
        if not IS_WINDOWS:
            self.skipTest("Uninstall routine test requires Windows")

        # Setup dummy shortcut and registry entries
        create_desktop_shortcut()
        register_windows_uninstaller()
        set_windows_autostart(True)

        callback_called = []
        res = perform_full_uninstall(interactive=False, on_complete=lambda: callback_called.append(True))
        self.assertTrue(res["success"])
        self.assertTrue(res["removed_uninstaller"])
        self.assertEqual(len(callback_called), 1)

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
