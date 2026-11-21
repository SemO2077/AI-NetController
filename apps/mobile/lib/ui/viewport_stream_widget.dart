import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../protocol/binary_protocol.dart';
import '../security/network_validators.dart';
import '../services/app_preferences.dart';
import '../services/host_connection_client.dart';
import '../services/thermal_governor.dart';
import '../services/zero_gc_video_pipeline.dart';
import '../theme/fluid_theme.dart';
import 'connection_diagnostics_sheet.dart';
import 'remote_keyboard_bar.dart';
import 'touch_coordinate_mapper.dart';
import 'touch_feedback_overlay.dart';

// =====================================================================
// BINARY PROTOCOL DEFINITION & OPCODES
// =====================================================================
const int magicByte0 = kMagicByte0;
const int magicByte1 = kMagicByte1;

enum StreamOpcode {
  ping(0x01), // 1 (0x01)
  telemetry(0x02), // 2 (0x02)
  frame(0x03), // 3 (0x03)
  shell(0x04), // 4 (0x04)
  hitl(0x05), // 5 (0x05)
  auth(0x06), // 6 (0x06)
  clip(0x07), // 7 (0x07)
  input(0x08), // 8 (0x08)
  audio(0x09), // 9 (0x09)
  viewportResize(0x0A), // 10 (0x0A) - Bidirectional Resolution Matching
  llmStream(0x0B), // 11 (0x0B)
  fileTransfer(0x0C), // 12 (0x0C)
  displayEnum(0x0D), // 13 (0x0D)
  frameAck(0x0E), // 14 (0x0E)
  frameSync(0xED), // 237 (0xED)
  error(0xEE); // 238 (0xEE)

  final int code;
  const StreamOpcode(this.code);

  static StreamOpcode? fromCode(int code) {
    for (final op in StreamOpcode.values) {
      if (op.code == code) return op;
    }
    return null;
  }
}

class StreamBinaryPacket {
  final StreamOpcode opcode;
  final int flags;
  final int seqId;
  final Uint8List payload;

  StreamBinaryPacket(this.opcode, this.flags, this.seqId, this.payload);

  static StreamBinaryPacket? parse(Uint8List bytes) {
    final ProtocolPacket? parsed = parsePacket(bytes);
    if (parsed == null) return null;
    final opcode = StreamOpcode.fromCode(parsed.opcode);
    if (opcode == null) return null;
    return StreamBinaryPacket(opcode, parsed.flags, parsed.seq, parsed.payload);
  }

  static Uint8List pack(
    StreamOpcode opcode,
    int seqId,
    Uint8List payload, {
    int flags = 0,
  }) {
    return packPacket(opcode.code, payload, flags: flags, seq: seqId);
  }

  /// Packs 0x0A VIEWPORT_RESIZE control payload containing target width and height
  static Uint8List packViewportResize(int width, int height, {int seqId = 1}) {
    final payload = Uint8List(8);
    final view = ByteData.sublistView(payload);
    view.setUint32(0, width, Endian.big);
    view.setUint32(4, height, Endian.big);
    return pack(StreamOpcode.viewportResize, seqId, payload);
  }
}

enum _StreamInputMode { touch, drag, trackpad }

enum _TwoFingerMode { undecided, scroll, zoomPan }

// =====================================================================
// DYNAMIC VIEWPORT STREAM WIDGET WITH DIRECT TOUCHSCREEN & FULLSCREEN HUD
// =====================================================================
class ViewportStreamWidget extends StatefulWidget {
  final String hostIp;
  final String hostName;
  final int wsPort;
  final bool isInline;
  final VoidCallback? onToggleFullscreen;
  final String sharedSecret;
  final bool useTls;
  final String? certFingerprint;
  final int targetFps;
  final bool keepScreenAwake;
  final void Function(Map<String, dynamic> telemetry)? onTelemetry;

  // Alpha touchscreen, quality, and fullscreen HUD controls
  final RemoteInputMode initialInputMode;
  final bool touchVisualFeedback;
  final bool hapticsEnabled;
  final String qualityPreset;
  final double trackpadSensitivity;
  final bool instantTapMode;
  final int longPressDelayMs;
  final double scrollSensitivity;
  final bool naturalScroll;
  final bool pinchZoomEnabled;
  final bool collapsibleHud;
  final VoidCallback? onExitFullscreen;
  final VoidCallback? onCycleOrientation;
  final String? orientationLabel;
  final IconData? orientationIcon;
  final ValueChanged<String>? onQualityPresetChanged;

  const ViewportStreamWidget({
    super.key,
    required this.hostIp,
    required this.hostName,
    this.wsPort = 8765,
    this.isInline = true,
    this.onToggleFullscreen,
    this.sharedSecret = '',
    this.useTls = false,
    this.certFingerprint,
    this.targetFps = 30,
    this.keepScreenAwake = true,
    this.onTelemetry,
    this.initialInputMode = RemoteInputMode.touchscreen,
    this.touchVisualFeedback = true,
    this.hapticsEnabled = true,
    this.qualityPreset = 'auto',
    this.trackpadSensitivity = 1.6,
    this.instantTapMode = true,
    this.longPressDelayMs = 460,
    this.scrollSensitivity = 1.6,
    this.naturalScroll = false,
    this.pinchZoomEnabled = true,
    this.collapsibleHud = false,
    this.onExitFullscreen,
    this.onCycleOrientation,
    this.orientationLabel,
    this.orientationIcon,
    this.onQualityPresetChanged,
  });

  @override
  State<ViewportStreamWidget> createState() => _ViewportStreamWidgetState();
}

