import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:hive_flutter/hive_flutter.dart';

import '../security/network_validators.dart';
import '../theme/fluid_theme.dart';

const String kAppPrefsBoxName = 'app_preferences';
const String kVaultSecretsBoxName = 'vault_secrets';

/// Default remote cursor input mode for live desktop streaming.
enum RemoteInputMode { touchscreen, trackpad }

/// Logical grouping of user preferences for modified indicators & section resets.
enum SettingsSection { streaming, touch, wol, security, network, appearance }

/// Valid values for [AppPreferencesState.streamQualityPreset].
const List<String> kValidStreamQualityPresets = <String>[
  'auto',
  'low',
  'balanced',
  'crisp',
];

/// Valid values for [AppPreferencesState.targetFps].
const List<int> kValidTargetFps = <int>[15, 30, 60];

/// Valid values (in seconds) for [AppPreferencesState.cardSnapshotIntervalSec]
/// (`0` = manual refresh only).
const List<int> kValidCardSnapshotIntervals = <int>[0, 2, 3, 5];

@immutable
class AppPreferencesState {
  final AppThemeMode themeMode;
  final CyberAccentPreset accent;
  final GlassIntensity glassIntensity;
  final bool reducedMotion;
  final int targetFps;
  final int cardSnapshotIntervalSec;
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
  final bool instantTapMode;
  final int longPressDelayMs;
  final double scrollSensitivity;
  final bool naturalScroll;
  final bool pinchZoomEnabled;
  final int wolPort;
  final String wolBroadcastOverride;
  final int wolBurstCount;
  final bool wolSendGratuitousArp;

  const AppPreferencesState({
    this.themeMode = AppThemeMode.daylight,
    this.accent = CyberAccentPreset.violet,
    this.glassIntensity = GlassIntensity.balanced,
    this.reducedMotion = false,
    this.targetFps = 60,
    this.cardSnapshotIntervalSec = 3,
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
    this.instantTapMode = true,
    this.longPressDelayMs = 460,
    this.scrollSensitivity = 1.6,
    this.naturalScroll = false,
    this.pinchZoomEnabled = true,
    this.wolPort = 9,
    this.wolBroadcastOverride = '',
    this.wolBurstCount = 1,
    this.wolSendGratuitousArp = true,
  });

  AppPreferencesState copyWith({
    AppThemeMode? themeMode,
    CyberAccentPreset? accent,
    GlassIntensity? glassIntensity,
    bool? reducedMotion,
    int? targetFps,
    int? cardSnapshotIntervalSec,
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
    bool? instantTapMode,
    int? longPressDelayMs,
    double? scrollSensitivity,
    bool? naturalScroll,
    bool? pinchZoomEnabled,
    int? wolPort,
    String? wolBroadcastOverride,
    int? wolBurstCount,
    bool? wolSendGratuitousArp,
  }) {
    return AppPreferencesState(
      themeMode: themeMode ?? this.themeMode,
      accent: accent ?? this.accent,
      glassIntensity: glassIntensity ?? this.glassIntensity,
      reducedMotion: reducedMotion ?? this.reducedMotion,
      targetFps: targetFps ?? this.targetFps,
      cardSnapshotIntervalSec:
          cardSnapshotIntervalSec ?? this.cardSnapshotIntervalSec,
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
      instantTapMode: instantTapMode ?? this.instantTapMode,
      longPressDelayMs: longPressDelayMs ?? this.longPressDelayMs,
      scrollSensitivity: scrollSensitivity ?? this.scrollSensitivity,
      naturalScroll: naturalScroll ?? this.naturalScroll,
      pinchZoomEnabled: pinchZoomEnabled ?? this.pinchZoomEnabled,
      wolPort: wolPort ?? this.wolPort,
      wolBroadcastOverride: wolBroadcastOverride ?? this.wolBroadcastOverride,
      wolBurstCount: wolBurstCount ?? this.wolBurstCount,
      wolSendGratuitousArp: wolSendGratuitousArp ?? this.wolSendGratuitousArp,
    );
  }

