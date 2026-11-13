import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

import '../theme/fluid_theme.dart';

const String kAppPrefsBoxName = 'app_preferences';
const String kVaultSecretsBoxName = 'vault_secrets';

@immutable
class AppPreferencesState {
  final CyberAccentPreset accent;
  final GlassIntensity glassIntensity;
  final bool reducedMotion;
  final int targetFps;
  final bool biometricLockEnabled;
  final bool preferTls;
  final bool enableE2eVault;
  final bool hasCompletedOnboarding;
  final int customScanPort;
  final List<String> terminalHistory;

  const AppPreferencesState({
    this.accent = CyberAccentPreset.cyan,
    this.glassIntensity = GlassIntensity.balanced,
    this.reducedMotion = false,
    this.targetFps = 30,
    this.biometricLockEnabled = false,
    this.preferTls = false,
    this.enableE2eVault = true,
    this.hasCompletedOnboarding = false,
    this.customScanPort = 8765,
    this.terminalHistory = const [],
  });

  AppPreferencesState copyWith({
    CyberAccentPreset? accent,
    GlassIntensity? glassIntensity,
    bool? reducedMotion,
    int? targetFps,
    bool? biometricLockEnabled,
    bool? preferTls,
    bool? enableE2eVault,
    bool? hasCompletedOnboarding,
    int? customScanPort,
    List<String>? terminalHistory,
  }) {
    return AppPreferencesState(
      accent: accent ?? this.accent,
      glassIntensity: glassIntensity ?? this.glassIntensity,
      reducedMotion: reducedMotion ?? this.reducedMotion,
      targetFps: targetFps ?? this.targetFps,
      biometricLockEnabled: biometricLockEnabled ?? this.biometricLockEnabled,
      preferTls: preferTls ?? this.preferTls,
      enableE2eVault: enableE2eVault ?? this.enableE2eVault,
      hasCompletedOnboarding:
          hasCompletedOnboarding ?? this.hasCompletedOnboarding,
      customScanPort: customScanPort ?? this.customScanPort,
      terminalHistory: terminalHistory ?? this.terminalHistory,
    );
  }
}

class AppPreferencesNotifier extends StateNotifier<AppPreferencesState> {
  static const int _maxHistoryEntries = 25;

  AppPreferencesNotifier({Box? boxOverride})
    : _boxOverride = boxOverride,
      super(const AppPreferencesState()) {
    _hydrateFromStorage();
  }

  final Box? _boxOverride;

  Box? get _box {
    if (_boxOverride != null && _boxOverride.isOpen) return _boxOverride;
    if (Hive.isBoxOpen(kAppPrefsBoxName)) return Hive.box(kAppPrefsBoxName);
    return null;
  }

  void _hydrateFromStorage() {
    final box = _box;
    if (box == null) return;

    final accentName = box.get('accent') as String?;
    final accent = CyberAccentPreset.values.firstWhere(
      (e) => e.name == accentName,
      orElse: () => CyberAccentPreset.cyan,
    );

    final glassName = box.get('glassIntensity') as String?;
    final glass = GlassIntensity.values.firstWhere(
      (e) => e.name == glassName,
      orElse: () => GlassIntensity.balanced,
    );

    final fpsRaw = box.get('targetFps') as int? ?? 30;
    final fps = (fpsRaw == 15 || fpsRaw == 30 || fpsRaw == 60) ? fpsRaw : 30;

    final portRaw = box.get('customScanPort') as int? ?? 8765;
    final port = (portRaw >= 1 && portRaw <= 65535) ? portRaw : 8765;

    final historyRaw = box.get('terminalHistory');
    final List<String> history = historyRaw is List
        ? historyRaw
              .whereType<String>()
              .map((s) => s.trim())
              .where((s) => s.isNotEmpty)
              .take(_maxHistoryEntries)
              .toList(growable: false)
        : const [];

    state = AppPreferencesState(
      accent: accent,
      glassIntensity: glass,
      reducedMotion: box.get('reducedMotion') as bool? ?? false,
      targetFps: fps,
      biometricLockEnabled: box.get('biometricLockEnabled') as bool? ?? false,
      preferTls: box.get('preferTls') as bool? ?? false,
      enableE2eVault: box.get('enableE2eVault') as bool? ?? true,
      hasCompletedOnboarding:
          box.get('hasCompletedOnboarding') as bool? ?? false,
      customScanPort: port,
      terminalHistory: history,
    );
  }

