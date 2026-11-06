import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/material.dart';
import '../theme/fluid_theme.dart';

// =====================================================================
// VECTOR NEON NODE BADGE (RESOLUTION-INDEPENDENT & ANTI-ALIASED)
// =====================================================================
class CyberNodeBadgePainter extends CustomPainter {
  final bool isOnline;
  final double pulsePhase;

  CyberNodeBadgePainter({required this.isOnline, this.pulsePhase = 0.0});

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (size.width / 2) - 2.0;

    final baseColor = isOnline ? CyberColors.primary : Colors.grey;

    // Outer cyber hexagon / ring with explicit sub-pixel anti-aliasing
    final ringPaint = Paint()
      ..color = baseColor.withValues(alpha: isOnline ? 0.35 : 0.15)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..isAntiAlias = true
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, ringPaint);

    if (isOnline) {
      // Outer glow pulse
      final glowPaint = Paint()
        ..color = CyberColors.primary
            .withValues(alpha: 0.15 + (math.sin(pulsePhase) * 0.1).abs())
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.0
        ..isAntiAlias = true
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3.0);
      canvas.drawCircle(center, radius - 1, glowPaint);
    }

    // Inner solid core node
    final corePaint = Paint()
      ..color = isOnline ? CyberColors.primary : Colors.grey.shade600
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    canvas.drawCircle(center, radius * 0.45, corePaint);
  }

  @override
  bool shouldRepaint(covariant CyberNodeBadgePainter oldDelegate) {
    return oldDelegate.isOnline != isOnline ||
        oldDelegate.pulsePhase != pulsePhase;
  }
}

// =====================================================================
// RESPONSIVE GLASSMORPHIC DEVICE CARD
// =====================================================================
// RESPONSIVE GLASSMORPHIC DEVICE CARD WITH BUBBLY SPRING PHYSICS
// =====================================================================
class ResponsiveDeviceCard extends StatefulWidget {
  final String id;
  final String name;
  final String ip;
  final String mac;
  final bool isOnline;
  final int cpuUsage;
  final int ramUsage;
  final bool isSelected;
  final VoidCallback? onTap;
  final VoidCallback? onWakeOnLan;
  final VoidCallback? onOpenStream;

