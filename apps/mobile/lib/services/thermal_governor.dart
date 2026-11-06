import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Device Thermal & Battery Hardware Governance Engine
/// ============================================================================
/// Protects mobile SoCs from aggressive thermal throttling, battery degradation,
/// and frame drops during high-frequency encrypted video decompression.
///
/// States:
/// - Nominal:  30 FPS, Sigma 24 glassmorphism blur, active mesh gradient.
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
    targetFps: 30,
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
}

class ThermalGovernor extends ChangeNotifier {
  static final ThermalGovernor instance = ThermalGovernor._internal();
  ThermalGovernor._internal();

  ThermalProfile _currentProfile = ThermalProfile.nominal;
  int _batteryPercentage = 100;
  bool _isCharging = false;
  String _governorStatusMessage = "Operating in Nominal Hardware Profile (30 FPS)";

  ThermalProfile get profile => _currentProfile;
  int get batteryPercentage => _batteryPercentage;
  bool get isCharging => _isCharging;
  String get statusMessage => _governorStatusMessage;

  ThermalConfig get currentConfig {
    if (_batteryPercentage <= 15 && !_isCharging) {
      // Force low battery power-saving override
      return const ThermalConfig(
        targetFps: 5,
        blurSigma: 0.0,
        enableMeshGradient: false,
        enablePulsingAnimations: false,
        forceFlatAcrylic: true,
        isSnapshotOnlyMode: true,
      );
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

  /// Ingests system thermal state updates from native platform channels
  void updateThermalState(int thermalIndex) {
    ThermalProfile newProfile;
    if (thermalIndex <= 1) {
      newProfile = ThermalProfile.nominal;
      _governorStatusMessage = "Nominal: Full Glassmorphism Active (30 FPS)";
    } else if (thermalIndex == 2) {
      newProfile = ThermalProfile.fair;
      _governorStatusMessage = "Fair: Thermal Throttling Activated (20 FPS, Sigma 8)";
    } else {
      newProfile = ThermalProfile.critical;
      _governorStatusMessage = "Critical: GPU Throttling Active (10 FPS, Flat Acrylic)";
    }

    if (newProfile != _currentProfile) {
      _currentProfile = newProfile;
      notifyListeners();
    }
  }

  /// Updates battery state
  void updateBatteryState({required int percentage, required bool isCharging}) {
    final bool changed = (_batteryPercentage != percentage) || (_isCharging != isCharging);
    _batteryPercentage = percentage;
    _isCharging = isCharging;

    if (_batteryPercentage <= 15 && !_isCharging) {
      _governorStatusMessage = "Low Battery (<15%): Stream collapsed to On-Demand Snapshot Mode";
    }

    if (changed) {
      notifyListeners();
    }
  }

  /// Manually force a profile for testing / benchmarking
  void forceProfile(ThermalProfile profile) {
    _currentProfile = profile;
    notifyListeners();
  }
}
