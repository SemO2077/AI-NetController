import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import '../theme/fluid_theme.dart';

/// Visual accent style for animated touch feedback ripples.
enum TouchRippleStyle {
  tap,
  doubleTap,
  rightClick,
  dragStart,
  dragEnd,
}

class _TouchRipple {
  final Offset position;
  final TouchRippleStyle style;
  final DateTime startedAt;
  final Duration duration;

  const _TouchRipple({
    required this.position,
    required this.style,
    required this.startedAt,
    required this.duration,
  });

  double progressAt(DateTime now) {
    final int elapsedMs = now.difference(startedAt).inMilliseconds;
    if (elapsedMs <= 0) return 0.0;
    return (elapsedMs / duration.inMilliseconds).clamp(0.0, 1.0);
  }

  bool isExpiredAt(DateTime now) =>
      now.difference(startedAt) >= duration;
}

/// Imperative controller driving [TouchFeedbackOverlay] without triggering
/// parent widget tree rebuilds during high-frequency 120Hz touch input.
class TouchFeedbackController extends ChangeNotifier {
  static const int _maxConcurrentRipples = 10;
  static const Duration _cursorIdleFadeDelay = Duration(milliseconds: 700);
  static const Duration _cursorFadeDuration = Duration(milliseconds: 260);
  static const Duration _cursorClearFadeDuration = Duration(milliseconds: 160);

  final List<_TouchRipple> _ripples = <_TouchRipple>[];

  Offset? _cursorPosition;
  bool _isDragging = false;
  DateTime? _cursorUpdatedAt;
  DateTime? _cursorClearedAt;

  Offset? _longPressPosition;
  DateTime? _longPressStartedAt;
  Duration _longPressDuration = const Duration(milliseconds: 450);

  /// Number of currently animating ripples (for diagnostics & unit tests).
  int get activeRippleCount => _ripples.length;

  /// Active cursor reticle position in viewport local coordinates, if visible.
  Offset? get cursorPosition => _cursorPosition;

  /// True while a drag-and-drop operation is currently held down.
  bool get isDragging => _isDragging;

  /// True while a long-press right-click radial progress ring is active.
  bool get isLongPressActive =>
      _longPressPosition != null && _longPressStartedAt != null;

  /// True whenever any visual element requires frame ticks to animate or fade.
  bool get hasActiveVisuals =>
      _ripples.isNotEmpty || _cursorPosition != null || isLongPressActive;

  /// Fires an expanding touch ripple at [position].
  void triggerRipple(
    Offset position, {
    TouchRippleStyle style = TouchRippleStyle.tap,
  }) {
    if (!position.dx.isFinite || !position.dy.isFinite) return;
    final Duration dur = switch (style) {
      TouchRippleStyle.doubleTap => const Duration(milliseconds: 480),
      TouchRippleStyle.rightClick => const Duration(milliseconds: 420),
      TouchRippleStyle.dragStart => const Duration(milliseconds: 340),
      TouchRippleStyle.dragEnd => const Duration(milliseconds: 300),
      TouchRippleStyle.tap => const Duration(milliseconds: 360),
    };
    if (_ripples.length >= _maxConcurrentRipples) {
      _ripples.removeAt(0);
    }
    _ripples.add(
      _TouchRipple(
        position: position,
        style: style,
        startedAt: DateTime.now(),
        duration: dur,
      ),
    );
    notifyListeners();
  }

  /// Updates the live cursor reticle / target halo beneath the user's finger.
  void updateCursor(Offset position, {bool isDragging = false}) {
    if (!position.dx.isFinite || !position.dy.isFinite) return;
    _cursorPosition = position;
    _isDragging = isDragging;
    _cursorUpdatedAt = DateTime.now();
    _cursorClearedAt = null;
    notifyListeners();
  }

  /// Smoothly fades out the cursor halo when the finger lifts.
  void clearCursor() {
    if (_cursorPosition == null) return;
    _isDragging = false;
    _cursorClearedAt ??= DateTime.now();
    notifyListeners();
  }

  /// Starts the long-press radial right-click charge ring at [position].
  void startLongPress(
    Offset position, {
    Duration duration = const Duration(milliseconds: 450),
  }) {
    if (!position.dx.isFinite || !position.dy.isFinite) return;
    _longPressPosition = position;
    _longPressStartedAt = DateTime.now();
    _longPressDuration = duration;
    notifyListeners();
  }

