import subprocess
import urllib.request
import urllib.error
import json
import os

repo_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
git_exe = r"C:\Program Files\Git\cmd\git.exe"

# 1. Get Token from git credential helper
cred = subprocess.check_output(
    [git_exe, "credential", "fill"],
    input=b"protocol=https\nhost=github.com\n",
    cwd=repo_dir
).decode("utf-8")

token = [line.split("=", 1)[1] for line in cred.splitlines() if line.startswith("password=")][0]

headers = {
    "Authorization": f"token {token}",
    "User-Agent": "CST-Release-Bot",
    "Accept": "application/vnd.github.v3+json"
}

# 2. Check current releases
req = urllib.request.Request("https://api.github.com/repos/smehmedd/AI-NetController/releases", headers=headers)
with urllib.request.urlopen(req) as resp:
    releases = json.loads(resp.read().decode("utf-8"))

print("Current GitHub Releases:")
for r in releases:
    print(f"  ID: {r['id']}, Tag: {r['tag_name']}, Prerelease: {r['prerelease']}, Name: {r['name']}")

# 3. Read PATCH_NOTES.md
patch_notes_path = os.path.join(repo_dir, "PATCH_NOTES.md")
with open(patch_notes_path, "r", encoding="utf-8") as f:
    notes_body = f.read()

target_tag = "v3.1.0-beta.1"
target_name = "CST NetController AI v3.1.0-beta.1 — Android 144Hz Engine, Multi-Aspect Scaling & Protocol Parity"

existing_release = next((r for r in releases if r["tag_name"] == target_tag), None)

if existing_release:
    print(f"Release for {target_tag} already exists (ID: {existing_release['id']}). Updating body...")
    update_payload = {
        "name": target_name,
        "body": notes_body,
        "prerelease": True,
        "draft": False
    }
    update_req = urllib.request.Request(
        f"https://api.github.com/repos/smehmedd/AI-NetController/releases/{existing_release['id']}",
        data=json.dumps(update_payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="PATCH"
    )
    with urllib.request.urlopen(update_req) as resp:
        release_obj = json.loads(resp.read().decode("utf-8"))
else:
    print(f"Creating new GitHub Release for {target_tag}...")
    create_payload = {
        "tag_name": target_tag,
        "target_commitish": "main",
        "name": target_name,
        "body": notes_body,
        "draft": False,
        "prerelease": True
    }
    create_req = urllib.request.Request(
        "https://api.github.com/repos/smehmedd/AI-NetController/releases",
        data=json.dumps(create_payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(create_req) as resp:
        release_obj = json.loads(resp.read().decode("utf-8"))

print(f"Release created/verified: ID {release_obj['id']}, HTML URL: {release_obj['html_url']}")

# 4. Upload assets
upload_url_template = release_obj["upload_url"].split("{")[0]

assets_dir = os.path.join(repo_dir, "public", "releases", "v3.1.0-beta.1")
asset_files = [
    "CST_HostAgent_v3.1.0_win64.exe",
    "CST_HostAgent_v3.1.0_win64_portable.zip",
    "CST_NetController_AI_v3.1.0_arm64-v8a.apk",
    "CST_NetController_AI_v3.1.0.apk",
    "SHA256SUMS.txt",
    "RELEASE_MANIFEST.json"
]

existing_assets = {a["name"]: a["id"] for a in release_obj.get("assets", [])}

mime_map = {
    ".exe": "application/vnd.microsoft.portable-executable",
    ".zip": "application/zip",
    ".apk": "application/vnd.android.package-archive",
    ".txt": "text/plain",
    ".json": "application/json"
}

for filename in asset_files:
    filepath = os.path.join(assets_dir, filename)
    if not os.path.exists(filepath):
        print(f"ERROR: File not found: {filepath}")
        continue
    
    filesize = os.path.getsize(filepath)
    ext = os.path.splitext(filename)[1].lower()
    content_type = mime_map.get(ext, "application/octet-stream")
    
    if filename in existing_assets:
        print(f"Asset '{filename}' already exists (ID: {existing_assets[filename]}). Deleting old asset...")
        del_req = urllib.request.Request(
            f"https://api.github.com/repos/smehmedd/AI-NetController/releases/assets/{existing_assets[filename]}",
            headers=headers,
            method="DELETE"
        )
        try:
            with urllib.request.urlopen(del_req) as resp:
                print(f"  Deleted old {filename}")
        except Exception as e:
            print(f"  Failed to delete old {filename}: {e}")
    
    print(f"Uploading '{filename}' ({filesize:,} bytes, {content_type})...")
    upload_url = f"{upload_url_template}?name={filename}"
    
    with open(filepath, "rb") as f:
        file_bytes = f.read()
    
    up_req = urllib.request.Request(
        upload_url,
        data=file_bytes,
        headers={
            **headers,
            "Content-Type": content_type,
            "Content-Length": str(filesize)
        },
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(up_req) as resp:
            up_obj = json.loads(resp.read().decode("utf-8"))
            print(f"  SUCCESS: Uploaded '{filename}' (ID: {up_obj['id']}, Download: {up_obj['browser_download_url']})")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        print(f"  FAILED to upload '{filename}': HTTP {e.code} - {err_body}")
    except Exception as e:
        print(f"  FAILED to upload '{filename}': {e}")

print("\nAll tasks completed.")
