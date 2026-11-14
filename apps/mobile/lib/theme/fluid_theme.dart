import 'package:flutter/material.dart';

// =====================================================================
// DYNAMIC & LEGACY CYBERNETIC COLOR TOKENS
// =====================================================================
enum CyberAccentPreset {
  cyan(
    label: 'Cyber Cyan',
    subtitle: 'Electric Cyan & Indigo',
    primary: Color(0xFF00F0FF),
    secondary: Color(0xFF8A2BE2),
    accent: Color(0xFFFF0055),
  ),
  violet(
    label: 'Ultraviolet',
    subtitle: 'Royal Violet & Magenta',
    primary: Color(0xFFC084FC),
    secondary: Color(0xFFF472B6),
    accent: Color(0xFFFF2E93),
  ),
  emerald(
    label: 'Bio Mint',
    subtitle: 'Neon Emerald & Cyan',
    primary: Color(0xFF34D399),
    secondary: Color(0xFF22D3EE),
    accent: Color(0xFFFF4D6D),
  ),
  rose(
    label: 'Crimson Rose',
    subtitle: 'Neon Rose & Coral',
    primary: Color(0xFFFB7185),
    secondary: Color(0xFFFB923C),
    accent: Color(0xFFFF0055),
  ),
  amber(
    label: 'Solar Gold',
    subtitle: 'Warm Amber & Flame',
    primary: Color(0xFFFBBF24),
    secondary: Color(0xFFF97316),
    accent: Color(0xFFFF2A6D),
  ),
  cobalt(
    label: 'Sapphire Blue',
    subtitle: 'Deep Cobalt & Teal',
    primary: Color(0xFF60A5FA),
    secondary: Color(0xFF8B5CF6),
    accent: Color(0xFFFF2A6D),
  );

  final String label;
  final String subtitle;
  final Color primary;
  final Color secondary;
  final Color accent;

  const CyberAccentPreset({
    required this.label,
    required this.subtitle,
    required this.primary,
    required this.secondary,
    required this.accent,
  });
}

enum GlassIntensity {
  minimal(label: 'Minimal', subtitle: 'Max battery & 120 FPS', blurSigma: 0.0, fillAlpha: 0.90),
  balanced(label: 'Balanced', subtitle: 'Crisp translucent depth', blurSigma: 10.0, fillAlpha: 0.72),
  ultra(label: 'Ultra Glass', subtitle: 'Rich layered glow', blurSigma: 18.0, fillAlpha: 0.56);

  final String label;
  final String subtitle;
  final double blurSigma;
  final double fillAlpha;

  const GlassIntensity({
    required this.label,
    required this.subtitle,
    required this.blurSigma,
    required this.fillAlpha,
  });
}

/// Static legacy token aliases retained for backwards compatibility in tests.
class CyberColors {
  static const Color background = Color(0xFF040812);
  static const Color surface = Color(0xFF0A1628);
  static const Color surfaceElevated = Color(0xFF102038);
  static const Color primary = Color(0xFF00F0FF);
  static const Color secondary = Color(0xFF8A2BE2);
  static const Color accent = Color(0xFFFF0055);
  static const Color success = Color(0xFF00FF9D);
  static const Color warning = Color(0xFFFFB800);
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

/// Dynamic Material 3 ThemeExtension carrying active persisted color palette.
@immutable
class CyberPalette extends ThemeExtension<CyberPalette> {
  final CyberAccentPreset preset;
  final GlassIntensity glass;
  final Color background;
  final Color surface;
  final Color surfaceElevated;
  final Color primary;
  final Color secondary;
  final Color accent;
  final Color success;
  final Color warning;
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;

  const CyberPalette({
    required this.preset,
    required this.glass,
    required this.background,
    required this.surface,
    required this.surfaceElevated,
    required this.primary,
    required this.secondary,
    required this.accent,
    required this.success,
    required this.warning,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
  });

  factory CyberPalette.fromPreset(
    CyberAccentPreset preset, {
    GlassIntensity glass = GlassIntensity.balanced,
  }) {
    return CyberPalette(
      preset: preset,
      glass: glass,
      background: CyberColors.background,
      surface: CyberColors.surface,
      surfaceElevated: CyberColors.surfaceElevated,
      primary: preset.primary,
      secondary: preset.secondary,
      accent: preset.accent,
      success: CyberColors.success,
      warning: CyberColors.warning,
      textPrimary: CyberColors.textPrimary,
      textSecondary: CyberColors.textSecondary,
      textTertiary: CyberColors.textTertiary,
    );
  }

  static final CyberPalette defaultPalette = CyberPalette.fromPreset(
    CyberAccentPreset.cyan,
  );

  static CyberPalette of(BuildContext context) {
    return Theme.of(context).extension<CyberPalette>() ?? defaultPalette;
  }

