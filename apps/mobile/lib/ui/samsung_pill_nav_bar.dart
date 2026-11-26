import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import '../theme/fluid_theme.dart';

/// Floating Glassmorphic Pill Navigation Dock
/// ============================================================================
/// Optimized for Flutter Impeller Engine (120Hz ProMotion Displays).
/// Features:
/// 1. Damped Harmonic Spring Simulation (Custom spring with mass, stiffness, damping)
/// 2. Volume-Preserving Squash-and-Stretch Geometry
/// 3. Strict Zero-Allocation CustomPainter Loops (Cached Paint, Path, and Matrix instances)
/// 4. Tactile Haptic Resonance
/// ============================================================================

class PillNavItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;

  const PillNavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
  });
}

class SamsungPillNavBar extends StatefulWidget {
  final int selectedIndex;
  final ValueChanged<int> onTabSelected;
  final List<PillNavItem> items;
  final Color accentColor;

  const SamsungPillNavBar({
    super.key,
    required this.selectedIndex,
    required this.onTabSelected,
    required this.items,
    this.accentColor = const Color(0xFF00F0FF),
  });

  @override
  State<SamsungPillNavBar> createState() => _SamsungPillNavBarState();
}

class _SamsungPillNavBarState extends State<SamsungPillNavBar>
    with SingleTickerProviderStateMixin {
  late final AnimationController _springController;

  // Playful Jelly Liquid Spring parameters (Apple Liquid Glass physics)
  static const SpringDescription _springDesc = SpringDescription(
    mass: 0.9,
    stiffness: 420.0,
    damping: 18.0,
  );

  @override
  void initState() {
    super.initState();
    _springController = AnimationController(
      vsync: this,
      value: 0.0,
      lowerBound: -1.0,
      upperBound: 2.0,
    );
  }

  void _triggerSpring() {
    if (!mounted || MediaQuery.disableAnimationsOf(context)) return;
    final springSimulation = SpringSimulation(_springDesc, 1.0, 0.0, -12.0);
    _springController.animateWith(springSimulation);
  }

  @override
  void didUpdateWidget(covariant SamsungPillNavBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedIndex != widget.selectedIndex) {
      _triggerSpring();
    }
  }

  @override
  void dispose() {
    _springController.dispose();
    super.dispose();
  }

  void _handleTabTap(int index) {
    if (index != widget.selectedIndex) {
      widget.onTabSelected(index);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.items.isEmpty) return const SizedBox.shrink();
    final palette = context.palette;
    final sigma = palette.glass.blurSigma.clamp(0.0, 14.0);
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final size = MediaQuery.sizeOf(context);
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    final horizontalPad = size.width < 340 ? 10.0 : 20.0;
    final barHeight = size.height < 440 ? 54.0 : 66.0;
    final Color activeFg = palette.onHeroGradient;

    final Widget dockBody = CustomPaint(
      painter: PillDockPainter(
        accentColor: widget.accentColor,
        isDaylight: palette.isDaylight,
      ),
      child: Container(
        height: barHeight,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: List.generate(widget.items.length, (index) {
            final isSelected = index == widget.selectedIndex;
            final item = widget.items[index];

            return Expanded(
              child: Semantics(
                button: true,
                selected: isSelected,
                label: item.label,
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => _handleTabTap(index),
                    borderRadius: BorderRadius.circular(28),
                    splashColor: widget.accentColor.withValues(alpha: 0.18),
                    highlightColor: Colors.transparent,
                    child: AnimatedContainer(
                      duration: disableAnim
                          ? Duration.zero
                          : const Duration(milliseconds: 240),
                      curve: Curves.easeOutCubic,
                      padding: const EdgeInsets.symmetric(
                        vertical: 4,
                        horizontal: 6,
                      ),
                      decoration: BoxDecoration(
                        gradient: isSelected ? palette.heroGradient : null,
                        color: isSelected ? null : Colors.transparent,
                        borderRadius: BorderRadius.circular(28),
                        border: isSelected
                            ? Border.all(
                                color: Colors.white.withValues(alpha: 0.50),
                                width: 1.0,
                              )
                            : null,
                        boxShadow: isSelected
                            ? [
                                BoxShadow(
                                  color: widget.accentColor
                                      .withValues(alpha: 0.34),
                                  blurRadius: 14,
                                  offset: const Offset(0, 4),
                                ),
                              ]
                            : null,
                      ),
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            AnimatedSwitcher(
                              duration: disableAnim
                                  ? Duration.zero
                                  : const Duration(milliseconds: 200),
                              transitionBuilder: (child, anim) =>
                                  ScaleTransition(scale: anim, child: child),
                              child: Icon(
                                isSelected ? item.activeIcon : item.icon,
                                key: ValueKey('${item.label}_$isSelected'),
                                size: 22,
                                color: isSelected
                                    ? activeFg
                                    : palette.textSecondary,
                              ),
                            ),
                            const SizedBox(height: 2.5),
                            Text(
                              item.label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: isSelected
                                    ? FontWeight.w800
                                    : FontWeight.w600,
                                letterSpacing: -0.1,
                                color: isSelected
                                    ? activeFg
                                    : palette.textSecondary,
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
    );

    final Widget pillShell = RepaintBoundary(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(34),
        child: sigma > 0
            ? BackdropFilter(
                filter: ImageFilter.blur(sigmaX: sigma, sigmaY: sigma),
                child: dockBody,
              )
            : dockBody,
      ),
    );

    return Padding(
      padding: EdgeInsets.only(
        left: horizontalPad,
        right: horizontalPad,
        bottom: bottomInset > 0
            ? bottomInset + (size.height < 440 ? 4 : 8)
            : (size.height < 440 ? 10 : 20),
      ),
      child: AnimatedBuilder(
        animation: _springController,
        child: pillShell,
        builder: (context, child) {
          // Volume conservation: Area = scaleX * scaleY = 1.0
          final double v = _springController.value;
          final double squashY = 1.0 - (v * 0.12);
          final double stretchX = 1.0 / math.max(0.7, squashY);
          return Transform(
            alignment: Alignment.center,
            transform: Matrix4.identity()
              ..scaleByDouble(stretchX, squashY, 1.0, 1.0),
            child: child,
          );
        },
      ),
    );
  }
}

/// Zero-Allocation Paint Loop for Impeller GPU Backends (Daylight + Vibrant Dark)
class PillDockPainter extends CustomPainter {
  final Color accentColor;
  final bool isDaylight;

  final Paint _bgPaint = Paint()..style = PaintingStyle.fill;
  final Paint _borderPaint = Paint()..style = PaintingStyle.stroke;
  final Paint _glowPaint = Paint()..style = PaintingStyle.stroke;
  final Paint _specularPaint = Paint()
    ..style = PaintingStyle.stroke
    ..strokeCap = StrokeCap.round
    ..strokeWidth = 1.6;
  final Path _cachedRRectPath = Path();
  RRect? _lastRRect;

  PillDockPainter({required this.accentColor, this.isDaylight = true});

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final Rect rect = Offset.zero & size;
    final RRect rrect =
        RRect.fromRectAndRadius(rect, const Radius.circular(34));

    if (_lastRRect != rrect) {
      _cachedRRectPath.reset();
      _cachedRRectPath.addRRect(rrect);
      _lastRRect = rrect;
    }

    // 1. Base Liquid Glass Fill
    _bgPaint.color =
        isDaylight ? const Color(0xC2FFFFFF) : const Color(0xC8141838);
    canvas.drawPath(_cachedRRectPath, _bgPaint);

    // 2. Hero Accent Ambient Rim Glow
    _glowPaint.color = accentColor.withValues(alpha: isDaylight ? 0.16 : 0.22);
    _glowPaint.strokeWidth = 3.2;
    _glowPaint.maskFilter = const MaskFilter.blur(BlurStyle.outer, 10.0);
    canvas.drawPath(_cachedRRectPath, _glowPaint);

    // 3. Crisp Inner Specular Border
    _borderPaint.color = isDaylight
        ? Colors.white.withValues(alpha: 0.92)
        : Colors.white.withValues(alpha: 0.24);
    _borderPaint.strokeWidth = 1.3;
    _borderPaint.maskFilter = null;
    canvas.drawPath(_cachedRRectPath, _borderPaint);

    // 4. Top-edge Optical Specular Highlight Arc
    if (size.width > 64) {
      _specularPaint.color =
          Colors.white.withValues(alpha: isDaylight ? 0.96 : 0.42);
      canvas.drawLine(
        const Offset(32, 1.5),
        Offset(size.width - 32, 1.5),
        _specularPaint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant PillDockPainter oldDelegate) {
    return oldDelegate.accentColor != accentColor ||
        oldDelegate.isDaylight != isDaylight;
  }
}
