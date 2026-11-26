import 'package:flutter/material.dart';

/// Result of mapping a local viewport touch point into normalized PC screen space.
@immutable
class MappedTouchPoint {
  /// Normalized PC coordinate in `[0.0, 1.0] x [0.0, 1.0]`.
  final Offset normalized;

  /// True when the touch fell within the actual rendered video bounds
  /// (false when tapping inside letterbox/pillarbox black bars or outside bounds).
  final bool isInsideVideo;

  /// Touch point transformed back into unzoomed container space.
  final Offset contentPosition;

  /// Rendered destination rectangle of the video inside the unzoomed container.
  final Rect videoRect;

  const MappedTouchPoint({
    required this.normalized,
    required this.isInsideVideo,
    required this.contentPosition,
    required this.videoRect,
  });

  double get nx => normalized.dx;
  double get ny => normalized.dy;

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is MappedTouchPoint &&
        other.normalized == normalized &&
        other.isInsideVideo == isInsideVideo &&
        other.contentPosition == contentPosition &&
        other.videoRect == videoRect;
  }

  @override
  int get hashCode =>
      Object.hash(normalized, isInsideVideo, contentPosition, videoRect);

  @override
  String toString() =>
      'MappedTouchPoint(nx: ${nx.toStringAsFixed(4)}, ny: ${ny.toStringAsFixed(4)}, inside: $isInsideVideo)';
}

/// Pure, allocation-light coordinate mapper between mobile viewport touch points
/// (with arbitrary [BoxFit], [Alignment], decoded frame [Size], and pinch-zoom/pan
/// [Matrix4]) and normalized `[0.0..1.0]` remote PC desktop coordinates.
///
/// Mirrors Flutter's [paintImage] / [applyBoxFit] layout math pixel-for-pixel so
/// direct touchscreen input stays dead-center under the user's finger across
/// `BoxFit.contain` (letterbox/pillarbox), `BoxFit.cover` (cropped edges),
/// `BoxFit.fill`, multi-monitor aspect ratios, and 1x–4x pinch-to-zoom.
class TouchCoordinateMapper {
  TouchCoordinateMapper._();

  static const double _edgeEpsilon = 1e-6;

  /// Computes the rendered destination rectangle of [frameSize] inside [containerSize]
  /// for the given [fit] and [alignment].
  static Rect computeVideoRect({
    required Size containerSize,
    required Size frameSize,
    BoxFit fit = BoxFit.contain,
    Alignment alignment = Alignment.center,
  }) {
    if (!_isValidSize(containerSize)) {
      return Rect.zero;
    }
    final Size effectiveFrame =
        _isValidSize(frameSize) ? frameSize : containerSize;
    final FittedSizes fitted = applyBoxFit(fit, effectiveFrame, containerSize);
    return alignment.inscribe(fitted.destination, Offset.zero & containerSize);
  }

  /// Maps a touch [localPosition] in the container's viewport space into a
  /// normalized `[0.0..1.0]` PC screen coordinate.
  static MappedTouchPoint mapToNormalized({
    required Offset localPosition,
    required Size containerSize,
    required Size frameSize,
    BoxFit fit = BoxFit.contain,
    Alignment alignment = Alignment.center,
    Matrix4? transform,
  }) {
    if (!_isValidSize(containerSize) ||
        !localPosition.dx.isFinite ||
        !localPosition.dy.isFinite) {
      return const MappedTouchPoint(
        normalized: Offset(0.5, 0.5),
        isInsideVideo: false,
        contentPosition: Offset.zero,
        videoRect: Rect.zero,
      );
    }

    final Size effectiveFrame =
        _isValidSize(frameSize) ? frameSize : containerSize;

    // 1. Invert pinch-zoom / pan transform to recover unzoomed child coordinates.
    final Offset contentPos = _invertTransformPoint(localPosition, transform);

    // 2. Match Flutter's paintImage sourceRect & destinationRect exactly.
    final FittedSizes fitted = applyBoxFit(fit, effectiveFrame, containerSize);
    final Rect sourceRect =
        alignment.inscribe(fitted.source, Offset.zero & effectiveFrame);
    final Rect destRect =
        alignment.inscribe(fitted.destination, Offset.zero & containerSize);

    if (destRect.width <= 0.0 ||
        destRect.height <= 0.0 ||
        sourceRect.width <= 0.0 ||
        sourceRect.height <= 0.0) {
      return MappedTouchPoint(
        normalized: const Offset(0.5, 0.5),
        isInsideVideo: false,
        contentPosition: contentPos,
        videoRect: destRect,
      );
    }

    final double u = (contentPos.dx - destRect.left) / destRect.width;
    final double v = (contentPos.dy - destRect.top) / destRect.height;

    final bool insideDest =
        u >= -_edgeEpsilon &&
        u <= 1.0 + _edgeEpsilon &&
        v >= -_edgeEpsilon &&
        v <= 1.0 + _edgeEpsilon;

    final double srcX = sourceRect.left + (u * sourceRect.width);
    final double srcY = sourceRect.top + (v * sourceRect.height);

    final double rawNx = srcX / effectiveFrame.width;
    final double rawNy = srcY / effectiveFrame.height;

    final bool insideSource =
        rawNx >= -_edgeEpsilon &&
        rawNx <= 1.0 + _edgeEpsilon &&
        rawNy >= -_edgeEpsilon &&
        rawNy <= 1.0 + _edgeEpsilon;

    final double clampedNx = rawNx.isFinite ? rawNx.clamp(0.0, 1.0) : 0.5;
    final double clampedNy = rawNy.isFinite ? rawNy.clamp(0.0, 1.0) : 0.5;

    return MappedTouchPoint(
      normalized: Offset(clampedNx, clampedNy),
      isInsideVideo: insideDest && insideSource,
      contentPosition: contentPos,
      videoRect: destRect,
    );
  }

