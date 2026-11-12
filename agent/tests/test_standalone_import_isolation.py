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
            res = subprocess.run(cmd, cwd=td, capture_output=True, text=True)
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
            res = subprocess.run(cmd, cwd=td, capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, f"Crypto import failed: {res.stderr}")
            self.assertIn("CRYPTO_VAULT_OK", res.stdout)

    def test_03_standalone_exe_executes_shortcut_flag_outside_repo(self):
        """Execute the packaged standalone EXE from a temporary directory with --create-shortcut."""
        exe_path = os.path.join(
            REPO_ROOT, "public", "releases", "v0.50.0", "AI_NetController_HostAgent_v0.50.0_win64.exe"
        )
        if os.path.exists(exe_path):
            with tempfile.TemporaryDirectory() as td:
                try:
                    res = subprocess.run([exe_path, "--create-shortcut"], cwd=td, capture_output=True, text=True)
                    self.assertEqual(res.returncode, 0, f"EXE execution failed: {res.stderr}")
                except OSError as e:
                    if getattr(e, "winerror", None) == 4551:
                        self.skipTest(f"Skipped execution due to Windows Application Control policy: {e}")
                    else:
                        raise


if __name__ == "__main__":
    unittest.main()