  /// Cancels any active long-press radial ring.
  void cancelLongPress() {
    if (_longPressPosition == null && _longPressStartedAt == null) return;
    _longPressPosition = null;
    _longPressStartedAt = null;
    notifyListeners();
  }

  /// Completes a long-press right-click: dismisses the charge ring and fires
  /// an accented right-click ripple.
  void completeLongPress(Offset position) {
    _longPressPosition = null;
    _longPressStartedAt = null;
    triggerRipple(position, style: TouchRippleStyle.rightClick);
  }

  /// Immediately clears all active feedback visuals (e.g. on disconnect or toggle off).
  void clearAll() {
    if (!hasActiveVisuals) return;
    _ripples.clear();
    _cursorPosition = null;
    _isDragging = false;
    _cursorUpdatedAt = null;
    _cursorClearedAt = null;
    _longPressPosition = null;
    _longPressStartedAt = null;
    notifyListeners();
  }

  /// Prunes expired visuals at [now]. Returns `true` if any visuals remain active.
  bool _pruneAt(DateTime now) {
    _ripples.removeWhere((r) => r.isExpiredAt(now));

    if (_cursorPosition != null) {
      final double opacity = _cursorOpacityAt(now);
      if (opacity <= 0.0) {
        _cursorPosition = null;
        _isDragging = false;
        _cursorUpdatedAt = null;
        _cursorClearedAt = null;
      }
    }

    if (_longPressStartedAt != null) {
      final int elapsedMs = now.difference(_longPressStartedAt!).inMilliseconds;
      // Guard against orphaned long-press rings if gesture arena cancelled silently.
      if (elapsedMs > _longPressDuration.inMilliseconds + 900) {
        _longPressPosition = null;
        _longPressStartedAt = null;
      }
    }

    return hasActiveVisuals;
  }

  double _cursorOpacityAt(DateTime now) {
    if (_cursorPosition == null) return 0.0;
    if (_cursorClearedAt != null) {
      final int elapsed = now.difference(_cursorClearedAt!).inMilliseconds;
      final double t =
          (elapsed / _cursorClearFadeDuration.inMilliseconds).clamp(0.0, 1.0);
      return 1.0 - Curves.easeOut.transform(t);
    }
    if (_isDragging) return 1.0;
    if (_cursorUpdatedAt == null) return 1.0;
    final int idleMs = now.difference(_cursorUpdatedAt!).inMilliseconds;
    if (idleMs <= _cursorIdleFadeDelay.inMilliseconds) return 1.0;
    final int fadeMs = idleMs - _cursorIdleFadeDelay.inMilliseconds;
    final double t =
        (fadeMs / _cursorFadeDuration.inMilliseconds).clamp(0.0, 1.0);
    return 1.0 - Curves.easeOut.transform(t);
  }

  double _longPressProgressAt(DateTime now) {
    if (_longPressStartedAt == null || _longPressDuration.inMilliseconds <= 0) {
      return 0.0;
    }
    final int elapsedMs = now.difference(_longPressStartedAt!).inMilliseconds;
    return (elapsedMs / _longPressDuration.inMilliseconds).clamp(0.0, 1.0);
  }
}

/// GPU-cheap, non-interactive touch feedback layer painted over the remote PC
/// video surface.
///
/// Renders:
/// - Smooth expanding ripples for single-tap, double-tap, right-click, and drag
/// - Precision cursor target reticle beneath the finger (with warm drag glow)
/// - Animated radial charge ring while holding for a long-press right-click
///
/// Automatically stops its internal [Ticker] whenever idle so idle GPU/CPU cost
/// is zero and widget tests using `pumpAndSettle()` complete cleanly.
class TouchFeedbackOverlay extends StatefulWidget {
  final TouchFeedbackController controller;
  final bool enabled;
  final Color? primaryColor;
  final Color? accentColor;
  final Color? dragColor;

  const TouchFeedbackOverlay({
    super.key,
    required this.controller,
    this.enabled = true,
    this.primaryColor,
    this.accentColor,
    this.dragColor,
  });

  @override
  State<TouchFeedbackOverlay> createState() => _TouchFeedbackOverlayState();
}

