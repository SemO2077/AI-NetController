#!/usr/bin/env python3
"""
AI NetController - Release Publisher Dispatcher
Forwards release publishing calls to GitHub (default) or GitLab.

Usage:
    python scripts/publish_release.py [--tag v0.50.0] [--platform github|gitlab]
"""
import sys
import subprocess
import os

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

    if platform == "gitlab":
        target_script = GITLAB_PUB
    else:
        target_script = GITHUB_PUB

    cmd = [sys.executable, target_script] + filtered_args
    sys.exit(subprocess.run(cmd).returncode)
