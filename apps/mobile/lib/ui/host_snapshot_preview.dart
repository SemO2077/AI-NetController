import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../security/network_validators.dart';
import '../services/host_connection_client.dart';
import '../theme/fluid_theme.dart';

/// Auto-refreshing 16:9 Liquid Glass desktop snapshot preview for online PCs,
/// and a sleek Sleeping (S3/S5) Wake-on-LAN status card for offline PCs.
class HostSnapshotPreview extends StatefulWidget {
  final String hostId;
  final String hostName;
  final String hostIp;
  final int wsPort;
  final String sharedSecret;
  final bool useTls;
  final String? certFingerprint;
  final bool isOnline;
  final String mac;

  /// Refresh cadence in seconds (`0` = manual only, `2`, `3`, `5`).
  final int refreshIntervalSec;
  final VoidCallback? onTapFullscreen;
  final VoidCallback? onWakeOnLan;
  final VoidCallback? onCopyMac;

  const HostSnapshotPreview({
    super.key,
    required this.hostId,
    required this.hostName,
    required this.hostIp,
    this.wsPort = 8765,
    this.sharedSecret = '',
    this.useTls = false,
    this.certFingerprint,
    required this.isOnline,
    this.mac = '',
    this.refreshIntervalSec = 3,
    this.onTapFullscreen,
    this.onWakeOnLan,
    this.onCopyMac,
  });

  @override
  State<HostSnapshotPreview> createState() => _HostSnapshotPreviewState();
}

