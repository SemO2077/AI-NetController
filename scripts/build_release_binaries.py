#!/usr/bin/env python3
"""
AI NetController - Standalone Binary & Release Builder
Generates standalone packaged release artifacts for GitHub Releases and Web OTA distribution:
1. AI_NetController_HostAgent_{version}_win64.exe (PE32+ Windows launcher + embedded Python 3.12 payload)
2. AI_NetController_{version}_arm64-v8a.apk & AI_NetController_{version}.apk (Signed Native Flutter Android APKs)
3. AI_NetController_HostAgent_{version}_win64_portable.zip (Full Windows Agent --onedir + source + MSIX manifest)
4. SHA256SUMS.txt & RELEASE_MANIFEST.json
"""

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import zipfile
from datetime import datetime, timezone

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def get_package_version() -> str:
    pkg_json = os.path.join(ROOT_DIR, "package.json")
    if os.path.exists(pkg_json):
        with open(pkg_json, "r", encoding="utf-8") as f:
            v = json.load(f).get("version", "0.100.0")
            return f"v{v}" if not v.startswith("v") else v
    return "v0.100.0"


def _format_beta_label(tag: str) -> str:
    ver = tag.lstrip("v")
    parts = [p for p in ver.split(".")[:3] if p.isdigit()]
    if len(parts) == 3 and parts[0] == "0":
        return f"Beta 0.{int(parts[1]):02d}.{int(parts[2]):02d}"
    return f"v{ver}"


RELEASE_VERSION = get_package_version()
RELEASE_DIR = os.path.join(ROOT_DIR, "public", "releases", RELEASE_VERSION)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def _latest_source_mtime(root_dir: str, extensions: tuple) -> float:
    latest = 0.0
    for base, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in ("build", "dist", "__pycache__", ".dart_tool", ".gradle", "venv", ".venv")]
        for fn in files:
            if fn.endswith(extensions):
                try:
                    mt = os.path.getmtime(os.path.join(base, fn))
                    if mt > latest:
                        latest = mt
                except OSError:
                    pass
    return latest


def build_windows_exe(
    output_exe_path: str,
    output_zip_path: str,
    clean: bool = False,
    onedir_only: bool = False,
    skip_defender: bool = False,
) -> bool:
    """
    Compiles & signs the Windows Host Agent bundle using PyInstaller incremental caches.
    Prioritizes the clean --onedir layout and also builds standalone .exe unless onedir_only=True.
    Returns True if output_exe_path exists after build.
    """
    t0 = time.perf_counter()
    agent_dir = os.path.join(ROOT_DIR, "agent")
    dist_dir = os.path.join(agent_dir, "dist")
    standalone_exe = os.path.join(dist_dir, "AI_NetController_HostAgent_standalone.exe")
    onedir_folder = os.path.join(dist_dir, "AI_NetController_HostAgent")

    print("=================================================================")
    print(" AI NetController — Instant Windows Host Agent (.EXE) Builder")
    print("=================================================================")
    spec_path = os.path.join(agent_dir, "build_agent.spec")
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm"]
    if clean:
        cmd.append("--clean")
    cmd.append(spec_path)

    pyinstaller_env = os.environ.copy()
    pyinstaller_env["AI_BUILD_ONEFILE"] = "0" if onedir_only else "1"
    subprocess.run(cmd, cwd=agent_dir, env=pyinstaller_env, check=True)

    # Sign EVERY .exe/.dll/.pyd inside --onedir (and standalone EXE if generated) + scan with Defender
    sign_script = os.path.join(agent_dir, "sign_binary.ps1")
    if platform.system() == "Windows" and os.path.exists(sign_script):
        try:
            print("[INFO] Applying Authenticode code-signing across PE binaries...")
            sign_extra = []
            if not os.environ.get("AI_CODESIGN_THUMBPRINT") and os.environ.get("AI_STRICT_CODESIGN", "").strip() != "1":
                sign_extra.extend(["-AllowSelfSigned", "-SkipTimestamp"])
            if skip_defender:
                sign_extra.append("-SkipDefenderScan")
            targets = [onedir_folder] if onedir_only else [onedir_folder, standalone_exe]
            for target_path in targets:
                if os.path.exists(target_path):
                    res = subprocess.run(
                        ["powershell", "-ExecutionPolicy", "Bypass", "-File", sign_script, "-TargetPath", target_path, *sign_extra],
                        cwd=agent_dir,
                        check=False,
                    )
                    if res.returncode != 0:
                        print(f"[WARN] sign_binary.ps1 exited with code {res.returncode} for {target_path}")
        except Exception as e:
            print(f"[WARN] Code-signing / Defender scan notice: {e}")

    has_standalone = False
    if os.path.exists(standalone_exe):
        shutil.copy2(standalone_exe, output_exe_path)
        exe_size = os.path.getsize(output_exe_path)
        print(f"[SUCCESS] Packaged Windows Standalone Executable: {output_exe_path} ({exe_size} bytes)")
        has_standalone = True
    elif os.path.exists(output_exe_path):
        has_standalone = True
    else:
        print("[INFO] Skipping SFX --onefile EXE (using clean --onedir distribution).")

    # Build the full portable bundle ZIP containing signed --onedir + source + MSIX manifest
    agent_files = [
        "__init__.py",
        "agent.py",
        "agent_daemon.py",
        "agent_gui.py",
        "cyber_ui_theme.py",
        "command_ast_firewall.py",
        "crypto_handshake.py",
        "crypto_vault.py",
        "daemon_config.py",
        "tls_manager.py",
        "host_file_writer.py",
        "icon_assets.py",
        "multi_monitor_streamer.py",
        "network_fuzzer_shield.py",
        "windows_integration.py",
        "icon.ico",
        "icon.png",
        "requirements.txt",
        "app_manifest.xml",
        "AppxManifest.xml",
        "build_agent.spec",
        "build_exe.bat",
        "sign_binary.ps1",
        "package_msix.ps1",
        "version_info.txt",
    ]

    zip_compress_level = 6 if onedir_only else 9
    with zipfile.ZipFile(output_zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=zip_compress_level) as pzf:
        if os.path.exists(onedir_folder):
            for root, _dirs, files in os.walk(onedir_folder):
                for f in files:
                    full_p = os.path.join(root, f)
                    rel_p = os.path.relpath(full_p, dist_dir)
                    pzf.write(full_p, arcname=rel_p.replace("\\", "/"))
        for fname in agent_files:
            fpath = os.path.join(agent_dir, fname)
            if os.path.exists(fpath):
                pzf.write(fpath, arcname=f"AI_NetController_HostAgent/src/{fname}")
        readme_path = os.path.join(ROOT_DIR, "PATCH_NOTES.md")
        if os.path.exists(readme_path):
            pzf.write(readme_path, arcname="AI_NetController_HostAgent/PATCH_NOTES.md")

    elapsed = time.perf_counter() - t0
    zip_size = os.path.getsize(output_zip_path)
    print(f"[SUCCESS] Packaged Windows Portable Bundle ZIP in {elapsed:.1f}s: {output_zip_path} ({zip_size} bytes)")
    return has_standalone


