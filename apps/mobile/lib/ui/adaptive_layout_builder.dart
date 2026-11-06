import 'dart:ui';
import 'package:flutter/material.dart';
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
    final tier = ScreenBreakpoint.getTier(context);
    final insets = MediaQuery.viewInsetsOf(context);
    final padding = MediaQuery.paddingOf(context);

    // Global Clamped Text Scaler guarantees typography stability
    return MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: FluidSize.clampedTextScaler(context),
      ),
      child: Scaffold(
        backgroundColor: CyberColors.background,
        resizeToAvoidBottomInset:
            false, // Insets manually offset floating overlays
        body: Stack(
          children: [
            // Ambient Futuristic Liquid Glass Refraction Glows
            Positioned(
              top: -110,
              right: -70,
              child: IgnorePointer(
                child: Container(
                  width: 340,
                  height: 340,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        CyberColors.primary.withValues(alpha: 0.14),
                        CyberColors.secondary.withValues(alpha: 0.04),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              bottom: -90,
              left: -80,
              child: IgnorePointer(
                child: Container(
                  width: 320,
                  height: 320,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        CyberColors.secondary.withValues(alpha: 0.12),
                        CyberColors.primary.withValues(alpha: 0.03),
                        Colors.transparent,
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

  // -------------------------------------------------------------------
  // 1. COMPACT VIEW (<600dp): SINGLE-COLUMN + FLOATING PILL NAV
  // -------------------------------------------------------------------
  Widget _buildCompactView(
      BuildContext context, EdgeInsets padding, EdgeInsets insets) {
    final isKeyboardVisible = insets.bottom > 50;

    return Stack(
      children: [
        // Main content area with padding for the floating pill dock
        Positioned.fill(
          child: Column(
            children: [
              _buildAppBar(context, showNavIcon: false),
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(
                    bottom: isKeyboardVisible
                        ? insets.bottom
                        : (padding.bottom + 80.0),
                  ),
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 280),
                    switchInCurve: Curves.easeOutCubic,
                    switchOutCurve: Curves.easeInCubic,
                    transitionBuilder: (child, animation) {
                      final slide = Tween<Offset>(
                        begin: const Offset(0.0, 0.03),
                        end: Offset.zero,
                      ).animate(animation);
                      return FadeTransition(
                        opacity: animation,
                        child: SlideTransition(position: slide, child: child),
                      );
                    },
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
            left: 20,
            right: 20,
            bottom: padding.bottom + 12,
            child: _buildFloatingPillNav(context),
          ),
      ],
    );
  }

  // Floating Liquid Glass Pill Dock for Mobile
  Widget _buildFloatingPillNav(BuildContext context) {
    return RepaintBoundary(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(30),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 28, sigmaY: 28),
          child: Container(
            height: 60,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Colors.white.withValues(alpha: 0.12),
                  CyberColors.surfaceElevated.withValues(alpha: 0.78),
                ],
              ),
              borderRadius: BorderRadius.circular(30),
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.18),
                width: 1.1,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.65),
                  blurRadius: 24,
                  offset: const Offset(0, 10),
                ),
                BoxShadow(
                  color: CyberColors.primary.withValues(alpha: 0.12),
                  blurRadius: 20,
                  spreadRadius: -2,
                ),
              ],
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: List.generate(navItems.length, (index) {
                final item = navItems[index];
                final isSelected = selectedIndex == index;
                return GestureDetector(
                  onTap: () => onIndexChanged(index),
                  behavior: HitTestBehavior.opaque,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 260),
                    curve: Curves.easeOutBack,
                    padding: EdgeInsets.symmetric(
                      horizontal: isSelected ? 16 : 12,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      gradient: isSelected
                          ? LinearGradient(
                              colors: [
                                CyberColors.primary.withValues(alpha: 0.24),
                                CyberColors.secondary.withValues(alpha: 0.16),
                              ],
                            )
                          : null,
                      color: isSelected ? null : Colors.transparent,
                      borderRadius: BorderRadius.circular(22),
                      border: isSelected
                          ? Border.all(
                              color:
                                  CyberColors.primary.withValues(alpha: 0.45),
                              width: 1)
                          : null,
                      boxShadow: isSelected
                          ? [
                              BoxShadow(
                                color:
                                    CyberColors.primary.withValues(alpha: 0.22),
                                blurRadius: 12,
                              ),
                            ]
                          : null,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        AnimatedScale(
                          scale: isSelected ? 1.08 : 1.0,
                          duration: const Duration(milliseconds: 220),
                          curve: Curves.easeOutBack,
                          child: Icon(
                            isSelected
                                ? (item.activeIcon ?? item.icon)
                                : item.icon,
                            size: 19,
                            color: isSelected
                                ? CyberColors.primary
                                : CyberColors.textSecondary,
                          ),
                        ),
                        AnimatedSize(
                          duration: const Duration(milliseconds: 220),
                          curve: Curves.easeOutCubic,
                          child: isSelected
                              ? Padding(
                                  padding: const EdgeInsets.only(left: 7),
                                  child: Text(
                                    item.label,
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: context.fluidFont(11),
                                      fontWeight: FontWeight.w700,
                                      letterSpacing: 0.4,
                                    ),
                                  ),
                                )
                              : const SizedBox.shrink(),
                        ),
                      ],
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------
  // 2. MEDIUM VIEW (600-840dp): TWO-COLUMN ADAPTIVE + NAVIGATION RAIL
  // -------------------------------------------------------------------
  Widget _buildMediumRailView(BuildContext context) {
    return Row(
      children: [
        _buildNavigationRail(context, extended: false),
        const VerticalDivider(width: 1, color: Colors.white10),
        Expanded(
          child: Column(
            children: [
              _buildAppBar(context, showNavIcon: false),
              Expanded(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 260),
                  switchInCurve: Curves.easeOutCubic,
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
  // 3. EXPANDED VIEW (>840dp): MASTER-DETAIL SPLIT VIEW (35% / 65%)
  // -------------------------------------------------------------------
  Widget _buildExpandedSplitView(BuildContext context) {
    return Row(
      children: [
        // Navigation Rail on far left
        _buildNavigationRail(context, extended: true),
        const VerticalDivider(width: 1, color: Colors.white10),

        // Master Fleet List Pane (Default 35% of remaining space)
        Expanded(
          flex: (expandedMasterWidthFraction * 100).round(),
          child: Column(
            children: [
              _buildAppBar(context,
                  showNavIcon: false, subtitle: 'FLEET DIRECTORY'),
              Expanded(child: expandedMasterPane ?? compactBody),
            ],
          ),
        ),

        const VerticalDivider(width: 1, color: Colors.white10),

        // Detail Console / Stream / Telemetry Pane (Default 65% of remaining space)
        Expanded(
          flex: ((1.0 - expandedMasterWidthFraction) * 100).round(),
          child: Container(
            color: CyberColors.surface.withValues(alpha: 0.35),
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 260),
              switchInCurve: Curves.easeOutCubic,
              child: expandedDetailPane ??
                  const Center(
                    child: Text(
                      'Select an active host to view live stream & console',
                      style: TextStyle(color: CyberColors.textSecondary),
                    ),
                  ),
            ),
          ),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------
  // CYBER NAVIGATION RAIL (MEDIUM / EXPANDED)
  // -------------------------------------------------------------------
  Widget _buildNavigationRail(BuildContext context, {required bool extended}) {
    return Container(
      width: extended ? 180 : 72,
      color: CyberColors.surfaceElevated.withValues(alpha: 0.9),
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        children: [
          // Cyber Node Identity Indicator
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              mainAxisAlignment:
                  extended ? MainAxisAlignment.start : MainAxisAlignment.center,
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: CyberColors.primary, width: 1.5),
                    color: CyberColors.primary.withValues(alpha: 0.1),
                  ),
                  child: const Center(
                    child: Icon(Icons.shield_outlined,
                        size: 16, color: CyberColors.primary),
                  ),
                ),
                if (extended) ...[
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                      'CST NODE',
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                        color: CyberColors.primary,
                        letterSpacing: 1.5,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 24),

          // Nav Items
          Expanded(
            child: ListView.builder(
              itemCount: navItems.length,
              itemBuilder: (context, index) {
                final item = navItems[index];
                final isSelected = selectedIndex == index;
                return Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  child: InkWell(
                    onTap: () => onIndexChanged(index),
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          vertical: 10, horizontal: 12),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? CyberColors.primary.withValues(alpha: 0.15)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(12),
                        border: isSelected
                            ? Border.all(
                                color:
                                    CyberColors.primary.withValues(alpha: 0.5))
                            : null,
                      ),
                      child: Row(
                        mainAxisAlignment: extended
                            ? MainAxisAlignment.start
                            : MainAxisAlignment.center,
                        children: [
                          Icon(
                            isSelected
                                ? (item.activeIcon ?? item.icon)
                                : item.icon,
                            size: 20,
                            color: isSelected
                                ? CyberColors.primary
                                : CyberColors.textSecondary,
                          ),
                          if (extended) ...[
                            const SizedBox(width: 12),
                            Text(
                              item.label,
                              style: TextStyle(
                                color: isSelected
                                    ? CyberColors.primary
                                    : CyberColors.textSecondary,
                                fontWeight: isSelected
                                    ? FontWeight.bold
                                    : FontWeight.normal,
                                fontSize: 13,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // TOP CYBER APP BAR
  // -------------------------------------------------------------------
  Widget _buildAppBar(BuildContext context,
      {required bool showNavIcon, String? subtitle}) {
    return Container(
      height: 52,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Colors.white10, width: 1)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: context.fluidFont(14),
                    fontWeight: FontWeight.bold,
                    letterSpacing: 2,
                    color: CyberColors.textPrimary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null)
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: context.fluidFont(9),
                      color: CyberColors.textSecondary,
                      letterSpacing: 1.2,
                    ),
                  ),
              ],
            ),
          ),
          if (actions != null) ...actions!,
        ],
      ),
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
    return RepaintBoundary(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(isDialog ? 24 : 28),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
          child: Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: CyberColors.surfaceElevated.withValues(alpha: 0.95),
              borderRadius: BorderRadius.circular(isDialog ? 24 : 28),
              border: Border.all(
                  color: CyberColors.accent.withValues(alpha: 0.6), width: 1.5),
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
                          color: CyberColors.accent.withValues(alpha: 0.2),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.warning_amber_rounded,
                            color: CyberColors.accent, size: 24),
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
                                color: CyberColors.accent,
                                letterSpacing: 1.5,
                              ),
                            ),
                            Text(
                              'Target: $hostName • Risk: $riskLevel',
                              style: TextStyle(
                                fontSize: context.fluidFont(11),
                                color: CyberColors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'PROPOSED SHELL COMMAND',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1.2,
                      color: CyberColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.6),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Colors.white12),
                    ),
                    child: SelectableText(
                      command,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        color: CyberColors.primary,
                        fontSize: 12,
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Agent Reasoning: $reasoning',
                    style: TextStyle(
                      fontSize: context.fluidFont(11),
                      color: CyberColors.textTertiary,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => Navigator.of(context).pop(false),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.white70,
                            side: const BorderSide(color: Colors.white24),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: const Text('REJECT'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () => Navigator.of(context).pop(true),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: CyberColors.accent,
                            foregroundColor: Colors.white,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            elevation: 8,
                            shadowColor:
                                CyberColors.accent.withValues(alpha: 0.5),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: const Text('AUTHORIZE',
                              style: TextStyle(fontWeight: FontWeight.bold)),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