  Color get glassBorderActive => primary.withValues(alpha: 0.48);
  Color get glassBorderIdle => Colors.white.withValues(alpha: 0.13);
  Color get cardSurfaceTop =>
      Color.lerp(surfaceElevated, primary, 0.11)!.withValues(alpha: glass.fillAlpha);
  Color get cardSurfaceBottom =>
      Color.lerp(surface, Colors.black, 0.22)!
          .withValues(alpha: (glass.fillAlpha + 0.12).clamp(0.0, 0.96));

  LinearGradient cardBevelGradient({bool isSelected = false}) {
    final topColor = Color.lerp(
      surfaceElevated,
      primary,
      isSelected ? 0.22 : 0.10,
    )!.withValues(alpha: (glass.fillAlpha + 0.05).clamp(0.0, 0.96));
    final midColor = Color.lerp(
      surfaceElevated,
      secondary,
      isSelected ? 0.10 : 0.04,
    )!.withValues(alpha: glass.fillAlpha);
    return LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      stops: const [0.0, 0.45, 1.0],
      colors: [topColor, midColor, cardSurfaceBottom],
    );
  }

  LinearGradient specularBorderGradient({bool isSelected = false}) {
    return LinearGradient(
      begin: Alignment.centerLeft,
      end: Alignment.centerRight,
      colors: [
        Colors.white.withValues(alpha: isSelected ? 0.34 : 0.22),
        primary.withValues(alpha: isSelected ? 0.62 : 0.24),
        Colors.transparent,
      ],
    );
  }

  List<BoxShadow> elevationShadows({
    bool isSelected = false,
    Color? glowColor,
  }) {
    final glow = glowColor ?? primary;
    return [
      BoxShadow(
        color: Colors.black.withValues(alpha: isSelected ? 0.56 : 0.44),
        blurRadius: isSelected ? 26 : 18,
        spreadRadius: isSelected ? 1 : 0,
        offset: const Offset(0, 10),
      ),
      BoxShadow(
        color: glow.withValues(alpha: isSelected ? 0.25 : 0.08),
        blurRadius: isSelected ? 22 : 14,
        spreadRadius: isSelected ? 1 : -2,
        offset: const Offset(0, 2),
      ),
    ];
  }

  @override
  CyberPalette copyWith({
    CyberAccentPreset? preset,
    GlassIntensity? glass,
    Color? background,
    Color? surface,
    Color? surfaceElevated,
    Color? primary,
    Color? secondary,
    Color? accent,
    Color? success,
    Color? warning,
    Color? textPrimary,
    Color? textSecondary,
    Color? textTertiary,
  }) {
    return CyberPalette(
      preset: preset ?? this.preset,
      glass: glass ?? this.glass,
      background: background ?? this.background,
      surface: surface ?? this.surface,
      surfaceElevated: surfaceElevated ?? this.surfaceElevated,
      primary: primary ?? this.primary,
      secondary: secondary ?? this.secondary,
      accent: accent ?? this.accent,
      success: success ?? this.success,
      warning: warning ?? this.warning,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textTertiary: textTertiary ?? this.textTertiary,
    );
  }

