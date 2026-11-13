import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui';
import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../theme/fluid_theme.dart';
import '../services/zero_gc_video_pipeline.dart';

// =====================================================================
// BINARY PROTOCOL DEFINITION & OPCODES
// =====================================================================
const int magicByte0 = 0xC5;
const int magicByte1 = 0x71;
const int _streamHeaderSize = 12;
const int _maxStreamPayloadBytes = 10 * 1024 * 1024;

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
    if (bytes.length < _streamHeaderSize) return null;
    final view = ByteData.sublistView(bytes);
    if (view.getUint8(0) != magicByte0 || view.getUint8(1) != magicByte1) {
      return null;
    }

    final opCodeByte = view.getUint8(2);
    final flags = view.getUint8(3);
    final seqId = view.getUint32(4, Endian.big);
    final length = view.getUint32(8, Endian.big);

    final opcode = StreamOpcode.fromCode(opCodeByte);
    if (opcode == null) return null;
    if (length > _maxStreamPayloadBytes ||
        bytes.length != _streamHeaderSize + length) {
      return null;
    }

    final payload = Uint8List.sublistView(
        bytes, _streamHeaderSize, _streamHeaderSize + length);
    return StreamBinaryPacket(opcode, flags, seqId, payload);
  }

  static Uint8List pack(StreamOpcode opcode, int seqId, Uint8List payload,
      {int flags = 0}) {
    final bytes = Uint8List(_streamHeaderSize + payload.length);
    final view = ByteData.sublistView(bytes);
    view.setUint8(0, magicByte0);
    view.setUint8(1, magicByte1);
    view.setUint8(2, opcode.code);
    view.setUint8(3, flags);
    view.setUint32(4, seqId, Endian.big);
    view.setUint32(8, payload.length, Endian.big);
    bytes.setRange(
        _streamHeaderSize, _streamHeaderSize + payload.length, payload);
    return bytes;
  }

  /// Packs 0x0A VIEWPORT_RESIZE control payload containing target width and height
  static Uint8List packViewportResize(int width, int height) {
    final payload = Uint8List(8);
    final view = ByteData.sublistView(payload);
    view.setUint32(0, width, Endian.big);
    view.setUint32(4, height, Endian.big);
    return pack(StreamOpcode.viewportResize, 0, payload);
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

  const ViewportStreamWidget({
    super.key,
    required this.hostIp,
    required this.hostName,
    this.wsPort = 8765,
    this.isInline = true,
    this.onToggleFullscreen,
    this.sharedSecret = '',
  });

  @override
  State<ViewportStreamWidget> createState() => _ViewportStreamWidgetState();
}

class _ViewportStreamWidgetState extends State<ViewportStreamWidget> {
  static int _wakelockRefCount = 0;

  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _pingTimer;
  final StreamController<Uint8List> _frameController =
      StreamController<Uint8List>.broadcast(sync: true);

  bool _isConnected = false;
  bool _isAuthenticated = false;
  bool _isConnecting = true;
  bool _hasReceivedFrame = false;
  String? _errorMessage;

  // Viewport Resolution Tracking
  int _lastPhysicalWidth = 0;
  int _lastPhysicalHeight = 0;
  int _lastSentPhysicalWidth = 0;
  int _lastSentPhysicalHeight = 0;
  bool _resizeScheduled = false;

  // Touch & Remote PC Control
  Offset? _lastTouchPosition;

  // Metrics
  int _fpsCount = 0;
  int _fpsDisplay = 0;
  int? _latencyMs;
  int _pingSequence = 0;
  final Map<int, Stopwatch> _pendingPings = {};
  Timer? _fpsTimer;

