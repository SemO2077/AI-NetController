import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:sensors_plus/sensors_plus.dart';

/// Monitor display specification from Opcode 0x0B (DISPLAY_ENUMERATION)
class MonitorDisplay {
  final int index;
  final int width;
  final int height;
  final String label;

  const MonitorDisplay({
    required this.index,
    required this.width,
    required this.height,
    required this.label,
  });
}

/// Picture-in-Picture (PiP) Remote Desktop Viewer
/// ---------------------------------------------------------------------
/// Features:
/// - Native PiP Transition when leaving app during live streaming
/// - Multi-Monitor Context Switching ([ 1 ] [ 2 ] [ 3 ])
/// - Gyroscope & Accelerometer Driven Cyber-Mesh Gradient (sensors_plus)
/// - Hardware-isolated 60 FPS RepaintBoundary for TurboJPEG video stream
/// - Dynamic Material You Dominant Color Accent Interpolation
class PipStreamViewer extends StatefulWidget {
  final Uint8List? frameData;
  final List<MonitorDisplay> monitors;
  final int selectedMonitorIndex;
  final Color dominantAccentColor;
  final bool isStreaming;
  final Function(int monitorIndex)? onSelectMonitor;
  final VoidCallback? onTogglePip;
  final VoidCallback? onClose;

  const PipStreamViewer({
    super.key,
    required this.frameData,
    this.monitors = const [
      MonitorDisplay(
          index: 1, width: 2560, height: 1440, label: 'Display 1 (2560x1440)'),
      MonitorDisplay(
          index: 2, width: 1920, height: 1080, label: 'Display 2 (1920x1080)'),
    ],
    this.selectedMonitorIndex = 1,
    this.dominantAccentColor = const Color(0xFF00F0FF),
    this.isStreaming = true,
    this.onSelectMonitor,
    this.onTogglePip,
    this.onClose,
  });

  @override
  State<PipStreamViewer> createState() => _PipStreamViewerState();
}