  @override
  CyberPalette lerp(ThemeExtension<CyberPalette>? other, double t) {
    if (other is! CyberPalette) return this;
    return CyberPalette(
      preset: t < 0.5 ? preset : other.preset,
      glass: t < 0.5 ? glass : other.glass,
      background: Color.lerp(background, other.background, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceElevated: Color.lerp(surfaceElevated, other.surfaceElevated, t)!,
      primary: Color.lerp(primary, other.primary, t)!,
      secondary: Color.lerp(secondary, other.secondary, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textTertiary: Color.lerp(textTertiary, other.textTertiary, t)!,
    );
  }
}

// =====================================================================
// FLUID TYPOGRAPHY & RESOLUTION-INDEPENDENT SCALING ENGINE
// =====================================================================
class FluidSize {
  static const double baselineWidth = 390.0;
  static const double baselineHeight = 780.0;

  /// Aspect-ratio & resolution-aware scale factor that adapts smoothly from
  /// 260dp foldable cover screens and 320dp landscape phones up to 4K desktops
  /// without ever blowing up typography on short landscape viewports.
  static double getScaleFactor(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final shortest = size.shortestSide;
    final widthRatio = size.width / baselineWidth;
    final shortRatio = shortest / baselineWidth;
    final heightCap = (size.height / baselineHeight).clamp(0.76, 1.25);

    // Blend shortest-side and width ratios so landscape phones don't inflate
    // text to 1.5x while tablets/desktops still get a clean proportional step-up.
    final blended = (shortRatio * 0.72) + (widthRatio * 0.28);
    final raw = blended < heightCap ? blended : (blended * 0.55 + heightCap * 0.45);
    return raw.clamp(0.75, 1.22);
  }

  static bool isUltraCompact(BuildContext context) =>
      MediaQuery.sizeOf(context).width < 340;

  static bool isShortViewport(BuildContext context) =>
      MediaQuery.sizeOf(context).height < 480;

  static EdgeInsets pagePadding(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final h = size.width < 340 ? 10.0 : (size.width < 600 ? 14.0 : 16.0);
    final v = size.height < 460 ? 8.0 : 12.0;
    return EdgeInsets.symmetric(horizontal: h, vertical: v);
  }

  static double font(BuildContext context, double baseSize) {
    return (baseSize * getScaleFactor(context) * 2.0).roundToDouble() / 2.0;
  }

  static double space(BuildContext context, double baseSpace) {
    return (baseSpace * getScaleFactor(context)).roundToDouble();
  }

  /// Clamped TextScaler restricting system OS-level accessibility font scaling
  /// between 0.85x and 1.20x (or 1.08x on ultra-narrow/short viewports)
  /// to guarantee zero-overflow layout rendering.
  static TextScaler clampedTextScaler(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final maxScale = (size.width < 340 || size.height < 440) ? 1.08 : 1.20;
    return MediaQuery.textScalerOf(context).clamp(
      minScaleFactor: 0.85,
      maxScaleFactor: maxScale,
    );
  }
}

extension FluidContext on BuildContext {
  double get screenWidth => MediaQuery.sizeOf(this).width;
  double get screenHeight => MediaQuery.sizeOf(this).height;
  double get devicePixelRatio => MediaQuery.devicePixelRatioOf(this);
  EdgeInsets get viewPadding => MediaQuery.paddingOf(this);
  EdgeInsets get viewInsets => MediaQuery.viewInsetsOf(this);

  double fluidFont(double base) => FluidSize.font(this, base);
  double fluidSpace(double base) => FluidSize.space(this, base);
  TextScaler get clampedScaler => FluidSize.clampedTextScaler(this);
  CyberPalette get palette => CyberPalette.of(this);

  bool get isCompact => screenWidth < 600;
  bool get isMedium => screenWidth >= 600 && screenWidth <= 840;
  bool get isExpanded => screenWidth > 840;
  bool get isUltraCompact => FluidSize.isUltraCompact(this);
  bool get isShortViewport => FluidSize.isShortViewport(this);
}

// =====================================================================
// CYBERNETIC MATERIAL 3 THEME
// =====================================================================
class CyberTheme {
  static ThemeData get themeData => fromPalette(CyberPalette.defaultPalette);

  static ThemeData fromPalette(CyberPalette palette) {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: palette.background,
      colorScheme: ColorScheme.dark(
        primary: palette.primary,
        secondary: palette.secondary,
        surface: palette.surface,
        error: palette.accent,
        onPrimary: Colors.black,
        onSurface: palette.textPrimary,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: 'monospace',
          fontSize: 16,
          fontWeight: FontWeight.w700,
          letterSpacing: 2.0,
          color: palette.textPrimary,
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: Colors.white10,
        thickness: 1,
        space: 1,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: palette.surfaceElevated,
        contentTextStyle: TextStyle(color: palette.textPrimary, fontSize: 13),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: palette.primary.withValues(alpha: 0.35)),
        ),
      ),
      extensions: [palette],
    );
  }
}

/// Reusable tactile micro-interaction wrapper that gives cards, pills, and
/// buttons a subtle spring scale-down on press while respecting reduced-motion.
class FluidPressScale extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final double pressedScale;
  final Duration duration;

  const FluidPressScale({
    super.key,
    required this.child,
    this.onTap,
    this.pressedScale = 0.968,
    this.duration = const Duration(milliseconds: 140),
  });

  @override
  State<FluidPressScale> createState() => _FluidPressScaleState();
}

class _FluidPressScaleState extends State<FluidPressScale> {
  bool _isPressed = false;

  void _setPressed(bool value) {
    if (_isPressed == value) return;
    setState(() => _isPressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final disableAnimations = MediaQuery.disableAnimationsOf(context);
    final effectiveDuration = disableAnimations ? Duration.zero : widget.duration;
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _setPressed(true),
      onPointerUp: (_) => _setPressed(false),
      onPointerCancel: (_) => _setPressed(false),
      child: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: widget.onTap,
        child: AnimatedScale(
          scale: _isPressed ? widget.pressedScale : 1.0,
          duration: effectiveDuration,
          curve: Curves.easeOutCubic,
          child: widget.child,
        ),
      ),
    );
  }
}

/// Top-edge specular highlight bar that gives glassmorphic surfaces a 3D bevel rim.
class FluidSpecularBar extends StatelessWidget {
  final bool isSelected;
  final double height;
  final EdgeInsetsGeometry margin;

  const FluidSpecularBar({
    super.key,
    this.isSelected = false,
    this.height = 1.0,
    this.margin = const EdgeInsets.symmetric(horizontal: 10),
  });

  @override
  Widget build(BuildContext context) {
    final palette = CyberPalette.of(context);
    return Container(
      height: height,
      margin: margin,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(height),
        gradient: palette.specularBorderGradient(isSelected: isSelected),
      ),
    );
  }
}