  /// Counts how many settings in [section] differ from default values.
  int modifiedCountFor(SettingsSection section) {
    const d = AppPreferencesState();
    switch (section) {
      case SettingsSection.streaming:
        int count = 0;
        if (targetFps != d.targetFps) count++;
        if (streamQualityPreset != d.streamQualityPreset) count++;
        if (cardSnapshotIntervalSec != d.cardSnapshotIntervalSec) count++;
        if (keepScreenAwake != d.keepScreenAwake) count++;
        if (fullscreenAutoLandscape != d.fullscreenAutoLandscape) count++;
        return count;
      case SettingsSection.touch:
        int count = 0;
        if (defaultInputMode != d.defaultInputMode) count++;
        if (instantTapMode != d.instantTapMode) count++;
        if (longPressDelayMs != d.longPressDelayMs) count++;
        if ((trackpadSensitivity - d.trackpadSensitivity).abs() > 1e-6) count++;
        if ((scrollSensitivity - d.scrollSensitivity).abs() > 1e-6) count++;
        if (naturalScroll != d.naturalScroll) count++;
        if (pinchZoomEnabled != d.pinchZoomEnabled) count++;
        if (touchVisualFeedback != d.touchVisualFeedback) count++;
        if (hapticsEnabled != d.hapticsEnabled) count++;
        return count;
      case SettingsSection.wol:
        int count = 0;
        if (wolPort != d.wolPort) count++;
        if (wolBroadcastOverride != d.wolBroadcastOverride) count++;
        if (wolBurstCount != d.wolBurstCount) count++;
        if (wolSendGratuitousArp != d.wolSendGratuitousArp) count++;
        return count;
      case SettingsSection.security:
        int count = 0;
        if (enableE2eVault != d.enableE2eVault) count++;
        if (preferTls != d.preferTls) count++;
        if (biometricLockEnabled != d.biometricLockEnabled) count++;
        return count;
      case SettingsSection.network:
        return customScanPort != d.customScanPort ? 1 : 0;
      case SettingsSection.appearance:
        int count = 0;
        if (themeMode != d.themeMode) count++;
        if (accent != d.accent) count++;
        if (glassIntensity != d.glassIntensity) count++;
        if (reducedMotion != d.reducedMotion) count++;
        return count;
    }
  }

  /// Returns true if any setting in [section] has been changed from its default.
  bool isModified(SettingsSection section) => modifiedCountFor(section) > 0;

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is AppPreferencesState &&
        other.themeMode == themeMode &&
        other.accent == accent &&
        other.glassIntensity == glassIntensity &&
        other.reducedMotion == reducedMotion &&
        other.targetFps == targetFps &&
        other.cardSnapshotIntervalSec == cardSnapshotIntervalSec &&
        other.biometricLockEnabled == biometricLockEnabled &&
        other.preferTls == preferTls &&
        other.enableE2eVault == enableE2eVault &&
        other.hapticsEnabled == hapticsEnabled &&
        other.keepScreenAwake == keepScreenAwake &&
        other.hasCompletedOnboarding == hasCompletedOnboarding &&
        other.customScanPort == customScanPort &&
        listEquals(other.terminalHistory, terminalHistory) &&
        other.defaultInputMode == defaultInputMode &&
        other.fullscreenAutoLandscape == fullscreenAutoLandscape &&
        other.touchVisualFeedback == touchVisualFeedback &&
        other.streamQualityPreset == streamQualityPreset &&
        other.trackpadSensitivity == trackpadSensitivity &&
        other.instantTapMode == instantTapMode &&
        other.longPressDelayMs == longPressDelayMs &&
        other.scrollSensitivity == scrollSensitivity &&
        other.naturalScroll == naturalScroll &&
        other.pinchZoomEnabled == pinchZoomEnabled &&
        other.wolPort == wolPort &&
        other.wolBroadcastOverride == wolBroadcastOverride &&
        other.wolBurstCount == wolBurstCount &&
        other.wolSendGratuitousArp == wolSendGratuitousArp;
  }

  @override
  int get hashCode => Object.hashAll(<Object?>[
    themeMode,
    accent,
    glassIntensity,
    reducedMotion,
    targetFps,
    cardSnapshotIntervalSec,
    biometricLockEnabled,
    preferTls,
    enableE2eVault,
    hapticsEnabled,
    keepScreenAwake,
    hasCompletedOnboarding,
    customScanPort,
    Object.hashAll(terminalHistory),
    defaultInputMode,
    fullscreenAutoLandscape,
    touchVisualFeedback,
    streamQualityPreset,
    trackpadSensitivity,
    instantTapMode,
    longPressDelayMs,
    scrollSensitivity,
    naturalScroll,
    pinchZoomEnabled,
    wolPort,
    wolBroadcastOverride,
    wolBurstCount,
    wolSendGratuitousArp,
  ]);
}

