import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/fluid_theme.dart';

// =====================================================================
// ADAPTIVE BREAKPOINT DEFINITIONS (MATERIAL 3 COMPLIANT)
// =====================================================================
enum ScreenTier {
  compact, // < 600dp  (Standard Smartphones: Portrait)
  medium, // 600-840dp (Foldables, Phablets, Landscape Phones)
  expanded, // > 840dp  (Tablets, Desktop / Web Viewports)
}

class ScreenBreakpoint {
  static const double compactMax = 599.0;
  static const double mediumMax = 840.0;

  static ScreenTier getTier(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    if (width < 600) return ScreenTier.compact;
    if (width <= 840) return ScreenTier.medium;
    return ScreenTier.expanded;
  }
}

// =====================================================================
// ADAPTIVE LAYOUT BUILDER CORE WIDGET
// =====================================================================
class AdaptiveLayoutBuilder extends StatelessWidget {
  final Widget Function(BuildContext context) compactBuilder;
  final Widget Function(BuildContext context)? mediumBuilder;
  final Widget Function(BuildContext context)? expandedBuilder;

  const AdaptiveLayoutBuilder({
    super.key,
    required this.compactBuilder,
    this.mediumBuilder,
    this.expandedBuilder,
  });

  @override
  Widget build(BuildContext context) {
    final tier = ScreenBreakpoint.getTier(context);
    switch (tier) {
      case ScreenTier.compact:
        return compactBuilder(context);
      case ScreenTier.medium:
        return (mediumBuilder ?? compactBuilder)(context);
      case ScreenTier.expanded:
        return (expandedBuilder ?? mediumBuilder ?? compactBuilder)(context);
    }
  }
}

// =====================================================================
// ADAPTIVE NAVIGATION DESTINATION ITEM
// =====================================================================
class AdaptiveNavItem {
  final String label;
  final IconData icon;
  final IconData? activeIcon;
  final int? badgeCount;

  const AdaptiveNavItem({
    required this.label,
    required this.icon,
    this.activeIcon,
    this.badgeCount,
  });
}

// =====================================================================
// ADAPTIVE MASTER SCAFFOLD (EDGE-TO-EDGE & NOTCH RESILIENT)
// =====================================================================
class AdaptiveScaffold extends StatelessWidget {
  final String title;
  final List<AdaptiveNavItem> navItems;
  final int selectedIndex;
  final ValueChanged<int> onIndexChanged;
  final List<Widget>? actions;

  // Body slots
  final Widget compactBody;
  final Widget? mediumBody;
  final Widget? expandedMasterPane;
  final Widget? expandedDetailPane;
  final double
      expandedMasterWidthFraction; // default 0.35 (35% list, 65% detail)

  const AdaptiveScaffold({
    super.key,
    required this.title,
    required this.navItems,
    required this.selectedIndex,
    required this.onIndexChanged,
    required this.compactBody,
    this.mediumBody,
    this.expandedMasterPane,
    this.expandedDetailPane,
    this.expandedMasterWidthFraction = 0.35,
    this.actions,
  });

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final tier = ScreenBreakpoint.getTier(context);
    final insets = MediaQuery.viewInsetsOf(context);
    final padding = MediaQuery.paddingOf(context);

    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final ambientDur =
        disableAnim ? Duration.zero : const Duration(milliseconds: 520);

