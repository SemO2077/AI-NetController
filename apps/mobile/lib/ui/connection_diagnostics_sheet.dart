import 'package:flutter/material.dart';

import '../services/host_connection_client.dart';
import '../theme/fluid_theme.dart';

/// Liquid Glass bottom sheet displaying live host connection diagnostics,
/// transport/AEAD vault security state, actionable troubleshooting hints, and
/// instant reconnect / frame resync actions.
class ConnectionDiagnosticsSheet extends StatelessWidget {
  final String hostName;
  final String hostIp;
  final int wsPort;
  final bool useTls;
  final HostConnectionSnapshot snapshot;
  final int currentFps;
  final Size? frameSize;
  final String qualityPreset;
  final VoidCallback onReconnect;
  final VoidCallback? onRequestKeyframe;

  const ConnectionDiagnosticsSheet({
    super.key,
    required this.hostName,
    required this.hostIp,
    required this.wsPort,
    required this.useTls,
    required this.snapshot,
    required this.currentFps,
    this.frameSize,
    this.qualityPreset = 'auto',
    required this.onReconnect,
    this.onRequestKeyframe,
  });

  /// Presents [ConnectionDiagnosticsSheet] as a modal bottom sheet.
  static Future<void> show(
    BuildContext context, {
    required String hostName,
    required String hostIp,
    required int wsPort,
    required bool useTls,
    required HostConnectionSnapshot snapshot,
    required int currentFps,
    Size? frameSize,
    String qualityPreset = 'auto',
    required VoidCallback onReconnect,
    VoidCallback? onRequestKeyframe,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ConnectionDiagnosticsSheet(
        hostName: hostName,
        hostIp: hostIp,
        wsPort: wsPort,
        useTls: useTls,
        snapshot: snapshot,
        currentFps: currentFps,
        frameSize: frameSize,
        qualityPreset: qualityPreset,
        onReconnect: onReconnect,
        onRequestKeyframe: onRequestKeyframe,
      ),
    );
  }

  /// Human-readable label for a [HostConnectionPhase].
  static String phaseLabel(HostConnectionPhase phase, {int reconnectAttempt = 0}) {
    return switch (phase) {
      HostConnectionPhase.connected => 'Connected & Vault Locked',
      HostConnectionPhase.connecting => 'Opening WebSocket...',
      HostConnectionPhase.authenticating => 'Authenticating Host...',
      HostConnectionPhase.securingVault => 'Securing X25519 AEAD Vault...',
      HostConnectionPhase.reconnecting => reconnectAttempt > 0
          ? 'Reconnecting (Attempt #$reconnectAttempt)...'
          : 'Reconnecting...',
      HostConnectionPhase.authFailed => 'Authentication Failed',
      HostConnectionPhase.disconnected => 'Disconnected',
    };
  }

  Color _phaseColor(CyberPalette palette) {
    return switch (snapshot.phase) {
      HostConnectionPhase.connected => palette.success,
      HostConnectionPhase.connecting ||
      HostConnectionPhase.authenticating ||
      HostConnectionPhase.securingVault =>
        palette.primary,
      HostConnectionPhase.reconnecting => palette.warning,
      HostConnectionPhase.authFailed => palette.accent,
      HostConnectionPhase.disconnected => palette.textSecondary,
    };
  }

  IconData _phaseIcon() {
    return switch (snapshot.phase) {
      HostConnectionPhase.connected => Icons.verified_user_rounded,
      HostConnectionPhase.connecting ||
      HostConnectionPhase.authenticating ||
      HostConnectionPhase.securingVault =>
        Icons.sync_lock_rounded,
      HostConnectionPhase.reconnecting => Icons.wifi_find_rounded,
      HostConnectionPhase.authFailed => Icons.gpp_bad_rounded,
      HostConnectionPhase.disconnected => Icons.portable_wifi_off_rounded,
    };
  }

  String _formatUptime(DateTime? since) {
    if (since == null) return 'Not connected';
    final Duration diff = DateTime.now().difference(since);
    if (diff.isNegative) return 'Just connected';
    if (diff.inHours > 0) {
      return '${diff.inHours}h ${diff.inMinutes.remainder(60)}m';
    }
    if (diff.inMinutes > 0) {
      return '${diff.inMinutes}m ${diff.inSeconds.remainder(60)}s';
    }
    return '${diff.inSeconds}s';
  }

