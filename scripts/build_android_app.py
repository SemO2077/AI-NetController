#!/usr/bin/env python3
"""
AI NetController - Native Android Application Builder
Compiles a hardware-accelerated Android APK embedding the exact React/Tailwind/D3 Web Console
using official Android SDK build-tools and JDK 25.
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
    for cand in [
        os.environ.get("ANDROID_HOME", ""),
        os.environ.get("ANDROID_SDK_ROOT", ""),
        r"C:\Users\Lenovo\AppData\Local\Android\Sdk",
        "/usr/local/lib/android/sdk",
        os.path.expanduser("~/Android/Sdk"),
    ]:
        if cand and os.path.isdir(cand):
            return cand
    return os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or r"C:\Users\Lenovo\AppData\Local\Android\Sdk"

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
    win_jbr = r"C:\Program Files\Android\Android Studio\jbr"
    if IS_WIN and os.path.isdir(win_jbr):
        return win_jbr
    javac_bin = shutil.which("javac")
    if javac_bin:
        return os.path.dirname(os.path.dirname(os.path.realpath(javac_bin)))
    return env_java or win_jbr

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
    # Also copy release metadata (manifest, checksums, patch notes) into assets/dist/releases/<tag>
    rel_tag = _get_release_tag()
    rel_src = os.path.join(ROOT_DIR, "public", "releases", rel_tag)
    if not os.path.exists(rel_src):
        rel_src = os.path.join(ROOT_DIR, "public", "releases", "v0.50.0")
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
                v = str(json.load(f).get("version", "0.50.0")).strip()
                return f"v{v}" if not v.startswith("v") else v
        except Exception:
            pass
    return "v0.50.0"


def _get_version_name():
    ver = _get_release_tag().lstrip("v")
    if ver == "0.50.0":
        return "0.50.00-beta"
    return ver


def create_android_manifest():
    ver_name = _get_version_name()
    parts = [int(p) for p in _get_release_tag().lstrip("v").split(".")[:3] if p.isdigit()]
    ver_code = str(parts[0] * 1000 + parts[1] * 10 + parts[2]) if len(parts) == 3 else "500"
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
        android:icon="@drawable/ic_launcher"
        android:roundIcon="@drawable/ic_launcher"
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
    # Embedded local server in MainActivity guarantees full ES Module, dynamic import, WebWorker, and Native LAN Controller support
    java_content = r"""package com.cst.autonomouslan;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.FileReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

public class MainActivity extends Activity {
    private static final String TAG = "AINetController";
    private static final String APP_VERSION = "__APP_VERSION__";
    private static final String RELEASE_TAG = "__RELEASE_TAG__";
    private WebView webView;
    private ServerSocket localServer;
    private final ExecutorService httpPool = Executors.newFixedThreadPool(12);
    private int localPort = 0;
    private volatile boolean isRunning = true;
    private volatile boolean isLocalOriginLoaded = false;
    private final long startTimeMs = System.currentTimeMillis();

    // Local device daemon controller state & per-launch credentials
    private volatile boolean daemonRunning = true;
    private volatile boolean daemonTlsActive = true;
    private volatile String daemonHitlMode = "strict";
    private volatile boolean daemonViewOnly = false;
    private volatile String daemonPin = generatePin();
    private volatile String daemonToken = generateHexToken("ai_sec_", 16);
    private final String bridgeSessionToken = generateHexToken("bridge_", 24);

    private static String generatePin() {
        return String.valueOf(100000 + new SecureRandom().nextInt(900000));
    }