  @override
  void initState() {
    super.initState();
    _wakelockRefCount++;
    WakelockPlus.enable();
    _connect();

    _fpsTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() {
          _fpsDisplay = _fpsCount;
          _fpsCount = 0;
        });
      }
    });
  }

  void _connect() {
    _cleanupSocket();
    final secret = widget.sharedSecret.trim();
    if (secret.isEmpty) {
      setState(() {
        _isConnected = false;
        _isAuthenticated = false;
        _isConnecting = false;
        _errorMessage = 'Pairing secret required before connecting to host stream.';
      });
      return;
    }
    setState(() {
      _isConnecting = true;
      _isAuthenticated = false;
      _errorMessage = null;
    });

    try {
      final uri = Uri(
        scheme: 'ws',
        host: widget.hostIp,
        port: widget.wsPort,
      );
      _channel = WebSocketChannel.connect(uri);

      _subscription = _channel!.stream.listen(
        (message) {
          if (!mounted) return;
          if (message is Uint8List) {
            final packet = StreamBinaryPacket.parse(message);
            if (packet != null) {
              if (packet.opcode == StreamOpcode.auth) {
                // Respond to 16-byte HMAC-SHA256 challenge from agent.py
                if (packet.payload.length == 16) {
                  final hmacSha256 =
                      Hmac(sha256, utf8.encode(secret));
                  final digest = hmacSha256.convert(packet.payload);
                  final authReply = StreamBinaryPacket.pack(
                    StreamOpcode.auth,
                    packet.seqId,
                    Uint8List.fromList(digest.bytes),
                  );
                  _channel?.sink.add(authReply);
                } else {
                  final statusStr =
                      utf8.decode(packet.payload, allowMalformed: true).trim();
                  if ((statusStr == 'AUTH_OK' ||
                          statusStr == 'OK_AUTHENTICATED') &&
                      mounted) {
                    setState(() {
                      _isAuthenticated = true;
                      _isConnected = true;
                      _isConnecting = false;
                    });
                  } else if (mounted) {
                    setState(() {
                      _isAuthenticated = false;
                      _isConnected = false;
                      _isConnecting = false;
                      _errorMessage = 'Stream authentication rejected: $statusStr';
                    });
                    _cleanupSocket();
                  }
                }
              } else if (packet.opcode == StreamOpcode.error) {
                final errMsg = utf8.decode(packet.payload, allowMalformed: true).trim();
                if (mounted) {
                  setState(() {
                    _errorMessage = errMsg.isNotEmpty ? errMsg : 'Host stream error';
                    if (!_isAuthenticated) {
                      _isConnected = false;
                      _isConnecting = false;
                    }
                  });
                }
              } else if (packet.opcode == StreamOpcode.frame) {
                if (!_isAuthenticated) {
                  return; // Drop unauthenticated pre-auth video frames
                }
                _fpsCount++;
                if (!_frameController.isClosed) {
                  _frameController.add(packet.payload);
                }
                if (!_isConnected || _isConnecting || !_hasReceivedFrame) {
                  setState(() {
                    _hasReceivedFrame = true;
                    _isConnected = true;
                    _isConnecting = false;
                  });
                }
              } else if (packet.opcode == StreamOpcode.ping) {
                final stopwatch = _pendingPings.remove(packet.seqId);
                if (stopwatch != null) {
                  stopwatch.stop();
                  _latencyMs = stopwatch.elapsedMilliseconds;
                }
              }
            }
          }
        },
        onError: (err) {
          if (!mounted) return;
          _stopPingTimer();
          setState(() {
            _isConnecting = false;
            _isConnected = false;
            _isAuthenticated = false;
            _errorMessage = 'Socket Connection Error: $err';
          });
        },
        onDone: () {
          if (!mounted) return;
          _stopPingTimer();
          setState(() {
            _isConnected = false;
            _isAuthenticated = false;
            _isConnecting = false;
          });
        },
      );

      // Keep-alive ping loop every 2 seconds
      _pingTimer = Timer.periodic(const Duration(seconds: 2), (timer) {
        if (!mounted || _channel == null || !_isConnected) return;
        final int seq = ++_pingSequence;
        if (_pendingPings.length >= 4) {
          _pendingPings.remove(_pendingPings.keys.first)?.stop();
        }
        _pendingPings[seq] = Stopwatch()..start();
        try {
          _channel?.sink.add(
              StreamBinaryPacket.pack(StreamOpcode.ping, seq, Uint8List(0)));
        } catch (_) {}
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _isConnecting = false;
          _errorMessage = 'Failed to connect: $e';
        });
      }
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

    final dimensionsChanged =
        (physicalWidth - _lastSentPhysicalWidth).abs() > 16 ||
            (physicalHeight - _lastSentPhysicalHeight).abs() > 16;
    if (dimensionsChanged &&
        _channel != null &&
        _isConnected &&
        _isAuthenticated &&
        !_resizeScheduled) {
      _resizeScheduled = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _resizeScheduled = false;
        if (!mounted || _channel == null || !_isConnected) return;
        try {
          final resizePacket = StreamBinaryPacket.packViewportResize(
              _lastPhysicalWidth, _lastPhysicalHeight);
          _channel?.sink.add(resizePacket);
          _lastSentPhysicalWidth = _lastPhysicalWidth;
          _lastSentPhysicalHeight = _lastPhysicalHeight;
        } catch (e) {
          debugPrint('Failed to send Viewport Resize: $e');
        }
      });
    }
  }

  // ===================================================================
  // VIRTUAL INPUT & REMOTE PC CONTROL (OPCODE 0x08)
  // ===================================================================
  void _sendVirtualInput(Map<String, dynamic> actionMap) {
    if (_channel == null || !_isConnected) return;
    try {
      final jsonStr = jsonEncode(actionMap);
      final payload = utf8.encode(jsonStr);
      final packet = StreamBinaryPacket.pack(
        StreamOpcode.input,
        ++_pingSequence,
        Uint8List.fromList(payload),
      );
      _channel?.sink.add(packet);
    } catch (e) {
      debugPrint('Virtual input send error: $e');
    }
  }

  void _sendMouseRel(double dx, double dy) {
    if (dx.abs() < 0.1 && dy.abs() < 0.1) return;
    final scaledDx = (dx * 1.6).clamp(-140.0, 140.0);
    final scaledDy = (dy * 1.6).clamp(-140.0, 140.0);
    _sendVirtualInput({'action': 'move', 'dx': scaledDx, 'dy': scaledDy});
  }

  void _sendMouseClick(String button) {
    _sendVirtualInput({'action': 'click', 'button': button});
  }

  void _sendMouseScroll(double dy) {
    _sendVirtualInput({'action': 'scroll', 'dy': (dy * 2.0).round()});
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

  void _showKeyboardDialog() {
    final textCtrl = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: CyberColors.surfaceElevated,
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
          content: Column(
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
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel',
                  style: TextStyle(color: CyberColors.textSecondary)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: CyberColors.primary,
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

  void _stopPingTimer() {
    _pingTimer?.cancel();
    _pingTimer = null;
    for (final stopwatch in _pendingPings.values) {
      stopwatch.stop();
    }
    _pendingPings.clear();
  }

  void _cleanupSocket() {
    _stopPingTimer();
    _isAuthenticated = false;
    _subscription?.cancel();
    _subscription = null;
    try {
      _channel?.sink.close();
    } catch (_) {}
    _channel = null;
  }

  @override
  void dispose() {
    _fpsTimer?.cancel();
    _fpsTimer = null;
    _cleanupSocket();
    unawaited(_frameController.close());
    if (_wakelockRefCount > 0) {
      _wakelockRefCount--;
    }
    if (_wakelockRefCount == 0) {
      WakelockPlus.disable();
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
                      onScaleStart: (details) {
                        _lastTouchPosition = details.localFocalPoint;
                      },
                      onScaleUpdate: (details) {
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
                      },
                      onTap: () => _sendMouseClick('left'),
                      onDoubleTap: () => _sendMouseClick('double'),
                      onLongPress: () => _sendMouseClick('right'),
                      child: ZeroGcVideoRenderer(
                        frameStream: _frameController.stream,
                        fit: BoxFit.contain,
                        onRequestKeyframe: (opcode) {
                          if (_channel != null && _isAuthenticated) {
                            try {
                              _channel?.sink.add(
                                StreamBinaryPacket.pack(
                                  StreamOpcode.frameSync,
                                  ++_pingSequence,
                                  Uint8List(0),
                                ),
                              );
                            } catch (_) {}
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
                    top: 10,
                    left: 10,
                    right: 10,
                    child: _buildHudHeader(context),
                  ),

                  // Bottom Interactive Remote Control Dock
                  if (_isConnected)
                    Positioned(
                      bottom: 10,
                      left: 10,
                      child: _buildInteractiveControllerDock(context),
                    ),

                  // Bottom Quick Controls
                  if (widget.onToggleFullscreen != null)
                    Positioned(
                      bottom: 10,
                      right: 10,
                      child: Container(
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.6),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.white24),
                        ),
                        child: IconButton(
                          icon: Icon(
                            widget.isInline
                                ? Icons.fullscreen_rounded
                                : Icons.fullscreen_exit_rounded,
                            color: CyberColors.primary,
                            size: 20,
                          ),
                          onPressed: widget.onToggleFullscreen,
                          tooltip: 'Toggle Fullscreen',
                        ),
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
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: CyberColors.surfaceElevated.withValues(alpha: 0.75),
            borderRadius: BorderRadius.circular(8),
            border:
                Border.all(color: CyberColors.primary.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color:
                      _isConnected ? CyberColors.success : CyberColors.accent,
                  boxShadow: [
                    BoxShadow(
                      color: (_isConnected
                              ? CyberColors.success
                              : CyberColors.accent)
                          .withValues(alpha: 0.8),
                      blurRadius: 4,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                widget.hostName,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.bold,
                  fontSize: context.fluidFont(11),
                  color: CyberColors.textPrimary,
                ),
              ),
              const Spacer(),
              Text(
                '$_fpsDisplay FPS',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: context.fluidFont(10),
                  color: CyberColors.primary,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(width: 10),
              Text(
                '${_latencyMs ?? '--'}ms',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: context.fluidFont(10),
                  color: CyberColors.textSecondary,
                ),
              ),
              if (_lastPhysicalWidth > 0) ...[
                const SizedBox(width: 10),
                Text(
                  '${_lastPhysicalWidth}x$_lastPhysicalHeight',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: context.fluidFont(9),
                    color: CyberColors.textTertiary,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusOverlay(BuildContext context) {
    if (_isConnecting) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(
              strokeWidth: 2.5,
              color: CyberColors.primary,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Connecting to ${widget.hostIp}:${widget.wsPort}...',
            style: TextStyle(
              fontSize: context.fluidFont(12),
              color: CyberColors.textSecondary,
              fontFamily: 'monospace',
            ),
          ),
        ],
      );
    }

    if (_errorMessage != null) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.signal_wifi_off_rounded,
              color: CyberColors.accent, size: 36),
          const SizedBox(height: 8),
          Text(
            _errorMessage!,
            style: TextStyle(
              color: CyberColors.textSecondary,
              fontSize: context.fluidFont(11),
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          TextButton.icon(
            onPressed: _connect,
            icon: const Icon(Icons.refresh_rounded,
                size: 16, color: CyberColors.primary),
            label: const Text('RECONNECT',
                style: TextStyle(color: CyberColors.primary)),
          ),
        ],
      );
    }

    return Text(
      'Awaiting incoming video frames...',
      style: TextStyle(
        color: CyberColors.textSecondary,
        fontSize: context.fluidFont(12),
      ),
    );
  }

  Widget _buildInteractiveControllerDock(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: CyberColors.surfaceElevated.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(10),
            border:
                Border.all(color: CyberColors.primary.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildDockButton('L-CLICK', () => _sendMouseClick('left'),
                  isAccent: true),
              const SizedBox(width: 5),
              _buildDockButton('R-CLICK', () => _sendMouseClick('right')),
              const SizedBox(width: 5),
              _buildDockButton('⌨️ TYPE', _showKeyboardDialog),
              const SizedBox(width: 5),
              _buildDockButton('WIN', () => _sendHotkey(['win'])),
              const SizedBox(width: 5),
              _buildDockButton('ALT+TAB', () => _sendHotkey(['alt', 'tab'])),
              const SizedBox(width: 5),
              _buildDockButton('ESC', () => _sendKey('esc')),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDockButton(String label, VoidCallback onTap,
      {bool isAccent = false}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(
          color: isAccent
              ? CyberColors.primary.withValues(alpha: 0.25)
              : Colors.white.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: isAccent
                ? CyberColors.primary
                : Colors.white.withValues(alpha: 0.15),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isAccent ? CyberColors.primary : Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.bold,
            fontFamily: 'monospace',
          ),
        ),
      ),
    );
  }
}