class AppPreferencesNotifier extends StateNotifier<AppPreferencesState> {
  static const int _maxHistoryEntries = 25;

  static const Set<String> _sanitizedHostKeys = <String>{
    'id',
    'name',
    'ip',
    'wsPort',
    'mac',
    'osName',
    'useTls',
  };

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

    final parsed = _parsePreferences(
      hasKey: box.containsKey,
      readRaw: box.get,
      baseState: const AppPreferencesState(),
      includeRuntimeMeta: true,
    );
    state = parsed;
  }

  AppPreferencesState _parsePreferences({
    required bool Function(String key) hasKey,
    required Object? Function(String key) readRaw,
    required AppPreferencesState baseState,
    required bool includeRuntimeMeta,
  }) {
    const defaults = AppPreferencesState();

    String? readString(String key) {
      final raw = readRaw(key);
      return raw is String ? raw : null;
    }

    bool readBool(String key, bool baseFallback, bool corruptFallback) {
      if (!hasKey(key)) return baseFallback;
      final raw = readRaw(key);
      return raw is bool ? raw : corruptFallback;
    }

    int readInt(String key, int baseFallback, int corruptFallback) {
      if (!hasKey(key)) return baseFallback;
      final raw = readRaw(key);
      if (raw is int) return raw;
      if (raw is num && raw.isFinite) return raw.toInt();
      return corruptFallback;
    }

    double readDouble(String key, double baseFallback, double corruptFallback) {
      if (!hasKey(key)) return baseFallback;
      final raw = readRaw(key);
      if (raw is double) return raw.isFinite ? raw : corruptFallback;
      if (raw is num) {
        final v = raw.toDouble();
        return v.isFinite ? v : corruptFallback;
      }
      return corruptFallback;
    }

    T readEnum<T extends Enum>(
      String key,
      List<T> values,
      T baseFallback,
      T corruptFallback,
    ) {
      if (!hasKey(key)) return baseFallback;
      final name = readString(key);
      return values.firstWhere(
        (e) => e.name == name,
        orElse: () => corruptFallback,
      );
    }

    final themeMode = readEnum(
      'themeMode',
      AppThemeMode.values,
      baseState.themeMode,
      defaults.themeMode,
    );
    final accent = readEnum(
      'accent',
      CyberAccentPreset.values,
      baseState.accent,
      defaults.accent,
    );
    final glass = readEnum(
      'glassIntensity',
      GlassIntensity.values,
      baseState.glassIntensity,
      defaults.glassIntensity,
    );
    final defaultInputMode = readEnum(
      'defaultInputMode',
      RemoteInputMode.values,
      baseState.defaultInputMode,
      defaults.defaultInputMode,
    );

    final fpsRaw = readInt('targetFps', baseState.targetFps, defaults.targetFps);
    final fps = kValidTargetFps.contains(fpsRaw) ? fpsRaw : defaults.targetFps;

    final snapshotIntervalRaw = readInt(
      'cardSnapshotIntervalSec',
      baseState.cardSnapshotIntervalSec,
      defaults.cardSnapshotIntervalSec,
    );
    final cardSnapshotIntervalSec =
        kValidCardSnapshotIntervals.contains(snapshotIntervalRaw)
        ? snapshotIntervalRaw
        : defaults.cardSnapshotIntervalSec;

    final scanPortRaw = readInt(
      'customScanPort',
      baseState.customScanPort,
      defaults.customScanPort,
    );
    final customScanPort = NetworkValidators.isValidPort(scanPortRaw)
        ? scanPortRaw
        : defaults.customScanPort;

    final String streamQualityPreset;
    if (!hasKey('streamQualityPreset')) {
      streamQualityPreset = baseState.streamQualityPreset;
    } else {
      final rawPreset = readString('streamQualityPreset')?.trim().toLowerCase();
      streamQualityPreset =
          (rawPreset != null && kValidStreamQualityPresets.contains(rawPreset))
          ? rawPreset
          : defaults.streamQualityPreset;
    }

    final trackpadSensitivity = readDouble(
      'trackpadSensitivity',
      baseState.trackpadSensitivity,
      defaults.trackpadSensitivity,
    ).clamp(0.6, 3.0).toDouble();

    final longPressDelayMs = readInt(
      'longPressDelayMs',
      baseState.longPressDelayMs,
      defaults.longPressDelayMs,
    ).clamp(250, 700);

    final scrollSensitivity = readDouble(
      'scrollSensitivity',
      baseState.scrollSensitivity,
      defaults.scrollSensitivity,
    ).clamp(0.5, 3.0).toDouble();

    final wolPortRaw = readInt('wolPort', baseState.wolPort, defaults.wolPort);
    final wolPort = NetworkValidators.isValidPort(wolPortRaw)
        ? wolPortRaw
        : defaults.wolPort;

    final String wolBroadcastOverride;
    if (!hasKey('wolBroadcastOverride')) {
      wolBroadcastOverride = baseState.wolBroadcastOverride;
    } else {
      final rawBroadcast = readString('wolBroadcastOverride')?.trim();
      if (rawBroadcast == null || rawBroadcast.isEmpty) {
        wolBroadcastOverride = '';
      } else {
        wolBroadcastOverride = NetworkValidators.isValidIpv4(rawBroadcast)
            ? rawBroadcast
            : defaults.wolBroadcastOverride;
      }
    }

    final wolBurstCount = readInt(
      'wolBurstCount',
      baseState.wolBurstCount,
      defaults.wolBurstCount,
    ).clamp(1, 5);

    List<String> terminalHistory = baseState.terminalHistory;
    bool hasCompletedOnboarding = baseState.hasCompletedOnboarding;
    if (includeRuntimeMeta) {
      hasCompletedOnboarding = readBool(
        'hasCompletedOnboarding',
        baseState.hasCompletedOnboarding,
        defaults.hasCompletedOnboarding,
      );
      final historyRaw = readRaw('terminalHistory');
      terminalHistory = historyRaw is List
          ? historyRaw
                .whereType<String>()
                .map((s) => s.trim())
                .where((s) => s.isNotEmpty)
                .take(_maxHistoryEntries)
                .toList(growable: false)
          : const [];
    }

    return AppPreferencesState(
      themeMode: themeMode,
      accent: accent,
      glassIntensity: glass,
      reducedMotion: readBool(
        'reducedMotion',
        baseState.reducedMotion,
        defaults.reducedMotion,
      ),
      targetFps: fps,
      cardSnapshotIntervalSec: cardSnapshotIntervalSec,
      biometricLockEnabled: readBool(
        'biometricLockEnabled',
        baseState.biometricLockEnabled,
        defaults.biometricLockEnabled,
      ),
      preferTls: readBool(
        'preferTls',
        baseState.preferTls,
        defaults.preferTls,
      ),
      enableE2eVault: readBool(
        'enableE2eVault',
        baseState.enableE2eVault,
        defaults.enableE2eVault,
      ),
      hapticsEnabled: readBool(
        'hapticsEnabled',
        baseState.hapticsEnabled,
        defaults.hapticsEnabled,
      ),
      keepScreenAwake: readBool(
        'keepScreenAwake',
        baseState.keepScreenAwake,
        defaults.keepScreenAwake,
      ),
      hasCompletedOnboarding: hasCompletedOnboarding,
      customScanPort: customScanPort,
      terminalHistory: terminalHistory,
      defaultInputMode: defaultInputMode,
      fullscreenAutoLandscape: readBool(
        'fullscreenAutoLandscape',
        baseState.fullscreenAutoLandscape,
        defaults.fullscreenAutoLandscape,
      ),
      touchVisualFeedback: readBool(
        'touchVisualFeedback',
        baseState.touchVisualFeedback,
        defaults.touchVisualFeedback,
      ),
      streamQualityPreset: streamQualityPreset,
      trackpadSensitivity: trackpadSensitivity,
      instantTapMode: readBool(
        'instantTapMode',
        baseState.instantTapMode,
        defaults.instantTapMode,
      ),
      longPressDelayMs: longPressDelayMs,
      scrollSensitivity: scrollSensitivity,
      naturalScroll: readBool(
        'naturalScroll',
        baseState.naturalScroll,
        defaults.naturalScroll,
      ),
      pinchZoomEnabled: readBool(
        'pinchZoomEnabled',
        baseState.pinchZoomEnabled,
        defaults.pinchZoomEnabled,
      ),
      wolPort: wolPort,
      wolBroadcastOverride: wolBroadcastOverride,
      wolBurstCount: wolBurstCount,
      wolSendGratuitousArp: readBool(
        'wolSendGratuitousArp',
        baseState.wolSendGratuitousArp,
        defaults.wolSendGratuitousArp,
      ),
    );
  }

  Future<void> _write(String key, Object value) async {
    final box = _box;
    if (box != null) {
      await box.put(key, value);
    }
  }

  Map<String, Object?> _preferencesPayloadMap(
    AppPreferencesState source, {
    required bool includeRuntimeMeta,
  }) {
    return <String, Object?>{
      'themeMode': source.themeMode.name,
      'accent': source.accent.name,
      'glassIntensity': source.glassIntensity.name,
      'reducedMotion': source.reducedMotion,
      'targetFps': source.targetFps,
      'cardSnapshotIntervalSec': source.cardSnapshotIntervalSec,
      'biometricLockEnabled': source.biometricLockEnabled,
      'preferTls': source.preferTls,
      'enableE2eVault': source.enableE2eVault,
      'hapticsEnabled': source.hapticsEnabled,
      'keepScreenAwake': source.keepScreenAwake,
      'customScanPort': source.customScanPort,
      'defaultInputMode': source.defaultInputMode.name,
      'fullscreenAutoLandscape': source.fullscreenAutoLandscape,
      'touchVisualFeedback': source.touchVisualFeedback,
      'streamQualityPreset': source.streamQualityPreset,
      'trackpadSensitivity': source.trackpadSensitivity,
      'instantTapMode': source.instantTapMode,
      'longPressDelayMs': source.longPressDelayMs,
      'scrollSensitivity': source.scrollSensitivity,
      'naturalScroll': source.naturalScroll,
      'pinchZoomEnabled': source.pinchZoomEnabled,
      'wolPort': source.wolPort,
      'wolBroadcastOverride': source.wolBroadcastOverride,
      'wolBurstCount': source.wolBurstCount,
      'wolSendGratuitousArp': source.wolSendGratuitousArp,
      if (includeRuntimeMeta) ...<String, Object?>{
        'hasCompletedOnboarding': source.hasCompletedOnboarding,
        'terminalHistory': source.terminalHistory,
      },
    };
  }

  int modifiedCountFor(SettingsSection section) =>
      state.modifiedCountFor(section);

  bool isModified(SettingsSection section) => state.isModified(section);

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
    final safeFps = kValidTargetFps.contains(fps) ? fps : 60;
    state = state.copyWith(targetFps: safeFps);
    await _write('targetFps', safeFps);
  }

  Future<void> setCardSnapshotIntervalSec(int seconds) async {
    final safeSec = kValidCardSnapshotIntervals.contains(seconds) ? seconds : 3;
    state = state.copyWith(cardSnapshotIntervalSec: safeSec);
    await _write('cardSnapshotIntervalSec', safeSec);
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
    if (!NetworkValidators.isValidPort(port)) return;
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
        sensitivity.isNaN ? 1.6 : sensitivity.clamp(0.6, 3.0).toDouble();
    state = state.copyWith(trackpadSensitivity: safeSensitivity);
    await _write('trackpadSensitivity', safeSensitivity);
  }

  Future<void> setInstantTapMode(bool enabled) async {
    state = state.copyWith(instantTapMode: enabled);
    await _write('instantTapMode', enabled);
  }

  Future<void> setLongPressDelayMs(int delayMs) async {
    final safeDelay = delayMs.clamp(250, 700);
    state = state.copyWith(longPressDelayMs: safeDelay);
    await _write('longPressDelayMs', safeDelay);
  }

  Future<void> setScrollSensitivity(double sensitivity) async {
    final double safeSensitivity =
        sensitivity.isNaN ? 1.6 : sensitivity.clamp(0.5, 3.0).toDouble();
    state = state.copyWith(scrollSensitivity: safeSensitivity);
    await _write('scrollSensitivity', safeSensitivity);
  }

  Future<void> setNaturalScroll(bool enabled) async {
    state = state.copyWith(naturalScroll: enabled);
    await _write('naturalScroll', enabled);
  }

  Future<void> setPinchZoomEnabled(bool enabled) async {
    state = state.copyWith(pinchZoomEnabled: enabled);
    await _write('pinchZoomEnabled', enabled);
  }

  Future<void> setWolPort(int port) async {
    if (!NetworkValidators.isValidPort(port)) return;
    state = state.copyWith(wolPort: port);
    await _write('wolPort', port);
  }

  Future<void> setWolBroadcastOverride(String broadcastIp) async {
    final trimmed = broadcastIp.trim();
    if (trimmed.isNotEmpty && !NetworkValidators.isValidIpv4(trimmed)) {
      return;
    }
    state = state.copyWith(wolBroadcastOverride: trimmed);
    await _write('wolBroadcastOverride', trimmed);
  }

  Future<void> setWolBurstCount(int count) async {
    final safeCount = count.clamp(1, 5);
    state = state.copyWith(wolBurstCount: safeCount);
    await _write('wolBurstCount', safeCount);
  }

  Future<void> setWolSendGratuitousArp(bool enabled) async {
    state = state.copyWith(wolSendGratuitousArp: enabled);
    await _write('wolSendGratuitousArp', enabled);
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

  /// Resets only the preferences belonging to [section] back to their defaults
  /// and persists those keys immediately to Hive.
  Future<void> resetSection(SettingsSection section) async {
    const d = AppPreferencesState();
    final Map<String, Object?> updates;

    switch (section) {
      case SettingsSection.streaming:
        state = state.copyWith(
          targetFps: d.targetFps,
          streamQualityPreset: d.streamQualityPreset,
          cardSnapshotIntervalSec: d.cardSnapshotIntervalSec,
          keepScreenAwake: d.keepScreenAwake,
          fullscreenAutoLandscape: d.fullscreenAutoLandscape,
        );
        updates = <String, Object?>{
          'targetFps': d.targetFps,
          'streamQualityPreset': d.streamQualityPreset,
          'cardSnapshotIntervalSec': d.cardSnapshotIntervalSec,
          'keepScreenAwake': d.keepScreenAwake,
          'fullscreenAutoLandscape': d.fullscreenAutoLandscape,
        };
      case SettingsSection.touch:
        state = state.copyWith(
          defaultInputMode: d.defaultInputMode,
          instantTapMode: d.instantTapMode,
          longPressDelayMs: d.longPressDelayMs,
          trackpadSensitivity: d.trackpadSensitivity,
          scrollSensitivity: d.scrollSensitivity,
          naturalScroll: d.naturalScroll,
          pinchZoomEnabled: d.pinchZoomEnabled,
          touchVisualFeedback: d.touchVisualFeedback,
          hapticsEnabled: d.hapticsEnabled,
        );
        updates = <String, Object?>{
          'defaultInputMode': d.defaultInputMode.name,
          'instantTapMode': d.instantTapMode,
          'longPressDelayMs': d.longPressDelayMs,
          'trackpadSensitivity': d.trackpadSensitivity,
          'scrollSensitivity': d.scrollSensitivity,
          'naturalScroll': d.naturalScroll,
          'pinchZoomEnabled': d.pinchZoomEnabled,
          'touchVisualFeedback': d.touchVisualFeedback,
          'hapticsEnabled': d.hapticsEnabled,
        };
      case SettingsSection.wol:
        state = state.copyWith(
          wolPort: d.wolPort,
          wolBroadcastOverride: d.wolBroadcastOverride,
          wolBurstCount: d.wolBurstCount,
          wolSendGratuitousArp: d.wolSendGratuitousArp,
        );
        updates = <String, Object?>{
          'wolPort': d.wolPort,
          'wolBroadcastOverride': d.wolBroadcastOverride,
          'wolBurstCount': d.wolBurstCount,
          'wolSendGratuitousArp': d.wolSendGratuitousArp,
        };
      case SettingsSection.security:
        state = state.copyWith(
          enableE2eVault: d.enableE2eVault,
          preferTls: d.preferTls,
          biometricLockEnabled: d.biometricLockEnabled,
        );
        updates = <String, Object?>{
          'enableE2eVault': d.enableE2eVault,
          'preferTls': d.preferTls,
          'biometricLockEnabled': d.biometricLockEnabled,
        };
      case SettingsSection.network:
        state = state.copyWith(customScanPort: d.customScanPort);
        updates = <String, Object?>{'customScanPort': d.customScanPort};
      case SettingsSection.appearance:
        state = state.copyWith(
          themeMode: d.themeMode,
          accent: d.accent,
          glassIntensity: d.glassIntensity,
          reducedMotion: d.reducedMotion,
        );
        updates = <String, Object?>{
          'themeMode': d.themeMode.name,
          'accent': d.accent.name,
          'glassIntensity': d.glassIntensity.name,
          'reducedMotion': d.reducedMotion,
        };
    }

    final box = _box;
    if (box != null) {
      await box.putAll(updates);
    }
  }

  Future<void> resetDefaults() async {
    const defaults = AppPreferencesState(hasCompletedOnboarding: true);
    state = defaults;
    final box = _box;
    if (box != null) {
      await box.putAll(
        _preferencesPayloadMap(defaults, includeRuntimeMeta: true),
      );
    }
  }

  /// Exports all non-secret preferences and strictly sanitized host records
  /// (never including secrets, pairing tokens, PINs, or cert fingerprints).
  String exportConfigJson({List<Map<String, dynamic>> hosts = const []}) {
    final sanitizedHosts = <Map<String, dynamic>>[];
    for (final rawHost in hosts) {
      final clean = _sanitizeHostMap(rawHost);
      if (clean != null) {
        sanitizedHosts.add(clean);
      }
    }

    final payload = <String, Object?>{
      'version': 1,
      'exportedAt': DateTime.now().toUtc().toIso8601String(),
      'preferences': _preferencesPayloadMap(state, includeRuntimeMeta: false),
      'hosts': sanitizedHosts,
    };
    return const JsonEncoder.withIndent('  ').convert(payload);
  }

  /// Parses, validates, clamps, and persists preferences from a config JSON
  /// backup, returning sanitized non-secret host maps.
  Future<
    ({bool ok, String message, List<Map<String, dynamic>> importedHosts})
  >
  importConfigJson(String rawJson) async {
    final trimmed = rawJson.trim();
    if (trimmed.isEmpty) {
      return (
        ok: false,
        message: 'Configuration JSON is empty.',
        importedHosts: const <Map<String, dynamic>>[],
      );
    }

    final Object? decoded;
    try {
      decoded = jsonDecode(trimmed);
    } on FormatException catch (e) {
      return (
        ok: false,
        message: 'Invalid JSON syntax: ${e.message}',
        importedHosts: const <Map<String, dynamic>>[],
      );
    } catch (e) {
      return (
        ok: false,
        message: 'Failed to parse JSON: $e',
        importedHosts: const <Map<String, dynamic>>[],
      );
    }

    if (decoded is! Map) {
      return (
        ok: false,
        message: 'Configuration root must be a JSON object.',
        importedHosts: const <Map<String, dynamic>>[],
      );
    }

    final versionRaw = decoded['version'];
    if (versionRaw is! num || !versionRaw.isFinite || versionRaw.toInt() != 1) {
      return (
        ok: false,
        message: 'Unsupported or missing config version (expected version 1).',
        importedHosts: const <Map<String, dynamic>>[],
      );
    }

    final prefsRaw = decoded['preferences'];
    if (prefsRaw != null && prefsRaw is! Map) {
      return (
        ok: false,
        message: 'Invalid preferences object in configuration.',
        importedHosts: const <Map<String, dynamic>>[],
      );
    }

    final hostsRaw = decoded['hosts'];
    if (hostsRaw != null && hostsRaw is! List) {
      return (
        ok: false,
        message: 'Invalid hosts list in configuration.',
        importedHosts: const <Map<String, dynamic>>[],
      );
    }

    if (prefsRaw == null && hostsRaw == null) {
      return (
        ok: false,
        message: 'Configuration contains neither preferences nor hosts.',
        importedHosts: const <Map<String, dynamic>>[],
      );
    }

    AppPreferencesState nextState = state;
    if (prefsRaw is Map) {
      final prefsMap = <String, Object?>{
        for (final entry in prefsRaw.entries) entry.key.toString(): entry.value,
      };
      nextState = _parsePreferences(
        hasKey: prefsMap.containsKey,
        readRaw: (key) => prefsMap[key],
        baseState: state,
        includeRuntimeMeta: false,
      );
      state = nextState;
      final box = _box;
      if (box != null) {
        await box.putAll(
          _preferencesPayloadMap(nextState, includeRuntimeMeta: false),
        );
      }
    }

    final importedHosts = <Map<String, dynamic>>[];
    if (hostsRaw is List) {
      for (final item in hostsRaw) {
        if (item is Map) {
          final clean = _sanitizeHostMap(item);
          if (clean != null) {
            importedHosts.add(clean);
          }
        }
      }
    }

    return (
      ok: true,
      message:
          'Imported configuration and ${importedHosts.length} sanitized host(s).',
      importedHosts: List<Map<String, dynamic>>.unmodifiable(importedHosts),
    );
  }

  static Map<String, dynamic>? _sanitizeHostMap(Map<dynamic, dynamic> raw) {
    final ip = (raw['ip'] ?? '').toString().trim();
    if (!NetworkValidators.isValidIpOrHost(ip)) return null;

    final rawId = NetworkValidators.sanitizeLabel(
      (raw['id'] ?? '').toString(),
    );
    final id = rawId.isNotEmpty ? rawId : 'PC-${ip.replaceAll('.', '-')}';

    final rawName = NetworkValidators.sanitizeLabel(
      (raw['name'] ?? '').toString(),
    );
    final name = rawName.isNotEmpty ? rawName : 'PC-$ip';

    final rawPort = raw['wsPort'];
    final int parsedPort = rawPort is int
        ? rawPort
        : (rawPort is num && rawPort.isFinite ? rawPort.toInt() : 8765);
    final wsPort =
        NetworkValidators.isValidPort(parsedPort) ? parsedPort : 8765;

    final mac =
        NetworkValidators.normalizeMac((raw['mac'] ?? '').toString()) ??
        '00:00:00:00:00:00';
    final osName = NetworkValidators.sanitizeLabel(
      (raw['osName'] ?? '').toString(),
    );
    final useTls = raw['useTls'] == true;

    final sanitized = <String, dynamic>{
      'id': id,
      'name': name,
      'ip': ip,
      'wsPort': wsPort,
      'mac': mac,
      'osName': osName,
      'useTls': useTls,
    };
    assert(
      sanitized.keys.every(_sanitizedHostKeys.contains),
      'Host export/import must strictly contain allowlisted non-secret keys.',
    );
    return sanitized;
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
