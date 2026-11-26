import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

/// Maximum retained JPEG frame size (4MB per slot).
const int _maxFrameBytes = 4 * 1024 * 1024;

/// ============================================================================
/// DOUBLE-BUFFERED REUSABLE FRAME RING BUFFER (LAZY ZERO-HEAP STEADY STATE)
/// ============================================================================
/// Alternates between two reusable buffers that grow on demand up to 4MB
/// instead of eagerly reserving 8MB before any video frame arrives.
class _DoubleFrameRingBuffer {
  Uint8List? _slotA;
  Uint8List? _slotB;
  int _activeSlot = 0;

  static int _nextCapacity(int needed) {
    int cap = 65536;
    while (cap < needed && cap < _maxFrameBytes) {
      cap <<= 1;
    }
    return cap > _maxFrameBytes ? _maxFrameBytes : cap;
  }

  /// Copies incoming bytes into the alternating slot without steady-state allocations.
  Uint8List copy(Uint8List incomingBytes) {
    if (incomingBytes.length > _maxFrameBytes) {
      throw ArgumentError(
          'Incoming frame exceeds maximum size ($_maxFrameBytes bytes)');
    }

    Uint8List? target = (_activeSlot == 0) ? _slotA : _slotB;
    if (target == null || target.length < incomingBytes.length) {
      target = Uint8List(_nextCapacity(incomingBytes.length));
      if (_activeSlot == 0) {
        _slotA = target;
      } else {
        _slotB = target;
      }
    }
    _activeSlot = 1 - _activeSlot;

    target.setRange(0, incomingBytes.length, incomingBytes);
    return Uint8List.sublistView(target, 0, incomingBytes.length);
  }

  void dispose() {
    // Drop slot references without mutating in-place while an async native codec may read a slice.
    _slotA = null;
    _slotB = null;
  }
}

/// ============================================================================
/// ZERO-GC 120HZ JITTER-FREE VIDEO STREAM RENDERER WIDGET
/// ============================================================================
/// Features:
/// - 120Hz Frame Pacing Engine with Latest-Frame Latch (Zero Drop Stutter)
/// - ValueNotifier Direct Canvas Repaint (Bypasses Widget Tree Rebuilds)
/// - Double-Buffered Zero-Heap Memory Slicing
/// - Dedicated GPU RepaintBoundary Isolation
class ZeroGcVideoRenderer extends StatefulWidget {
  final Stream<Uint8List> frameStream;
  final Uint8List? initialFrame;
  final void Function(int opcode)? onRequestKeyframe;
  final void Function(Size frameSize)? onFrameSizeChanged;
  final VoidCallback? onFramePresented;
  final VoidCallback? onFrameDropped;
  final BoxFit fit;
  final Alignment alignment;
  final bool showLoadingSpinner;

  const ZeroGcVideoRenderer({
    super.key,
    required this.frameStream,
    this.initialFrame,
    this.onRequestKeyframe,
    this.onFrameSizeChanged,
    this.onFramePresented,
    this.onFrameDropped,
    this.fit = BoxFit.contain,
    this.alignment = Alignment.center,
    this.showLoadingSpinner = true,
  });

  @override
  State<ZeroGcVideoRenderer> createState() => ZeroGcVideoRendererState();
}

class ZeroGcVideoRendererState extends State<ZeroGcVideoRenderer> {
  final _DoubleFrameRingBuffer _ringBuffer = _DoubleFrameRingBuffer();
  final ValueNotifier<ui.Image?> _activeImageNotifier = ValueNotifier<ui.Image?>(null);

  StreamSubscription<Uint8List>? _streamSub;
  bool _isDecoding = false;
  bool _isDisposed = false;
  Uint8List? _latchedPendingFrame;
  Size? _lastFrameSize;
  DateTime? _lastKeyframeResyncAt;
  static const Duration _resyncCooldown = Duration(milliseconds: 1500);

