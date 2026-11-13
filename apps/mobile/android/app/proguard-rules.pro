# CST Autonomous LAN Mobile Client - ProGuard / R8 Rules
# Preserves JNI bindings, crypto engine reflection, and background isolate callbacks

-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve QuickActions, HomeWidget, LocalAuth, and App Entrypoints
-keep class com.cst.autonomouslan.** { *; }
-keep class es.antonborri.home_widget.** { *; }
-keep class io.flutter.plugins.quickactions.** { *; }
-keep class io.flutter.plugins.localauth.** { *; }
-keep class androidx.biometric.** { *; }

# Preserve ChaCha20-Poly1305 and Curve25519 reflection models
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Preserve Native Socket & Isolates
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-dontwarn io.flutter.embedding.**