def build_android_apk(
    output_arm64_path: str,
    output_univ_path: str,
    force_rebuild: bool = False,
    fast_arm64_only: bool = False,
    clean: bool = False,
) -> None:
    mobile_dir = os.path.join(ROOT_DIR, "apps", "mobile")
    flutter_apk_dir = os.path.join(mobile_dir, "build", "app", "outputs", "flutter-apk")
    flutter_arm64 = os.path.join(flutter_apk_dir, "app-arm64-v8a-release.apk")
    flutter_univ = os.path.join(flutter_apk_dir, "app-release.apk")
    native_arm64 = os.path.join(
        mobile_dir,
        "android_native_build",
        "bin",
        f"AI_NetController_{RELEASE_VERSION}_arm64-v8a.apk",
    )
    webview_arm64 = os.path.join(
        mobile_dir,
        "build",
        "webview_apk",
        f"AI_NetController_{RELEASE_VERSION}_arm64-v8a.apk",
    )
    prebuilt_candidates = [
        flutter_arm64,
        output_arm64_path,
        webview_arm64,
        native_arm64,
        output_univ_path,
    ]

    latest_dart_mtime = _latest_source_mtime(
        os.path.join(mobile_dir, "lib"),
        (".dart", ".yaml", ".kt", ".java", ".gradle"),
    )
    found_apk = next(
        (cand for cand in prebuilt_candidates if os.path.exists(cand) and os.path.getsize(cand) > 500000),
        None,
    )
    is_stale = bool(found_apk and os.path.getmtime(found_apk) < latest_dart_mtime)

    if force_rebuild or not found_apk or is_stale:
        reason = "forced rebuild" if force_rebuild else ("source files modified since last APK build" if is_stale else "pre-compiled APK not found")
        print(f"[INFO] Building native Android APK ({reason}); invoking scripts/build_android_app.py...")
        builder = os.path.join(ROOT_DIR, "scripts", "build_android_app.py")
        cmd = [sys.executable, builder]
        if fast_arm64_only:
            cmd.append("--fast")
        if clean:
            cmd.append("--clean")
        subprocess.run(cmd, cwd=ROOT_DIR, check=True)
        found_apk = next(
            (cand for cand in prebuilt_candidates if os.path.exists(cand) and os.path.getsize(cand) > 500000),
            None,
        )

    if not found_apk:
        raise RuntimeError(
            "Failed to locate or build a valid signed native Android APK; refusing to emit stub APK."
        )

    if os.path.abspath(found_apk) != os.path.abspath(output_arm64_path):
        shutil.copy2(found_apk, output_arm64_path)

    if os.path.isfile(flutter_univ) and os.path.getsize(flutter_univ) > 500000:
        if os.path.abspath(flutter_univ) != os.path.abspath(output_univ_path):
            shutil.copy2(flutter_univ, output_univ_path)
    elif not os.path.isfile(output_univ_path) or os.path.getsize(output_univ_path) <= 500000:
        shutil.copy2(found_apk, output_univ_path)

    apk_size = os.path.getsize(output_arm64_path)
    print(f"[SUCCESS] Packaged Signed Native Android APKs: {output_arm64_path} ({apk_size} bytes)")