class _ViewportStreamWidgetState extends State<ViewportStreamWidget>
    with WidgetsBindingObserver {
  static int _wakelockRefCount = 0;
  static const double _tapSlopPx = 11.0;
  static const Duration _doubleTapWindow = Duration(milliseconds: 220);
  static const Duration _singleTapCommitDelay = Duration(milliseconds: 175);
  static const Duration _longPressRingDelay = Duration(milliseconds: 110);
  static const Duration _inputCoalesceInterval = Duration(milliseconds: 8);
  static const Duration _hudAutoHideDelay = Duration(seconds: 6);

  bool _holdsWakelock = false;
  HostConnectionClient? _client;
  HostConnectionClient? _retainedClient;
  StreamSubscription<Uint8List>? _frameSub;
  StreamSubscription<Map<String, dynamic>>? _telemetrySub;
  StreamSubscription<HostConnectionSnapshot>? _stateSub;
  StreamSubscription<Map<String, dynamic>>? _hitlSub;
  StreamSubscription<String>? _clipSub;
  StreamSubscription<List<Map<String, dynamic>>>? _displaySub;

  final StreamController<Uint8List> _frameController =
      StreamController<Uint8List>.broadcast(sync: true);
  final TouchFeedbackController _feedbackController = TouchFeedbackController();

  HostConnectionSnapshot _connectionSnapshot = const HostConnectionSnapshot();
  bool _isConnected = false;
  bool _isAuthenticated = false;
  bool _isConnecting = true;
  bool _hasReceivedFrame = false;
  String? _errorMessage;
  String? _errorHint;
  List<Map<String, dynamic>> _monitors = const [];
  int _activeMonitorIdx = 1;

  // Viewport Resolution, Decoded Frame Size & Quality Tracking
  Size _lastContainerSize = Size.zero;
  Size? _decodedFrameSize;
  int _lastRawPhysicalWidth = 0;
  int _lastRawPhysicalHeight = 0;
  int _lastPhysicalWidth = 0;
  int _lastPhysicalHeight = 0;
  int _lastCapMaxWidth = 1440;
  int _lastCapMaxHeight = 810;
  int _lastSentPhysicalWidth = 0;
  int _lastSentPhysicalHeight = 0;
  int _lastSentCapMaxWidth = 0;
  int _lastSentCapMaxHeight = 0;
  int _lastSentQuality = 75;
  int _lastSentFps = 30;
  bool _resizeScheduled = false;
  bool _zoomClampScheduled = false;

  // Input Mode, Fit Mode, Quality Preset, Zoom/Pan, Keyboard & Collapsible HUD
  late _StreamInputMode _inputMode;
  late String _qualityPreset;
  BoxFit _videoFit = BoxFit.contain;
  Matrix4 _zoomTransform = Matrix4.identity();
  bool _showKeyboardBar = false;
  bool _hudVisible = true;
  Offset? _restorePillOffset;
  bool _hostViewOnly = false;

  // Multi-touch Pointer State Machine (0ms latency direct touchscreen + trackpad)
  final Map<int, Offset> _activePointers = <int, Offset>{};
  int? _primaryPointerId;
  Offset? _primaryDownPos;
  Offset? _primaryLastPos;
  bool _primaryMovedBeyondSlop = false;
  bool _longPressFired = false;
  bool _isPotentialDoubleTap = false;
  bool _mouseButtonHeld = false;
  Offset _lastNormalizedPos = const Offset(0.5, 0.5);
  bool _suppressOneFingerUntilAllUp = false;

  // Single/Double tap disambiguation
  DateTime? _lastTapUpAt;
  Offset? _lastTapUpPos;
  Timer? _pendingSingleTapTimer;
  Timer? _longPressTimer;
  Timer? _longPressVisualTimer;
  Timer? _hudAutoHideTimer;

  // Two-finger pinch-zoom / pan / 2D scroll / 2-finger tap
  DateTime? _twoFingerStartAt;
  double _twoFingerStartDist = 0.0;
  Offset _twoFingerStartMid = Offset.zero;
  Offset _twoFingerPrevMid = Offset.zero;
  double _twoFingerStartScale = 1.0;
  double _twoFingerMaxMidMove = 0.0;
  _TwoFingerMode _twoFingerMode = _TwoFingerMode.undecided;

  // Leading-edge 8ms Coalesced Binary Input Buffers
  Offset? _pendingAbsMove;
  double _accumRelDx = 0.0;
  double _accumRelDy = 0.0;
  double _accumScrollDx = 0.0;
  double _accumScrollDy = 0.0;
  DateTime _lastInputFlushAt = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _inputFlushTimer;

  // Isolated HUD Metrics (never trigger parent video canvas rebuilds)
  int _fpsCount = 0;
  final ValueNotifier<int> _fpsNotifier = ValueNotifier<int>(0);
  final ValueNotifier<int?> _latencyNotifier = ValueNotifier<int?>(null);
  DateTime _lastUiFrameAt = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _fpsTimer;
  Timer? _frameRecoveryTimer;

  void _syncWakelock(bool shouldHold) {
    if (shouldHold == _holdsWakelock) return;
    _holdsWakelock = shouldHold;
    if (shouldHold) {
      _wakelockRefCount++;
      unawaited(WakelockPlus.enable().catchError((_) {}));
    } else {
      if (_wakelockRefCount > 0) {
        _wakelockRefCount--;
      }
      if (_wakelockRefCount == 0) {
        unawaited(WakelockPlus.disable().catchError((_) {}));
      }
    }
  }

  _StreamInputMode _modeFromPref(RemoteInputMode pref) =>
      pref == RemoteInputMode.trackpad
          ? _StreamInputMode.trackpad
          : _StreamInputMode.touch;

  String _normalizePreset(String raw) {
    final normalized = raw.trim().toLowerCase();
    return kValidStreamQualityPresets.contains(normalized) ? normalized : 'auto';
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _inputMode = _modeFromPref(widget.initialInputMode);
    _qualityPreset = _normalizePreset(widget.qualityPreset);
    _syncWakelock(widget.keepScreenAwake);
    ThermalGovernor.instance.addListener(_onThermalConfigChanged);
    _connect(notify: false);

    _fpsTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        _fpsNotifier.value = _fpsCount;
        _fpsCount = 0;
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _client?.notifyAppResumed();
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      _releaseHeldMouseButton();
      _cancelPendingTouchTimers();
    }
  }

  @override
  void didUpdateWidget(covariant ViewportStreamWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.keepScreenAwake != widget.keepScreenAwake) {
      _syncWakelock(widget.keepScreenAwake);
    }
    if (oldWidget.initialInputMode != widget.initialInputMode) {
      _releaseHeldMouseButton();
      _inputMode = _modeFromPref(widget.initialInputMode);
    }
    if (oldWidget.qualityPreset != widget.qualityPreset) {
      final nextPreset = _normalizePreset(widget.qualityPreset);
      if (nextPreset != _qualityPreset) {
        _qualityPreset = nextPreset;
        _negotiateViewportIfReady();
      }
    }
    if (oldWidget.touchVisualFeedback != widget.touchVisualFeedback &&
        !widget.touchVisualFeedback) {
      _feedbackController.clearAll();
    }
    if (oldWidget.pinchZoomEnabled != widget.pinchZoomEnabled &&
        !widget.pinchZoomEnabled &&
        !_zoomTransform.isIdentity()) {
      _zoomTransform = Matrix4.identity();
    }
    if (oldWidget.hostIp != widget.hostIp ||
        oldWidget.wsPort != widget.wsPort ||
        oldWidget.sharedSecret.trim() != widget.sharedSecret.trim() ||
        oldWidget.useTls != widget.useTls ||
        oldWidget.certFingerprint != widget.certFingerprint) {
      _hasReceivedFrame = false;
      _decodedFrameSize = null;
      _lastSentPhysicalWidth = 0;
      _lastSentPhysicalHeight = 0;
      _lastSentCapMaxWidth = 0;
      _lastSentCapMaxHeight = 0;
      _zoomTransform = Matrix4.identity();
      _connect(notify: false);
    } else if (oldWidget.targetFps != widget.targetFps) {
      _negotiateViewportIfReady();
    }
  }

  void _hapticLight() {
    if (!widget.hapticsEnabled) return;
    unawaited(HapticFeedback.selectionClick().catchError((_) {}));
  }

  void _hapticMedium() {
    if (!widget.hapticsEnabled) return;
    unawaited(HapticFeedback.mediumImpact().catchError((_) {}));
  }

  int _qualityForThermalAndPreset(ThermalConfig cfg) {
    final int thermalCap = (cfg.isSnapshotOnlyMode || cfg.targetFps <= 10)
        ? 45
        : (cfg.targetFps <= 20 ? 64 : 92);
    final int desired = switch (_qualityPreset) {
      'low' => 44,
      'balanced' => 68,
      'crisp' => 88,
      _ => (cfg.isSnapshotOnlyMode || cfg.targetFps <= 10)
          ? 42
          : (cfg.targetFps <= 20 ? 60 : 78),
    };
    return min(desired, thermalCap);
  }

  int _effectiveTargetFps(ThermalConfig cfg) {
    final int prefFps = widget.targetFps > 0 ? widget.targetFps : 30;
    final int govFps = cfg.targetFps > 0 ? cfg.targetFps : 30;
    return min(prefFps, govFps);
  }

  Duration get _effectiveLongPressDelay =>
      Duration(milliseconds: widget.longPressDelayMs.clamp(250, 700));

  ({int width, int height, int maxW, int maxH}) _computeNegotiatedViewport(
    int rawWidth,
    int rawHeight,
    ThermalConfig cfg,
  ) {
    final int? rtt = _latencyNotifier.value ?? _connectionSnapshot.latencyMs;
    final bool autoStepDown = (rtt != null && rtt > 60) ||
        cfg.targetFps <= 20 ||
        cfg.isSnapshotOnlyMode;

    final (int capW, int capH) = switch (_qualityPreset) {
      'low' => (960, 540),
      'balanced' => (1280, 720),
      'crisp' => (1920, 1080),
      _ => autoStepDown ? (1024, 576) : (1440, 810),
    };

    final int safeRawW = max(1, rawWidth);
    final int safeRawH = max(1, rawHeight);
    final double scale = min(1.0, min(capW / safeRawW, capH / safeRawH));
    final int cappedW = (safeRawW * scale).round().clamp(160, capW);
    final int cappedH = (safeRawH * scale).round().clamp(90, capH);
    return (width: cappedW, height: cappedH, maxW: capW, maxH: capH);
  }

  void _negotiateViewportIfReady() {
    if (!mounted || !_isAuthenticated) return;
    final int rawW =
        _lastRawPhysicalWidth > 0 ? _lastRawPhysicalWidth : _lastPhysicalWidth;
    final int rawH =
        _lastRawPhysicalHeight > 0 ? _lastRawPhysicalHeight : _lastPhysicalHeight;
    if (rawW <= 0 || rawH <= 0) return;

    final ThermalConfig cfg = ThermalGovernor.instance.currentConfig;
    final capped = _computeNegotiatedViewport(rawW, rawH, cfg);
    _lastPhysicalWidth = capped.width;
    _lastPhysicalHeight = capped.height;
    _lastCapMaxWidth = capped.maxW;
    _lastCapMaxHeight = capped.maxH;
    _sendViewportNegotiation(
      capped.width,
      capped.height,
      _qualityForThermalAndPreset(cfg),
      maxWidth: capped.maxW,
      maxHeight: capped.maxH,
    );
  }

  void _armFrameRecoveryTimer() {
    _frameRecoveryTimer?.cancel();
    if (_hasReceivedFrame) return;
    _frameRecoveryTimer = Timer(const Duration(milliseconds: 2200), () {
      if (!mounted || _hasReceivedFrame) return;
      final client = _client;
      if (client != null && client.isVaultEstablished) {
        client.requestKeyframe();
      }
    });
  }

  void _onThermalConfigChanged() {
    if (!mounted || !_isAuthenticated) return;
    final int rawW =
        _lastRawPhysicalWidth > 0 ? _lastRawPhysicalWidth : _lastPhysicalWidth;
    final int rawH =
        _lastRawPhysicalHeight > 0 ? _lastRawPhysicalHeight : _lastPhysicalHeight;
    if (rawW <= 0 || rawH <= 0) return;

    final ThermalConfig cfg = ThermalGovernor.instance.currentConfig;
    final capped = _computeNegotiatedViewport(rawW, rawH, cfg);
    _lastPhysicalWidth = capped.width;
    _lastPhysicalHeight = capped.height;
    _lastCapMaxWidth = capped.maxW;
    _lastCapMaxHeight = capped.maxH;

    final int targetQuality = _qualityForThermalAndPreset(cfg);
    final int targetFps = _effectiveTargetFps(cfg);
    if (targetQuality != _lastSentQuality ||
        targetFps != _lastSentFps ||
        (capped.width - _lastSentPhysicalWidth).abs() > 16 ||
        (capped.height - _lastSentPhysicalHeight).abs() > 16 ||
        capped.maxW != _lastSentCapMaxWidth ||
        capped.maxH != _lastSentCapMaxHeight) {
      _sendViewportNegotiation(
        capped.width,
        capped.height,
        targetQuality,
        maxWidth: capped.maxW,
        maxHeight: capped.maxH,
      );
    }
  }

  void _armHudAutoHide() {
    _hudAutoHideTimer?.cancel();
    if (!widget.collapsibleHud ||
        !_hudVisible ||
        !_hasReceivedFrame ||
        !_isConnected ||
        _showKeyboardBar) {
      return;
    }
    _hudAutoHideTimer = Timer(_hudAutoHideDelay, () {
      if (!mounted || !widget.collapsibleHud || _showKeyboardBar) return;
      if (_hudVisible && _isConnected && _hasReceivedFrame) {
        setState(() => _hudVisible = false);
      }
    });
  }

  void _setHudVisible(bool visible) {
    _hapticLight();
    setState(() => _hudVisible = visible);
    if (visible) {
      _armHudAutoHide();
    } else {
      _hudAutoHideTimer?.cancel();
    }
  }

  void _connect({bool notify = true}) {
    void applyState(VoidCallback fn) {
      if (notify && mounted) {
        setState(fn);
      } else {
        fn();
      }
    }

    _cleanupSocket();
    final secret = widget.sharedSecret.trim();
    if (!NetworkValidators.isValidIpOrHost(widget.hostIp) ||
        !NetworkValidators.isValidPort(widget.wsPort)) {
      const msg = 'Invalid host IP or WebSocket port.';
      applyState(() {
        _isConnected = false;
        _isAuthenticated = false;
        _isConnecting = false;
        _errorMessage = msg;
        _errorHint = HostConnectionClient.buildErrorHint(
          msg,
          port: widget.wsPort,
          useTls: widget.useTls,
        );
        _connectionSnapshot = HostConnectionSnapshot(
          phase: HostConnectionPhase.disconnected,
          errorMessage: msg,
          errorHint: _errorHint,
        );
      });
      return;
    }
    if (secret.isEmpty) {
      const msg = 'Pairing secret required before connecting to host stream.';
      applyState(() {
        _isConnected = false;
        _isAuthenticated = false;
        _isConnecting = false;
        _errorMessage = msg;
        _errorHint = HostConnectionClient.buildErrorHint(
          msg,
          port: widget.wsPort,
          useTls: widget.useTls,
        );
        _connectionSnapshot = HostConnectionSnapshot(
          phase: HostConnectionPhase.authFailed,
          errorMessage: msg,
          errorHint: _errorHint,
        );
      });
      return;
    }

    final client = HostConnectionPool.instance.acquire(
      hostIp: widget.hostIp,
      port: widget.wsPort,
      sharedSecret: secret,
      useTls: widget.useTls,
      certFingerprint: widget.certFingerprint,
    );
    client.retain();
    _client = client;
    _retainedClient = client;

    // Hydrate immediately from pooled connection state so fullscreen / re-mounted viewports never stall
    final HostConnectionSnapshot initialSnap = client.snapshot;
    final Uint8List? cachedFrame = client.lastFrame;
    final bool hasCachedFrame = cachedFrame != null && cachedFrame.isNotEmpty;
    _latencyNotifier.value = initialSnap.latencyMs;
    applyState(() {
      _connectionSnapshot = initialSnap;
      _isConnecting = initialSnap.isConnecting ||
          initialSnap.phase == HostConnectionPhase.reconnecting ||
          !initialSnap.isVaultEstablished;
      _isConnected = initialSnap.isConnected;
      _isAuthenticated = initialSnap.isVaultEstablished;
      _hasReceivedFrame = hasCachedFrame;
      _errorMessage =
          (initialSnap.errorMessage != null && !initialSnap.isVaultEstablished)
              ? initialSnap.errorMessage
              : null;
      _errorHint =
          (initialSnap.errorHint != null && !initialSnap.isVaultEstablished)
              ? initialSnap.errorHint
              : null;
    });

    if (initialSnap.isVaultEstablished) {
      _negotiateViewportIfReady();
      client.requestDisplayEnum();
      client.requestKeyframe();
      if (!hasCachedFrame) {
        _armFrameRecoveryTimer();
      } else {
        _armHudAutoHide();
      }
    }

    _stateSub = client.stateStream.listen((snap) {
      if (!mounted) return;
      final wasAuthed = _isAuthenticated;
      _latencyNotifier.value = snap.latencyMs;
      final String? nextError =
          (snap.errorMessage != null && !snap.isVaultEstablished)
              ? snap.errorMessage
              : (snap.isVaultEstablished ? null : _errorMessage);
      final String? nextHint =
          (snap.errorHint != null && !snap.isVaultEstablished)
              ? snap.errorHint
              : (snap.isVaultEstablished ? null : _errorHint);
      final bool statusChanged = _isConnecting != snap.isConnecting ||
          _isConnected != snap.isConnected ||
          _isAuthenticated != snap.isVaultEstablished ||
          _errorMessage != nextError ||
          _errorHint != nextHint ||
          _connectionSnapshot.phase != snap.phase ||
          _connectionSnapshot.reconnectAttempt != snap.reconnectAttempt;
      _connectionSnapshot = snap;
      if (statusChanged) {
        setState(() {
          _isConnecting = snap.isConnecting;
          _isConnected = snap.isConnected;
          _isAuthenticated = snap.isVaultEstablished;
          _errorMessage = nextError;
          _errorHint = nextHint;
        });
      }
      if (!wasAuthed && snap.isVaultEstablished) {
        _negotiateViewportIfReady();
        client.requestDisplayEnum();
        client.requestKeyframe();
        _armFrameRecoveryTimer();
      } else if (snap.isVaultEstablished &&
          _qualityPreset == 'auto' &&
          _lastRawPhysicalWidth > 0) {
        final capped = _computeNegotiatedViewport(
          _lastRawPhysicalWidth,
          _lastRawPhysicalHeight,
          ThermalGovernor.instance.currentConfig,
        );
        if (capped.maxW != _lastSentCapMaxWidth ||
            capped.maxH != _lastSentCapMaxHeight) {
          _negotiateViewportIfReady();
        }
      }
    });

    _telemetrySub = client.telemetryStream.listen((decoded) {
      if (!mounted) return;
      final bool nextViewOnly = decoded['view_only_mode'] == true;
      if (nextViewOnly != _hostViewOnly) {
        setState(() => _hostViewOnly = nextViewOnly);
      }
      widget.onTelemetry?.call(decoded);
    });

    _hitlSub = client.hitlChallengeStream.listen((chal) {
      unawaited(client.respondToHitlChallenge(chal));
    });

    _clipSub = client.clipboardStream.listen((text) {
      if (text.isEmpty) return;
      unawaited(
        Clipboard.setData(ClipboardData(text: text)).catchError((_) {}),
      );
      if (mounted) {
        ScaffoldMessenger.maybeOf(context)
          ?..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              content: Text(
                'PC clipboard synced (${text.length} chars)',
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              ),
              duration: const Duration(seconds: 2),
              behavior: SnackBarBehavior.floating,
            ),
          );
      }
    });

    _displaySub = client.displayEnumStream.listen((mons) {
      if (!mounted) return;
      setState(() {
        _monitors = mons;
        _activeMonitorIdx = client.activeMonitorIndex;
      });
    });

    _frameSub = client.frameStream.listen((frameBytes) {
      if (!mounted || !_isAuthenticated) return;
      _frameRecoveryTimer?.cancel();
      final cfg = ThermalGovernor.instance.currentConfig;
      final int effectiveFps = _effectiveTargetFps(cfg);
      final int minIntervalMs = (1000 ~/ effectiveFps).clamp(1, 1000);
      final now = DateTime.now();
      if (effectiveFps < 60 &&
          now.difference(_lastUiFrameAt).inMilliseconds < minIntervalMs) {
        client.sendFrameAck(client.lastFrameSeq);
        return; // Respect configured target FPS and thermal throttle ceiling
      }
      _lastUiFrameAt = now;
      _fpsCount++;
      if (!_frameController.isClosed) {
        _frameController.add(frameBytes);
      }
      if (!_isConnected || _isConnecting || !_hasReceivedFrame) {
        setState(() {
          _hasReceivedFrame = true;
          _isConnected = true;
          _isConnecting = false;
        });
        _armHudAutoHide();
      }
    });

    if (!initialSnap.isVaultEstablished) {
      unawaited(client.ensureConnected().catchError((_) {}));
    }
  }

  void _handleReconnect() {
    _hapticLight();
    final client = _client;
    if (client == null) {
      _connect();
      return;
    }
    setState(() {
      _isConnecting = true;
      _errorMessage = null;
      _errorHint = null;
    });
    unawaited(client.reconnectNow().catchError((_) {}));
  }

  void _sendViewportNegotiation(
    int width,
    int height,
    int quality, {
    int? maxWidth,
    int? maxHeight,
  }) {
    final client = _client;
    if (client == null || !client.isVaultEstablished) return;
    final int fps = _effectiveTargetFps(ThermalGovernor.instance.currentConfig);
    if (client.sendViewportConfig(
      width: width,
      height: height,
      quality: quality,
      fps: fps,
      frameAck: true,
      maxWidth: maxWidth ?? _lastCapMaxWidth,
      maxHeight: maxHeight ?? _lastCapMaxHeight,
    )) {
      _lastSentPhysicalWidth = width;
      _lastSentPhysicalHeight = height;
      _lastSentCapMaxWidth = maxWidth ?? _lastCapMaxWidth;
      _lastSentCapMaxHeight = maxHeight ?? _lastCapMaxHeight;
      _lastSentQuality = quality;
      _lastSentFps = fps;
    }
  }

  /// Sends 0x0A VIEWPORT_RESIZE when container layout changes (deferred post-frame)
  void _syncPhysicalViewport(BoxConstraints constraints, BuildContext context) {
    if (!constraints.hasBoundedWidth || constraints.maxWidth <= 0) return;

    final renderWidth = constraints.maxWidth;
    final renderHeight =
        (constraints.hasBoundedHeight && constraints.maxHeight > 0)
            ? constraints.maxHeight
            : renderWidth * (9.0 / 16.0);
    final Size nextContainerSize = Size(renderWidth, renderHeight);
    final bool containerChanged =
        (_lastContainerSize.width - nextContainerSize.width).abs() > 1.0 ||
            (_lastContainerSize.height - nextContainerSize.height).abs() > 1.0;
    _lastContainerSize = nextContainerSize;

    if (containerChanged &&
        !_zoomTransform.isIdentity() &&
        !_zoomClampScheduled) {
      _zoomClampScheduled = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _zoomClampScheduled = false;
        if (!mounted || _zoomTransform.isIdentity()) return;
        setState(() {
          _zoomTransform = TouchCoordinateMapper.clampZoomTransform(
            transform: _zoomTransform,
            containerSize: _lastContainerSize,
          );
        });
      });
    }

    final dpr = MediaQuery.devicePixelRatioOf(context);
    final int rawPhysicalWidth = (renderWidth * dpr).round();
    final int rawPhysicalHeight = (renderHeight * dpr).round();
    _lastRawPhysicalWidth = rawPhysicalWidth;
    _lastRawPhysicalHeight = rawPhysicalHeight;

    final ThermalConfig thermalCfg = ThermalGovernor.instance.currentConfig;
    final capped = _computeNegotiatedViewport(
      rawPhysicalWidth,
      rawPhysicalHeight,
      thermalCfg,
    );
    _lastPhysicalWidth = capped.width;
    _lastPhysicalHeight = capped.height;
    _lastCapMaxWidth = capped.maxW;
    _lastCapMaxHeight = capped.maxH;

    final int targetQuality = _qualityForThermalAndPreset(thermalCfg);
    final int targetFps = _effectiveTargetFps(thermalCfg);
    final dimensionsChanged =
        (capped.width - _lastSentPhysicalWidth).abs() > 16 ||
            (capped.height - _lastSentPhysicalHeight).abs() > 16 ||
            capped.maxW != _lastSentCapMaxWidth ||
            capped.maxH != _lastSentCapMaxHeight ||
            targetQuality != _lastSentQuality ||
            targetFps != _lastSentFps;
    if (dimensionsChanged &&
        _client != null &&
        _isConnected &&
        _isAuthenticated &&
        !_resizeScheduled) {
      _resizeScheduled = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _resizeScheduled = false;
        if (!mounted || _client == null || !_isAuthenticated) return;
        _sendViewportNegotiation(
          _lastPhysicalWidth,
          _lastPhysicalHeight,
          targetQuality,
          maxWidth: _lastCapMaxWidth,
          maxHeight: _lastCapMaxHeight,
        );
      });
    }
  }

  // ===================================================================
  // VIRTUAL INPUT & DIRECT TOUCHSCREEN ENGINE (OPCODE 0x08 OVER AEAD)
  // ===================================================================
  void _sendLegacyBinaryInputPacket(
    int eventType,
    int dx,
    int dy,
    int btnCode,
  ) {
    final client = _client;
    if (client == null || !client.isVaultEstablished) return;
    final Uint8List buf = Uint8List(6);
    final ByteData bd = ByteData.sublistView(buf);
    bd.setUint8(0, eventType);
    bd.setInt16(1, dx.clamp(-5000, 5000), Endian.big);
    bd.setInt16(3, dy.clamp(-5000, 5000), Endian.big);
    bd.setUint8(5, btnCode);
    client.sendEncrypted(BinaryOpcode.input, buf);
  }

  void _flushCoalescedInput() {
    _lastInputFlushAt = DateTime.now();
    final client = _client;
    if (client == null || !client.isVaultEstablished) {
      _pendingAbsMove = null;
      _accumRelDx = 0.0;
      _accumRelDy = 0.0;
      _accumScrollDx = 0.0;
      _accumScrollDy = 0.0;
      return;
    }

    final Offset? pendingAbs = _pendingAbsMove;
    if (pendingAbs != null) {
      _pendingAbsMove = null;
      client.sendAbsoluteMouseMove(pendingAbs.dx, pendingAbs.dy);
    }

    if (_accumRelDx.abs() >= 1.0 || _accumRelDy.abs() >= 1.0) {
      final int dx = _accumRelDx.round().clamp(-5000, 5000);
      final int dy = _accumRelDy.round().clamp(-5000, 5000);
      _accumRelDx -= dx;
      _accumRelDy -= dy;
      if (dx != 0 || dy != 0) {
        _sendLegacyBinaryInputPacket(1, dx, dy, 0);
      }
    }

    if (_accumScrollDx.abs() >= 1.0 || _accumScrollDy.abs() >= 1.0) {
      final int sdx = _accumScrollDx.round().clamp(-5000, 5000);
      final int sdy = _accumScrollDy.round().clamp(-5000, 5000);
      _accumScrollDx -= sdx;
      _accumScrollDy -= sdy;
      if (sdx != 0 || sdy != 0) {
        client.sendScroll2D(sdx, sdy);
      }
    }
  }

  bool _hasPendingCoalescedInput() =>
      _pendingAbsMove != null ||
      _accumRelDx.abs() >= 1.0 ||
      _accumRelDy.abs() >= 1.0 ||
      _accumScrollDx.abs() >= 1.0 ||
      _accumScrollDy.abs() >= 1.0;

  void _onCoalesceWindowEnd() {
    if (!mounted || !_hasPendingCoalescedInput()) return;
    _flushCoalescedInput();
  }

  void _scheduleInputFlush() {
    if (_inputFlushTimer?.isActive ?? false) return;
    final DateTime now = DateTime.now();
    final Duration sinceLast = now.difference(_lastInputFlushAt);
    if (sinceLast >= _inputCoalesceInterval) {
      _flushCoalescedInput();
      _inputFlushTimer = Timer(_inputCoalesceInterval, _onCoalesceWindowEnd);
    } else {
      final Duration remaining = _inputCoalesceInterval - sinceLast;
      _inputFlushTimer = Timer(remaining, _onCoalesceWindowEnd);
    }
  }

  void _sendVirtualInput(Map<String, dynamic> actionMap) {
    final client = _client;
    if (client == null || !client.isVaultEstablished) return;
    try {
      final payload = Uint8List.fromList(utf8.encode(jsonEncode(actionMap)));
      client.sendEncrypted(BinaryOpcode.input, payload);
    } catch (e) {
      debugPrint('Virtual input send error: $e');
    }
  }

  void _sendTrackpadRel(double dx, double dy) {
    if (dx.abs() < 0.08 && dy.abs() < 0.08) return;
    final double speed = sqrt(dx * dx + dy * dy);
    final double sensitivity = widget.trackpadSensitivity.clamp(0.6, 3.0);
    // Smooth velocity curve: surgical precision on slow drags, brisk traversal on flicks
    final double accel = 0.72 + (0.50 * (speed / 12.0).clamp(0.0, 2.2));
    final double gain = sensitivity * accel;
    _accumRelDx += (dx * gain).clamp(-160.0, 160.0);
    _accumRelDy += (dy * gain).clamp(-160.0, 160.0);
    _scheduleInputFlush();
  }

  void _sendRelativeMouseClick(String button) {
    _flushCoalescedInput();
    final int code = switch (button) {
      'right' => 2,
      'middle' => 3,
      'double' => 4,
      _ => 1,
    };
    _sendLegacyBinaryInputPacket(2, 0, 0, code);
  }

  void _sendKeyboardText(String text, {bool pressEnter = false}) {
    _sendVirtualInput({
      'action': 'type',
      'text': text,
      'press_enter': pressEnter,
    });
  }

  void _sendHotkey(List<String> keys) {
    _sendVirtualInput({'action': 'hotkey', 'keys': keys});
  }

  void _sendKey(String key) {
    _sendVirtualInput({'action': 'key', 'key': key});
  }

  Size get _effectiveFrameSize {
    if (_decodedFrameSize != null &&
        _decodedFrameSize!.width > 0 &&
        _decodedFrameSize!.height > 0) {
      return _decodedFrameSize!;
    }
    if (_lastPhysicalWidth > 0 && _lastPhysicalHeight > 0) {
      return Size(
        _lastPhysicalWidth.toDouble(),
        _lastPhysicalHeight.toDouble(),
      );
    }
    return _lastContainerSize;
  }

  MappedTouchPoint _mapLocalPosition(Offset localPosition) {
    return TouchCoordinateMapper.mapToNormalized(
      localPosition: localPosition,
      containerSize: _lastContainerSize,
      frameSize: _effectiveFrameSize,
      fit: _videoFit,
      transform: _zoomTransform,
    );
  }

  Offset _visualPositionForMapped(MappedTouchPoint mapped, Offset rawLocal) {
    if (mapped.isInsideVideo) return rawLocal;
    return TouchCoordinateMapper.normalizedToViewport(
      normalized: mapped.normalized,
      containerSize: _lastContainerSize,
      frameSize: _effectiveFrameSize,
      fit: _videoFit,
      transform: _zoomTransform,
    );
  }

  void _cancelLongPressTimers() {
    _longPressTimer?.cancel();
    _longPressTimer = null;
    _longPressVisualTimer?.cancel();
    _longPressVisualTimer = null;
    _feedbackController.cancelLongPress();
  }

  void _cancelPendingTouchTimers() {
    _cancelLongPressTimers();
    _pendingSingleTapTimer?.cancel();
    _pendingSingleTapTimer = null;
  }

  void _releaseHeldMouseButton() {
    if (!_mouseButtonHeld) return;
    _mouseButtonHeld = false;
    _flushCoalescedInput();
    _client?.sendAbsoluteMouseButton(
      _lastNormalizedPos.dx,
      _lastNormalizedPos.dy,
      actionCode: 2,
    );
    _feedbackController.clearCursor();
  }

  void _handlePointerDown(PointerDownEvent event) {
    _activePointers[event.pointer] = event.localPosition;

    if (_activePointers.length == 1) {
      _suppressOneFingerUntilAllUp = false;
      _primaryPointerId = event.pointer;
      _primaryDownPos = event.localPosition;
      _primaryLastPos = event.localPosition;
      _primaryMovedBeyondSlop = false;
      _longPressFired = false;

      final DateTime now = DateTime.now();
      final bool withinDoubleTap = _lastTapUpAt != null &&
          _lastTapUpPos != null &&
          now.difference(_lastTapUpAt!) <= _doubleTapWindow &&
          (event.localPosition - _lastTapUpPos!).distance <= 36.0;
      _isPotentialDoubleTap = withinDoubleTap;
      if (withinDoubleTap) {
        // Cancel pending single tap so tap 2 becomes either double-click or double-tap-drag
        _pendingSingleTapTimer?.cancel();
        _pendingSingleTapTimer = null;
      }

      if (_inputMode != _StreamInputMode.trackpad) {
        final MappedTouchPoint mapped = _mapLocalPosition(event.localPosition);
        _lastNormalizedPos = mapped.normalized;
        final Offset visualPos =
            _visualPositionForMapped(mapped, event.localPosition);

        if (_inputMode == _StreamInputMode.drag) {
          _mouseButtonHeld = true;
          _client?.sendAbsoluteMouseButton(
            mapped.nx,
            mapped.ny,
            actionCode: 1,
          );
          _feedbackController.updateCursor(visualPos, isDragging: true);
          _feedbackController.triggerRipple(
            visualPos,
            style: TouchRippleStyle.dragStart,
          );
          _hapticLight();
          return;
        }

        // Direct Touchscreen mode: snap cursor under finger immediately
        _client?.sendAbsoluteMouseMove(mapped.nx, mapped.ny);
        _feedbackController.updateCursor(visualPos, isDragging: false);
      }

      // Arm long-press right-click (suppressed on double-tap-and-hold)
      if (!_isPotentialDoubleTap) {
        final Offset downPos = event.localPosition;
        final Duration longPressDelay = _effectiveLongPressDelay;
        _longPressVisualTimer?.cancel();
        _longPressVisualTimer = Timer(_longPressRingDelay, () {
          if (!mounted || _primaryMovedBeyondSlop || _activePointers.length != 1) {
            return;
          }
          final Offset ringPos = _inputMode == _StreamInputMode.trackpad
              ? downPos
              : _visualPositionForMapped(_mapLocalPosition(downPos), downPos);
          _feedbackController.startLongPress(
            ringPos,
            duration: longPressDelay - _longPressRingDelay,
          );
        });

        _longPressTimer?.cancel();
        _longPressTimer = Timer(longPressDelay, () {
          if (!mounted || _primaryMovedBeyondSlop || _activePointers.length != 1) {
            return;
          }
          _longPressFired = true;
          _hapticMedium();
          if (_inputMode == _StreamInputMode.trackpad) {
            _feedbackController.completeLongPress(downPos);
            _sendRelativeMouseClick('right');
          } else {
            final MappedTouchPoint mapped = _mapLocalPosition(downPos);
            _lastNormalizedPos = mapped.normalized;
            final Offset visualPos = _visualPositionForMapped(mapped, downPos);
            _feedbackController.completeLongPress(visualPos);
            _client?.sendAbsoluteMouseClick(
              mapped.nx,
              mapped.ny,
              buttonCode: 2,
            );
          }
        });
      }
    } else if (_activePointers.length == 2) {
      // Transition cleanly into 2-finger mode (scroll / pinch-zoom / 2-finger tap)
      _cancelPendingTouchTimers();
      _releaseHeldMouseButton();
      _suppressOneFingerUntilAllUp = true;

      final List<Offset> pts = _activePointers.values.toList(growable: false);
      _twoFingerStartAt = DateTime.now();
      _twoFingerStartDist = (pts[0] - pts[1]).distance;
      _twoFingerStartMid = (pts[0] + pts[1]) * 0.5;
      _twoFingerPrevMid = _twoFingerStartMid;
      _twoFingerStartScale = TouchCoordinateMapper.extractScale(_zoomTransform);
      _twoFingerMaxMidMove = 0.0;
      _twoFingerMode = _TwoFingerMode.undecided;
    } else {
      // 3+ fingers: abort single-finger timers cleanly
      _cancelPendingTouchTimers();
      _releaseHeldMouseButton();
      _suppressOneFingerUntilAllUp = true;
    }
  }

  void _handlePointerMove(PointerMoveEvent event) {
    if (!_activePointers.containsKey(event.pointer)) return;
    _activePointers[event.pointer] = event.localPosition;

    if (_activePointers.length == 2) {
      final List<Offset> pts = _activePointers.values.toList(growable: false);
      final double dist = (pts[0] - pts[1]).distance;
      final Offset mid = (pts[0] + pts[1]) * 0.5;
      final Offset midDelta = mid - _twoFingerPrevMid;
      final double midMoveFromStart = (mid - _twoFingerStartMid).distance;
      if (midMoveFromStart > _twoFingerMaxMidMove) {
        _twoFingerMaxMidMove = midMoveFromStart;
      }

      final double scaleRatio =
          _twoFingerStartDist > 12.0 ? (dist / _twoFingerStartDist) : 1.0;

      if (_twoFingerMode == _TwoFingerMode.undecided) {
        final bool alreadyZoomed =
            widget.pinchZoomEnabled && _twoFingerStartScale > 1.02;
        if (alreadyZoomed) {
          if (midMoveFromStart > 4.0 || (scaleRatio - 1.0).abs() > 0.04) {
            _twoFingerMode = _TwoFingerMode.zoomPan;
          }
        } else if (widget.pinchZoomEnabled &&
            (scaleRatio - 1.0).abs() > 0.10) {
          _twoFingerMode = _TwoFingerMode.zoomPan;
        } else if (midMoveFromStart > 10.0) {
          _twoFingerMode = _TwoFingerMode.scroll;
        }
      }

      if (_twoFingerMode == _TwoFingerMode.zoomPan && widget.pinchZoomEnabled) {
        final double nextScale =
            (_twoFingerStartScale * scaleRatio).clamp(1.0, 4.0);
        final Matrix4 nextTransform = TouchCoordinateMapper.computeZoomPanMatrix(
          currentTransform: _zoomTransform,
          targetScale: nextScale,
          previousFocalPoint: _twoFingerPrevMid,
          currentFocalPoint: mid,
          containerSize: _lastContainerSize,
        );
        setState(() => _zoomTransform = nextTransform);
      } else if (_twoFingerMode == _TwoFingerMode.scroll) {
        final double dir = widget.naturalScroll ? 1.0 : -1.0;
        final double sens = widget.scrollSensitivity.clamp(0.5, 3.0);
        _accumScrollDx += (midDelta.dx * dir) * sens;
        _accumScrollDy += (midDelta.dy * dir) * (sens * 1.25);
        _scheduleInputFlush();
      }

      _twoFingerPrevMid = mid;
      return;
    }

    if (_activePointers.length != 1 ||
        _suppressOneFingerUntilAllUp ||
        event.pointer != _primaryPointerId) {
      return;
    }

    final Offset? downPos = _primaryDownPos;
    final Offset? prevPos = _primaryLastPos;
    _primaryLastPos = event.localPosition;

    if (downPos != null &&
        !_primaryMovedBeyondSlop &&
        (event.localPosition - downPos).distance > _tapSlopPx) {
      _primaryMovedBeyondSlop = true;
      _cancelLongPressTimers();

      // Double-tap-and-hold drag engagement in direct touchscreen mode!
      if (_isPotentialDoubleTap &&
          !_mouseButtonHeld &&
          _inputMode == _StreamInputMode.touch) {
        final MappedTouchPoint startMapped = _mapLocalPosition(downPos);
        _lastNormalizedPos = startMapped.normalized;
        _mouseButtonHeld = true;
        _client?.sendAbsoluteMouseButton(
          startMapped.nx,
          startMapped.ny,
          actionCode: 1,
        );
        final Offset visualStart =
            _visualPositionForMapped(startMapped, downPos);
        _feedbackController.triggerRipple(
          visualStart,
          style: TouchRippleStyle.dragStart,
        );
        _hapticLight();
      }
    }

    if (_longPressFired) return;

    if (_inputMode == _StreamInputMode.trackpad) {
      if (prevPos != null) {
        final double dx = event.localPosition.dx - prevPos.dx;
        final double dy = event.localPosition.dy - prevPos.dy;
        _sendTrackpadRel(dx, dy);
      }
      return;
    }

    // Direct Touchscreen / Drag cursor tracking (leading-edge 8ms coalesced)
    final MappedTouchPoint mapped = _mapLocalPosition(event.localPosition);
    _lastNormalizedPos = mapped.normalized;
    _pendingAbsMove = mapped.normalized;
    _scheduleInputFlush();
    final Offset visualPos =
        _visualPositionForMapped(mapped, event.localPosition);
    _feedbackController.updateCursor(visualPos, isDragging: _mouseButtonHeld);
  }

  void _handlePointerUpOrCancel(
    int pointer,
    Offset localPosition, {
    required bool isCancel,
  }) {
    final int countBefore = _activePointers.length;
    _activePointers.remove(pointer);

    // Detect crisp 2-finger tap -> right-click when leaving 2-finger state
    if (countBefore == 2 && !isCancel) {
      final DateTime? startAt = _twoFingerStartAt;
      final bool isQuickTwoFingerTap =
          _twoFingerMode == _TwoFingerMode.undecided &&
              _twoFingerMaxMidMove < 14.0 &&
              startAt != null &&
              DateTime.now().difference(startAt) <=
                  const Duration(milliseconds: 280);
      if (isQuickTwoFingerTap) {
        _twoFingerStartAt = null;
        _hapticMedium();
        if (_inputMode == _StreamInputMode.trackpad) {
          _feedbackController.triggerRipple(
            _twoFingerStartMid,
            style: TouchRippleStyle.rightClick,
          );
          _sendRelativeMouseClick('right');
        } else {
          final MappedTouchPoint mapped =
              _mapLocalPosition(_twoFingerStartMid);
          _lastNormalizedPos = mapped.normalized;
          final Offset visualPos =
              _visualPositionForMapped(mapped, _twoFingerStartMid);
          _feedbackController.triggerRipple(
            visualPos,
            style: TouchRippleStyle.rightClick,
          );
          _client?.sendAbsoluteMouseClick(
            mapped.nx,
            mapped.ny,
            buttonCode: 2,
          );
        }
      }
    }

    if (pointer == _primaryPointerId) {
      _cancelLongPressTimers();
      _inputFlushTimer?.cancel();
      _inputFlushTimer = null;
      _flushCoalescedInput();

      if (_mouseButtonHeld) {
        final MappedTouchPoint mapped = _mapLocalPosition(localPosition);
        _lastNormalizedPos = mapped.normalized;
        _mouseButtonHeld = false;
        _client?.sendAbsoluteMouseButton(
          mapped.nx,
          mapped.ny,
          actionCode: 2,
        );
        final Offset visualPos =
            _visualPositionForMapped(mapped, localPosition);
        _feedbackController.triggerRipple(
          visualPos,
          style: TouchRippleStyle.dragEnd,
        );
        _feedbackController.clearCursor();
      } else if (!_suppressOneFingerUntilAllUp &&
          !_primaryMovedBeyondSlop &&
          !_longPressFired &&
          !isCancel) {
        if (_isPotentialDoubleTap) {
          _lastTapUpAt = null;
          _lastTapUpPos = null;
          _hapticLight();
          if (widget.instantTapMode) {
            if (_inputMode == _StreamInputMode.trackpad) {
              _feedbackController.triggerRipple(
                localPosition,
                style: TouchRippleStyle.doubleTap,
              );
              _sendRelativeMouseClick('left');
            } else {
              final MappedTouchPoint mapped = _mapLocalPosition(localPosition);
              _lastNormalizedPos = mapped.normalized;
              final Offset visualPos =
                  _visualPositionForMapped(mapped, localPosition);
              _feedbackController.triggerRipple(
                visualPos,
                style: TouchRippleStyle.doubleTap,
              );
              _client?.sendAbsoluteMouseClick(
                mapped.nx,
                mapped.ny,
                buttonCode: 1,
              );
            }
          } else {
            if (_inputMode == _StreamInputMode.trackpad) {
              _feedbackController.triggerRipple(
                localPosition,
                style: TouchRippleStyle.doubleTap,
              );
              _sendRelativeMouseClick('double');
            } else {
              final MappedTouchPoint mapped = _mapLocalPosition(localPosition);
              _lastNormalizedPos = mapped.normalized;
              final Offset visualPos =
                  _visualPositionForMapped(mapped, localPosition);
              _feedbackController.triggerRipple(
                visualPos,
                style: TouchRippleStyle.doubleTap,
              );
              _client?.sendAbsoluteMouseClick(
                mapped.nx,
                mapped.ny,
                buttonCode: 4,
              );
            }
          }
        } else {
          _lastTapUpAt = DateTime.now();
          _lastTapUpPos = localPosition;
          _hapticLight();
          final bool wasTrackpad = _inputMode == _StreamInputMode.trackpad;
          final MappedTouchPoint mapped = _mapLocalPosition(localPosition);
          _lastNormalizedPos = mapped.normalized;
          final Offset visualPos = wasTrackpad
              ? localPosition
              : _visualPositionForMapped(mapped, localPosition);
          _feedbackController.triggerRipple(
            visualPos,
            style: TouchRippleStyle.tap,
          );

          if (widget.instantTapMode) {
            // Zero-delay instant click on finger-up
            if (wasTrackpad) {
              _sendRelativeMouseClick('left');
            } else {
              _client?.sendAbsoluteMouseClick(
                mapped.nx,
                mapped.ny,
                buttonCode: 1,
              );
            }
          } else {
            // Brief disambiguation prevents a 3-click sequence on double-tap
            _pendingSingleTapTimer?.cancel();
            _pendingSingleTapTimer = Timer(_singleTapCommitDelay, () {
              if (!mounted) return;
              if (wasTrackpad) {
                _sendRelativeMouseClick('left');
              } else {
                _client?.sendAbsoluteMouseClick(
                  mapped.nx,
                  mapped.ny,
                  buttonCode: 1,
                );
              }
            });
          }
        }
        _feedbackController.clearCursor();
      } else {
        _feedbackController.clearCursor();
      }

      _primaryPointerId = null;
      _primaryDownPos = null;
      _primaryLastPos = null;
      _isPotentialDoubleTap = false;
    }

    if (_activePointers.isEmpty) {
      _suppressOneFingerUntilAllUp = false;
      _twoFingerMode = _TwoFingerMode.undecided;
    }
  }

  void _cycleQualityPreset() {
    _hapticLight();
    final int idx = kValidStreamQualityPresets.indexOf(_qualityPreset);
    final String next =
        kValidStreamQualityPresets[(idx + 1) % kValidStreamQualityPresets.length];
    setState(() => _qualityPreset = next);
    widget.onQualityPresetChanged?.call(next);
    _negotiateViewportIfReady();
    _armHudAutoHide();
  }

  void _toggleFitMode() {
    _hapticLight();
    setState(() {
      _videoFit = _videoFit == BoxFit.contain ? BoxFit.cover : BoxFit.contain;
    });
    _armHudAutoHide();
  }

  void _resetZoom() {
    _hapticLight();
    setState(() => _zoomTransform = Matrix4.identity());
    _armHudAutoHide();
  }

  void _selectInputMode(_StreamInputMode nextMode) {
    _hapticLight();
    _releaseHeldMouseButton();
    setState(() => _inputMode = nextMode);
    _armHudAutoHide();
  }

  void _toggleKeyboardBar() {
    _hapticLight();
    setState(() {
      _showKeyboardBar = !_showKeyboardBar;
      if (_showKeyboardBar) {
        _hudVisible = true;
        _hudAutoHideTimer?.cancel();
      } else {
        _armHudAutoHide();
      }
    });
  }

  void _openDiagnosticsSheet() {
    _hapticLight();
    _hudAutoHideTimer?.cancel();
    unawaited(
      ConnectionDiagnosticsSheet.show(
        context,
        hostName: widget.hostName,
        hostIp: widget.hostIp,
        wsPort: widget.wsPort,
        useTls: widget.useTls,
        snapshot: _connectionSnapshot,
        currentFps: _fpsNotifier.value,
        frameSize: _decodedFrameSize,
        qualityPreset: _qualityPreset,
        onReconnect: _handleReconnect,
        onRequestKeyframe: () {
          _client?.requestKeyframe();
        },
      ).whenComplete(() {
        if (mounted) _armHudAutoHide();
      }),
    );
  }

  void _cleanupSocket() {
    _releaseHeldMouseButton();
    _cancelPendingTouchTimers();
    _frameRecoveryTimer?.cancel();
    _frameRecoveryTimer = null;
    _inputFlushTimer?.cancel();
    _inputFlushTimer = null;
    _isConnected = false;
    _isAuthenticated = false;
    unawaited(_frameSub?.cancel());
    unawaited(_telemetrySub?.cancel());
    unawaited(_stateSub?.cancel());
    unawaited(_hitlSub?.cancel());
    unawaited(_clipSub?.cancel());
    unawaited(_displaySub?.cancel());
    _frameSub = null;
    _telemetrySub = null;
    _stateSub = null;
    _hitlSub = null;
    _clipSub = null;
    _displaySub = null;
    _retainedClient?.release();
    _retainedClient = null;
    _client = null;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    ThermalGovernor.instance.removeListener(_onThermalConfigChanged);
    _hudAutoHideTimer?.cancel();
    _hudAutoHideTimer = null;
    _fpsTimer?.cancel();
    _fpsTimer = null;
    _cleanupSocket();
    _feedbackController.dispose();
    _fpsNotifier.dispose();
    _latencyNotifier.dispose();
    unawaited(_frameController.close());
    _syncWakelock(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final double currentScale =
        TouchCoordinateMapper.extractScale(_zoomTransform);
    final bool isZoomed = currentScale > 1.02;
    final EdgeInsets safePad =
        widget.isInline ? EdgeInsets.zero : MediaQuery.paddingOf(context);
    final double keyboardInset =
        widget.isInline ? 0.0 : MediaQuery.viewInsetsOf(context).bottom;

    return LayoutBuilder(
      builder: (context, constraints) {
        _syncPhysicalViewport(constraints, context);
        final double maxW =
            constraints.maxWidth.isFinite ? constraints.maxWidth : 390.0;
        final double maxH =
            constraints.maxHeight.isFinite ? constraints.maxHeight : 220.0;

        return RepaintBoundary(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(widget.isInline ? 16 : 0),
            child: Container(
              color: Colors.black,
              child: Stack(
                children: [
                  // 1. Hardware-accelerated video canvas with Matrix4 zoom/pan & 0ms pointer engine
                  Positioned.fill(
                    child: Listener(
                      key: const ValueKey('viewport-touch-surface'),
                      behavior: HitTestBehavior.opaque,
                      onPointerDown: _handlePointerDown,
                      onPointerMove: _handlePointerMove,
                      onPointerUp: (e) => _handlePointerUpOrCancel(
                        e.pointer,
                        e.localPosition,
                        isCancel: false,
                      ),
                      onPointerCancel: (e) => _handlePointerUpOrCancel(
                        e.pointer,
                        e.localPosition,
                        isCancel: true,
                      ),
                      child: ClipRect(
                        child: Stack(
                          children: [
                            Positioned.fill(
                              child: Transform(
                                transform: _zoomTransform,
                                child: ZeroGcVideoRenderer(
                                  frameStream: _frameController.stream,
                                  initialFrame: _client?.lastFrame,
                                  fit: _videoFit,
                                  onFramePresented: () {
                                    final client = _client;
                                    if (client != null &&
                                        client.isVaultEstablished) {
                                      client.sendFrameAck(client.lastFrameSeq);
                                    }
                                  },
                                  onFrameDropped: () {
                                    final client = _client;
                                    if (client != null &&
                                        client.isVaultEstablished) {
                                      client.sendFrameAck(client.lastFrameSeq);
                                    }
                                  },
                                  onFrameSizeChanged: (Size frameSize) {
                                    if (!mounted) return;
                                    if (_decodedFrameSize != frameSize) {
                                      setState(
                                        () => _decodedFrameSize = frameSize,
                                      );
                                    }
                                  },
                                  onRequestKeyframe: (_) {
                                    final client = _client;
                                    if (client != null &&
                                        client.isVaultEstablished) {
                                      client.requestKeyframe();
                                    }
                                  },
                                ),
                              ),
                            ),
                            Positioned.fill(
                              child: TouchFeedbackOverlay(
                                controller: _feedbackController,
                                enabled: widget.touchVisualFeedback,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),

                  // 2. Connection / Handshake / Actionable Error Status Overlay
                  if (!_hasReceivedFrame)
                    Positioned.fill(
                      child: IgnorePointer(
                        ignoring: !_isStatusOverlayInteractive,
                        child: Center(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 360),
                            child: _buildStatusOverlay(context),
                          ),
                        ),
                      ),
                    ),

                  // 3. Top Liquid Glass HUD Bar (collapsible in fullscreen)
                  if (!widget.collapsibleHud || _hudVisible)
                    Positioned(
                      top: safePad.top + 10.0,
                      left: safePad.left + 10.0,
                      right: safePad.right + 10.0,
                      child: _buildHudHeader(context),
                    ),

                  // 4. Floating 1-Tap Zoom Reset Pill (shown whenever zoomed 1.02x–4.0x)
                  if (isZoomed)
                    Positioned(
                      top: safePad.top +
                          ((!widget.collapsibleHud || _hudVisible)
                              ? 52.0
                              : 12.0),
                      right: safePad.right + 12.0,
                      child: _buildZoomResetPill(context, currentScale),
                    ),

                  // 5. Inline Live Remote Keyboard Bar
                  if (_showKeyboardBar)
                    Positioned(
                      left: safePad.left + 10.0,
                      right: safePad.right + 10.0,
                      bottom: max(safePad.bottom, keyboardInset) + 10.0,
                      child: RemoteKeyboardBar(
                        autofocus: false,
                        hapticsEnabled: widget.hapticsEnabled,
                        onTypeText: (text, {bool pressEnter = false}) =>
                            _sendKeyboardText(text, pressEnter: pressEnter),
                        onKey: _sendKey,
                        onHotkey: _sendHotkey,
                        onClose: _toggleKeyboardBar,
                      ),
                    ),

                  // 6. Bottom Interactive Remote Control Dock
                  if (_isConnected &&
                      !_showKeyboardBar &&
                      (!widget.collapsibleHud || _hudVisible))
                    Positioned(
                      bottom: safePad.bottom + 10.0,
                      left: safePad.left + 10.0,
                      right: safePad.right +
                          (widget.onToggleFullscreen != null ? 58.0 : 10.0),
                      child: Align(
                        alignment: Alignment.bottomLeft,
                        child: SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          physics: const BouncingScrollPhysics(),
                          child: _buildInteractiveControllerDock(context),
                        ),
                      ),
                    ),

                  // 7. Bottom-Right Fullscreen Toggle Orb (inline mode)
                  if (widget.onToggleFullscreen != null &&
                      !_showKeyboardBar &&
                      (!widget.collapsibleHud || _hudVisible))
                    Positioned(
                      bottom: safePad.bottom + 10.0,
                      right: safePad.right + 10.0,
                      child: _buildFullscreenToggleOrb(context),
                    ),

                  // 8. Sleek Draggable Restore Pill (when HUD is collapsed in fullscreen)
                  if (widget.collapsibleHud && !_hudVisible)
                    _buildDraggableRestorePill(
                      context: context,
                      maxW: maxW,
                      maxH: maxH,
                      safePad: safePad,
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildZoomResetPill(BuildContext context, double scale) {
    final CyberPalette palette = context.palette;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: const ValueKey('viewport-zoom-reset-pill'),
        onTap: _resetZoom,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: palette.surfaceElevated.withValues(alpha: 0.90),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: palette.primary.withValues(alpha: 0.65)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.28),
                blurRadius: 10,
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.zoom_out_map_rounded, size: 14, color: palette.primary),
              const SizedBox(width: 4),
              Text(
                '${scale.toStringAsFixed(1)}x · 1x',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 10.5,
                  fontWeight: FontWeight.w800,
                  color: palette.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDraggableRestorePill({
    required BuildContext context,
    required double maxW,
    required double maxH,
    required EdgeInsets safePad,
  }) {
    final CyberPalette palette = context.palette;
    const double pillW = 92.0;
    const double pillH = 34.0;
    final double minX = safePad.left + 8.0;
    final double maxX = max(minX, maxW - safePad.right - pillW - 8.0);
    final double minY = safePad.top + 8.0;
    final double maxY = max(minY, maxH - safePad.bottom - pillH - 8.0);

    final Offset current = _restorePillOffset ?? Offset(minX, minY);
    final double clampedX = current.dx.clamp(minX, maxX);
    final double clampedY = current.dy.clamp(minY, maxY);

    return Positioned(
      left: clampedX,
      top: clampedY,
      child: GestureDetector(
        key: const ValueKey('viewport-hud-restore-pill'),
        onPanUpdate: (details) {
          setState(() {
            _restorePillOffset = Offset(
              (clampedX + details.delta.dx).clamp(minX, maxX),
              (clampedY + details.delta.dy).clamp(minY, maxY),
            );
          });
        },
        onTap: () => _setHudVisible(true),
        child: Container(
          height: pillH,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: palette.surfaceElevated.withValues(alpha: 0.84),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: palette.primary.withValues(alpha: 0.55),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.30),
                blurRadius: 12,
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _isConnected ? palette.success : palette.accent,
                ),
              ),
              const SizedBox(width: 6),
              ValueListenableBuilder<int?>(
                valueListenable: _latencyNotifier,
                builder: (_, latency, _) => Text(
                  '${latency ?? '--'}ms',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: palette.textPrimary,
                  ),
                ),
              ),
              const SizedBox(width: 5),
              Icon(
                Icons.tune_rounded,
                size: 14,
                color: palette.primary,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFullscreenToggleOrb(BuildContext context) {
    final palette = context.palette;
    return Container(
      decoration: BoxDecoration(
        color: palette.surfaceElevated
            .withValues(alpha: palette.isDaylight ? 0.90 : 0.82),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: palette.glassBorderIdle),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.18),
            blurRadius: 12,
          ),
        ],
      ),
      child: IconButton(
        constraints: const BoxConstraints(
          minWidth: 38,
          minHeight: 38,
        ),
        padding: const EdgeInsets.all(6),
        icon: Icon(
          widget.isInline
              ? Icons.fullscreen_rounded
              : Icons.fullscreen_exit_rounded,
          color: palette.primary,
          size: 20,
        ),
        onPressed: widget.onToggleFullscreen,
        tooltip: 'Toggle Fullscreen',
      ),
    );
  }

  Widget _buildHudHeader(BuildContext context) {
    final palette = context.palette;
    final sigma = palette.glass.blurSigma;
    final String resolutionText = _decodedFrameSize != null
        ? '${_decodedFrameSize!.width.round()}x${_decodedFrameSize!.height.round()}'
        : '${_lastPhysicalWidth}x$_lastPhysicalHeight';

    final hudBody = LayoutBuilder(
      builder: (context, constraints) {
        final maxW = constraints.maxWidth;
        final showResolution =
            (_decodedFrameSize != null || _lastPhysicalWidth > 0) &&
                maxW >= 360;
        final showLatency = maxW >= 200;
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: palette.surfaceElevated.withValues(
              alpha: sigma > 0 ? (palette.isDaylight ? 0.86 : 0.78) : 0.95,
            ),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: palette.isDaylight
                  ? Colors.white.withValues(alpha: 0.85)
                  : palette.primary.withValues(alpha: 0.35),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (widget.onExitFullscreen != null) ...[
                InkWell(
                  key: const ValueKey('viewport-exit-fullscreen-btn'),
                  onTap: widget.onExitFullscreen,
                  borderRadius: BorderRadius.circular(999),
                  child: Padding(
                    padding: const EdgeInsets.all(3),
                    child: Icon(
                      Icons.arrow_back_rounded,
                      size: 18,
                      color: palette.textPrimary,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
              ],
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _isConnected ? palette.success : palette.accent,
                  boxShadow: [
                    BoxShadow(
                      color: (_isConnected ? palette.success : palette.accent)
                          .withValues(alpha: 0.8),
                      blurRadius: 4,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: InkWell(
                  key: const ValueKey('viewport-open-diagnostics-btn'),
                  onTap: _openDiagnosticsSheet,
                  borderRadius: BorderRadius.circular(8),
                  child: Row(
                    children: [
                      Flexible(
                        child: Text(
                          widget.hostName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.bold,
                            fontSize: context.fluidFont(11),
                            color: palette.textPrimary,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      ValueListenableBuilder<int>(
                        valueListenable: _fpsNotifier,
                        builder: (_, fps, _) => Text(
                          '$fps FPS',
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: context.fluidFont(10),
                            color: palette.primary,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      if (showLatency) ...[
                        const SizedBox(width: 7),
                        ValueListenableBuilder<int?>(
                          valueListenable: _latencyNotifier,
                          builder: (_, latency, _) => Text(
                            '${latency ?? '--'}ms',
                            style: TextStyle(
                              fontFamily: 'monospace',
                              fontSize: context.fluidFont(10),
                              color: palette.textSecondary,
                            ),
                          ),
                        ),
                      ],
                      if (showResolution) ...[
                        const SizedBox(width: 7),
                        Text(
                          resolutionText,
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: context.fluidFont(9),
                            color: palette.textTertiary,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              if (_hostViewOnly) ...[
                const SizedBox(width: 5),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: palette.accent.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(4),
                    border:
                        Border.all(color: palette.accent.withValues(alpha: 0.6)),
                  ),
                  child: Text(
                    'VIEW-ONLY',
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: context.fluidFont(8),
                      fontWeight: FontWeight.bold,
                      color: palette.accent,
                    ),
                  ),
                ),
              ],
              if (widget.onCycleOrientation != null) ...[
                const SizedBox(width: 5),
                Tooltip(
                  message: 'Switch Orientation (${widget.orientationLabel ?? 'Auto'})',
                  child: InkWell(
                    key: const ValueKey('viewport-rotate-btn'),
                    onTap: () {
                      _hapticLight();
                      widget.onCycleOrientation!();
                      _armHudAutoHide();
                    },
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: palette.primary.withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: palette.primary.withValues(alpha: 0.35),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            widget.orientationIcon ??
                                Icons.screen_rotation_rounded,
                            size: 13,
                            color: palette.primary,
                          ),
                          if (widget.orientationLabel != null &&
                              maxW >= 290) ...[
                            const SizedBox(width: 3),
                            Text(
                              widget.orientationLabel!,
                              style: TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 9,
                                fontWeight: FontWeight.w800,
                                color: palette.primary,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ],
              if (widget.collapsibleHud) ...[
                const SizedBox(width: 5),
                Tooltip(
                  message: 'Hide HUD for unobstructed desktop',
                  child: InkWell(
                    key: const ValueKey('viewport-collapse-hud-btn'),
                    onTap: () => _setHudVisible(false),
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.all(3),
                      child: Icon(
                        Icons.visibility_off_rounded,
                        size: 16,
                        color: palette.textSecondary,
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );

    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: sigma > 0
          ? BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
              child: hudBody,
            )
          : hudBody,
    );
  }

  bool get _showStatusSpinner {
    final HostConnectionPhase phase = _connectionSnapshot.phase;
    return _isConnecting ||
        phase == HostConnectionPhase.connecting ||
        phase == HostConnectionPhase.authenticating ||
        phase == HostConnectionPhase.securingVault ||
        phase == HostConnectionPhase.reconnecting;
  }

  bool get _isStatusOverlayInteractive {
    if (_showStatusSpinner) {
      return _connectionSnapshot.phase == HostConnectionPhase.reconnecting;
    }
    return _errorMessage != null;
  }

  Widget _buildStatusOverlay(BuildContext context) {
    final palette = context.palette;
    final HostConnectionPhase phase = _connectionSnapshot.phase;

    if (_showStatusSpinner) {
      final String phaseText = ConnectionDiagnosticsSheet.phaseLabel(
        phase,
        reconnectAttempt: _connectionSnapshot.reconnectAttempt,
      );
      return SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: phase == HostConnectionPhase.reconnecting
                    ? palette.warning
                    : palette.primary,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              phaseText,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: context.fluidFont(12),
                fontWeight: FontWeight.w700,
                color: palette.textPrimary,
                fontFamily: 'monospace',
              ),
            ),
            const SizedBox(height: 3),
            Text(
              '${widget.hostIp}:${widget.wsPort}',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: context.fluidFont(10.5),
                color: palette.textSecondary,
                fontFamily: 'monospace',
              ),
            ),
            if (phase == HostConnectionPhase.reconnecting) ...[
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: _handleReconnect,
                icon: Icon(
                  Icons.refresh_rounded,
                  size: 15,
                  color: palette.primary,
                ),
                label: Text(
                  'RETRY NOW',
                  style: TextStyle(
                    color: palette.primary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ],
        ),
      );
    }

    if (_errorMessage != null) {
      return SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              phase == HostConnectionPhase.authFailed
                  ? Icons.gpp_bad_rounded
                  : Icons.signal_wifi_off_rounded,
              color: palette.accent,
              size: 32,
            ),
            const SizedBox(height: 6),
            Text(
              _errorMessage!,
              style: TextStyle(
                color: palette.textPrimary,
                fontSize: context.fluidFont(11.5),
                fontWeight: FontWeight.w600,
              ),
              textAlign: TextAlign.center,
            ),
            if (_errorHint != null && _errorHint!.isNotEmpty) ...[
              const SizedBox(height: 6),
              Container(
                constraints: const BoxConstraints(maxWidth: 360),
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                decoration: BoxDecoration(
                  color: palette.warning.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: palette.warning.withValues(alpha: 0.40),
                  ),
                ),
                child: Text(
                  _errorHint!,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: palette.textSecondary,
                    fontSize: context.fluidFont(10.5),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              alignment: WrapAlignment.center,
              children: [
                TextButton.icon(
                  key: const ValueKey('viewport-reconnect-btn'),
                  onPressed: _handleReconnect,
                  icon: Icon(
                    Icons.refresh_rounded,
                    size: 16,
                    color: palette.primary,
                  ),
                  label: Text(
                    'RECONNECT',
                    style: TextStyle(
                      color: palette.primary,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                TextButton.icon(
                  onPressed: _openDiagnosticsSheet,
                  icon: Icon(
                    Icons.analytics_outlined,
                    size: 16,
                    color: palette.textSecondary,
                  ),
                  label: Text(
                    'DIAGNOSTICS',
                    style: TextStyle(color: palette.textSecondary),
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    }

    return IgnorePointer(
      ignoring: true,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(
          'Awaiting incoming video frames...',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: palette.textSecondary,
            fontSize: context.fluidFont(12),
          ),
        ),
      ),
    );
  }

  Future<void> _showMonitorSwitcherSheet() async {
    final client = _client;
    if (client == null || !client.isVaultEstablished) return;
    if (_monitors.length <= 1) {
      client.requestDisplayEnum();
      return;
    }
    _hapticLight();
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: context.palette.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final palette = ctx.palette;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Select Host Display',
                  style: TextStyle(
                    color: palette.textPrimary,
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 8),
                ..._monitors.map((mon) {
                  final int idx = (mon['index'] as num?)?.toInt() ?? 1;
                  final int w = (mon['width'] as num?)?.toInt() ?? 0;
                  final int h = (mon['height'] as num?)?.toInt() ?? 0;
                  final String res = (w > 0 && h > 0) ? '$w×$h' : 'Active Display';
                  final bool selected = idx == _activeMonitorIdx;
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      Icons.desktop_windows_rounded,
                      color: selected ? palette.primary : palette.textSecondary,
                    ),
                    title: Text(
                      'Display $idx',
                      style: TextStyle(
                        color: palette.textPrimary,
                        fontWeight:
                            selected ? FontWeight.w800 : FontWeight.w600,
                      ),
                    ),
                    subtitle: Text(
                      res,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11.5,
                        color: palette.textSecondary,
                      ),
                    ),
                    trailing: selected
                        ? Icon(Icons.check_circle_rounded, color: palette.primary)
                        : null,
                    onTap: () {
                      Navigator.of(ctx).pop();
                      setState(() => _activeMonitorIdx = idx);
                      client.requestDisplayEnum(switchMonitorIndex: idx);
                    },
                  );
                }),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _showClipboardSheet() async {
    final client = _client;
    if (client == null || !client.isVaultEstablished || !mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: context.palette.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final sheetPalette = ctx.palette;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  leading: Icon(Icons.upload_rounded, color: sheetPalette.primary),
                  title: const Text('Push Phone Clipboard -> PC'),
                  onTap: () async {
                    Navigator.of(ctx).pop();
                    final data = await Clipboard.getData('text/plain');
                    final txt = data?.text ?? '';
                    if (txt.isEmpty) return;
                    client.sendClipboard(txt);
                  },
                ),
                ListTile(
                  leading:
                      Icon(Icons.download_rounded, color: sheetPalette.primary),
                  title: const Text('Pull PC Clipboard -> Phone'),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    client.requestClipboard();
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _showAudioControlSheet() async {
    final client = _client;
    if (client == null || !client.isVaultEstablished || !mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: context.palette.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final palette = ctx.palette;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            child: Wrap(
              spacing: 10,
              runSpacing: 10,
              alignment: WrapAlignment.center,
              children: [
                ActionChip(
                  avatar: const Icon(Icons.skip_previous_rounded, size: 18),
                  label: const Text('Prev'),
                  onPressed: () => client.sendAudioCommand('prev'),
                ),
                ActionChip(
                  avatar: Icon(
                    Icons.play_arrow_rounded,
                    size: 18,
                    color: palette.primary,
                  ),
                  label: const Text('Play/Pause'),
                  onPressed: () => client.sendAudioCommand('play_pause'),
                ),
                ActionChip(
                  avatar: const Icon(Icons.skip_next_rounded, size: 18),
                  label: const Text('Next'),
                  onPressed: () => client.sendAudioCommand('next'),
                ),
                ActionChip(
                  avatar: const Icon(Icons.volume_down_rounded, size: 18),
                  label: const Text('Vol -'),
                  onPressed: () => client.sendAudioCommand('volume_down'),
                ),
                ActionChip(
                  avatar: const Icon(Icons.volume_off_rounded, size: 18),
                  label: const Text('Mute'),
                  onPressed: () => client.sendAudioCommand('mute'),
                ),
                ActionChip(
                  avatar: const Icon(Icons.volume_up_rounded, size: 18),
                  label: const Text('Vol +'),
                  onPressed: () => client.sendAudioCommand('volume_up'),
                ),
                ActionChip(
                  avatar:
                      Icon(Icons.lock_rounded, size: 18, color: palette.accent),
                  label: const Text('Lock PC'),
                  onPressed: () {
                    Navigator.of(ctx).pop();
                    client.sendAudioCommand('lock_pc');
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  String _qualityShortLabel() {
    return switch (_qualityPreset) {
      'low' => 'LOW',
      'balanced' => 'BAL',
      'crisp' => 'CRISP',
      _ => 'AUTO',
    };
  }

  Widget _buildInteractiveControllerDock(BuildContext context) {
    final palette = context.palette;
    final sigma = palette.glass.blurSigma;
    final monLabel = _monitors.length > 1 ? 'MON $_activeMonitorIdx' : 'MON';
    final dock = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: palette.surfaceElevated.withValues(
          alpha: sigma > 0 ? (palette.isDaylight ? 0.90 : 0.85) : 0.96,
        ),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: palette.isDaylight
              ? Colors.white.withValues(alpha: 0.85)
              : palette.primary.withValues(alpha: 0.32),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildDockButton(
            context,
            'TOUCH',
            () => _selectInputMode(_StreamInputMode.touch),
            isAccent: _inputMode == _StreamInputMode.touch,
          ),
          const SizedBox(width: 4),
          _buildDockButton(
            context,
            'DRAG',
            () => _selectInputMode(
              _inputMode == _StreamInputMode.drag
                  ? _StreamInputMode.touch
                  : _StreamInputMode.drag,
            ),
            isWarning: _inputMode == _StreamInputMode.drag,
          ),
          const SizedBox(width: 4),
          _buildDockButton(
            context,
            'PAD',
            () => _selectInputMode(_StreamInputMode.trackpad),
            isAccent: _inputMode == _StreamInputMode.trackpad,
          ),
          const SizedBox(width: 6),
          _buildDockButton(
            context,
            'KEY',
            _toggleKeyboardBar,
            isAccent: _showKeyboardBar,
          ),
          const SizedBox(width: 4),
          _buildDockButton(
            context,
            _videoFit == BoxFit.contain ? 'FIT' : 'FILL',
            _toggleFitMode,
            isAccent: _videoFit == BoxFit.cover,
          ),
          const SizedBox(width: 4),
          _buildDockButton(
            context,
            'Q:${_qualityShortLabel()}',
            _cycleQualityPreset,
          ),
          const SizedBox(width: 4),
          _buildDockButton(
            context,
            'L-CLICK',
            () => _sendRelativeMouseClick('left'),
            isAccent: _inputMode == _StreamInputMode.trackpad,
          ),
          const SizedBox(width: 4),
          _buildDockButton(
            context,
            'R-CLICK',
            () => _sendRelativeMouseClick('right'),
          ),
          const SizedBox(width: 4),
          _buildDockButton(context, 'WIN', () => _sendHotkey(const ['win'])),
          const SizedBox(width: 4),
          _buildDockButton(
            context,
            'ALT+TAB',
            () => _sendHotkey(const ['alt', 'tab']),
          ),
          const SizedBox(width: 4),
          _buildDockButton(context, 'ESC', () => _sendKey('esc')),
          const SizedBox(width: 4),
          _buildDockButton(context, 'CLIP', _showClipboardSheet),
          const SizedBox(width: 4),
          _buildDockButton(context, 'AUDIO', _showAudioControlSheet),
          const SizedBox(width: 4),
          _buildDockButton(context, monLabel, _showMonitorSwitcherSheet),
          const SizedBox(width: 4),
          _buildDockButton(context, 'INFO', _openDiagnosticsSheet),
        ],
      ),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: sigma > 0
          ? BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
              child: dock,
            )
          : dock,
    );
  }

  Widget _buildDockButton(
    BuildContext context,
    String label,
    VoidCallback onTap, {
    bool isAccent = false,
    bool isWarning = false,
  }) {
    final palette = context.palette;
    final Color activeColor = isWarning ? palette.warning : palette.primary;
    final bool highlighted = isAccent || isWarning;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
          color: highlighted
              ? activeColor.withValues(
                  alpha: palette.isDaylight ? 0.16 : 0.26,
                )
              : palette.isDaylight
                  ? palette.primary.withValues(alpha: 0.06)
                  : Colors.white.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: highlighted ? activeColor : palette.dividerColor,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: highlighted ? activeColor : palette.textPrimary,
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}
