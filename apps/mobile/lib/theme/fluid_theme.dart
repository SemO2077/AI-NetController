import 'package:flutter/material.dart';

// =====================================================================
// APPLE LIQUID GLASS DUAL-POLARITY & HERO ACCENT TOKENS
// =====================================================================
enum AppThemeMode {
  daylight(
    label: 'Bright Daylight',
    subtitle: 'Sunlit iOS 26 pastel-prism Liquid Glass',
  ),
  dark(
    label: 'Vibrant Dark',
    subtitle: 'Luminous twilight indigo Liquid Glass',
  );

  final String label;
  final String subtitle;

  const AppThemeMode({
    required this.label,
    required this.subtitle,
  });
}

enum CyberAccentPreset {
  violet(
    label: 'Iridescent Violet',
    subtitle: 'VisionOS Violet & Magenta',
    primary: Color(0xFFC084FC),
    secondary: Color(0xFFF472B6),
    accent: Color(0xFFFF2E93),
    daylightPrimary: Color(0xFF7C3AED),
    daylightSecondary: Color(0xFFEC4899),
  ),
  cobalt(
    label: 'Electric Azure',
    subtitle: 'Apple Sky & Cobalt',
    primary: Color(0xFF60A5FA),
    secondary: Color(0xFF8B5CF6),
    accent: Color(0xFFFF2A6D),
    daylightPrimary: Color(0xFF2563EB),
    daylightSecondary: Color(0xFF0EA5E9),
  ),
  cyan(
    label: 'Aqua Cyan',
    subtitle: 'Ocean Aqua & Indigo',
    primary: Color(0xFF22D3EE),
    secondary: Color(0xFF818CF8),
    accent: Color(0xFFFF0055),
    daylightPrimary: Color(0xFF0891B2),
    daylightSecondary: Color(0xFF6366F1),
  ),
  emerald(
    label: 'Bio Mint',
    subtitle: 'Vibrant Emerald & Mint',
    primary: Color(0xFF34D399),
    secondary: Color(0xFF22D3EE),
    accent: Color(0xFFFF4D6D),
    daylightPrimary: Color(0xFF059669),
    daylightSecondary: Color(0xFF06B6D4),
  ),
  rose(
    label: 'Coral Rose',
    subtitle: 'Poppy Rose & Coral',
    primary: Color(0xFFFB7185),
    secondary: Color(0xFFFB923C),
    accent: Color(0xFFFF0055),
    daylightPrimary: Color(0xFFE11D48),
    daylightSecondary: Color(0xFFF97316),
  ),
  amber(
    label: 'Solar Amber',
    subtitle: 'Sunlit Gold & Flame',
    primary: Color(0xFFFBBF24),
    secondary: Color(0xFFF97316),
    accent: Color(0xFFFF2A6D),
    daylightPrimary: Color(0xFFD97706),
    daylightSecondary: Color(0xFFF97316),
  );

  final String label;
  final String subtitle;
  final Color primary;
  final Color secondary;
  final Color accent;
  final Color daylightPrimary;
  final Color daylightSecondary;

  const CyberAccentPreset({
    required this.label,
    required this.subtitle,
    required this.primary,
    required this.secondary,
    required this.accent,
    required this.daylightPrimary,
    required this.daylightSecondary,
  });

  Color resolvedPrimary(AppThemeMode mode) =>
      mode == AppThemeMode.daylight ? daylightPrimary : primary;

  Color resolvedSecondary(AppThemeMode mode) =>
      mode == AppThemeMode.daylight ? daylightSecondary : secondary;
}

