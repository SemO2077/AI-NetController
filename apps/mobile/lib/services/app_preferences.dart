import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:hive_flutter/hive_flutter.dart';

import '../theme/fluid_theme.dart';

const String kAppPrefsBoxName = 'app_preferences';
const String kVaultSecretsBoxName = 'vault_secrets';

/// Default remote cursor input mode for live desktop streaming.
enum RemoteInputMode { touchscreen, trackpad }

/// Valid values for [AppPreferencesState.streamQualityPreset].
const List<String> kValidStreamQualityPresets = <String>[
  'auto',
  'low',
  'balanced',
  'crisp',
];

@immutable
class AppPreferencesState {
  final AppThemeMode themeMode;
  final CyberAccentPreset accent;
  final GlassIntensity glassIntensity;
  final bool reducedMotion;
  final int targetFps;
  final bool biometricLockEnabled;
  final bool preferTls;
  final bool enableE2eVault;
  final bool hapticsEnabled;
  final bool keepScreenAwake;
  final bool hasCompletedOnboarding;
  final int customScanPort;
  final List<String> terminalHistory;
  final RemoteInputMode defaultInputMode;
  final bool fullscreenAutoLandscape;
  final bool touchVisualFeedback;
  final String streamQualityPreset;
  final double trackpadSensitivity;

  const AppPreferencesState({
    this.themeMode = AppThemeMode.daylight,
    this.accent = CyberAccentPreset.violet,
    this.glassIntensity = GlassIntensity.balanced,
    this.reducedMotion = false,
    this.targetFps = 30,
    this.biometricLockEnabled = false,
    this.preferTls = false,
    this.enableE2eVault = true,
    this.hapticsEnabled = true,
    this.keepScreenAwake = true,
    this.hasCompletedOnboarding = false,
    this.customScanPort = 8765,
    this.terminalHistory = const [],
    this.defaultInputMode = RemoteInputMode.touchscreen,
    this.fullscreenAutoLandscape = true,
    this.touchVisualFeedback = true,
    this.streamQualityPreset = 'auto',
    this.trackpadSensitivity = 1.6,
  });

  AppPreferencesState copyWith({
    AppThemeMode? themeMode,
    CyberAccentPreset? accent,
    GlassIntensity? glassIntensity,
    bool? reducedMotion,
    int? targetFps,
    bool? biometricLockEnabled,
    bool? preferTls,
    bool? enableE2eVault,
    bool? hapticsEnabled,
    bool? keepScreenAwake,
    bool? hasCompletedOnboarding,
    int? customScanPort,
    List<String>? terminalHistory,
    RemoteInputMode? defaultInputMode,
    bool? fullscreenAutoLandscape,
    bool? touchVisualFeedback,
    String? streamQualityPreset,
    double? trackpadSensitivity,
  }) {
    return AppPreferencesState(
      themeMode: themeMode ?? this.themeMode,
      accent: accent ?? this.accent,
      glassIntensity: glassIntensity ?? this.glassIntensity,
      reducedMotion: reducedMotion ?? this.reducedMotion,
      targetFps: targetFps ?? this.targetFps,
      biometricLockEnabled: biometricLockEnabled ?? this.biometricLockEnabled,
      preferTls: preferTls ?? this.preferTls,
      enableE2eVault: enableE2eVault ?? this.enableE2eVault,
      hapticsEnabled: hapticsEnabled ?? this.hapticsEnabled,
      keepScreenAwake: keepScreenAwake ?? this.keepScreenAwake,
      hasCompletedOnboarding:
          hasCompletedOnboarding ?? this.hasCompletedOnboarding,
      customScanPort: customScanPort ?? this.customScanPort,
      terminalHistory: terminalHistory ?? this.terminalHistory,
      defaultInputMode: defaultInputMode ?? this.defaultInputMode,
      fullscreenAutoLandscape:
          fullscreenAutoLandscape ?? this.fullscreenAutoLandscape,
      touchVisualFeedback: touchVisualFeedback ?? this.touchVisualFeedback,
      streamQualityPreset: streamQualityPreset ?? this.streamQualityPreset,
      trackpadSensitivity: trackpadSensitivity ?? this.trackpadSensitivity,
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

    String? readString(String key) {
      final raw = box.get(key);
      return raw is String ? raw : null;
    }

    bool readBool(String key, bool fallback) {
      final raw = box.get(key);
      return raw is bool ? raw : fallback;
    }

    int readInt(String key, int fallback) {
      final raw = box.get(key);
      return raw is int ? raw : (raw is num ? raw.toInt() : fallback);
    }

    double readDouble(String key, double fallback) {
      final raw = box.get(key);
      if (raw is double) return raw.isFinite ? raw : fallback;
      if (raw is num) {
        final v = raw.toDouble();
        return v.isFinite ? v : fallback;
      }
      return fallback;
    }

    final modeName = readString('themeMode');
    final themeMode = AppThemeMode.values.firstWhere(
      (e) => e.name == modeName,
      orElse: () => AppThemeMode.daylight,
    );

    final accentName = readString('accent');
    final accent = CyberAccentPreset.values.firstWhere(
      (e) => e.name == accentName,
      orElse: () => CyberAccentPreset.violet,
    );

    final glassName = readString('glassIntensity');
    final glass = GlassIntensity.values.firstWhere(
      (e) => e.name == glassName,
      orElse: () => GlassIntensity.balanced,
    );

    final fpsRaw = readInt('targetFps', 30);
    final fps = (fpsRaw == 15 || fpsRaw == 30 || fpsRaw == 60) ? fpsRaw : 30;

    final portRaw = readInt('customScanPort', 8765);
    final port = (portRaw >= 1 && portRaw <= 65535) ? portRaw : 8765;

    final inputModeName = readString('defaultInputMode');
    final defaultInputMode = RemoteInputMode.values.firstWhere(
      (e) => e.name == inputModeName,
      orElse: () => RemoteInputMode.touchscreen,
    );

    final rawPreset = readString('streamQualityPreset')?.trim().toLowerCase();
    final streamQualityPreset =
        (rawPreset != null && kValidStreamQualityPresets.contains(rawPreset))
        ? rawPreset
        : 'auto';

    final sensitivityRaw = readDouble('trackpadSensitivity', 1.6);
    final trackpadSensitivity = sensitivityRaw.clamp(0.6, 3.0);

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
      themeMode: themeMode,
      accent: accent,
      glassIntensity: glass,
      reducedMotion: readBool('reducedMotion', false),
      targetFps: fps,
      biometricLockEnabled: readBool('biometricLockEnabled', false),
      preferTls: readBool('preferTls', false),
      enableE2eVault: readBool('enableE2eVault', true),
      hapticsEnabled: readBool('hapticsEnabled', true),
      keepScreenAwake: readBool('keepScreenAwake', true),
      hasCompletedOnboarding: readBool('hasCompletedOnboarding', false),
      customScanPort: port,
      terminalHistory: history,
      defaultInputMode: defaultInputMode,
      fullscreenAutoLandscape: readBool('fullscreenAutoLandscape', true),
      touchVisualFeedback: readBool('touchVisualFeedback', true),
      streamQualityPreset: streamQualityPreset,
      trackpadSensitivity: trackpadSensitivity,
    );
  }