class _HostSnapshotPreviewState extends State<HostSnapshotPreview>
    with WidgetsBindingObserver {
  static const int _snapshotMaxWidth = 640;
  static const int _snapshotMaxHeight = 360;
  static const int _snapshotQuality = 55;

  HostConnectionClient? _client;
  HostConnectionClient? _retainedClient;
  StreamSubscription<Uint8List>? _frameSub;
  StreamSubscription<HostConnectionSnapshot>? _stateSub;

  Timer? _refreshTimer;
  Timer? _ageTimer;
  Timer? _refreshPulseTimer;
  Timer? _macCopiedTimer;

  Uint8List? _previewBytes;
  DateTime? _lastUpdatedAt;
  HostConnectionSnapshot _snapshot = const HostConnectionSnapshot();
  bool _initialSnapshotRequested = false;
  bool _isRefreshing = false;
  bool _macCopied = false;
  bool _isAppActive = true;
  String? _validationError;

  final ValueNotifier<int> _ageTickNotifier = ValueNotifier<int>(0);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final AppLifecycleState? lifecycle = WidgetsBinding.instance.lifecycleState;
    _isAppActive = lifecycle == null || lifecycle == AppLifecycleState.resumed;
    _configureForCurrentProps(notify: false);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (_isAppActive) return;
      _isAppActive = true;
      if (widget.isOnline && widget.sharedSecret.trim().isNotEmpty) {
        _client?.notifyAppResumed();
        if (_client?.isVaultEstablished == true) {
          _requestSnapshotNow(showSpinner: false);
        }
        _syncRefreshTimer();
        _syncAgeTimer();
      }
      return;
    }

    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      if (!_isAppActive) return;
      _isAppActive = false;
      _stopRefreshTimer();
      _stopAgeTimer();
    }
  }

  @override
  void didUpdateWidget(covariant HostSnapshotPreview oldWidget) {
    super.didUpdateWidget(oldWidget);

    final bool configChanged = oldWidget.hostIp != widget.hostIp ||
        oldWidget.wsPort != widget.wsPort ||
        oldWidget.sharedSecret.trim() != widget.sharedSecret.trim() ||
        oldWidget.useTls != widget.useTls ||
        oldWidget.certFingerprint != widget.certFingerprint ||
        oldWidget.isOnline != widget.isOnline;

    if (configChanged) {
      _configureForCurrentProps(notify: true);
      return;
    }

    if (oldWidget.refreshIntervalSec != widget.refreshIntervalSec) {
      _syncRefreshTimer();
    }
  }

  void _configureForCurrentProps({required bool notify}) {
    _stopRefreshTimer();
    _stopAgeTimer();
    _refreshPulseTimer?.cancel();
    _refreshPulseTimer = null;
    _releaseClient();

    void applyReset(VoidCallback fn) {
      if (notify && mounted) {
        setState(fn);
      } else {
        fn();
      }
    }

    final String secret = widget.sharedSecret.trim();
    if (!widget.isOnline) {
      applyReset(() {
        _previewBytes = null;
        _lastUpdatedAt = null;
        _isRefreshing = false;
        _initialSnapshotRequested = false;
        _validationError = null;
        _snapshot = const HostConnectionSnapshot();
      });
      return;
    }

    if (!NetworkValidators.isValidIpOrHost(widget.hostIp) ||
        !NetworkValidators.isValidPort(widget.wsPort)) {
      applyReset(() {
        _previewBytes = null;
        _lastUpdatedAt = null;
        _isRefreshing = false;
        _initialSnapshotRequested = false;
        _validationError = 'Invalid host IP or WebSocket port.';
        _snapshot = const HostConnectionSnapshot();
      });
      return;
    }

    if (secret.isEmpty) {
      applyReset(() {
        _previewBytes = null;
        _lastUpdatedAt = null;
        _isRefreshing = false;
        _initialSnapshotRequested = false;
        _validationError = null;
        _snapshot = const HostConnectionSnapshot(
          phase: HostConnectionPhase.authFailed,
          errorMessage: 'Pairing secret required for desktop preview.',
        );
      });
      return;
    }

    final HostConnectionClient client = HostConnectionPool.instance.acquire(
      hostIp: widget.hostIp,
      port: widget.wsPort,
      sharedSecret: secret,
      useTls: widget.useTls,
      certFingerprint: widget.certFingerprint,
    );
    client.retain();
    _client = client;
    _retainedClient = client;

    final Uint8List? cachedFrame = client.lastFrame;
    final bool hasCached = cachedFrame != null && cachedFrame.isNotEmpty;
    final HostConnectionSnapshot initialSnap = client.snapshot;

    applyReset(() {
      _validationError = null;
      _snapshot = initialSnap;
      _previewBytes = hasCached ? cachedFrame : null;
      _lastUpdatedAt = hasCached ? DateTime.now() : null;
      _isRefreshing = false;
      _initialSnapshotRequested = false;
    });

    _frameSub = client.frameStream.listen((Uint8List bytes) {
      if (!mounted || bytes.isEmpty) return;
      _refreshPulseTimer?.cancel();
      _refreshPulseTimer = null;
      setState(() {
        _previewBytes = bytes;
        _lastUpdatedAt = DateTime.now();
        _isRefreshing = false;
      });
      _ageTickNotifier.value++;
      _syncAgeTimer();
    });

    _stateSub = client.stateStream.listen((HostConnectionSnapshot snap) {
      if (!mounted) return;
      final bool wasVault = _snapshot.isVaultEstablished;
      setState(() {
        _snapshot = snap;
        if (!snap.isVaultEstablished) {
          _initialSnapshotRequested = false;
          if (snap.phase == HostConnectionPhase.authFailed ||
              snap.phase == HostConnectionPhase.disconnected) {
            _isRefreshing = false;
          }
        }
      });
      if ((!wasVault || !_initialSnapshotRequested) && snap.isVaultEstablished) {
        _initialSnapshotRequested = true;
        _requestSnapshotNow(showSpinner: false);
      }
    });

    if (client.isVaultEstablished) {
      _initialSnapshotRequested = true;
      _requestSnapshotNow(showSpinner: false);
    } else {
      unawaited(client.ensureConnected().catchError((_) {}));
    }

    _syncRefreshTimer();
    _syncAgeTimer();
  }

  void _syncRefreshTimer() {
    _stopRefreshTimer();
    if (!widget.isOnline ||
        widget.sharedSecret.trim().isEmpty ||
        _validationError != null ||
        widget.refreshIntervalSec <= 0 ||
        !_isAppActive) {
      return;
    }

    _refreshTimer = Timer.periodic(
      Duration(seconds: widget.refreshIntervalSec),
      (_) {
        if (!mounted || !_isAppActive || !widget.isOnline) return;
        final HostConnectionClient? client = _client;
        if (client != null && client.isVaultEstablished) {
          _requestSnapshotNow(showSpinner: false);
        }
      },
    );
  }

  void _stopRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = null;
  }

  void _syncAgeTimer() {
    _stopAgeTimer();
    if (!widget.isOnline || _lastUpdatedAt == null || !_isAppActive) {
      return;
    }
    _ageTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted || _lastUpdatedAt == null) return;
      _ageTickNotifier.value++;
    });
  }

  void _stopAgeTimer() {
    _ageTimer?.cancel();
    _ageTimer = null;
  }

  void _requestSnapshotNow({bool showSpinner = true}) {
    final HostConnectionClient? client = _client;
    if (client == null) {
      if (widget.isOnline && widget.sharedSecret.trim().isNotEmpty) {
        _configureForCurrentProps(notify: true);
      }
      return;
    }

    if (showSpinner && mounted) {
      setState(() => _isRefreshing = true);
      _refreshPulseTimer?.cancel();
      _refreshPulseTimer = Timer(const Duration(milliseconds: 1400), () {
        if (mounted && _isRefreshing) {
          setState(() => _isRefreshing = false);
        }
      });
    }

    if (client.isVaultEstablished) {
      client.requestSnapshot(
        maxWidth: _snapshotMaxWidth,
        maxHeight: _snapshotMaxHeight,
        quality: _snapshotQuality,
      );
      return;
    }

    if (!client.isConnecting) {
      unawaited(client.reconnectNow().catchError((_) {}));
    }
  }

  void _releaseClient() {
    unawaited(_frameSub?.cancel());
    unawaited(_stateSub?.cancel());
    _frameSub = null;
    _stateSub = null;
    _retainedClient?.release();
    _retainedClient = null;
    _client = null;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopRefreshTimer();
    _stopAgeTimer();
    _refreshPulseTimer?.cancel();
    _refreshPulseTimer = null;
    _macCopiedTimer?.cancel();
    _macCopiedTimer = null;
    _releaseClient();
    _ageTickNotifier.dispose();
    super.dispose();
  }

  void _copyMacAddress(String normalizedMac) {
    unawaited(
      Clipboard.setData(ClipboardData(text: normalizedMac)).catchError((_) {}),
    );
    widget.onCopyMac?.call();
    _macCopiedTimer?.cancel();
    if (mounted) {
      setState(() => _macCopied = true);
      _macCopiedTimer = Timer(const Duration(milliseconds: 1400), () {
        if (mounted && _macCopied) {
          setState(() => _macCopied = false);
        }
      });
    }
  }

  String _formatAge(DateTime updatedAt) {
    final int secs = DateTime.now().difference(updatedAt).inSeconds;
    if (secs <= 1) return 'now';
    if (secs < 60) return '${secs}s';
    final int mins = secs ~/ 60;
    if (mins < 60) return '${mins}m';
    return '${mins ~/ 60}h';
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isOnline) {
      return _buildSleepingCard(context);
    }
    return _buildOnlinePreviewCard(context);
  }

  Widget _buildOnlinePreviewCard(BuildContext context) {
    final CyberPalette palette = context.palette;
    final Uint8List? bytes = _previewBytes;
    final bool hasSecret = widget.sharedSecret.trim().isNotEmpty;

    return RepaintBoundary(
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: Container(
            decoration: BoxDecoration(
              color: palette.isDaylight
                  ? const Color(0xFF10162F)
                  : const Color(0xFF070A18),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: palette.primary.withValues(alpha: 0.34),
                width: 1.1,
              ),
            ),
            child: Stack(
              fit: StackFit.expand,
              children: [
                Positioned.fill(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: widget.onTapFullscreen,
                    child: bytes != null && bytes.isNotEmpty
                        ? Image.memory(
                            bytes,
                            gaplessPlayback: true,
                            fit: BoxFit.cover,
                            filterQuality: FilterQuality.medium,
                            errorBuilder: (_, _, _) => _buildFallbackCenter(
                              context,
                              palette,
                              hasSecret: hasSecret,
                              decodeError: true,
                            ),
                          )
                        : _buildFallbackCenter(
                            context,
                            palette,
                            hasSecret: hasSecret,
                          ),
                  ),
                ),
                if (bytes != null && bytes.isNotEmpty)
                  Positioned.fill(
                    child: IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            stops: const [0.0, 0.28, 0.70, 1.0],
                            colors: [
                              Colors.black.withValues(alpha: 0.42),
                              Colors.transparent,
                              Colors.transparent,
                              Colors.black.withValues(alpha: 0.52),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                Positioned(
                  top: 8,
                  left: 8,
                  right: 8,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Flexible(
                        child: _buildPreviewAgePill(context, palette),
                      ),
                      const SizedBox(width: 6),
                      _buildRefreshButton(palette),
                    ],
                  ),
                ),
                Positioned(
                  bottom: 8,
                  left: 8,
                  right: 8,
                  child: Align(
                    alignment: Alignment.bottomRight,
                    child: _buildFullscreenOverlayPill(
                      context,
                      palette,
                      hasSecret: hasSecret,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPreviewAgePill(BuildContext context, CyberPalette palette) {
    return ValueListenableBuilder<int>(
      valueListenable: _ageTickNotifier,
      builder: (context, _, _) {
        final DateTime? updatedAt = _lastUpdatedAt;
        final String suffix = updatedAt != null
            ? _formatAge(updatedAt)
            : (widget.refreshIntervalSec > 0
                ? '${widget.refreshIntervalSec}s'
                : 'Manual');
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: const Color(0xBD090E22),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: Colors.white.withValues(alpha: 0.24),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: updatedAt != null
                      ? palette.success
                      : (_snapshot.isVaultEstablished
                          ? palette.sky
                          : palette.warning),
                ),
              ),
              const SizedBox(width: 5),
              Flexible(
                child: Text(
                  'PREVIEW • $suffix',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: context.fluidFont(9.5),
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.4,
                    fontFamily: 'monospace',
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildRefreshButton(CyberPalette palette) {
    return Semantics(
      button: true,
      label: 'Refresh desktop snapshot preview for ${widget.hostName}',
      child: Tooltip(
        message: 'Refresh snapshot',
        child: Material(
          color: const Color(0xBD090E22),
          shape: CircleBorder(
            side: BorderSide(
              color: Colors.white.withValues(alpha: 0.26),
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            key: ValueKey('snapshot-refresh-${widget.hostId}'),
            onTap: () => _requestSnapshotNow(showSpinner: true),
            child: SizedBox(
              width: 36,
              height: 36,
              child: Center(
                child: _isRefreshing
                    ? const SizedBox(
                        width: 15,
                        height: 15,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor:
                              AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      )
                    : const Icon(
                        Icons.refresh_rounded,
                        size: 17,
                        color: Colors.white,
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildFullscreenOverlayPill(
    BuildContext context,
    CyberPalette palette, {
    required bool hasSecret,
  }) {
    final bool needsPair =
        !hasSecret || _snapshot.phase == HostConnectionPhase.authFailed;
    final String pillLabel = needsPair ? 'Configure Pairing' : 'Open Fullscreen';
    final IconData pillIcon =
        needsPair ? Icons.vpn_key_rounded : Icons.fullscreen_rounded;
    final Color borderColor = needsPair
        ? palette.warning.withValues(alpha: 0.75)
        : palette.primary.withValues(alpha: 0.65);

    return Semantics(
      button: true,
      label: '$pillLabel for ${widget.hostName}',
      child: Material(
        color: const Color(0xC9090E22),
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          onTap: widget.onTapFullscreen,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: borderColor),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  pillIcon,
                  size: 14,
                  color: Colors.white,
                ),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    pillLabel,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: context.fluidFont(10.0),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildFallbackCenter(
    BuildContext context,
    CyberPalette palette, {
    required bool hasSecret,
    bool decodeError = false,
  }) {
    final IconData icon;
    final Color accentColor;
    final String title;
    final String subtitle;

    if (!hasSecret) {
      icon = Icons.key_off_rounded;
      accentColor = palette.warning;
      title = 'Pairing secret required';
      subtitle = 'Pair this workstation to unlock live screen previews.';
    } else if (_validationError != null) {
      icon = Icons.wifi_off_rounded;
      accentColor = palette.accent;
      title = 'Preview unavailable';
      subtitle = _validationError!;
    } else if (decodeError) {
      icon = Icons.broken_image_outlined;
      accentColor = palette.warning;
      title = 'Invalid snapshot frame';
      subtitle = 'Tap refresh to request a fresh JPEG frame.';
    } else if (_snapshot.phase == HostConnectionPhase.authFailed) {
      icon = Icons.gpp_bad_rounded;
      accentColor = palette.accent;
      title = 'Authentication failed';
      subtitle = _snapshot.errorMessage ?? 'Check pairing secret or TLS pin.';
    } else if (!_snapshot.isVaultEstablished &&
        !_snapshot.isConnecting &&
        _snapshot.phase != HostConnectionPhase.reconnecting &&
        _snapshot.errorMessage != null) {
      icon = Icons.cloud_off_rounded;
      accentColor = palette.warning;
      title = 'Preview unavailable';
      subtitle = _snapshot.errorMessage!;
    } else if (_snapshot.isVaultEstablished) {
      icon = Icons.desktop_windows_rounded;
      accentColor = palette.primary;
      title = 'Fetching preview...';
      subtitle = '${widget.hostIp}:${widget.wsPort}';
    } else {
      icon = Icons.sync_lock_rounded;
      accentColor = palette.sky;
      title = 'Connecting AEAD preview...';
      subtitle = '${widget.hostIp}:${widget.wsPort}';
    }

    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            palette.primary.withValues(alpha: 0.14),
            const Color(0xFF0A0F24),
            palette.secondary.withValues(alpha: 0.12),
          ],
        ),
      ),
      padding: const EdgeInsets.fromLTRB(12, 34, 12, 34),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final double maxTextWidth = math.max(120.0, constraints.maxWidth - 8);
          return Center(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: maxTextWidth),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: accentColor.withValues(alpha: 0.18),
                        border: Border.all(
                          color: accentColor.withValues(alpha: 0.45),
                        ),
                      ),
                      child: Icon(icon, size: 17, color: accentColor),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: context.fluidFont(11.5),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.74),
                        fontSize: context.fluidFont(9.5),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildSleepingCard(BuildContext context) {
    final CyberPalette palette = context.palette;
    final String? normalizedMac = NetworkValidators.normalizeMac(widget.mac);
    final bool hasMac = normalizedMac != null;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: palette.isDaylight
              ? [
                  Colors.white.withValues(alpha: 0.78),
                  palette.warning.withValues(alpha: 0.08),
                ]
              : [
                  palette.surfaceElevated.withValues(alpha: 0.76),
                  palette.warning.withValues(alpha: 0.10),
                ],
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: palette.warning.withValues(alpha: 0.36),
          width: 1.1,
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final double maxInnerWidth = constraints.maxWidth.isFinite
              ? constraints.maxWidth
              : 240.0;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              const FluidSpecularBar(
                isSelected: false,
                height: 1.0,
                margin: EdgeInsets.only(bottom: 8),
              ),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  _buildSleepStatusBadge(
                    context,
                    palette,
                    maxWidth: maxInnerWidth,
                  ),
                  _buildWolReadinessPill(
                    context,
                    palette,
                    hasMac: hasMac,
                    maxWidth: maxInnerWidth,
                  ),
                ],
              ),
              const SizedBox(height: 9),
              Material(
                color: Colors.transparent,
                child: InkWell(
                  key: ValueKey('snapshot-copy-mac-${widget.hostId}'),
                  borderRadius: BorderRadius.circular(12),
                  onTap: hasMac ? () => _copyMacAddress(normalizedMac) : null,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: _macCopied
                          ? palette.success.withValues(
                              alpha: palette.isDaylight ? 0.12 : 0.18,
                            )
                          : (palette.isDaylight
                              ? palette.primary.withValues(alpha: 0.06)
                              : Colors.white.withValues(alpha: 0.05)),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: _macCopied
                            ? palette.success.withValues(alpha: 0.48)
                            : palette.dividerColor,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          children: [
                            Icon(
                              _macCopied
                                  ? Icons.check_rounded
                                  : Icons.router_rounded,
                              size: 14,
                              color: _macCopied
                                  ? palette.success
                                  : palette.textSecondary,
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                hasMac ? normalizedMac : 'MAC not configured',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: context.fluidFont(10.5),
                                  fontWeight: FontWeight.w700,
                                  color: hasMac
                                      ? palette.textPrimary
                                      : palette.textSecondary,
                                ),
                              ),
                            ),
                            if (hasMac) ...[
                              const SizedBox(width: 6),
                              Text(
                                _macCopied ? 'Copied' : 'Copy',
                                style: TextStyle(
                                  fontSize: context.fluidFont(9.5),
                                  fontWeight: FontWeight.w700,
                                  color: _macCopied
                                      ? palette.success
                                      : palette.primary,
                                ),
                              ),
                            ],
                          ],
                        ),
                        if (!hasMac) ...[
                          const SizedBox(height: 3),
                          Text(
                            'Add a MAC address in Workstation Options to enable Wake-on-LAN.',
                            style: TextStyle(
                              fontSize: context.fluidFont(9.5),
                              color: palette.textSecondary,
                              height: 1.3,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
              if (widget.onWakeOnLan != null) ...[
                const SizedBox(height: 9),
                Semantics(
                  button: true,
                  label: 'Wake Sleeping PC ${widget.hostName} with WoL',
                  child: FluidPressScale(
                    pressedScale: 0.96,
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        key: ValueKey('snapshot-wol-cta-${widget.hostId}'),
                        onTap: widget.onWakeOnLan,
                        borderRadius: BorderRadius.circular(13),
                        child: Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: palette.warning.withValues(
                              alpha: palette.isDaylight ? 0.14 : 0.18,
                            ),
                            borderRadius: BorderRadius.circular(13),
                            border: Border.all(
                              color: palette.warning.withValues(alpha: 0.50),
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
                                  'Wake Sleeping PC (WoL)',
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
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _buildSleepStatusBadge(
    BuildContext context,
    CyberPalette palette, {
    required double maxWidth,
  }) {
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: maxWidth),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: palette.warning.withValues(
            alpha: palette.isDaylight ? 0.13 : 0.18,
          ),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: palette.warning.withValues(alpha: 0.42)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.bedtime_rounded, size: 13, color: palette.warning),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                'Sleeping S3/S5',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: palette.warning,
                  fontSize: context.fluidFont(10.0),
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWolReadinessPill(
    BuildContext context,
    CyberPalette palette, {
    required bool hasMac,
    required double maxWidth,
  }) {
    final Color pillColor = hasMac ? palette.success : palette.textSecondary;
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: maxWidth),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: pillColor.withValues(
            alpha: palette.isDaylight ? 0.11 : 0.16,
          ),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: pillColor.withValues(alpha: 0.36)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              hasMac ? Icons.bolt_rounded : Icons.warning_amber_rounded,
              size: 13,
              color: pillColor,
            ),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                hasMac ? 'WoL Ready' : 'MAC Needed',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: pillColor,
                  fontSize: context.fluidFont(10.0),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
