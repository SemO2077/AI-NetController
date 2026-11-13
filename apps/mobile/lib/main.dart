import 'dart:async';
import 'dart:io';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'security/network_validators.dart';
import 'security/secure_secret_store.dart';
import 'services/app_preferences.dart';
import 'services/host_connection_client.dart';
import 'theme/fluid_theme.dart';
import 'ui/adaptive_layout_builder.dart';
import 'ui/onboarding_sheet.dart';
import 'ui/responsive_device_card.dart';
import 'ui/viewport_stream_widget.dart';

const String _kGhostDevicesBox = 'ghost_devices';
const String _kSavedHostsKey = 'saved_hosts_v1';
const String _kGlobalSecretKey = '__global_pairing_secret__';
const String _kHostSecretPrefix = '__secret_';
const String _kHostCertPrefix = '__cert_';
const Color _kDangerColor = Color(0xFFFF3B5C);

// =====================================================================
// CREDENTIAL & FLEET PERSISTENCE HELPERS
// =====================================================================
Box? _resolveSecretBox() {
  if (Hive.isBoxOpen(kVaultSecretsBoxName)) {
    return Hive.box(kVaultSecretsBoxName);
  }
  if (Hive.isBoxOpen(_kGhostDevicesBox)) {
    return Hive.box(_kGhostDevicesBox);
  }
  return null;
}

void _migrateLegacySecretsIfNeeded() {
  if (!Hive.isBoxOpen(kVaultSecretsBoxName) ||
      !Hive.isBoxOpen(_kGhostDevicesBox)) {
    return;
  }
  final legacyBox = Hive.box(_kGhostDevicesBox);
  final vaultBox = Hive.box(kVaultSecretsBoxName);
  final keysToMigrate = legacyBox.keys
      .where((k) {
        final keyStr = k.toString();
        return keyStr == _kGlobalSecretKey ||
            keyStr.startsWith(_kHostSecretPrefix);
      })
      .toList(growable: false);

  for (final key in keysToMigrate) {
    final val = legacyBox.get(key);
    if (val is String) {
      final trimmed = val.trim();
      if (trimmed.isNotEmpty &&
          trimmed != SecureSecretStore.legacySentinel &&
          !vaultBox.containsKey(key)) {
        if (appSecretStore.hasOpenVault) {
          if (key == _kGlobalSecretKey) {
            unawaited(
              appSecretStore.saveToken(SecureSecretStore.globalHostKey, trimmed),
            );
          } else {
            unawaited(
              appSecretStore.saveToken(
                key.toString().substring(_kHostSecretPrefix.length),
                trimmed,
              ),
            );
          }
        } else {
          vaultBox.put(key, trimmed);
        }
      }
    }
    legacyBox.delete(key);
  }
}

String loadGlobalPairingSecret() {
  _migrateLegacySecretsIfNeeded();
  if (appSecretStore.hasOpenVault) {
    final ksVal = appSecretStore.getToken(SecureSecretStore.globalHostKey);
    if (ksVal != null && ksVal.isNotEmpty) return ksVal;
  }
  final box = _resolveSecretBox();
  if (box == null) return '';
  final val = box.get(_kGlobalSecretKey);
  if (val is String) {
    final trimmed = val.trim();
    if (trimmed.isNotEmpty && trimmed != SecureSecretStore.legacySentinel) {
      return trimmed;
    }
  }
  return '';
}

String loadHostPairingSecret(String ip) {
  _migrateLegacySecretsIfNeeded();
  final cleanIp = ip.trim();
  if (cleanIp.isNotEmpty && appSecretStore.hasOpenVault) {
    final ksVal = appSecretStore.getToken(cleanIp);
    if (ksVal != null && ksVal.isNotEmpty) return ksVal;
  }
  final box = _resolveSecretBox();
  if (box == null) return loadGlobalPairingSecret();
  if (cleanIp.isNotEmpty) {
    final hostSecret = box.get('$_kHostSecretPrefix$cleanIp');
    if (hostSecret is String) {
      final trimmed = hostSecret.trim();
      if (trimmed.isNotEmpty && trimmed != SecureSecretStore.legacySentinel) {
        return trimmed;
      }
    }
  }
  return loadGlobalPairingSecret();
}

String loadHostCertFingerprint(String ip) {
  final cleanIp = ip.trim();
  if (cleanIp.isEmpty) return '';
  final ksFp = appSecretStore.getCertFingerprint(cleanIp);
  if (ksFp != null && ksFp.isNotEmpty) return ksFp;
  final box = _resolveSecretBox();
  final raw = box?.get('$_kHostCertPrefix$cleanIp');
  if (raw is String && raw.trim() != SecureSecretStore.legacySentinel) {
    return raw.trim();
  }
  return '';
}

void saveHostPairingSecret(
  String ip,
  String secret, {
  String? certFingerprint,
}) {
  _migrateLegacySecretsIfNeeded();
  final trimmed = secret.trim();
  final cleanIp = ip.trim();
  final cleanFp = (certFingerprint ?? '').trim().toLowerCase();

  if (appSecretStore.hasOpenVault) {
    if (cleanIp.isNotEmpty) {
      unawaited(appSecretStore.saveToken(cleanIp, trimmed));
      if (cleanFp.isNotEmpty) {
        unawaited(appSecretStore.saveCertFingerprint(cleanIp, cleanFp));
      }
    }
    if (trimmed.isNotEmpty) {
      unawaited(
        appSecretStore.saveToken(SecureSecretStore.globalHostKey, trimmed),
      );
    }
    return;
  }

  final box = _resolveSecretBox();
  if (box == null) return;
  if (cleanIp.isNotEmpty) {
    if (trimmed.isEmpty) {
      box.delete('$_kHostSecretPrefix$cleanIp');
    } else {
      box.put('$_kHostSecretPrefix$cleanIp', trimmed);
    }
    if (cleanFp.isNotEmpty) {
      box.put('$_kHostCertPrefix$cleanIp', cleanFp);
    }
  }
  if (trimmed.isNotEmpty) {
    box.put(_kGlobalSecretKey, trimmed);
  }
}

void deleteHostPairingSecret(String ip) {
  final cleanIp = ip.trim();
  if (cleanIp.isEmpty) return;
  unawaited(appSecretStore.deleteHostSecrets(cleanIp));
  for (final boxName in [kVaultSecretsBoxName, _kGhostDevicesBox]) {
    if (!Hive.isBoxOpen(boxName)) continue;
    final box = Hive.box(boxName);
    box.delete('$_kHostSecretPrefix$cleanIp');
    box.delete('$_kHostCertPrefix$cleanIp');
  }
}

Future<void> purgeAllPairingSecrets() async {
  await appSecretStore.clearAll();
  for (final boxName in [kVaultSecretsBoxName, _kGhostDevicesBox]) {
    if (!Hive.isBoxOpen(boxName)) continue;
    final box = Hive.box(boxName);
    final keys = box.keys
        .where((k) {
          final keyStr = k.toString();
          return keyStr == _kGlobalSecretKey ||
              keyStr.startsWith(_kHostSecretPrefix) ||
              keyStr.startsWith(_kHostCertPrefix);
        })
        .toList(growable: false);
    if (keys.isNotEmpty) {
      await box.deleteAll(keys);
    }
  }
}

final globalPairingSecretProvider =
    StateProvider<String>((ref) => loadGlobalPairingSecret());

// =====================================================================
// STATE MODELS & RIVERPOD STATE MANAGERS
// =====================================================================
class HostState {
  final String id;
  final String name;
  final String ip;
  final int wsPort;
  final String mac;
  final bool isOnline;
  final int cpuUsage;
  final int ramUsage;
  final int diskUsage;
  final int cpuCores;
  final double ramUsedGb;
  final double ramTotalGb;
  final int uptimeSec;
  final bool viewOnlyMode;
  final String osName;
  final String sharedSecret;
  final bool useTls;
  final String certFingerprint;
  final int? latencyMs;

  HostState({
    required this.id,
    required this.name,
    required this.ip,
    this.wsPort = 8765,
    required this.mac,
    required this.isOnline,
    this.cpuUsage = 0,
    this.ramUsage = 0,
    this.diskUsage = 0,
    this.cpuCores = 0,
    this.ramUsedGb = 0.0,
    this.ramTotalGb = 0.0,
    this.uptimeSec = 0,
    this.viewOnlyMode = false,
    this.osName = '',
    this.sharedSecret = '',
    this.useTls = false,
    this.certFingerprint = '',
    this.latencyMs,
  });

  HostState copyWith({
    String? id,
    String? name,
    String? ip,
    int? wsPort,
    String? mac,
    bool? isOnline,
    int? cpuUsage,
    int? ramUsage,
    int? diskUsage,
    int? cpuCores,
    double? ramUsedGb,
    double? ramTotalGb,
    int? uptimeSec,
    bool? viewOnlyMode,
    String? osName,
    String? sharedSecret,
    bool? useTls,
    String? certFingerprint,
    int? latencyMs,
    bool clearLatency = false,
  }) {
    return HostState(
      id: id ?? this.id,
      name: name ?? this.name,
      ip: ip ?? this.ip,
      wsPort: wsPort ?? this.wsPort,
      mac: mac ?? this.mac,
      isOnline: isOnline ?? this.isOnline,
      cpuUsage: cpuUsage ?? this.cpuUsage,
      ramUsage: ramUsage ?? this.ramUsage,
      diskUsage: diskUsage ?? this.diskUsage,
      cpuCores: cpuCores ?? this.cpuCores,
      ramUsedGb: ramUsedGb ?? this.ramUsedGb,
      ramTotalGb: ramTotalGb ?? this.ramTotalGb,
      uptimeSec: uptimeSec ?? this.uptimeSec,
      viewOnlyMode: viewOnlyMode ?? this.viewOnlyMode,
      osName: osName ?? this.osName,
      sharedSecret: sharedSecret ?? this.sharedSecret,
      useTls: useTls ?? this.useTls,
      certFingerprint: certFingerprint ?? this.certFingerprint,
      latencyMs: clearLatency ? null : (latencyMs ?? this.latencyMs),
    );
  }

  Map<String, dynamic> toSavedMap() => <String, dynamic>{
        'id': id,
        'name': name,
        'ip': ip,
        'wsPort': wsPort,
        'mac': mac,
        'osName': osName,
        'useTls': useTls,
      };

  static HostState? fromSavedMap(Map<dynamic, dynamic> raw) {
    final ip = (raw['ip'] ?? '').toString().trim();
    if (!NetworkValidators.isValidIpOrHost(ip)) return null;
    final id = (raw['id'] ?? 'PC-${ip.replaceAll('.', '-')}').toString().trim();
    if (id.isEmpty) return null;
    final nameRaw = (raw['name'] ?? '').toString().trim();
    final name = nameRaw.isNotEmpty
        ? NetworkValidators.sanitizeLabel(nameRaw)
        : 'PC-$ip';
    final portRaw = raw['wsPort'];
    final wsPort =
        portRaw is int && NetworkValidators.isValidPort(portRaw) ? portRaw : 8765;
    final macRaw = (raw['mac'] ?? '').toString().trim();
    final mac = NetworkValidators.normalizeMac(macRaw) ?? '00:00:00:00:00:00';
    final osName = NetworkValidators.sanitizeLabel(
      (raw['osName'] ?? '').toString(),
    );
    final useTls = raw['useTls'] == true;

    // Cold-start hosts begin offline until an active heartbeat confirms reachability.
    return HostState(
      id: id,
      name: name,
      ip: ip,
      wsPort: wsPort,
      mac: mac,
      isOnline: false,
      osName: osName,
      sharedSecret: loadHostPairingSecret(ip),
      useTls: useTls,
      certFingerprint: loadHostCertFingerprint(ip),
    );
  }
}

