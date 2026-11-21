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
  final bool useTls;
  final String? connectionStatusLabel;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final VoidCallback? onWakeOnLan;
  final VoidCallback? onOpenStream;
  final VoidCallback? onOpenFullscreen;
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
    this.useTls = false,
    this.connectionStatusLabel,
    this.onTap,
    this.onLongPress,
    this.onWakeOnLan,
    this.onOpenStream,
    this.onOpenFullscreen,
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

    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.96).animate(
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

  Color _latencyColor(CyberPalette palette, int ms) {
    if (ms <= 30) return palette.success;
    if (ms <= 80) return palette.sky;
    return palette.warning;
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final isOnline = widget.isOnline;
    final isSelected = widget.isSelected;
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final animDuration =
        disableAnim ? Duration.zero : const Duration(milliseconds: 240);
    final VoidCallback? openControlCallback =
        widget.onOpenFullscreen ?? widget.onOpenStream;
    final String statusLabel = widget.connectionStatusLabel ??
        (isOnline ? 'Online' : 'Sleeping');

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
                final bool isCompactCard =
                    constraints.maxWidth.isFinite && constraints.maxWidth < 290;
                final bool isTightHeight = constraints.maxHeight.isFinite &&
                    constraints.maxHeight < (isOnline ? 184.0 : 148.0);
                final bool showFullOnlineCta =
                    isOnline && openControlCallback != null && !isTightHeight;
                final bool showFullOfflineCta = !isOnline &&
                    widget.onWakeOnLan != null &&
                    !isTightHeight;
                final double hPad = isCompactCard ? 11.0 : 15.0;

                return AnimatedContainer(
                  duration: animDuration,
                  curve: Curves.easeOutCubic,
                  padding: EdgeInsets.fromLTRB(
                    hPad,
                    isTightHeight ? 8.0 : (isCompactCard ? 10.0 : 12.0),
                    hPad,
                    isTightHeight ? 10.0 : (isCompactCard ? 12.0 : 14.0),
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
                        margin: EdgeInsets.only(
                          left: 8,
                          right: 8,
                          bottom: isTightHeight ? 6 : 9,
                        ),
                      ),
                      Row(
                        children: [
                          Container(
                            width: isCompactCard ? 36 : 42,
                            height: isCompactCard ? 36 : 42,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(14),
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
                                  isCompactCard ? 17 : 21,
                                  isCompactCard ? 17 : 21,
                                ),
                                painter: CyberNodeBadgePainter(
                                  isOnline: isOnline,
                                  activeColor: Colors.white,
                                ),
                              ),
                            ),
                          ),
                          SizedBox(width: isCompactCard ? 9 : 11),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  widget.name,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: context.fluidFont(14.0),
                                    color: palette.textPrimary,
                                    letterSpacing: -0.3,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 3),
                                _buildStatusPillsRow(
                                  context: context,
                                  palette: palette,
                                  statusLabel: statusLabel,
                                  isCompact: isCompactCard || isTightHeight,
                                ),
                              ],
                            ),
                          ),
                          if (isOnline &&
                              openControlCallback != null &&
                              !showFullOnlineCta)
                            _ActionOrbButton(
                              key: ValueKey(
                                'device-card-touch-cta-${widget.id}',
                              ),
                              tooltip: 'Fullscreen Touchscreen Control',
                              icon: Icons.touch_app_rounded,
                              color: palette.primary,
                              onPressed: openControlCallback,
                            )
                          else if (!isOnline &&
                              widget.onWakeOnLan != null &&
                              !showFullOfflineCta)
                            _ActionOrbButton(
                              key: ValueKey('device-card-wol-cta-${widget.id}'),
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
                                  top: isTightHeight
                                      ? 7.0
                                      : (isCompactCard ? 8.0 : 10.0),
                                ),
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
                      if (showFullOnlineCta) ...[
                        SizedBox(height: isCompactCard ? 9.0 : 11.0),
                        _buildPrimaryTouchCta(
                          context: context,
                          palette: palette,
                          isCompact: isCompactCard,
                          onPressed: openControlCallback,
                        ),
                      ] else if (showFullOfflineCta) ...[
                        SizedBox(height: isCompactCard ? 8.0 : 10.0),
                        _buildWakeQuickAction(
                          context: context,
                          palette: palette,
                          isCompact: isCompactCard,
                          onPressed: widget.onWakeOnLan!,
                        ),
                      ],
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

  Widget _buildStatusPillsRow({
    required BuildContext context,
    required CyberPalette palette,
    required String statusLabel,
    required bool isCompact,
  }) {
    final bool isOnline = widget.isOnline;
    final Color statusColor = isOnline ? palette.success : palette.warning;
    final int? latency = widget.latencyMs;

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const NeverScrollableScrollPhysics(),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Live status dot pill
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
            decoration: BoxDecoration(
              color: statusColor.withValues(
                alpha: palette.isDaylight ? 0.13 : 0.18,
              ),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: statusColor.withValues(alpha: 0.42)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 5.5,
                  height: 5.5,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: statusColor,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  statusLabel,
                  style: TextStyle(
                    fontSize: context.fluidFont(9.5),
                    fontWeight: FontWeight.w700,
                    color: statusColor,
                    letterSpacing: 0.2,
                  ),
                ),
              ],
            ),
          ),
          if (isOnline && latency != null && latency > 0) ...[
            const SizedBox(width: 5),
            Builder(
              builder: (_) {
                final Color latColor = _latencyColor(palette, latency);
                return Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                  decoration: BoxDecoration(
                    color: latColor.withValues(
                      alpha: palette.isDaylight ? 0.10 : 0.16,
                    ),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: latColor.withValues(alpha: 0.35)),
                  ),
                  child: Text(
                    '${latency}ms',
                    style: TextStyle(
                      fontSize: context.fluidFont(9.5),
                      fontWeight: FontWeight.w700,
                      fontFamily: 'monospace',
                      color: latColor,
                    ),
                  ),
                );
              },
            ),
          ],
          if (widget.useTls && !isCompact) ...[
            const SizedBox(width: 5),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
              decoration: BoxDecoration(
                color: palette.primary.withValues(
                  alpha: palette.isDaylight ? 0.10 : 0.16,
                ),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: palette.primary.withValues(alpha: 0.32),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.lock_rounded, size: 9, color: palette.primary),
                  const SizedBox(width: 2),
                  Text(
                    'TLS',
                    style: TextStyle(
                      fontSize: context.fluidFont(8.5),
                      fontWeight: FontWeight.w700,
                      fontFamily: 'monospace',
                      color: palette.primary,
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(width: 6),
          Text(
            widget.ip,
            style: TextStyle(
              fontSize: context.fluidFont(10.0),
              fontWeight: FontWeight.w600,
              color: palette.textSecondary,
              fontFamily: 'monospace',
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _buildPrimaryTouchCta({
    required BuildContext context,
    required CyberPalette palette,
    required bool isCompact,
    required VoidCallback onPressed,
  }) {
    return Semantics(
      button: true,
      label: 'Open Fullscreen Touchscreen Control for ${widget.name}',
      child: FluidPressScale(
        pressedScale: 0.96,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            key: ValueKey('device-card-touch-cta-${widget.id}'),
            onTap: onPressed,
            borderRadius: BorderRadius.circular(14),
            child: Ink(
              padding: EdgeInsets.symmetric(
                horizontal: isCompact ? 10 : 12,
                vertical: isCompact ? 7 : 8.5,
              ),
              decoration: BoxDecoration(
                gradient: palette.heroGradient,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.45),
                  width: 1.0,
                ),
                boxShadow: [
                  BoxShadow(
                    color: palette.primary.withValues(alpha: 0.30),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.touch_app_rounded,
                    size: 16,
                    color: Colors.white,
                  ),
                  const SizedBox(width: 7),
                  Flexible(
                    child: Text(
                      isCompact
                          ? 'Touch Control'
                          : 'Fullscreen Touch Control',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: context.fluidFont(11.5),
                        letterSpacing: -0.1,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  const Icon(
                    Icons.fullscreen_rounded,
                    size: 16,
                    color: Colors.white,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildWakeQuickAction({
    required BuildContext context,
    required CyberPalette palette,
    required bool isCompact,
    required VoidCallback onPressed,
  }) {
    return Semantics(
      button: true,
      label: 'Send Wake-on-LAN Magic Packet to ${widget.name}',
      child: FluidPressScale(
        pressedScale: 0.96,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            key: ValueKey('device-card-wol-cta-${widget.id}'),
            onTap: onPressed,
            borderRadius: BorderRadius.circular(14),
            child: Container(
              padding: EdgeInsets.symmetric(
                horizontal: isCompact ? 10 : 12,
                vertical: isCompact ? 6.5 : 7.5,
              ),
              decoration: BoxDecoration(
                color: palette.warning.withValues(
                  alpha: palette.isDaylight ? 0.13 : 0.16,
                ),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: palette.warning.withValues(alpha: 0.48),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.bolt_rounded,
                    size: 15,
                    color: palette.warning,
                  ),
                  const SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      isCompact ? 'Wake PC (WoL)' : 'Wake Sleeping PC (WoL)',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: palette.warning,
                        fontWeight: FontWeight.w800,
                        fontSize: context.fluidFont(11.0),
                      ),
                    ),
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
    super.key,
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
        width: 38,
        height: 38,
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