  /// Inverse of [mapToNormalized]: converts a normalized `[0.0..1.0]` PC coordinate
  /// into viewport local coordinates (taking [fit], [alignment], and [transform]
  /// into account).
  static Offset normalizedToViewport({
    required Offset normalized,
    required Size containerSize,
    required Size frameSize,
    BoxFit fit = BoxFit.contain,
    Alignment alignment = Alignment.center,
    Matrix4? transform,
  }) {
    if (!_isValidSize(containerSize)) {
      return Offset.zero;
    }
    final Size effectiveFrame =
        _isValidSize(frameSize) ? frameSize : containerSize;
    final FittedSizes fitted = applyBoxFit(fit, effectiveFrame, containerSize);
    final Rect sourceRect =
        alignment.inscribe(fitted.source, Offset.zero & effectiveFrame);
    final Rect destRect =
        alignment.inscribe(fitted.destination, Offset.zero & containerSize);

    if (sourceRect.width <= 0.0 || sourceRect.height <= 0.0) {
      return destRect.center;
    }

    final double nx =
        normalized.dx.isFinite ? normalized.dx.clamp(0.0, 1.0) : 0.5;
    final double ny =
        normalized.dy.isFinite ? normalized.dy.clamp(0.0, 1.0) : 0.5;

    final double srcX = nx * effectiveFrame.width;
    final double srcY = ny * effectiveFrame.height;

    final double u = (srcX - sourceRect.left) / sourceRect.width;
    final double v = (srcY - sourceRect.top) / sourceRect.height;

    final Offset childPt = Offset(
      destRect.left + (u * destRect.width),
      destRect.top + (v * destRect.height),
    );
    if (transform == null || transform.isIdentity()) {
      return childPt;
    }
    final Offset transformed = MatrixUtils.transformPoint(transform, childPt);
    if (!transformed.dx.isFinite || !transformed.dy.isFinite) {
      return childPt;
    }
    return transformed;
  }

  /// Extracts the uniform zoom scale from a 2D zoom/pan [Matrix4].
  static double extractScale(Matrix4 transform) {
    final double s = transform.getMaxScaleOnAxis();
    if (!s.isFinite || s <= 0.0) return 1.0;
    return s;
  }

