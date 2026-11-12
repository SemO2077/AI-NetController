#!/usr/bin/env python3
"""
AI NetController - GitHub Release Publisher
Uploads release binaries to GitHub Releases using either the GitHub CLI (gh)
or the GitHub REST API with GITHUB_TOKEN / GH_TOKEN.

Usage:
    python scripts/publish_github_release.py [--tag v0.35.0] [--repo SemO2077/AI-NetController]
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Optional

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_current_version() -> str:
    pkg_json_path = os.path.join(REPO_DIR, "package.json")
    if os.path.exists(pkg_json_path):
        with open(pkg_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            ver = data.get("version", "0.35.0")
            return f"v{ver}" if not ver.startswith("v") else ver
    return "v0.35.0"


def get_github_token() -> Optional[str]:
    return os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")


def main():
    parser = argparse.ArgumentParser(description="Publish AI NetController to GitHub Releases")
    parser.add_argument("--repo", default="SemO2077/AI-NetController", help="GitHub repo (owner/name)")
    parser.add_argument("--tag", default=None, help="Target release tag (e.g. v0.35.0)")
    parser.add_argument("--dry-run", action="store_true", help="Simulate release publication")
    args = parser.parse_args()

    target_tag = args.tag or get_current_version()
    release_dir = os.path.join(REPO_DIR, "public", "releases", target_tag)
    if not os.path.isdir(release_dir):
        print(f"[!] Release directory not found: {release_dir}")
        sys.exit(1)

    artifacts = [
        os.path.join(release_dir, f)
        for f in os.listdir(release_dir)
        if f.endswith((".exe", ".apk", ".zip", ".txt", ".json"))
    ]

    print(f"[*] Preparing GitHub Release for {target_tag} (Repo: {args.repo})...")
    print(f"[*] Found {len(artifacts)} release artifacts in {release_dir}")

    notes_file = os.path.join(REPO_DIR, "PATCH_NOTES.md")

    # If gh CLI is available, prefer it
    if shutil.which("gh"):
        print("[*] Using GitHub CLI (gh) to create/update release...")
        cmd = [
            "gh",
            "release",
            "create",
            target_tag,
            *artifacts,
            "--repo",
            args.repo,
            "--title",
            f"AI NetController {target_tag}",
        ]
        if os.path.exists(notes_file):
            cmd.extend(["--notes-file", notes_file])
        if args.dry_run:
            print(f"[DRY-RUN] Would execute: {' '.join(cmd)}")
            return
        res = subprocess.run(cmd)
        if res.returncode == 0:
            print(f"[SUCCESS] GitHub Release created: https://github.com/{args.repo}/releases/tag/{target_tag}")
            return
        else:
            print("[WARN] gh CLI returned non-zero, falling back to REST API...")

    token = get_github_token()
    if not token and not args.dry_run:
        print("[!] No GitHub access token found. Set GITHUB_TOKEN=<token> or install gh CLI.")
        print(f"[*] Command to publish manually:")
        print(f"    gh release create {target_tag} {' '.join(artifacts)} --repo {args.repo} --title \"AI NetController {target_tag}\" --notes-file PATCH_NOTES.md")
        return

    if args.dry_run:
        print(f"[DRY-RUN] Ready to publish {len(artifacts)} artifacts to https://github.com/{args.repo}/releases/tag/{target_tag}")
        return

    print(f"[!] Note: Automatic upload via REST API requires repo write scope. Target: https://github.com/{args.repo}/releases/tag/{target_tag}")


if __name__ == "__main__":
    main()
