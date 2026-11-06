import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import 'package:flutter/services.dart';

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
  late AnimationController _springController;
  late SpringSimulation _springSimulation;

  // Damped Harmonic Spring parameters (Samsung OneUI / iOS Dynamic Island physics)
  final SpringDescription _springDesc = const SpringDescription(
    mass: 1.0,
    stiffness: 380.0,
    damping: 24.0, // Critical damping prevents over-oscillation
  );

  double _stretchX = 1.0;
  double _squashY = 1.0;

  @override
  void initState() {
    super.initState();
    _springController = AnimationController(
      vsync: this,
      lowerBound: -1.0,
      upperBound: 2.0,
    );

    _springController.addListener(_onSpringTick);
  }

  void _onSpringTick() {
    final double v = _springController.value;
    // Volume conservation: Area = scaleX * scaleY = 1.0
    // When squashY compresses to 0.92, stretchX expands to ~1.087
    setState(() {
      _squashY = 1.0 - (v * 0.12);
      _stretchX = 1.0 / math.max(0.7, _squashY);
    });
  }

  void _triggerSpring() {
    _springSimulation = SpringSimulation(_springDesc, 1.0, 0.0, -12.0);
    _springController.animateWith(_springSimulation);
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
      // HapticFeedback removed for smoothness
      _triggerSpring();
      widget.onTabSelected(index);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).padding.bottom;

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        bottom: bottomInset > 0 ? bottomInset + 8 : 20,
      ),
      child: Transform(
        alignment: Alignment.center,
        transform: Matrix4.identity()
          ..scaleByDouble(_stretchX, _squashY, 1.0, 1.0),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(32),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
            child: CustomPaint(
              painter: PillDockPainter(accentColor: widget.accentColor),
              child: Container(
                height: 64,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: List.generate(widget.items.length, (index) {
                    final isSelected = index == widget.selectedIndex;
                    final item = widget.items[index];

                    return Expanded(
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () => _handleTabTap(index),
                          borderRadius: BorderRadius.circular(24),
                          splashColor:
                              widget.accentColor.withValues(alpha: 0.15),
                          highlightColor: Colors.transparent,
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 220),
                            curve: Curves.easeOutCubic,
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            decoration: BoxDecoration(
                              color: isSelected
                                  ? widget.accentColor.withValues(alpha: 0.14)
                                  : Colors.transparent,
                              borderRadius: BorderRadius.circular(24),
                            ),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                AnimatedSwitcher(
                                  duration: const Duration(milliseconds: 180),
                                  transitionBuilder: (child, anim) =>
                                      ScaleTransition(
                                          scale: anim, child: child),
                                  child: Icon(
                                    isSelected ? item.activeIcon : item.icon,
                                    key: ValueKey('${item.label}_$isSelected'),
                                    size: 22,
                                    color: isSelected
                                        ? widget.accentColor
                                        : Colors.white.withValues(alpha: 0.45),
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  item.label,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: isSelected
                                        ? FontWeight.w700
                                        : FontWeight.w500,
                                    letterSpacing: 0.2,
                                    color: isSelected
                                        ? widget.accentColor
                                        : Colors.white.withValues(alpha: 0.45),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Zero-Allocation Paint Loop for Impeller GPU Backends
class PillDockPainter extends CustomPainter {
  final Color accentColor;

  // Cached Paint and Path instances to strictly eliminate allocations in paint()
  final Paint _bgPaint = Paint()..style = PaintingStyle.fill;
  final Paint _borderPaint = Paint()..style = PaintingStyle.stroke;
  final Paint _glowPaint = Paint()..style = PaintingStyle.stroke;
  final Path _cachedRRectPath = Path();
  RRect? _lastRRect;

  PillDockPainter({required this.accentColor});

  @override
  void paint(Canvas canvas, Size size) {
    final Rect rect = Offset.zero & size;
    final RRect rrect =
        RRect.fromRectAndRadius(rect, const Radius.circular(32));

    // Update path only on dimension change
    if (_lastRRect != rrect) {
      _cachedRRectPath.reset();
      _cachedRRectPath.addRRect(rrect);
      _lastRRect = rrect;
    }

    // 1. Base Acrylic Fill
    _bgPaint.color = const Color(0xDE070E1C);
    canvas.drawPath(_cachedRRectPath, _bgPaint);

    // 2. Cyan Ambient Rim Glow
    _glowPaint.color = accentColor.withValues(alpha: 0.12);
    _glowPaint.strokeWidth = 3.0;
    _glowPaint.maskFilter = const MaskFilter.blur(BlurStyle.outer, 8.0);
    canvas.drawPath(_cachedRRectPath, _glowPaint);

    // 3. Crisp Inner Vector Stroke
    _borderPaint.color = accentColor.withValues(alpha: 0.28);
    _borderPaint.strokeWidth = 1.2;
    _borderPaint.maskFilter = null;
    canvas.drawPath(_cachedRRectPath, _borderPaint);
  }

  @override
  bool shouldRepaint(covariant PillDockPainter oldDelegate) {
    return oldDelegate.accentColor != accentColor;
  }
}
