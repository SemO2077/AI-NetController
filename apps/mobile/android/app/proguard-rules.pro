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

# Preserve QuickActions, HomeWidget, LocalAuth, JNI (path_provider_android), Plus plugins, and App Entrypoints
-keep class com.cst.autonomouslan.** { *; }
-keep class es.antonborri.home_widget.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class androidx.biometric.** { *; }
-keep class com.github.dart_lang.jni.** { *; }
-keep class com.github.dart_lang.jni_flutter.** { *; }
-keep class dev.fluttercommunity.plus.** { *; }
-keep class com.benjaminabel.vibration.** { *; }

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
