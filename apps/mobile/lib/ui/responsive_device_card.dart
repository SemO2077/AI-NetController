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

  // Expandable card telemetry, snapshot preview & quick actions
  final bool isExpanded;
  final VoidCallback? onToggleExpand;
  final Widget? expandedPreview;
  final String osName;
  final int cpuCores;
  final double ramUsedGb;
  final double ramTotalGb;
  final int diskUsage;
  final int uptimeSec;
  final int wsPort;
  final bool viewOnlyMode;
  final VoidCallback? onOpenTerminal;
  final VoidCallback? onSyncClipboard;
  final VoidCallback? onToggleMute;
  final VoidCallback? onLockPc;
  final VoidCallback? onOpenDiagnostics;

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
    this.isExpanded = false,
    this.onToggleExpand,
    this.expandedPreview,
    this.osName = '',
    this.cpuCores = 0,
    this.ramUsedGb = 0.0,
    this.ramTotalGb = 0.0,
    this.diskUsage = 0,
    this.uptimeSec = 0,
    this.wsPort = 8765,
    this.viewOnlyMode = false,
    this.onOpenTerminal,
    this.onSyncClipboard,
    this.onToggleMute,
    this.onLockPc,
    this.onOpenDiagnostics,
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

  static String _formatGb(double gb) {
    if ((gb - gb.roundToDouble()).abs() < 0.05) {
      return gb.toStringAsFixed(0);
    }
    return gb.toStringAsFixed(1);
  }

  static String _formatUptime(int totalSeconds) {
    if (totalSeconds <= 0) return '--';
    final int days = totalSeconds ~/ 86400;
    final int hours = (totalSeconds % 86400) ~/ 3600;
    final int mins = (totalSeconds % 3600) ~/ 60;
    if (days > 0) return '${days}d ${hours}h ${mins}m';
    if (hours > 0) return '${hours}h ${mins}m';
    if (mins > 0) return '${mins}m';
    return '${totalSeconds}s';
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
    final VoidCallback? cardTapCallback = widget.onToggleExpand ?? widget.onTap;
    final String statusLabel = widget.connectionStatusLabel ??
        (isOnline ? 'Online' : 'Sleeping');

    return RepaintBoundary(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 5.0),
        child: GestureDetector(
          onTapDown: _onTapDown,
          onTapUp: _onTapUp,
          onTapCancel: _onTapCancel,
          onTap: cardTapCallback,
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
                          SizedBox(width: isCompactCard ? 8 : 11),
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
                              !showFullOnlineCta) ...[
                            const SizedBox(width: 4),
                            _ActionOrbButton(
                              key: ValueKey(
                                'device-card-touch-cta-${widget.id}',
                              ),
                              tooltip: 'Fullscreen Touchscreen Control',
                              icon: Icons.touch_app_rounded,
                              color: palette.primary,
                              onPressed: openControlCallback,
                            ),
                          ] else if (!isOnline &&
                              widget.onWakeOnLan != null &&
                              !showFullOfflineCta) ...[
                            const SizedBox(width: 4),
                            _ActionOrbButton(
                              key: ValueKey('device-card-wol-cta-${widget.id}'),
                              tooltip: 'Send Wake-on-LAN Magic Packet',
                              icon: Icons.bolt_rounded,
                              color: palette.warning,
                              onPressed: widget.onWakeOnLan!,
                            ),
                          ],
                          const SizedBox(width: 4),
                          _ExpandChevronButton(
                            key: ValueKey('device-card-expand-${widget.id}'),
                            hostName: widget.name,
                            isExpanded: widget.isExpanded,
                            duration: animDuration,
                            palette: palette,
                            onPressed: cardTapCallback,
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
                              style: IconButton.styleFrom(
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                minimumSize: const Size(26, 30),
                                padding: EdgeInsets.zero,
                              ),
                              constraints: const BoxConstraints(
                                minWidth: 26,
                                minHeight: 30,
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
                      AnimatedSize(
                        duration: animDuration,
                        curve: Curves.easeOutCubic,
                        alignment: Alignment.topCenter,
                        child: AnimatedOpacity(
                          opacity: widget.isExpanded ? 1.0 : 0.0,
                          duration: animDuration,
                          curve: Curves.easeOutCubic,
                          child: widget.isExpanded
                              ? _buildExpandedDrawer(
                                  context: context,
                                  palette: palette,
                                  isCompact: isCompactCard,
                                  openControlCallback: openControlCallback,
                                )
                              : const SizedBox.shrink(),
                        ),
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

  Widget _buildExpandedDrawer({
    required BuildContext context,
    required CyberPalette palette,
    required bool isCompact,
    required VoidCallback? openControlCallback,
  }) {
    final List<Widget> quickActions = _buildQuickActionPills(
      palette: palette,
      openControlCallback: openControlCallback,
    );

    return Padding(
      padding: EdgeInsets.only(top: isCompact ? 10.0 : 12.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            height: 1,
            color: palette.dividerColor,
          ),
          SizedBox(height: isCompact ? 9.0 : 11.0),
          if (widget.expandedPreview != null) ...[
            widget.expandedPreview!,
            SizedBox(height: isCompact ? 9.0 : 11.0),
          ],
          _buildTelemetryGrid(
            context: context,
            palette: palette,
            isCompact: isCompact,
          ),
          if (quickActions.isNotEmpty) ...[
            SizedBox(height: isCompact ? 9.0 : 11.0),
            LayoutBuilder(
              builder: (context, constraints) {
                final double maxWidth = constraints.maxWidth.isFinite
                    ? constraints.maxWidth
                    : 260.0;
                return Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: quickActions
                      .map(
                        (pill) => ConstrainedBox(
                          constraints: BoxConstraints(maxWidth: maxWidth),
                          child: pill,
                        ),
                      )
                      .toList(growable: false),
                );
              },
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildTelemetryGrid({
    required BuildContext context,
    required CyberPalette palette,
    required bool isCompact,
  }) {
    final String osText =
        widget.osName.trim().isNotEmpty ? widget.osName.trim() : 'Unknown OS';
    final String cpuText = widget.cpuCores > 0
        ? '${widget.cpuUsage}% • ${widget.cpuCores} cores'
        : '${widget.cpuUsage}%';
    final String ramText = widget.ramTotalGb > 0
        ? '${_formatGb(widget.ramUsedGb)}/${_formatGb(widget.ramTotalGb)} GB (${widget.ramUsage}%)'
        : '${widget.ramUsage}%';
    final String diskText = '${widget.diskUsage}%';
    final String uptimeText = _formatUptime(widget.uptimeSec);
    final String trimmedMac = widget.mac.trim();
    final String macText =
        trimmedMac.isNotEmpty && trimmedMac != '00:00:00:00:00:00'
            ? trimmedMac.toUpperCase()
            : 'Not set';
    final String endpointText = '${widget.ip}:${widget.wsPort}';
    final String securityText = widget.useTls ? 'TLS+AEAD' : 'AEAD';
    final String controlText = widget.viewOnlyMode ? 'View-Only' : 'Interactive';

    return Container(
      padding: EdgeInsets.all(isCompact ? 8.5 : 10.0),
      decoration: BoxDecoration(
        color: palette.isDaylight
            ? Colors.white.withValues(alpha: 0.62)
            : Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: palette.dividerColor),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final double maxWidth = constraints.maxWidth.isFinite
              ? constraints.maxWidth
              : 240.0;
          return Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _TelemetryMetricChip(
                icon: Icons.desktop_windows_rounded,
                label: 'OS',
                value: osText,
                accent: palette.primary,
                maxWidth: maxWidth,
              ),
              _TelemetryMetricChip(
                icon: Icons.memory_rounded,
                label: 'CPU',
                value: cpuText,
                accent: widget.cpuUsage > 80 ? palette.accent : palette.primary,
                maxWidth: maxWidth,
              ),
              _TelemetryMetricChip(
                icon: Icons.developer_board_rounded,
                label: 'RAM',
                value: ramText,
                accent:
                    widget.ramUsage > 85 ? palette.warning : palette.secondary,
                maxWidth: maxWidth,
              ),
              _TelemetryMetricChip(
                icon: Icons.storage_rounded,
                label: 'Disk',
                value: diskText,
                accent: widget.diskUsage > 90 ? palette.warning : palette.sky,
                maxWidth: maxWidth,
              ),
              _TelemetryMetricChip(
                icon: Icons.schedule_rounded,
                label: 'Uptime',
                value: uptimeText,
                accent: palette.success,
                maxWidth: maxWidth,
              ),
              _TelemetryMetricChip(
                icon: Icons.router_rounded,
                label: 'MAC',
                value: macText,
                accent: palette.textSecondary,
                monospace: true,
                maxWidth: maxWidth,
              ),
              _TelemetryMetricChip(
                icon: Icons.lan_rounded,
                label: 'Endpoint',
                value: endpointText,
                accent: palette.sky,
                monospace: true,
                maxWidth: maxWidth,
              ),
              _TelemetryMetricChip(
                icon: widget.useTls
                    ? Icons.verified_user_rounded
                    : Icons.enhanced_encryption_rounded,
                label: 'Security',
                value: securityText,
                accent: widget.useTls ? palette.success : palette.primary,
                maxWidth: maxWidth,
              ),
              _TelemetryMetricChip(
                icon: widget.viewOnlyMode
                    ? Icons.visibility_rounded
                    : Icons.touch_app_rounded,
                label: 'Control',
                value: controlText,
                accent:
                    widget.viewOnlyMode ? palette.warning : palette.success,
                maxWidth: maxWidth,
              ),
            ],
          );
        },
      ),
    );
  }

  List<Widget> _buildQuickActionPills({
    required CyberPalette palette,
    required VoidCallback? openControlCallback,
  }) {
    final bool isOnline = widget.isOnline;
    final List<Widget> pills = <Widget>[];

    if (isOnline && openControlCallback != null) {
      pills.add(
        _QuickActionPill(
          key: ValueKey('device-card-quick-touch-${widget.id}'),
          icon: Icons.touch_app_rounded,
          label: 'Fullscreen Touch',
          color: palette.primary,
          onTap: openControlCallback,
        ),
      );
    }
    if (isOnline && widget.onOpenTerminal != null) {
      pills.add(
        _QuickActionPill(
          key: ValueKey('device-card-quick-terminal-${widget.id}'),
          icon: Icons.terminal_rounded,
          label: 'Terminal',
          color: palette.secondary,
          onTap: widget.onOpenTerminal!,
        ),
      );
    }
    if (isOnline && widget.onSyncClipboard != null) {
      pills.add(
        _QuickActionPill(
          key: ValueKey('device-card-quick-clipboard-${widget.id}'),
          icon: Icons.content_paste_go_rounded,
          label: 'Clipboard Sync',
          color: palette.sky,
          onTap: widget.onSyncClipboard!,
        ),
      );
    }
    if (isOnline && widget.onToggleMute != null) {
      pills.add(
        _QuickActionPill(
          key: ValueKey('device-card-quick-mute-${widget.id}'),
          icon: Icons.volume_off_rounded,
          label: 'Mute',
          color: palette.warning,
          onTap: widget.onToggleMute!,
        ),
      );
    }
    if (isOnline && widget.onLockPc != null) {
      pills.add(
        _QuickActionPill(
          key: ValueKey('device-card-quick-lock-${widget.id}'),
          icon: Icons.lock_outline_rounded,
          label: 'Lock PC',
          color: palette.accent,
          onTap: widget.onLockPc!,
        ),
      );
    }
    if (!isOnline && widget.onWakeOnLan != null) {
      pills.add(
        _QuickActionPill(
          key: ValueKey('device-card-quick-wol-${widget.id}'),
          icon: Icons.bolt_rounded,
          label: 'Wake WoL',
          color: palette.warning,
          onTap: widget.onWakeOnLan!,
        ),
      );
    }
    if (widget.onOpenDiagnostics != null) {
      pills.add(
        _QuickActionPill(
          key: ValueKey('device-card-quick-diagnostics-${widget.id}'),
          icon: Icons.monitor_heart_rounded,
          label: 'Diagnostics',
          color: palette.success,
          onTap: widget.onOpenDiagnostics!,
        ),
      );
    }
    if (widget.onMoreActions != null) {
      pills.add(
        _QuickActionPill(
          key: ValueKey('device-card-quick-options-${widget.id}'),
          icon: Icons.tune_rounded,
          label: 'Options',
          color: palette.textSecondary,
          onTap: widget.onMoreActions!,
        ),
      );
    }

    return pills;
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
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: context.fluidFont(9),
                  fontWeight: FontWeight.w600,
                  color: palette.textSecondary,
                  letterSpacing: 0.8,
                ),
              ),
            ),
            const SizedBox(width: 4),
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

class _ExpandChevronButton extends StatelessWidget {
  final String hostName;
  final bool isExpanded;
  final Duration duration;
  final CyberPalette palette;
  final VoidCallback? onPressed;

  const _ExpandChevronButton({
    super.key,
    required this.hostName,
    required this.isExpanded,
    required this.duration,
    required this.palette,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    final Color fgColor = isExpanded ? palette.primary : palette.textSecondary;
    final Color bgColor = isExpanded
        ? palette.primary.withValues(alpha: palette.isDaylight ? 0.12 : 0.18)
        : (palette.isDaylight
            ? Colors.black.withValues(alpha: 0.04)
            : Colors.white.withValues(alpha: 0.06));
    final Color borderColor = isExpanded
        ? palette.primary.withValues(alpha: 0.42)
        : palette.dividerColor;

    return Semantics(
      button: true,
      expanded: isExpanded,
      label: isExpanded
          ? 'Collapse details for $hostName'
          : 'Expand details for $hostName',
      child: Tooltip(
        message: isExpanded ? 'Collapse details' : 'Expand preview & telemetry',
        child: Material(
          color: bgColor,
          shape: CircleBorder(
            side: BorderSide(color: borderColor),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onPressed,
            child: SizedBox(
              width: 28,
              height: 28,
              child: Center(
                child: AnimatedRotation(
                  turns: isExpanded ? 0.5 : 0.0,
                  duration: duration,
                  curve: Curves.easeOutCubic,
                  child: Icon(
                    Icons.keyboard_arrow_down_rounded,
                    size: 18,
                    color: fgColor,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TelemetryMetricChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final Color accent;
  final bool monospace;
  final double maxWidth;

  const _TelemetryMetricChip({
    required this.icon,
    required this.label,
    required this.value,
    required this.accent,
    this.monospace = false,
    required this.maxWidth,
  });

  @override
  Widget build(BuildContext context) {
    final CyberPalette palette = context.palette;
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: maxWidth),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(
          color: palette.isDaylight
              ? palette.primary.withValues(alpha: 0.05)
              : Colors.white.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(11),
          border: Border.all(
            color: accent.withValues(alpha: 0.24),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 12.5, color: accent),
            const SizedBox(width: 5),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: context.fluidFont(8.5),
                      fontWeight: FontWeight.w700,
                      color: palette.textSecondary,
                      letterSpacing: 0.3,
                    ),
                  ),
                  Text(
                    value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: context.fluidFont(10.0),
                      fontWeight: FontWeight.w700,
                      fontFamily: monospace ? 'monospace' : null,
                      color: palette.textPrimary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickActionPill extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _QuickActionPill({
    super.key,
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final CyberPalette palette = context.palette;
    return Semantics(
      button: true,
      label: label,
      child: FluidPressScale(
        pressedScale: 0.95,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(999),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: color.withValues(
                  alpha: palette.isDaylight ? 0.11 : 0.16,
                ),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: color.withValues(alpha: 0.38),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 13.5, color: color),
                  const SizedBox(width: 5),
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: context.fluidFont(10.0),
                        fontWeight: FontWeight.w700,
                        color: color,
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