class _TouchFeedbackOverlayState extends State<TouchFeedbackOverlay>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  final ValueNotifier<int> _paintEpoch = ValueNotifier<int>(0);
  DateTime _frameNow = DateTime.now();
  bool _reducedMotion = false;

  @override
  void initState() {
    super.initState();
    _ticker = createTicker(_onTick);
    widget.controller.addListener(_onControllerChanged);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reducedMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    _syncTicker();
  }

  @override
  void didUpdateWidget(covariant TouchFeedbackOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_onControllerChanged);
      widget.controller.addListener(_onControllerChanged);
    }
    if (!widget.enabled && _ticker.isActive) {
      _ticker.stop();
    }
    _syncTicker();
  }

  void _onControllerChanged() {
    if (!widget.enabled || _reducedMotion) {
      if (_ticker.isActive) _ticker.stop();
      return;
    }
    _frameNow = DateTime.now();
    _paintEpoch.value++;
    _syncTicker();
  }

  void _syncTicker() {
    if (!mounted) return;
    final bool shouldTick =
        widget.enabled && !_reducedMotion && widget.controller.hasActiveVisuals;
    if (shouldTick) {
      if (!_ticker.isActive) {
        _ticker.start();
      }
    } else if (_ticker.isActive) {
      _ticker.stop();
    }
  }

  void _onTick(Duration _) {
    if (!mounted || !widget.enabled || _reducedMotion) {
      _ticker.stop();
      return;
    }
    final DateTime now = DateTime.now();
    _frameNow = now;
    final bool stillActive = widget.controller._pruneAt(now);
    _paintEpoch.value++;
    if (!stillActive && _ticker.isActive) {
      _ticker.stop();
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerChanged);
    _ticker.dispose();
    _paintEpoch.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled || _reducedMotion) {
      return const SizedBox.shrink();
    }
    final CyberPalette palette = context.palette;
    final Color primary = widget.primaryColor ?? palette.primary;
    final Color accent = widget.accentColor ?? palette.accent;
    final Color drag = widget.dragColor ?? palette.warning;

    return IgnorePointer(
      child: RepaintBoundary(
        child: CustomPaint(
          painter: _TouchFeedbackPainter(
            controller: widget.controller,
            repaint: _paintEpoch,
            nowProvider: () => _frameNow,
            primaryColor: primary,
            accentColor: accent,
            dragColor: drag,
          ),
          size: Size.infinite,
        ),
      ),
    );
  }
}

class _TouchFeedbackPainter extends CustomPainter {
  final TouchFeedbackController controller;
  final DateTime Function() nowProvider;
  final Color primaryColor;
  final Color accentColor;
  final Color dragColor;

  _TouchFeedbackPainter({
    required this.controller,
    required Listenable repaint,
    required this.nowProvider,
    required this.primaryColor,
    required this.accentColor,
    required this.dragColor,
  }) : super(repaint: repaint);

  @override
  void paint(Canvas canvas, Size size) {
    final DateTime now = nowProvider();

    // 1. Live cursor target reticle & drag-active glow
    final Offset? cursorPos = controller._cursorPosition;
    if (cursorPos != null) {
      final double opacity = controller._cursorOpacityAt(now);
      if (opacity > 0.01) {
        _paintCursorHalo(
          canvas,
          cursorPos,
          opacity: opacity,
          isDragging: controller._isDragging,
        );
      }
    }

    // 2. Long-press right-click radial progress ring
    final Offset? lpPos = controller._longPressPosition;
    if (lpPos != null && controller._longPressStartedAt != null) {
      final double progress = controller._longPressProgressAt(now);
      if (progress > 0.02) {
        _paintLongPressRing(canvas, lpPos, progress);
      }
    }

    // 3. Expanding touch ripples
    for (final _TouchRipple ripple in controller._ripples) {
      final double t = ripple.progressAt(now);
      if (t >= 1.0) continue;
      _paintRipple(canvas, ripple, t);
    }
  }

