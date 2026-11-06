import 'package:flutter/material.dart';

// =====================================================================
// CYBERNETIC COLOR PALETTE & GLASSMORPHIC DESIGN TOKENS
// =====================================================================
class CyberColors {
  static const Color background = Color(0xFF040812);
  static const Color surface = Color(0xFF0A1628);
  static const Color surfaceElevated = Color(0xFF102038);
  static const Color primary = Color(0xFF00F0FF); // Neon Cyan
  static const Color secondary = Color(0xFF8A2BE2); // Electric Violet
  static const Color accent = Color(0xFFFF0055); // Neon Coral/Pink
  static const Color success = Color(0xFF00FF9D); // Cyber Emerald
  static const Color warning = Color(0xFFFFB800); // Amber Alert
  static const Color textPrimary = Color(0xFFE2F1FF);
  static const Color textSecondary = Color(0xFF7A93B2);
  static const Color textTertiary = Color(0xFF4A607A);

  static const Color glassSurface = Color(0x220A1628);
  static const Color glassBorder = Color(0x3300F0FF);
  static const Color glassBorderIdle = Color(0x1AFFFFFF);
  static const Color glassHighlight = Color(0x1A00F0FF);
}

class NeonColors {
  static const Color cyan = CyberColors.primary;
  static const Color violet = CyberColors.secondary;
}

// =====================================================================
// FLUID TYPOGRAPHY & RESOLUTION-INDEPENDENT SCALING ENGINE
// =====================================================================
class FluidSize {
  /// Reference viewport width (Standard phone baseline: iPhone 13/14/15 or Pixel 7 ~390dp)
  static const double baselineWidth = 390.0;

  /// Dynamic scale factor clamped to prevent layout blowups or microscopic text
  static double getScaleFactor(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final ratio = width / baselineWidth;
    return ratio.clamp(0.80, 1.50);
  }

  /// Clamped Fluid Font Size:
  /// FontSize = BaseSize * clamp(ScreenWidth / 390, 0.85, 1.4)
  static double font(BuildContext context, double baseSize) {
    return (baseSize * getScaleFactor(context)).roundToDouble();
  }

  /// Clamped Fluid Spacing / Padding
  static double space(BuildContext context, double baseSpace) {
    return (baseSpace * getScaleFactor(context)).roundToDouble();
  }

  /// Clamped TextScaler restricting system OS-level accessibility font scaling
  /// between 0.85x and 1.25x to guarantee zero-overflow layout rendering.
  static TextScaler clampedTextScaler(BuildContext context) {
    return MediaQuery.textScalerOf(context).clamp(
      minScaleFactor: 0.85,
      maxScaleFactor: 1.25,
    );
  }
}

// =====================================================================
// BUILD-CONTEXT CONVENIENCE EXTENSIONS
// =====================================================================
extension FluidContext on BuildContext {
  double get screenWidth => MediaQuery.sizeOf(this).width;
  double get screenHeight => MediaQuery.sizeOf(this).height;
  double get devicePixelRatio => MediaQuery.devicePixelRatioOf(this);
  EdgeInsets get viewPadding => MediaQuery.paddingOf(this);
  EdgeInsets get viewInsets => MediaQuery.viewInsetsOf(this);

  double fluidFont(double base) => FluidSize.font(this, base);
  double fluidSpace(double base) => FluidSize.space(this, base);
  TextScaler get clampedScaler => FluidSize.clampedTextScaler(this);

  bool get isCompact => screenWidth < 600;
  bool get isMedium => screenWidth >= 600 && screenWidth <= 840;
  bool get isExpanded => screenWidth > 840;
}

// =====================================================================
// CYBERNETIC MATERIAL 3 THEME
// =====================================================================
class CyberTheme {
  static ThemeData get themeData {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: CyberColors.background,
      colorScheme: const ColorScheme.dark(
        primary: CyberColors.primary,
        secondary: CyberColors.secondary,
        surface: CyberColors.surface,
        error: CyberColors.accent,
        onPrimary: Colors.black,
        onSurface: CyberColors.textPrimary,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: 'monospace',
          fontSize: 16,
          fontWeight: FontWeight.w700,
          letterSpacing: 2.0,
          color: CyberColors.textPrimary,
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: Colors.white10,
        thickness: 1,
        space: 1,
      ),
    );
  }
}
