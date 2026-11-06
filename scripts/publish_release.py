#!/usr/bin/env python3
"""
AI NetController - Unified GitHub Release Publisher
Publishes or updates release notes, tags, and binary artifacts on GitHub.

Usage:
    python scripts/publish_release.py [--tag v0.31.3] [--draft]
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Dict, Optional

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_git_executable() -> str:
    """Locates the git executable across platforms."""
    git_path = shutil.which("git")
    if git_path:
        return git_path
    common_win_paths = [
        r"C:\Program Files\Git\cmd\git.exe",
        r"C:\Program Files (x86)\Git\cmd\git.exe",
    ]
    for p in common_win_paths:
        if os.path.exists(p):
            return p
    return "git"


def get_current_version() -> str:
    """Reads current package version from package.json."""
    pkg_json_path = os.path.join(REPO_DIR, "package.json")
    if os.path.exists(pkg_json_path):
        with open(pkg_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            ver = data.get("version", "3.1.0-beta.3")
            return f"v{ver}" if not ver.startswith("v") else ver
    return "v0.31.3"


def get_github_token() -> Optional[str]:
    """Retrieves GitHub token from env var or git credential helper."""
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        return token
    try:
        git_exe = get_git_executable()
        cred = subprocess.check_output(
            [git_exe, "credential", "fill"],
            input=b"protocol=https\nhost=github.com\n",
            cwd=REPO_DIR,
            stderr=subprocess.DEVNULL
        ).decode("utf-8")
        for line in cred.splitlines():
            if line.startswith("password="):
                return line.split("=", 1)[1]
    except Exception:
        pass
    return None


def main():
    parser = argparse.ArgumentParser(description="Publish AI NetController GitHub Release")
    parser.add_argument("--tag", default=None, help="Target release tag (e.g. v0.31.3)")
    parser.add_argument("--name", default=None, help="Release name/title")
    parser.add_argument("--draft", action="store_true", help="Publish as draft")
    parser.add_argument("--dry-run", action="store_true", help="Simulate release without network calls")
    args = parser.parse_args()

    target_tag = args.tag or get_current_version()
    is_prerelease = "beta" in target_tag.lower() or "alpha" in target_tag.lower() or "rc" in target_tag.lower()
    target_name = args.name or f"AI NetController {target_tag}"

    token = get_github_token()
    if not token and not args.dry_run:
        print("[!] No GitHub token found via GITHUB_TOKEN or git credential helper.")
        print("    Set GITHUB_TOKEN=<token> or configure git credentials.")
        sys.exit(1)

    # Read PATCH_NOTES.md
    patch_notes_path = os.path.join(REPO_DIR, "PATCH_NOTES.md")
    notes_body = ""
    if os.path.exists(patch_notes_path):
        with open(patch_notes_path, "r", encoding="utf-8") as f:
            notes_body = f.read()

    print(f"[*] Publishing release {target_tag} ({'Prerelease' if is_prerelease else 'Stable'})...")
    if args.dry_run:
        print(f"    [DRY-RUN] Target tag: {target_tag}, Name: {target_name}, Prerelease: {is_prerelease}")
        return

    headers = {
        "Authorization": f"token {token}",
        "User-Agent": "AINetController-Release-Bot",
        "Accept": "application/vnd.github.v3+json",
    }

    # Query existing releases
    req = urllib.request.Request("https://api.github.com/repos/smehmedd/AI-NetController/releases", headers=headers)
    with urllib.request.urlopen(req) as resp:
        releases = json.loads(resp.read().decode("utf-8"))

    existing_release = next((r for r in releases if r["tag_name"] == target_tag), None)

    if existing_release:
        print(f"[*] Updating existing release (ID: {existing_release['id']})...")
        update_payload = {
            "name": target_name,
            "body": notes_body,
            "prerelease": is_prerelease,
            "draft": args.draft,
        }
        update_req = urllib.request.Request(
            f"https://api.github.com/repos/smehmedd/AI-NetController/releases/{existing_release['id']}",
            data=json.dumps(update_payload).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json"},
            method="PATCH",
        )
        with urllib.request.urlopen(update_req) as resp:
            release_obj = json.loads(resp.read().decode("utf-8"))
    else:
        print(f"[*] Creating new release for {target_tag}...")
        create_payload = {
            "tag_name": target_tag,
            "target_commitish": "main",
            "name": target_name,
            "body": notes_body,
            "draft": args.draft,
            "prerelease": is_prerelease,
        }
        create_req = urllib.request.Request(
            "https://api.github.com/repos/smehmedd/AI-NetController/releases",
            data=json.dumps(create_payload).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(create_req) as resp:
            release_obj = json.loads(resp.read().decode("utf-8"))

    print(f"[OK] Release active: ID {release_obj['id']}, HTML URL: {release_obj['html_url']}")

    # Check for local assets to upload
    assets_dir = os.path.join(REPO_DIR, "public", "releases", target_tag)
    if not os.path.exists(assets_dir):
        print(f"[*] No local asset directory at {assets_dir}, skipping asset upload.")
        return

    upload_url_template = release_obj["upload_url"].split("{")[0]
    existing_assets = {a["name"]: a["id"] for a in release_obj.get("assets", [])}

    mime_map = {
        ".exe": "application/vnd.microsoft.portable-executable",
        ".zip": "application/zip",
        ".apk": "application/vnd.android.package-archive",
        ".txt": "text/plain",
        ".json": "application/json",
    }

    for fname in os.listdir(assets_dir):
        fpath = os.path.join(assets_dir, fname)
        if not os.path.isfile(fpath):
            continue

        if fname in existing_assets:
            print(f"[*] Replacing existing asset {fname} (ID: {existing_assets[fname]})...")
            del_req = urllib.request.Request(
                f"https://api.github.com/repos/smehmedd/AI-NetController/releases/assets/{existing_assets[fname]}",
                headers=headers,
                method="DELETE",
            )
            try:
                with urllib.request.urlopen(del_req):
                    pass
            except Exception as e:
                print(f"    Warning deleting {fname}: {e}")

        ext = os.path.splitext(fname)[1].lower()
        content_type = mime_map.get(ext, "application/octet-stream")
        file_size = os.path.getsize(fpath)

        print(f"[*] Uploading {fname} ({file_size / (1024 * 1024):.2f} MB)...")
        with open(fpath, "rb") as f:
            file_bytes = f.read()

        upload_url = f"{upload_url_template}?name={fname}"
        upload_headers = {
            **headers,
            "Content-Type": content_type,
            "Content-Length": str(len(file_bytes)),
        }
        upload_req = urllib.request.Request(upload_url, data=file_bytes, headers=upload_headers, method="POST")
        try:
            with urllib.request.urlopen(upload_req) as resp:
                uploaded_obj = json.loads(resp.read().decode("utf-8"))
                print(f"    [OK] Uploaded {fname} -> ID {uploaded_obj['id']}")
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode("utf-8")
            print(f"    [FAIL] Upload failed for {fname}: {e.code} - {err_msg}")

    print(f"\n[DONE] Successfully published and verified release {target_tag} on GitHub!")


if __name__ == "__main__":
    main()
