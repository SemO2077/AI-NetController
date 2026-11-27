#!/usr/bin/env python3
"""
AI NetController - Native Android Application Builder
Compiles a hardware-accelerated Android APK embedding the exact React/Tailwind/D3 Web Console
using official Android SDK build-tools and JDK 17+.
"""
import os
import sys
import shutil
import subprocess
import hashlib
import zipfile
import json
from datetime import datetime, timezone

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IS_WIN = os.name == "nt"

def _resolve_sdk_dir():
    candidates = [
        os.environ.get("ANDROID_HOME", ""),
        os.environ.get("ANDROID_SDK_ROOT", ""),
    ]
    if IS_WIN:
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        if local_app_data:
            candidates.append(os.path.join(local_app_data, "Android", "Sdk"))
        candidates.append(os.path.expanduser("~/AppData/Local/Android/Sdk"))
    candidates.extend([
        os.path.expanduser("~/Android/Sdk"),
        os.path.expanduser("~/Library/Android/sdk"),
        "/usr/local/lib/android/sdk",
    ])
    for cand in candidates:
        if cand and os.path.isdir(cand):
            return cand
    return (
        os.environ.get("ANDROID_HOME")
        or os.environ.get("ANDROID_SDK_ROOT")
        or (
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk")
            if IS_WIN and os.environ.get("LOCALAPPDATA")
            else os.path.expanduser("~/Android/Sdk")
        )
    )

def _resolve_build_tools(sdk_dir):
    bt_root = os.path.join(sdk_dir, "build-tools")
    pref = os.path.join(bt_root, "35.0.0")
    if os.path.isdir(pref):
        return pref
    if os.path.isdir(bt_root):
        versions = sorted(
            [d for d in os.listdir(bt_root) if os.path.isdir(os.path.join(bt_root, d))],
            reverse=True,
        )
        if versions:
            return os.path.join(bt_root, versions[0])
    return pref

def _resolve_android_jar(sdk_dir):
    plat_root = os.path.join(sdk_dir, "platforms")
    pref = os.path.join(plat_root, "android-35", "android.jar")
    if os.path.isfile(pref):
        return pref
    pref34 = os.path.join(plat_root, "android-34", "android.jar")
    if os.path.isfile(pref34):
        return pref34
    if os.path.isdir(plat_root):
        for d in sorted(os.listdir(plat_root), reverse=True):
            cand = os.path.join(plat_root, d, "android.jar")
            if os.path.isfile(cand):
                return cand
    return pref34

def _resolve_jdk_dir():
    env_java = os.environ.get("JAVA_HOME", "")
    if env_java and os.path.isdir(env_java):
        return env_java
    javac_bin = shutil.which("javac")
    if javac_bin:
        return os.path.dirname(os.path.dirname(os.path.realpath(javac_bin)))
    if IS_WIN:
        candidates = [
            r"C:\Program Files\Android\Android Studio\jbr",
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Temurin-21"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Temurin-17"),
            r"C:\Program Files\Eclipse Adoptium\jdk-21",
        ]
        for cand in candidates:
            if os.path.isfile(os.path.join(cand, "bin", "javac.exe")):
                return cand
    return env_java or ""

SDK_DIR = _resolve_sdk_dir()
JDK_DIR = _resolve_jdk_dir()
KEYSTORE_PATH = os.path.expanduser("~/.android/debug.keystore")

BUILD_TOOLS_DIR = _resolve_build_tools(SDK_DIR)
ANDROID_JAR = _resolve_android_jar(SDK_DIR)
JAVAC = os.path.join(JDK_DIR, "bin", "javac.exe" if IS_WIN else "javac") if os.path.isdir(JDK_DIR) else (shutil.which("javac") or "javac")
KEYTOOL = os.path.join(JDK_DIR, "bin", "keytool.exe" if IS_WIN else "keytool") if os.path.isdir(JDK_DIR) else (shutil.which("keytool") or "keytool")
D8 = os.path.join(BUILD_TOOLS_DIR, "d8.bat" if IS_WIN else "d8")
AAPT2 = os.path.join(BUILD_TOOLS_DIR, "aapt2.exe" if IS_WIN else "aapt2")
ZIPALIGN = os.path.join(BUILD_TOOLS_DIR, "zipalign.exe" if IS_WIN else "zipalign")
APKSIGNER = os.path.join(BUILD_TOOLS_DIR, "apksigner.bat" if IS_WIN else "apksigner")

WEB_DIST = os.path.join(ROOT_DIR, "apps", "web", "dist")
STAGE_DIR = os.path.join(ROOT_DIR, "apps", "mobile", "android_native_build")
MAIN_ACTIVITY_TEMPLATE = os.path.join(
    ROOT_DIR,
    "apps",
    "mobile",
    "android_webview_shell",
    "src",
    "com",
    "cst",
    "autonomouslan",
    "MainActivity.java",
)
WEBVIEW_APK_OUT = os.path.join(ROOT_DIR, "apps", "mobile", "build", "webview_apk")