class _PipStreamViewerState extends State<PipStreamViewer>
    with WidgetsBindingObserver {
  bool _isInPipMode = false;
  double _gyroOffsetX = 0.0;
  double _gyroOffsetY = 0.0;
  StreamSubscription<AccelerometerEvent>? _sensorSub;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initGyroscopeListener();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sensorSub?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Automatically transition to PiP when user swipes to home / leaves app
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      if (widget.isStreaming && !_isInPipMode) {
        setState(() {
          _isInPipMode = true;
        });
        widget.onTogglePip?.call();
      }
    } else if (state == AppLifecycleState.resumed) {
      if (_isInPipMode) {
        setState(() {
          _isInPipMode = false;
        });
      }
    }
  }

  void _initGyroscopeListener() {
    try {
      _sensorSub =
          accelerometerEventStream().listen((AccelerometerEvent event) {
        if (!mounted || _isInPipMode) return;
        // Damped low-pass filter for smooth perspective shifting
        final double targetX = (event.x / 9.8).clamp(-1.0, 1.0);
        final double targetY = (event.y / 9.8).clamp(-1.0, 1.0);

        setState(() {
          _gyroOffsetX = _gyroOffsetX * 0.85 + targetX * 0.15;
          _gyroOffsetY = _gyroOffsetY * 0.85 + targetY * 0.15;
        });
      });
    } catch (_) {
      // Gracefully ignore sensors on desktop or simulators without hardware accelerometers
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isInPipMode) {
      return _buildPiPOverlay();
    }
    return _buildExpandedViewer();
  }

  /// Minimalist PiP view: zero chrome, maximum stream performance
  Widget _buildPiPOverlay() {
    return Container(
      color: Colors.black,
      child: Stack(
        children: [
          Positioned.fill(
            child: RepaintBoundary(
              child: widget.frameData != null
                  ? Image.memory(
                      widget.frameData!,
                      gaplessPlayback: true,
                      fit: BoxFit.contain,
                      filterQuality: FilterQuality.medium,
                    )
                  : const Center(
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor:
                            AlwaysStoppedAnimation<Color>(Color(0xFF00F0FF)),
                      ),
                    ),
            ),
          ),
          Positioned(
            bottom: 6,
            left: 8,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.7),
                borderRadius: BorderRadius.circular(4),
                border: Border.all(
                    color: widget.dominantAccentColor.withValues(alpha: 0.5),
                    width: 0.8),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: widget.dominantAccentColor,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Text(
                    'PIP • 60 FPS',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                      fontFamily: 'monospace',
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Full-Screen Interactive Desktop Viewer with Gyro Mesh Gradient & Multi-Monitor Controls
  Widget _buildExpandedViewer() {
    return Scaffold(
      backgroundColor: const Color(0xFF040812),
      body: Stack(
        children: [
          // 1. Gyroscope-Driven Dynamic Cyber Mesh Gradient Background
          Positioned.fill(
            child: RepaintBoundary(
              child: CustomPaint(
                painter: _GyroMeshGradientPainter(
                  offsetX: _gyroOffsetX,
                  offsetY: _gyroOffsetY,
                  accentColor: widget.dominantAccentColor,
                ),
              ),
            ),
          ),

          // 2. High-Frequency Video Stream Frame (Isolated RepaintBoundary)
          SafeArea(
            child: Column(
              children: [
                // Top Control Bar: Multi-Monitor Switcher & PiP Toggle
                _buildHeaderBar(),

                // Center Frame Stream
                Expanded(
                  child: Center(
                    child: Container(
                      margin: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.black,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: widget.dominantAccentColor
                              .withValues(alpha: 0.35),
                          width: 1.5,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: widget.dominantAccentColor
                                .withValues(alpha: 0.12),
                            blurRadius: 24,
                            spreadRadius: 2,
                          ),
                        ],
                      ),
                      clipBehavior: Clip.antiAlias,
                      child: Stack(
                        children: [
                          Positioned.fill(
                            child: RepaintBoundary(
                              child: widget.frameData != null
                                  ? InteractiveViewer(
                                      maxScale: 4.0,
                                      minScale: 1.0,
                                      child: Image.memory(
                                        widget.frameData!,
                                        gaplessPlayback: true,
                                        fit: BoxFit.contain,
                                        filterQuality: FilterQuality.medium,
                                      ),
                                    )
                                  : _buildLoadingState(),
                            ),
                          ),

                          // Live HUD watermark in corner
                          Positioned(
                            bottom: 12,
                            left: 12,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: const Color(0xFF0A1628)
                                    .withValues(alpha: 0.85),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: Colors.white10),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    width: 8,
                                    height: 8,
                                    decoration: BoxDecoration(
                                      color: widget.dominantAccentColor,
                                      shape: BoxShape.circle,
                                      boxShadow: [
                                        BoxShadow(
                                          color: widget.dominantAccentColor,
                                          blurRadius: 6,
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    'DISPLAY ${widget.selectedMonitorIndex} • TURBOJPEG 60 FPS',
                                    style: const TextStyle(
                                      color: Colors.white70,
                                      fontSize: 10,
                                      fontWeight: FontWeight.bold,
                                      fontFamily: 'monospace',
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeaderBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFF081120).withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Row(
        children: [
          // Close button
          IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white70, size: 20),
            onPressed: widget.onClose ?? () => Navigator.of(context).pop(),
          ),

          const SizedBox(width: 4),

          // Multi-Monitor Switcher Pills ([ 1 ] [ 2 ] [ 3 ])
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: widget.monitors.map((mon) {
                  final bool isSelected =
                      mon.index == widget.selectedMonitorIndex;
                  return Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: InkWell(
                      onTap: () => widget.onSelectMonitor?.call(mon.index),
                      borderRadius: BorderRadius.circular(8),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? widget.dominantAccentColor
                                  .withValues(alpha: 0.2)
                              : Colors.white.withValues(alpha: 0.04),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: isSelected
                                ? widget.dominantAccentColor
                                : Colors.white12,
                            width: isSelected ? 1.5 : 1,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.monitor,
                              size: 14,
                              color: isSelected
                                  ? widget.dominantAccentColor
                                  : Colors.white60,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              '[ ${mon.index} ]',
                              style: TextStyle(
                                color:
                                    isSelected ? Colors.white : Colors.white60,
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                fontFamily: 'monospace',
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),

          // PiP Mode Trigger Button
          IconButton(
            tooltip: 'Picture-in-Picture режим',
            icon: Icon(Icons.picture_in_picture_alt,
                color: widget.dominantAccentColor, size: 20),
            onPressed: () {
              setState(() {
                _isInPipMode = true;
              });
              widget.onTogglePip?.call();
            },
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(
            valueColor:
                AlwaysStoppedAnimation<Color>(widget.dominantAccentColor),
          ),
          const SizedBox(height: 12),
          const Text(
            'Инициализиране на TurboJPEG видео поток...',
            style: TextStyle(color: Colors.white54, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

/// Custom GPU-Accelerated Gyroscope Mesh Gradient Painter
class _GyroMeshGradientPainter extends CustomPainter {
  final double offsetX;
  final double offsetY;
  final Color accentColor;

  _GyroMeshGradientPainter({
    required this.offsetX,
    required this.offsetY,
    required this.accentColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final Rect rect = Offset.zero & size;

    // Base deep obsidian background
    final Paint bgPaint = Paint()..color = const Color(0xFF040812);
    canvas.drawRect(rect, bgPaint);

    // Focal Point 1 (Dominant Accent Glow - shifting with device tilt)
    final Offset center1 = Offset(
      size.width * (0.3 + offsetX * 0.15),
      size.height * (0.3 + offsetY * 0.15),
    );
    final Paint glow1 = Paint()
      ..shader = RadialGradient(
        center: Alignment.center,
        radius: 0.8,
        colors: [
          accentColor.withValues(alpha: 0.18),
          accentColor.withValues(alpha: 0.04),
          Colors.transparent,
        ],
        stops: const [0.0, 0.5, 1.0],
      ).createShader(
          Rect.fromCircle(center: center1, radius: size.width * 0.75));

    canvas.drawCircle(center1, size.width * 0.75, glow1);

    // Focal Point 2 (Deep Cyber Violet Glow - opposite tilt perspective)
    final Offset center2 = Offset(
      size.width * (0.75 - offsetX * 0.12),
      size.height * (0.7 - offsetY * 0.12),
    );
    final Paint glow2 = Paint()
      ..shader = RadialGradient(
        center: Alignment.center,
        radius: 0.85,
        colors: [
          const Color(0xFF8A2BE2).withValues(alpha: 0.16),
          const Color(0xFF8A2BE2).withValues(alpha: 0.03),
          Colors.transparent,
        ],
        stops: const [0.0, 0.5, 1.0],
      ).createShader(
          Rect.fromCircle(center: center2, radius: size.width * 0.85));

    canvas.drawCircle(center2, size.width * 0.85, glow2);
  }

  @override
  bool shouldRepaint(covariant _GyroMeshGradientPainter oldDelegate) {
    return oldDelegate.offsetX != offsetX ||
        oldDelegate.offsetY != offsetY ||
        oldDelegate.accentColor != accentColor;
  }
}
