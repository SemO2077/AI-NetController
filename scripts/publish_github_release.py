#!/usr/bin/env python3
"""
AI NetController - GitHub Release Publisher
Creates/updates a GitHub Release and uploads standalone binaries via `gh` CLI
or Python stdlib `urllib.request` using `GITHUB_TOKEN` / `GH_TOKEN` / git credential helper.

Usage:
    python scripts/publish_github_release.py [--tag v0.51.0] [--repo SemO2077/AI-NetController] [--prerelease]
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Optional

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_current_version() -> str:
    pkg_json_path = os.path.join(REPO_DIR, "package.json")
    if os.path.exists(pkg_json_path):
        with open(pkg_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            ver = data.get("version", "0.51.0")
            return f"v{ver}" if not ver.startswith("v") else ver
    return "v0.51.0"


def _format_beta_label(tag: str) -> str:
    ver = tag.lstrip("v")
    parts = [p for p in ver.split(".")[:3] if p.isdigit()]
    if len(parts) == 3 and parts[0] == "0":
        return f"Beta 0.{int(parts[1]):02d}.{int(parts[2]):02d}"
    return f"v{ver}"


def get_github_token() -> Optional[str]:
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        return token.strip()
    try:
        res = subprocess.run(
            ["git", "credential", "fill"],
            input="protocol=https\nhost=github.com\n\n",
            capture_output=True,
            text=True,
            timeout=10,
        )
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                if line.startswith("password="):
                    val = line.split("=", 1)[1].strip()
                    if val:
                        return val
    except Exception:
        pass
    return None


def _github_request(
    url: str,
    token: str,
    method: str = "GET",
    payload: Optional[Dict] = None,
    raw_bytes: Optional[bytes] = None,
    content_type: str = "application/json",
) -> Dict:
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": f"AINetController-Release-Publisher/{get_current_version().lstrip('v')}",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    data = None
    if raw_bytes is not None:
        data = raw_bytes
        headers["Content-Type"] = content_type
    elif payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = content_type

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body) if body else {}


def main():
    parser = argparse.ArgumentParser(description="Publish AI NetController to GitHub Releases")
    parser.add_argument("--repo", default="SemO2077/AI-NetController", help="GitHub repo (owner/name)")
    parser.add_argument("--tag", default=None, help="Target release tag (e.g. v0.51.0)")
    parser.add_argument("--title", default=None, help="Release title override")
    parser.add_argument("--prerelease", action="store_true", help="Mark GitHub release as prerelease (beta)")
    parser.add_argument("--dry-run", action="store_true", help="Simulate release publication")
    args = parser.parse_args()

    target_tag = args.tag or get_current_version()
    release_title = args.title or f"AI NetController {target_tag} ({_format_beta_label(target_tag)})"
    is_prerelease = bool(args.prerelease or "beta" in release_title.lower() or target_tag.startswith("v0."))

    release_dir = os.path.join(REPO_DIR, "public", "releases", target_tag)
    if not os.path.isdir(release_dir):
        print(f"[!] Release directory not found: {release_dir}")
        sys.exit(1)

    artifacts = sorted(
        os.path.join(release_dir, f)
        for f in os.listdir(release_dir)
        if f.endswith((".exe", ".apk", ".zip", ".txt", ".json"))
    )
    if not artifacts:
        print(f"[!] No release artifacts found in {release_dir}")
        sys.exit(1)

    print(f"[*] Preparing GitHub Release for {target_tag} (Repo: {args.repo})...")
    print(f"[*] Found {len(artifacts)} release artifacts in {release_dir}")

    notes_file = os.path.join(REPO_DIR, "PATCH_NOTES.md")
    notes_body = f"# {release_title}\n\nAI NetController {target_tag} binaries and checksums."
    if os.path.exists(notes_file):
        with open(notes_file, "r", encoding="utf-8") as f:
            notes_body = f.read()

    if args.dry_run:
        print(f"[DRY-RUN] Release Title: {release_title} (prerelease={is_prerelease})")
        for path in artifacts:
            print(f"[DRY-RUN] Artifact: {os.path.basename(path)} ({os.path.getsize(path)} bytes)")
        return

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
            release_title,
        ]
        if is_prerelease:
            cmd.append("--prerelease")
        if os.path.exists(notes_file):
            cmd.extend(["--notes-file", notes_file])
        res = subprocess.run(cmd)
        if res.returncode == 0:
            print(f"[SUCCESS] GitHub Release created: https://github.com/{args.repo}/releases/tag/{target_tag}")
            return
        print("[WARN] gh CLI returned non-zero, falling back to GitHub REST API...")

    token = get_github_token()
    if not token:
        print("[!] No GitHub access token found in GITHUB_TOKEN/GH_TOKEN or git credential manager.")
        sys.exit(1)

    api_base = f"https://api.github.com/repos/{args.repo}"
    release_obj: Optional[Dict] = None

    try:
        release_obj = _github_request(f"{api_base}/releases/tags/{urllib.parse.quote(target_tag)}", token)
        print(f"[*] Existing GitHub Release #{release_obj['id']} found for {target_tag}; updating...")
        release_obj = _github_request(
            f"{api_base}/releases/{release_obj['id']}",
            token,
            method="PATCH",
            payload={
                "tag_name": target_tag,
                "name": release_title,
                "body": notes_body,
                "draft": False,
                "prerelease": is_prerelease,
            },
        )
    except urllib.error.HTTPError as e:
        if e.code != 404:
            err_body = e.read().decode("utf-8", errors="ignore")
            print(f"[ERROR] GitHub API failed checking release {target_tag}: {e.code} {err_body}")
            sys.exit(1)
        print(f"[*] Creating new GitHub Release for {target_tag}...")
        release_obj = _github_request(
            f"{api_base}/releases",
            token,
            method="POST",
            payload={
                "tag_name": target_tag,
                "name": release_title,
                "body": notes_body,
                "draft": False,
                "prerelease": is_prerelease,
            },
        )

    existing_assets: Dict[str, int] = {
        a["name"]: a["id"] for a in release_obj.get("assets", []) if "name" in a and "id" in a
    }
    upload_base = release_obj["upload_url"].split("{", 1)[0]

    for artifact_path in artifacts:
        fname = os.path.basename(artifact_path)
        if fname in existing_assets:
            asset_id = existing_assets[fname]
            print(f"[*] Replacing existing asset {fname} (id={asset_id})...")
            _github_request(f"{api_base}/releases/assets/{asset_id}", token, method="DELETE")

        with open(artifact_path, "rb") as af:
            blob = af.read()

        size_mb = len(blob) / (1024 * 1024)
        print(f"[*] Uploading {fname} ({size_mb:.2f} MB)...")
        upload_url = f"{upload_base}?name={urllib.parse.quote(fname)}"
        uploaded = _github_request(
            upload_url,
            token,
            method="POST",
            raw_bytes=blob,
            content_type="application/octet-stream",
        )
        print(f"    [OK] Uploaded -> {uploaded.get('browser_download_url', fname)}")

    print(f"[SUCCESS] GitHub Release published: {release_obj.get('html_url')}")


if __name__ == "__main__":
    main()
