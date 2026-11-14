#!/usr/bin/env python3
"""
AI NetController - Release Publisher Dispatcher
Forwards release publishing calls to GitHub (default), GitLab, or both (`all`/`both`).

Usage:
    python scripts/publish_release.py [--tag v0.60.0] [--platform github|gitlab|all]
"""
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GITHUB_PUB = os.path.join(SCRIPT_DIR, "publish_github_release.py")
GITLAB_PUB = os.path.join(SCRIPT_DIR, "publish_gitlab_release.py")

if __name__ == "__main__":
    platform = "github"
    filtered_args = []
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == "--platform" and i + 1 < len(sys.argv):
            platform = sys.argv[i + 1].lower()
            i += 2
            continue
        elif arg.startswith("--platform="):
            platform = arg.split("=", 1)[1].lower()
            i += 1
            continue
        filtered_args.append(arg)
        i += 1

    if platform in ("all", "both"):
        targets = [("github", GITHUB_PUB), ("gitlab", GITLAB_PUB)]
    elif platform == "gitlab":
        targets = [("gitlab", GITLAB_PUB)]
    elif platform == "github":
        targets = [("github", GITHUB_PUB)]
    else:
        print(f"[!] Unsupported platform '{platform}'. Choose from: github, gitlab, all, both.")
        sys.exit(2)

    exit_code = 0
    for name, target_script in targets:
        print(f"[*] Dispatching release publisher for platform: {name}")
        rc = subprocess.run([sys.executable, target_script] + filtered_args).returncode
        if rc != 0:
            print(f"[!] Release publisher failed for platform '{name}' (exit code {rc}).")
            exit_code = rc

    sys.exit(exit_code)
