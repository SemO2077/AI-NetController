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
const String _defaultSharedSecret = 'cst_thesis_2026_secret_key';

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
        bytes.length < _streamHeaderSize + length) {
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
    this.sharedSecret = _defaultSharedSecret,
  });

  @override
  State<ViewportStreamWidget> createState() => _ViewportStreamWidgetState();
}

class _ViewportStreamWidgetState extends State<ViewportStreamWidget> {
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _pingTimer;
  final StreamController<Uint8List> _frameController =
      StreamController<Uint8List>.broadcast(sync: true);

  bool _isConnected = false;
  bool _isConnecting = true;
  bool _hasReceivedFrame = false;
  String? _errorMessage;

  // Viewport Resolution Tracking
  int _lastPhysicalWidth = 0;
  int _lastPhysicalHeight = 0;
  int _lastSentPhysicalWidth = 0;
  int _lastSentPhysicalHeight = 0;
  bool _resizeScheduled = false;

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
    setState(() {
      _isConnecting = true;
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
                      Hmac(sha256, utf8.encode(widget.sharedSecret));
                  final digest = hmacSha256.convert(packet.payload);
                  final authReply = StreamBinaryPacket.pack(
                    StreamOpcode.auth,
                    packet.seqId,
                    Uint8List.fromList(digest.bytes),
                  );
                  _channel?.sink.add(authReply);
                } else {
                  final statusStr =
                      utf8.decode(packet.payload, allowMalformed: true);
                  if (statusStr == 'AUTH_OK' && mounted) {
                    setState(() {
                      _isConnected = true;
                      _isConnecting = false;
                    });
                  }
                }
              } else if (packet.opcode == StreamOpcode.frame) {
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
            _errorMessage = 'Socket Connection Error: $err';
          });
        },
        onDone: () {
          if (!mounted) return;
          _stopPingTimer();
          setState(() {
            _isConnected = false;
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
    final renderHeight = renderWidth * (9.0 / 16.0); // 16:9 aspect ratio
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
    WakelockPlus.disable();
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
                  // Keep frame decoding in the isolated renderer, not this socket widget.
                  Positioned.fill(
                    child: ZeroGcVideoRenderer(
                      frameStream: _frameController.stream,
                      fit: BoxFit.contain,
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
}