enum GlassIntensity {
  minimal(
    label: 'Frosted',
    subtitle: 'Crisp high-contrast matte & battery saver',
    blurSigma: 0.0,
    fillAlpha: 0.88,
  ),
  balanced(
    label: 'Liquid Glass',
    subtitle: 'Signature Apple Liquid Glass depth',
    blurSigma: 14.0,
    fillAlpha: 0.66,
  ),
  ultra(
    label: 'Crystal',
    subtitle: 'Ultra-clear prismatic refraction',
    blurSigma: 22.0,
    fillAlpha: 0.44,
  );

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

/// Dynamic Material 3 ThemeExtension carrying active Daylight / Vibrant Dark Liquid Glass palette.
@immutable
class CyberPalette extends ThemeExtension<CyberPalette> {
  final AppThemeMode themeMode;
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
  final Color sky;
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;
  final Color terminalBackground;
  final Color terminalText;

  const CyberPalette({
    this.themeMode = AppThemeMode.daylight,
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
    this.sky = const Color(0xFF0EA5E9),
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    this.terminalBackground = const Color(0xB8FFFFFF),
    this.terminalText = const Color(0xFF141530),
  });

  bool get isDaylight => themeMode == AppThemeMode.daylight;
  Brightness get brightness => isDaylight ? Brightness.light : Brightness.dark;

  factory CyberPalette.fromPreset(
    CyberAccentPreset preset, {
    GlassIntensity glass = GlassIntensity.balanced,
    AppThemeMode themeMode = AppThemeMode.daylight,
  }) {
    final isLight = themeMode == AppThemeMode.daylight;
    if (isLight) {
      return CyberPalette(
        themeMode: AppThemeMode.daylight,
        preset: preset,
        glass: glass,
        background: const Color(0xFFEEF2FF),
        surface: const Color(0xFFF7F8FF),
        surfaceElevated: const Color(0xFFFFFFFF),
        primary: preset.daylightPrimary,
        secondary: preset.daylightSecondary,
        accent: const Color(0xFFE11D48),
        success: const Color(0xFF047857),
        warning: const Color(0xFFB45309),
        sky: const Color(0xFF0369A1),
        textPrimary: const Color(0xFF141530),
        textSecondary: const Color(0xFF43476B),
        textTertiary: const Color(0xFF5E648F),
        terminalBackground: const Color(0xCCFFFFFF),
        terminalText: const Color(0xFF161836),
      );
    }

    return CyberPalette(
      themeMode: AppThemeMode.dark,
      preset: preset,
      glass: glass,
      background: const Color(0xFF090B1D),
      surface: const Color(0xFF141838),
      surfaceElevated: const Color(0xFF1C214A),
      primary: preset.primary,
      secondary: preset.secondary,
      accent: preset.accent,
      success: const Color(0xFF34D399),
      warning: const Color(0xFFFBBF24),
      sky: const Color(0xFF38BDF8),
      textPrimary: const Color(0xFFF7F9FF),
      textSecondary: const Color(0xFFBDC7E8),
      textTertiary: const Color(0xFF8E99C4),
      terminalBackground: const Color(0xCC0D112B),
      terminalText: const Color(0xFFEEF2FF),
    );
  }

  static final CyberPalette defaultPalette = CyberPalette.fromPreset(
    CyberAccentPreset.violet,
    themeMode: AppThemeMode.daylight,
  );

  static CyberPalette of(BuildContext context) {
    return Theme.of(context).extension<CyberPalette>() ?? defaultPalette;
  }

  /// High-contrast foreground colors computed from relative luminance (WCAG
  /// crossover ~0.184) so light & dark accent pills/buttons maintain >= 4.4:1
  /// contrast across all 6 presets in both Daylight and Dark modes.
  static Color contrastInkFor(Color background) =>
      background.computeLuminance() > 0.184
          ? const Color(0xFF070916)
          : Colors.white;

  Color get onPrimary => contrastInkFor(primary);
  Color get onSecondary => contrastInkFor(secondary);
  Color get onWarning => contrastInkFor(warning);
  Color get onAccent => contrastInkFor(accent);

  Color get onHeroGradient {
    final mid = Color.lerp(primary, secondary, 0.5) ?? primary;
    return contrastInkFor(mid);
  }