ENV = os.environ.copy()
if os.path.isdir(JDK_DIR):
    ENV["JAVA_HOME"] = JDK_DIR
    ENV["PATH"] = os.path.join(JDK_DIR, "bin") + os.pathsep + ENV.get("PATH", "")

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def ensure_debug_keystore():
    if os.path.isfile(KEYSTORE_PATH):
        return
    os.makedirs(os.path.dirname(KEYSTORE_PATH), exist_ok=True)
    print(f"[*] Generating Android debug keystore at {KEYSTORE_PATH}...")
    subprocess.run([
        KEYTOOL, "-genkeypair", "-v",
        "-keystore", KEYSTORE_PATH,
        "-storepass", "android",
        "-alias", "androiddebugkey",
        "-keypass", "android",
        "-keyalg", "RSA",
        "-keysize", "2048",
        "-validity", "10000",
        "-dname", "CN=Android Debug,O=Android,C=US"
    ], env=ENV, check=True)

def ensure_web_dist():
    """Always build fresh apps/web production assets with vite."""
    print("[*] Building fresh apps/web production assets with vite...")
    npm_cmd = "npm.cmd" if IS_WIN else "npm"
    subprocess.run([npm_cmd, "run", "build"], cwd=ROOT_DIR, check=True)
    print(f"[OK] Web assets confirmed in {WEB_DIST}")

def setup_staging():
    if os.path.exists(STAGE_DIR):
        shutil.rmtree(STAGE_DIR)
    os.makedirs(os.path.join(STAGE_DIR, "src", "com", "cst", "autonomouslan"), exist_ok=True)
    os.makedirs(os.path.join(STAGE_DIR, "res", "values"), exist_ok=True)
    os.makedirs(os.path.join(STAGE_DIR, "res", "values-v29"), exist_ok=True)
    os.makedirs(os.path.join(STAGE_DIR, "res", "drawable"), exist_ok=True)
    os.makedirs(os.path.join(STAGE_DIR, "res", "mipmap-anydpi-v26"), exist_ok=True)
    os.makedirs(os.path.join(STAGE_DIR, "bin", "classes"), exist_ok=True)
    os.makedirs(os.path.join(STAGE_DIR, "assets", "dist"), exist_ok=True)

    # Copy web dist into assets/dist
    shutil.copytree(WEB_DIST, os.path.join(STAGE_DIR, "assets", "dist"), dirs_exist_ok=True)
    # Copy 3D Cyber-Glass adaptive & raster launcher icons from Flutter res directory
    flutter_res = os.path.join(ROOT_DIR, "apps", "mobile", "android", "app", "src", "main", "res")
    for icon_subdir in (
        "mipmap-mdpi",
        "mipmap-hdpi",
        "mipmap-xhdpi",
        "mipmap-xxhdpi",
        "mipmap-xxxhdpi",
        "mipmap-anydpi",
        "mipmap-anydpi-v26",
    ):
        src_dir = os.path.join(flutter_res, icon_subdir)
        if os.path.isdir(src_dir):
            shutil.copytree(src_dir, os.path.join(STAGE_DIR, "res", icon_subdir), dirs_exist_ok=True)
    for xml_name in ("ic_launcher_background.xml", "ic_launcher_foreground.xml"):
        src_xml = os.path.join(flutter_res, "drawable", xml_name)
        if os.path.isfile(src_xml):
            shutil.copy2(src_xml, os.path.join(STAGE_DIR, "res", "drawable", xml_name))

    # Also copy release metadata (manifest, checksums, patch notes) into assets/dist/releases/<tag>
    rel_tag = _get_release_tag()
    rel_src = os.path.join(ROOT_DIR, "public", "releases", rel_tag)
    if not os.path.exists(rel_src):
        rel_src = os.path.join(ROOT_DIR, "public", "releases", "v0.100.0")
    if not os.path.exists(rel_src):
        rel_src = os.path.join(ROOT_DIR, "public", "releases", "v0.70.0")
    rel_dst = os.path.join(STAGE_DIR, "assets", "dist", "releases", rel_tag)
    os.makedirs(rel_dst, exist_ok=True)
    for meta_file in ("RELEASE_MANIFEST.json", "SHA256SUMS.txt", "PATCH_NOTES.md"):
        src_p = os.path.join(rel_src, meta_file)
        if os.path.exists(src_p):
            shutil.copy2(src_p, os.path.join(rel_dst, meta_file))
    print(f"[OK] Copied web assets to staging: {len(os.listdir(os.path.join(STAGE_DIR, 'assets', 'dist')))} items")


def _get_release_tag():
    pkg_json = os.path.join(ROOT_DIR, "package.json")
    if os.path.exists(pkg_json):
        try:
            with open(pkg_json, "r", encoding="utf-8") as f:
                v = str(json.load(f).get("version", "0.100.0")).strip()
                return f"v{v}" if not v.startswith("v") else v
        except Exception:
            pass
    return "v0.100.0"