  void _paintCursorHalo(
    Canvas canvas,
    Offset pos, {
    required double opacity,
    required bool isDragging,
  }) {
    final Color ringColor = isDragging ? dragColor : primaryColor;
    final double outerRadius = isDragging ? 22.0 : 15.0;

    if (isDragging) {
      // Soft radial drag-active glow
      final Paint glowPaint = Paint()
        ..shader = RadialGradient(
          colors: [
            ringColor.withValues(alpha: 0.34 * opacity),
            ringColor.withValues(alpha: 0.0),
          ],
        ).createShader(Rect.fromCircle(center: pos, radius: outerRadius * 1.45))
        ..style = PaintingStyle.fill;
      canvas.drawCircle(pos, outerRadius * 1.45, glowPaint);
    }

    // Crisp outer target ring
    final Paint ringPaint = Paint()
      ..color = ringColor.withValues(alpha: (isDragging ? 0.92 : 0.78) * opacity)
      ..style = PaintingStyle.stroke
      ..strokeWidth = isDragging ? 2.4 : 1.8
      ..isAntiAlias = true;
    canvas.drawCircle(pos, outerRadius, ringPaint);

    // Subtle inner contrast ring for visibility over both light & dark PC windows
    final Paint contrastPaint = Paint()
      ..color = Colors.white.withValues(alpha: 0.75 * opacity)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0
      ..isAntiAlias = true;
    canvas.drawCircle(pos, outerRadius - 2.2, contrastPaint);

    // Precision center reticle dot
    final Paint dotPaint = Paint()
      ..color = ringColor.withValues(alpha: 0.95 * opacity)
      ..style = PaintingStyle.fill;
    canvas.drawCircle(pos, isDragging ? 4.0 : 2.8, dotPaint);
  }

  void _paintLongPressRing(Canvas canvas, Offset pos, double progress) {
    final double eased = Curves.easeOutCubic.transform(progress);
    const double radius = 28.0;

    // Subtle backdrop track
    final Paint trackPaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.32)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4.0
      ..isAntiAlias = true;
    canvas.drawCircle(pos, radius, trackPaint);

    // Filling radial right-click arc
    final Paint arcPaint = Paint()
      ..color = accentColor.withValues(alpha: 0.95)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.4
      ..strokeCap = StrokeCap.round
      ..isAntiAlias = true;

    canvas.drawArc(
      Rect.fromCircle(center: pos, radius: radius),
      -math.pi / 2.0,
      math.pi * 2.0 * eased,
      false,
      arcPaint,
    );

    // Inner charging pulse
    final Paint innerPaint = Paint()
      ..color = accentColor.withValues(alpha: 0.22 * eased)
      ..style = PaintingStyle.fill;
    canvas.drawCircle(pos, 6.0 + (12.0 * eased), innerPaint);
  }

  void _paintRipple(Canvas canvas, _TouchRipple ripple, double t) {
    final double eased = Curves.easeOutCubic.transform(t);
    final double alpha = (1.0 - t).clamp(0.0, 1.0);
    final Color baseColor = switch (ripple.style) {
      TouchRippleStyle.rightClick => accentColor,
      TouchRippleStyle.dragStart => dragColor,
      TouchRippleStyle.dragEnd => dragColor,
      TouchRippleStyle.doubleTap => primaryColor,
      TouchRippleStyle.tap => primaryColor,
    };

    final double maxRadius = switch (ripple.style) {
      TouchRippleStyle.doubleTap => 38.0,
      TouchRippleStyle.rightClick => 36.0,
      TouchRippleStyle.dragStart => 30.0,
      TouchRippleStyle.dragEnd => 24.0,
      TouchRippleStyle.tap => 30.0,
    };

    final double radius = 6.0 + (maxRadius - 6.0) * eased;

    final Paint fillPaint = Paint()
      ..color = baseColor.withValues(alpha: 0.20 * alpha)
      ..style = PaintingStyle.fill;
    canvas.drawCircle(ripple.position, radius, fillPaint);

    final Paint strokePaint = Paint()
      ..color = baseColor.withValues(alpha: 0.88 * alpha)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.2 * (1.0 - 0.35 * t)
      ..isAntiAlias = true;
    canvas.drawCircle(ripple.position, radius, strokePaint);

    // Secondary staggered outer ring for double-tap & right-click clarity
    if (ripple.style == TouchRippleStyle.doubleTap ||
        ripple.style == TouchRippleStyle.rightClick) {
      final double t2 = ((t - 0.16) / 0.84).clamp(0.0, 1.0);
      if (t2 > 0.0) {
        final double eased2 = Curves.easeOutCubic.transform(t2);
        final double alpha2 = (1.0 - t2).clamp(0.0, 1.0);
        final double radius2 = 8.0 + ((maxRadius + 10.0) - 8.0) * eased2;
        final Paint ring2 = Paint()
          ..color = Colors.white.withValues(alpha: 0.72 * alpha2)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.6
          ..isAntiAlias = true;
        canvas.drawCircle(ripple.position, radius2, ring2);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _TouchFeedbackPainter oldDelegate) {
    return oldDelegate.controller != controller ||
        oldDelegate.primaryColor != primaryColor ||
        oldDelegate.accentColor != accentColor ||
        oldDelegate.dragColor != dragColor;
  }
}