  Color get glassBorderActive => primary.withValues(alpha: isDaylight ? 0.56 : 0.62);
  Color get glassBorderIdle => isDaylight
      ? (glass == GlassIntensity.minimal
          ? primary.withValues(alpha: 0.20)
          : Colors.white.withValues(alpha: 0.86))
      : Colors.white.withValues(alpha: 0.19);

  Color get dividerColor => isDaylight
      ? primary.withValues(alpha: 0.16)
      : Colors.white.withValues(alpha: 0.12);

  Color get cardSurfaceTop => isDaylight
      ? Colors.white.withValues(alpha: (glass.fillAlpha + 0.14).clamp(0.45, 0.94))
      : Color.lerp(surfaceElevated, primary, 0.12)!
          .withValues(alpha: glass.fillAlpha);

  Color get cardSurfaceBottom => isDaylight
      ? Color.lerp(Colors.white, primary, 0.04)!
          .withValues(alpha: glass.fillAlpha.clamp(0.36, 0.88))
      : Color.lerp(surface, Colors.black, 0.20)!
          .withValues(alpha: (glass.fillAlpha + 0.12).clamp(0.0, 0.95));

  LinearGradient get heroGradient => LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [primary, secondary],
  );

  LinearGradient squircleGradient(Color start, Color end) => LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [start, end],
  );

  LinearGradient cardBevelGradient({bool isSelected = false}) {
    if (isDaylight) {
      final top = Colors.white.withValues(
        alpha: isSelected
            ? (glass.fillAlpha + 0.22).clamp(0.58, 0.96)
            : (glass.fillAlpha + 0.16).clamp(0.48, 0.94),
      );
      final mid = Color.lerp(
        Colors.white,
        primary,
        isSelected ? 0.09 : 0.025,
      )!.withValues(alpha: glass.fillAlpha.clamp(0.38, 0.90));
      final bottom = Color.lerp(
        const Color(0xFFF6F7FF),
        secondary,
        isSelected ? 0.07 : 0.02,
      )!.withValues(alpha: (glass.fillAlpha + 0.04).clamp(0.42, 0.92));
      return LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        stops: const [0.0, 0.48, 1.0],
        colors: [top, mid, bottom],
      );
    }

    final topColor = Color.lerp(
      surfaceElevated,
      primary,
      isSelected ? 0.24 : 0.11,
    )!.withValues(alpha: (glass.fillAlpha + 0.06).clamp(0.0, 0.96));
    final midColor = Color.lerp(
      surfaceElevated,
      secondary,
      isSelected ? 0.14 : 0.05,
    )!.withValues(alpha: glass.fillAlpha);
    return LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      stops: const [0.0, 0.45, 1.0],
      colors: [topColor, midColor, cardSurfaceBottom],
    );
  }

  LinearGradient specularBorderGradient({bool isSelected = false}) {
    if (isDaylight) {
      return LinearGradient(
        begin: Alignment.centerLeft,
        end: Alignment.centerRight,
        colors: [
          Colors.white.withValues(alpha: 0.95),
          isSelected
              ? primary.withValues(alpha: 0.48)
              : Colors.white.withValues(alpha: 0.72),
          secondary.withValues(alpha: isSelected ? 0.34 : 0.12),
        ],
      );
    }
    return LinearGradient(
      begin: Alignment.centerLeft,
      end: Alignment.centerRight,
      colors: [
        Colors.white.withValues(alpha: isSelected ? 0.46 : 0.26),
        primary.withValues(alpha: isSelected ? 0.68 : 0.28),
        secondary.withValues(alpha: isSelected ? 0.42 : 0.08),
      ],
    );
  }

  List<BoxShadow> elevationShadows({
    bool isSelected = false,
    Color? glowColor,
  }) {
    final glow = glowColor ?? primary;
    if (isDaylight) {
      return [
        BoxShadow(
          color: const Color(0xFF4C3E94)
              .withValues(alpha: isSelected ? 0.16 : 0.10),
          blurRadius: isSelected ? 26 : 18,
          spreadRadius: isSelected ? 1 : -2,
          offset: const Offset(0, 10),
        ),
        BoxShadow(
          color: glow.withValues(alpha: isSelected ? 0.24 : 0.08),
          blurRadius: isSelected ? 22 : 12,
          offset: const Offset(0, 3),
        ),
      ];
    }
    return [
      BoxShadow(
        color: Colors.black.withValues(alpha: isSelected ? 0.56 : 0.44),
        blurRadius: isSelected ? 26 : 18,
        spreadRadius: isSelected ? 1 : 0,
        offset: const Offset(0, 10),
      ),
      BoxShadow(
        color: glow.withValues(alpha: isSelected ? 0.30 : 0.10),
        blurRadius: isSelected ? 24 : 14,
        spreadRadius: isSelected ? 1 : -2,
        offset: const Offset(0, 2),
      ),
    ];
  }

  @override
  CyberPalette copyWith({
    AppThemeMode? themeMode,
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
    Color? sky,
    Color? textPrimary,
    Color? textSecondary,
    Color? textTertiary,
    Color? terminalBackground,
    Color? terminalText,
  }) {
    return CyberPalette(
      themeMode: themeMode ?? this.themeMode,
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
      sky: sky ?? this.sky,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textTertiary: textTertiary ?? this.textTertiary,
      terminalBackground: terminalBackground ?? this.terminalBackground,
      terminalText: terminalText ?? this.terminalText,
    );
  }

  @override
  CyberPalette lerp(ThemeExtension<CyberPalette>? other, double t) {
    if (other is! CyberPalette) return this;
    return CyberPalette(
      themeMode: t < 0.5 ? themeMode : other.themeMode,
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
      sky: Color.lerp(sky, other.sky, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textTertiary: Color.lerp(textTertiary, other.textTertiary, t)!,
      terminalBackground:
          Color.lerp(terminalBackground, other.terminalBackground, t)!,
      terminalText: Color.lerp(terminalText, other.terminalText, t)!,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is CyberPalette &&
        other.themeMode == themeMode &&
        other.preset == preset &&
        other.glass == glass &&
        other.background == background &&
        other.surface == surface &&
        other.surfaceElevated == surfaceElevated &&
        other.primary == primary &&
        other.secondary == secondary &&
        other.accent == accent &&
        other.success == success &&
        other.warning == warning &&
        other.sky == sky &&
        other.textPrimary == textPrimary &&
        other.textSecondary == textSecondary &&
        other.textTertiary == textTertiary &&
        other.terminalBackground == terminalBackground &&
        other.terminalText == terminalText;
  }

  @override
  int get hashCode => Object.hash(
        themeMode,
        preset,
        glass,
        background,
        surface,
        surfaceElevated,
        primary,
        secondary,
        accent,
        success,
        warning,
        sky,
        textPrimary,
        textSecondary,
        textTertiary,
        terminalBackground,
        terminalText,
      );
}

// =====================================================================
// FLUID TYPOGRAPHY & RESOLUTION-INDEPENDENT SCALING ENGINE
// =====================================================================
class FluidSize {
  static const double baselineWidth = 390.0;
  static const double baselineHeight = 780.0;

  static double getScaleFactor(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final shortest = size.shortestSide;
    final widthRatio = size.width / baselineWidth;
    final shortRatio = shortest / baselineWidth;
    final heightCap = (size.height / baselineHeight).clamp(0.76, 1.25);

    final blended = (shortRatio * 0.72) + (widthRatio * 0.28);
    final raw =
        blended < heightCap ? blended : (blended * 0.55 + heightCap * 0.45);
    return raw.clamp(0.75, 1.22);
  }

  static bool isUltraCompact(BuildContext context) =>
      MediaQuery.sizeOf(context).width < 340;

  static bool isShortViewport(BuildContext context) =>
      MediaQuery.sizeOf(context).height < 480;

  static EdgeInsets pagePadding(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final h = size.width < 340 ? 12.0 : (size.width < 600 ? 16.0 : 20.0);
    final v = size.height < 460 ? 10.0 : 14.0;
    return EdgeInsets.symmetric(horizontal: h, vertical: v);
  }

  static double font(BuildContext context, double baseSize) {
    return (baseSize * getScaleFactor(context) * 2.0).roundToDouble() / 2.0;
  }

  static double space(BuildContext context, double baseSpace) {
    return (baseSpace * getScaleFactor(context)).roundToDouble();
  }

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
// APPLE LIQUID GLASS MATERIAL 3 THEME (DAYLIGHT + VIBRANT DARK)
// =====================================================================
class CyberTheme {
  static ThemeData get themeData => fromPalette(CyberPalette.defaultPalette);

  static ThemeData fromPalette(CyberPalette palette) {
    final colorScheme = palette.isDaylight
        ? ColorScheme.light(
            primary: palette.primary,
            secondary: palette.secondary,
            surface: palette.surface,
            error: palette.accent,
            onPrimary: palette.onPrimary,
            onSecondary: palette.onSecondary,
            onSurface: palette.textPrimary,
          )
        : ColorScheme.dark(
            primary: palette.primary,
            secondary: palette.secondary,
            surface: palette.surface,
            error: palette.accent,
            onPrimary: palette.onPrimary,
            onSecondary: palette.onSecondary,
            onSurface: palette.textPrimary,
          );

    return ThemeData(
      useMaterial3: true,
      brightness: palette.brightness,
      scaffoldBackgroundColor: palette.background,
      colorScheme: colorScheme,
      textTheme: (palette.isDaylight
              ? ThemeData.light().textTheme
              : ThemeData.dark().textTheme)
          .apply(
            bodyColor: palette.textPrimary,
            displayColor: palette.textPrimary,
          ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w800,
          letterSpacing: -0.4,
          color: palette.textPrimary,
        ),
      ),
      dividerTheme: DividerThemeData(
        color: palette.dividerColor,
        thickness: 1,
        space: 1,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: palette.isDaylight
            ? const Color(0xF5FFFFFF)
            : palette.surfaceElevated,
        contentTextStyle: TextStyle(
          color: palette.textPrimary,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: palette.primary.withValues(alpha: 0.40)),
        ),
      ),
      extensions: [palette],
    );
  }
}