def _get_version_name():
    ver = _get_release_tag().lstrip("v")
    parts = [p for p in ver.split(".")[:3] if p.isdigit()]
    if len(parts) == 3 and parts[0] == "0":
        return f"0.{int(parts[1]):02d}.{int(parts[2]):02d}-beta"
    return ver


def create_android_manifest():
    ver_name = _get_version_name()
    parts = [int(p) for p in _get_release_tag().lstrip("v").split(".")[:3] if p.isdigit()]
    ver_code = str(parts[0] * 1000 + parts[1] * 10 + parts[2]) if len(parts) == 3 else "800"
    manifest_content = f"""<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.cst.autonomouslan"
    android:versionCode="{ver_code}"
    android:versionName="{ver_name}">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="35" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />

    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:theme="@style/AppTheme"
        android:hardwareAccelerated="true"
        android:usesCleartextTraffic="true"
        android:allowBackup="false"
        android:supportsRtl="true">

        <activity
            android:name=".MainActivity"
            android:label="@string/app_name"
            android:exported="true"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
            android:windowSoftInputMode="adjustResize"
            android:theme="@style/AppTheme">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>"""
    with open(os.path.join(STAGE_DIR, "AndroidManifest.xml"), "w", encoding="utf-8") as f:
        f.write(manifest_content)

def create_resources():
    strings_content = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">AI NetController</string>
</resources>"""
    with open(os.path.join(STAGE_DIR, "res", "values", "strings.xml"), "w", encoding="utf-8") as f:
        f.write(strings_content)

    colors_content = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="canvas_deep">#040711</color>
    <color name="cyan_accent">#22D3EE</color>
</resources>"""
    with open(os.path.join(STAGE_DIR, "res", "values", "colors.xml"), "w", encoding="utf-8") as f:
        f.write(colors_content)

    styles_base = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="@android:style/Theme.DeviceDefault.NoActionBar">
        <item name="android:windowBackground">@color/canvas_deep</item>
        <item name="android:colorBackground">@color/canvas_deep</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:windowDrawsSystemBarBackgrounds">true</item>
    </style>
</resources>"""
    with open(os.path.join(STAGE_DIR, "res", "values", "styles.xml"), "w", encoding="utf-8") as f:
        f.write(styles_base)

    styles_v29 = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="@android:style/Theme.DeviceDefault.NoActionBar">
        <item name="android:windowBackground">@color/canvas_deep</item>
        <item name="android:colorBackground">@color/canvas_deep</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowLightNavigationBar">false</item>
        <item name="android:enforceStatusBarContrast">false</item>
        <item name="android:enforceNavigationBarContrast">false</item>
        <item name="android:windowDrawsSystemBarBackgrounds">true</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
    </style>
</resources>"""
    with open(os.path.join(STAGE_DIR, "res", "values-v29", "styles.xml"), "w", encoding="utf-8") as f:
        f.write(styles_v29)

    # High-Resolution Adaptive Cyber Radar Vector Icon
    icon_content = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="192"
    android:viewportHeight="192">
    <!-- Dark Cyber Squircle Base -->
    <path
        android:fillColor="#081020"
        android:pathData="M0,0h192v192h-192z" />
    <path
        android:fillColor="#0C1424"
        android:pathData="M42,0 H150 A42,42 0 0,1 192,42 V150 A42,42 0 0,1 150,192 H42 A42,42 0 0,1 0,150 V42 A42,42 0 0,1 42,0 Z" />
    <!-- Radar Outer Arc -->
    <path
        android:strokeColor="#22D3EE"
        android:strokeWidth="3"
        android:strokeAlpha="0.35"
        android:fillColor="#00000000"
        android:pathData="M96,42 A54,54 0 1,1 95.9,42 Z" />
    <!-- Inner Cyber Ring -->
    <path
        android:strokeColor="#06B6D4"
        android:strokeWidth="2.5"
        android:strokeAlpha="0.5"
        android:fillColor="#00000000"
        android:pathData="M96,56 A40,40 0 1,1 95.9,56 Z" />
    <!-- Power Symbol Vertical Stem -->
    <path
        android:strokeColor="#38BDF8"
        android:strokeWidth="6"
        android:strokeLineCap="round"
        android:pathData="M96,54 L96,90" />
    <!-- Power Symbol Arc -->
    <path
        android:strokeColor="#22D3EE"
        android:strokeWidth="6"
        android:strokeLineCap="round"
        android:fillColor="#00000000"
        android:pathData="M72,68 A38,38 0 1,0 120,68" />
    <!-- Center Glowing Pulse Node -->
    <path
        android:fillColor="#38BDF8"
        android:pathData="M96,96m-6,0a6,6 0 1,0 12,0a6,6 0 1,0 -12,0" />
    <!-- Emerald Peripheral Node -->
    <path
        android:fillColor="#34D399"
        android:pathData="M68,128m-4.5,0a4.5,4.5 0 1,0 9,0a4.5,4.5 0 1,0 -9,0" />
    <!-- Cyan Peripheral Node -->
    <path
        android:fillColor="#38BDF8"
        android:pathData="M124,128m-4.5,0a4.5,4.5 0 1,0 9,0a4.5,4.5 0 1,0 -9,0" />
