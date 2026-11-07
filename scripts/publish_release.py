#!/usr/bin/env python3
"""
AI NetController - Release Publisher Forwarder
Forwards release publishing calls to scripts/publish_gitlab_release.py.
"""
import sys
import subprocess
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
GITLAB_PUB = os.path.join(SCRIPT_DIR, "publish_gitlab_release.py")

if __name__ == "__main__":
    cmd = [sys.executable, GITLAB_PUB] + sys.argv[1:]
    sys.exit(subprocess.run(cmd).returncode)
