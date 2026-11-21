import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/app_preferences.dart';
import 'viewport_stream_widget.dart';

/// User-selectable orientation lock for fullscreen remote PC streaming.
enum StreamOrientationMode {
  landscape(label: 'LAND', icon: Icons.stay_current_landscape_rounded),
  portrait(label: 'PORT', icon: Icons.stay_current_portrait_rounded),
  auto(label: 'AUTO', icon: Icons.screen_rotation_rounded);

  final String label;
  final IconData icon;

  const StreamOrientationMode({
    required this.label,
    required this.icon,
  });

  StreamOrientationMode next() {
    final int nextIdx = (index + 1) % StreamOrientationMode.values.length;
    return StreamOrientationMode.values[nextIdx];
  }
}

/// True immersive fullscreen remote desktop touchscreen controller.
///
/// Features:
/// - Enables [SystemUiMode.immersiveSticky] on entry and cleanly restores
///   [SystemUiMode.edgeToEdge] and full [DeviceOrientation.values] on dispose.
/// - Respects [autoLandscape] preference with an in-stream orientation switcher
///   (`Landscape` / `Portrait` / `Auto`).
/// - Delegates full direct touchscreen control, pinch-to-zoom 1x–4x, Fit/Fill,
///   inline live keyboard bar, and collapsible HUD + draggable restore pill to
///   [ViewportStreamWidget].
class FullscreenStreamPage extends StatefulWidget {
  final String hostIp;
  final String hostName;
  final int wsPort;
  final String sharedSecret;
  final bool useTls;
  final String? certFingerprint;
  final int targetFps;
  final bool keepScreenAwake;
  final RemoteInputMode initialInputMode;
  final bool autoLandscape;
  final bool touchVisualFeedback;
  final bool hapticsEnabled;
  final String qualityPreset;
  final double trackpadSensitivity;
  final void Function(Map<String, dynamic> telemetry)? onTelemetry;
  final ValueChanged<String>? onQualityPresetChanged;

  const FullscreenStreamPage({
    super.key,
    required this.hostIp,
    required this.hostName,
    this.wsPort = 8765,
    this.sharedSecret = '',
    this.useTls = false,
    this.certFingerprint,
    this.targetFps = 30,
    this.keepScreenAwake = true,
    this.initialInputMode = RemoteInputMode.touchscreen,
    this.autoLandscape = true,
    this.touchVisualFeedback = true,
    this.hapticsEnabled = true,
    this.qualityPreset = 'auto',
    this.trackpadSensitivity = 1.6,
    this.onTelemetry,
    this.onQualityPresetChanged,
  });

  @override
  State<FullscreenStreamPage> createState() => _FullscreenStreamPageState();
}

class _FullscreenStreamPageState extends State<FullscreenStreamPage> {
  late StreamOrientationMode _orientationMode;

  @override
  void initState() {
    super.initState();
    _orientationMode = widget.autoLandscape
        ? StreamOrientationMode.landscape
        : StreamOrientationMode.auto;
    _enterImmersiveMode();
    _applyOrientation(_orientationMode);
  }

  void _enterImmersiveMode() {
    unawaited(
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky)
          .catchError((_) {}),
    );
  }

  void _applyOrientation(StreamOrientationMode mode) {
    final List<DeviceOrientation> orientations = switch (mode) {
      StreamOrientationMode.landscape => const [
          DeviceOrientation.landscapeLeft,
          DeviceOrientation.landscapeRight,
        ],
      StreamOrientationMode.portrait => const [
          DeviceOrientation.portraitUp,
          DeviceOrientation.portraitDown,
        ],
      StreamOrientationMode.auto => DeviceOrientation.values,
    };
    unawaited(
      SystemChrome.setPreferredOrientations(orientations).catchError((_) {}),
    );
  }

  void _cycleOrientation() {
    final StreamOrientationMode nextMode = _orientationMode.next();
    setState(() => _orientationMode = nextMode);
    _applyOrientation(nextMode);
  }

  void _restoreSystemChrome() {
    unawaited(
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge)
          .catchError((_) {}),
    );
    unawaited(
      SystemChrome.setPreferredOrientations(DeviceOrientation.values)
          .catchError((_) {}),
    );
  }

  @override
  void dispose() {
    _restoreSystemChrome();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      resizeToAvoidBottomInset: false,
      body: ViewportStreamWidget(
        hostIp: widget.hostIp,
        hostName: widget.hostName,
        wsPort: widget.wsPort,
        isInline: false,
        sharedSecret: widget.sharedSecret,
        useTls: widget.useTls,
        certFingerprint: widget.certFingerprint,
        targetFps: widget.targetFps,
        keepScreenAwake: widget.keepScreenAwake,
        initialInputMode: widget.initialInputMode,
        touchVisualFeedback: widget.touchVisualFeedback,
        hapticsEnabled: widget.hapticsEnabled,
        qualityPreset: widget.qualityPreset,
        trackpadSensitivity: widget.trackpadSensitivity,
        collapsibleHud: true,
        onExitFullscreen: () => Navigator.of(context).maybePop(),
        onCycleOrientation: _cycleOrientation,
        orientationLabel: _orientationMode.label,
        orientationIcon: _orientationMode.icon,
        onTelemetry: widget.onTelemetry,
        onQualityPresetChanged: widget.onQualityPresetChanged,
      ),
    );
  }
}
