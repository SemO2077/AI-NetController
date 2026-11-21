import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../theme/fluid_theme.dart';

// =====================================================================
// VECTOR NEON NODE BADGE (RESOLUTION-INDEPENDENT & ANTI-ALIASED)
// =====================================================================
class CyberNodeBadgePainter extends CustomPainter {
  final bool isOnline;
  final double pulsePhase;
  final Color activeColor;

  CyberNodeBadgePainter({
    required this.isOnline,
    this.pulsePhase = 0.0,
    this.activeColor = CyberColors.primary,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width / 2) - 2.0;

    final baseColor = isOnline ? activeColor : Colors.grey;

    final ringPaint = Paint()
      ..color = baseColor.withValues(alpha: isOnline ? 0.38 : 0.16)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..isAntiAlias = true
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, ringPaint);

    // Subtle 4-quadrant tech ticks for 3D instrument depth
    final tickPaint = Paint()
      ..color = baseColor.withValues(alpha: isOnline ? 0.65 : 0.22)
      ..strokeWidth = 1.2
      ..strokeCap = StrokeCap.round;
    for (int i = 0; i < 4; i++) {
      final angle = (i * math.pi / 2) + (pulsePhase * 0.25);
      final inner = Offset(
        center.dx + math.cos(angle) * (radius - 2.2),
        center.dy + math.sin(angle) * (radius - 2.2),
      );
      final outer = Offset(
        center.dx + math.cos(angle) * (radius + 0.6),
        center.dy + math.sin(angle) * (radius + 0.6),
      );
      canvas.drawLine(inner, outer, tickPaint);
    }

    if (isOnline) {
      final glowPaint = Paint()
        ..color = activeColor
            .withValues(alpha: 0.20 + (math.sin(pulsePhase) * 0.1).abs())
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.8
        ..isAntiAlias = true
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2.8);
      canvas.drawCircle(center, radius - 1, glowPaint);
    }

    final coreRadius = radius * 0.46;
    final coreRect = Rect.fromCircle(center: center, radius: coreRadius);
    final corePaint = Paint()
      ..shader = RadialGradient(
        center: const Alignment(-0.3, -0.3),
        radius: 0.95,
        colors: isOnline
            ? [
                Colors.white.withValues(alpha: 0.90),
                activeColor,
                Color.lerp(activeColor, Colors.black, 0.35)!,
              ]
            : [
                Colors.grey.shade400,
                Colors.grey.shade700,
              ],
      ).createShader(coreRect)
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    canvas.drawCircle(center, coreRadius, corePaint);
  }

  @override
  bool shouldRepaint(covariant CyberNodeBadgePainter oldDelegate) {
    return oldDelegate.isOnline != isOnline ||
        oldDelegate.pulsePhase != pulsePhase ||
        oldDelegate.activeColor != activeColor;
  }
}

// =====================================================================
// RESPONSIVE GLASSMORPHIC DEVICE CARD (GPU-FRIENDLY OVERDRAW FREE)
// =====================================================================
class ResponsiveDeviceCard extends StatefulWidget {
  final String id;
  final String name;
  final String ip;
  final String mac;
  final bool isOnline;
  final int cpuUsage;
  final int ramUsage;
  final int? latencyMs;
  final bool isSelected;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final VoidCallback? onWakeOnLan;
  final VoidCallback? onOpenStream;
  final VoidCallback? onMoreActions;

  const ResponsiveDeviceCard({
    super.key,
    required this.id,
    required this.name,
    required this.ip,
    required this.mac,
    required this.isOnline,
    this.cpuUsage = 0,
    this.ramUsage = 0,
    this.latencyMs,
    this.isSelected = false,
    this.onTap,
    this.onLongPress,
    this.onWakeOnLan,
    this.onOpenStream,
    this.onMoreActions,
  });

  @override
  State<ResponsiveDeviceCard> createState() => _ResponsiveDeviceCardState();
}

