import 'package:flutter/foundation.dart';

/// Device Thermal & Battery Hardware Governance Engine
/// ============================================================================
/// Protects mobile SoCs from aggressive thermal throttling, battery degradation,
/// and frame drops during high-frequency encrypted video decompression.
///
/// States:
/// - Nominal:  60 FPS, Sigma 24 glassmorphism blur, active mesh gradient.
/// - Fair:     20 FPS, Sigma 8 blur, reduced particle effects.
/// - Critical: 10 FPS, Flat acrylic fill (Color(0xFF081120)), no blur, snapshot mode.
/// - Low Battery (<15%): Auto-collapse continuous stream to on-demand snapshot.
/// ============================================================================

enum ThermalProfile {
  nominal,   // Standard full fidelity
  fair,      // Warm device, moderate throttling
  critical,  // Hot device, aggressive power saving
}

class ThermalConfig {
  final int targetFps;
  final double blurSigma;
  final bool enableMeshGradient;
  final bool enablePulsingAnimations;
  final bool forceFlatAcrylic;
  final bool isSnapshotOnlyMode;

  const ThermalConfig({
    required this.targetFps,
    required this.blurSigma,
    required this.enableMeshGradient,
    required this.enablePulsingAnimations,
    required this.forceFlatAcrylic,
    required this.isSnapshotOnlyMode,
  });

  static const nominal = ThermalConfig(
    targetFps: 60,
    blurSigma: 24.0,
    enableMeshGradient: true,
    enablePulsingAnimations: true,
    forceFlatAcrylic: false,
    isSnapshotOnlyMode: false,
  );

  static const fair = ThermalConfig(
    targetFps: 20,
    blurSigma: 8.0,
    enableMeshGradient: true,
    enablePulsingAnimations: false,
    forceFlatAcrylic: false,
    isSnapshotOnlyMode: false,
  );

  static const critical = ThermalConfig(
    targetFps: 10,
    blurSigma: 0.0,
    enableMeshGradient: false,
    enablePulsingAnimations: false,
    forceFlatAcrylic: true,
    isSnapshotOnlyMode: true,
  );

  static const lowBattery = ThermalConfig(
    targetFps: 5,
    blurSigma: 0.0,
    enableMeshGradient: false,
    enablePulsingAnimations: false,
    forceFlatAcrylic: true,
    isSnapshotOnlyMode: true,
  );

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is ThermalConfig &&
        other.targetFps == targetFps &&
        other.blurSigma == blurSigma &&
        other.enableMeshGradient == enableMeshGradient &&
        other.enablePulsingAnimations == enablePulsingAnimations &&
        other.forceFlatAcrylic == forceFlatAcrylic &&
        other.isSnapshotOnlyMode == isSnapshotOnlyMode;
  }

  @override
  int get hashCode => Object.hash(
        targetFps,
        blurSigma,
        enableMeshGradient,
        enablePulsingAnimations,
        forceFlatAcrylic,
        isSnapshotOnlyMode,
      );
}

class ThermalGovernor extends ChangeNotifier {
  static final ThermalGovernor instance = ThermalGovernor._internal();
  ThermalGovernor._internal();

  ThermalProfile _currentProfile = ThermalProfile.nominal;
  int _batteryPercentage = 100;
  bool _isCharging = false;
  String _governorStatusMessage = "Operating in Nominal Hardware Profile (60 FPS)";

  ThermalProfile get profile => _currentProfile;
  int get batteryPercentage => _batteryPercentage;
  bool get isCharging => _isCharging;
  bool get isLowBatteryOverride => _batteryPercentage <= 15 && !_isCharging;
  String get statusMessage => _governorStatusMessage;

  ThermalConfig get currentConfig {
    if (isLowBatteryOverride) {
      // Force low battery power-saving override
      return ThermalConfig.lowBattery;
    }

    switch (_currentProfile) {
      case ThermalProfile.nominal:
        return ThermalConfig.nominal;
      case ThermalProfile.fair:
        return ThermalConfig.fair;
      case ThermalProfile.critical:
        return ThermalConfig.critical;
    }
  }

  void _refreshStatusMessage() {
    if (isLowBatteryOverride) {
      _governorStatusMessage =
          "Low Battery (<15%): Stream collapsed to On-Demand Snapshot Mode";
    } else {
      _governorStatusMessage = _statusForProfile(_currentProfile);
    }
  }

  /// Ingests system thermal state updates from native platform channels
  void updateThermalState(int thermalIndex) {
    final ThermalProfile newProfile;
    if (thermalIndex <= 1) {
      newProfile = ThermalProfile.nominal;
    } else if (thermalIndex == 2) {
      newProfile = ThermalProfile.fair;
    } else {
      newProfile = ThermalProfile.critical;
    }

    if (newProfile != _currentProfile) {
      _currentProfile = newProfile;
      _refreshStatusMessage();
      notifyListeners();
    }
  }

  /// Updates battery state
  void updateBatteryState({required int percentage, required bool isCharging}) {
    final int clamped = percentage.clamp(0, 100);
    final bool changed =
        (_batteryPercentage != clamped) || (_isCharging != isCharging);
    _batteryPercentage = clamped;
    _isCharging = isCharging;
    _refreshStatusMessage();

    if (changed) {
      notifyListeners();
    }
  }

  static String _statusForProfile(ThermalProfile profile) {
    switch (profile) {
      case ThermalProfile.nominal:
        return "Nominal: Full Glassmorphism Active (60 FPS)";
      case ThermalProfile.fair:
        return "Fair: Thermal Throttling Activated (20 FPS, Sigma 8)";
      case ThermalProfile.critical:
        return "Critical: GPU Throttling Active (10 FPS, Flat Acrylic)";
    }
  }

  /// Manually force a profile for testing / benchmarking
  void forceProfile(ThermalProfile profile) {
    _currentProfile = profile;
    _refreshStatusMessage();
    notifyListeners();
  }
}