  String _latencyRating(int? ms) {
    if (ms == null) return 'Measuring';
    if (ms <= 20) return 'Ultra-Low';
    if (ms <= 50) return 'Responsive';
    if (ms <= 120) return 'Moderate';
    return 'High Latency';
  }

  String _resolutionLabel() {
    final Size? sz = frameSize;
    if (sz == null || sz.width <= 0 || sz.height <= 0) {
      return 'Pending';
    }
    return '${sz.width.round()}×${sz.height.round()}';
  }

  @override
  Widget build(BuildContext context) {
    final CyberPalette palette = context.palette;
    final Color phaseColor = _phaseColor(palette);
    final String phaseText = phaseLabel(
      snapshot.phase,
      reconnectAttempt: snapshot.reconnectAttempt,
    );
    final String? effectiveHint = snapshot.errorHint ??
        HostConnectionClient.buildErrorHint(
          snapshot.errorMessage,
          port: wsPort,
          useTls: useTls,
        );

    return SafeArea(
      child: Container(
        margin: const EdgeInsets.fromLTRB(10, 0, 10, 10),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        decoration: BoxDecoration(
          color: palette.surfaceElevated.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: palette.isDaylight
                ? Colors.white.withValues(alpha: 0.90)
                : palette.primary.withValues(alpha: 0.35),
            width: 1.2,
          ),
          boxShadow: palette.elevationShadows(isSelected: true),
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: palette.textTertiary.withValues(alpha: 0.38),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 12),

              // Header
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: phaseColor.withValues(alpha: 0.16),
                      borderRadius: BorderRadius.circular(13),
                      border: Border.all(
                        color: phaseColor.withValues(alpha: 0.48),
                      ),
                    ),
                    child: Icon(_phaseIcon(), color: phaseColor, size: 21),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Connection Diagnostics',
                          style: TextStyle(
                            color: palette.textPrimary,
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '$hostName • $hostIp:$wsPort',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: palette.textSecondary,
                            fontFamily: 'monospace',
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Close diagnostics',
                    icon: Icon(
                      Icons.close_rounded,
                      size: 20,
                      color: palette.textSecondary,
                    ),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Phase Status Banner
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: phaseColor.withValues(
                    alpha: palette.isDaylight ? 0.10 : 0.15,
                  ),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: phaseColor.withValues(alpha: 0.42)),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: phaseColor,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        phaseText,
                        style: TextStyle(
                          color: phaseColor,
                          fontWeight: FontWeight.w800,
                          fontSize: 12.5,
                        ),
                      ),
                    ),
                    if (snapshot.phase == HostConnectionPhase.connected &&
                        snapshot.connectedSince != null)
                      Text(
                        'Up ${_formatUptime(snapshot.connectedSince)}',
                        style: TextStyle(
                          color: palette.textSecondary,
                          fontFamily: 'monospace',
                          fontSize: 10.5,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),

              // Metrics Grid
              LayoutBuilder(
                builder: (context, constraints) {
                  final double tileW =
                      ((constraints.maxWidth - 10) / 2).clamp(110.0, 400.0);
                  return Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      _buildMetricTile(
                        palette: palette,
                        width: tileW,
                        icon: Icons.speed_rounded,
                        label: 'RTT LATENCY',
                        value: snapshot.latencyMs != null
                            ? '${snapshot.latencyMs} ms'
                            : '-- ms',
                        sublabel: _latencyRating(snapshot.latencyMs),
                        accent: palette.sky,
                      ),
                      _buildMetricTile(
                        palette: palette,
                        width: tileW,
                        icon: Icons.shutter_speed_rounded,
                        label: 'FRAME RATE',
                        value: '$currentFps FPS',
                        sublabel: 'Preset: ${qualityPreset.toUpperCase()}',
                        accent: palette.primary,
                      ),
                      _buildMetricTile(
                        palette: palette,
                        width: tileW,
                        icon: Icons.desktop_windows_rounded,
                        label: 'VIDEO FRAME',
                        value: _resolutionLabel(),
                        sublabel: 'Decoded stream',
                        accent: palette.secondary,
                      ),
                      _buildMetricTile(
                        palette: palette,
                        width: tileW,
                        icon: Icons.enhanced_encryption_rounded,
                        label: 'SECURITY',
                        value: snapshot.isVaultEstablished
                            ? 'AEAD Active'
                            : 'Pending',
                        sublabel: useTls ? 'WSS TLS + X25519' : 'LAN WS + X25519',
                        accent: snapshot.isVaultEstablished
                            ? palette.success
                            : palette.warning,
                      ),
                    ],
                  );
                },
              ),
              const SizedBox(height: 12),

              // Error & Actionable Hint Card (or Gesture Tip)
              if (snapshot.errorMessage != null || effectiveHint != null)
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: palette.warning.withValues(
                      alpha: palette.isDaylight ? 0.10 : 0.14,
                    ),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: palette.warning.withValues(alpha: 0.45),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            Icons.tips_and_updates_rounded,
                            size: 16,
                            color: palette.warning,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Troubleshooting Hint',
                            style: TextStyle(
                              color: palette.warning,
                              fontWeight: FontWeight.w800,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                      if (snapshot.errorMessage != null) ...[
                        const SizedBox(height: 5),
                        Text(
                          snapshot.errorMessage!,
                          style: TextStyle(
                            color: palette.textPrimary,
                            fontFamily: 'monospace',
                            fontSize: 11,
                          ),
                        ),
                      ],
                      if (effectiveHint != null) ...[
                        const SizedBox(height: 6),
                        Text(
                          effectiveHint,
                          style: TextStyle(
                            color: palette.textSecondary,
                            fontSize: 11.5,
                            height: 1.35,
                          ),
                        ),
                      ],
                    ],
                  ),
                )
              else
                Container(
                  padding: const EdgeInsets.all(11),
                  decoration: BoxDecoration(
                    color: palette.primary.withValues(
                      alpha: palette.isDaylight ? 0.07 : 0.10,
                    ),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: palette.dividerColor),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.touch_app_rounded,
                        size: 16,
                        color: palette.primary,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Tap to click • Double-tap to double-click • Long-press or 2-finger tap to right-click • 2-finger drag to scroll • Pinch to zoom 1x–4x.',
                          style: TextStyle(
                            color: palette.textSecondary,
                            fontSize: 11,
                            height: 1.35,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 14),

              // Action Buttons
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton.icon(
                      key: const ValueKey('diagnostics-reconnect-btn'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: palette.primary,
                        foregroundColor: palette.isDaylight
                            ? Colors.white
                            : const Color(0xFF090B1D),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      icon: const Icon(Icons.refresh_rounded, size: 18),
                      label: const Text(
                        'Reconnect Now',
                        style: TextStyle(fontWeight: FontWeight.w800),
                      ),
                      onPressed: () {
                        Navigator.of(context).pop();
                        onReconnect();
                      },
                    ),
                  ),
                  if (onRequestKeyframe != null) ...[
                    const SizedBox(width: 10),
                    OutlinedButton.icon(
                      key: const ValueKey('diagnostics-keyframe-btn'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: palette.textPrimary,
                        side: BorderSide(color: palette.dividerColor),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 12,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      icon: const Icon(Icons.sync_rounded, size: 18),
                      label: const Text('Resync'),
                      onPressed: snapshot.isVaultEstablished
                          ? () {
                              Navigator.of(context).pop();
                              onRequestKeyframe!();
                            }
                          : null,
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetricTile({
    required CyberPalette palette,
    required double width,
    required IconData icon,
    required String label,
    required String value,
    required String sublabel,
    required Color accent,
  }) {
    return Container(
      width: width,
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: palette.surface.withValues(
          alpha: palette.isDaylight ? 0.90 : 0.72,
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: palette.dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 13, color: accent),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: palette.textTertiary,
                    fontSize: 9.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.7,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 5),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: palette.textPrimary,
              fontFamily: 'monospace',
              fontSize: 13.5,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            sublabel,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: 10,
            ),
          ),
        ],
      ),
    );
  }
}
