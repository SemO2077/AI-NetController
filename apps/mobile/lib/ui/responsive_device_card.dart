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
      ..color = baseColor.withValues(alpha: isOnline ? 0.35 : 0.15)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..isAntiAlias = true
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, ringPaint);

    if (isOnline) {
      final glowPaint = Paint()
        ..color = activeColor
            .withValues(alpha: 0.16 + (math.sin(pulsePhase) * 0.1).abs())
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.8
        ..isAntiAlias = true
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2.5);
      canvas.drawCircle(center, radius - 1, glowPaint);
    }

    final corePaint = Paint()
      ..color = isOnline ? activeColor : Colors.grey.shade600
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    canvas.drawCircle(center, radius * 0.45, corePaint);
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
      duration: const Duration(milliseconds: 180),
    );

    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.96).animate(
      CurvedAnimation(
        parent: _scaleController,
        curve: Curves.easeOutCubic,
        reverseCurve: Curves.easeOutCubic,
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
            child: AnimatedContainer(
              duration: animDuration,
              curve: Curves.easeOutCubic,
              padding: const EdgeInsets.all(15.0),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: isSelected
                      ? [
                          palette.primary.withValues(alpha: 0.22),
                          palette.cardSurfaceBottom,
                        ]
                      : [
                          palette.cardSurfaceTop,
                          palette.cardSurfaceBottom,
                        ],
                ),
                borderRadius: BorderRadius.circular(22.0),
                border: Border.all(
                  color: isSelected
                      ? palette.primary.withValues(alpha: 0.78)
                      : (isOnline
                          ? Colors.white.withValues(alpha: 0.16)
                          : palette.glassBorderIdle),
                  width: isSelected ? 1.6 : 1.0,
                ),
                boxShadow: [
                  BoxShadow(
                    color: isSelected
                        ? palette.primary.withValues(alpha: 0.22)
                        : Colors.black.withValues(alpha: 0.38),
                    blurRadius: isSelected ? 18 : 12,
                    offset: const Offset(0, 5),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 38,
                        height: 38,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(12),
                          color: isOnline
                              ? palette.primary.withValues(alpha: 0.14)
                              : Colors.white.withValues(alpha: 0.04),
                          border: Border.all(
                            color: isOnline
                                ? palette.primary.withValues(alpha: 0.38)
                                : Colors.white.withValues(alpha: 0.08),
                          ),
                        ),
                        child: Center(
                          child: CustomPaint(
                            size: const Size(20, 20),
                            painter: CyberNodeBadgePainter(
                              isOnline: isOnline,
                              activeColor: palette.primary,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              widget.name,
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: context.fluidFont(14),
                                color: palette.textPrimary,
                                letterSpacing: -0.2,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 3),
                            Text(
                              statusParts.join(' · '),
                              style: TextStyle(
                                fontSize: context.fluidFont(11),
                                color: isOnline
                                    ? palette.primary.withValues(alpha: 0.90)
                                    : palette.textSecondary,
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
                          color: palette.primary,
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
                        const SizedBox(width: 4),
                        IconButton(
                          tooltip: 'Workstation options',
                          icon: Icon(
                            Icons.more_vert_rounded,
                            size: 18,
                            color: palette.textSecondary,
                          ),
                          constraints: const BoxConstraints(
                            minWidth: 32,
                            minHeight: 36,
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
                            padding: const EdgeInsets.only(top: 12.0),
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
                                const SizedBox(width: 14),
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
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: Container(
            height: 4,
            width: double.infinity,
            color: Colors.white.withValues(alpha: 0.08),
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
                      color: color,
                      boxShadow: [
                        BoxShadow(
                          color: color.withValues(alpha: 0.55),
                          blurRadius: 5,
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
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color.withValues(alpha: 0.14),
        border: Border.all(color: color.withValues(alpha: 0.38)),
      ),
      child: IconButton(
        tooltip: tooltip,
        icon: Icon(icon, size: 19),
        color: color,
        padding: EdgeInsets.zero,
        onPressed: onPressed,
      ),
    );
  }
}