def _format_size(size_bytes: int) -> str:
    if size_bytes >= 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.2f} MB"
    return f"{size_bytes / 1024:.1f} KB"


def main() -> None:
    parser = argparse.ArgumentParser(description="AI NetController — Standalone Binary & Release Builder")
    parser.add_argument("--exe-only", action="store_true", help="Build and package only Windows Host Agent .EXE & .ZIP")
    parser.add_argument("--apk-only", action="store_true", help="Build and package only Android Companion .APK")
    parser.add_argument("--fast", action="store_true", help="Fast incremental build (skips redundant Defender scan; arm64-only for APK)")
    parser.add_argument("--onedir-only", action="store_true", help="Skip --onefile SFX packaging during EXE build")
    parser.add_argument("--clean", action="store_true", help="Clean PyInstaller / Flutter caches before building")
    parser.add_argument("--force", action="store_true", help="Force APK/EXE rebuild even if artifacts exist")
    args, _unknown = parser.parse_known_args()

    os.makedirs(RELEASE_DIR, exist_ok=True)

    exe_name = f"AI_NetController_HostAgent_{RELEASE_VERSION}_win64.exe"
    apk_arm64_name = f"AI_NetController_{RELEASE_VERSION}_arm64-v8a.apk"
    apk_univ_name = f"AI_NetController_{RELEASE_VERSION}.apk"
    zip_name = f"AI_NetController_HostAgent_{RELEASE_VERSION}_win64_portable.zip"

    exe_path = os.path.join(RELEASE_DIR, exe_name)
    apk_arm64_path = os.path.join(RELEASE_DIR, apk_arm64_name)
    apk_univ_path = os.path.join(RELEASE_DIR, apk_univ_name)
    zip_path = os.path.join(RELEASE_DIR, zip_name)

    if not args.apk_only:
        build_windows_exe(
            exe_path,
            zip_path,
            clean=args.clean,
            onedir_only=args.onedir_only,
            skip_defender=args.fast,
        )

    if not args.exe_only:
        build_android_apk(
            apk_arm64_path,
            apk_univ_path,
            force_rebuild=args.force or args.apk_only,
            fast_arm64_only=args.fast,
            clean=args.clean,
        )

    artifact_specs = [
        (exe_name, "Windows 10/11 x64 (Standalone Host Agent .EXE)", "exe"),
        (zip_name, "Windows Signed --onedir Bundle + Source & MSIX Manifest (.ZIP)", "zip"),
        (apk_arm64_name, "Android 10–15 arm64-v8a (Mobile Companion .APK)", "apk"),
        (apk_univ_name, "Android Universal (Mobile Companion .APK)", "apk"),
    ]

    artifacts = []
    sums_lines = []
    for fname, platform_label, kind in artifact_specs:
        fpath = os.path.join(RELEASE_DIR, fname)
        if not os.path.exists(fpath):
            continue
        size_bytes = os.path.getsize(fpath)
        digest = sha256_file(fpath)
        sums_lines.append(f"{digest}  {fname}")
        artifacts.append(
            {
                "filename": fname,
                "kind": kind,
                "platform": platform_label,
                "sizeBytes": size_bytes,
                "sizeFormatted": _format_size(size_bytes),
                "sha256": digest,
                "downloadUrl": f"/releases/{RELEASE_VERSION}/{fname}",
            }
        )

    sums_path = os.path.join(RELEASE_DIR, "SHA256SUMS.txt")
    with open(sums_path, "w", encoding="utf-8") as sf:
        sf.write("\n".join(sums_lines) + "\n")

    manifest_data = {
        "version": RELEASE_VERSION,
        "tag": RELEASE_VERSION,
        "releaseName": f"AI NetController {RELEASE_VERSION} ({_format_beta_label(RELEASE_VERSION)})",
        "publishedAt": datetime.now(timezone.utc).isoformat(),
        "artifacts": artifacts,
    }

    manifest_path = os.path.join(RELEASE_DIR, "RELEASE_MANIFEST.json")
    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump(manifest_data, mf, indent=2)
        mf.write("\n")

    patch_notes_src = os.path.join(ROOT_DIR, "PATCH_NOTES.md")
    if os.path.isfile(patch_notes_src):
        shutil.copy2(patch_notes_src, os.path.join(RELEASE_DIR, "PATCH_NOTES.md"))

    print(f"\n[SUCCESS] Release artifacts ready in {RELEASE_DIR}:")
    for art in artifacts:
        print(f"  - {art['filename']} ({art['sizeFormatted']}) SHA256={art['sha256'][:16]}...")


if __name__ == "__main__":
    main()