/// Expressive bouncy jelly micro-interaction wrapper for pills, cards, and buttons.
class FluidPressScale extends StatefulWidget {
  final Widget child;
  final VoidCallback? onTap;
  final double pressedScale;
  final Duration duration;

  const FluidPressScale({
    super.key,
    required this.child,
    this.onTap,
    this.pressedScale = 0.93,
    this.duration = const Duration(milliseconds: 220),
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
    if (disableAnimations) {
      if (widget.onTap == null) return widget.child;
      return GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: widget.onTap,
        child: widget.child,
      );
    }

    final Widget scaled = AnimatedScale(
      scale: _isPressed ? widget.pressedScale : 1.0,
      duration: widget.duration,
      curve: _isPressed ? Curves.easeOutCubic : Curves.elasticOut,
      child: widget.child,
    );

    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (_) => _setPressed(true),
      onPointerUp: (_) => _setPressed(false),
      onPointerCancel: (_) => _setPressed(false),
      child: widget.onTap != null
          ? GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: widget.onTap,
              child: scaled,
            )
          : scaled,
    );
  }
}

/// Top-edge specular highlight bar for Apple Liquid Glass curved bevel reflection.
class FluidSpecularBar extends StatelessWidget {
  final bool isSelected;
  final double height;
  final EdgeInsetsGeometry margin;

  const FluidSpecularBar({
    super.key,
    this.isSelected = false,
    this.height = 1.2,
    this.margin = const EdgeInsets.symmetric(horizontal: 12),
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
