import os
import shutil
import hashlib
import json
from datetime import datetime, timezone

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REL_DIR = os.path.join(ROOT_DIR, "public", "releases", "v0.35.0")

arm64_apk = os.path.join(REL_DIR, "AI_NetController_v0.35.0_arm64-v8a.apk")
univ_apk = os.path.join(REL_DIR, "AI_NetController_v0.35.0.apk")
if os.path.exists(arm64_apk):
    shutil.copy2(arm64_apk, univ_apk)

files_to_hash = [
    ("AI_NetController_HostAgent_v0.35.0_win64.exe", "Windows 10/11 x64 (Standalone Host Agent .EXE)", "exe"),
    ("AI_NetController_HostAgent_v0.35.0_win64_portable.zip", "Windows Portable Agent Bundle + PyInstaller Spec (.ZIP)", "zip"),
    ("AI_NetController_v0.35.0_arm64-v8a.apk", "Android 10\u201315 arm64-v8a (Mobile Companion .APK)", "apk"),
    ("AI_NetController_v0.35.0.apk", "Android Universal (Mobile Companion .APK)", "apk"),
]

def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

artifacts = []
sums_lines = []

for fname, plat, kind in files_to_hash:
    fpath = os.path.join(REL_DIR, fname)
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
        "downloadUrl": f"/releases/v0.35.0/{fname}"
    })

sums_path = os.path.join(REL_DIR, "SHA256SUMS.txt")
with open(sums_path, "w", encoding="utf-8") as f:
    f.write("\n".join(sums_lines) + "\n")

manifest_data = {
    "version": "v0.35.0",
    "tag": "v0.35.0",
    "releaseName": "AI NetController v0.35.0",
    "publishedAt": datetime.now(timezone.utc).isoformat(),
    "artifacts": artifacts
}

manifest_path = os.path.join(REL_DIR, "RELEASE_MANIFEST.json")
with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(manifest_data, f, indent=2)

print("[SUCCESS] Checksums and manifest regenerated:")
for a in artifacts:
    print(f"  {a['filename']}: {a['sizeFormatted']} (SHA-256: {a['sha256'][:16]}...)")