  Future<void> _write(String key, Object value) async {
    final box = _box;
    if (box != null) {
      await box.put(key, value);
    }
  }

  Future<void> setThemeMode(AppThemeMode mode) async {
    state = state.copyWith(themeMode: mode);
    await _write('themeMode', mode.name);
  }

  Future<void> toggleThemeMode() async {
    final next = state.themeMode == AppThemeMode.daylight
        ? AppThemeMode.dark
        : AppThemeMode.daylight;
    await setThemeMode(next);
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

  Future<void> setHapticsEnabled(bool enabled) async {
    state = state.copyWith(hapticsEnabled: enabled);
    await _write('hapticsEnabled', enabled);
  }

  Future<void> setKeepScreenAwake(bool enabled) async {
    state = state.copyWith(keepScreenAwake: enabled);
    await _write('keepScreenAwake', enabled);
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

  Future<void> setDefaultInputMode(RemoteInputMode mode) async {
    state = state.copyWith(defaultInputMode: mode);
    await _write('defaultInputMode', mode.name);
  }

  Future<void> setFullscreenAutoLandscape(bool enabled) async {
    state = state.copyWith(fullscreenAutoLandscape: enabled);
    await _write('fullscreenAutoLandscape', enabled);
  }

  Future<void> setTouchVisualFeedback(bool enabled) async {
    state = state.copyWith(touchVisualFeedback: enabled);
    await _write('touchVisualFeedback', enabled);
  }

  Future<void> setStreamQualityPreset(String preset) async {
    final normalized = preset.trim().toLowerCase();
    final safePreset = kValidStreamQualityPresets.contains(normalized)
        ? normalized
        : 'auto';
    state = state.copyWith(streamQualityPreset: safePreset);
    await _write('streamQualityPreset', safePreset);
  }

  Future<void> setTrackpadSensitivity(double sensitivity) async {
    final double safeSensitivity =
        sensitivity.isNaN ? 1.6 : sensitivity.clamp(0.6, 3.0);
    state = state.copyWith(trackpadSensitivity: safeSensitivity);
    await _write('trackpadSensitivity', safeSensitivity);
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
        'themeMode': defaults.themeMode.name,
        'accent': defaults.accent.name,
        'glassIntensity': defaults.glassIntensity.name,
        'reducedMotion': defaults.reducedMotion,
        'targetFps': defaults.targetFps,
        'biometricLockEnabled': defaults.biometricLockEnabled,
        'preferTls': defaults.preferTls,
        'enableE2eVault': defaults.enableE2eVault,
        'hapticsEnabled': defaults.hapticsEnabled,
        'keepScreenAwake': defaults.keepScreenAwake,
        'hasCompletedOnboarding': defaults.hasCompletedOnboarding,
        'customScanPort': defaults.customScanPort,
        'terminalHistory': defaults.terminalHistory,
        'defaultInputMode': defaults.defaultInputMode.name,
        'fullscreenAutoLandscape': defaults.fullscreenAutoLandscape,
        'touchVisualFeedback': defaults.touchVisualFeedback,
        'streamQualityPreset': defaults.streamQualityPreset,
        'trackpadSensitivity': defaults.trackpadSensitivity,
      });
    }
  }
}

final appPreferencesProvider =
    StateNotifierProvider<AppPreferencesNotifier, AppPreferencesState>((ref) {
      return AppPreferencesNotifier();
    });

final cyberPaletteProvider = Provider<CyberPalette>((ref) {
  final (accent, glass, themeMode) = ref.watch(
    appPreferencesProvider.select(
      (p) => (p.accent, p.glassIntensity, p.themeMode),
    ),
  );
  return CyberPalette.fromPreset(
    accent,
    glass: glass,
    themeMode: themeMode,
  );
});