  const ResponsiveDeviceCard({
    super.key,
    required this.id,
    required this.name,
    required this.ip,
    required this.mac,
    required this.isOnline,
    this.cpuUsage = 0,
    this.ramUsage = 0,
    this.isSelected = false,
    this.onTap,
    this.onWakeOnLan,
    this.onOpenStream,
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
      duration: const Duration(milliseconds: 220),
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
    _scaleController.forward();
  }

  void _onTapUp(TapUpDetails details) {
    _scaleController.reverse();
  }

  void _onTapCancel() {
    _scaleController.reverse();
  }

  @override
  Widget build(BuildContext context) {
    final isOnline = widget.isOnline;
    final isSelected = widget.isSelected;

    return RepaintBoundary(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 5.0),
        child: GestureDetector(
          onTapDown: _onTapDown,
          onTapUp: _onTapUp,
          onTapCancel: _onTapCancel,
          onTap: widget.onTap,
          child: ScaleTransition(
            scale: _scaleAnimation,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(22.0),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 24.0, sigmaY: 24.0),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 280),
                  curve: Curves.easeOutCubic,
                  padding: const EdgeInsets.all(16.0),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: isSelected
                          ? [
                              CyberColors.primary.withValues(alpha: 0.20),
                              CyberColors.surfaceElevated
                                  .withValues(alpha: 0.82),
                            ]
                          : [
                              Colors.white.withValues(alpha: 0.08),
                              CyberColors.surfaceElevated
                                  .withValues(alpha: 0.68),
                            ],
                    ),
                    borderRadius: BorderRadius.circular(22.0),
                    border: Border.all(
                      color: isSelected
                          ? CyberColors.primary.withValues(alpha: 0.75)
                          : (isOnline
                              ? Colors.white.withValues(alpha: 0.16)
                              : Colors.white.withValues(alpha: 0.07)),
                      width: isSelected ? 1.6 : 1.0,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: isSelected
                            ? CyberColors.primary.withValues(alpha: 0.25)
                            : Colors.black.withValues(alpha: 0.45),
                        blurRadius: isSelected ? 22 : 16,
                        offset: const Offset(0, 6),
                      ),
                    ],
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Header Row: Node indicator, Name, Clean Unboxed Metadata & Action Orb
                      Row(
                        children: [
                          Container(
                            width: 38,
                            height: 38,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(13),
                              color: isOnline
                                  ? CyberColors.primary.withValues(alpha: 0.12)
                                  : Colors.white.withValues(alpha: 0.04),
                              border: Border.all(
                                color: isOnline
                                    ? CyberColors.primary
                                        .withValues(alpha: 0.35)
                                    : Colors.white.withValues(alpha: 0.08),
                              ),
                            ),
                            child: Center(
                              child: CustomPaint(
                                size: const Size(20, 20),
                                painter:
                                    CyberNodeBadgePainter(isOnline: isOnline),
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  widget.name,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: context.fluidFont(14),
                                    color: CyberColors.textPrimary,
                                    letterSpacing: -0.2,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  '${widget.ip} · ${isOnline ? "Online" : "Sleeping"}',
                                  style: TextStyle(
                                    fontSize: context.fluidFont(11),
                                    color: isOnline
                                        ? CyberColors.primary
                                            .withValues(alpha: 0.85)
                                        : CyberColors.textSecondary,
                                    fontFamily: 'monospace',
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),

                          // Quick Action Orb (44x44px touch target)
                          if (isOnline && widget.onOpenStream != null)
                            Container(
                              width: 44,
                              height: 44,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color:
                                    CyberColors.primary.withValues(alpha: 0.12),
                                border: Border.all(
                                  color: CyberColors.primary
                                      .withValues(alpha: 0.35),
                                ),
                              ),
                              child: IconButton(
                                tooltip: 'Open Live Stream',
                                icon: const Icon(Icons.videocam_rounded,
                                    size: 19),
                                color: CyberColors.primary,
                                padding: EdgeInsets.zero,
                                onPressed: widget.onOpenStream,
                              ),
                            )
                          else if (!isOnline && widget.onWakeOnLan != null)
                            Container(
                              width: 44,
                              height: 44,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color:
                                    CyberColors.warning.withValues(alpha: 0.14),
                                border: Border.all(
                                  color: CyberColors.warning
                                      .withValues(alpha: 0.4),
                                ),
                              ),
                              child: IconButton(
                                tooltip: 'Send Wake-on-LAN Magic Packet',
                                icon: const Icon(Icons.bolt_rounded, size: 19),
                                color: CyberColors.warning,
                                padding: EdgeInsets.zero,
                                onPressed: widget.onWakeOnLan,
                              ),
                            ),
                        ],
                      ),

                      // Smooth Animated Telemetry Gauges when host is Online
                      AnimatedSize(
                        duration: const Duration(milliseconds: 260),
                        curve: Curves.easeOutCubic,
                        child: isOnline
                            ? Padding(
                                padding: const EdgeInsets.only(top: 12.0),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: _buildMiniTelemetryBar(
                                        context: context,
                                        label: 'CPU',
                                        value: widget.cpuUsage,
                                        color: widget.cpuUsage > 80
                                            ? CyberColors.accent
                                            : CyberColors.primary,
                                      ),
                                    ),
                                    const SizedBox(width: 14),
                                    Expanded(
                                      child: _buildMiniTelemetryBar(
                                        context: context,
                                        label: 'RAM',
                                        value: widget.ramUsage,
                                        color: widget.ramUsage > 85
                                            ? CyberColors.warning
                                            : CyberColors.secondary,
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
        ),
      ),
    );
  }

  Widget _buildMiniTelemetryBar({
    required BuildContext context,
    required String label,
    required int value,
    required Color color,
  }) {
    final clampedPercent = (value / 100.0).clamp(0.0, 1.0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: context.fluidFont(9),
                fontWeight: FontWeight.w600,
                color: CyberColors.textSecondary,
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
              duration: const Duration(milliseconds: 520),
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
                          color: color.withValues(alpha: 0.6),
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