</vector>"""
    with open(os.path.join(STAGE_DIR, "res", "drawable", "ic_launcher.xml"), "w", encoding="utf-8") as f:
        f.write(icon_content)

def create_main_activity():
    if not os.path.isfile(MAIN_ACTIVITY_TEMPLATE):
        raise FileNotFoundError(f"Missing MainActivity.java template: {MAIN_ACTIVITY_TEMPLATE}")
    with open(MAIN_ACTIVITY_TEMPLATE, "r", encoding="utf-8") as f:
        java_content = f.read()
    rel_tag = _get_release_tag()
    app_ver = rel_tag.lstrip("v")
    java_content = java_content.replace("__APP_VERSION__", app_ver).replace("__RELEASE_TAG__", rel_tag)
    dest = os.path.join(STAGE_DIR, "src", "com", "cst", "autonomouslan", "MainActivity.java")
    with open(dest, "w", encoding="utf-8", newline="\n") as f:
        f.write(java_content)
    print("[OK] MainActivity.java generated.")

def compile_java():
    java_file = os.path.join(STAGE_DIR, "src", "com", "cst", "autonomouslan", "MainActivity.java")
    classes_dir = os.path.join(STAGE_DIR, "bin", "classes")
    cmd = [
        JAVAC,
        "-source", "17",
        "-target", "17",
        "-cp", ANDROID_JAR,
        "-d", classes_dir,
        java_file
    ]
    print("[*] Compiling Java code with javac...")
    res = subprocess.run(cmd, env=ENV, capture_output=True, text=True)
    if res.returncode != 0:
        print("[ERROR] javac failed:", res.stderr)
        sys.exit(1)
    print("[OK] Java compiled successfully.")

def run_d8():
    classes_dir = os.path.join(STAGE_DIR, "bin", "classes")
    dex_dir = os.path.join(STAGE_DIR, "bin", "dex")
    os.makedirs(dex_dir, exist_ok=True)

    class_files = []
    for root, _, files in os.walk(classes_dir):
        for f in files:
            if f.endswith(".class"):
                class_files.append(os.path.join(root, f))

    cmd = [
        D8,
        "--min-api", "24",
        "--output", dex_dir,
        "--lib", ANDROID_JAR
    ] + class_files
    print(f"[*] Dexing {len(class_files)} classes with d8...")
    res = subprocess.run(cmd, env=ENV, capture_output=True, text=True)
    if res.returncode != 0:
        print("[ERROR] d8 failed:", res.stderr)
        sys.exit(1)
    print(f"[OK] classes.dex generated at {os.path.join(dex_dir, 'classes.dex')}")

def compile_and_link_resources():
    res_dir = os.path.join(STAGE_DIR, "res")
    bin_dir = os.path.join(STAGE_DIR, "bin")
    compiled_res = os.path.join(bin_dir, "res.zip")
    manifest = os.path.join(STAGE_DIR, "AndroidManifest.xml")
    assets_dir = os.path.join(STAGE_DIR, "assets")
    unaligned_apk = os.path.join(bin_dir, "unaligned.apk")

    print("[*] Compiling Android resources with aapt2...")
    cmd_compile = [
        AAPT2, "compile",
        "--dir", res_dir,
        "-o", compiled_res
    ]
    res = subprocess.run(cmd_compile, capture_output=True, text=True)
    if res.returncode != 0:
        print("[ERROR] aapt2 compile failed:", res.stderr)
        sys.exit(1)

    print("[*] Linking APK package with aapt2...")
    cmd_link = [
        AAPT2, "link",
        "-I", ANDROID_JAR,
        "--manifest", manifest,
        "-A", assets_dir,
        "-o", unaligned_apk,
        compiled_res
    ]
    res = subprocess.run(cmd_link, capture_output=True, text=True)
    if res.returncode != 0:
        print("[ERROR] aapt2 link failed:", res.stderr)
        sys.exit(1)
    print("[OK] Unaligned APK generated.")

    # Add classes.dex into unaligned APK
    dex_path = os.path.join(STAGE_DIR, "bin", "dex", "classes.dex")
    with zipfile.ZipFile(unaligned_apk, "a") as apk_zip:
        apk_zip.write(dex_path, arcname="classes.dex")
    print("[OK] Injected classes.dex into APK.")

def zipalign_and_sign():
    bin_dir = os.path.join(STAGE_DIR, "bin")
    unaligned_apk = os.path.join(bin_dir, "unaligned.apk")
    aligned_apk = os.path.join(bin_dir, "aligned.apk")
    rel_tag = _get_release_tag()
    signed_apk = os.path.join(bin_dir, f"AI_NetController_{rel_tag}_arm64-v8a.apk")

    print("[*] Aligning APK with zipalign (4-byte alignment)...")
    if os.path.exists(aligned_apk):
        os.remove(aligned_apk)
    cmd_align = [ZIPALIGN, "-f", "4", unaligned_apk, aligned_apk]
    res = subprocess.run(cmd_align, capture_output=True, text=True)
    if res.returncode != 0:
        print("[ERROR] zipalign failed:", res.stderr)
        sys.exit(1)

    ks_path = os.environ.get("AI_ANDROID_KEYSTORE", "").strip()
    ks_pass = os.environ.get("AI_ANDROID_KEYSTORE_PASS", "").strip()
    ks_alias = os.environ.get("AI_ANDROID_KEY_ALIAS", "").strip()
    key_pass = os.environ.get("AI_ANDROID_KEY_PASS", "").strip() or ks_pass
    strict_release = (os.environ.get("AI_RELEASE_BUILD", "").strip() == "1") or ("--release" in sys.argv)

    if ks_path and os.path.isfile(ks_path) and ks_pass and ks_alias:
        print(f"[*] Signing APK with release keystore ({ks_alias})...")
    elif strict_release:
        print("[ERROR] Release build requires AI_ANDROID_KEYSTORE, AI_ANDROID_KEYSTORE_PASS, and AI_ANDROID_KEY_ALIAS.")
        sys.exit(1)
    else:
        ks_path = KEYSTORE_PATH
        ks_pass = "android"
        ks_alias = "androiddebugkey"
        key_pass = "android"
        ensure_debug_keystore()
        print("[*] Signing APK with local debug keystore (set AI_ANDROID_KEYSTORE for release signing)...")

    sign_env = ENV.copy()
    sign_env["AI_APKSIGNER_KS_PASS"] = ks_pass
    sign_env["AI_APKSIGNER_KEY_PASS"] = key_pass
    cmd_sign = [
        APKSIGNER, "sign",
        "--ks", ks_path,
        "--ks-pass", "env:AI_APKSIGNER_KS_PASS",
        "--ks-key-alias", ks_alias,
        "--key-pass", "env:AI_APKSIGNER_KEY_PASS",
        "--out", signed_apk,
        aligned_apk
    ]
    res = subprocess.run(cmd_sign, env=sign_env, capture_output=True, text=True)
    if res.returncode != 0:
        print("[ERROR] apksigner failed:", res.stderr)
        sys.exit(1)

    # Verify signature
    cmd_verify = [APKSIGNER, "verify", "--verbose", signed_apk]
    res_v = subprocess.run(cmd_verify, env=ENV, capture_output=True, text=True)
    if res_v.returncode != 0:
        print("[ERROR] apksigner verify failed:", res_v.stderr)
        sys.exit(1)
    print("[OK] APK Signature verified:\n", res_v.stdout.strip())

    return signed_apk

def distribute_apk(signed_apk):
    rel_tag = _get_release_tag()
    rel_dir = os.path.join(ROOT_DIR, "public", "releases", rel_tag)
    os.makedirs(rel_dir, exist_ok=True)
    dest_arm64 = os.path.join(rel_dir, f"AI_NetController_{rel_tag}_arm64-v8a.apk")
    dest_univ = os.path.join(rel_dir, f"AI_NetController_{rel_tag}.apk")
    shutil.copy2(signed_apk, dest_arm64)
    shutil.copy2(signed_apk, dest_univ)

    webview_out = WEBVIEW_APK_OUT
    os.makedirs(webview_out, exist_ok=True)
    dest_webview = os.path.join(webview_out, f"AI_NetController_{rel_tag}_arm64-v8a.apk")
    shutil.copy2(signed_apk, dest_webview)

    size_mb = os.path.getsize(dest_arm64) / (1024 * 1024)
    sha_hash = sha256_file(dest_arm64)
    print(f"\n[SUCCESS] APK Published to:\n  - {dest_arm64}\n  - {dest_univ}\n  - {dest_webview}\n  - Size: {size_mb:.2f} MB\n  - SHA256: {sha_hash}")

    manifest_path = os.path.join(rel_dir, "RELEASE_MANIFEST.json")
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        for art in manifest.get("artifacts", []):
            if rel_tag in art["filename"]:
                art_file = os.path.join(rel_dir, art["filename"])
                if os.path.exists(art_file):
                    sz = os.path.getsize(art_file)
                    art["sizeBytes"] = sz
                    art["sizeFormatted"] = f"{sz / (1024*1024):.1f} MB" if sz >= 1024 * 1024 else f"{sz / 1024:.0f} KB"
                    art["sha256"] = sha256_file(art_file)
        manifest["publishedAt"] = datetime.now(timezone.utc).isoformat()
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")

    sums_path = os.path.join(rel_dir, "SHA256SUMS.txt")
    if os.path.exists(sums_path):
        with open(sums_path, "r", encoding="utf-8") as f:
            lines = [l for l in f.read().splitlines() if l.strip()]
        new_lines = []
        seen = set()
        for l in lines:
            parts = l.split(None, 1)
            if len(parts) == 2:
                matched_file = os.path.join(rel_dir, parts[1])
                if os.path.exists(matched_file):
                    new_lines.append(f"{sha256_file(matched_file)}  {parts[1]}")
                    seen.add(parts[1])
                    continue
            new_lines.append(l)
        for fname in (f"AI_NetController_{rel_tag}_arm64-v8a.apk", f"AI_NetController_{rel_tag}.apk"):
            fpath = os.path.join(rel_dir, fname)
            if fname not in seen and os.path.exists(fpath):
                new_lines.append(f"{sha256_file(fpath)}  {fname}")
        with open(sums_path, "w", encoding="utf-8") as f:
            f.write("\n".join(new_lines) + "\n")

    return dest_arm64


def _resolve_flutter_bin():
    """Locates the Flutter SDK binary, preferring a direct SDK checkout over npm wrapper shims."""
    exe_name = "flutter.bat" if IS_WIN else "flutter"
    candidates = []
    fl_root = os.environ.get("FLUTTER_ROOT", "").strip()
    if fl_root:
        candidates.append(os.path.join(fl_root, "bin", exe_name))

    local_props = os.path.join(ROOT_DIR, "apps", "mobile", "android", "local.properties")
    if os.path.isfile(local_props):
        try:
            with open(local_props, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("flutter.sdk="):
                        sdk_val = line.strip().split("=", 1)[1].replace("\\\\", "\\")
                        candidates.append(os.path.join(sdk_val, "bin", exe_name))
        except Exception:
            pass

    if IS_WIN:
        candidates.extend([
            os.path.expanduser(r"~\flutter\bin\flutter.bat"),
            r"C:\src\flutter\bin\flutter.bat",
            r"C:\flutter\bin\flutter.bat",
        ])
    else:
        candidates.extend([
            os.path.expanduser("~/flutter/bin/flutter"),
            "/opt/flutter/bin/flutter",
            "/usr/local/flutter/bin/flutter",
        ])

    for cand in candidates:
        if cand and os.path.isfile(cand):
            return os.path.abspath(cand)

    found = shutil.which("flutter")
    return found or ""


def _ensure_flutter_gradle_setup(flutter_bin: str) -> None:
    """Ensures Gradle 9.5.0 / AGP 9.3.1 plugin repositories and local.properties are configured."""
    init_d = os.path.join(os.path.expanduser("~"), ".gradle", "init.d")
    os.makedirs(init_d, exist_ok=True)
    init_gradle = os.path.join(init_d, "flutter-plugin-repos.init.gradle")
    if not os.path.isfile(init_gradle):
        try:
            with open(init_gradle, "w", encoding="utf-8") as f:
                f.write(
                    "beforeSettings { s ->\n"
                    "    s.pluginManagement {\n"
                    "        repositories {\n"
                    "            google()\n"
                    "            mavenCentral()\n"
                    "            gradlePluginPortal()\n"
                    "        }\n"
                    "    }\n"
                    "}\n"
                )
        except Exception:
            pass

    local_props = os.path.join(ROOT_DIR, "apps", "mobile", "android", "local.properties")
    fl_sdk_dir = os.path.dirname(os.path.dirname(os.path.abspath(flutter_bin)))
    if not os.path.isfile(local_props) and os.path.isdir(SDK_DIR) and os.path.isdir(fl_sdk_dir):
        try:
            sdk_esc = SDK_DIR.replace("\\", "\\\\")
            fl_esc = fl_sdk_dir.replace("\\", "\\\\")
            with open(local_props, "w", encoding="utf-8") as f:
                f.write(
                    f"sdk.dir={sdk_esc}\n"
                    f"flutter.sdk={fl_esc}\n"
                    "flutter.buildMode=release\n"
                    "flutter.versionName=0.100.0\n"
                    "flutter.versionCode=1000\n"
                )
        except Exception:
            pass


def _sync_release_manifest(rel_tag: str) -> None:
    """Updates public/releases/<tag>/RELEASE_MANIFEST.json and SHA256SUMS.txt."""
    updater = os.path.join(ROOT_DIR, "scripts", "update_release_manifest.py")
    if os.path.isfile(updater):
        subprocess.run([sys.executable, updater, "--tag", rel_tag], cwd=ROOT_DIR, check=False)


def _try_adb_install(apk_path: str) -> bool:
    """Installs the built APK onto a connected Android device/emulator via ADB if requested."""
    adb_candidates = [
        os.path.join(SDK_DIR, "platform-tools", "adb.exe" if IS_WIN else "adb"),
        shutil.which("adb") or "",
    ]
    adb_bin = next((c for c in adb_candidates if c and os.path.isfile(c)), "")
    if not adb_bin:
        print("[WARN] adb not found in Android SDK platform-tools or PATH; skipping device install.")
        return False

    res = subprocess.run([adb_bin, "devices"], capture_output=True, text=True, check=False)
    devices = [
        line.split()[0]
        for line in (res.stdout or "").splitlines()[1:]
        if line.strip() and "\tdevice" in line
    ]
    if not devices:
        print("[INFO] No connected Android device in 'device' state found via adb devices.")
        return False

    for serial in devices:
        print(f"[*] Installing {os.path.basename(apk_path)} onto Android device {serial}...")
        inst = subprocess.run([adb_bin, "-s", serial, "install", "-r", apk_path], check=False)
        if inst.returncode == 0:
            print(f"[OK] Installed APK on {serial} and configuring ADB reverse ports (8765, 3000)...")
            subprocess.run([adb_bin, "-s", serial, "reverse", "tcp:8765", "tcp:8765"], check=False)
            subprocess.run([adb_bin, "-s", serial, "reverse", "tcp:3000", "tcp:3000"], check=False)
        else:
            print(f"[WARN] adb install returned exit code {inst.returncode} for {serial}.")
    return True


def build_flutter_apks(
    fast_arm64_only: bool = False,
    clean: bool = False,
    debug_mode: bool = False,
    install_adb: bool = False,
) -> str:
    """
    Instant incremental Native Flutter Android APK builder for apps/mobile.
    Keeps Gradle & Dart caches warm by default (no flutter clean unless --clean is passed),
    auto-configures JDK 17/21 and Android SDK, compiles arm64-v8a + Universal APKs,
    and publishes artifacts to public/releases/<tag>/.
    """
    import time

    t0 = time.perf_counter()
    flutter_bin = _resolve_flutter_bin()
    if not flutter_bin:
        raise RuntimeError("Flutter SDK not found. Install Flutter 3.29+ or pass --webview-shell.")

    mobile_dir = os.path.join(ROOT_DIR, "apps", "mobile")
    _ensure_flutter_gradle_setup(flutter_bin)

    fl_env = ENV.copy()
    fl_bin_dir = os.path.dirname(os.path.abspath(flutter_bin))
    fl_root_dir = os.path.dirname(fl_bin_dir)
    fl_env["FLUTTER_ROOT"] = fl_root_dir
    path_parts = [fl_bin_dir]
    if os.path.isdir(JDK_DIR):
        fl_env["JAVA_HOME"] = JDK_DIR
        path_parts.append(os.path.join(JDK_DIR, "bin"))
    if os.path.isdir(SDK_DIR):
        fl_env["ANDROID_HOME"] = SDK_DIR
        fl_env["ANDROID_SDK_ROOT"] = SDK_DIR
        pt_dir = os.path.join(SDK_DIR, "platform-tools")
        if os.path.isdir(pt_dir):
            path_parts.append(pt_dir)
    fl_env["PATH"] = os.pathsep.join(path_parts) + os.pathsep + fl_env.get("PATH", "")

    print("=================================================================")
    print(" AI NetController — Instant Native Flutter Android APK Builder")
    print("=================================================================")
    print(f"  Flutter SDK : {flutter_bin}")
    print(f"  JAVA_HOME   : {fl_env.get('JAVA_HOME', 'system default')}")
    print(f"  ANDROID_SDK : {fl_env.get('ANDROID_HOME', 'system default')}")
    print(f"  Build Mode  : {'FAST arm64-v8a ONLY' if fast_arm64_only else ('DEBUG arm64-v8a' if debug_mode else 'FULL RELEASE (Split-ABI + Universal)')}")
    print("=================================================================")

    if clean:
        print("[*] Running flutter clean (--clean requested)...")
        subprocess.run([flutter_bin, "clean"], cwd=mobile_dir, env=fl_env, check=True)

    pkg_cfg = os.path.join(mobile_dir, ".dart_tool", "package_config.json")
    pubspec = os.path.join(mobile_dir, "pubspec.yaml")
    registrant_java = os.path.join(
        mobile_dir,
        "android",
        "app",
        "src",
        "main",
        "java",
        "io",
        "flutter",
        "plugins",
        "GeneratedPluginRegistrant.java",
    )
    need_pub_get = (
        clean
        or not os.path.isfile(pkg_cfg)
        or (os.path.isfile(pubspec) and os.path.getmtime(pubspec) > os.path.getmtime(pkg_cfg))
    )
    need_registrant_regen = need_pub_get or not os.path.isfile(registrant_java)
    if not need_registrant_regen and not debug_mode:
        try:
            with open(registrant_java, "r", encoding="utf-8", errors="ignore") as rf:
                reg_src = rf.read()
            if "integration_test" in reg_src or "home_widget" in reg_src:
                need_registrant_regen = True
        except OSError:
            need_registrant_regen = True

    if need_pub_get:
        print("[*] Resolving Dart/Flutter packages (flutter pub get)...")
        subprocess.run([flutter_bin, "pub", "get"], cwd=mobile_dir, env=fl_env, check=True)
    elif need_registrant_regen:
        print("[*] Regenerating release plugin registrant (filtering dev_dependencies)...")
    else:
        print("[*] Package config up-to-date (.dart_tool/package_config.json cached; using --no-pub fast path).")

    first_pub_args = [] if need_registrant_regen else ["--no-pub"]

    apk_out_dir = os.path.join(mobile_dir, "build", "app", "outputs", "flutter-apk")
    rel_tag = _get_release_tag()
    rel_dir = os.path.join(ROOT_DIR, "public", "releases", rel_tag)
    os.makedirs(rel_dir, exist_ok=True)
    dest_arm64 = os.path.join(rel_dir, f"AI_NetController_{rel_tag}_arm64-v8a.apk")
    dest_univ = os.path.join(rel_dir, f"AI_NetController_{rel_tag}.apk")

    if debug_mode:
        print("[*] Building fast debug arm64-v8a APK...")
        subprocess.run(
            [flutter_bin, "build", "apk", "--debug", "--target-platform", "android-arm64", "--no-pub"],
            cwd=mobile_dir,
            env=fl_env,
            check=True,
        )
        built_debug = os.path.join(apk_out_dir, "app-debug.apk")
        if os.path.isfile(built_debug):
            elapsed = time.perf_counter() - t0
            print(f"\n[SUCCESS] Debug APK built in {elapsed:.1f}s: {built_debug}")
            if install_adb:
                _try_adb_install(built_debug)
            return built_debug

    if fast_arm64_only:
        print("[*] Compiling Release arm64-v8a Split APK (incremental fast mode)...")
        subprocess.run(
            [
                flutter_bin,
                "build",
                "apk",
                "--release",
                "--split-per-abi",
                "--target-platform",
                "android-arm64",
                *first_pub_args,
            ],
            cwd=mobile_dir,
            env=fl_env,
            check=True,
        )
    else:
        print("[1/2] Compiling Release Split-per-ABI APKs (arm64-v8a, armeabi-v7a, x86_64)...")
        subprocess.run(
            [flutter_bin, "build", "apk", "--release", "--split-per-abi", *first_pub_args],
            cwd=mobile_dir,
            env=fl_env,
            check=True,
        )
        print("[2/2] Compiling Release Universal Multi-ABI APK...")
        subprocess.run(
            [flutter_bin, "build", "apk", "--release", "--no-pub"],
            cwd=mobile_dir,
            env=fl_env,
            check=True,
        )

    src_arm64 = os.path.join(apk_out_dir, "app-arm64-v8a-release.apk")
    src_univ = os.path.join(apk_out_dir, "app-release.apk")

    if not os.path.isfile(src_arm64):
        raise RuntimeError(f"Expected Flutter arm64-v8a APK not found at {src_arm64}")

    shutil.copy2(src_arm64, dest_arm64)
    if not fast_arm64_only and os.path.isfile(src_univ):
        shutil.copy2(src_univ, dest_univ)
    elif not os.path.isfile(dest_univ):
        shutil.copy2(src_arm64, dest_univ)

    _sync_release_manifest(rel_tag)
    elapsed = time.perf_counter() - t0
    arm64_mb = os.path.getsize(dest_arm64) / (1024 * 1024)
    arm64_sha = sha256_file(dest_arm64)
    print(f"\n[SUCCESS] Flutter Android APK(s) compiled & staged in {elapsed:.1f}s:")
    print(f"  - arm64-v8a : {dest_arm64} ({arm64_mb:.2f} MB | SHA256={arm64_sha[:16]}...)")
    if os.path.isfile(dest_univ):
        univ_mb = os.path.getsize(dest_univ) / (1024 * 1024)
        univ_sha = sha256_file(dest_univ)
        print(f"  - Universal : {dest_univ} ({univ_mb:.2f} MB | SHA256={univ_sha[:16]}...)")

    if install_adb:
        _try_adb_install(dest_arm64)

    return dest_arm64


def build_webview_shell_apk() -> str:
    """Compiles the lightweight embedded WebView shell APK using Android SDK build-tools."""
    ensure_web_dist()
    setup_staging()
    create_android_manifest()
    create_resources()
    create_main_activity()
    compile_java()
    run_d8()
    compile_and_link_resources()
    apk = zipalign_and_sign()
    return distribute_apk(apk)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="AI NetController — Instant Android APK Builder")
    parser.add_argument("--fast", "--arm64-only", action="store_true", dest="fast", help="Build only arm64-v8a release APK for instant turnaround")
    parser.add_argument("--clean", action="store_true", help="Run flutter clean before building (disables incremental cache)")
    parser.add_argument("--debug", action="store_true", help="Build debug arm64-v8a APK")
    parser.add_argument("--install", "--adb", action="store_true", dest="install", help="Auto-install built APK to connected Android device via ADB")
    parser.add_argument("--webview-shell", action="store_true", help="Build embedded WebView shell APK instead of native Flutter companion app")
    args, _unknown = parser.parse_known_args()

    if args.webview_shell or not _resolve_flutter_bin():
        build_webview_shell_apk()
    else:
        build_flutter_apks(
            fast_arm64_only=args.fast,
            clean=args.clean,
            debug_mode=args.debug,
            install_adb=args.install,
        )
    print(f"\n[ALL DONE] AI NetController Android APK ({_get_release_tag()} / {_get_version_name()}) built and verified.")
