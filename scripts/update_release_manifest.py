import argparse
import hashlib
import json
import os
import shutil
from datetime import datetime, timezone

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def get_release_tag() -> str:
    pkg_json = os.path.join(ROOT_DIR, "package.json")
    if os.path.exists(pkg_json):
        with open(pkg_json, "r", encoding="utf-8") as f:
            v = json.load(f).get("version", "0.60.0")
            return f"v{v}" if not v.startswith("v") else v
    return "v0.60.0"


def _format_beta_label(tag: str) -> str:
    ver = tag.lstrip("v")
    parts = [p for p in ver.split(".")[:3] if p.isdigit()]
    if len(parts) == 3 and parts[0] == "0":
        return f"Beta 0.{int(parts[1]):02d}.{int(parts[2]):02d}"
    return f"v{ver}"


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def update_manifest(rel_tag: str) -> None:
    rel_dir = os.path.join(ROOT_DIR, "public", "releases", rel_tag)
    os.makedirs(rel_dir, exist_ok=True)

    arm64_apk = os.path.join(rel_dir, f"AI_NetController_{rel_tag}_arm64-v8a.apk")
    univ_apk = os.path.join(rel_dir, f"AI_NetController_{rel_tag}.apk")
    if os.path.exists(arm64_apk):
        shutil.copy2(arm64_apk, univ_apk)

    files_to_hash = [
        (f"AI_NetController_HostAgent_{rel_tag}_win64.exe", "Windows 10/11 x64 (Standalone Host Agent .EXE)", "exe"),
        (f"AI_NetController_HostAgent_{rel_tag}_win64_portable.zip", "Windows Portable Agent Bundle + PyInstaller Spec (.ZIP)", "zip"),
        (f"AI_NetController_{rel_tag}_arm64-v8a.apk", "Android 10\u201315 arm64-v8a (Mobile Companion .APK)", "apk"),
        (f"AI_NetController_{rel_tag}.apk", "Android Universal (Mobile Companion .APK)", "apk"),
    ]

    artifacts = []
    sums_lines = []

    for fname, plat, kind in files_to_hash:
        fpath = os.path.join(rel_dir, fname)
        if not os.path.exists(fpath):
            continue
        size_bytes = os.path.getsize(fpath)
        digest = sha256_file(fpath)
        sums_lines.append(f"{digest}  {fname}")
        artifacts.append({
            "filename": fname,
            "kind": kind,
            "platform": plat,
            "sizeBytes": size_bytes,
            "sizeFormatted": f"{size_bytes / (1024*1024):.2f} MB" if size_bytes >= 1024*1024 else f"{size_bytes / 1024:.1f} KB",
            "sha256": digest,
            "downloadUrl": f"/releases/{rel_tag}/{fname}"
        })

    sums_path = os.path.join(rel_dir, "SHA256SUMS.txt")
    with open(sums_path, "w", encoding="utf-8") as f:
        f.write("\n".join(sums_lines) + ("\n" if sums_lines else ""))

    manifest_data = {
        "version": rel_tag,
        "tag": rel_tag,
        "releaseName": f"AI NetController {rel_tag} ({_format_beta_label(rel_tag)})",
        "publishedAt": datetime.now(timezone.utc).isoformat(),
        "artifacts": artifacts
    }

    manifest_path = os.path.join(rel_dir, "RELEASE_MANIFEST.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    print("[SUCCESS] Checksums and manifest regenerated:")
    for a in artifacts:
        print(f"  {a['filename']}: {a['sizeFormatted']} (SHA-256: {a['sha256'][:16]}...)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Regenerate SHA256SUMS.txt and RELEASE_MANIFEST.json")
    parser.add_argument("--tag", default=None, help="Target release tag (defaults to package.json version)")
    args = parser.parse_args()
    rel_tag = args.tag or get_release_tag()
    update_manifest(rel_tag)


if __name__ == "__main__":
    main()