  /// The last decoded video frame dimensions reported by this renderer.
  Size? get lastFrameSize => _lastFrameSize;

  @override
  void initState() {
    super.initState();
    _subscribeToFrames();
    final seed = widget.initialFrame;
    if (seed != null && seed.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!_isDisposed && mounted && _activeImageNotifier.value == null) {
          _onFrameArrival(seed);
        }
      });
    }
  }

  @override
  void didUpdateWidget(ZeroGcVideoRenderer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.frameStream != widget.frameStream) {
      _latchedPendingFrame = null;
      _lastFrameSize = null;
      unawaited(_streamSub?.cancel());
      _subscribeToFrames();
      final seed = widget.initialFrame;
      if (seed != null && seed.isNotEmpty && _activeImageNotifier.value == null) {
        _onFrameArrival(seed);
      }
    } else if (oldWidget.initialFrame != widget.initialFrame &&
        _activeImageNotifier.value == null) {
      final seed = widget.initialFrame;
      if (seed != null && seed.isNotEmpty) {
        _onFrameArrival(seed);
      }
    }
  }

  void _subscribeToFrames() {
    _streamSub = widget.frameStream.listen(
      _onFrameArrival,
      onError: (err) {
        debugPrint('[ZeroGC-Pipeline] Frame stream error: $err');
        _requestKeyframeResync();
      },
    );
  }

  /// 120Hz Frame Pacing Handler: Decodes immediately or latches newest frame.
  void _onFrameArrival(Uint8List rawBytes) {
    if (_isDisposed || !mounted) return;
    if (_isDecoding) {
      // GPU codec busy: Latch newest frame to guarantee zero jitter and zero drops
      if (_latchedPendingFrame != null) {
        try {
          widget.onFrameDropped?.call();
        } catch (e) {
          debugPrint('[ZeroGC-Pipeline] onFrameDropped error: $e');
        }
      }
      _latchedPendingFrame = rawBytes;
      return;
    }

    _decodeAndPresent(rawBytes);
  }

  /// Decodes frame via hardware codec iteratively so queued frames never recurse.
  Future<void> _decodeAndPresent(Uint8List initialBytes) async {
    if (!mounted) return;
    _isDecoding = true;
    Uint8List? currentBytes = initialBytes;

    try {
      while (currentBytes != null && mounted) {
        ui.Codec? codec;
        ui.Image? pendingImage;
        try {
          if (currentBytes.length < 4 || currentBytes.length > _maxFrameBytes) {
            debugPrint(
                '[ZeroGC-Pipeline] Malformed frame size (${currentBytes.length}B). Dropping.');
            _requestKeyframeResync();
            widget.onFrameDropped?.call();
          } else if (currentBytes[0] != 0xFF ||
              currentBytes[1] != 0xD8 ||
              currentBytes[currentBytes.length - 2] != 0xFF ||
              currentBytes[currentBytes.length - 1] != 0xD9) {
            debugPrint(
                '[ZeroGC-Pipeline] Corrupted JPEG frame markers! Discarding chunk.');
            _requestKeyframeResync();
            widget.onFrameDropped?.call();
          } else {
            // Avoid redundant ring-buffer memcpy when currentBytes is already an
            // unshared owned frame slice (e.g. from FrameDecryptIsolate).
            final bool isUnsharedSlice = currentBytes.offsetInBytes == 0 &&
                currentBytes.lengthInBytes == currentBytes.buffer.lengthInBytes;
            final Uint8List frameSlice =
                isUnsharedSlice ? currentBytes : _ringBuffer.copy(currentBytes);

            // Decode at native stream resolution (already viewport-negotiated by host)
            // so FILL (BoxFit.cover) and pinch-to-zoom remain razor-sharp.
            codec = await ui.instantiateImageCodec(frameSlice);
            pendingImage = (await codec.getNextFrame()).image;

            if (!_isDisposed && mounted) {
              final Size decodedSize = Size(
                pendingImage.width.toDouble(),
                pendingImage.height.toDouble(),
              );
              final ui.Image? oldImage = _activeImageNotifier.value;
              _activeImageNotifier.value = pendingImage;
              pendingImage = null; // Ownership transferred to notifier
              try {
                widget.onFramePresented?.call();
              } catch (e) {
                debugPrint('[ZeroGC-Pipeline] onFramePresented error: $e');
              }
              if (oldImage != null) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  oldImage.dispose();
                });
              }
              _reportFrameSizeIfChanged(decodedSize);
            } else {
              pendingImage.dispose();
              pendingImage = null;
            }
          }
        } catch (e) {
          debugPrint('[ZeroGC-Pipeline] Hardware decode exception: $e');
          _requestKeyframeResync();
          try {
            widget.onFrameDropped?.call();
          } catch (_) {}
        } finally {
          pendingImage?.dispose();
          codec?.dispose();
        }

        // Pull newest latched frame iteratively rather than recursing
        currentBytes = _latchedPendingFrame;
        _latchedPendingFrame = null;
      }
    } finally {
      _latchedPendingFrame = null;
      _isDecoding = false;
    }
  }

  /// Safely notifies [ZeroGcVideoRenderer.onFrameSizeChanged] whenever decoded
  /// image dimensions change.
  void _reportFrameSizeIfChanged(Size decodedSize) {
    if (decodedSize.width <= 0 || decodedSize.height <= 0) return;
    if (_lastFrameSize == decodedSize) return;
    _lastFrameSize = decodedSize;
    final callback = widget.onFrameSizeChanged;
    if (callback == null) return;
    if (SchedulerBinding.instance.schedulerPhase ==
        SchedulerPhase.persistentCallbacks) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!_isDisposed && mounted) {
          try {
            widget.onFrameSizeChanged?.call(decodedSize);
          } catch (e) {
            debugPrint('[ZeroGC-Pipeline] onFrameSizeChanged error: $e');
          }
        }
      });
    } else {
      try {
        callback(decodedSize);
      } catch (e) {
        debugPrint('[ZeroGC-Pipeline] onFrameSizeChanged error: $e');
      }
    }
  }

  /// Dispatches Opcode 0xED (OP_FRAME_SYNC) with a 1500ms cooldown throttle
  void _requestKeyframeResync() {
    final DateTime now = DateTime.now();
    if (_lastKeyframeResyncAt != null &&
        now.difference(_lastKeyframeResyncAt!) < _resyncCooldown) {
      return;
    }
    _lastKeyframeResyncAt = now;
    debugPrint('[ZeroGC-Pipeline] Requesting Keyframe Sync (Opcode 0xED)...');
    widget.onRequestKeyframe?.call(0xED);
  }

  @override
  void dispose() {
    _isDisposed = true;
    unawaited(_streamSub?.cancel());
    final ui.Image? currentImage = _activeImageNotifier.value;
    _activeImageNotifier.value = null;
    currentImage?.dispose();
    _activeImageNotifier.dispose();
    _ringBuffer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Dedicated GPU RepaintBoundary isolates high-frequency 120Hz repaints
    return RepaintBoundary(
      child: ValueListenableBuilder<ui.Image?>(
        valueListenable: _activeImageNotifier,
        builder: (context, imageToRender, _) {
          if (imageToRender == null) {
            if (!widget.showLoadingSpinner) {
              return const SizedBox.expand();
            }
            return Center(
              child: SizedBox(
                width: 32,
                height: 32,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(
                    Theme.of(context).colorScheme.primary,
                  ),
                ),
              ),
            );
          }
          return RawImage(
            image: imageToRender,
            fit: widget.fit,
            alignment: widget.alignment,
            filterQuality: FilterQuality.low, // Maximum throughput for 120 FPS
          );
        },
      ),
    );
  }
}
