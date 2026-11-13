"""
AI NetController — Import Isolation & Packaging Verification
Validates that agent_daemon and all local modules (crypto_vault, windows_integration,
agent_gui, icon_assets) can be imported successfully regardless of working directory
or execution context.
"""

import os
import sys
import tempfile
import unittest
import subprocess

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class TestStandaloneImportIsolation(unittest.TestCase):

    def test_01_import_agent_daemon_from_outside_working_dir(self):
        """Execute Python one-liner importing agent_daemon from a temporary outside directory."""
        with tempfile.TemporaryDirectory() as td:
            # Run in isolated directory
            cmd = [
                sys.executable,
                "-c",
                (
                    f"import sys; sys.path.insert(0, r'{os.path.join(REPO_ROOT, 'agent')}'); "
                    "import agent_daemon; "
                    "print('IMPORT_OK')"
                ),
            ]
            res = subprocess.run(cmd, cwd=td, capture_output=True, text=True, timeout=30)
            self.assertEqual(res.returncode, 0, f"Import failed: {res.stderr}")
            self.assertIn("IMPORT_OK", res.stdout)

    def test_02_crypto_vault_direct_and_package_import(self):
        """Verify crypto_vault imports cleanly via direct sibling and fallback namespaces."""
        with tempfile.TemporaryDirectory() as td:
            cmd = [
                sys.executable,
                "-c",
                (
                    f"import sys; sys.path.insert(0, r'{os.path.join(REPO_ROOT, 'agent')}'); "
                    "import crypto_vault; "
                    "from crypto_vault import HostCryptoVault, scrub_memory; "
                    "print('CRYPTO_VAULT_OK')"
                ),
            ]
            res = subprocess.run(cmd, cwd=td, capture_output=True, text=True, timeout=30)
            self.assertEqual(res.returncode, 0, f"Crypto import failed: {res.stderr}")
            self.assertIn("CRYPTO_VAULT_OK", res.stdout)

    def test_03_standalone_exe_executes_shortcut_flag_outside_repo(self):
        """Skip un-mocked OS shortcut creation unless AI_ALLOW_HOST_MUTATION_TESTS=1."""
        if os.environ.get("AI_ALLOW_HOST_MUTATION_TESTS") != "1":
            self.skipTest("Skipping host-mutating --create-shortcut EXE test unless AI_ALLOW_HOST_MUTATION_TESTS=1")
        exe_path = os.path.join(
            REPO_ROOT, "public", "releases", "v0.60.0", "AI_NetController_HostAgent_v0.60.0_win64.exe"
        )
        if os.path.exists(exe_path):
            with tempfile.TemporaryDirectory() as td:
                try:
                    res = subprocess.run([exe_path, "--create-shortcut"], cwd=td, capture_output=True, text=True, timeout=30)
                    self.assertEqual(res.returncode, 0, f"EXE execution failed: {res.stderr}")
                except OSError as e:
                    if getattr(e, "winerror", None) == 4551:
                        self.skipTest(f"Skipped execution due to Windows Application Control policy: {e}")
                    else:
                        raise

    def test_04_agent_module_imports_cleanly_when_headless(self):
        """Verify agent imports, daemon init, and teardown leave no non-daemon threads in headless mode."""
        with tempfile.TemporaryDirectory(prefix="ainet_headless_") as td:
            env = os.environ.copy()
            for var in ("DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY"):
                env.pop(var, None)
            env.update(
                {
                    "AI_HEADLESS": "1",
                    "HOME": td,
                    "USERPROFILE": td,
                    "LOCALAPPDATA": os.path.join(td, "Local"),
                    "APPDATA": os.path.join(td, "Roaming"),
                    "XDG_CONFIG_HOME": os.path.join(td, ".config"),
                }
            )
            pkg_code = (
                "import asyncio, os, sys, threading; "
                "sys.path.insert(0, sys.argv[1]); "
                "import agent.agent as a; "
                "assert not a._has_desktop_display(); "
                "d1 = a.HostAgentDaemon(host='127.0.0.1', port=0, enable_tray=True, enable_mdns=False); "
                "d1._start_system_tray(); "
                "d1.stop(); "
                "d2 = a.HostAgentDaemon(host='127.0.0.1', port=0, enable_tray=True, enable_mdns=False); "
                "asyncio.run(d2.async_stop()); "
                "alive = [t.name for t in threading.enumerate() if t is not threading.main_thread() and not t.daemon]; "
                "assert not alive, f'Leaked non-daemon threads: {alive}'; "
                "print('HEADLESS_PKG_OK')"
            )
            res = subprocess.run(
                [sys.executable, "-c", pkg_code, REPO_ROOT],
                cwd=td,
                env=env,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(res.returncode, 0, f"Headless package test failed:\nstdout={res.stdout}\nstderr={res.stderr}")
            self.assertIn("HEADLESS_PKG_OK", res.stdout)

            flat_code = (
                "import os, sys, threading; "
                "sys.path.insert(0, os.path.join(sys.argv[1], 'agent')); "
                "import agent as a; "
                "assert not a._has_desktop_display(); "
                "d = a.HostAgentDaemon(host='127.0.0.1', port=0, enable_tray=True, enable_mdns=False); "
                "d.stop(); "
                "alive = [t.name for t in threading.enumerate() if t is not threading.main_thread() and not t.daemon]; "
                "assert not alive, f'Leaked non-daemon threads: {alive}'; "
                "print('HEADLESS_FLAT_OK')"
            )
            res_flat = subprocess.run(
                [sys.executable, "-c", flat_code, REPO_ROOT],
                cwd=td,
                env=env,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(res_flat.returncode, 0, f"Headless flat import test failed:\nstdout={res_flat.stdout}\nstderr={res_flat.stderr}")
            self.assertIn("HEADLESS_FLAT_OK", res_flat.stdout)


if __name__ == "__main__":
    unittest.main()