final fleetProvider =
    StateNotifierProvider<FleetNotifier, List<HostState>>((ref) {
  return FleetNotifier();
});

class FleetNotifier extends StateNotifier<List<HostState>> {
  FleetNotifier({Box? hostBoxOverride})
      : _hostBoxOverride = hostBoxOverride,
        super(const []) {
    _hydrateSavedHosts();
  }

  final Box? _hostBoxOverride;

  Box? get _hostBox {
    if (_hostBoxOverride != null && _hostBoxOverride.isOpen) {
      return _hostBoxOverride;
    }
    if (Hive.isBoxOpen(_kGhostDevicesBox)) {
      return Hive.box(_kGhostDevicesBox);
    }
    return null;
  }

  void _hydrateSavedHosts() {
    final box = _hostBox;
    if (box == null) return;

    final List<HostState> restored = [];
    final Set<String> seenIps = {};
    final rawSaved = box.get(_kSavedHostsKey);

    if (rawSaved is List) {
      for (final item in rawSaved) {
        if (item is Map) {
          final parsed = HostState.fromSavedMap(item);
          if (parsed != null && seenIps.add(parsed.ip)) {
            restored.add(parsed);
          }
        }
      }
    } else {
      // Import legacy device map entries from prior versions if saved_hosts_v1 is absent.
      for (final key in box.keys) {
        if (key.toString().startsWith('__')) continue;
        final val = box.get(key);
        if (val is Map) {
          final parsed = HostState.fromSavedMap(val);
          if (parsed != null && seenIps.add(parsed.ip)) {
            restored.add(parsed);
          }
        }
      }
    }

    if (restored.isNotEmpty) {
      state = restored;
      if (rawSaved is! List) {
        _persistHosts();
      }
    }
  }

  void _persistHosts() {
    final box = _hostBox;
    if (box == null) return;
    final serialized = state.map((h) => h.toSavedMap()).toList(growable: false);
    unawaited(box.put(_kSavedHostsKey, serialized));
  }

  void addHost(HostState host) {
    final cleanIp = host.ip.trim();
    final safeName = NetworkValidators.sanitizeLabel(
      host.name.trim().isNotEmpty ? host.name : 'PC-$cleanIp',
    );
    final safeMac =
        NetworkValidators.normalizeMac(host.mac) ?? '00:00:00:00:00:00';
    final effectiveSecret = host.sharedSecret.trim().isNotEmpty
        ? host.sharedSecret.trim()
        : loadHostPairingSecret(cleanIp);
    final effectiveFp = host.certFingerprint.trim().isNotEmpty
        ? host.certFingerprint.trim().toLowerCase()
        : loadHostCertFingerprint(cleanIp);

    final hydrated = host.copyWith(
      name: safeName,
      ip: cleanIp,
      mac: safeMac,
      sharedSecret: effectiveSecret,
      certFingerprint: effectiveFp,
    );
    if (effectiveSecret.isNotEmpty || effectiveFp.isNotEmpty) {
      saveHostPairingSecret(
        cleanIp,
        effectiveSecret,
        certFingerprint: effectiveFp,
      );
    }

    state = [
      ...state.where((h) => h.id != hydrated.id && h.ip != hydrated.ip),
      hydrated,
    ];
    _persistHosts();
  }

  void editHost(
    String id, {
    required String name,
    required String ip,
    required int wsPort,
    required String mac,
    String? sharedSecret,
    bool? useTls,
    String? certFingerprint,
  }) {
    final index = state.indexWhere((h) => h.id == id);
    if (index < 0) return;
    final existing = state[index];
    final nextIp = ip.trim();
    final nextName = NetworkValidators.sanitizeLabel(
      name.trim().isNotEmpty ? name : 'PC-$nextIp',
    );
    final nextMac =
        NetworkValidators.normalizeMac(mac) ?? '00:00:00:00:00:00';
    final nextTls = useTls ?? existing.useTls;
    String nextFp = (certFingerprint != null && certFingerprint.trim().isNotEmpty)
        ? certFingerprint.trim().toLowerCase()
        : existing.certFingerprint;

    if (existing.ip != nextIp) {
      HostConnectionPool.instance.invalidate(existing.ip);
      if (existing.sharedSecret.isNotEmpty || nextFp.isNotEmpty) {
        deleteHostPairingSecret(existing.ip);
        saveHostPairingSecret(
          nextIp,
          existing.sharedSecret,
          certFingerprint: nextFp,
        );
      }
    }

    String nextSecret = existing.sharedSecret;
    if (sharedSecret != null && sharedSecret.trim().isNotEmpty) {
      nextSecret = sharedSecret.trim();
      saveHostPairingSecret(nextIp, nextSecret, certFingerprint: nextFp);
    } else {
      nextSecret = loadHostPairingSecret(nextIp);
      if (nextFp.isEmpty) {
        nextFp = loadHostCertFingerprint(nextIp);
      }
    }
    HostConnectionPool.instance.invalidate(nextIp);

    final updated = existing.copyWith(
      name: nextName,
      ip: nextIp,
      wsPort: wsPort,
      mac: nextMac,
      sharedSecret: nextSecret,
      useTls: nextTls,
      certFingerprint: nextFp,
    );

    final nextList = [...state];
    nextList[index] = updated;
    state = nextList;
    _persistHosts();
  }

  void removeHost(String id, {bool purgeSecret = true}) {
    final target = state.where((h) => h.id == id).toList(growable: false);
    if (target.isEmpty) return;
    HostConnectionPool.instance.invalidate(target.first.ip);
    if (purgeSecret) {
      deleteHostPairingSecret(target.first.ip);
    }
    final box = _hostBox;
    if (box != null && box.containsKey(id)) {
      unawaited(box.delete(id));
    }
    state = state.where((h) => h.id != id).toList(growable: false);
    _persistHosts();
  }

  void clearAllHostSecrets() {
    HostConnectionPool.instance.disposeAll();
    state = [
      for (final h in state)
        h.copyWith(sharedSecret: '', certFingerprint: ''),
    ];
  }

  void updateHost(
    String id, {
    bool? isOnline,
    int? cpu,
    int? ram,
    int? latencyMs,
    bool clearLatency = false,
  }) {
    state = [
      for (final h in state)
        if (h.id == id)
          h.copyWith(
            isOnline: isOnline,
            cpuUsage: cpu,
            ramUsage: ram,
            latencyMs: latencyMs,
            clearLatency: clearLatency,
          )
        else
          h,
    ];
  }

  void updateLatencyByIp(String ip, int? latencyMs, {bool? isOnline}) {
    state = [
      for (final h in state)
        if (h.ip == ip)
          h.copyWith(
            latencyMs: latencyMs,
            clearLatency: latencyMs == null,
            isOnline: isOnline ?? (latencyMs != null),
          )
        else
          h,
    ];
  }

  void setHostSecret(String ip, String secret, {String? certFingerprint}) {
    saveHostPairingSecret(ip, secret, certFingerprint: certFingerprint);
    HostConnectionPool.instance.invalidate(ip);
    state = [
      for (final h in state)
        if (h.ip == ip)
          h.copyWith(
            sharedSecret: secret.trim(),
            certFingerprint: (certFingerprint != null &&
                    certFingerprint.trim().isNotEmpty)
                ? certFingerprint.trim().toLowerCase()
                : h.certFingerprint,
          )
        else
          h,
    ];
  }

  void updateTelemetryByIp(String ip, Map<String, dynamic> data) {
    final cpuRaw = data['cpu_percent'];
    final ramRaw = data['ram_percent'];
    final diskRaw = data['disk_percent'];
    final coresRaw = data['cpu_cores'];
    final ramUsedRaw = data['ram_used_gb'];
    final ramTotalRaw = data['ram_total_gb'];
    final uptimeRaw = data['uptime_sec'];
    final viewOnlyRaw = data['view_only_mode'];
    final osRaw = data['os'];

    final cpuVal = cpuRaw is num ? cpuRaw.round().clamp(0, 100) : null;
    final ramVal = ramRaw is num ? ramRaw.round().clamp(0, 100) : null;
    final diskVal = diskRaw is num ? diskRaw.round().clamp(0, 100) : null;
    final coresVal = coresRaw is num ? coresRaw.toInt() : null;
    final ramUsedVal = ramUsedRaw is num ? ramUsedRaw.toDouble() : null;
    final ramTotalVal = ramTotalRaw is num ? ramTotalRaw.toDouble() : null;
    final uptimeVal = uptimeRaw is num ? uptimeRaw.toInt() : null;
    final viewOnlyVal = viewOnlyRaw is bool ? viewOnlyRaw : null;
    final osVal =
        osRaw is String && osRaw.trim().isNotEmpty ? osRaw.trim() : null;

    final hostnameRaw = data['hostname'];
    final hostname = hostnameRaw is String
        ? NetworkValidators.sanitizeLabel(hostnameRaw)
        : '';
    final macRaw = data['mac'];
    final reportedMac = macRaw is String
        ? (NetworkValidators.normalizeMac(macRaw) ?? '')
        : '';

    bool persistentMetadataChanged = false;
    state = [
      for (final h in state)
        if (h.ip == ip)
          (() {
            final placeholderName = h.name.startsWith('Host PC') ||
                h.name.startsWith('PC-') ||
                h.name == h.id;
            final nextName =
                (placeholderName && hostname.isNotEmpty) ? hostname : h.name;
            final nextMac =
                (reportedMac.isNotEmpty && h.mac == '00:00:00:00:00:00')
                    ? reportedMac
                    : h.mac;
            if (nextName != h.name ||
                nextMac != h.mac ||
                (osVal != null && osVal != h.osName)) {
              persistentMetadataChanged = true;
            }
            return h.copyWith(
              name: nextName,
              mac: nextMac,
              isOnline: true,
              cpuUsage: cpuVal,
              ramUsage: ramVal,
              diskUsage: diskVal,
              cpuCores: coresVal,
              ramUsedGb: ramUsedVal,
              ramTotalGb: ramTotalVal,
              uptimeSec: uptimeVal,
              viewOnlyMode: viewOnlyVal,
              osName: osVal,
            );
          })()
        else
          h,
    ];

    if (persistentMetadataChanged) {
      _persistHosts();
    }
  }
}

final selectedHostIdProvider = StateProvider<String>((ref) => '');

class CommandLogItem {
  final String timestamp;
  final String hostName;
  final String command;
  final String status;
  final bool isError;

  CommandLogItem({
    required this.timestamp,
    required this.hostName,
    required this.command,
    required this.status,
    this.isError = false,
  });
}

// =====================================================================
// ROOT APPLICATION ENTRY WITH PERSISTENCE & CLAMPED ACCESSIBILITY SCALER
// =====================================================================
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Hive.initFlutter();
  await Future.wait([
    Hive.openBox(_kGhostDevicesBox),
    Hive.openBox(kAppPrefsBoxName),
    Hive.openBox(kVaultSecretsBoxName),
  ]);
  await appSecretStore.init();
  await appSecretStore.migrateLegacyPairingKeys(Hive.box(_kGhostDevicesBox));
  await appSecretStore.migrateLegacyPairingKeys(Hive.box(kVaultSecretsBoxName));
  _migrateLegacySecretsIfNeeded();

  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('CENTRALIZED ERROR CAUGHT: $error');
    return true;
  };

  runApp(const ProviderScope(child: AINetControllerApp()));
}

