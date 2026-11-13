#!/usr/bin/env python3
"""
AI NetController - GitLab Release & Package Publisher
Uploads standalone release binaries to GitLab Generic Packages and creates or updates
a GitLab Release with permanent direct asset download links.

Usage:
    python scripts/publish_gitlab_release.py [--project-id <id|group/project>] [--tag v0.51.0] [--dry-run]
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_current_version() -> str:
    pkg_json_path = os.path.join(REPO_DIR, "package.json")
    if os.path.exists(pkg_json_path):
        with open(pkg_json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            ver = data.get("version", "0.51.0")
            return f"v{ver}" if not ver.startswith("v") else ver
    return "v0.51.0"


def get_gitlab_token() -> Optional[str]:
    return (
        os.environ.get("GITLAB_TOKEN")
        or os.environ.get("GL_TOKEN")
        or os.environ.get("CI_JOB_TOKEN")
    )


def main():
    parser = argparse.ArgumentParser(description="Publish AI NetController to GitLab Releases")
    parser.add_argument(
        "--project",
        default=os.environ.get("CI_PROJECT_ID", "88645417"),
        help="GitLab project ID or path (e.g. ryu-group7483245/ai-netcontroller or 88645417)",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("CI_SERVER_URL", "https://gitlab.com"),
        help="GitLab host base URL",
    )
    parser.add_argument("--tag", default=None, help="Target release tag (e.g. v0.51.0)")
    parser.add_argument("--dry-run", action="store_true", help="Simulate release publication")
    args = parser.parse_args()

    target_tag = args.tag or get_current_version()
    token = get_gitlab_token()

    if not args.project and not args.dry_run:
        print("[!] No GitLab project specified. Pass --project <project_id> or set CI_PROJECT_ID.")
        sys.exit(1)

    encoded_project = urllib.parse.quote(str(args.project), safe="") if args.project else "unknown"
    api_base = f"{args.host.rstrip('/')}/api/v4/projects/{encoded_project}"

    print(f"[*] Preparing GitLab Release for {target_tag} on {args.host} (Project: {args.project})...")

    patch_notes_path = os.path.join(REPO_DIR, "PATCH_NOTES.md")
    notes_body = f"# AI NetController {target_tag}\n\nAutomated release."
    if os.path.exists(patch_notes_path):
        with open(patch_notes_path, "r", encoding="utf-8") as f:
            notes_body = f.read()

    # Locate release assets
    assets_dir = os.path.join(REPO_DIR, "public", "releases", target_tag)
    if not os.path.exists(assets_dir):
        print(f"[!] Local assets directory {assets_dir} not found.")
        sys.exit(1)

    if args.dry_run:
        print(f"    [DRY-RUN] Target tag: {target_tag}")
        print(f"    [DRY-RUN] Release notes size: {len(notes_body)} chars")
        for fname in os.listdir(assets_dir):
            fpath = os.path.join(assets_dir, fname)
            if os.path.isfile(fpath):
                print(f"    [DRY-RUN] Found asset: {fname} ({os.path.getsize(fpath)} bytes)")
        return

    if not token:
        print("[!] No GitLab access token found. Set GITLAB_TOKEN=<token> or GL_TOKEN=<token>.")
        sys.exit(1)

    headers = {
        "PRIVATE-TOKEN": token,
        "User-Agent": "AINetController-GitLab-Release-Bot",
    }

    uploaded_links = []
    # Sort files so executables and packages come first
    priority_order = [
        f"AI_NetController_HostAgent_{target_tag}_win64.exe",
        f"AI_NetController_HostAgent_{target_tag}_win64_portable.zip",
        f"AI_NetController_{target_tag}.apk",
        f"AI_NetController_{target_tag}_arm64-v8a.apk",
        "SHA256SUMS.txt",
        "RELEASE_MANIFEST.json",
        "PATCH_NOTES.md",
    ]

    files_to_upload = [f for f in priority_order if os.path.exists(os.path.join(assets_dir, f))]
    for extra in sorted(os.listdir(assets_dir)):
        if extra not in files_to_upload and os.path.isfile(os.path.join(assets_dir, extra)):
            files_to_upload.append(extra)

    labels = {
        f"AI_NetController_HostAgent_{target_tag}_win64.exe": "Windows Host Agent (Standalone .EXE)",
        f"AI_NetController_HostAgent_{target_tag}_win64_portable.zip": "Windows Host Agent (Portable .ZIP)",
        f"AI_NetController_{target_tag}.apk": "Android Universal Companion (.APK)",
        f"AI_NetController_{target_tag}_arm64-v8a.apk": "Android arm64-v8a Companion (.APK)",
        "SHA256SUMS.txt": "SHA-256 Checksums",
        "RELEASE_MANIFEST.json": "Release Manifest (JSON)",
        "PATCH_NOTES.md": "Patch Notes (Markdown)",
    }

    for fname in files_to_upload:
        fpath = os.path.join(assets_dir, fname)
        size_mb = os.path.getsize(fpath) / (1024 * 1024)
        print(f"[*] Uploading {fname} ({size_mb:.2f} MB) to GitLab Generic Packages...")

        package_url = f"{api_base}/packages/generic/ainetcontroller/{target_tag}/{fname}"
        with open(fpath, "rb") as bf:
            file_data = bf.read()

        req = urllib.request.Request(
            package_url,
            data=file_data,
            headers={**headers, "Content-Type": "application/octet-stream"},
            method="PUT",
        )
        try:
            with urllib.request.urlopen(req) as resp:
                if resp.status in (200, 201):
                    print(f"    [OK] Uploaded {fname}")
                    link_name = labels.get(fname, fname)
                    uploaded_links.append({
                        "name": link_name,
                        "url": package_url,
                        "link_type": "package",
                        "direct_asset_path": f"/downloads/{fname}"
                    })
        except urllib.error.HTTPError as e:
            print(f"    [WARN] Package upload status for {fname}: {e.code} {e.reason}")

    # Build markdown asset table to append to release body
    table_lines = [
        "",
        "---",
        "## Release Downloads & Direct Artifacts",
        "",
        "| Artifact | Type | Direct Download |",
        "| :--- | :--- | :--- |",
    ]
    for item in uploaded_links:
        table_lines.append(f"| **{item['name']}** | `{item['link_type']}` | [{item['name'].split()[0]}]({item['url']}) |")

    full_description = notes_body + "\n" + "\n".join(table_lines) + "\n"

    # Create / update release in GitLab
    print(f"[*] Registering GitLab Release for tag {target_tag}...")
    release_payload = {
        "name": f"AI NetController {target_tag}",
        "tag_name": target_tag,
        "description": full_description,
        "assets": {"links": uploaded_links} if uploaded_links else {}
    }

    release_req = urllib.request.Request(
        f"{api_base}/releases",
        data=json.dumps(release_payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(release_req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            rel_url = data.get("_links", {}).get("self", "") or f"{args.host}/ryu-group7483245/ai-netcontroller/-/releases/{target_tag}"
            print(f"\n[SUCCESS] GitLab Release successfully created!")
            print(f"  - Release URL: {rel_url}")
            print(f"  - Tag: {target_tag}")
            print(f"  - Total Assets Linked: {len(uploaded_links)}")
    except urllib.error.HTTPError as e:
        if e.code == 409:  # Already exists, update release
            print(f"[*] Release {target_tag} already exists. Updating...")
            update_req = urllib.request.Request(
                f"{api_base}/releases/{target_tag}",
                data=json.dumps(release_payload).encode("utf-8"),
                headers={**headers, "Content-Type": "application/json"},
                method="PUT",
            )
            with urllib.request.urlopen(update_req) as resp:
                print(f"[SUCCESS] GitLab Release updated for {target_tag}")
        else:
            err_body = e.read().decode("utf-8", errors="ignore")
            print(f"[ERROR] Failed to create release: {e.code} - {err_body}")
            sys.exit(1)


if __name__ == "__main__":
    main()