    private static String generateHexToken(String prefix, int numBytes) {
        byte[] bytes = new byte[numBytes];
        new SecureRandom().nextBytes(bytes);
        StringBuilder sb = new StringBuilder(prefix);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b & 0xff));
        }
        return sb.toString();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Hardware accelerated UI rendering
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );

        Window window = getWindow();

        // 1. Edge-to-Edge System Bars (Status Bar & Gesture Navigation Bar)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.clearFlags(
                WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS |
                WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION
            );
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.parseColor("#030712"));
            window.setNavigationBarColor(Color.parseColor("#030712"));
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                window.setStatusBarContrastEnforced(false);
                window.setNavigationBarContrastEnforced(false);
            } catch (Throwable ignored) {}
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                WindowManager.LayoutParams lp = window.getAttributes();
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                window.setAttributes(lp);
            } catch (Throwable ignored) {}
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                window.setDecorFitsSystemWindows(false);
                android.view.WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.setSystemBarsAppearance(
                        0,
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                    );
                }
            } catch (Throwable ignored) {}
        }

        // 144Hz / 120Hz high refresh rate unlock
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                android.view.Display display;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    display = getDisplay();
                } else {
                    display = getWindowManager().getDefaultDisplay();
                }
                if (display != null) {
                    android.view.Display.Mode[] modes = display.getSupportedModes();
                    float maxRate = 60.0f;
                    int targetModeId = 0;
                    for (android.view.Display.Mode m : modes) {
                        if (m.getRefreshRate() > maxRate) {
                            maxRate = m.getRefreshRate();
                            targetModeId = m.getModeId();
                        }
                    }
                    if (targetModeId != 0) {
                        WindowManager.LayoutParams params = window.getAttributes();
                        params.preferredDisplayModeId = targetModeId;
                        params.preferredRefreshRate = maxRate;
                        window.setAttributes(params);
                    }
                }
            } catch (Throwable ignored) {}
        }

        // Start embedded local asset & native API server
        startLocalAssetServer();

        final FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF030712);

        // Apply exact WindowInsets padding so status bar, camera cutout, gesture bar, and IME keyboard never overlap the UI
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
            root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                @Override
                public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        Insets sys = insets.getInsets(
                            WindowInsets.Type.systemBars() |
                            WindowInsets.Type.displayCutout() |
                            WindowInsets.Type.ime()
                        );
                        v.setPadding(sys.left, sys.top, sys.right, sys.bottom);
                        return WindowInsets.CONSUMED;
                    } else {
                        v.setPadding(
                            insets.getSystemWindowInsetLeft(),
                            insets.getSystemWindowInsetTop(),
                            insets.getSystemWindowInsetRight(),
                            insets.getSystemWindowInsetBottom()
                        );
                        return insets.consumeSystemWindowInsets();
                    }
                }
            });
        }

        setContentView(root);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF030712);
        // Use direct Chromium GPU hardware composition (LAYER_TYPE_NONE prevents double-FBO memory overhead)
        webView.setLayerType(View.LAYER_TYPE_NONE, null);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            boolean isDebuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            WebView.setWebContentsDebuggingEnabled(isDebuggable);
        }
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        CookieManager.getInstance().setAcceptCookie(true);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // HTML5 Mobile Viewport: Enables dynamic 1:1 scaling according to viewport-fit=cover
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        try {
            String baseUa = settings.getUserAgentString();
            settings.setUserAgentString((baseUa != null ? baseUa : "") + " AI_NetController_Android/" + APP_VERSION);
        } catch (Throwable ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                settings.setForceDark(WebSettings.FORCE_DARK_OFF);
            } catch (Throwable ignored) {}
        }
        try {
            java.lang.reflect.Method m = settings.getClass().getMethod("setAlgorithmicDarkeningAllowed", boolean.class);
            m.invoke(settings, false);
        } catch (Throwable ignored) {}

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            settings.setOffscreenPreRaster(true);
        }
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setRenderPriority(WebSettings.RenderPriority.HIGH);
        settings.setMediaPlaybackRequiresUserGesture(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        // Native Android Bridge: Haptics, Clipboard, UDP Wake-on-LAN, LAN IP Discovery (loopback-gated)
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void vibrate(int durationMs) {
                if (!isLocalOriginLoaded) return;
                try {
                    int ms = Math.max(5, Math.min(durationMs, 60));
                    Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                    if (v != null && v.hasVibrator()) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                        } else {
                            v.vibrate(ms);
                        }
                    }
                } catch (Throwable ignored) {}
            }

            @JavascriptInterface
            public boolean sendWolUdp(String mac, String bcast, int port) {
                if (!isLocalOriginLoaded) return false;
                return sendNativeWol(mac, bcast, port, null);
            }

            @JavascriptInterface
            public boolean copyToClipboard(final String text) {
                if (!isLocalOriginLoaded || text == null) return false;
                try {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                                if (cm != null) {
                                    ClipData clip = ClipData.newPlainText("AI NetController", text);
                                    cm.setPrimaryClip(clip);
                                }
                            } catch (Throwable ignored) {}
                        }
                    });
                    return true;
                } catch (Throwable e) {
                    return false;
                }
            }

            @JavascriptInterface
            public String getLanIp() {
                if (!isLocalOriginLoaded) return "127.0.0.1";
                return detectDeviceLanIp();
            }
        }, "AndroidBridge");

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                try {
                    if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    }
                } catch (Throwable ignored) {}
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                Log.i(TAG, "[Console " + msg.messageLevel() + "] " + msg.message() + " (" + msg.sourceId() + ":" + msg.lineNumber() + ")");
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                try {
                    Uri origin = request.getOrigin();
                    if (origin != null && "http".equalsIgnoreCase(origin.getScheme())
                        && "127.0.0.1".equals(origin.getHost()) && origin.getPort() == localPort) {
                        request.grant(request.getResources());
                        return;
                    }
                } catch (Throwable ignored) {}
                request.deny();
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            private boolean isTrustedLoopbackUrl(String rawUrl) {
                if (rawUrl == null) return false;
                try {
                    Uri u = Uri.parse(rawUrl);
                    String scheme = u.getScheme() != null ? u.getScheme().toLowerCase(Locale.US) : "";
                    return "http".equals(scheme) && "127.0.0.1".equals(u.getHost()) && u.getPort() == localPort;
                } catch (Throwable ignored) {
                    return false;
                }
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                isLocalOriginLoaded = isTrustedLoopbackUrl(url);
                Log.i(TAG, "onPageStarted: " + url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                isLocalOriginLoaded = isTrustedLoopbackUrl(url);
                Log.i(TAG, "onPageFinished: " + url);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                Log.e(TAG, "onReceivedError: " + errorCode + " " + description + " URL: " + failingUrl);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return true;
                if (isTrustedLoopbackUrl(url)) {
                    return false;
                }
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                        return true;
                    } catch (Throwable ignored) {}
                }
                return true;
            }
        });

        webView.loadUrl("http://127.0.0.1:" + localPort + "/index.html");
    }

    private String detectDeviceLanIp() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface ni = interfaces.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (addr instanceof Inet4Address && !addr.isLoopbackAddress()) {
                        String ip = addr.getHostAddress();
                        if (ip != null && !ip.startsWith("169.254.")) {
                            return ip;
                        }
                    }
                }
            }
        } catch (Throwable ignored) {}
        return "127.0.0.1";
    }

    private List<InetAddress> detectBroadcastAddresses(String requestedBcast) {
        Set<String> targets = new LinkedHashSet<String>();
        if (requestedBcast != null && !requestedBcast.trim().isEmpty()) {
            targets.add(requestedBcast.trim());
        }
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface ni = interfaces.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress bcast = ia.getBroadcast();
                    if (bcast != null) {
                        targets.add(bcast.getHostAddress());
                    }
                }
            }
        } catch (Throwable ignored) {}
        String lanIp = detectDeviceLanIp();
        if (lanIp.contains(".")) {
            targets.add(lanIp.substring(0, lanIp.lastIndexOf('.') + 1) + "255");
        }
        targets.add("255.255.255.255");

        List<InetAddress> result = new ArrayList<InetAddress>();
        for (String t : targets) {
            try {
                result.add(InetAddress.getByName(t));
            } catch (Throwable ignored) {}
        }
        return result;
    }

    private boolean sendNativeWol(String macStr, String bcastStr, int port, String secureOnHex) {
        try {
            if (macStr == null || macStr.trim().isEmpty()) return false;
            String cleanMac = macStr.replaceAll("[^0-9A-Fa-f]", "");
            if (cleanMac.length() != 12) return false;

            byte[] macBytes = new byte[6];
            for (int i = 0; i < 6; i++) {
                macBytes[i] = (byte) Integer.parseInt(cleanMac.substring(i * 2, i * 2 + 2), 16);
            }

            byte[] secureBytes = null;
            if (secureOnHex != null && !secureOnHex.trim().isEmpty()) {
                String cleanSec = secureOnHex.replaceAll("[^0-9A-Fa-f]", "");
                if (cleanSec.length() == 12) {
                    secureBytes = new byte[6];
                    for (int i = 0; i < 6; i++) {
                        secureBytes[i] = (byte) Integer.parseInt(cleanSec.substring(i * 2, i * 2 + 2), 16);
                    }
                }
            }

            int packetLen = (secureBytes != null) ? 108 : 102;
            byte[] magicPacket = new byte[packetLen];
            for (int i = 0; i < 6; i++) {
                magicPacket[i] = (byte) 0xFF;
            }
            for (int i = 0; i < 16; i++) {
                System.arraycopy(macBytes, 0, magicPacket, 6 + i * 6, 6);
            }
            if (secureBytes != null) {
                System.arraycopy(secureBytes, 0, magicPacket, 102, 6);
            }

            int targetPort = (port > 0 && port < 65536) ? port : 9;
            List<InetAddress> bcastAddrs = detectBroadcastAddresses(bcastStr);

            DatagramSocket dsock = null;
            try {
                dsock = new DatagramSocket();
                dsock.setBroadcast(true);
                for (InetAddress addr : bcastAddrs) {
                    try {
                        DatagramPacket packet = new DatagramPacket(magicPacket, magicPacket.length, addr, targetPort);
                        dsock.send(packet);
                        if (targetPort != 7) {
                            DatagramPacket packet7 = new DatagramPacket(magicPacket, magicPacket.length, addr, 7);
                            dsock.send(packet7);
                        }
                    } catch (Throwable ignored) {}
                }
            } finally {
                if (dsock != null) {
                    try { dsock.close(); } catch (Throwable ignored) {}
                }
            }
            Log.i(TAG, "Native WoL Magic Packet (" + packetLen + "B) dispatched for " + cleanMac);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Native WoL broadcast error: " + e.getMessage());
            return false;
        }
    }

    private Map<String, String> readArpNeighborTable() {
        Map<String, String> ipToMac = new HashMap<String, String>();
        // 1. Try ip neigh show
        Process proc = null;
        try {
            proc = new ProcessBuilder("ip", "neigh", "show").redirectErrorStream(true).start();
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) {
                    String[] parts = line.trim().split("\\s+");
                    if (parts.length >= 5) {
                        String ip = parts[0];
                        for (int i = 1; i < parts.length - 1; i++) {
                            if ("lladdr".equalsIgnoreCase(parts[i])) {
                                String mac = parts[i + 1].toUpperCase(Locale.US);
                                if (mac.matches("([0-9A-F]{2}:){5}[0-9A-F]{2}") && !mac.equals("00:00:00:00:00:00")) {
                                    ipToMac.put(ip, mac);
                                }
                            }
                        }
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!proc.waitFor(2, TimeUnit.SECONDS)) {
                    proc.destroy();
                }
            } else {
                proc.waitFor();
            }
        } catch (Throwable ignored) {
        } finally {
            if (proc != null) {
                try { proc.destroy(); } catch (Throwable ignored) {}
            }
        }

        // 2. Try /proc/net/arp fallback
        try (BufferedReader br = new BufferedReader(new FileReader("/proc/net/arp"))) {
            String line;
            while ((line = br.readLine()) != null) {
                String[] tokens = line.trim().split("\\s+");
                if (tokens.length >= 4) {
                    String ip = tokens[0];
                    String mac = tokens[3].toUpperCase(Locale.US);
                    if (mac.matches("([0-9A-F]{2}:){5}[0-9A-F]{2}") && !mac.equals("00:00:00:00:00:00")) {
                        ipToMac.put(ip, mac);
                    }
                }
            }
        } catch (Throwable ignored) {}

        return ipToMac;
    }

    private String scanLocalSubnetJson() {
        final String selfIp = detectDeviceLanIp();
        if (selfIp.equals("127.0.0.1") || !selfIp.contains(".")) {
            return "{\"hosts\":[]}";
        }
        final String subnetPrefix = selfIp.substring(0, selfIp.lastIndexOf('.') + 1);

        final Map<String, String> arpTable = readArpNeighborTable();
        ExecutorService pool = Executors.newFixedThreadPool(32);
        List<Future<String>> futures = new ArrayList<Future<String>>();

        for (int hostNum = 1; hostNum <= 254; hostNum++) {
            final int lastOctet = hostNum;
            final String candidateIp = subnetPrefix + lastOctet;
            if (candidateIp.equals(selfIp)) continue;

            futures.add(pool.submit(new Callable<String>() {
                @Override
                public String call() throws Exception {
                    long t0 = System.currentTimeMillis();
                    boolean agentOpen = isTcpPortOpen(candidateIp, 8765, 175);
                    boolean webOpen = !agentOpen && isTcpPortOpen(candidateIp, 3000, 160);
                    boolean winOpen = !agentOpen && !webOpen && (isTcpPortOpen(candidateIp, 445, 150) || isTcpPortOpen(candidateIp, 135, 150));
                    boolean sshOpen = !agentOpen && !webOpen && !winOpen && isTcpPortOpen(candidateIp, 22, 150);
                    boolean reachable = agentOpen || webOpen || winOpen || sshOpen;

                    if (!reachable && arpTable.containsKey(candidateIp)) {
                        reachable = true;
                    }
                    if (!reachable) {
                        try {
                            reachable = InetAddress.getByName(candidateIp).isReachable(140);
                        } catch (Throwable ignored) {}
                    }
                    if (!reachable) return null;

                    int pingMs = Math.max(1, (int) (System.currentTimeMillis() - t0));
                    String mac = arpTable.get(candidateIp);
                    if (mac == null) {
                        mac = "";
                    }
                    String os = sshOpen && !winOpen ? "linux" : "windows";
                    String name = (agentOpen ? "AI-AGENT-" : (sshOpen ? "LINUX-NODE-" : "LAN-PC-")) + lastOctet;
                    int port = 8765;

                    // If target runs CST Web Console on 3000, query /api/setup/info for exact metadata
                    if (webOpen || agentOpen) {
                        try {
                            URL u = new URL("http://" + candidateIp + ":3000/api/setup/info");
                            HttpURLConnection conn = (HttpURLConnection) u.openConnection();
                            conn.setConnectTimeout(220);
                            conn.setReadTimeout(220);
                            if (conn.getResponseCode() == 200) {
                                try (BufferedReader r = new BufferedReader(
                                        new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                                    StringBuilder infoSb = new StringBuilder();
                                    String ln;
                                    while ((ln = r.readLine()) != null) infoSb.append(ln);
                                    JSONObject infoObj = new JSONObject(infoSb.toString());
                                    String hName = infoObj.optString("hostname", "");
                                    String hMac = infoObj.optString("mac", "");
                                    String hOs = infoObj.optString("osName", infoObj.optString("os", ""));
                                    if (!hName.isEmpty()) name = hName;
                                    if (hMac.length() == 17) mac = hMac.toUpperCase(Locale.US);
                                    if (!hOs.isEmpty()) os = hOs;
                                }
                            }
                            conn.disconnect();
                        } catch (Throwable ignored) {}
                    }

                    String safeId = name.toUpperCase(Locale.US).replaceAll("[^A-Z0-9-_]", "-");
                    JSONObject hostJson = new JSONObject();
                    hostJson.put("id", safeId);
                    hostJson.put("name", name);
                    hostJson.put("ip", candidateIp);
                    hostJson.put("mac", mac);
                    hostJson.put("port", port);
                    hostJson.put("os", os);
                    hostJson.put("isOnline", true);
                    hostJson.put("ping", pingMs);
                    return hostJson.toString();
                }
            }));
        }

        pool.shutdown();
        try {
            pool.awaitTermination(3800, TimeUnit.MILLISECONDS);
        } catch (Throwable ignored) {}
        pool.shutdownNow();

        StringBuilder sb = new StringBuilder();
        sb.append("{\"hosts\":[");
        boolean first = true;
        for (Future<String> f : futures) {
            if (f.isDone() && !f.isCancelled()) {
                try {
                    String item = f.get();
                    if (item != null) {
                        if (!first) sb.append(",");
                        sb.append(item);
                        first = false;
                    }
                } catch (Throwable ignored) {}
            }
        }
        sb.append("]}");
        return sb.toString();
    }

    private static boolean isTcpPortOpen(String ip, int port, int timeoutMs) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(ip, port), timeoutMs);
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        String quoted = JSONObject.quote(s);
        return quoted.substring(1, quoted.length() - 1);
    }

    private static JSONObject parseJsonObject(String json) {
        if (json == null || json.trim().isEmpty()) return new JSONObject();
        try {
            return new JSONObject(json);
        } catch (Throwable ignored) {
            return new JSONObject();
        }
    }

    private static String httpReasonPhrase(int code) {
        switch (code) {
            case 200: return "OK";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 500: return "Internal Server Error";
            case 501: return "Not Implemented";
            case 503: return "Service Unavailable";
            default: return code >= 400 ? "Error" : "OK";
        }
    }

    private static void sendJsonResponse(OutputStream out, int code, String json) throws Exception {
        byte[] data = json.getBytes(StandardCharsets.UTF_8);
        String headers = "HTTP/1.1 " + code + " " + httpReasonPhrase(code) + "\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: " + data.length + "\r\n" +
            "Cache-Control: no-store\r\n" +
            "X-Content-Type-Options: nosniff\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.write(data);
        out.flush();
    }

    private String readAssetText(String assetPath) {
        try {
            InputStream is = getAssets().open(assetPath);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            is.close();
            return new String(baos.toByteArray(), "UTF-8");
        } catch (Throwable e) {
            return null;
        }
    }

    private String buildDaemonStateJson() {
        String lanIp = detectDeviceLanIp();
        long uptimeSec = Math.max(1L, (System.currentTimeMillis() - startTimeMs) / 1000L);
        int cpuCores = Math.max(1, Runtime.getRuntime().availableProcessors());

        long memTotalKb = 0L;
        long memAvailKb = 0L;
        try (BufferedReader br = new BufferedReader(new FileReader("/proc/meminfo"))) {
            String line;
            while ((line = br.readLine()) != null) {
                if (line.startsWith("MemTotal:")) {
                    String[] p = line.trim().split("\\s+");
                    if (p.length >= 2) memTotalKb = Long.parseLong(p[1]);
                } else if (line.startsWith("MemAvailable:")) {
                    String[] p = line.trim().split("\\s+");
                    if (p.length >= 2) memAvailKb = Long.parseLong(p[1]);
                }
            }
        } catch (Throwable ignored) {}

        double ramTotalGb = memTotalKb > 0 ? Math.round((memTotalKb / 1048576.0) * 100.0) / 100.0 : 0.0;
        double ramUsedGb = (memTotalKb > 0 && memAvailKb >= 0 && memTotalKb >= memAvailKb)
                ? Math.round(((memTotalKb - memAvailKb) / 1048576.0) * 100.0) / 100.0
                : 0.0;
        int ramPercent = (memTotalKb > 0 && memAvailKb >= 0 && memTotalKb >= memAvailKb)
                ? (int) Math.round(((memTotalKb - memAvailKb) * 100.0) / memTotalKb)
                : 0;

        int diskPercent = 0;
        try {
            android.os.StatFs statFs = new android.os.StatFs(getFilesDir().getAbsolutePath());
            long totalBytes = statFs.getTotalBytes();
            long availBytes = statFs.getAvailableBytes();
            if (totalBytes > 0) {
                diskPercent = (int) Math.round(((totalBytes - availBytes) * 100.0) / totalBytes);
            }
        } catch (Throwable ignored) {}

        String hostModel = (Build.MANUFACTURER != null ? Build.MANUFACTURER : "Android") + " " + (Build.MODEL != null ? Build.MODEL : "Device");
        try {
            JSONObject obj = new JSONObject();
            obj.put("status", daemonRunning ? "running" : "stopped");
            obj.put("isRunning", daemonRunning);
            obj.put("isPaused", !daemonRunning);
            obj.put("version", APP_VERSION);
            obj.put("protocol", "AI-NET/3.0-SECURE");
            obj.put("hostname", hostModel.trim());
            obj.put("osName", "Android " + Build.VERSION.RELEASE + " (" + Build.MODEL + ")");
            obj.put("os", "Android " + Build.VERSION.RELEASE + " (" + Build.MODEL + ")");
            obj.put("localIp", lanIp);
            obj.put("ip", lanIp);
            obj.put("mac", "");
            obj.put("port", 8765);
            obj.put("wsUri", "ws://" + lanIp + ":8765");
            obj.put("uptime", uptimeSec + "s");
            obj.put("uptimeSeconds", uptimeSec);
            obj.put("mdnsEnabled", false);
            obj.put("viewOnlyMode", daemonViewOnly);
            obj.put("requireHitlApproval", true);
            obj.put("cpuPercent", 0);
            obj.put("cpuCores", cpuCores);
            obj.put("ramPercent", ramPercent);
            obj.put("ramUsedGb", ramUsedGb);
            obj.put("ramTotalGb", ramTotalGb);
            obj.put("diskPercent", diskPercent);
            obj.put("captureFps", 0);
            obj.put("connectedClients", new JSONArray());
            obj.put("blacklistedDevices", new JSONArray());
            JSONArray adapters = new JSONArray();
            if (!"127.0.0.1".equals(lanIp)) {
                JSONObject wlan = new JSONObject();
                wlan.put("name", "wlan0");
                wlan.put("ipv4", lanIp);
                wlan.put("mac", "");
                adapters.put(wlan);
            }
            obj.put("activeAdapters", adapters);
            JSONObject sec = new JSONObject();
            sec.put("tlsActive", daemonTlsActive);
            sec.put("hitlMode", daemonHitlMode);
            sec.put("viewOnlyMode", daemonViewOnly);
            obj.put("security", sec);
            obj.put("pairingPin", daemonPin);
            obj.put("pairingToken", daemonToken);
            obj.put("logs", new JSONArray());
            return obj.toString();
        } catch (Throwable e) {
            return "{\"status\":\"error\",\"error\":\"" + escapeJson(e.getMessage()) + "\"}";
        }
    }

    private static String readAllStream(InputStream is) {
        if (is == null) return "";
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            return sb.toString();
        } catch (Throwable ignored) {
            return "";
        }
    }

    private void handleGeminiChat(OutputStream out, String body, String headerApiKey) throws Exception {
        JSONObject req = parseJsonObject(body);
        String apiKey = req.optString("apiKey", req.optString("geminiApiKey", "")).trim();
        if (apiKey.isEmpty() && headerApiKey != null) apiKey = headerApiKey.trim();
        if (apiKey.isEmpty()) {
            sendJsonResponse(out, 400, "{\"error\":\"MISSING_API_KEY\",\"message\":\"Gemini API key is required. Configure your API key in Settings.\"}");
            return;
        }

        String model = req.optString("model", "gemini-2.5-flash").trim();
        if (model.isEmpty() || !model.matches("[a-zA-Z0-9._-]+")) {
            sendJsonResponse(out, 400, "{\"error\":\"INVALID_MODEL\",\"message\":\"Invalid Gemini model identifier.\"}");
            return;
        }

        JSONArray contents = new JSONArray();
        JSONArray inputMsgs = req.optJSONArray("messages");
        if (inputMsgs != null) {
            for (int i = 0; i < inputMsgs.length(); i++) {
                JSONObject m = inputMsgs.optJSONObject(i);
                if (m == null) continue;
                String role = m.optString("role", "user");
                if ("assistant".equalsIgnoreCase(role)) role = "model";
                if (!"user".equals(role) && !"model".equals(role)) continue;
                String text = m.optString("content", m.optString("text", "")).trim();
                if (text.isEmpty()) {
                    JSONArray parts = m.optJSONArray("parts");
                    if (parts != null && parts.length() > 0) {
                        JSONObject p0 = parts.optJSONObject(0);
                        if (p0 != null) text = p0.optString("text", "").trim();
                    }
                }
                if (!text.isEmpty()) {
                    JSONObject item = new JSONObject();
                    item.put("role", role);
                    item.put("parts", new JSONArray().put(new JSONObject().put("text", text)));
                    contents.put(item);
                }
            }
        }
        String prompt = req.optString("prompt", req.optString("message", "")).trim();
        if (contents.length() == 0 && !prompt.isEmpty()) {
            JSONObject item = new JSONObject();
            item.put("role", "user");
            item.put("parts", new JSONArray().put(new JSONObject().put("text", prompt)));
            contents.put(item);
        }
        if (contents.length() == 0) {
            sendJsonResponse(out, 400, "{\"error\":\"EMPTY_PROMPT\",\"message\":\"A prompt or messages array is required.\"}");
            return;
        }

        JSONObject payload = new JSONObject();
        payload.put("contents", contents);
        String sysInst = req.optString("systemInstruction", "").trim();
        if (!sysInst.isEmpty()) {
            payload.put("systemInstruction", new JSONObject().put("parts", new JSONArray().put(new JSONObject().put("text", sysInst))));
        }

        HttpsURLConnection conn = null;
        try {
            URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent");
            conn = (HttpsURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(25000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("x-goog-api-key", apiKey);
            byte[] outBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(outBytes);
            }
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                String respStr = readAllStream(conn.getInputStream());
                JSONObject respJson = parseJsonObject(respStr);
                String replyText = "";
                JSONArray cands = respJson.optJSONArray("candidates");
                if (cands != null && cands.length() > 0) {
                    JSONObject content = cands.optJSONObject(0) != null ? cands.optJSONObject(0).optJSONObject("content") : null;
                    JSONArray parts = content != null ? content.optJSONArray("parts") : null;
                    if (parts != null) {
                        StringBuilder sb = new StringBuilder();
                        for (int i = 0; i < parts.length(); i++) {
                            JSONObject p = parts.optJSONObject(i);
                            if (p != null) sb.append(p.optString("text", ""));
                        }
                        replyText = sb.toString();
                    }
                }
                JSONObject ok = new JSONObject();
                ok.put("reply", replyText);
                ok.put("actions", new JSONArray());
                ok.put("modelUsed", model);
                sendJsonResponse(out, 200, ok.toString());
            } else {
                String errBody = readAllStream(conn.getErrorStream());
                JSONObject errObj = new JSONObject();
                errObj.put("error", "GEMINI_API_ERROR");
                errObj.put("status", code);
                errObj.put("message", errBody.isEmpty() ? ("Gemini API returned HTTP " + code) : errBody);
                sendJsonResponse(out, code >= 400 && code < 600 ? code : 502, errObj.toString());
            }
        } catch (Throwable e) {
            JSONObject err = new JSONObject();
            err.put("error", "GEMINI_NETWORK_ERROR");
            err.put("message", e.getMessage() != null ? e.getMessage() : "Failed to reach Gemini API.");
            sendJsonResponse(out, 503, err.toString());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void handleGeminiModelTest(OutputStream out, String body, String headerApiKey) throws Exception {
        JSONObject req = parseJsonObject(body);
        String apiKey = req.optString("apiKey", req.optString("geminiApiKey", "")).trim();
        if (apiKey.isEmpty() && headerApiKey != null) apiKey = headerApiKey.trim();
        if (apiKey.isEmpty()) {
            sendJsonResponse(out, 400, "{\"success\":false,\"error\":\"MISSING_API_KEY\",\"message\":\"Gemini API key is required to run a live model test.\"}");
            return;
        }
        String model = req.optString("model", "gemini-2.5-flash").trim();
        if (model.isEmpty() || !model.matches("[a-zA-Z0-9._-]+")) {
            sendJsonResponse(out, 400, "{\"success\":false,\"error\":\"INVALID_MODEL\",\"message\":\"Invalid model identifier.\"}");
            return;
        }
        long started = System.nanoTime();
        HttpsURLConnection conn = null;
        try {
            URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/" + model);
            conn = (HttpsURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("x-goog-api-key", apiKey);
            int code = conn.getResponseCode();
            long latencyMs = Math.max(1L, (System.nanoTime() - started) / 1_000_000L);
            if (code >= 200 && code < 300) {
                JSONObject res = new JSONObject();
                res.put("success", true);
                res.put("status", "reachable");
                res.put("model", model);
                res.put("latencyMs", latencyMs);
                sendJsonResponse(out, 200, res.toString());
            } else {
                String errBody = readAllStream(conn.getErrorStream());
                JSONObject res = new JSONObject();
                res.put("success", false);
                res.put("error", "GEMINI_TEST_FAILED");
                res.put("status", code);
                res.put("latencyMs", latencyMs);
                res.put("message", errBody.isEmpty() ? ("Gemini API returned HTTP " + code) : errBody);
                sendJsonResponse(out, code >= 400 && code < 600 ? code : 502, res.toString());
            }
        } catch (Throwable e) {
            JSONObject err = new JSONObject();
            err.put("success", false);
            err.put("error", "GEMINI_NETWORK_ERROR");
            err.put("message", e.getMessage() != null ? e.getMessage() : "Unable to contact Gemini API.");
            sendJsonResponse(out, 503, err.toString());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void startLocalAssetServer() {
        try {
            localServer = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            localPort = localServer.getLocalPort();
            Log.i(TAG, "Local asset server active on http://127.0.0.1:" + localPort);

            Thread serverThread = new Thread(new Runnable() {
                @Override
                public void run() {
                    while (isRunning) {
                        try {
                            Socket client = localServer.accept();
                            handleClient(client);
                        } catch (Exception e) {
                            if (!isRunning) break;
                        }
                    }
                }
            }, "LocalAssetServer");
            serverThread.setDaemon(true);
            serverThread.start();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start local server: " + e.getMessage());
        }
    }

    private boolean isAuthorizedLoopbackRequest(String cookieHeader, String bridgeHeader) {
        byte[] expected = bridgeSessionToken.getBytes(StandardCharsets.UTF_8);
        if (bridgeHeader != null && !bridgeHeader.isEmpty()) {
            if (MessageDigest.isEqual(expected, bridgeHeader.trim().getBytes(StandardCharsets.UTF_8))) {
                return true;
            }
        }
        if (cookieHeader != null && !cookieHeader.isEmpty()) {
            String[] cookies = cookieHeader.split(";");
            for (String raw : cookies) {
                String c = raw.trim();
                if (c.startsWith("ai_net_bridge=")) {
                    String val = c.substring("ai_net_bridge=".length()).trim();
                    if (MessageDigest.isEqual(expected, val.getBytes(StandardCharsets.UTF_8))) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private void handleClient(final Socket socket) {
        httpPool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    socket.setSoTimeout(8000);
                    InputStream in = socket.getInputStream();
                    OutputStream out = socket.getOutputStream();

                    // Read full HTTP headers + Content-Length body
                    ByteArrayOutputStream reqBuf = new ByteArrayOutputStream();
                    byte[] tmp = new byte[4096];
                    int headerEnd = -1;
                    int contentLength = 0;

                    while (headerEnd == -1) {
                        int n = in.read(tmp);
                        if (n <= 0) break;
                        reqBuf.write(tmp, 0, n);
                        byte[] current = reqBuf.toByteArray();
                        for (int i = 0; i <= current.length - 4; i++) {
                            if (current[i] == '\r' && current[i + 1] == '\n' && current[i + 2] == '\r' && current[i + 3] == '\n') {
                                headerEnd = i + 4;
                                break;
                            }
                        }
                        if (current.length > 65536) break;
                    }

                    byte[] initialBytes = reqBuf.toByteArray();
                    if (initialBytes.length == 0) {
                        socket.close();
                        return;
                    }

                    String headerStr = headerEnd != -1
                        ? new String(initialBytes, 0, headerEnd, StandardCharsets.UTF_8)
                        : new String(initialBytes, StandardCharsets.UTF_8);

                    String[] headerLines = headerStr.split("\r?\n");
                    if (headerLines.length == 0) {
                        socket.close();
                        return;
                    }

                    String hostHeader = "";
                    String originHeader = "";
                    String cookieHeader = "";
                    String bridgeHeader = "";
                    String headerGeminiKey = "";
                    for (int i = 1; i < headerLines.length; i++) {
                        String hl = headerLines[i];
                        int colon = hl.indexOf(':');
                        if (colon <= 0) continue;
                        String hName = hl.substring(0, colon).trim().toLowerCase(Locale.US);
                        String hVal = hl.substring(colon + 1).trim();
                        if ("content-length".equals(hName)) {
                            try {
                                contentLength = Math.max(0, Math.min(Integer.parseInt(hVal), 1048576));
                            } catch (Throwable ignored) {}
                        } else if ("host".equals(hName)) {
                            hostHeader = hVal;
                        } else if ("origin".equals(hName)) {
                            originHeader = hVal;
                        } else if ("cookie".equals(hName)) {
                            cookieHeader = hVal;
                        } else if ("x-bridge-token".equals(hName)) {
                            bridgeHeader = hVal;
                        } else if ("x-gemini-api-key".equals(hName)) {
                            headerGeminiKey = hVal;
                        }
                    }

                    while (headerEnd != -1 && (reqBuf.size() - headerEnd) < contentLength) {
                        int n = in.read(tmp);
                        if (n <= 0) break;
                        reqBuf.write(tmp, 0, n);
                    }

                    byte[] fullBytes = reqBuf.toByteArray();
                    String bodyStr = (headerEnd != -1 && fullBytes.length > headerEnd)
                        ? new String(fullBytes, headerEnd, fullBytes.length - headerEnd, StandardCharsets.UTF_8)
                        : "";

                    String[] parts = headerLines[0].split(" ");
                    if (parts.length < 2) {
                        socket.close();
                        return;
                    }

                    String expectedHost = "127.0.0.1:" + localPort;
                    String expectedLocalhost = "localhost:" + localPort;
                    if (!hostHeader.isEmpty() && !expectedHost.equalsIgnoreCase(hostHeader) && !expectedLocalhost.equalsIgnoreCase(hostHeader)) {
                        sendJsonResponse(out, 403, "{\"error\":\"FORBIDDEN_HOST\"}");
                        socket.close();
                        return;
                    }

                    String expectedOrigin = "http://127.0.0.1:" + localPort;
                    String expectedOriginLocal = "http://localhost:" + localPort;
                    if (!originHeader.isEmpty() && !expectedOrigin.equalsIgnoreCase(originHeader) && !expectedOriginLocal.equalsIgnoreCase(originHeader)) {
                        sendJsonResponse(out, 403, "{\"error\":\"FORBIDDEN_ORIGIN\"}");
                        socket.close();
                        return;
                    }

                    String method = parts[0].toUpperCase(Locale.US);
                    String rawPath = parts[1];
                    int qIdx = rawPath.indexOf('?');
                    if (qIdx != -1) rawPath = rawPath.substring(0, qIdx);
                    Log.i(TAG, "HTTP " + method + " " + rawPath);

                    if (method.equals("OPTIONS")) {
                        String resp = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n";
                        out.write(resp.getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        socket.close();
                        return;
                    }

                    // 3. Health Check (unauthenticated loopback probe)
                    if (rawPath.equals("/api/health")) {
                        String lanIp = detectDeviceLanIp();
                        JSONObject health = new JSONObject();
                        health.put("status", "ok");
                        health.put("app", "ai-netcontroller");
                        health.put("mode", "android-native");
                        health.put("version", APP_VERSION);
                        health.put("lanIp", lanIp);
                        sendJsonResponse(out, 200, health.toString());
                        socket.close();
                        return;
                    }

                    if (rawPath.startsWith("/api/") && !isAuthorizedLoopbackRequest(cookieHeader, bridgeHeader)) {
                        sendJsonResponse(out, 401, "{\"error\":\"UNAUTHORIZED\",\"message\":\"Valid loopback session cookie required.\"}");
                        socket.close();
                        return;
                    }

                    // 1. Native UDP Wake-on-LAN
                    if (rawPath.equals("/api/wol")) {
                        if (!"POST".equals(method)) {
                            sendJsonResponse(out, 405, "{\"error\":\"METHOD_NOT_ALLOWED\"}");
                            socket.close();
                            return;
                        }
                        JSONObject wolReq = parseJsonObject(bodyStr);
                        String mac = wolReq.optString("mac", "");
                        String bcast = wolReq.optString("broadcastIp", "");
                        String secOn = wolReq.optString("secureOn", "");
                        int port = wolReq.optInt("port", 9);

                        boolean success = sendNativeWol(mac, bcast, port, secOn);
                        if (!success) {
                            sendJsonResponse(out, 400, "{\"success\":false,\"error\":\"INVALID_MAC_OR_SEND_FAILED\",\"message\":\"Valid 12-hex MAC address is required to send a Wake-on-LAN Magic Packet.\"}");
                        } else {
                            int bytesCount = secOn.replaceAll("[^0-9A-Fa-f]", "").length() == 12 ? 108 : 102;
                            JSONObject res = new JSONObject();
                            res.put("success", true);
                            res.put("status", "dispatched");
                            res.put("mac", mac);
                            res.put("broadcastIp", bcast.isEmpty() ? "255.255.255.255" : bcast);
                            res.put("port", port);
                            res.put("bytesSent", bytesCount);
                            sendJsonResponse(out, 200, res.toString());
                        }
                        socket.close();
                        return;
                    }

                    // 2. Multi-threaded /24 LAN Subnet Discovery
                    if (rawPath.equals("/api/hosts/scan")) {
                        String scanJson = scanLocalSubnetJson();
                        sendJsonResponse(out, 200, scanJson);
                        socket.close();
                        return;
                    }

                    // 4. Quick Setup Info
                    if (rawPath.equals("/api/setup/info")) {
                        String lanIp = detectDeviceLanIp();
                        String hostModel = ((Build.MANUFACTURER != null ? Build.MANUFACTURER : "Android") + " " + (Build.MODEL != null ? Build.MODEL : "Device")).trim();
                        JSONObject setupObj = new JSONObject();
                        setupObj.put("version", APP_VERSION);
                        setupObj.put("localIp", lanIp);
                        setupObj.put("lanIp", lanIp);
                        setupObj.put("hostname", hostModel);
                        setupObj.put("osName", "Android " + Build.VERSION.RELEASE);
                        setupObj.put("os", "android");
                        setupObj.put("mac", "");
                        setupObj.put("daemonPort", 8765);
                        setupObj.put("port", 8765);
                        setupObj.put("wsPort", 8765);
                        setupObj.put("webPort", localPort);
                        setupObj.put("pairingToken", daemonToken);
                        setupObj.put("exeDownloadUrl", "/releases/" + RELEASE_TAG + "/AI_NetController_HostAgent_" + RELEASE_TAG + "_win64.exe");
                        setupObj.put("apkDownloadUrl", "/releases/" + RELEASE_TAG + "/AI_NetController_" + RELEASE_TAG + "_arm64-v8a.apk");
                        setupObj.put("launcherDownloadUrl", "/releases/" + RELEASE_TAG + "/AI_NetController_HostAgent_" + RELEASE_TAG + "_win64.exe");
                        JSONObject wrapper = new JSONObject();
                        wrapper.put("success", true);
                        wrapper.put("setup", setupObj);
                        sendJsonResponse(out, 200, wrapper.toString());
                        socket.close();
                        return;
                    }

                    // 5. Releases Manifest
                    if (rawPath.equals("/api/releases")) {
                        String manifestJson = readAssetText("dist/releases/" + RELEASE_TAG + "/RELEASE_MANIFEST.json");
                        JSONObject resp = new JSONObject();
                        resp.put("currentVersion", APP_VERSION);
                        if (manifestJson != null && !manifestJson.trim().isEmpty()) {
                            JSONObject manifestObj = parseJsonObject(manifestJson);
                            resp.put("manifest", manifestObj);
                            resp.put("releases", new JSONArray().put(manifestObj));
                        } else {
                            resp.put("manifest", JSONObject.NULL);
                            resp.put("releases", new JSONArray());
                        }
                        sendJsonResponse(out, 200, resp.toString());
                        socket.close();
                        return;
                    }

                    // 6. System Update Center endpoints
                    if (rawPath.equals("/api/update/status") || rawPath.equals("/api/update/check")) {
                        JSONObject res = new JSONObject();
                        res.put("currentVersion", APP_VERSION);
                        res.put("components", new JSONArray());
                        res.put("checkedComponents", new JSONArray());
                        res.put("channel", "beta");
                        res.put("releaseUrl", "https://github.com/SemO2077/AI-NetController/releases/tag/" + RELEASE_TAG);

                        JSONArray assetsArr = new JSONArray();
                        String manifestJson = readAssetText("dist/releases/" + RELEASE_TAG + "/RELEASE_MANIFEST.json");
                        if (manifestJson != null && !manifestJson.trim().isEmpty()) {
                            JSONObject mObj = parseJsonObject(manifestJson);
                            JSONArray arts = mObj.optJSONArray("artifacts");
                            if (arts != null) {
                                for (int i = 0; i < arts.length(); i++) {
                                    JSONObject a = arts.optJSONObject(i);
                                    if (a == null) continue;
                                    JSONObject entry = new JSONObject();
                                    String fname = a.optString("filename", "");
                                    entry.put("name", fname);
                                    entry.put("size", a.optString("sizeFormatted", ""));
                                    entry.put("platform", a.optString("platform", ""));
                                    entry.put("url", "/releases/" + RELEASE_TAG + "/" + fname);
                                    entry.put("sha256", a.optString("sha256", ""));
                                    assetsArr.put(entry);
                                }
                            }
                        }
                        res.put("assets", assetsArr);

                        if (rawPath.equals("/api/update/check")) {
                            HttpsURLConnection conn = null;
                            try {
                                URL ghUrl = new URL("https://api.github.com/repos/SemO2077/AI-NetController/releases");
                                conn = (HttpsURLConnection) ghUrl.openConnection();
                                conn.setRequestMethod("GET");
                                conn.setConnectTimeout(5000);
                                conn.setReadTimeout(8000);
                                conn.setRequestProperty("Accept", "application/vnd.github+json");
                                conn.setRequestProperty("User-Agent", "AI-NetController-Android/" + APP_VERSION);
                                int code = conn.getResponseCode();
                                if (code >= 200 && code < 300) {
                                    String body = readAllStream(conn.getInputStream());
                                    JSONArray rels = new JSONArray(body);
                                    String latestTag = RELEASE_TAG;
                                    String releaseUrl = "https://github.com/SemO2077/AI-NetController/releases/tag/" + RELEASE_TAG;
                                    if (rels.length() > 0 && rels.optJSONObject(0) != null) {
                                        latestTag = rels.optJSONObject(0).optString("tag_name", RELEASE_TAG);
                                        releaseUrl = rels.optJSONObject(0).optString("html_url", releaseUrl);
                                    }
                                    String latestVer = latestTag.startsWith("v") ? latestTag.substring(1) : latestTag;
                                    boolean upToDate = latestVer.equals(APP_VERSION);
                                    res.put("latestVersion", latestVer);
                                    res.put("upToDate", upToDate);
                                    res.put("isUpdateAvailable", !upToDate);
                                    res.put("status", upToDate ? "up-to-date" : "update-available");
                                    res.put("releaseUrl", releaseUrl);
                                    res.put("remoteChecked", true);
                                    sendJsonResponse(out, 200, res.toString());
                                } else {
                                    res.put("latestVersion", APP_VERSION);
                                    res.put("upToDate", JSONObject.NULL);
                                    res.put("isUpdateAvailable", false);
                                    res.put("status", "remote-check-failed");
                                    res.put("remoteChecked", false);
                                    res.put("error", "GitHub API returned HTTP " + code);
                                    sendJsonResponse(out, 502, res.toString());
                                }
                            } catch (Throwable e) {
                                res.put("latestVersion", APP_VERSION);
                                res.put("upToDate", JSONObject.NULL);
                                res.put("isUpdateAvailable", false);
                                res.put("status", "offline");
                                res.put("remoteChecked", false);
                                res.put("error", e.getMessage() != null ? e.getMessage() : "Unable to reach GitHub Releases.");
                                sendJsonResponse(out, 503, res.toString());
                            } finally {
                                if (conn != null) conn.disconnect();
                            }
                        } else {
                            res.put("latestVersion", APP_VERSION);
                            res.put("upToDate", true);
                            res.put("isUpdateAvailable", false);
                            res.put("status", "bundled");
                            res.put("remoteChecked", false);
                            sendJsonResponse(out, 200, res.toString());
                        }
                        socket.close();
                        return;
                    }

                    if (rawPath.equals("/api/update/execute")) {
                        JSONObject res = new JSONObject();
                        res.put("success", false);
                        res.put("error", "SELF_UPDATE_UNSUPPORTED");
                        res.put("message", "In-place binary self-update is not supported inside the Android APK. Install the updated APK from GitHub Releases.");
                        res.put("releaseUrl", "https://github.com/SemO2077/AI-NetController/releases/tag/" + RELEASE_TAG);
                        sendJsonResponse(out, 501, res.toString());
                        socket.close();
                        return;
                    }

                    if (rawPath.equals("/api/update/ai-analyze")) {
                        JSONObject req = parseJsonObject(bodyStr);
                        if (!req.has("prompt") && !req.has("messages")) {
                            req.put("prompt", "Summarize release status and upgrade considerations for AI NetController " + RELEASE_TAG + ".");
                        }
                        handleGeminiChat(out, req.toString(), headerGeminiKey);
                        socket.close();
                        return;
                    }

                    // 7. PC Daemon GUI State & Actions
                    if (rawPath.equals("/api/daemon/state")) {
                        String dState = buildDaemonStateJson();
                        sendJsonResponse(out, 200, "{\"success\":true,\"daemon\":" + dState + "}");
                        socket.close();
                        return;
                    }

                    if (rawPath.equals("/api/daemon/action")) {
                        JSONObject actReq = parseJsonObject(bodyStr);
                        String act = actReq.optString("action", "").trim();
                        if ("toggle_service".equals(act) || "toggle_pause".equals(act)) {
                            daemonRunning = !daemonRunning;
                        } else if ("regenerate_pin".equals(act) || "rotate_pin".equals(act)) {
                            daemonPin = generatePin();
                        } else if ("set_hitl_mode".equals(act)) {
                            String mode = actReq.optString("value", "").trim().toLowerCase(Locale.US);
                            if ("strict".equals(mode) || "balanced".equals(mode) || "permissive".equals(mode) || "manual".equals(mode)) {
                                daemonHitlMode = mode;
                            } else {
                                sendJsonResponse(out, 400, "{\"success\":false,\"error\":\"INVALID_HITL_MODE\"}");
                                socket.close();
                                return;
                            }
                        } else if ("toggle_view_only".equals(act)) {
                            daemonViewOnly = !daemonViewOnly;
                        } else if ("toggle_tls".equals(act)) {
                            daemonTlsActive = !daemonTlsActive;
                        } else {
                            sendJsonResponse(out, 400, "{\"success\":false,\"error\":\"UNKNOWN_DAEMON_ACTION\"}");
                            socket.close();
                            return;
                        }
                        String dState = buildDaemonStateJson();
                        String resp = "{\"success\":true,\"daemon\":" + dState + ",\"state\":" + dState + "}";
                        sendJsonResponse(out, 200, resp);
                        socket.close();
                        return;
                    }

                    // 8. AI Model Catalog & Live Latency Test
                    if (rawPath.equals("/api/ai/models")) {
                        JSONArray models = new JSONArray();
                        models.put(new JSONObject().put("id", "gemini-2.5-flash").put("name", "Gemini 2.5 Flash").put("provider", "Google Gemini API").put("status", "requires_api_key"));
                        models.put(new JSONObject().put("id", "gemini-2.5-pro").put("name", "Gemini 2.5 Pro").put("provider", "Google Gemini API").put("status", "requires_api_key"));
                        models.put(new JSONObject().put("id", "gemini-2.0-flash").put("name", "Gemini 2.0 Flash").put("provider", "Google Gemini API").put("status", "requires_api_key"));
                        sendJsonResponse(out, 200, new JSONObject().put("models", models).toString());
                        socket.close();
                        return;
                    }

                    if (rawPath.equals("/api/ai/models/test")) {
                        handleGeminiModelTest(out, bodyStr, headerGeminiKey);
                        socket.close();
                        return;
                    }

                    // 9. Remote PC Control Action Endpoint (requires desktop WebSocket connection)
                    if (rawPath.equals("/api/pc-control/execute")) {
                        sendJsonResponse(out, 501, "{\"success\":false,\"executed\":false,\"error\":\"REMOTE_WS_REQUIRED\",\"message\":\"Direct host input and command execution require an authenticated WebSocket session to the target AI NetController Host Agent.\"}");
                        socket.close();
                        return;
                    }

                    // 10. Real Gemini AI Chat Endpoint
                    if (rawPath.equals("/api/chat")) {
                        handleGeminiChat(out, bodyStr, headerGeminiKey);
                        socket.close();
                        return;
                    }

                    if (rawPath.contains("..") || rawPath.contains("\\")) {
                        out.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n".getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        socket.close();
                        return;
                    }

                    if (rawPath.equals("/") || rawPath.isEmpty()) rawPath = "/index.html";

                    String assetPath = "dist" + rawPath;
                    AssetManager assets = getAssets();
                    InputStream assetStream = null;

                    try {
                        assetStream = assets.open(assetPath);
                    } catch (Exception ex) {
                        int lastSlash = rawPath.lastIndexOf('/');
                        String lastSeg = lastSlash >= 0 ? rawPath.substring(lastSlash + 1) : rawPath;
                        boolean hasFileExt = lastSeg.contains(".");
                        if (!hasFileExt) {
                            try {
                                assetStream = assets.open("dist/index.html");
                                assetPath = "dist/index.html";
                            } catch (Exception e2) {
                                assetStream = null;
                            }
                        }
                        if (assetStream == null) {
                            out.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".getBytes(StandardCharsets.UTF_8));
                            out.flush();
                            socket.close();
                            return;
                        }
                    }

                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] cbuf = new byte[8192];
                    int len;
                    while ((len = assetStream.read(cbuf)) != -1) {
                        baos.write(cbuf, 0, len);
                    }
                    assetStream.close();
                    byte[] data = baos.toByteArray();

                    String mime = getMimeType(assetPath);
                    StringBuilder headersSb = new StringBuilder();
                    headersSb.append("HTTP/1.1 200 OK\r\n");
                    headersSb.append("Content-Type: ").append(mime).append("\r\n");
                    headersSb.append("Content-Length: ").append(data.length).append("\r\n");
                    headersSb.append("X-Content-Type-Options: nosniff\r\n");
                    headersSb.append("Cache-Control: no-store\r\n");
                    if ("dist/index.html".equals(assetPath)) {
                        headersSb.append("Set-Cookie: ai_net_bridge=").append(bridgeSessionToken).append("; HttpOnly; SameSite=Strict; Path=/\r\n");
                    }
                    headersSb.append("\r\n");

                    out.write(headersSb.toString().getBytes(StandardCharsets.UTF_8));
                    out.write(data);
                    out.flush();
                    socket.close();
                } catch (Exception ignored) {
                    try { socket.close(); } catch (Exception ignored2) {}
                }
            }
        });
    }

    private String getMimeType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".json")) return "application/json; charset=utf-8";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".apk")) return "application/vnd.android.package-archive";
        if (path.endsWith(".exe")) return "application/octet-stream";
        return "application/octet-stream";
    }

    @Override
    public void onBackPressed() {
        if (webView != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webView.evaluateJavascript(
                "(function(){ try { return Boolean(window.__handleAndroidBack && window.__handleAndroidBack()); } catch(e) { return false; } })()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"true".equals(value)) {
                            if (webView != null && webView.canGoBack()) {
                                webView.goBack();
                            } else {
                                MainActivity.super.onBackPressed();
                            }
                        }
                    }
                }
            );
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        isRunning = false;
        try { httpPool.shutdownNow(); } catch (Exception ignored) {}
        if (localServer != null) {
            try { localServer.close(); } catch (Exception ignored) {}
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
"""
    rel_tag = _get_release_tag()
    app_ver = rel_tag.lstrip("v")
    java_content = java_content.replace("__APP_VERSION__", app_ver).replace("__RELEASE_TAG__", rel_tag)
    dest = os.path.join(STAGE_DIR, "src", "com", "cst", "autonomouslan", "MainActivity.java")
    with open(dest, "w", encoding="utf-8") as f:
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

    if ks_path and os.path.isfile(ks_path) and ks_pass and ks_alias:
        print(f"[*] Signing APK with release keystore ({ks_alias})...")
    else:
        ks_path = KEYSTORE_PATH
        ks_pass = "android"
        ks_alias = "androiddebugkey"
        key_pass = "android"
        ensure_debug_keystore()
        print("[*] Signing APK with local debug keystore (set AI_ANDROID_KEYSTORE for release signing)...")

    cmd_sign = [
        APKSIGNER, "sign",
        "--ks", ks_path,
        "--ks-pass", f"pass:{ks_pass}",
        "--ks-key-alias", ks_alias,
        "--key-pass", f"pass:{key_pass}",
        "--out", signed_apk,
        aligned_apk
    ]
    res = subprocess.run(cmd_sign, env=ENV, capture_output=True, text=True)
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

    mobile_out = os.path.join(ROOT_DIR, "apps", "mobile", "build", "app", "outputs", "flutter-apk")
    os.makedirs(mobile_out, exist_ok=True)
    dest_flutter = os.path.join(mobile_out, "app-arm64-v8a-release.apk")
    shutil.copy2(signed_apk, dest_flutter)

    size_mb = os.path.getsize(dest_arm64) / (1024 * 1024)
    sha_hash = sha256_file(dest_arm64)
    print(f"\n[SUCCESS] APK Published to:\n  - {dest_arm64}\n  - {dest_univ}\n  - Size: {size_mb:.2f} MB\n  - SHA256: {sha_hash}")

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

if __name__ == "__main__":
    ensure_web_dist()
    setup_staging()
    create_android_manifest()
    create_resources()
    create_main_activity()
    compile_java()
    run_d8()
    compile_and_link_resources()
    apk = zipalign_and_sign()
    distribute_apk(apk)
    print(f"\n[ALL DONE] AI NetController Android APK ({_get_release_tag()} / {_get_version_name()}) built and verified.")