    // Global Clamped Text Scaler guarantees typography stability
    return MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: FluidSize.clampedTextScaler(context),
      ),
      child: Scaffold(
        backgroundColor: palette.background,
        resizeToAvoidBottomInset:
            false, // Insets manually offset floating overlays
        body: Stack(
          children: [
            // Energetic Apple Liquid Glass Aurora Refraction Orbs (Daylight & Vibrant Dark)
            Positioned.fill(
              child: RepaintBoundary(
                child: IgnorePointer(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: palette.isDaylight
                            ? const [
                                Color(0xFFF6F3FF),
                                Color(0xFFEDF4FF),
                                Color(0xFFFDF2F8),
                              ]
                            : const [
                                Color(0xFF090B1D),
                                Color(0xFF111030),
                                Color(0xFF190D2D),
                              ],
                      ),
                    ),
                    child: Stack(
                      children: [
                        AnimatedPositioned(
                          duration: ambientDur,
                          curve: Curves.easeOutBack,
                          top: selectedIndex == 0
                              ? -100
                              : (selectedIndex == 1 ? -60 : -85),
                          right: selectedIndex == 0
                              ? -65
                              : (selectedIndex == 1 ? -25 : -95),
                          child: AnimatedContainer(
                            duration: ambientDur,
                            curve: Curves.easeOutCubic,
                            width: 380,
                            height: 380,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              gradient: RadialGradient(
                                colors: [
                                  palette.primary.withValues(
                                      alpha: palette.isDaylight ? 0.30 : 0.28),
                                  palette.secondary.withValues(
                                      alpha: palette.isDaylight ? 0.14 : 0.10),
                                  Colors.transparent,
                                ],
                              ),
                            ),
                          ),
                        ),
                        AnimatedPositioned(
                          duration: ambientDur,
                          curve: Curves.easeOutBack,
                          bottom: selectedIndex == 0
                              ? -95
                              : (selectedIndex == 1 ? -125 : -65),
                          left: selectedIndex == 0
                              ? -75
                              : (selectedIndex == 1 ? -35 : -95),
                          child: AnimatedContainer(
                            duration: ambientDur,
                            curve: Curves.easeOutCubic,
                            width: 360,
                            height: 360,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              gradient: RadialGradient(
                                colors: [
                                  palette.secondary.withValues(
                                      alpha: palette.isDaylight ? 0.26 : 0.24),
                                  palette.sky.withValues(
                                      alpha: palette.isDaylight ? 0.14 : 0.08),
                                  Colors.transparent,
                                ],
                              ),
                            ),
                          ),
                        ),
                        AnimatedPositioned(
                          duration: ambientDur,
                          curve: Curves.easeOutCubic,
                          top: selectedIndex == 1 ? 140 : 80,
                          left: selectedIndex == 2 ? -40 : 40,
                          child: Container(
                            width: 280,
                            height: 280,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              gradient: RadialGradient(
                                colors: [
                                  palette.sky.withValues(
                                      alpha: palette.isDaylight ? 0.22 : 0.14),
                                  palette.success.withValues(
                                      alpha: palette.isDaylight ? 0.10 : 0.05),
                                  Colors.transparent,
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            SafeArea(
              top: true,
              bottom: false, // Edge-to-edge drawing under navigation dock
              child: Builder(
                builder: (context) {
                  if (tier == ScreenTier.expanded) {
                    return _buildExpandedSplitView(context);
                  } else if (tier == ScreenTier.medium) {
                    return _buildMediumRailView(context);
                  } else {
                    return _buildCompactView(context, padding, insets);
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFluidSwitcher({
    required BuildContext context,
    required Widget child,
  }) {
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    return AnimatedSwitcher(
      duration:
          disableAnim ? Duration.zero : const Duration(milliseconds: 280),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (childWidget, animation) {
        final slide = Tween<Offset>(
          begin: const Offset(0.0, 0.024),
          end: Offset.zero,
        ).animate(animation);
        final scale = Tween<double>(
          begin: 0.986,
          end: 1.0,
        ).animate(animation);
        return FadeTransition(
          opacity: animation,
          child: SlideTransition(
            position: slide,
            child: ScaleTransition(
              scale: scale,
              child: childWidget,
            ),
          ),
        );
      },
      child: child,
    );
  }

  // -------------------------------------------------------------------
  // 1. COMPACT VIEW (<600dp): SINGLE-COLUMN + FLOATING PILL NAV
  // -------------------------------------------------------------------
  Widget _buildCompactView(
      BuildContext context, EdgeInsets padding, EdgeInsets insets) {
    final isKeyboardVisible = insets.bottom > 50;
    final isShort = context.isShortViewport;
    final isUltraCompact = context.isUltraCompact;
    final horizontalInset = isUltraCompact ? 10.0 : 20.0;
    final bottomReserve =
        isShort ? (padding.bottom + 66.0) : (padding.bottom + 80.0);

    return Stack(
      children: [
        // Main content area with padding for the floating pill dock
        Positioned.fill(
          child: Column(
            children: [
              _buildAppBar(context),
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(
                    bottom: isKeyboardVisible ? insets.bottom : bottomReserve,
                  ),
                  child: _buildFluidSwitcher(
                    context: context,
                    child: KeyedSubtree(
                      key: ValueKey<int>(selectedIndex),
                      child: compactBody,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),

        // Floating Pill Navigation Dock (hides when keyboard opens)
        if (!isKeyboardVisible)
          Positioned(
            left: horizontalInset,
            right: horizontalInset,
            bottom: padding.bottom + (isShort ? 8 : 12),
            child: _buildFloatingPillNav(context),
          ),
      ],
    );
  }

  // Floating Liquid Glass Pill Dock for Mobile
  Widget _buildFloatingPillNav(BuildContext context) {
    final palette = context.palette;
    final sigma = palette.glass.blurSigma.clamp(0.0, 14.0);
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final dur = disableAnim ? Duration.zero : const Duration(milliseconds: 240);
    final isShort = context.isShortViewport;
    final isUltraCompact = context.isUltraCompact;
    final pillHeight = isShort ? 52.0 : 62.0;
    final Color activeFg = palette.onHeroGradient;

    final Widget pillContent = Container(
      height: pillHeight,
      padding: EdgeInsets.symmetric(
        horizontal: isUltraCompact ? 5 : 8,
        vertical: isShort ? 4 : 5,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          stops: const [0.0, 0.5, 1.0],
          colors: palette.isDaylight
              ? [
                  Colors.white.withValues(alpha: sigma > 0 ? 0.82 : 0.94),
                  const Color(0xFFF6F7FF)
                      .withValues(alpha: sigma > 0 ? 0.72 : 0.92),
                  Colors.white.withValues(alpha: sigma > 0 ? 0.78 : 0.94),
                ]
              : [
                  Color.lerp(palette.surfaceElevated, Colors.white, 0.14)!
                      .withValues(alpha: sigma > 0 ? 0.76 : 0.94),
                  palette.surfaceElevated
                      .withValues(alpha: sigma > 0 ? 0.72 : 0.94),
                  Color.lerp(palette.surface, Colors.black, 0.22)!
                      .withValues(alpha: sigma > 0 ? 0.82 : 0.96),
                ],
        ),
        borderRadius: BorderRadius.circular(34),
        border: Border.all(
          color: palette.glassBorderIdle,
          width: 1.25,
        ),
        boxShadow: palette.elevationShadows(
          isSelected: true,
          glowColor: palette.primary,
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const FluidSpecularBar(
            isSelected: true,
            height: 1.2,
            margin: EdgeInsets.symmetric(horizontal: 26),
          ),
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: List.generate(navItems.length, (index) {
                final item = navItems[index];
                final isSelected = selectedIndex == index;
                return Flexible(
                  child: Semantics(
                    button: true,
                    selected: isSelected,
                    label: item.label,
                    child: Tooltip(
                      message: item.label,
                      child: FluidPressScale(
                        onTap: () => onIndexChanged(index),
                        pressedScale: 0.91,
                        child: ConstrainedBox(
                          constraints: BoxConstraints(
                            minWidth: isUltraCompact ? 38 : 46,
                            minHeight: isShort ? 38 : 44,
                          ),
                          child: AnimatedContainer(
                            duration: dur,
                            curve: Curves.easeOutCubic,
                            padding: EdgeInsets.symmetric(
                              horizontal: isSelected
                                  ? (isUltraCompact ? 11 : 16)
                                  : (isUltraCompact ? 9 : 13),
                              vertical: isShort ? 5 : 8,
                            ),
                            decoration: BoxDecoration(
                              gradient:
                                  isSelected ? palette.heroGradient : null,
                              color: isSelected ? null : Colors.transparent,
                              borderRadius: BorderRadius.circular(26),
                              border: isSelected
                                  ? Border.all(
                                      color:
                                          Colors.white.withValues(alpha: 0.55),
                                      width: 1,
                                    )
                                  : null,
                              boxShadow: isSelected
                                  ? [
                                      BoxShadow(
                                        color: palette.primary
                                            .withValues(alpha: 0.36),
                                        blurRadius: 16,
                                        offset: const Offset(0, 4),
                                      ),
                                    ]
                                  : null,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                AnimatedScale(
                                  scale: isSelected ? 1.10 : 1.0,
                                  duration: dur,
                                  curve: Curves.easeOutBack,
                                  child: Icon(
                                    isSelected
                                        ? (item.activeIcon ?? item.icon)
                                        : item.icon,
                                    size: isUltraCompact ? 17 : 19,
                                    color: isSelected
                                        ? activeFg
                                        : palette.textSecondary,
                                  ),
                                ),
                                if (item.badgeCount != null &&
                                    item.badgeCount! > 0) ...[
                                  const SizedBox(width: 4),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 5.5, vertical: 1),
                                    decoration: BoxDecoration(
                                      color: isSelected
                                          ? activeFg.withValues(alpha: 0.22)
                                          : palette.success
                                              .withValues(alpha: 0.18),
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: Text(
                                      '${item.badgeCount}',
                                      style: TextStyle(
                                        fontSize: 9.5,
                                        fontWeight: FontWeight.w800,
                                        color: isSelected
                                            ? activeFg
                                            : palette.success,
                                      ),
                                    ),
                                  ),
                                ],
                                Flexible(
                                  child: AnimatedSize(
                                    duration: dur,
                                    curve: Curves.easeOutCubic,
                                    child: isSelected
                                        ? Padding(
                                            padding: EdgeInsets.only(
                                                left: isUltraCompact ? 5 : 7),
                                            child: Text(
                                              item.label,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                color: activeFg,
                                                fontSize:
                                                    context.fluidFont(11),
                                                fontWeight: FontWeight.w800,
                                                letterSpacing: -0.1,
                                              ),
                                            ),
                                          )
                                        : const SizedBox.shrink(),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              }),
            ),
          ),
        ],
      ),
    );

    return RepaintBoundary(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(34),
        child: sigma > 0
            ? BackdropFilter(
                filter: ImageFilter.blur(sigmaX: sigma, sigmaY: sigma),
                child: pillContent,
              )
            : pillContent,
      ),
    );
  }

  // -------------------------------------------------------------------
  // 2. MEDIUM VIEW (600-840dp): TWO-COLUMN ADAPTIVE + NAVIGATION RAIL
  // -------------------------------------------------------------------
  Widget _buildMediumRailView(BuildContext context) {
    final palette = context.palette;
    return Row(
      children: [
        _buildNavigationRail(context, extended: false),
        VerticalDivider(width: 1, color: palette.dividerColor),
        Expanded(
          child: Column(
            children: [
              _buildAppBar(context),
              Expanded(
                child: _buildFluidSwitcher(
                  context: context,
                  child: KeyedSubtree(
                    key: ValueKey<int>(selectedIndex),
                    child: mediumBody ?? compactBody,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------
  // 3. EXPANDED VIEW (>840dp): MASTER-DETAIL SPLIT VIEW (OR ACTIVE TAB)
  // -------------------------------------------------------------------
  Widget _buildExpandedSplitView(BuildContext context) {
    final palette = context.palette;
    final String? activeTabSubtitle =
        (selectedIndex >= 0 && selectedIndex < navItems.length)
            ? navItems[selectedIndex].label.toUpperCase()
            : null;
    return Row(
      children: [
        _buildNavigationRail(context, extended: true),
        VerticalDivider(width: 1, color: palette.dividerColor),
        if (selectedIndex == 0) ...[
          // Master Fleet List Pane (Default 35% of remaining space)
          Expanded(
            flex: (expandedMasterWidthFraction * 100).round(),
            child: Column(
              children: [
                _buildAppBar(context, subtitle: 'FLEET DIRECTORY'),
                Expanded(child: expandedMasterPane ?? compactBody),
              ],
            ),
          ),
          VerticalDivider(width: 1, color: palette.dividerColor),
          // Detail Console / Stream / Telemetry Pane (Default 65% of remaining space)
          Expanded(
            flex: ((1.0 - expandedMasterWidthFraction) * 100).round(),
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    palette.surfaceElevated.withValues(alpha: 0.42),
                    palette.surface.withValues(alpha: 0.28),
                  ],
                ),
              ),
              child: _buildFluidSwitcher(
                context: context,
                child: expandedDetailPane ??
                    Center(
                      child: Text(
                        'Select an active host to view live stream & console',
                        style: TextStyle(color: palette.textSecondary),
                      ),
                    ),
              ),
            ),
          ),
        ] else
          Expanded(
            child: Column(
              children: [
                _buildAppBar(context, subtitle: activeTabSubtitle),
                Expanded(
                  child: _buildFluidSwitcher(
                    context: context,
                    child: KeyedSubtree(
                      key: ValueKey<int>(selectedIndex),
                      child: compactBody,
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  // -------------------------------------------------------------------
  // CYBER NAVIGATION RAIL (MEDIUM / EXPANDED)
  // -------------------------------------------------------------------
  Widget _buildNavigationRail(BuildContext context, {required bool extended}) {
    final palette = context.palette;
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final dur = disableAnim ? Duration.zero : const Duration(milliseconds: 220);
    final isShort = context.isShortViewport;
    final screenW = context.screenWidth;
    final railWidth = extended ? (screenW < 980 ? 162.0 : 188.0) : 68.0;

    return RepaintBoundary(
      child: Container(
        width: railWidth,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: palette.isDaylight
                ? [
                    Colors.white.withValues(alpha: 0.78),
                    const Color(0xFFF4F6FF).withValues(alpha: 0.72),
                    Colors.white.withValues(alpha: 0.80),
                  ]
                : [
                    Color.lerp(palette.surfaceElevated, palette.primary, 0.08)!
                        .withValues(alpha: 0.90),
                    palette.surfaceElevated.withValues(alpha: 0.86),
                    palette.background.withValues(alpha: 0.92),
                  ],
          ),
          border: Border(
            right: BorderSide(color: palette.glassBorderIdle, width: 1),
          ),
          boxShadow: [
            BoxShadow(
              color: (palette.isDaylight
                      ? const Color(0xFF4C3E94)
                      : Colors.black)
                  .withValues(alpha: palette.isDaylight ? 0.10 : 0.36),
              blurRadius: 16,
              offset: const Offset(4, 0),
            ),
          ],
        ),
        padding: EdgeInsets.symmetric(vertical: isShort ? 6 : 16),
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.symmetric(
                horizontal: 10,
                vertical: isShort ? 4 : 8,
              ),
              child: Row(
                mainAxisAlignment: extended
                    ? MainAxisAlignment.start
                    : MainAxisAlignment.center,
                children: [
                  Container(
                    width: isShort ? 30 : 36,
                    height: isShort ? 30 : 36,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(13),
                      gradient: palette.heroGradient,
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.55),
                        width: 1.0,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: palette.primary.withValues(alpha: 0.34),
                          blurRadius: 12,
                        ),
                      ],
                    ),
                    child: Center(
                      child: Icon(
                        Icons.hub_rounded,
                        size: isShort ? 15 : 18,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  if (extended) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'AI NetController',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: context.fluidFont(12.5),
                          color: palette.textPrimary,
                          letterSpacing: -0.3,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            SizedBox(height: isShort ? 6 : 20),
            Expanded(
              child: ListView.builder(
                itemCount: navItems.length,
                itemBuilder: (context, index) {
                  final item = navItems[index];
                  final isSelected = selectedIndex == index;
                  final Color activeFg = palette.onHeroGradient;
                  final bool hasBadge =
                      item.badgeCount != null && item.badgeCount! > 0;
                  return Padding(
                    padding: EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: isShort ? 2 : 4,
                    ),
                    child: Semantics(
                      button: true,
                      selected: isSelected,
                      label: item.label,
                      child: Tooltip(
                        message: extended ? '' : item.label,
                        child: FluidPressScale(
                          onTap: () => onIndexChanged(index),
                          pressedScale: 0.94,
                          child: AnimatedContainer(
                            duration: dur,
                            curve: Curves.easeOutCubic,
                            padding: EdgeInsets.symmetric(
                              vertical: isShort ? 8 : 11,
                              horizontal: extended ? 12 : 8,
                            ),
                            decoration: BoxDecoration(
                              gradient:
                                  isSelected ? palette.heroGradient : null,
                              color: isSelected ? null : Colors.transparent,
                              borderRadius: BorderRadius.circular(20),
                              border: isSelected
                                  ? Border.all(
                                      color:
                                          Colors.white.withValues(alpha: 0.55),
                                    )
                                  : Border.all(color: Colors.transparent),
                              boxShadow: isSelected
                                  ? [
                                      BoxShadow(
                                        color: palette.primary
                                            .withValues(alpha: 0.30),
                                        blurRadius: 14,
                                        offset: const Offset(0, 4),
                                      ),
                                    ]
                                  : null,
                            ),
                            child: Row(
                              mainAxisAlignment: extended
                                  ? MainAxisAlignment.start
                                  : MainAxisAlignment.center,
                              children: [
                                Stack(
                                  clipBehavior: Clip.none,
                                  children: [
                                    AnimatedScale(
                                      scale: isSelected ? 1.10 : 1.0,
                                      duration: dur,
                                      curve: Curves.easeOutBack,
                                      child: Icon(
                                        isSelected
                                            ? (item.activeIcon ?? item.icon)
                                            : item.icon,
                                        size: 20,
                                        color: isSelected
                                            ? activeFg
                                            : palette.textSecondary,
                                      ),
                                    ),
                                    if (!extended && hasBadge)
                                      Positioned(
                                        top: -6,
                                        right: -9,
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 4,
                                            vertical: 1,
                                          ),
                                          decoration: BoxDecoration(
                                            color: isSelected
                                                ? activeFg
                                                : palette.success,
                                            borderRadius:
                                                BorderRadius.circular(999),
                                          ),
                                          child: Text(
                                            item.badgeCount! > 99
                                                ? '99+'
                                                : '${item.badgeCount}',
                                            textScaler: TextScaler.noScaling,
                                            style: TextStyle(
                                              fontSize: 8.5,
                                              height: 1.1,
                                              fontWeight: FontWeight.w800,
                                              color: isSelected
                                                  ? palette.primary
                                                  : palette.onPrimary,
                                            ),
                                          ),
                                        ),
                                      ),
                                  ],
                                ),
                                if (extended) ...[
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                      item.label,
                                      style: TextStyle(
                                        color: isSelected
                                            ? activeFg
                                            : palette.textSecondary,
                                        fontWeight: isSelected
                                            ? FontWeight.w800
                                            : FontWeight.w600,
                                        fontSize: context.fluidFont(12),
                                      ),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  if (hasBadge) ...[
                                    const SizedBox(width: 6),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                        vertical: 1.5,
                                      ),
                                      decoration: BoxDecoration(
                                        color: isSelected
                                            ? activeFg.withValues(alpha: 0.22)
                                            : palette.success
                                                .withValues(alpha: 0.18),
                                        borderRadius: BorderRadius.circular(10),
                                      ),
                                      child: Text(
                                        item.badgeCount! > 99
                                            ? '99+'
                                            : '${item.badgeCount}',
                                        style: TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.w800,
                                          color: isSelected
                                              ? activeFg
                                              : palette.success,
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // DETACHED FLOATING APPLE LIQUID GLASS TOP HEADER CAPSULE
  // -------------------------------------------------------------------
  Widget _buildAppBar(BuildContext context, {String? subtitle}) {
    final palette = context.palette;
    final isShort = context.isShortViewport;

    return LayoutBuilder(
      builder: (context, constraints) {
        final availW = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : context.screenWidth;
        final isTight = availW < 340;
        final isNarrow = availW < 420;

        return Container(
          margin: EdgeInsets.fromLTRB(
            isTight ? 6 : 12,
            isShort ? 4 : 7,
            isTight ? 6 : 12,
            isShort ? 3 : 6,
          ),
          constraints: BoxConstraints(minHeight: isShort ? 44 : 52),
          padding: EdgeInsets.symmetric(
            horizontal: isTight ? 8 : 14,
            vertical: isShort ? 3 : 6,
          ),
          decoration: BoxDecoration(
            gradient: palette.cardBevelGradient(isSelected: false),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(
              color: palette.glassBorderIdle,
              width: 1.15,
            ),
            boxShadow: palette.elevationShadows(isSelected: false),
          ),
          child: Row(
            children: [
              if (!isTight)
                Container(
                  width: isShort ? 26 : 32,
                  height: isShort ? 26 : 32,
                  margin: const EdgeInsets.only(right: 10),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(11),
                    gradient: palette.heroGradient,
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.55),
                      width: 1,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: palette.primary.withValues(alpha: 0.34),
                        blurRadius: 10,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: const Center(
                    child: Icon(
                      Icons.hub_rounded,
                      size: 16,
                      color: Colors.white,
                    ),
                  ),
                ),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: context.fluidFont(isTight ? 12.5 : 15),
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.35,
                        color: palette.textPrimary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (subtitle != null)
                      Text(
                        subtitle,
                        style: TextStyle(
                          fontSize: context.fluidFont(9.5),
                          fontWeight: FontWeight.w600,
                          color: palette.textSecondary,
                          letterSpacing: 0.1,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
              if (actions != null)
                IconButtonTheme(
                  data: IconButtonThemeData(
                    style: isNarrow
                        ? IconButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.all(isTight ? 4 : 6),
                            minimumSize: Size(isTight ? 32 : 36, isTight ? 32 : 36),
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          )
                        : null,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: actions!,
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

// =====================================================================
// ADAPTIVE HITL HUMAN-IN-THE-LOOP DIALOG / SHEET CONTROLLER
// =====================================================================
class AdaptiveHitlController {
  /// Presents an adaptive HITL Approval prompt:
  /// - Compact Screen (<600dp): Frosted Modal Bottom Sheet
  /// - Medium / Expanded (>600dp): Centered Modal Dialog with bounded dimensions
  static Future<bool?> showApprovalPrompt({
    required BuildContext context,
    required String hostName,
    required String command,
    required String riskLevel,
    required String reasoning,
  }) async {
    final tier = ScreenBreakpoint.getTier(context);

    if (tier == ScreenTier.compact) {
      return showModalBottomSheet<bool>(
        context: context,
        backgroundColor: Colors.transparent,
        isScrollControlled: true,
        builder: (ctx) => _HitlSheetContent(
          hostName: hostName,
          command: command,
          riskLevel: riskLevel,
          reasoning: reasoning,
        ),
      );
    } else {
      return showDialog<bool>(
        context: context,
        barrierColor: Colors.black.withValues(alpha: 0.7),
        builder: (ctx) => Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: _HitlSheetContent(
              hostName: hostName,
              command: command,
              riskLevel: riskLevel,
              reasoning: reasoning,
              isDialog: true,
            ),
          ),
        ),
      );
    }
  }
}

class _HitlSheetContent extends StatelessWidget {
  final String hostName;
  final String command;
  final String riskLevel;
  final String reasoning;
  final bool isDialog;

  const _HitlSheetContent({
    required this.hostName,
    required this.command,
    required this.riskLevel,
    required this.reasoning,
    this.isDialog = false,
  });

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final isUltraCompact = context.isUltraCompact;
    final viewHeight = MediaQuery.sizeOf(context).height;
    final bottomInset = MediaQuery.viewInsetsOf(context).bottom;

    final Widget sheetBody = Container(
      padding: EdgeInsets.all(isUltraCompact ? 16 : 24),
      decoration: BoxDecoration(
        color: palette.surfaceElevated.withValues(alpha: 0.97),
        borderRadius: BorderRadius.circular(isDialog ? 24 : 28),
        border: Border.all(
          color: palette.accent.withValues(alpha: 0.6),
          width: 1.5,
        ),
        boxShadow: palette.elevationShadows(
          isSelected: true,
          glowColor: palette.accent,
        ),
      ),
      child: SingleChildScrollView(
        physics: const BouncingScrollPhysics(),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: palette.accent.withValues(alpha: 0.16),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.warning_amber_rounded,
                    color: palette.accent,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'HITL COMMAND APPROVAL',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.bold,
                          fontSize: context.fluidFont(14),
                          color: palette.accent,
                          letterSpacing: 1.2,
                        ),
                      ),
                      Text(
                        'Target: $hostName • Risk: $riskLevel',
                        style: TextStyle(
                          fontSize: context.fluidFont(11),
                          color: palette.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'PROPOSED SHELL COMMAND',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1.2,
                      color: palette.textSecondary,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Copy proposed command',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints(
                    minWidth: 32,
                    minHeight: 32,
                  ),
                  padding: EdgeInsets.zero,
                  icon: Icon(
                    Icons.copy_rounded,
                    size: 16,
                    color: palette.textSecondary,
                  ),
                  onPressed: () {
                    unawaited(
                      Clipboard.setData(ClipboardData(text: command))
                          .catchError((_) {}),
                    );
                  },
                ),
              ],
            ),
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: palette.terminalBackground,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: palette.dividerColor),
              ),
              child: SelectableText(
                command,
                style: TextStyle(
                  fontFamily: 'monospace',
                  color: palette.terminalText,
                  fontSize: 12,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Agent Reasoning: $reasoning',
              style: TextStyle(
                fontSize: context.fluidFont(11),
                color: palette.textSecondary,
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: palette.textPrimary,
                      side: BorderSide(color: palette.dividerColor),
                      padding: const EdgeInsets.symmetric(vertical: 13),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: const FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text('REJECT'),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () => Navigator.of(context).pop(true),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: palette.accent,
                      foregroundColor: palette.onAccent,
                      padding: const EdgeInsets.symmetric(vertical: 13),
                      elevation: 8,
                      shadowColor: palette.accent.withValues(alpha: 0.45),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: const FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        'AUTHORIZE',
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: isDialog ? 16 : 0,
          right: isDialog ? 16 : 0,
          bottom: bottomInset,
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: viewHeight * 0.88),
          child: RepaintBoundary(child: sheetBody),
        ),
      ),
    );
  }
}
