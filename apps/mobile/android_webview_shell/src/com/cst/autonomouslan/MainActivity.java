package com.cst.autonomouslan;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
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
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

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
import java.net.URLDecoder;
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
    private static final String PREFS_UI_STORE = "ai_netcontroller_native_store_v1";
    private static final String PREFS_DAEMON = "ai_netcontroller_daemon_v1";
    private static final int[] PREFERRED_LOCAL_PORTS = new int[] { 47192, 47193, 47194, 47195, 47196 };
    private static final Pattern SAFE_PREF_KEY_PATTERN = Pattern.compile("^[a-zA-Z0-9_.-]{1,128}$");
    private static final Pattern HEX_COLOR_PATTERN = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final int MAX_PREF_VALUE_LEN = 262144;

    private WebView webView;
    private FrameLayout rootLayout;
    private ServerSocket localServer;
    private final ExecutorService httpPool = Executors.newFixedThreadPool(12);
    private final Object scanLock = new Object();
    private volatile String lastScanJson = "{\"hosts\":[]}";
    private volatile long lastScanTimestampMs = 0L;
    private int localPort = 0;
    private volatile boolean isRunning = true;
    private volatile boolean isLocalOriginLoaded = false;
    private final long startTimeMs = System.currentTimeMillis();
    private OnBackInvokedCallback onBackInvokedCallback;

    // Persistent device daemon controller state & credentials
    private volatile boolean daemonRunning = true;
    private volatile boolean daemonTlsActive = true;
    private volatile String daemonHitlMode = "strict";
    private volatile boolean daemonViewOnly = false;
    private volatile String daemonPin = "";
    private volatile String daemonToken = "";
    private final String bridgeSessionToken = generateHexToken("bridge_", 24);

    private SharedPreferences getUiPrefs() {
        return getSharedPreferences(PREFS_UI_STORE, Context.MODE_PRIVATE);
    }

    private SharedPreferences getDaemonPrefs() {
        return getSharedPreferences(PREFS_DAEMON, Context.MODE_PRIVATE);
    }

    private void loadPersistedDaemonState() {
        try {
            SharedPreferences prefs = getDaemonPrefs();
            daemonRunning = prefs.getBoolean("running", true);
            daemonTlsActive = prefs.getBoolean("tlsActive", true);
            String hitl = prefs.getString("hitlMode", "strict");
            if ("strict".equals(hitl) || "balanced".equals(hitl) || "permissive".equals(hitl) || "manual".equals(hitl)) {
                daemonHitlMode = hitl;
            }
            daemonViewOnly = prefs.getBoolean("viewOnly", false);
            String savedPin = prefs.getString("pin", "");
            if (savedPin != null && savedPin.matches("^[0-9]{6}$")) {
                daemonPin = savedPin;
            } else {
                daemonPin = generatePin();
            }
            String savedToken = prefs.getString("token", "");
            if (savedToken != null && !savedToken.isEmpty() && savedToken.length() >= 16) {
                daemonToken = savedToken;
            } else {
                daemonToken = generateHexToken("ai_sec_", 16);
            }
            persistDaemonState();
        } catch (Throwable ignored) {
            if (daemonPin.isEmpty()) daemonPin = generatePin();
            if (daemonToken.isEmpty()) daemonToken = generateHexToken("ai_sec_", 16);
        }
    }

    private void persistDaemonState() {
        try {
            getDaemonPrefs().edit()
                .putBoolean("running", daemonRunning)
                .putBoolean("tlsActive", daemonTlsActive)
                .putString("hitlMode", daemonHitlMode)
                .putBoolean("viewOnly", daemonViewOnly)
                .putString("pin", daemonPin)
                .putString("token", daemonToken)
                .apply();
        } catch (Throwable ignored) {}
    }

    private static boolean isAllowedPrefKey(String key) {
        if (key == null || !SAFE_PREF_KEY_PATTERN.matcher(key).matches()) {
            return false;
        }
        String lower = key.toLowerCase(Locale.US);
        // Never persist bearer auth tokens, secrets, or PINs in UI preference mirror
        return !lower.contains("auth_token")
            && !lower.contains("pairing_token")
            && !lower.contains("secret")
            && !lower.contains("password")
            && !lower.contains("api_key");
    }

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
        loadPersistedDaemonState();

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
        rootLayout = root;
        String initialSurfaceHex = "#030712";
        try {
            String savedSurface = getUiPrefs().getString("ai_net_surface_hex", "");
            if (savedSurface != null && HEX_COLOR_PATTERN.matcher(savedSurface).matches()) {
                initialSurfaceHex = savedSurface;
            }
        } catch (Throwable ignored) {}
        final int initialSurfaceColor = Color.parseColor(initialSurfaceHex);
        root.setBackgroundColor(initialSurfaceColor);
        applySystemBarsColors(initialSurfaceColor, initialSurfaceColor);

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
        webView.setBackgroundColor(initialSurfaceColor);
        // Use direct Chromium GPU hardware composition (LAYER_TYPE_NONE prevents double-FBO memory overhead)
        webView.setLayerType(View.LAYER_TYPE_NONE, null);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        boolean isDebuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(isDebuggable);
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
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setGeolocationEnabled(false);
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
        settings.setMediaPlaybackRequiresUserGesture(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        // Native Android Bridge: Haptics, Persistent Preferences, Theme Sync, Clipboard, UDP WoL, LAN IP
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void vibrate(int durationMs) {
                if (!isLocalOriginLoaded) return;
                try {
                    int ms = Math.max(5, Math.min(durationMs, 60));
                    Vibrator v = null;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                        if (vm != null) v = vm.getDefaultVibrator();
                    } else {
                        v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                    }
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
            public String getPref(String key) {
                if (!isLocalOriginLoaded || !isAllowedPrefKey(key)) return null;
                try {
                    return getUiPrefs().getString(key, null);
                } catch (Throwable ignored) {
                    return null;
                }
            }

            @JavascriptInterface
            public boolean setPref(String key, String value) {
                if (!isLocalOriginLoaded || !isAllowedPrefKey(key)) return false;
                if (value != null && value.length() > MAX_PREF_VALUE_LEN) return false;
                try {
                    SharedPreferences.Editor ed = getUiPrefs().edit();
                    if (value == null) {
                        ed.remove(key);
                    } else {
                        ed.putString(key, value);
                    }
                    ed.apply();
                    return true;
                } catch (Throwable ignored) {
                    return false;
                }
            }

            @JavascriptInterface
            public boolean removePref(String key) {
                if (!isLocalOriginLoaded || !isAllowedPrefKey(key)) return false;
                try {
                    getUiPrefs().edit().remove(key).apply();
                    return true;
                } catch (Throwable ignored) {
                    return false;
                }
            }

            @JavascriptInterface
            public boolean setSystemTheme(final String accentHex, final String surfaceHex) {
                if (!isLocalOriginLoaded) return false;
                final String safeSurface = (surfaceHex != null && HEX_COLOR_PATTERN.matcher(surfaceHex).matches())
                    ? surfaceHex : "#030712";
                final String safeAccent = (accentHex != null && HEX_COLOR_PATTERN.matcher(accentHex).matches())
                    ? accentHex : "#22d3ee";
                try {
                    getUiPrefs().edit()
                        .putString("ai_net_surface_hex", safeSurface)
                        .putString("ai_net_accent_hex", safeAccent)
                        .apply();
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                int surfaceColor = Color.parseColor(safeSurface);
                                int accentColor = Color.parseColor(safeAccent);
                                if (rootLayout != null) rootLayout.setBackgroundColor(surfaceColor);
                                if (webView != null) webView.setBackgroundColor(surfaceColor);
                                applySystemBarsColors(surfaceColor, accentColor);
                            } catch (Throwable ignored) {}
                        }
                    });
                    return true;
                } catch (Throwable ignored) {
                    return false;
                }
            }

            @JavascriptInterface
            public boolean sendWolUdp(String mac, String bcast, int port) {
                if (!isLocalOriginLoaded) return false;
                return sendNativeWol(mac, bcast, port, null);
            }

            @JavascriptInterface
            public boolean copyToClipboard(final String text) {
                if (!isLocalOriginLoaded || text == null || text.length() > MAX_PREF_VALUE_LEN) return false;
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
                if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                    Log.i(TAG, "[Console " + msg.messageLevel() + "] " + msg.message());
                }
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
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                isLocalOriginLoaded = isTrustedLoopbackUrl(url);
                // Ensure Chromium flushes localStorage/cookies to disk promptly
                try {
                    CookieManager.getInstance().flush();
                } catch (Throwable ignored) {}
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && error != null && request != null) {
                    Log.e(TAG, "onReceivedError: " + error.getErrorCode() + " " + error.getDescription() + " URL: " + request.getUrl());
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request != null ? request.getUrl() : null;
                return handleOverrideUrl(uri != null ? uri.toString() : null);
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleOverrideUrl(url);
            }

            private boolean handleOverrideUrl(String url) {
                if (url == null) return true;
                if (isTrustedLoopbackUrl(url)) {
                    return false;
                }
                if (url.startsWith("https://") || url.startsWith("http://")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                        return true;
                    } catch (Throwable ignored) {}
                }
                return true;
            }
        });

        registerModernBackHandler();
        webView.loadUrl("http://127.0.0.1:" + localPort + "/index.html");
    }

    private void applySystemBarsColors(int surfaceColor, int taskAccentColor) {
        try {
            Window window = getWindow();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                window.setStatusBarColor(surfaceColor);
                window.setNavigationBarColor(surfaceColor);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    setTaskDescription(new ActivityManager.TaskDescription(null, 0, surfaceColor));
                } else {
                    @SuppressWarnings("deprecation")
                    ActivityManager.TaskDescription td = new ActivityManager.TaskDescription(null, null, taskAccentColor);
                    setTaskDescription(td);
                }
            }
        } catch (Throwable ignored) {}
    }

    private void registerModernBackHandler() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            onBackInvokedCallback = new OnBackInvokedCallback() {
                @Override
                public void onBackInvoked() {
                    dispatchWebBackNavigation(true);
                }
            };
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                onBackInvokedCallback
            );
        }
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
        long now = System.currentTimeMillis();
        if (now - lastScanTimestampMs < 2500L && lastScanJson != null) {
            return lastScanJson;
        }
        synchronized (scanLock) {
            now = System.currentTimeMillis();
            if (now - lastScanTimestampMs < 2500L && lastScanJson != null) {
                return lastScanJson;
            }
            final String selfIp = detectDeviceLanIp();
            if (selfIp.equals("127.0.0.1") || !selfIp.contains(".")) {
                return "{\"hosts\":[]}";
            }
            final String subnetPrefix = selfIp.substring(0, selfIp.lastIndexOf('.') + 1);

            final Map<String, String> arpTable = readArpNeighborTable();
            ExecutorService pool = Executors.newFixedThreadPool(24);
            List<Future<String>> futures = new ArrayList<Future<String>>();

            try {
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
                                HttpURLConnection conn = null;
                                try {
                                    URL u = new URL("http://" + candidateIp + ":3000/api/setup/info");
                                    conn = (HttpURLConnection) u.openConnection();
                                    conn.setConnectTimeout(220);
                                    conn.setReadTimeout(220);
                                    if (conn.getResponseCode() == 200) {
                                        try (BufferedReader r = new BufferedReader(
                                                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                                            StringBuilder infoSb = new StringBuilder();
                                            String ln;
                                            while ((ln = r.readLine()) != null && infoSb.length() < 8192) infoSb.append(ln);
                                            JSONObject infoObj = new JSONObject(infoSb.toString());
                                            String hName = infoObj.optString("hostname", "");
                                            String hMac = infoObj.optString("mac", "");
                                            String hOs = infoObj.optString("osName", infoObj.optString("os", ""));
                                            if (!hName.isEmpty()) name = hName;
                                            if (hMac.length() == 17) mac = hMac.toUpperCase(Locale.US);
                                            if (!hOs.isEmpty()) os = hOs;
                                        }
                                    }
                                } catch (Throwable ignored) {
                                } finally {
                                    if (conn != null) conn.disconnect();
                                }
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
            } finally {
                pool.shutdownNow();
            }

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
            lastScanJson = sb.toString();
            lastScanTimestampMs = System.currentTimeMillis();
            return lastScanJson;
        }
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
            InetAddress loopback = InetAddress.getByName("127.0.0.1");
            ServerSocket bound = null;
            for (int candidatePort : PREFERRED_LOCAL_PORTS) {
                try {
                    ServerSocket s = new ServerSocket();
                    s.setReuseAddress(true);
                    s.bind(new InetSocketAddress(loopback, candidatePort), 50);
                    bound = s;
                    break;
                } catch (Throwable ignored) {}
            }
            if (bound == null) {
                bound = new ServerSocket(0, 50, loopback);
            }
            localServer = bound;
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

                    while (headerEnd != -1 && (reqBuf.size() - headerEnd) < contentLength && reqBuf.size() < headerEnd + 1048576) {
                        int remaining = contentLength - (reqBuf.size() - headerEnd);
                        int toRead = Math.min(tmp.length, Math.max(0, remaining));
                        if (toRead <= 0) break;
                        int n = in.read(tmp, 0, toRead);
                        if (n <= 0) break;
                        reqBuf.write(tmp, 0, n);
                    }

                    byte[] fullBytes = reqBuf.toByteArray();
                    int availableBodyLen = (headerEnd != -1 && fullBytes.length > headerEnd)
                        ? Math.min(contentLength > 0 ? contentLength : (fullBytes.length - headerEnd), fullBytes.length - headerEnd)
                        : 0;
                    String bodyStr = availableBodyLen > 0
                        ? new String(fullBytes, headerEnd, availableBodyLen, StandardCharsets.UTF_8)
                        : "";

                    String[] parts = headerLines[0].split(" ");
                    if (parts.length < 2) {
                        socket.close();
                        return;
                    }

                    String expectedHost = "127.0.0.1:" + localPort;
                    String expectedLocalhost = "localhost:" + localPort;
                    if (!expectedHost.equalsIgnoreCase(hostHeader) && !expectedLocalhost.equalsIgnoreCase(hostHeader)) {
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
                    try {
                        rawPath = URLDecoder.decode(rawPath, "UTF-8");
                    } catch (Throwable ignored) {
                        sendJsonResponse(out, 400, "{\"error\":\"BAD_PATH\"}");
                        socket.close();
                        return;
                    }

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
                        res.put("gitlabReleaseUrl", "https://gitlab.com/ryu-group7483245/ai-netcontroller/-/releases/" + RELEASE_TAG);

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
                            String ghError = null;
                            int lastHttpCode = 0;
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
                                    socket.close();
                                    return;
                                } else {
                                    lastHttpCode = code;
                                    ghError = "GitHub API returned HTTP " + code;
                                }
                            } catch (Throwable e) {
                                ghError = e.getMessage() != null ? e.getMessage() : "Unable to reach GitHub Releases.";
                            } finally {
                                if (conn != null) conn.disconnect();
                            }

                            HttpsURLConnection glConn = null;
                            try {
                                URL glUrl = new URL("https://gitlab.com/api/v4/projects/ryu-group7483245%2Fai-netcontroller/releases");
                                glConn = (HttpsURLConnection) glUrl.openConnection();
                                glConn.setRequestMethod("GET");
                                glConn.setConnectTimeout(5000);
                                glConn.setReadTimeout(8000);
                                glConn.setRequestProperty("Accept", "application/json");
                                glConn.setRequestProperty("User-Agent", "AI-NetController-Android/" + APP_VERSION);
                                int glCode = glConn.getResponseCode();
                                if (glCode >= 200 && glCode < 300) {
                                    String glBody = readAllStream(glConn.getInputStream());
                                    JSONArray glRels = new JSONArray(glBody);
                                    String latestTag = RELEASE_TAG;
                                    String glReleaseUrl = "https://gitlab.com/ryu-group7483245/ai-netcontroller/-/releases/" + RELEASE_TAG;
                                    if (glRels.length() > 0 && glRels.optJSONObject(0) != null) {
                                        JSONObject first = glRels.optJSONObject(0);
                                        latestTag = first.optString("tag_name", RELEASE_TAG);
                                        JSONObject links = first.optJSONObject("_links");
                                        String selfUrl = links != null ? links.optString("self", "") : "";
                                        glReleaseUrl = !selfUrl.isEmpty()
                                                ? selfUrl
                                                : "https://gitlab.com/ryu-group7483245/ai-netcontroller/-/releases/" + latestTag;
                                    }
                                    String latestVer = latestTag.startsWith("v") ? latestTag.substring(1) : latestTag;
                                    boolean upToDate = latestVer.equals(APP_VERSION);
                                    res.put("latestVersion", latestVer);
                                    res.put("upToDate", upToDate);
                                    res.put("isUpdateAvailable", !upToDate);
                                    res.put("status", upToDate ? "up-to-date" : "update-available");
                                    res.put("gitlabReleaseUrl", glReleaseUrl);
                                    res.put("remoteChecked", true);
                                    sendJsonResponse(out, 200, res.toString());
                                } else {
                                    res.put("latestVersion", APP_VERSION);
                                    res.put("upToDate", JSONObject.NULL);
                                    res.put("isUpdateAvailable", false);
                                    res.put("status", "remote-check-failed");
                                    res.put("remoteChecked", false);
                                    res.put("error", ghError + "; GitLab API returned HTTP " + glCode);
                                    sendJsonResponse(out, 502, res.toString());
                                }
                            } catch (Throwable glErr) {
                                String glMsg = glErr.getMessage() != null ? glErr.getMessage() : "Unable to reach GitLab Releases.";
                                res.put("latestVersion", APP_VERSION);
                                res.put("upToDate", JSONObject.NULL);
                                res.put("isUpdateAvailable", false);
                                res.put("status", lastHttpCode > 0 ? "remote-check-failed" : "offline");
                                res.put("remoteChecked", false);
                                res.put("error", ghError + "; " + glMsg);
                                sendJsonResponse(out, lastHttpCode > 0 ? 502 : 503, res.toString());
                            } finally {
                                if (glConn != null) glConn.disconnect();
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
                        res.put("message", "In-place binary self-update is not supported inside the Android APK. Install the updated APK from GitHub or GitLab Releases.");
                        res.put("releaseUrl", "https://github.com/SemO2077/AI-NetController/releases/tag/" + RELEASE_TAG);
                        res.put("gitlabReleaseUrl", "https://gitlab.com/ryu-group7483245/ai-netcontroller/-/releases/" + RELEASE_TAG);
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
                        persistDaemonState();
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

                    if (rawPath.contains("..") || rawPath.contains("\\") || rawPath.indexOf('\0') != -1) {
                        out.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n".getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        socket.close();
                        return;
                    }

                    if (rawPath.equals("/") || rawPath.isEmpty()) rawPath = "/index.html";
                    if (!rawPath.startsWith("/")) rawPath = "/" + rawPath;

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
                    boolean isImmutableBundle = assetPath.startsWith("dist/assets/") || assetPath.endsWith(".woff2") || assetPath.endsWith(".woff");
                    StringBuilder headersSb = new StringBuilder();
                    headersSb.append("HTTP/1.1 200 OK\r\n");
                    headersSb.append("Content-Type: ").append(mime).append("\r\n");
                    headersSb.append("Content-Length: ").append(data.length).append("\r\n");
                    headersSb.append("X-Content-Type-Options: nosniff\r\n");
                    headersSb.append("Cache-Control: ").append(isImmutableBundle ? "public, max-age=31536000, immutable" : "no-store").append("\r\n");
                    if ("dist/index.html".equals(assetPath)) {
                        headersSb.append("Set-Cookie: ai_net_bridge=").append(bridgeSessionToken).append("; HttpOnly; SameSite=Strict; Path=/\r\n");
                    }
                    headersSb.append("\r\n");

                    out.write(headersSb.toString().getBytes(StandardCharsets.UTF_8));
                    out.write(data);
                    out.flush();
                } catch (Exception ignored) {
                } finally {
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

    private void dispatchWebBackNavigation(final boolean finishIfUnhandled) {
        if (webView != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webView.evaluateJavascript(
                "(function(){ try { return Boolean(window.__handleAndroidBack && window.__handleAndroidBack()); } catch(e) { return false; } })()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"true".equals(value) && !isFinishing() && !isDestroyed()) {
                            if (webView != null && webView.canGoBack()) {
                                webView.goBack();
                            } else {
                                finish();
                            }
                        }
                    }
                }
            );
        } else if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            finish();
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        dispatchWebBackNavigation(false);
    }

    @Override
    protected void onPause() {
        persistDaemonState();
        try {
            CookieManager.getInstance().flush();
        } catch (Throwable ignored) {}
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        isRunning = false;
        persistDaemonState();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && onBackInvokedCallback != null) {
            try {
                getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(onBackInvokedCallback);
            } catch (Throwable ignored) {}
            onBackInvokedCallback = null;
        }
        try { httpPool.shutdownNow(); } catch (Exception ignored) {}
        if (localServer != null) {
            try { localServer.close(); } catch (Exception ignored) {}
        }
        if (webView != null) {
            try {
                if (rootLayout != null) rootLayout.removeAllViews();
                webView.destroy();
            } catch (Throwable ignored) {}
            webView = null;
        }
        super.onDestroy();
    }
}