  Future<void> _write(String key, Object value) async {
    final box = _box;
    if (box != null) {
      await box.put(key, value);
    }
  }

  Future<void> setAccent(CyberAccentPreset accent) async {
    state = state.copyWith(accent: accent);
    await _write('accent', accent.name);
  }

  Future<void> setGlassIntensity(GlassIntensity intensity) async {
    state = state.copyWith(glassIntensity: intensity);
    await _write('glassIntensity', intensity.name);
  }

  Future<void> setReducedMotion(bool enabled) async {
    state = state.copyWith(reducedMotion: enabled);
    await _write('reducedMotion', enabled);
  }

  Future<void> setTargetFps(int fps) async {
    final safeFps = (fps == 15 || fps == 30 || fps == 60) ? fps : 30;
    state = state.copyWith(targetFps: safeFps);
    await _write('targetFps', safeFps);
  }

  Future<void> setBiometricLockEnabled(bool enabled) async {
    state = state.copyWith(biometricLockEnabled: enabled);
    await _write('biometricLockEnabled', enabled);
  }

  Future<void> setPreferTls(bool enabled) async {
    state = state.copyWith(preferTls: enabled);
    await _write('preferTls', enabled);
  }

  Future<void> setEnableE2eVault(bool enabled) async {
    state = state.copyWith(enableE2eVault: enabled);
    await _write('enableE2eVault', enabled);
  }

  Future<void> setOnboardingCompleted(bool completed) async {
    state = state.copyWith(hasCompletedOnboarding: completed);
    await _write('hasCompletedOnboarding', completed);
  }

  Future<void> setCustomScanPort(int port) async {
    if (port < 1 || port > 65535) return;
    state = state.copyWith(customScanPort: port);
    await _write('customScanPort', port);
  }

  Future<void> pushTerminalCommand(String cmd) async {
    final trimmed = cmd.trim();
    if (trimmed.isEmpty) return;
    final next = <String>[
      trimmed,
      ...state.terminalHistory.where((item) => item != trimmed),
    ].take(_maxHistoryEntries).toList(growable: false);
    state = state.copyWith(terminalHistory: next);
    await _write('terminalHistory', next);
  }

  Future<void> clearTerminalHistory() async {
    state = state.copyWith(terminalHistory: const []);
    await _write('terminalHistory', const <String>[]);
  }

  Future<void> resetDefaults() async {
    const defaults = AppPreferencesState(hasCompletedOnboarding: true);
    state = defaults;
    final box = _box;
    if (box != null) {
      await box.putAll({
        'accent': defaults.accent.name,
        'glassIntensity': defaults.glassIntensity.name,
        'reducedMotion': defaults.reducedMotion,
        'targetFps': defaults.targetFps,
        'biometricLockEnabled': defaults.biometricLockEnabled,
        'preferTls': defaults.preferTls,
        'enableE2eVault': defaults.enableE2eVault,
        'customScanPort': defaults.customScanPort,
      });
    }
  }
}

final appPreferencesProvider =
    StateNotifierProvider<AppPreferencesNotifier, AppPreferencesState>((ref) {
      return AppPreferencesNotifier();
    });

final cyberPaletteProvider = Provider<CyberPalette>((ref) {
  final prefs = ref.watch(appPreferencesProvider);
  return CyberPalette.fromPreset(prefs.accent, glass: prefs.glassIntensity);
});
