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
import '../services/host_connection_client.dart';
import '../services/thermal_governor.dart';
import '../services/zero_gc_video_pipeline.dart';
import '../theme/fluid_theme.dart';

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

  static Uint8List pack(StreamOpcode opcode, int seqId, Uint8List payload,
      {int flags = 0}) {
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

// =====================================================================
// DYNAMIC VIEWPORT STREAM WIDGET WITH RESOLUTION MATCHING
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
  });

  @override
  State<ViewportStreamWidget> createState() => _ViewportStreamWidgetState();
}

class _ViewportStreamWidgetState extends State<ViewportStreamWidget> {
  static int _wakelockRefCount = 0;

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

  bool _isConnected = false;
  bool _isAuthenticated = false;
  bool _isConnecting = true;
  bool _hasReceivedFrame = false;
  String? _errorMessage;
  List<Map<String, dynamic>> _monitors = const [];
  int _activeMonitorIdx = 1;

  // Viewport Resolution & Thermal Quality Tracking
  int _lastPhysicalWidth = 0;
  int _lastPhysicalHeight = 0;
  int _lastSentPhysicalWidth = 0;
  int _lastSentPhysicalHeight = 0;
  int _lastSentQuality = 75;
  bool _resizeScheduled = false;

  // Touch & 16ms Delta Coalescing (6-byte binary OP_INPUT !BhhB)
  Offset? _lastTouchPosition;
  Offset? _lastTapLocalPos;
  int _lastPointerCount = 0;
  bool _directTouchMode = false;
  bool _hostViewOnly = false;
  double _accumDx = 0.0;
  double _accumDy = 0.0;
  double _accumScrollDy = 0.0;
  Timer? _inputFlushTimer;

  // Isolated HUD Metrics (never trigger parent video canvas rebuilds)
  int _fpsCount = 0;
  final ValueNotifier<int> _fpsNotifier = ValueNotifier<int>(0);
  final ValueNotifier<int?> _latencyNotifier = ValueNotifier<int?>(null);
  DateTime _lastUiFrameAt = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _fpsTimer;
  Timer? _frameRecoveryTimer;