class _ResponsiveDeviceCardState extends State<ResponsiveDeviceCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _scaleController;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _scaleController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 210),
    );

    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.94).animate(
      CurvedAnimation(
        parent: _scaleController,
        curve: Curves.easeOutCubic,
        reverseCurve: Curves.elasticOut,
      ),
    );
  }

  @override
  void dispose() {
    _scaleController.dispose();
    super.dispose();
  }

  void _onTapDown(TapDownDetails details) {
    if (!MediaQuery.disableAnimationsOf(context)) {
      _scaleController.forward();
    }
  }

  void _onTapUp(TapUpDetails details) {
    if (!MediaQuery.disableAnimationsOf(context)) {
      _scaleController.reverse();
    }
  }

  void _onTapCancel() {
    if (!MediaQuery.disableAnimationsOf(context)) {
      _scaleController.reverse();
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final isOnline = widget.isOnline;
    final isSelected = widget.isSelected;
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final animDuration =
        disableAnim ? Duration.zero : const Duration(milliseconds: 240);

    final statusParts = <String>[
      widget.ip,
      isOnline ? 'Online' : 'Sleeping',
      if (isOnline && widget.latencyMs != null && widget.latencyMs! > 0)
        '${widget.latencyMs}ms',
    ];

    return RepaintBoundary(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 5.0),
        child: GestureDetector(
          onTapDown: _onTapDown,
          onTapUp: _onTapUp,
          onTapCancel: _onTapCancel,
          onTap: widget.onTap,
          onLongPress: widget.onLongPress,
          child: ScaleTransition(
            scale: _scaleAnimation,
            child: LayoutBuilder(
              builder: (context, constraints) {
                final isCompactCard =
                    constraints.maxWidth.isFinite && constraints.maxWidth < 290;
                final hPad = isCompactCard ? 11.0 : 15.0;
                return AnimatedContainer(
                  duration: animDuration,
                  curve: Curves.easeOutCubic,
                  padding: EdgeInsets.fromLTRB(
                    hPad,
                    isCompactCard ? 10.0 : 12.0,
                    hPad,
                    isCompactCard ? 14.0 : 16.0,
                  ),
                  decoration: BoxDecoration(
                    gradient: palette.cardBevelGradient(isSelected: isSelected),
                    borderRadius: BorderRadius.circular(26.0),
                    border: Border.all(
                      color: isSelected
                          ? palette.primary.withValues(alpha: 0.85)
                          : palette.glassBorderIdle,
                      width: isSelected ? 1.8 : 1.15,
                    ),
                    boxShadow: palette.elevationShadows(
                      isSelected: isSelected,
                      glowColor: isOnline ? palette.primary : Colors.black,
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      FluidSpecularBar(
                        isSelected: isSelected || isOnline,
                        height: 1.2,
                        margin: const EdgeInsets.only(
                          left: 8,
                          right: 8,
                          bottom: 10,
                        ),
                      ),
                      Row(
                        children: [
                          Container(
                            width: isCompactCard ? 38 : 44,
                            height: isCompactCard ? 38 : 44,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(15),
                              gradient: isOnline
                                  ? palette.heroGradient
                                  : const LinearGradient(
                                      begin: Alignment.topLeft,
                                      end: Alignment.bottomRight,
                                      colors: [
                                        Color(0xFF64748B),
                                        Color(0xFF94A3B8),
                                      ],
                                    ),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.55),
                                width: 1.0,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: (isOnline
                                          ? palette.primary
                                          : const Color(0xFF64748B))
                                      .withValues(alpha: 0.34),
                                  blurRadius: 12,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Center(
                              child: CustomPaint(
                                size: Size(
                                  isCompactCard ? 18 : 22,
                                  isCompactCard ? 18 : 22,
                                ),
                                painter: CyberNodeBadgePainter(
                                  isOnline: isOnline,
                                  activeColor: Colors.white,
                                ),
                              ),
                            ),
                          ),
                          SizedBox(width: isCompactCard ? 10 : 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  widget.name,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: context.fluidFont(14.5),
                                    color: palette.textPrimary,
                                    letterSpacing: -0.3,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  statusParts.join(' · '),
                                  style: TextStyle(
                                    fontSize: context.fluidFont(11),
                                    fontWeight: FontWeight.w600,
                                    color: isOnline
                                        ? palette.success
                                        : palette.warning,
                                    fontFamily: 'monospace',
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          if (isOnline && widget.onOpenStream != null)
                            _ActionOrbButton(
                              tooltip: 'Open Live Stream',
                              icon: Icons.videocam_rounded,
                              color: palette.sky,
                              onPressed: widget.onOpenStream!,
                            )
                          else if (!isOnline && widget.onWakeOnLan != null)
                            _ActionOrbButton(
                              tooltip: 'Send Wake-on-LAN Magic Packet',
                              icon: Icons.bolt_rounded,
                              color: palette.warning,
                              onPressed: widget.onWakeOnLan!,
                            ),
                          if (widget.onMoreActions != null) ...[
                            const SizedBox(width: 2),
                            IconButton(
                              tooltip: 'Workstation options',
                              icon: Icon(
                                Icons.more_vert_rounded,
                                size: 18,
                                color: palette.textSecondary,
                              ),
                              constraints: const BoxConstraints(
                                minWidth: 28,
                                minHeight: 34,
                              ),
                              padding: EdgeInsets.zero,
                              onPressed: widget.onMoreActions,
                            ),
                          ],
                        ],
                      ),
                      AnimatedSize(
                        duration: animDuration,
                        curve: Curves.easeOutCubic,
                        child: isOnline
                            ? Padding(
                                padding: EdgeInsets.only(
                                    top: isCompactCard ? 9.0 : 12.0),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: _buildMiniTelemetryBar(
                                        context: context,
                                        palette: palette,
                                        label: 'CPU',
                                        value: widget.cpuUsage,
                                        color: widget.cpuUsage > 80
                                            ? palette.accent
                                            : palette.primary,
                                        duration: disableAnim
                                            ? Duration.zero
                                            : const Duration(milliseconds: 420),
                                      ),
                                    ),
                                    SizedBox(width: isCompactCard ? 8 : 14),
                                    Expanded(
                                      child: _buildMiniTelemetryBar(
                                        context: context,
                                        palette: palette,
                                        label: 'RAM',
                                        value: widget.ramUsage,
                                        color: widget.ramUsage > 85
                                            ? palette.warning
                                            : palette.secondary,
                                        duration: disableAnim
                                            ? Duration.zero
                                            : const Duration(milliseconds: 420),
                                      ),
                                    ),
                                  ],
                                ),
                              )
                            : const SizedBox.shrink(),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMiniTelemetryBar({
    required BuildContext context,
    required CyberPalette palette,
    required String label,
    required int value,
    required Color color,
    required Duration duration,
  }) {
    final clampedPercent = (value / 100.0).clamp(0.0, 1.0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: context.fluidFont(9),
                fontWeight: FontWeight.w600,
                color: palette.textSecondary,
                letterSpacing: 0.8,
              ),
            ),
            Text(
              '$value%',
              style: TextStyle(
                fontSize: context.fluidFont(9),
                fontFamily: 'monospace',
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(5),
          child: Container(
            height: 5,
            width: double.infinity,
            decoration: BoxDecoration(
              color: palette.isDaylight
                  ? palette.primary.withValues(alpha: 0.12)
                  : Colors.white.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(5),
            ),
            child: TweenAnimationBuilder<double>(
              tween: Tween<double>(begin: 0.0, end: clampedPercent),
              duration: duration,
              curve: Curves.easeOutCubic,
              builder: (context, animatedFactor, _) {
                return FractionallySizedBox(
                  alignment: Alignment.centerLeft,
                  widthFactor: animatedFactor,
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.centerLeft,
                        end: Alignment.centerRight,
                        colors: [
                          color.withValues(alpha: 0.65),
                          color,
                          Color.lerp(color, Colors.white, 0.28)!,
                        ],
                      ),
                      borderRadius: BorderRadius.circular(5),
                      boxShadow: [
                        BoxShadow(
                          color: color.withValues(alpha: 0.60),
                          blurRadius: 6,
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }
}

class _ActionOrbButton extends StatelessWidget {
  final String tooltip;
  final IconData icon;
  final Color color;
  final VoidCallback onPressed;

  const _ActionOrbButton({
    required this.tooltip,
    required this.icon,
    required this.color,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return FluidPressScale(
      pressedScale: 0.92,
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            center: const Alignment(-0.25, -0.25),
            radius: 0.95,
            colors: [
              color.withValues(alpha: 0.26),
              color.withValues(alpha: 0.10),
            ],
          ),
          border: Border.all(color: color.withValues(alpha: 0.45)),
          boxShadow: [
            BoxShadow(
              color: color.withValues(alpha: 0.24),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: IconButton(
          tooltip: tooltip,
          icon: Icon(icon, size: 19),
          color: color,
          padding: EdgeInsets.zero,
          onPressed: onPressed,
        ),
      ),
    );
  }
}