class AINetControllerApp extends ConsumerWidget {
  const AINetControllerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = ref.watch(appPreferencesProvider);
    final palette = ref.watch(cyberPaletteProvider);

    return MaterialApp(
      title: 'AI NetController',
      debugShowCheckedModeBanner: false,
      theme: CyberTheme.fromPalette(palette),
      builder: (context, child) {
        final mq = MediaQuery.of(context);
        return MediaQuery(
          data: mq.copyWith(
            textScaler: FluidSize.clampedTextScaler(context),
            disableAnimations: prefs.reducedMotion || mq.disableAnimations,
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
      home: const MainAdaptiveScreen(),
    );
  }
}

// =====================================================================
// MAIN ADAPTIVE APP SCREEN
// =====================================================================
class MainAdaptiveScreen extends ConsumerStatefulWidget {
  const MainAdaptiveScreen({super.key});

  @override
  ConsumerState<MainAdaptiveScreen> createState() => _MainAdaptiveScreenState();
}

class _MainAdaptiveScreenState extends ConsumerState<MainAdaptiveScreen> {
  int _currentTabIndex = 0;
  final TextEditingController _commandController = TextEditingController();
  final TextEditingController _fleetSearchController = TextEditingController();
  final List<CommandLogItem> _commandLogs = [];
  String _fleetSearchQuery = '';
  bool _isScanning = false;
  bool _isPinging = false;

  @override
  void dispose() {
    HostConnectionPool.instance.disposeAll();
    _commandController.dispose();
    _fleetSearchController.dispose();
    super.dispose();
  }

  void _hapticTap() {
    unawaited(HapticFeedback.selectionClick().catchError((_) {}));
  }

  void _showToast(
    String message, {
    Color? accentColor,
    Duration duration = const Duration(seconds: 2),
  }) {
    if (!mounted) return;
    final primary = Theme.of(context).colorScheme.primary;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          backgroundColor: CyberColors.surfaceElevated,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: BorderSide(
              color: (accentColor ?? primary).withValues(alpha: 0.35),
            ),
          ),
          content: Text(
            message,
            style: TextStyle(
              color: accentColor ?? primary,
              fontFamily: 'monospace',
              fontSize: 12,
            ),
          ),
          duration: duration,
        ),
      );
  }

  String _resolveSecretForHost(HostState host) {
    if (host.sharedSecret.trim().isNotEmpty) return host.sharedSecret.trim();
    final hostSecret = loadHostPairingSecret(host.ip);
    if (hostSecret.isNotEmpty) return hostSecret;
    return ref.read(globalPairingSecretProvider).trim();
  }

  Future<void> _sendWakeOnLan(
    String mac, {
    String? targetIp,
    bool silent = false,
  }) async {
    final macBytes = NetworkValidators.parseMacBytes(mac);
    final normalizedMac = NetworkValidators.normalizeMac(mac);
    if (macBytes == null || normalizedMac == null) {
      if (!silent) {
        _showToast(
          'Cannot send Wake-on-LAN: set a valid non-zero MAC address on this workstation.',
          accentColor: CyberColors.warning,
          duration: const Duration(seconds: 3),
        );
      }
      return;
    }

    try {
      _hapticTap();
      final packet = Uint8List(6 + 16 * 6);
      packet.fillRange(0, 6, 0xFF);
      for (int i = 0; i < 16; i++) {
        packet.setRange(6 + i * 6, 6 + (i + 1) * 6, macBytes);
      }

      final targets = <String>{'255.255.255.255'};
      if (targetIp != null && targetIp.trim().isNotEmpty) {
        targets.add(NetworkValidators.deriveBroadcastIp(targetIp));
      }

      final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      try {
        socket.broadcastEnabled = true;
        for (final broadcastAddr in targets) {
          socket.send(packet, InternetAddress(broadcastAddr), 9);
        }
      } finally {
        socket.close();
      }

      if (!silent) {
        _showToast(
          'WoL Magic Packet dispatched to $normalizedMac (${targets.join(', ')})',
          accentColor: CyberColors.warning,
        );
      }
    } catch (e) {
      debugPrint('WoL Socket Error: $e');
      if (!silent) {
        _showToast(
          'Wake-on-LAN dispatch failed: $e',
          accentColor: _kDangerColor,
        );
      }
    }
  }

  Future<void> _wakeAllOfflineHosts(List<HostState> hosts) async {
    final targets = hosts
        .where(
          (h) => !h.isOnline && NetworkValidators.normalizeMac(h.mac) != null,
        )
        .toList(growable: false);
    if (targets.isEmpty) {
      _showToast(
        'No offline workstations have a valid MAC address for Wake-on-LAN.',
        accentColor: CyberColors.warning,
      );
      return;
    }

    for (final host in targets) {
      await _sendWakeOnLan(host.mac, targetIp: host.ip, silent: true);
    }
    _showToast(
      'Sent Wake-on-LAN packets to ${targets.length} sleeping workstation(s).',
      accentColor: CyberColors.warning,
    );
  }

  Future<int?> _measureTcpLatency(String ip, int port) async {
    final stopwatch = Stopwatch()..start();
    Socket? socket;
    try {
      socket = await Socket.connect(
        ip,
        port,
        timeout: const Duration(milliseconds: 450),
      );
      stopwatch.stop();
      return stopwatch.elapsedMilliseconds;
    } catch (_) {
      return null;
    } finally {
      socket?.destroy();
    }
  }

  Future<void> _pingHost(HostState host) async {
    _hapticTap();
    final ms = await _measureTcpLatency(host.ip, host.wsPort);
    if (!mounted) return;
    ref.read(fleetProvider.notifier).updateLatencyByIp(
          host.ip,
          ms,
          isOnline: ms != null,
        );
    _showToast(
      ms != null
          ? '${host.name} (${host.ip}:${host.wsPort}) reachable in ${ms}ms'
          : '${host.name} (${host.ip}:${host.wsPort}) did not respond',
      accentColor: ms != null ? CyberColors.success : CyberColors.warning,
    );
  }

  Future<void> _pingAllHosts() async {
    final hosts = ref.read(fleetProvider);
    if (hosts.isEmpty || _isPinging) return;
    setState(() => _isPinging = true);
    int onlineCount = 0;
    try {
      await Future.wait(
        hosts.map((host) async {
          final ms = await _measureTcpLatency(host.ip, host.wsPort);
          if (!mounted) return;
          if (ms != null) onlineCount++;
          ref.read(fleetProvider.notifier).updateLatencyByIp(
                host.ip,
                ms,
                isOnline: ms != null,
              );
        }),
      );
      _showToast(
        'Health check complete: $onlineCount / ${hosts.length} online',
        accentColor:
            onlineCount > 0 ? CyberColors.success : CyberColors.warning,
      );
    } finally {
      if (mounted) {
        setState(() => _isPinging = false);
      }
    }
  }

  Future<void> _scanForPcs() async {
    if (_isScanning) return;
    final scanPort = ref.read(appPreferencesProvider).customScanPort;
    setState(() => _isScanning = true);
    _hapticTap();
    _showToast(
      'Scanning local subnet on port $scanPort for active workstations...',
    );

    final List<HostState> foundPcs = [];

    try {
      final Set<String> candidateIps = {
        '127.0.0.1',
        '10.0.2.2',
      };

      try {
        final interfaces = await NetworkInterface.list(
          type: InternetAddressType.IPv4,
          includeLoopback: false,
        );
        for (final iface in interfaces) {
          for (final addr in iface.addresses) {
            final parts = addr.address.split('.');
            if (parts.length == 4) {
              final prefix = '${parts[0]}.${parts[1]}.${parts[2]}';
              for (int octet = 1; octet <= 254; octet++) {
                candidateIps.add('$prefix.$octet');
              }
              candidateIps.add(addr.address);
            }
          }
        }
      } catch (e) {
        debugPrint('Interface list notice: $e');
      }

      final ipList = candidateIps.toList(growable: false);
      const chunkSize = 40;
      for (int i = 0; i < ipList.length; i += chunkSize) {
        if (!mounted) return;
        final end =
            (i + chunkSize > ipList.length) ? ipList.length : i + chunkSize;
        final chunk = ipList.sublist(i, end);
        await Future.wait(
          chunk.map((ip) async {
            bool found = false;
            bool detectedTls = false;
            final sw = Stopwatch()..start();
            try {
              if (await HostConnectionClient.probeHostAgent(
                ip,
                port: scanPort,
                timeout: const Duration(milliseconds: 500),
              )) {
                found = true;
              } else if (await HostConnectionClient.probeHostAgent(
                ip,
                port: scanPort,
                useTls: true,
                timeout: const Duration(milliseconds: 550),
              )) {
                found = true;
                detectedTls = true;
              }
            } catch (_) {
              // Unreachable or not an active AI NetController host PC
            }
            sw.stop();
            if (!found) return;

            final hostName = (ip == '127.0.0.1' || ip == '10.0.2.2')
                ? 'Host PC (Local)'
                : 'Host PC ($ip)';
            final hostId = 'PC-${ip.replaceAll('.', '-')}';

            foundPcs.add(
              HostState(
                id: hostId,
                name: hostName,
                ip: ip,
                wsPort: scanPort,
                mac: '00:00:00:00:00:00',
                isOnline: true,
                useTls: detectedTls,
                certFingerprint: loadHostCertFingerprint(ip),
                latencyMs: sw.elapsedMilliseconds.clamp(1, 9999),
              ),
            );
          }),
        );
      }

      if (!mounted) return;
      if (foundPcs.isNotEmpty) {
        final existingByIp = {
          for (final h in ref.read(fleetProvider)) h.ip: h,
        };
        for (final pc in foundPcs) {
          final existing = existingByIp[pc.ip];
          if (existing != null) {
            ref.read(fleetProvider.notifier).updateLatencyByIp(
                  pc.ip,
                  pc.latencyMs,
                  isOnline: true,
                );
          } else {
            ref.read(fleetProvider.notifier).addHost(pc);
          }
        }
        final currentSelected = ref.read(selectedHostIdProvider);
        if (currentSelected.isEmpty) {
          ref.read(selectedHostIdProvider.notifier).state = foundPcs.first.id;
        }
        _showToast(
          'Discovered ${foundPcs.length} active host(s) on port $scanPort.',
          accentColor: CyberColors.success,
          duration: const Duration(seconds: 3),
        );
      } else {
        _showToast(
          'No active PCs found on port $scanPort. Verify the PC agent is running.',
          accentColor: CyberColors.warning,
          duration: const Duration(seconds: 4),
        );
      }
    } catch (err) {
      debugPrint('Scan error: $err');
    } finally {
      if (mounted) {
        setState(() => _isScanning = false);
      }
    }
  }

  void _openStreamScreen(HostState host) {
    final prefs = ref.read(appPreferencesProvider);
    final effectiveSecret = _resolveSecretForHost(host);
    final effectiveFp = host.certFingerprint.trim().isNotEmpty
        ? host.certFingerprint.trim()
        : loadHostCertFingerprint(host.ip);
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => FullscreenStreamPage(
          host: host,
          sharedSecret: effectiveSecret,
          useTls: host.useTls || prefs.preferTls,
          certFingerprint: effectiveFp.isNotEmpty ? effectiveFp : null,
          onTelemetry: (data) => ref
              .read(fleetProvider.notifier)
              .updateTelemetryByIp(host.ip, data),
        ),
      ),
    );
  }

  Future<PairingResult?> _pairWithHostPin(
    String ip,
    String pin, {
    int port = 8765,
    bool? useTls,
    String? certFingerprint,
  }) async {
    return HostConnectionClient.pairWithHostPin(
      ip: ip,
      pin: pin,
      port: port,
      useTls: useTls ?? ref.read(appPreferencesProvider).preferTls,
      expectedCertFingerprint: certFingerprint,
    );
  }

  Future<void> _showHostEditorDialog({HostState? existing}) async {
    final defaultPort =
        existing?.wsPort ?? ref.read(appPreferencesProvider).customScanPort;
    final nameCtrl = TextEditingController(text: existing?.name ?? '');
    final ipCtrl = TextEditingController(text: existing?.ip ?? '');
    final portCtrl = TextEditingController(text: defaultPort.toString());
    final macCtrl = TextEditingController(
      text: (existing != null && existing.mac != '00:00:00:00:00:00')
          ? existing.mac
          : '',
    );
    final secretCtrl = TextEditingController(
      text: existing != null
          ? existing.sharedSecret
          : ref.read(globalPairingSecretProvider),
    );
    String? validationError;
    bool isSaving = false;
    bool useTls = existing?.useTls ?? ref.read(appPreferencesProvider).preferTls;

    await showDialog<void>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            final primary = Theme.of(ctx).colorScheme.primary;
            return AlertDialog(
              backgroundColor: CyberColors.surfaceElevated,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
              ),
              title: Text(
                existing == null ? 'Add Workstation' : 'Edit Workstation',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextField(
                      controller: nameCtrl,
                      style: const TextStyle(color: Colors.white, fontSize: 13),
                      decoration: const InputDecoration(
                        labelText: 'Hostname',
                        hintText: 'e.g. WORKSTATION-01',
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          flex: 3,
                          child: TextField(
                            controller: ipCtrl,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 13,
                              fontFamily: 'monospace',
                            ),
                            decoration: const InputDecoration(
                              labelText: 'IPv4 or Host',
                              hintText: '192.168.1.50',
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          flex: 2,
                          child: TextField(
                            controller: portCtrl,
                            keyboardType: TextInputType.number,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 13,
                              fontFamily: 'monospace',
                            ),
                            decoration: const InputDecoration(
                              labelText: 'Port',
                              hintText: '8765',
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: macCtrl,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontFamily: 'monospace',
                      ),
                      decoration: const InputDecoration(
                        labelText: 'MAC Address (Optional for WoL)',
                        hintText: 'AA:BB:CC:DD:EE:FF',
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: secretCtrl,
                      obscureText: true,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontFamily: 'monospace',
                      ),
                      decoration: const InputDecoration(
                        labelText: '6-Digit PIN or Pairing Token',
                        hintText: 'e.g. 482910 or ainet_...',
                      ),
                    ),
                    const SizedBox(height: 6),
                    SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      activeThumbColor: primary,
                      activeTrackColor: primary.withValues(alpha: 0.45),
                      title: const Text(
                        'Require WSS TLS',
                        style: TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                      value: useTls,
                      onChanged: isSaving
                          ? null
                          : (v) => setDialogState(() => useTls = v),
                    ),
                    if (validationError != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        validationError!,
                        style: const TextStyle(
                          color: _kDangerColor,
                          fontSize: 11.5,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: isSaving ? null : () => Navigator.of(ctx).pop(),
                  child: const Text(
                    'Cancel',
                    style: TextStyle(color: CyberColors.textSecondary),
                  ),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: primary,
                    foregroundColor: Colors.black,
                  ),
                  onPressed: isSaving
                      ? null
                      : () async {
                          final ip = ipCtrl.text.trim();
                          final parsedPort = int.tryParse(portCtrl.text.trim());
                          final rawMac = macCtrl.text.trim();

                          if (!NetworkValidators.isValidIpOrHost(ip)) {
                            setDialogState(() {
                              validationError =
                                  'Enter a valid IPv4 address or LAN hostname.';
                            });
                            return;
                          }
                          if (!NetworkValidators.isValidPort(parsedPort)) {
                            setDialogState(() {
                              validationError =
                                  'Port must be between 1 and 65535.';
                            });
                            return;
                          }

                          String normalizedMac = '00:00:00:00:00:00';
                          if (rawMac.isNotEmpty) {
                            final maybeMac =
                                NetworkValidators.normalizeMac(rawMac);
                            if (maybeMac == null) {
                              setDialogState(() {
                                validationError =
                                    'MAC must be 12 hex characters (AA:BB:CC:DD:EE:FF).';
                              });
                              return;
                            }
                            normalizedMac = maybeMac;
                          }

                          setDialogState(() {
                            validationError = null;
                            isSaving = true;
                          });

                          final name = nameCtrl.text.trim().isNotEmpty
                              ? NetworkValidators.sanitizeLabel(nameCtrl.text)
                              : 'PC-$ip';

                          String secret = secretCtrl.text.trim();
                          String certFp =
                              existing?.certFingerprint.trim().isNotEmpty == true
                                  ? existing!.certFingerprint.trim()
                                  : loadHostCertFingerprint(ip);
                          bool pinFailed = false;
                          if (RegExp(r'^\d{6}$').hasMatch(secret)) {
                            final exchanged = await _pairWithHostPin(
                              ip,
                              secret,
                              port: parsedPort!,
                              useTls: useTls,
                              certFingerprint: certFp.isNotEmpty ? certFp : null,
                            );
                            if (exchanged != null &&
                                exchanged.pairingToken.isNotEmpty) {
                              secret = exchanged.pairingToken;
                              if (exchanged.certFingerprint != null &&
                                  exchanged.certFingerprint!.isNotEmpty) {
                                certFp = exchanged.certFingerprint!;
                              }
                            } else {
                              secret = existing?.sharedSecret ?? '';
                              pinFailed = true;
                            }
                          }

                          if (secret.isNotEmpty || certFp.isNotEmpty) {
                            saveHostPairingSecret(
                              ip,
                              secret,
                              certFingerprint: certFp,
                            );
                            if (secret.isNotEmpty) {
                              ref
                                  .read(globalPairingSecretProvider.notifier)
                                  .state = secret;
                            }
                          }

                          if (existing != null) {
                            ref.read(fleetProvider.notifier).editHost(
                                  existing.id,
                                  name: name,
                                  ip: ip,
                                  wsPort: parsedPort!,
                                  mac: normalizedMac,
                                  sharedSecret: secret,
                                  useTls: useTls,
                                  certFingerprint: certFp,
                                );
                          } else {
                            final id = name
                                .toUpperCase()
                                .replaceAll(RegExp(r'[^A-Z0-9_-]'), '-');
                            final host = HostState(
                              id: id.isEmpty ? 'PC-${ip.replaceAll('.', '-')}' : id,
                              name: name,
                              ip: ip,
                              wsPort: parsedPort!,
                              mac: normalizedMac,
                              isOnline: true,
                              sharedSecret: secret,
                              useTls: useTls,
                              certFingerprint: certFp,
                            );
                            ref.read(fleetProvider.notifier).addHost(host);
                            ref.read(selectedHostIdProvider.notifier).state =
                                host.id;
                          }

                          if (ctx.mounted) {
                            Navigator.of(ctx).pop();
                          }
                          if (pinFailed) {
                            _showToast(
                              'PIN pairing failed — workstation saved without token. Open Settings to pair.',
                              accentColor: CyberColors.warning,
                              duration: const Duration(seconds: 3),
                            );
                          }
                        },
                  child: Text(
                    isSaving
                        ? 'Pairing...'
                        : (existing == null ? 'Save PC' : 'Update PC'),
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            );
          },
        );
      },
    ).whenComplete(() {
      Future<void>.delayed(const Duration(milliseconds: 300), () {
        nameCtrl.dispose();
        ipCtrl.dispose();
        portCtrl.dispose();
        macCtrl.dispose();
        secretCtrl.dispose();
      });
    });
  }

  Future<void> _showHostActionsSheet(HostState host) async {
    _hapticTap();
    final primary = Theme.of(context).colorScheme.primary;
    final hasValidMac = NetworkValidators.normalizeMac(host.mac) != null;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: CyberColors.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Icon(
                      host.isOnline
                          ? Icons.computer_rounded
                          : Icons.power_settings_new_rounded,
                      color:
                          host.isOnline ? CyberColors.success : primary,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            host.name,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                            ),
                          ),
                          Text(
                            '${host.ip}:${host.wsPort}${host.latencyMs != null ? ' • ${host.latencyMs}ms' : ''}',
                            style: const TextStyle(
                              color: CyberColors.textSecondary,
                              fontFamily: 'monospace',
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const Divider(height: 20, color: Colors.white12),
                ListTile(
                  leading: Icon(Icons.cast_connected_rounded, color: primary),
                  title: const Text('Open Live Stream'),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    ref.read(selectedHostIdProvider.notifier).state = host.id;
                    _openStreamScreen(host);
                  },
                ),
                ListTile(
                  leading: Icon(Icons.terminal_rounded, color: primary),
                  title: const Text('Open Terminal Session'),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    ref.read(selectedHostIdProvider.notifier).state = host.id;
                    setState(() => _currentTabIndex = 1);
                  },
                ),
                ListTile(
                  leading: const Icon(
                    Icons.network_ping_rounded,
                    color: CyberColors.success,
                  ),
                  title: const Text('Measure Latency (Ping)'),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    _pingHost(host);
                  },
                ),
                ListTile(
                  leading: Icon(
                    Icons.bolt_rounded,
                    color: hasValidMac
                        ? CyberColors.warning
                        : CyberColors.textTertiary,
                  ),
                  title: const Text('Send Wake-on-LAN Packet'),
                  subtitle: hasValidMac
                      ? Text(host.mac, style: const TextStyle(fontSize: 11))
                      : const Text(
                          'Set a MAC address via Edit first',
                          style: TextStyle(fontSize: 11),
                        ),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    _sendWakeOnLan(host.mac, targetIp: host.ip);
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.copy_rounded, color: Colors.white70),
                  title: const Text('Copy IP Address'),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    Clipboard.setData(ClipboardData(text: host.ip));
                    _showToast('Copied ${host.ip} to clipboard');
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.edit_rounded, color: Colors.white70),
                  title: const Text('Edit Workstation'),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    _showHostEditorDialog(existing: host);
                  },
                ),
                ListTile(
                  leading: const Icon(
                    Icons.delete_outline_rounded,
                    color: _kDangerColor,
                  ),
                  title: const Text(
                    'Remove Workstation',
                    style: TextStyle(color: _kDangerColor),
                  ),
                  onTap: () {
                    Navigator.of(ctx).pop();
                    _confirmRemoveHost(host);
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _confirmRemoveHost(HostState host) async {
    final confirmed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: CyberColors.surfaceElevated,
            title: const Text('Remove Workstation?'),
            content: Text(
              'Remove ${host.name} (${host.ip}) and purge its saved pairing token from this device?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _kDangerColor,
                  foregroundColor: Colors.white,
                ),
                onPressed: () => Navigator.of(ctx).pop(true),
                child: const Text('Remove'),
              ),
            ],
          ),
        ) ??
        false;

    if (!confirmed || !mounted) return;
    ref.read(fleetProvider.notifier).removeHost(host.id, purgeSecret: true);
    if (ref.read(selectedHostIdProvider) == host.id) {
      final remaining = ref.read(fleetProvider);
      ref.read(selectedHostIdProvider.notifier).state =
          remaining.isNotEmpty ? remaining.first.id : '';
    }
    _showToast('Removed ${host.name} and cleared saved host credentials.');
  }

  Future<bool> _confirmRiskyCommand(
    String command,
    String riskReason, {
    required bool biometricArmed,
  }) async {
    final approved = await showDialog<bool>(
          context: context,
          builder: (ctx) {
            return AlertDialog(
              backgroundColor: CyberColors.surfaceElevated,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(
                  color: _kDangerColor.withValues(alpha: 0.45),
                ),
              ),
              title: const Row(
                children: [
                  Icon(Icons.shield_rounded, color: _kDangerColor),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'High-Risk Command Guard',
                      style: TextStyle(fontSize: 15),
                    ),
                  ),
                ],
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    riskReason,
                    style: const TextStyle(
                      color: CyberColors.warning,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFF060B16),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Colors.white12),
                    ),
                    child: Text(
                      command,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11.5,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  if (biometricArmed) ...[
                    const SizedBox(height: 10),
                    const Text(
                      'Device Biometric HITL guard is armed — confirm only if you intended this action.',
                      style: TextStyle(
                        color: CyberColors.textSecondary,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(false),
                  child: const Text('Deny & Abort'),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _kDangerColor,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: () => Navigator.of(ctx).pop(true),
                  child: const Text('Authorize Dispatch'),
                ),
              ],
            );
          },
        ) ??
        false;
    return approved;
  }

  Future<void> _dispatchCommand(String cmd, HostState? targetHost) async {
    final trimmed = cmd.trim();
    if (trimmed.isEmpty) return;

    final prefs = ref.read(appPreferencesProvider);
    final riskReason = NetworkValidators.inspectCommandRisk(trimmed);
    if (riskReason != null) {
      final authorized = await _confirmRiskyCommand(
        trimmed,
        riskReason,
        biometricArmed: prefs.biometricLockEnabled,
      );
      if (!authorized || !mounted) {
        _showToast(
          'Command blocked by operator HITL guard.',
          accentColor: CyberColors.warning,
        );
        return;
      }
    }

    unawaited(
      ref.read(appPreferencesProvider.notifier).pushTerminalCommand(trimmed),
    );

    final now = TimeOfDay.now();
    final timeStr =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    final targetLabel = targetHost != null
        ? '${targetHost.name} (${targetHost.ip})'
        : 'No Target Selected';

    void updateLatestStatus(String status, {bool isError = false}) {
      if (!mounted) return;
      setState(() {
        final idx = _commandLogs.indexWhere(
          (e) => e.timestamp == timeStr && e.command == trimmed,
        );
        final updated = CommandLogItem(
          timestamp: timeStr,
          hostName: targetLabel,
          command: trimmed,
          status: status,
          isError: isError,
        );
        if (idx >= 0) {
          _commandLogs[idx] = updated;
        } else {
          _commandLogs.insert(0, updated);
        }
      });
    }

    setState(() {
      _commandLogs.insert(
        0,
        CommandLogItem(
          timestamp: timeStr,
          hostName: targetLabel,
          command: trimmed,
          status: targetHost == null
              ? 'Select a PC workstation in Fleet before dispatching commands.'
              : 'Authenticating via AI-NET/3.0-SECURE WebSocket (${targetHost.ip}:${targetHost.wsPort})...',
          isError: targetHost == null,
        ),
      );
      _commandController.clear();
    });

    if (targetHost == null) return;

    final effectiveSecret = _resolveSecretForHost(targetHost);
    if (effectiveSecret.isEmpty) {
      updateLatestStatus(
        'Pairing secret required. Open Settings or Add Workstation to pair this PC.',
        isError: true,
      );
      return;
    }

    try {
      final resolvedFp = targetHost.certFingerprint.trim().isNotEmpty
          ? targetHost.certFingerprint.trim()
          : loadHostCertFingerprint(targetHost.ip);
      final client = HostConnectionPool.instance.acquire(
        hostIp: targetHost.ip,
        port: targetHost.wsPort,
        sharedSecret: effectiveSecret,
        useTls: targetHost.useTls || prefs.preferTls,
        certFingerprint: resolvedFp.isNotEmpty ? resolvedFp : null,
      );
      final res = await client.executeCommand(
        trimmed,
        timeout: const Duration(seconds: 25),
      );
      final out = res.output.trim();
      final failed = res.exitCode != 0 || res.status == 'error' || res.status == 'timeout';
      updateLatestStatus(
        '[${res.status} • exit ${res.exitCode}] ${out.isNotEmpty ? out : "(no output)"}',
        isError: failed,
      );
    } catch (e) {
      updateLatestStatus('Dispatch error: $e', isError: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hosts = ref.watch(fleetProvider);
    final selectedHostId = ref.watch(selectedHostIdProvider);
    final onlineCount = hosts.where((h) => h.isOnline).length;
    final primary = Theme.of(context).colorScheme.primary;

    HostState? selectedHost;
    if (hosts.isNotEmpty) {
      selectedHost = hosts.firstWhere(
        (h) => h.id == selectedHostId,
        orElse: () => hosts.first,
      );
    }

    final navDestinations = <AdaptiveNavItem>[
      AdaptiveNavItem(
        label: 'Fleet',
        icon: Icons.devices_rounded,
        activeIcon: Icons.devices_rounded,
        badgeCount: onlineCount,
      ),
      const AdaptiveNavItem(
        label: 'Terminal',
        icon: Icons.terminal_rounded,
        activeIcon: Icons.terminal_rounded,
      ),
      const AdaptiveNavItem(
        label: 'Settings',
        icon: Icons.tune_rounded,
        activeIcon: Icons.tune_rounded,
      ),
    ];

    return AdaptiveScaffold(
      title: 'AI NETCONTROLLER',
      navItems: navDestinations,
      selectedIndex: _currentTabIndex,
      onIndexChanged: (idx) => setState(() => _currentTabIndex = idx),
      actions: [
        IconButton(
          tooltip: 'Scan for PC',
          icon: _isScanning
              ? SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: primary,
                  ),
                )
              : Icon(Icons.radar_rounded, color: primary, size: 22),
          onPressed: _isScanning ? null : _scanForPcs,
        ),
        IconButton(
          tooltip: 'Add Workstation',
          icon: Icon(Icons.add_circle_outline_rounded,
              color: primary, size: 20),
          onPressed: () => _showHostEditorDialog(),
        ),
        IconButton(
          tooltip: 'Quick Setup Guide',
          icon: Icon(Icons.explore_outlined, color: primary, size: 20),
          onPressed: () => AdaptiveOnboardingSheet.show(
            context,
            onCompleted: () => ref
                .read(appPreferencesProvider.notifier)
                .setOnboardingCompleted(true),
          ),
        ),
      ],
      compactBody: _buildBodyForIndex(
        tier: ScreenTier.compact,
        hosts: hosts,
        selectedHost: selectedHost,
      ),
      mediumBody: _buildBodyForIndex(
        tier: ScreenTier.medium,
        hosts: hosts,
        selectedHost: selectedHost,
      ),
      expandedMasterPane: _buildMasterFleetPane(hosts, selectedHostId),
      expandedDetailPane: _buildDetailConsolePane(selectedHost),
    );
  }

  Widget _buildBodyForIndex({
    required ScreenTier tier,
    required List<HostState> hosts,
    required HostState? selectedHost,
  }) {
    switch (_currentTabIndex) {
      case 0:
        return tier == ScreenTier.medium
            ? _buildMediumGridFleet(hosts)
            : _buildCompactListFleet(hosts);
      case 1:
        return _buildTerminalCommandsTab(selectedHost, hosts: hosts);
      case 2:
        return _buildSettingsTab();
      default:
        return _buildCompactListFleet(hosts);
    }
  }

  List<HostState> _filteredHosts(List<HostState> hosts) {
    final query = _fleetSearchQuery.trim().toLowerCase();
    if (query.isEmpty) return hosts;
    return hosts.where((h) {
      return h.name.toLowerCase().contains(query) ||
          h.ip.toLowerCase().contains(query) ||
          h.mac.toLowerCase().contains(query);
    }).toList(growable: false);
  }

  Widget _buildOnboardingBanner() {
    final prefs = ref.watch(appPreferencesProvider);
    if (prefs.hasCompletedOnboarding) return const SizedBox.shrink();
    final primary = Theme.of(context).colorScheme.primary;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
      decoration: BoxDecoration(
        color: primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: primary.withValues(alpha: 0.30)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.auto_awesome_rounded, color: primary, size: 18),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'New to AI NetController?',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 12.5,
                  ),
                ),
              ),
              TextButton(
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: Size.zero,
                ),
                onPressed: () => AdaptiveOnboardingSheet.show(
                  context,
                  onCompleted: () => ref
                      .read(appPreferencesProvider.notifier)
                      .setOnboardingCompleted(true),
                ),
                child: Text('Tour', style: TextStyle(color: primary, fontSize: 12)),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                tooltip: 'Dismiss tour banner',
                icon: const Icon(
                  Icons.close_rounded,
                  size: 16,
                  color: CyberColors.textSecondary,
                ),
                onPressed: () => ref
                    .read(appPreferencesProvider.notifier)
                    .setOnboardingCompleted(true),
              ),
            ],
          ),
          const SizedBox(height: 2),
          const Text(
            'Gestures, Wake-on-LAN & PIN pairing tips.',
            style: TextStyle(
              color: CyberColors.textSecondary,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFleetToolbar(List<HostState> hosts) {
    final primary = Theme.of(context).colorScheme.primary;
    final hasSleepingWithMac = hosts.any(
      (h) => !h.isOnline && NetworkValidators.normalizeMac(h.mac) != null,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          runSpacing: 4,
          children: [
            _buildSectionHeader(
              'WORKSTATIONS (${hosts.where((h) => h.isOnline).length}/${hosts.length} ONLINE)',
            ),
            if (hosts.isNotEmpty)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextButton.icon(
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      minimumSize: Size.zero,
                    ),
                    onPressed: _isPinging ? null : _pingAllHosts,
                    icon: _isPinging
                        ? SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: primary,
                            ),
                          )
                        : Icon(Icons.network_ping_rounded, size: 15, color: primary),
                    label: Text(
                      _isPinging ? 'Pinging...' : 'Ping',
                      style: TextStyle(color: primary, fontSize: 11.5),
                    ),
                  ),
                  if (hasSleepingWithMac)
                    TextButton.icon(
                      style: TextButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: Size.zero,
                      ),
                      onPressed: () => _wakeAllOfflineHosts(hosts),
                      icon: const Icon(
                        Icons.bolt_rounded,
                        size: 15,
                        color: CyberColors.warning,
                      ),
                      label: const Text(
                        'Wake All',
                        style: TextStyle(
                          color: CyberColors.warning,
                          fontSize: 11.5,
                        ),
                      ),
                    ),
                ],
              ),
          ],
        ),
        if (hosts.length > 2) ...[
          const SizedBox(height: 6),
          TextField(
            controller: _fleetSearchController,
            onChanged: (val) => setState(() => _fleetSearchQuery = val),
            style: const TextStyle(color: Colors.white, fontSize: 12.5),
            decoration: InputDecoration(
              isDense: true,
              prefixIcon: Icon(Icons.search_rounded, size: 18, color: primary),
              suffixIcon: _fleetSearchQuery.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear_rounded, size: 16),
                      onPressed: () {
                        _fleetSearchController.clear();
                        setState(() => _fleetSearchQuery = '');
                      },
                    )
                  : null,
              hintText: 'Filter by hostname, IP, or MAC...',
              hintStyle: const TextStyle(
                color: CyberColors.textTertiary,
                fontSize: 12,
              ),
              filled: true,
              fillColor: CyberColors.surfaceElevated.withValues(alpha: 0.7),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide:
                    BorderSide(color: Colors.white.withValues(alpha: 0.10)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide:
                    BorderSide(color: Colors.white.withValues(alpha: 0.10)),
              ),
            ),
          ),
        ],
        const SizedBox(height: 8),
      ],
    );
  }

  Widget _buildEmptyFleetState() {
    final primary = Theme.of(context).colorScheme.primary;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 16),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: CyberColors.surfaceElevated.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: primary.withValues(alpha: 0.12),
              border: Border.all(color: primary.withValues(alpha: 0.3)),
            ),
            child: Icon(Icons.devices_rounded, color: primary, size: 24),
          ),
          const SizedBox(height: 14),
          const Text(
            'No Workstations Found',
            style: TextStyle(
              color: Colors.white,
              fontSize: 15,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Scan your Wi-Fi network to detect active PCs running the AI NetController host daemon, or manually register an IP address.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: CyberColors.textSecondary,
              fontSize: 12,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 18),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 10,
            runSpacing: 10,
            children: [
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: primary,
                  foregroundColor: Colors.black,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                ),
                icon: _isScanning
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.black,
                        ),
                      )
                    : const Icon(Icons.radar_rounded, size: 18),
                label: Text(
                  _isScanning ? 'Scanning...' : 'Scan Wi-Fi',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 12.5,
                  ),
                ),
                onPressed: _isScanning ? null : _scanForPcs,
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side:
                      BorderSide(color: Colors.white.withValues(alpha: 0.2)),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                ),
                icon: const Icon(Icons.add_rounded, size: 18),
                label: const Text('Manual Add', style: TextStyle(fontSize: 12)),
                onPressed: () => _showHostEditorDialog(),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDeviceCardFor(HostState host, {bool isSelected = false}) {
    return ResponsiveDeviceCard(
      id: host.id,
      name: host.name,
      ip: host.ip,
      mac: host.mac,
      isOnline: host.isOnline,
      cpuUsage: host.cpuUsage,
      ramUsage: host.ramUsage,
      latencyMs: host.latencyMs,
      isSelected: isSelected,
      onTap: () {
        ref.read(selectedHostIdProvider.notifier).state = host.id;
        if (host.isOnline) _openStreamScreen(host);
      },
      onWakeOnLan: () => _sendWakeOnLan(host.mac, targetIp: host.ip),
      onOpenStream: () => _openStreamScreen(host),
      onLongPress: () => _showHostActionsSheet(host),
      onMoreActions: () => _showHostActionsSheet(host),
    );
  }

  // -------------------------------------------------------------------
  // 1. COMPACT FLEET VIEW (SINGLE COLUMN SCROLL + PULL TO REFRESH)
  // -------------------------------------------------------------------
  Widget _buildCompactListFleet(List<HostState> hosts) {
    final filtered = _filteredHosts(hosts);
    return RefreshIndicator(
      onRefresh: hosts.isEmpty ? _scanForPcs : _pingAllHosts,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: [
          _buildOnboardingBanner(),
          _buildFleetToolbar(hosts),
          if (hosts.isEmpty)
            _buildEmptyFleetState()
          else if (filtered.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 28),
              child: Center(
                child: Text(
                  'No workstations match the current filter.',
                  style: TextStyle(color: CyberColors.textSecondary),
                ),
              ),
            )
          else
            ...filtered.map((host) => _buildDeviceCardFor(host)),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // 2. MEDIUM FLEET VIEW (2-COLUMN ADAPTIVE GRID)
  // -------------------------------------------------------------------
  Widget _buildMediumGridFleet(List<HostState> hosts) {
    final filtered = _filteredHosts(hosts);
    if (hosts.isEmpty) {
      return ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: [
          _buildOnboardingBanner(),
          _buildFleetToolbar(hosts),
          _buildEmptyFleetState(),
        ],
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _buildOnboardingBanner(),
                _buildFleetToolbar(hosts),
              ],
            ),
          ),
          if (filtered.isEmpty)
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 28),
                child: Center(
                  child: Text(
                    'No workstations match the current filter.',
                    style: TextStyle(color: CyberColors.textSecondary),
                  ),
                ),
              ),
            )
          else
            SliverGrid(
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                mainAxisExtent: 158,
              ),
              delegate: SliverChildBuilderDelegate(
                (context, index) => _buildDeviceCardFor(filtered[index]),
                childCount: filtered.length,
              ),
            ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // 3. EXPANDED MASTER PANE (35% WIDTH)
  // -------------------------------------------------------------------
  Widget _buildMasterFleetPane(List<HostState> hosts, String selectedId) {
    final filtered = _filteredHosts(hosts);
    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      children: [
        _buildOnboardingBanner(),
        _buildFleetToolbar(hosts),
        if (hosts.isEmpty)
          _buildEmptyFleetState()
        else
          ...filtered.map(
            (host) => ResponsiveDeviceCard(
              id: host.id,
              name: host.name,
              ip: host.ip,
              mac: host.mac,
              isOnline: host.isOnline,
              cpuUsage: host.cpuUsage,
              ramUsage: host.ramUsage,
              latencyMs: host.latencyMs,
              isSelected: host.id == selectedId,
              onTap: () {
                ref.read(selectedHostIdProvider.notifier).state = host.id;
              },
              onWakeOnLan: () => _sendWakeOnLan(host.mac, targetIp: host.ip),
              onOpenStream: () => _openStreamScreen(host),
              onLongPress: () => _showHostActionsSheet(host),
              onMoreActions: () => _showHostActionsSheet(host),
            ),
          ),
      ],
    );
  }

  // -------------------------------------------------------------------
  // 4. EXPANDED DETAIL PANE (65% WIDTH)
  // -------------------------------------------------------------------
  Widget _buildDetailConsolePane(HostState? host) {
    if (host == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: _buildEmptyFleetState(),
        ),
      );
    }

    final prefs = ref.watch(appPreferencesProvider);
    return Padding(
      key: ValueKey<String>(host.id),
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 240),
            switchInCurve: Curves.easeOutCubic,
            child: host.isOnline
                ? AspectRatio(
                    key: ValueKey('online-${host.id}'),
                    aspectRatio: 16 / 9,
                    child: ViewportStreamWidget(
                      hostIp: host.ip,
                      hostName: host.name,
                      wsPort: host.wsPort,
                      isInline: true,
                      sharedSecret: _resolveSecretForHost(host),
                      useTls: host.useTls || prefs.preferTls,
                      certFingerprint: host.certFingerprint.trim().isNotEmpty
                          ? host.certFingerprint.trim()
                          : loadHostCertFingerprint(host.ip),
                      onTelemetry: (data) => ref
                          .read(fleetProvider.notifier)
                          .updateTelemetryByIp(host.ip, data),
                      onToggleFullscreen: () => _openStreamScreen(host),
                    ),
                  )
                : AspectRatio(
                    key: ValueKey('offline-${host.id}'),
                    aspectRatio: 16 / 9,
                    child: Container(
                      decoration: BoxDecoration(
                        color:
                            CyberColors.surfaceElevated.withValues(alpha: 0.92),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.1),
                        ),
                      ),
                      child: Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.power_settings_new_rounded,
                              size: 40,
                              color: CyberColors.textTertiary,
                            ),
                            const SizedBox(height: 12),
                            Text(
                              '${host.name} is currently in S3/S5 Sleep State',
                              style: const TextStyle(
                                color: CyberColors.textSecondary,
                              ),
                            ),
                            const SizedBox(height: 12),
                            ElevatedButton.icon(
                              icon: const Icon(
                                Icons.bolt_rounded,
                                color: Colors.black,
                              ),
                              label: const Text('WAKE ON LAN (WoL)'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: CyberColors.warning,
                                foregroundColor: Colors.black,
                              ),
                              onPressed: () =>
                                  _sendWakeOnLan(host.mac, targetIp: host.ip),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: _buildTerminalCommandsTab(host, isEmbedded: true),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // COMMANDS TERMINAL TAB
  // -------------------------------------------------------------------
  Widget _buildTerminalCommandsTab(
    HostState? host, {
    bool isEmbedded = false,
    List<HostState> hosts = const [],
  }) {
    final primary = Theme.of(context).colorScheme.primary;
    final prefs = ref.watch(appPreferencesProvider);
    final commands = const [
      'Get-Process | Sort-Object CPU -Descending | Select -First 8',
      'ipconfig /all',
      'Get-Service | Where-Object Status -eq "Running"',
      'systeminfo',
      'nvidia-smi',
    ];

    final targetHeader = host != null
        ? 'DISPATCH COMMAND TO: ${host.name} • ${host.ip}'
        : 'DISPATCH COMMAND (SELECT OR ADD A HOST FIRST)';

    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: isEmbedded ? EdgeInsets.zero : const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(child: _buildSectionHeader(targetHeader)),
            if (!isEmbedded && hosts.length > 1 && host != null)
              DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: host.id,
                  dropdownColor: CyberColors.surfaceElevated,
                  style: TextStyle(
                    color: primary,
                    fontFamily: 'monospace',
                    fontSize: 11.5,
                  ),
                  items: hosts
                      .map(
                        (h) => DropdownMenuItem<String>(
                          value: h.id,
                          child: Text(h.name),
                        ),
                      )
                      .toList(),
                  onChanged: (nextId) {
                    if (nextId != null) {
                      ref.read(selectedHostIdProvider.notifier).state = nextId;
                    }
                  },
                ),
              ),
          ],
        ),
        if (host != null) ...[
          const SizedBox(height: 8),
          _buildTelemetrySummaryStrip(host),
        ],
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _commandController,
                onSubmitted: (val) => _dispatchCommand(val, host),
                style: const TextStyle(
                  color: Colors.white,
                  fontFamily: 'monospace',
                  fontSize: 12.5,
                ),
                decoration: InputDecoration(
                  hintText: 'Enter PowerShell or Bash command...',
                  hintStyle: TextStyle(
                    color: Colors.white.withValues(alpha: 0.35),
                    fontFamily: 'monospace',
                    fontSize: 12,
                  ),
                  filled: true,
                  fillColor:
                      CyberColors.surfaceElevated.withValues(alpha: 0.92),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(
                      color: Colors.white.withValues(alpha: 0.12),
                    ),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(
                      color: Colors.white.withValues(alpha: 0.12),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: primary,
                foregroundColor: Colors.black,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 13,
                ),
              ),
              onPressed: () => _dispatchCommand(_commandController.text, host),
              child: const Text(
                'Run',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12.5),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: commands.map((cmd) {
            return ActionChip(
              backgroundColor:
                  CyberColors.surfaceElevated.withValues(alpha: 0.9),
              side: BorderSide(color: primary.withValues(alpha: 0.35)),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              label: Text(
                cmd.split('|').first.trim(),
                style: TextStyle(
                  color: primary,
                  fontSize: context.fluidFont(11),
                  fontFamily: 'monospace',
                ),
              ),
              onPressed: () => _dispatchCommand(cmd, host),
            );
          }).toList(),
        ),
        if (prefs.terminalHistory.isNotEmpty) ...[
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(child: _buildSectionHeader('RECENT COMMAND HISTORY')),
              TextButton(
                onPressed: () => ref
                    .read(appPreferencesProvider.notifier)
                    .clearTerminalHistory(),
                child: const Text(
                  'Clear History',
                  style: TextStyle(
                    color: CyberColors.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ),
            ],
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: prefs.terminalHistory.map((item) {
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ActionChip(
                    backgroundColor: Colors.white.withValues(alpha: 0.04),
                    side: BorderSide(color: Colors.white.withValues(alpha: 0.14)),
                    label: Text(
                      item,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                      ),
                    ),
                    onPressed: () {
                      _commandController.text = item;
                    },
                  ),
                );
              }).toList(),
            ),
          ),
        ],
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: _buildSectionHeader(
                'TERMINAL CONSOLE OUTPUT • SANDBOXED JOB OBJECT',
              ),
            ),
            if (_commandLogs.isNotEmpty)
              TextButton(
                onPressed: () => setState(() => _commandLogs.clear()),
                child: const Text(
                  'Clear Log',
                  style: TextStyle(
                    color: CyberColors.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF060B16),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: primary.withValues(alpha: 0.22)),
          ),
          child: _commandLogs.isEmpty
              ? Text(
                  host != null
                      ? 'Ready on ${host.name} (${host.ip}:${host.wsPort}). Select a preset or type a command above to execute.'
                      : 'No active command session. Add a workstation in the Fleet tab to execute remote commands.',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    color: CyberColors.textSecondary,
                    fontSize: context.fluidFont(11),
                  ),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: _commandLogs.map((entry) {
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  '[${entry.timestamp}] ${entry.hostName} > ${entry.command}',
                                  style: TextStyle(
                                    fontFamily: 'monospace',
                                    color: primary,
                                    fontWeight: FontWeight.bold,
                                    fontSize: context.fluidFont(10.5),
                                  ),
                                ),
                              ),
                              IconButton(
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(
                                  minWidth: 28,
                                  minHeight: 28,
                                ),
                                tooltip: 'Copy output',
                                icon: const Icon(
                                  Icons.copy_rounded,
                                  size: 14,
                                  color: CyberColors.textTertiary,
                                ),
                                onPressed: () {
                                  Clipboard.setData(
                                    ClipboardData(text: entry.status),
                                  );
                                  _showToast('Output copied to clipboard');
                                },
                              ),
                            ],
                          ),
                          const SizedBox(height: 2),
                          SelectableText(
                            entry.status,
                            style: TextStyle(
                              fontFamily: 'monospace',
                              color: entry.isError
                                  ? CyberColors.warning
                                  : CyberColors.success,
                              fontSize: context.fluidFont(10),
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------
  // SETTINGS TAB (APPEARANCE STUDIO + SECURITY + PERSISTENT PREFS)
  // -------------------------------------------------------------------
  Future<void> _showPairingSecretDialog() async {
    final secretCtrl = TextEditingController();
    final pinCtrl = TextEditingController();
    final hosts = ref.read(fleetProvider);
    final selectedId = ref.read(selectedHostIdProvider);
    HostState? targetHost;
    if (hosts.isNotEmpty) {
      targetHost = hosts.firstWhere(
        (h) => h.id == selectedId,
        orElse: () => hosts.first,
      );
    }

    await showDialog<void>(
      context: context,
      builder: (ctx) {
        final primary = Theme.of(ctx).colorScheme.primary;
        return AlertDialog(
          backgroundColor: CyberColors.surfaceElevated,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
          ),
          title: const Text(
            'Pair Workstation Credentials',
            style: TextStyle(color: Colors.white, fontSize: 16),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: secretCtrl,
                obscureText: true,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontFamily: 'monospace',
                ),
                decoration: const InputDecoration(
                  labelText: 'New Global Pairing Token (ainet_...)',
                  hintText: 'Leave blank to keep current token',
                ),
              ),
              if (targetHost != null) ...[
                const SizedBox(height: 12),
                TextField(
                  controller: pinCtrl,
                  keyboardType: TextInputType.number,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontFamily: 'monospace',
                  ),
                  decoration: InputDecoration(
                    labelText: 'Or Pair ${targetHost.ip} with 6-Digit PIN',
                    hintText: 'e.g. 482910',
                  ),
                ),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text(
                'Cancel',
                style: TextStyle(color: CyberColors.textSecondary),
              ),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: primary,
                foregroundColor: Colors.black,
              ),
              onPressed: () async {
                String nextSecret = secretCtrl.text.trim();
                String? nextCertFp = targetHost?.certFingerprint;
                final pin = pinCtrl.text.trim();
                bool? pinPaired;
                if (targetHost != null && RegExp(r'^\d{6}$').hasMatch(pin)) {
                  final exchanged = await _pairWithHostPin(
                    targetHost.ip,
                    pin,
                    port: targetHost.wsPort,
                    useTls: targetHost.useTls ||
                        ref.read(appPreferencesProvider).preferTls,
                    certFingerprint: targetHost.certFingerprint.isNotEmpty
                        ? targetHost.certFingerprint
                        : null,
                  );
                  if (exchanged != null && exchanged.pairingToken.isNotEmpty) {
                    nextSecret = exchanged.pairingToken;
                    if (exchanged.certFingerprint != null &&
                        exchanged.certFingerprint!.isNotEmpty) {
                      nextCertFp = exchanged.certFingerprint;
                    }
                    pinPaired = true;
                  } else {
                    pinPaired = false;
                  }
                }
                if (nextSecret.isNotEmpty) {
                  ref.read(globalPairingSecretProvider.notifier).state =
                      nextSecret;
                  saveHostPairingSecret(
                    targetHost?.ip ?? '',
                    nextSecret,
                    certFingerprint: nextCertFp,
                  );
                  if (targetHost != null) {
                    ref.read(fleetProvider.notifier).setHostSecret(
                          targetHost.ip,
                          nextSecret,
                          certFingerprint: nextCertFp,
                        );
                  }
                }
                if (ctx.mounted) {
                  Navigator.of(ctx).pop();
                }
                if (pinPaired != null) {
                  _showToast(
                    pinPaired
                        ? 'Paired with ${targetHost?.ip} — session token saved.'
                        : 'PIN pairing failed — verify the 6-digit PIN on the PC daemon.',
                    accentColor: pinPaired
                        ? CyberColors.success
                        : CyberColors.warning,
                  );
                } else if (nextSecret.isNotEmpty) {
                  _showToast(
                    'Pairing token stored in secure local vault.',
                    accentColor: CyberColors.success,
                  );
                }
              },
              child: const Text(
                'Save & Pair',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
            ),
          ],
        );
      },
    ).whenComplete(() {
      Future<void>.delayed(const Duration(milliseconds: 300), () {
        secretCtrl.dispose();
        pinCtrl.dispose();
      });
    });
  }

  Future<void> _showDiscoveryPortDialog(int currentPort) async {
    final portCtrl = TextEditingController(text: currentPort.toString());
    String? errorMsg;
    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: CyberColors.surfaceElevated,
          title: const Text('LAN Discovery Port'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: portCtrl,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: 'TCP WebSocket Port',
                  hintText: '8765',
                  errorText: errorMsg,
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                final parsed = int.tryParse(portCtrl.text.trim());
                if (!NetworkValidators.isValidPort(parsed)) {
                  setDialogState(() {
                    errorMsg = 'Enter a valid port (1 - 65535)';
                  });
                  return;
                }
                ref
                    .read(appPreferencesProvider.notifier)
                    .setCustomScanPort(parsed!);
                Navigator.of(ctx).pop();
                _showToast('Default scan port updated to $parsed');
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    ).whenComplete(() {
      Future<void>.delayed(const Duration(milliseconds: 300), portCtrl.dispose);
    });
  }

  Future<void> _confirmPurgeAllSecrets() async {
    final confirmed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: CyberColors.surfaceElevated,
            title: const Text('Purge All Saved Tokens?'),
            content: const Text(
              'This clears all global and per-host pairing secrets saved on this phone. You will need to re-pair via 6-digit PIN or token.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _kDangerColor,
                  foregroundColor: Colors.white,
                ),
                onPressed: () => Navigator.of(ctx).pop(true),
                child: const Text('Purge Vault'),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed || !mounted) return;
    await purgeAllPairingSecrets();
    ref.read(globalPairingSecretProvider.notifier).state = '';
    ref.read(fleetProvider.notifier).clearAllHostSecrets();
    _showToast(
      'All pairing credentials purged from device vault.',
      accentColor: CyberColors.warning,
    );
  }

  String _formatEnumLabel(Enum value) {
    final raw = value.name;
    if (raw.isEmpty) return raw;
    return '${raw[0].toUpperCase()}${raw.substring(1)}';
  }

  Widget _buildTelemetrySummaryStrip(HostState host) {
    final primary = Theme.of(context).colorScheme.primary;
    final metrics = <String>[
      if (host.osName.isNotEmpty) 'OS: ${host.osName}',
      'CPU: ${host.cpuUsage}%${host.cpuCores > 0 ? ' (${host.cpuCores}c)' : ''}',
      host.ramTotalGb > 0
          ? 'RAM: ${host.ramUsedGb.toStringAsFixed(1)}/${host.ramTotalGb.toStringAsFixed(1)} GB (${host.ramUsage}%)'
          : 'RAM: ${host.ramUsage}%',
      if (host.diskUsage > 0) 'Disk: ${host.diskUsage}%',
      if (host.latencyMs != null) 'Ping: ${host.latencyMs}ms',
      if (host.mac.isNotEmpty && host.mac != '00:00:00:00:00:00')
        'MAC: ${host.mac}',
      host.viewOnlyMode ? 'Mode: View-Only' : 'Mode: Interactive',
    ];
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: metrics.map((label) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
          decoration: BoxDecoration(
            color: CyberColors.surfaceElevated.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: primary.withValues(alpha: 0.25)),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: context.fluidFont(9.5),
              color: CyberColors.textSecondary,
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildAppearanceStudioCard(AppPreferencesState prefs) {
    final prefsNotifier = ref.read(appPreferencesProvider.notifier);
    final primary = Theme.of(context).colorScheme.primary;

    return Material(
      color: CyberColors.surfaceElevated.withValues(alpha: 0.94),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: primary.withValues(alpha: 0.22)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.palette_rounded, color: primary, size: 18),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'Accent Palette (Saved Across Restarts)',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: CyberAccentPreset.values.map((preset) {
                final swatchColor = CyberTheme.fromPalette(
                  CyberPalette.fromPreset(preset),
                ).colorScheme.primary;
                final isSelected = prefs.accent == preset;
                return Semantics(
                  button: true,
                  selected: isSelected,
                  label: 'Theme color ${_formatEnumLabel(preset)}',
                  child: InkWell(
                    key: ValueKey('accent-${preset.name}'),
                    borderRadius: BorderRadius.circular(14),
                    onTap: () {
                      _hapticTap();
                      prefsNotifier.setAccent(preset);
                    },
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? swatchColor.withValues(alpha: 0.18)
                            : Colors.white.withValues(alpha: 0.04),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: isSelected
                              ? swatchColor
                              : Colors.white.withValues(alpha: 0.10),
                          width: isSelected ? 1.5 : 1,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 14,
                            height: 14,
                            decoration: BoxDecoration(
                              color: swatchColor,
                              shape: BoxShape.circle,
                            ),
                            child: isSelected
                                ? const Icon(
                                    Icons.check_rounded,
                                    size: 10,
                                    color: Colors.black,
                                  )
                                : null,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            _formatEnumLabel(preset),
                            style: TextStyle(
                              color: isSelected ? Colors.white : Colors.white70,
                              fontWeight:
                                  isSelected ? FontWeight.bold : FontWeight.w500,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
            const Text(
              'Glass Surface Intensity',
              style: TextStyle(
                color: CyberColors.textSecondary,
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: GlassIntensity.values.map((intensity) {
                final selected = prefs.glassIntensity == intensity;
                return ChoiceChip(
                  label: Text(_formatEnumLabel(intensity)),
                  selected: selected,
                  selectedColor: primary.withValues(alpha: 0.25),
                  labelStyle: TextStyle(
                    color: selected ? primary : CyberColors.textSecondary,
                    fontWeight: selected ? FontWeight.bold : FontWeight.w500,
                    fontSize: 12,
                  ),
                  onSelected: (_) {
                    _hapticTap();
                    prefsNotifier.setGlassIntensity(intensity);
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Reduced Motion & Animations',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Minimizes transition motion and pulse effects for battery savings.',
                        style: TextStyle(
                          fontSize: 11,
                          color: CyberColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Switch.adaptive(
                  activeTrackColor: primary.withValues(alpha: 0.5),
                  activeThumbColor: primary,
                  value: prefs.reducedMotion,
                  onChanged: prefsNotifier.setReducedMotion,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSettingsTab() {
    final savedSecret = ref.watch(globalPairingSecretProvider);
    final prefs = ref.watch(appPreferencesProvider);
    final prefsNotifier = ref.read(appPreferencesProvider.notifier);
    final primary = Theme.of(context).colorScheme.primary;
    final hasSecret = savedSecret.trim().isNotEmpty;

    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        _buildSectionHeader('APPEARANCE STUDIO (PERSISTENT)'),
        const SizedBox(height: 8),
        _buildAppearanceStudioCard(prefs),
        const SizedBox(height: 20),
        _buildSectionHeader('SECURITY & CREDENTIAL VAULT'),
        const SizedBox(height: 8),
        InkWell(
          onTap: _showPairingSecretDialog,
          borderRadius: BorderRadius.circular(16),
          child: _buildSettingsTile(
            icon: Icons.vpn_key_rounded,
            title: 'Workstation Pairing Token / PIN',
            subtitle: hasSecret
                ? 'Configured in protected local vault — tap to rotate or pair via PIN'
                : 'Not configured — tap to enter token or 6-digit PC PIN',
            trailing: Icon(
              hasSecret ? Icons.verified_user_rounded : Icons.edit_rounded,
              color: hasSecret ? CyberColors.success : CyberColors.warning,
              size: 20,
            ),
          ),
        ),
        _buildSettingsToggleTile(
          icon: Icons.enhanced_encryption_rounded,
          title: 'E2E AEAD Payload Vault (Mutual ECDH)',
          subtitle: 'Mutual X25519 + ChaCha20-Poly1305 AEAD is active for control & video frames.',
          value: prefs.enableE2eVault,
          onChanged: prefsNotifier.setEnableE2eVault,
        ),
        _buildSettingsToggleTile(
          icon: Icons.lock_rounded,
          title: 'Prefer WSS/TLS WebSocket Transport',
          subtitle: 'Uses wss:// instead of ws:// when host supports TLS certs.',
          value: prefs.preferTls,
          onChanged: prefsNotifier.setPreferTls,
        ),
        _buildSettingsToggleTile(
          icon: Icons.fingerprint_rounded,
          title: 'Arm Biometric HITL Guard Notice',
          subtitle: 'Highlights hardware verification prompts for high-risk shell commands.',
          value: prefs.biometricLockEnabled,
          onChanged: prefsNotifier.setBiometricLockEnabled,
        ),
        if (hasSecret)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: _kDangerColor,
                side: BorderSide(
                  color: _kDangerColor.withValues(alpha: 0.4),
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              icon: const Icon(Icons.delete_sweep_rounded, size: 18),
              label: const Text('Purge All Saved Pairing Secrets'),
              onPressed: _confirmPurgeAllSecrets,
            ),
          ),
        const SizedBox(height: 14),
        _buildSectionHeader('STREAMING & NETWORK PREFERENCES'),
        const SizedBox(height: 8),
        InkWell(
          onTap: () => _showDiscoveryPortDialog(prefs.customScanPort),
          borderRadius: BorderRadius.circular(16),
          child: _buildSettingsTile(
            icon: Icons.wifi_tethering_rounded,
            title: 'LAN Discovery & Default WebSocket Port',
            subtitle: 'Tap to customize port scanned for AI NetController agents.',
            trailing: Text(
              'PORT ${prefs.customScanPort}',
              style: TextStyle(color: primary, fontFamily: 'monospace'),
            ),
          ),
        ),
        Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: CyberColors.surfaceElevated.withValues(alpha: 0.94),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white.withValues(alpha: 0.10)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Target Stream Frame Rate',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: context.fluidFont(12),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Persisted decode & frame pacing cap for battery/smoothness.',
                style: TextStyle(
                  color: CyberColors.textSecondary,
                  fontSize: context.fluidFont(10),
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: const [15, 30, 60].map((fps) {
                  final active = prefs.targetFps == fps;
                  return ChoiceChip(
                    label: Text('${fps}fps'),
                    selected: active,
                    selectedColor: primary.withValues(alpha: 0.24),
                    labelStyle: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 11,
                      color: active ? primary : CyberColors.textSecondary,
                    ),
                    onSelected: (_) => prefsNotifier.setTargetFps(fps),
                  );
                }).toList(),
              ),
            ],
          ),
        ),
        _buildSettingsTile(
          icon: Icons.bolt_rounded,
          title: 'Wake-on-LAN Directed Broadcast',
          subtitle: 'Sends Magic Packets to subnet broadcast & 255.255.255.255',
          trailing: const Text(
            'UDP 9',
            style: TextStyle(
              color: CyberColors.warning,
              fontFamily: 'monospace',
            ),
          ),
        ),
        const SizedBox(height: 14),
        _buildSectionHeader('MAINTENANCE & DIAGNOSTICS'),
        const SizedBox(height: 8),
        InkWell(
          onTap: () => AdaptiveOnboardingSheet.show(
            context,
            onCompleted: () => prefsNotifier.setOnboardingCompleted(true),
          ),
          borderRadius: BorderRadius.circular(16),
          child: _buildSettingsTile(
            icon: Icons.explore_rounded,
            title: 'Interactive Quick-Start Guide',
            subtitle: 'Review touch gestures, E2E vault security, and WoL setup.',
            trailing: Icon(Icons.chevron_right_rounded, color: primary),
          ),
        ),
        InkWell(
          onTap: () async {
            await prefsNotifier.resetDefaults();
            _showToast('Preferences restored to default settings.');
          },
          borderRadius: BorderRadius.circular(16),
          child: _buildSettingsTile(
            icon: Icons.restart_alt_rounded,
            title: 'Reset Theme & Network Preferences',
            subtitle: 'Restores Cyan Neon theme & defaults (keeps paired hosts).',
            trailing: const Icon(
              Icons.restore_rounded,
              color: CyberColors.textSecondary,
            ),
          ),
        ),
        _buildSettingsTile(
          icon: Icons.verified_rounded,
          title: 'AI NetController Mobile',
          subtitle:
              'Impeller Hardware Engine • AI-NET/3.0-SECURE Protocol',
          trailing: const Text(
            'v0.51.0',
            style: TextStyle(
              color: CyberColors.success,
              fontFamily: 'monospace',
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSettingsToggleTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    final primary = Theme.of(context).colorScheme.primary;
    return _buildSettingsTile(
      icon: icon,
      title: title,
      subtitle: subtitle,
      trailing: Switch.adaptive(
        value: value,
        activeTrackColor: primary.withValues(alpha: 0.5),
        activeThumbColor: primary,
        onChanged: onChanged,
      ),
    );
  }

  Widget _buildSettingsTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget trailing,
  }) {
    final primary = Theme.of(context).colorScheme.primary;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: CyberColors.surfaceElevated.withValues(alpha: 0.94),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withValues(alpha: 0.10)),
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                color: primary.withValues(alpha: 0.12),
                border: Border.all(color: primary.withValues(alpha: 0.25)),
              ),
              child: Icon(icon, color: primary, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: context.fluidFont(12),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: TextStyle(
                      color: CyberColors.textSecondary,
                      fontSize: context.fluidFont(10),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            trailing,
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: TextStyle(
        color: CyberColors.textSecondary,
        fontSize: context.fluidFont(10),
        fontWeight: FontWeight.bold,
        letterSpacing: 1.5,
      ),
    );
  }
}

// =====================================================================
// FULLSCREEN SCREEN STREAM PAGE (HARDENED & FLUID)
// =====================================================================
class FullscreenStreamPage extends StatefulWidget {
  final HostState host;
  final String sharedSecret;
  final bool useTls;
  final String? certFingerprint;
  final void Function(Map<String, dynamic> telemetry)? onTelemetry;

  const FullscreenStreamPage({
    super.key,
    required this.host,
    this.sharedSecret = '',
    this.useTls = false,
    this.certFingerprint,
    this.onTelemetry,
  });

  @override
  State<FullscreenStreamPage> createState() => _FullscreenStreamPageState();
}

class _FullscreenStreamPageState extends State<FullscreenStreamPage> {
  @override
  void initState() {
    super.initState();
    unawaited(WakelockPlus.enable().catchError((_) {}));
  }

  @override
  void dispose() {
    unawaited(WakelockPlus.disable().catchError((_) {}));
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final effectiveSecret = widget.sharedSecret.trim().isNotEmpty
        ? widget.sharedSecret.trim()
        : (widget.host.sharedSecret.trim().isNotEmpty
            ? widget.host.sharedSecret.trim()
            : loadHostPairingSecret(widget.host.ip));
    final resolvedFp = (widget.certFingerprint != null &&
            widget.certFingerprint!.trim().isNotEmpty)
        ? widget.certFingerprint!.trim()
        : (widget.host.certFingerprint.trim().isNotEmpty
            ? widget.host.certFingerprint.trim()
            : loadHostCertFingerprint(widget.host.ip));
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        top: false,
        bottom: false,
        child: Stack(
          children: [
            Positioned.fill(
              child: ViewportStreamWidget(
                hostIp: widget.host.ip,
                hostName: widget.host.name,
                wsPort: widget.host.wsPort,
                isInline: false,
                sharedSecret: effectiveSecret,
                useTls: widget.useTls || widget.host.useTls,
                certFingerprint: resolvedFp.isNotEmpty ? resolvedFp : null,
                onTelemetry: widget.onTelemetry,
              ),
            ),
            Positioned(
              top: MediaQuery.paddingOf(context).top + 10,
              left: 14,
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.6),
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white24),
                ),
                child: IconButton(
                  icon: const Icon(
                    Icons.arrow_back_rounded,
                    color: Colors.white,
                    size: 20,
                  ),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