  @override
  void initState() {
    super.initState();
    if (widget.keepScreenAwake) {
      _wakelockRefCount++;
      unawaited(WakelockPlus.enable().catchError((_) {}));
    }
    ThermalGovernor.instance.addListener(_onThermalConfigChanged);
    _connect();

    _fpsTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        _fpsNotifier.value = _fpsCount;
        _fpsCount = 0;
      }
    });
  }

  @override
  void didUpdateWidget(covariant ViewportStreamWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.hostIp != widget.hostIp ||
        oldWidget.wsPort != widget.wsPort ||
        oldWidget.sharedSecret.trim() != widget.sharedSecret.trim() ||
        oldWidget.useTls != widget.useTls ||
        oldWidget.certFingerprint != widget.certFingerprint) {
      _hasReceivedFrame = false;
      _lastSentPhysicalWidth = 0;
      _lastSentPhysicalHeight = 0;
      _connect();
    } else if (oldWidget.targetFps != widget.targetFps &&
        _isAuthenticated &&
        _lastPhysicalWidth > 0 &&
        _lastPhysicalHeight > 0) {
      _sendViewportNegotiation(
        _lastPhysicalWidth,
        _lastPhysicalHeight,
        _qualityForThermal(ThermalGovernor.instance.currentConfig),
      );
    }
  }

  int _qualityForThermal(ThermalConfig cfg) {
    if (cfg.isSnapshotOnlyMode || cfg.targetFps <= 10) return 42;
    if (cfg.targetFps <= 20) return 60;
    return 78;
  }

  int _effectiveTargetFps(ThermalConfig cfg) {
    final int prefFps = widget.targetFps > 0 ? widget.targetFps : 30;
    final int govFps = cfg.targetFps > 0 ? cfg.targetFps : 30;
    return min(prefFps, govFps);
  }

  void _armFrameRecoveryTimer() {
    _frameRecoveryTimer?.cancel();
    if (_hasReceivedFrame) return;
    _frameRecoveryTimer = Timer(const Duration(milliseconds: 2500), () {
      if (!mounted || _hasReceivedFrame) return;
      final client = _client;
      if (client != null && client.isVaultEstablished) {
        client.requestKeyframe();
      }
    });
  }

  void _onThermalConfigChanged() {
    if (!mounted || !_isAuthenticated || _lastPhysicalWidth <= 0) return;
    final int targetQuality = _qualityForThermal(ThermalGovernor.instance.currentConfig);
    if (targetQuality != _lastSentQuality) {
      _sendViewportNegotiation(_lastPhysicalWidth, _lastPhysicalHeight, targetQuality);
    }
  }

  void _connect() {
    _cleanupSocket();
    final secret = widget.sharedSecret.trim();
    if (!NetworkValidators.isValidIpOrHost(widget.hostIp) ||
        !NetworkValidators.isValidPort(widget.wsPort)) {
      setState(() {
        _isConnected = false;
        _isAuthenticated = false;
        _isConnecting = false;
        _errorMessage = 'Invalid host IP or WebSocket port.';
      });
      return;
    }
    if (secret.isEmpty) {
      setState(() {
        _isConnected = false;
        _isAuthenticated = false;
        _isConnecting = false;
        _errorMessage = 'Pairing secret required before connecting to host stream.';
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
    setState(() {
      _isConnecting = initialSnap.isConnecting || !initialSnap.isVaultEstablished;
      _isConnected = initialSnap.isConnected;
      _isAuthenticated = initialSnap.isVaultEstablished;
      _hasReceivedFrame = hasCachedFrame;
      _errorMessage = (initialSnap.errorMessage != null && !initialSnap.isVaultEstablished)
          ? initialSnap.errorMessage
          : null;
    });

    if (initialSnap.isVaultEstablished) {
      if (_lastPhysicalWidth > 0 && _lastPhysicalHeight > 0) {
        _sendViewportNegotiation(
          _lastPhysicalWidth,
          _lastPhysicalHeight,
          _qualityForThermal(ThermalGovernor.instance.currentConfig),
        );
      }
      client.requestDisplayEnum();
      client.requestKeyframe();
      if (!hasCachedFrame) {
        _armFrameRecoveryTimer();
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
      final bool statusChanged = _isConnecting != snap.isConnecting ||
          _isConnected != snap.isConnected ||
          _isAuthenticated != snap.isVaultEstablished ||
          _errorMessage != nextError;
      if (statusChanged) {
        setState(() {
          _isConnecting = snap.isConnecting;
          _isConnected = snap.isConnected;
          _isAuthenticated = snap.isVaultEstablished;
          _errorMessage = nextError;
        });
      }
      if (!wasAuthed && snap.isVaultEstablished) {
        if (_lastPhysicalWidth > 0 && _lastPhysicalHeight > 0) {
          _sendViewportNegotiation(
            _lastPhysicalWidth,
            _lastPhysicalHeight,
            _qualityForThermal(ThermalGovernor.instance.currentConfig),
          );
        }
        client.requestDisplayEnum();
        client.requestKeyframe();
        _armFrameRecoveryTimer();
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
      }
    });

    if (!initialSnap.isVaultEstablished) {
      unawaited(client.ensureConnected().catchError((_) {}));
    }
  }

  void _sendViewportNegotiation(int width, int height, int quality) {
    final client = _client;
    if (client == null || !client.isVaultEstablished) return;
    final int fps = _effectiveTargetFps(ThermalGovernor.instance.currentConfig);
    final payload = Uint8List.fromList(utf8.encode(jsonEncode({
      'width': width,
      'height': height,
      'quality': quality,
      'fps': fps,
    })));
    if (client.sendEncrypted(BinaryOpcode.viewportResize, payload)) {
      _lastSentPhysicalWidth = width;
      _lastSentPhysicalHeight = height;
      _lastSentQuality = quality;
    }
  }

  /// Sends 0x0A VIEWPORT_RESIZE when container layout changes (deferred post-frame)
  void _syncPhysicalViewport(BoxConstraints constraints, BuildContext context) {
    if (!constraints.hasBoundedWidth || constraints.maxWidth <= 0) return;

    final renderWidth = constraints.maxWidth;
    final renderHeight = (constraints.hasBoundedHeight && constraints.maxHeight > 0)
        ? constraints.maxHeight
        : renderWidth * (9.0 / 16.0);
    final dpr = MediaQuery.devicePixelRatioOf(context);

    final physicalWidth = (renderWidth * dpr).round();
    final physicalHeight = (renderHeight * dpr).round();

    _lastPhysicalWidth = physicalWidth;
    _lastPhysicalHeight = physicalHeight;

    final int targetQuality =
        _qualityForThermal(ThermalGovernor.instance.currentConfig);
    final dimensionsChanged =
        (physicalWidth - _lastSentPhysicalWidth).abs() > 16 ||
            (physicalHeight - _lastSentPhysicalHeight).abs() > 16 ||
            targetQuality != _lastSentQuality;
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
            _lastPhysicalWidth, _lastPhysicalHeight, targetQuality);
      });
    }
  }

  // ===================================================================
  // VIRTUAL INPUT & REMOTE PC CONTROL (OPCODE 0x08 OVER AEAD VAULT)
  // ===================================================================
  void _sendBinaryInputPacket(int eventType, int dx, int dy, int btnCode) {
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
    if (_accumDx.abs() >= 1.0 || _accumDy.abs() >= 1.0) {
      final int dx = _accumDx.round().clamp(-5000, 5000);
      final int dy = _accumDy.round().clamp(-5000, 5000);
      _accumDx -= dx;
      _accumDy -= dy;
      if (dx != 0 || dy != 0) {
        _sendBinaryInputPacket(1, dx, dy, 0);
      }
    }
    if (_accumScrollDy.abs() >= 1.0) {
      final int sdy = _accumScrollDy.round().clamp(-5000, 5000);
      _accumScrollDy -= sdy;
      if (sdy != 0) {
        _sendBinaryInputPacket(3, 0, sdy, 0);
      }
    }
  }

  void _scheduleInputFlush() {
    if (_inputFlushTimer?.isActive ?? false) return;
    _inputFlushTimer = Timer(const Duration(milliseconds: 16), _flushCoalescedInput);
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

  void _sendMouseRel(double dx, double dy) {
    if (dx.abs() < 0.1 && dy.abs() < 0.1) return;
    _accumDx += (dx * 1.6).clamp(-140.0, 140.0);
    _accumDy += (dy * 1.6).clamp(-140.0, 140.0);
    _scheduleInputFlush();
  }

  void _sendMouseClick(String button) {
    _flushCoalescedInput();
    final int code = switch (button) {
      'right' => 2,
      'middle' => 3,
      'double' => 4,
      _ => 1,
    };
    _sendBinaryInputPacket(2, 0, 0, code);
  }

  void _sendMouseScroll(double dy) {
    _accumScrollDy += dy * 2.0;
    _scheduleInputFlush();
  }

  void _sendKeyboardText(String text, {bool pressEnter = true}) {
    _sendVirtualInput({'action': 'type', 'text': text, 'press_enter': pressEnter});
  }

  void _sendHotkey(List<String> keys) {
    _sendVirtualInput({'action': 'hotkey', 'keys': keys});
  }

  void _sendKey(String key) {
    _sendVirtualInput({'action': 'key', 'key': key});
  }

  void _sendDirectTouchAction(String action, Offset localPos, Size containerSize) {
    if (containerSize.width <= 0 || containerSize.height <= 0) {
      _sendMouseClick(action == 'right_click_at'
          ? 'right'
          : action == 'double_click_at'
              ? 'double'
              : 'left');
      return;
    }
    final int streamW = _lastPhysicalWidth > 0 ? _lastPhysicalWidth : 1280;
    final int streamH = _lastPhysicalHeight > 0 ? _lastPhysicalHeight : 720;
    final double scale = min(
      containerSize.width / streamW,
      containerSize.height / streamH,
    );
    final double fittedW = streamW * scale;
    final double fittedH = streamH * scale;
    final double leftPad = (containerSize.width - fittedW) / 2.0;
    final double topPad = (containerSize.height - fittedH) / 2.0;
    final int targetX = (((localPos.dx - leftPad) / max(1.0, fittedW)) * streamW)
        .round()
        .clamp(0, streamW - 1);
    final int targetY = (((localPos.dy - topPad) / max(1.0, fittedH)) * streamH)
        .round()
        .clamp(0, streamH - 1);
    _sendVirtualInput({
      'action': action,
      'x': targetX,
      'y': targetY,
    });
  }

  void _showKeyboardDialog() {
    final textCtrl = TextEditingController();
    final palette = context.palette;
    showDialog<void>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: palette.surfaceElevated,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
          ),
          title: const Text(
            'Type on Remote PC',
            style: TextStyle(
              color: Colors.white,
              fontSize: 15,
              fontWeight: FontWeight.bold,
            ),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: textCtrl,
                  autofocus: true,
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  decoration: InputDecoration(
                    hintText: 'Enter text, commands or shortcuts...',
                    hintStyle: TextStyle(
                      color: Colors.white.withValues(alpha: 0.35),
                      fontSize: 12,
                    ),
                  ),
                  onSubmitted: (val) {
                    if (val.isNotEmpty) {
                      _sendKeyboardText(val, pressEnter: true);
                      Navigator.of(ctx).pop();
                    }
                  },
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _buildQuickKeyChip('Enter', () {
                      _sendKey('enter');
                      Navigator.of(ctx).pop();
                    }),
                    _buildQuickKeyChip('Backspace', () => _sendKey('backspace')),
                    _buildQuickKeyChip('Tab', () => _sendKey('tab')),
                    _buildQuickKeyChip('Esc', () {
                      _sendKey('esc');
                      Navigator.of(ctx).pop();
                    }),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: Text('Cancel',
                  style: TextStyle(color: palette.textSecondary)),
            ),
            TextButton(
              onPressed: () {
                final val = textCtrl.text;
                if (val.isNotEmpty) {
                  _sendKeyboardText(val, pressEnter: false);
                }
                Navigator.of(ctx).pop();
              },
              child: Text('Send', style: TextStyle(color: palette.primary)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: palette.primary,
                foregroundColor: Colors.black,
              ),
              onPressed: () {
                final val = textCtrl.text;
                if (val.isNotEmpty) {
                  _sendKeyboardText(val, pressEnter: true);
                }
                Navigator.of(ctx).pop();
              },
              child: const Text('Send & Enter',
                  style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    ).whenComplete(() {
      Future<void>.delayed(const Duration(milliseconds: 300), textCtrl.dispose);
    });
  }

  Widget _buildQuickKeyChip(String label, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.white.withValues(alpha: 0.15)),
        ),
        child: Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 11,
            fontFamily: 'monospace',
          ),
        ),
      ),
    );
  }

  void _cleanupSocket() {
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
    ThermalGovernor.instance.removeListener(_onThermalConfigChanged);
    _fpsTimer?.cancel();
    _fpsTimer = null;
    _cleanupSocket();
    _fpsNotifier.dispose();
    _latencyNotifier.dispose();
    unawaited(_frameController.close());
    if (widget.keepScreenAwake) {
      if (_wakelockRefCount > 0) {
        _wakelockRefCount--;
      }
      if (_wakelockRefCount == 0) {
        unawaited(WakelockPlus.disable().catchError((_) {}));
      }
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        _syncPhysicalViewport(constraints, context);

        return RepaintBoundary(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(widget.isInline ? 16 : 0),
            child: Container(
              color: Colors.black,
              child: Stack(
                children: [
                  // Zero-allocation hardware video stream with interactive touch controls
                  Positioned.fill(
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTapDown: (details) {
                        _lastTapLocalPos = details.localPosition;
                      },
                      onScaleStart: (details) {
                        _lastTouchPosition = details.localFocalPoint;
                        _lastTapLocalPos = details.localFocalPoint;
                        _lastPointerCount = details.pointerCount;
                      },
                      onScaleUpdate: (details) {
                        if (details.pointerCount != _lastPointerCount) {
                          _lastPointerCount = details.pointerCount;
                          _lastTouchPosition = details.localFocalPoint;
                          return;
                        }
                        if (details.pointerCount == 1) {
                          if (_lastTouchPosition != null) {
                            final dx = details.localFocalPoint.dx -
                                _lastTouchPosition!.dx;
                            final dy = details.localFocalPoint.dy -
                                _lastTouchPosition!.dy;
                            _sendMouseRel(dx, dy);
                          }
                          _lastTouchPosition = details.localFocalPoint;
                        } else if (details.pointerCount == 2) {
                          if (_lastTouchPosition != null) {
                            final dy = details.localFocalPoint.dy -
                                _lastTouchPosition!.dy;
                            _sendMouseScroll(-dy);
                          }
                          _lastTouchPosition = details.localFocalPoint;
                        }
                      },
                      onScaleEnd: (_) {
                        _lastTouchPosition = null;
                        _lastPointerCount = 0;
                      },
                      onTap: () {
                        if (_directTouchMode && _lastTapLocalPos != null) {
                          _sendDirectTouchAction(
                            'click_at',
                            _lastTapLocalPos!,
                            Size(constraints.maxWidth, constraints.maxHeight),
                          );
                        } else {
                          _sendMouseClick('left');
                        }
                      },
                      onDoubleTap: () {
                        if (_directTouchMode && _lastTapLocalPos != null) {
                          _sendDirectTouchAction(
                            'double_click_at',
                            _lastTapLocalPos!,
                            Size(constraints.maxWidth, constraints.maxHeight),
                          );
                        } else {
                          _sendMouseClick('double');
                        }
                      },
                      onLongPress: () {
                        if (_directTouchMode && _lastTapLocalPos != null) {
                          _sendDirectTouchAction(
                            'right_click_at',
                            _lastTapLocalPos!,
                            Size(constraints.maxWidth, constraints.maxHeight),
                          );
                        } else {
                          _sendMouseClick('right');
                        }
                      },
                      child: ZeroGcVideoRenderer(
                        frameStream: _frameController.stream,
                        initialFrame: _client?.lastFrame,
                        fit: BoxFit.contain,
                        onRequestKeyframe: (opcode) {
                          final client = _client;
                          if (client != null && client.isVaultEstablished) {
                            client.sendEncrypted(
                              BinaryOpcode.frameSync,
                              Uint8List(0),
                            );
                          }
                        },
                      ),
                    ),
                  ),
                  if (!_hasReceivedFrame)
                    Positioned.fill(
                      child: Center(child: _buildStatusOverlay(context)),
                    ),

                  // Cyber HUD Overlay Bar (FPS, Resolution, Target, Latency)
                  Positioned(
                    top: (widget.isInline
                            ? 0.0
                            : MediaQuery.paddingOf(context).top) +
                        10.0,
                    left: (widget.isInline
                            ? 10.0
                            : MediaQuery.paddingOf(context).left + 62.0),
                    right: (widget.isInline
                            ? 0.0
                            : MediaQuery.paddingOf(context).right) +
                        10.0,
                    child: _buildHudHeader(context),
                  ),

                  // Bottom Interactive Remote Control Dock
                  if (_isConnected)
                    Positioned(
                      bottom: (widget.isInline
                              ? 0.0
                              : MediaQuery.paddingOf(context).bottom) +
                          10.0,
                      left: (widget.isInline
                              ? 0.0
                              : MediaQuery.paddingOf(context).left) +
                          10.0,
                      right: (widget.isInline
                              ? 0.0
                              : MediaQuery.paddingOf(context).right) +
                          (widget.onToggleFullscreen != null ? 58.0 : 10.0),
                      child: Align(
                        alignment: Alignment.bottomLeft,
                        child: SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: _buildInteractiveControllerDock(context),
                        ),
                      ),
                    ),

                  // Bottom Quick Controls
                  if (widget.onToggleFullscreen != null)
                    Positioned(
                      bottom: (widget.isInline
                              ? 0.0
                              : MediaQuery.paddingOf(context).bottom) +
                          10.0,
                      right: (widget.isInline
                              ? 0.0
                              : MediaQuery.paddingOf(context).right) +
                          10.0,
                      child: Builder(
                        builder: (ctx) {
                          final palette = ctx.palette;
                          return Container(
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.6),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: Colors.white24),
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
                        },
                      ),
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildHudHeader(BuildContext context) {
    final palette = context.palette;
    final sigma = palette.glass.blurSigma;
    final hudBody = LayoutBuilder(
      builder: (context, constraints) {
        final maxW = constraints.maxWidth;
        final showResolution = _lastPhysicalWidth > 0 && maxW >= 300;
        final showLatency = maxW >= 200;
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: palette.surfaceElevated
                .withValues(alpha: sigma > 0 ? 0.75 : 0.94),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: palette.primary.withValues(alpha: 0.3)),
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
                  boxShadow: [
                    BoxShadow(
                      color: (_isConnected ? palette.success : palette.accent)
                          .withValues(alpha: 0.8),
                      blurRadius: 4,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
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
                const SizedBox(width: 8),
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
                const SizedBox(width: 8),
                Text(
                  '${_lastPhysicalWidth}x$_lastPhysicalHeight',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: context.fluidFont(9),
                    color: palette.textTertiary,
                  ),
                ),
              ],
              if (_hostViewOnly) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: palette.accent.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: palette.accent.withValues(alpha: 0.6)),
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
            ],
          ),
        );
      },
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: sigma > 0
          ? BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
              child: hudBody,
            )
          : hudBody,
    );
  }

  Widget _buildStatusOverlay(BuildContext context) {
    final palette = context.palette;
    if (_isConnecting) {
      return SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: palette.primary,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Connecting to ${widget.hostIp}:${widget.wsPort}...',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: context.fluidFont(12),
                color: palette.textSecondary,
                fontFamily: 'monospace',
              ),
            ),
          ],
        ),
      );
    }

    if (_errorMessage != null) {
      return SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.signal_wifi_off_rounded,
                color: palette.accent, size: 32),
            const SizedBox(height: 6),
            Text(
              _errorMessage!,
              style: TextStyle(
                color: palette.textSecondary,
                fontSize: context.fluidFont(11),
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: _connect,
              icon: Icon(Icons.refresh_rounded,
                  size: 16, color: palette.primary),
              label:
                  Text('RECONNECT', style: TextStyle(color: palette.primary)),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Text(
        'Awaiting incoming video frames...',
        textAlign: TextAlign.center,
        style: TextStyle(
          color: palette.textSecondary,
          fontSize: context.fluidFont(12),
        ),
      ),
    );
  }

  void _cycleMonitor() {
    final client = _client;
    if (client == null || !client.isVaultEstablished) return;
    if (_monitors.length <= 1) {
      client.requestDisplayEnum();
      return;
    }
    final currentPos =
        _monitors.indexWhere((m) => (m['index'] as num?)?.toInt() == _activeMonitorIdx);
    final nextPos = (currentPos + 1) % _monitors.length;
    final nextIdx = (_monitors[nextPos]['index'] as num?)?.toInt() ?? (nextPos + 1);
    setState(() => _activeMonitorIdx = nextIdx);
    client.requestDisplayEnum(switchMonitorIndex: nextIdx);
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
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: Icon(Icons.upload_rounded, color: context.palette.primary),
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
                leading: Icon(Icons.download_rounded, color: context.palette.primary),
                title: const Text('Pull PC Clipboard -> Phone'),
                onTap: () {
                  Navigator.of(ctx).pop();
                  client.requestClipboard();
                },
              ),
            ],
          ),
        ),
      ),
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
                  avatar: Icon(Icons.play_arrow_rounded,
                      size: 18, color: palette.primary),
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
                  avatar: Icon(Icons.lock_rounded, size: 18, color: palette.accent),
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

  Widget _buildInteractiveControllerDock(BuildContext context) {
    final palette = context.palette;
    final sigma = palette.glass.blurSigma;
    final monLabel =
        _monitors.length > 1 ? 'MON $_activeMonitorIdx' : 'MON';
    final dock = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: palette.surfaceElevated.withValues(alpha: sigma > 0 ? 0.85 : 0.96),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: palette.primary.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildDockButton(
            context,
            _directTouchMode ? 'TOUCH' : 'PAD',
            () => setState(() => _directTouchMode = !_directTouchMode),
            isAccent: _directTouchMode,
          ),
          const SizedBox(width: 5),
          _buildDockButton(context, 'L-CLICK', () => _sendMouseClick('left'),
              isAccent: !_directTouchMode),
          const SizedBox(width: 5),
          _buildDockButton(context, 'R-CLICK', () => _sendMouseClick('right')),
          const SizedBox(width: 5),
          _buildDockButton(context, 'TYPE', _showKeyboardDialog),
          const SizedBox(width: 5),
          _buildDockButton(context, 'WIN', () => _sendHotkey(['win'])),
          const SizedBox(width: 5),
          _buildDockButton(
              context, 'ALT+TAB', () => _sendHotkey(['alt', 'tab'])),
          const SizedBox(width: 5),
          _buildDockButton(context, 'ESC', () => _sendKey('esc')),
          const SizedBox(width: 5),
          _buildDockButton(context, 'CLIP', _showClipboardSheet),
          const SizedBox(width: 5),
          _buildDockButton(context, 'AUDIO', _showAudioControlSheet),
          const SizedBox(width: 5),
          _buildDockButton(context, monLabel, _cycleMonitor),
        ],
      ),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: sigma > 0
          ? BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
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
  }) {
    final palette = context.palette;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(
          color: isAccent
              ? palette.primary.withValues(alpha: 0.25)
              : Colors.white.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: isAccent
                ? palette.primary
                : Colors.white.withValues(alpha: 0.15),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isAccent ? palette.primary : Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.bold,
            fontFamily: 'monospace',
          ),
        ),
      ),
    );
  }
}
