import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:sensors_plus/sensors_plus.dart';
import '../services/thermal_governor.dart';
import '../theme/fluid_theme.dart';

/// Monitor display specification from Opcode 0x0D (DISPLAY_ENUMERATION)
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
    this.monitors = const [],
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
  bool _reducedMotion = false;
  bool _appPaused = false;
  final ValueNotifier<Offset> _gyroOffsetNotifier =
      ValueNotifier<Offset>(Offset.zero);
  final TransformationController _transformController =
      TransformationController();
  final ValueNotifier<double> _zoomScaleNotifier = ValueNotifier<double>(1.0);
  StreamSubscription<AccelerometerEvent>? _sensorSub;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    ThermalGovernor.instance.addListener(_syncSensorSubscription);
    _transformController.addListener(_onTransformChanged);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final bool nextReduced = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (_reducedMotion != nextReduced || _sensorSub == null) {
      _reducedMotion = nextReduced;
      _syncSensorSubscription();
    }
  }

  @override
  void didUpdateWidget(covariant PipStreamViewer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedMonitorIndex != widget.selectedMonitorIndex &&
        _zoomScaleNotifier.value > 1.02) {
      _resetZoom();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    ThermalGovernor.instance.removeListener(_syncSensorSubscription);
    _transformController.removeListener(_onTransformChanged);
    _transformController.dispose();
    _zoomScaleNotifier.dispose();
    unawaited(_sensorSub?.cancel());
    _sensorSub = null;
    _gyroOffsetNotifier.dispose();
    super.dispose();
  }

  void _onTransformChanged() {
    final double scale = _transformController.value.getMaxScaleOnAxis();
    final double safeScale = scale.isFinite && scale > 0 ? scale : 1.0;
    if ((_zoomScaleNotifier.value - safeScale).abs() > 0.01) {
      _zoomScaleNotifier.value = safeScale;
    }
  }

  void _resetZoom() {
    _transformController.value = Matrix4.identity();
    _zoomScaleNotifier.value = 1.0;
  }

  bool get _shouldRunGyro =>
      !_isInPipMode &&
      !_appPaused &&
      !_reducedMotion &&
      ThermalGovernor.instance.currentConfig.enableMeshGradient;

  void _syncSensorSubscription() {
    if (!mounted) return;
    if (!_shouldRunGyro) {
      if (_sensorSub != null && !_sensorSub!.isPaused) {
        _sensorSub!.pause();
      }
      if (_gyroOffsetNotifier.value != Offset.zero) {
        _gyroOffsetNotifier.value = Offset.zero;
      }
      return;
    }

    if (_sensorSub != null) {
      if (_sensorSub!.isPaused) {
        _sensorSub!.resume();
      }
      return;
    }
    _initGyroscopeListener();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    // Automatically transition to PiP when user swipes to home / leaves app
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      _appPaused = true;
      if (widget.isStreaming && !_isInPipMode) {
        setState(() {
          _isInPipMode = true;
        });
        widget.onTogglePip?.call();
      }
      _syncSensorSubscription();
    } else if (state == AppLifecycleState.resumed) {
      _appPaused = false;
      if (_isInPipMode) {
        setState(() {
          _isInPipMode = false;
        });
      }
      _syncSensorSubscription();
    }
  }

  void _initGyroscopeListener() {
    try {
      _sensorSub = accelerometerEventStream().listen(
        (AccelerometerEvent event) {
          if (!mounted || !_shouldRunGyro) return;
          // Damped low-pass filter with micro-jitter deadzone to avoid needless GPU repaints
          final double targetX = (event.x / 9.8).clamp(-1.0, 1.0);
          final double targetY = (event.y / 9.8).clamp(-1.0, 1.0);
          final Offset prev = _gyroOffsetNotifier.value;
          final double nextX = prev.dx * 0.85 + targetX * 0.15;
          final double nextY = prev.dy * 0.85 + targetY * 0.15;
          if ((nextX - prev.dx).abs() > 0.002 ||
              (nextY - prev.dy).abs() > 0.002) {
            _gyroOffsetNotifier.value = Offset(nextX, nextY);
          }
        },
        onError: (_) {},
        cancelOnError: true,
      );
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
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onDoubleTap: () {
        if (mounted && _isInPipMode) {
          setState(() => _isInPipMode = false);
          _syncSensorSubscription();
        }
      },
      child: Container(
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
                    : Center(
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            widget.dominantAccentColor,
                          ),
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
      ),
    );
  }

  String _activeDisplayBadgeText() {
    for (final mon in widget.monitors) {
      if (mon.index == widget.selectedMonitorIndex) {
        final String res =
            (mon.width > 0 && mon.height > 0) ? ' · ${mon.width}×${mon.height}' : '';
        return 'Display ${mon.index}$res';
      }
    }
    return 'Display ${widget.selectedMonitorIndex}';
  }

  /// Full-Screen Interactive Desktop Viewer with Gyro Mesh Gradient & Multi-Monitor Controls
  Widget _buildExpandedViewer() {
    final palette = context.palette;
    final Color activeAccent = palette.primary;

    return Scaffold(
      backgroundColor: palette.background,
      body: Stack(
        children: [
          // 1. Gyroscope-Driven Dynamic Mesh Gradient Background
          Positioned.fill(
            child: RepaintBoundary(
              child: ValueListenableBuilder<Offset>(
                valueListenable: _gyroOffsetNotifier,
                builder: (_, offset, _) => CustomPaint(
                  painter: _GyroMeshGradientPainter(
                    offsetX: offset.dx,
                    offsetY: offset.dy,
                    accentColor: activeAccent,
                    secondaryColor: palette.secondary,
                    backgroundColor: palette.background,
                  ),
                ),
              ),
            ),
          ),

          // 2. High-Frequency Video Stream Frame (Isolated RepaintBoundary)
          SafeArea(
            child: Column(
              children: [
                // Top Control Bar: Multi-Monitor Switcher & PiP Toggle
                _buildHeaderBar(palette),

                // Center Frame Stream (Video viewport stays strictly dark for contrast)
                Expanded(
                  child: Center(
                    child: Container(
                      margin: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.black,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: activeAccent.withValues(alpha: 0.40),
                          width: 1.5,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: activeAccent.withValues(
                                alpha: palette.isDaylight ? 0.16 : 0.14),
                            blurRadius: 24,
                            spreadRadius: 1,
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
                                      transformationController:
                                          _transformController,
                                      maxScale: 4.0,
                                      minScale: 1.0,
                                      child: Image.memory(
                                        widget.frameData!,
                                        gaplessPlayback: true,
                                        fit: BoxFit.contain,
                                        filterQuality: FilterQuality.medium,
                                      ),
                                    )
                                  : _buildLoadingState(activeAccent),
                            ),
                          ),

                          // Crisp 1-tap Zoom Reset pill when zoomed > 1.02x
                          Positioned(
                            top: 12,
                            right: 12,
                            child: ValueListenableBuilder<double>(
                              valueListenable: _zoomScaleNotifier,
                              builder: (_, scale, _) {
                                if (scale <= 1.02) {
                                  return const SizedBox.shrink();
                                }
                                return Material(
                                  color: Colors.transparent,
                                  child: InkWell(
                                    key: const ValueKey('pip-zoom-reset-pill'),
                                    onTap: _resetZoom,
                                    borderRadius: BorderRadius.circular(999),
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 10, vertical: 6),
                                      decoration: BoxDecoration(
                                        color: palette.surfaceElevated
                                            .withValues(alpha: 0.92),
                                        borderRadius:
                                            BorderRadius.circular(999),
                                        border: Border.all(
                                          color: palette.primary
                                              .withValues(alpha: 0.65),
                                        ),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          Icon(
                                            Icons.zoom_out_map_rounded,
                                            size: 14,
                                            color: palette.primary,
                                          ),
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
                              },
                            ),
                          ),

                          // Live HUD watermark pill in corner
                          Positioned(
                            bottom: 12,
                            left: 12,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 5),
                              decoration: BoxDecoration(
                                color: Colors.black.withValues(alpha: 0.78),
                                borderRadius: BorderRadius.circular(999),
                                border: Border.all(color: Colors.white24),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Container(
                                    width: 7,
                                    height: 7,
                                    decoration: BoxDecoration(
                                      color: palette.success,
                                      shape: BoxShape.circle,
                                      boxShadow: [
                                        BoxShadow(
                                          color: palette.success,
                                          blurRadius: 6,
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    '${_activeDisplayBadgeText()} • TurboJPEG',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w700,
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

  Widget _buildHeaderBar(CyberPalette palette) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: palette.surfaceElevated
            .withValues(alpha: palette.isDaylight ? 0.92 : 0.88),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: palette.glassBorderIdle),
        boxShadow: [
          BoxShadow(
            color: palette.primary.withValues(
                alpha: palette.isDaylight ? 0.10 : 0.16),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Close viewer',
            icon: Icon(Icons.arrow_back_rounded,
                color: palette.textPrimary, size: 20),
            onPressed: widget.onClose ?? () => Navigator.of(context).pop(),
          ),
          const SizedBox(width: 4),
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
                      borderRadius: BorderRadius.circular(999),
                      child: AnimatedContainer(
                        duration: _reducedMotion
                            ? Duration.zero
                            : const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 7),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? palette.primary.withValues(
                                  alpha: palette.isDaylight ? 0.15 : 0.24)
                              : palette.isDaylight
                                  ? palette.primary.withValues(alpha: 0.05)
                                  : Colors.white.withValues(alpha: 0.05),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: isSelected
                                ? palette.primary
                                : palette.dividerColor,
                            width: isSelected ? 1.4 : 1,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.monitor_rounded,
                              size: 14,
                              color: isSelected
                                  ? palette.primary
                                  : palette.textSecondary,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              'Display ${mon.index}',
                              style: TextStyle(
                                color: isSelected
                                    ? palette.primary
                                    : palette.textPrimary,
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
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
          IconButton(
            tooltip: 'Picture-in-Picture mode',
            icon: Icon(Icons.picture_in_picture_alt_rounded,
                color: palette.primary, size: 20),
            onPressed: () {
              setState(() {
                _isInPipMode = true;
              });
              _syncSensorSubscription();
              widget.onTogglePip?.call();
            },
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingState(Color accentColor) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(
            valueColor: AlwaysStoppedAnimation<Color>(accentColor),
          ),
          const SizedBox(height: 12),
          const Text(
            'Initializing live video stream...',
            style: TextStyle(color: Colors.white70, fontSize: 12),
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
  final Color secondaryColor;
  final Color backgroundColor;

  _GyroMeshGradientPainter({
    required this.offsetX,
    required this.offsetY,
    required this.accentColor,
    required this.secondaryColor,
    required this.backgroundColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final Rect rect = Offset.zero & size;

    // Theme-matched Liquid Glass base background
    final Paint bgPaint = Paint()..color = backgroundColor;
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

    // Focal Point 2 (Secondary Accent Glow - opposite tilt perspective)
    final Offset center2 = Offset(
      size.width * (0.75 - offsetX * 0.12),
      size.height * (0.7 - offsetY * 0.12),
    );
    final Paint glow2 = Paint()
      ..shader = RadialGradient(
        center: Alignment.center,
        radius: 0.85,
        colors: [
          secondaryColor.withValues(alpha: 0.16),
          secondaryColor.withValues(alpha: 0.03),
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
        oldDelegate.accentColor != accentColor ||
        oldDelegate.secondaryColor != secondaryColor ||
        oldDelegate.backgroundColor != backgroundColor;
  }
}
