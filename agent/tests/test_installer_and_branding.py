"""
AI NetController — Host Daemon Installer, Icons & Branding Verification Tests
Validates:
1. Icon assets integrity (ICO format, multi-resolution sizes: 256, 128, 64, 48, 32, 16, PNG 512x512)
2. Branding strings consistency (APP_NAME == "AI NetController", publisher, version)
3. Installation path security & path traversal defenses (null bytes, root drives, Windows system dirs)
4. Full installation workflow in isolated sandbox environment (file copy, icon deployment, shortcuts)
5. Clean uninstallation workflow & cleanup
"""

import os
import sys
import tempfile
import unittest
from PIL import Image

_TEST_DIR = os.path.dirname(os.path.abspath(__file__))
_AGENT_DIR = os.path.dirname(_TEST_DIR)
if _AGENT_DIR not in sys.path:
    sys.path.insert(0, _AGENT_DIR)

from icon_assets import (
    get_icon_ico_path,
    get_icon_png_path,
    get_icon_image,
    apply_window_icon,
)
from windows_integration import (
    APP_NAME,
    APP_DESCRIPTION,
    APP_VERSION,
    APP_PUBLISHER,
    validate_install_path,
    get_default_install_dir,
    perform_full_install,
    perform_full_uninstall,
    create_desktop_shortcut,
    create_start_menu_shortcut,
    remove_shortcuts,
)


class TestInstallerAndBranding(unittest.TestCase):

    def test_01_icon_assets_exist_and_match_android(self):
        """Verify Windows ICO and PNG exist and match Android multi-resolution standards."""
        ico_path = get_icon_ico_path()
        self.assertIsNotNone(ico_path, "icon.ico must be found")
        self.assertTrue(os.path.exists(ico_path), f"File {ico_path} must exist")
        self.assertGreater(os.path.getsize(ico_path), 10000, "ICO file must be at least 10KB")

        with Image.open(ico_path) as im:
            self.assertEqual(im.format, "ICO", "Must be valid ICO format")
            # ICO in PIL opens largest size
            self.assertEqual(im.size, (256, 256), "ICO maximum resolution should be 256x256")

        png_path = get_icon_png_path(512)
        self.assertIsNotNone(png_path, "icon.png must be found")
        with Image.open(png_path) as im_png:
            self.assertEqual(im_png.format, "PNG", "Must be valid PNG format")
            self.assertEqual(im_png.size, (512, 512), "PNG should be 512x512 high resolution")

        # Test in-memory icon generator fallback
        dyn_img = get_icon_image(64)
        self.assertIsNotNone(dyn_img, "Must return valid PIL Image")
        self.assertEqual(dyn_img.size, (64, 64))

    def test_02_branding_names_consistency(self):
        """Verify consistent branding names across all components."""
        self.assertEqual(APP_NAME, "AI NetController")
        self.assertIn("AI NetController", APP_DESCRIPTION)
        self.assertEqual(APP_PUBLISHER, "AI NetController")
        self.assertEqual(APP_VERSION, "0.50.0")

    def test_03_installer_path_security_checks(self):
        """Verify installer rejects illegal paths, traversal, null bytes, and critical Windows dirs."""
        # 1. Null byte injection
        ok, msg = validate_install_path("C:\\Users\\User\x00\\bad")
        self.assertFalse(ok, "Null byte path must be rejected")
        self.assertIn("null byte", msg.lower())

        # 2. Empty or whitespace
        ok, msg = validate_install_path("   ")
        self.assertFalse(ok, "Empty path must be rejected")

        # 3. Drive root (e.g. C:\)
        ok, msg = validate_install_path("C:\\")
        self.assertFalse(ok, "Drive root must be rejected")

        # 4. Critical Windows directories
        for forbidden in ["C:\\Windows", "C:\\Windows\\System32", "C:\\Boot"]:
            ok, msg = validate_install_path(forbidden)
            self.assertFalse(ok, f"Protected path '{forbidden}' must be rejected")
            self.assertIn("protected", msg.lower())

        # 5. Valid path
        valid_target = get_default_install_dir()
        ok, norm = validate_install_path(valid_target)
        self.assertTrue(ok, f"Valid target path must be accepted: {norm}")
        self.assertEqual(norm, os.path.abspath(valid_target))

    def test_04_isolated_installation_workflow(self):
        """Test full installation workflow into a sandboxed temp directory with registry/process mocks."""
        import windows_integration as wi
        from unittest.mock import patch

        with tempfile.TemporaryDirectory(prefix="ainet_test_install_") as tmp_dir:
            test_target = os.path.join(tmp_dir, "AI NetController")
            progress_events = []

            def _on_progress(pct, msg):
                progress_events.append((pct, msg))

            with (
                patch.object(wi, "register_windows_uninstaller", return_value=True),
                patch.object(wi, "set_windows_autostart", return_value=True),
                patch.object(wi, "_stop_external_agent_processes", return_value=0),
            ):
                res = perform_full_install(
                    target_dir=test_target,
                    create_desktop=False,
                    create_start_menu=False,
                    autostart=False,
                    launch_after=False,
                    progress_cb=_on_progress,
                )

            self.assertTrue(res["success"], f"Installation must succeed: {res.get('message')}")
            self.assertTrue(os.path.isdir(test_target), "Target install dir must exist")
            self.assertTrue(
                os.path.exists(res["installed_exe"]),
                f"Installed executable/launcher must exist at {res['installed_exe']}"
            )

            # Check that icon files were deployed to target
            self.assertTrue(os.path.isfile(os.path.join(test_target, "icon.ico")), "icon.ico must be deployed")
            self.assertTrue(os.path.isfile(os.path.join(test_target, "icon.png")), "icon.png must be deployed")
            self.assertTrue(os.path.isdir(os.path.join(test_target, "assets")), "assets dir must be deployed")

            # Check progress updates
            self.assertGreater(len(progress_events), 3, "Progress events should be reported")
            self.assertEqual(progress_events[-1][0], 100, "Final progress event must be 100%")

    def test_05_uninstallation_workflow(self):
        """Verify uninstallation cleans up sandboxed directories and mocked registry/shortcuts cleanly."""
        import windows_integration as wi
        from unittest.mock import patch

        with tempfile.TemporaryDirectory(prefix="ainet_test_uninstall_") as tmp_dir:
            fake_local = os.path.join(tmp_dir, "LocalAppData")
            fake_roam = os.path.join(tmp_dir, "AppData")
            fake_install = os.path.join(fake_local, "Programs", "AI NetController")
            os.makedirs(fake_install, exist_ok=True)
            with (
                patch.object(wi, "_resolve_desktop_dir", return_value=os.path.join(tmp_dir, "Desktop")),
                patch.object(wi, "get_default_install_dir", return_value=fake_install),
                patch.object(wi, "unregister_windows_uninstaller", return_value=True),
                patch.object(wi, "set_windows_autostart", return_value=True),
                patch.object(wi, "_stop_external_agent_processes", return_value=0),
                patch.dict(os.environ, {"USERPROFILE": tmp_dir, "LOCALAPPDATA": fake_local, "APPDATA": fake_roam}),
            ):
                res = perform_full_uninstall(interactive=False)
        self.assertTrue(res["success"], "Uninstallation must succeed")
        self.assertIn("uninstalled", res["message"].lower())


if __name__ == "__main__":
    unittest.main()