  /// Computes a bounded 2D pinch-zoom & pan [Matrix4] that keeps the content
  /// point under [previousFocalPoint] anchored to [currentFocalPoint], clamps
  /// scale to `[minScale, maxScale]`, and prevents panning the viewport off-screen.
  static Matrix4 computeZoomPanMatrix({
    required Matrix4 currentTransform,
    required double targetScale,
    required Offset previousFocalPoint,
    required Offset currentFocalPoint,
    required Size containerSize,
    double minScale = 1.0,
    double maxScale = 4.0,
  }) {
    if (!_isValidSize(containerSize)) {
      return Matrix4.identity();
    }
    final double safeMin = minScale.isFinite && minScale > 0 ? minScale : 1.0;
    final double safeMax =
        maxScale.isFinite && maxScale >= safeMin ? maxScale : safeMin;
    final double nextScale = targetScale.isFinite
        ? targetScale.clamp(safeMin, safeMax)
        : safeMin;

    if (nextScale <= safeMin + 0.001 && safeMin == 1.0) {
      return Matrix4.identity();
    }

    final double currScale = extractScale(currentTransform);
    final double currTx = currentTransform.storage[12].isFinite
        ? currentTransform.storage[12]
        : 0.0;
    final double currTy = currentTransform.storage[13].isFinite
        ? currentTransform.storage[13]
        : 0.0;

    final Offset fallbackCenter =
        Offset(containerSize.width * 0.5, containerSize.height * 0.5);
    final Offset safePrevFocal =
        (previousFocalPoint.dx.isFinite && previousFocalPoint.dy.isFinite)
            ? previousFocalPoint
            : fallbackCenter;
    final Offset safeCurrFocal =
        (currentFocalPoint.dx.isFinite && currentFocalPoint.dy.isFinite)
            ? currentFocalPoint
            : safePrevFocal;

    // Content point currently beneath previousFocalPoint:
    final double contentX = (safePrevFocal.dx - currTx) / currScale;
    final double contentY = (safePrevFocal.dy - currTy) / currScale;

    // Translation needed so that same content point lands at currentFocalPoint:
    final double rawTx = safeCurrFocal.dx - (nextScale * contentX);
    final double rawTy = safeCurrFocal.dy - (nextScale * contentY);

    return _buildClampedMatrix(
      scale: nextScale,
      tx: rawTx,
      ty: rawTy,
      containerSize: containerSize,
    );
  }

  /// Clamps an existing zoom/pan [transform] to valid bounds (e.g. after device
  /// rotation or viewport resize).
  static Matrix4 clampZoomTransform({
    required Matrix4 transform,
    required Size containerSize,
    double minScale = 1.0,
    double maxScale = 4.0,
  }) {
    if (!_isValidSize(containerSize)) {
      return Matrix4.identity();
    }
    final double safeMin = minScale.isFinite && minScale > 0 ? minScale : 1.0;
    final double safeMax =
        maxScale.isFinite && maxScale >= safeMin ? maxScale : safeMin;
    final double safeScale = extractScale(transform).clamp(safeMin, safeMax);
    if (safeScale <= safeMin + 0.001 && safeMin == 1.0) {
      return Matrix4.identity();
    }
    final double tx =
        transform.storage[12].isFinite ? transform.storage[12] : 0.0;
    final double ty =
        transform.storage[13].isFinite ? transform.storage[13] : 0.0;
    return _buildClampedMatrix(
      scale: safeScale,
      tx: tx,
      ty: ty,
      containerSize: containerSize,
    );
  }

  static Matrix4 _buildClampedMatrix({
    required double scale,
    required double tx,
    required double ty,
    required Size containerSize,
  }) {
    final double minTx = containerSize.width * (1.0 - scale);
    final double minTy = containerSize.height * (1.0 - scale);
    final double clampedTx =
        minTx <= 0.0 ? tx.clamp(minTx, 0.0) : (containerSize.width * (1.0 - scale)) / 2.0;
    final double clampedTy =
        minTy <= 0.0 ? ty.clamp(minTy, 0.0) : (containerSize.height * (1.0 - scale)) / 2.0;

    final Matrix4 out = Matrix4.identity();
    out.storage[0] = scale;
    out.storage[5] = scale;
    out.storage[12] = clampedTx.isFinite ? clampedTx : 0.0;
    out.storage[13] = clampedTy.isFinite ? clampedTy : 0.0;
    return out;
  }

  static Offset _invertTransformPoint(Offset point, Matrix4? transform) {
    if (transform == null || transform.isIdentity()) {
      return point;
    }
    final Matrix4 inv = Matrix4.identity();
    final double det = inv.copyInverse(transform);
    if (!det.isFinite || det.abs() < 1e-12) {
      return point;
    }
    final Offset inverted = MatrixUtils.transformPoint(inv, point);
    if (!inverted.dx.isFinite || !inverted.dy.isFinite) {
      return point;
    }
    return inverted;
  }

  static bool _isValidSize(Size s) =>
      s.width.isFinite && s.height.isFinite && s.width > 0.0 && s.height > 0.0;
}
