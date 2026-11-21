import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'security/biometric_security_gate.dart';
import 'security/network_validators.dart';
import 'security/secure_secret_store.dart';
import 'services/app_preferences.dart';
import 'services/file_transfer_engine.dart';
import 'services/host_connection_client.dart';
import 'services/lan_discovery_service.dart';
import 'services/os_integrations_manager.dart';
import 'theme/fluid_theme.dart';
import 'ui/adaptive_layout_builder.dart';
import 'ui/fullscreen_stream_page.dart';
import 'ui/onboarding_sheet.dart';
import 'ui/responsive_device_card.dart';
import 'ui/viewport_stream_widget.dart';

export 'ui/fullscreen_stream_page.dart';

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
      if (trimmed.isEmpty && Hive.isBoxOpen(kVaultSecretsBoxName)) {
        unawaited(Hive.box(kVaultSecretsBoxName).delete('$_kHostSecretPrefix$cleanIp'));
      }
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
  DateTime _lastHomeWidgetSync = DateTime.fromMillisecondsSinceEpoch(0);

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

    final String? providedSecret =
        (sharedSecret != null && sharedSecret.trim().isNotEmpty)
            ? sharedSecret.trim()
            : null;
    if (existing.ip != nextIp) {
      HostConnectionPool.instance.invalidate(existing.ip);
      deleteHostPairingSecret(existing.ip);
      final String migratedSecret = providedSecret ?? existing.sharedSecret;
      if (migratedSecret.isNotEmpty || nextFp.isNotEmpty) {
        saveHostPairingSecret(
          nextIp,
          migratedSecret,
          certFingerprint: nextFp,
        );
      }
    }

    String nextSecret = existing.sharedSecret;
    if (providedSecret != null) {
      nextSecret = providedSecret;
      if (existing.ip == nextIp) {
        saveHostPairingSecret(nextIp, nextSecret, certFingerprint: nextFp);
      }
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
    bool changed = false;
    final nextList = <HostState>[
      for (final h in state)
        if (h.id == id)
          (() {
            final nextOnline = isOnline ?? h.isOnline;
            final nextCpu = cpu ?? h.cpuUsage;
            final nextRam = ram ?? h.ramUsage;
            final nextLat = clearLatency ? null : (latencyMs ?? h.latencyMs);
            if (nextOnline == h.isOnline &&
                nextCpu == h.cpuUsage &&
                nextRam == h.ramUsage &&
                nextLat == h.latencyMs) {
              return h;
            }
            changed = true;
            return h.copyWith(
              isOnline: nextOnline,
              cpuUsage: nextCpu,
              ramUsage: nextRam,
              latencyMs: nextLat,
              clearLatency: clearLatency,
            );
          })()
        else
          h,
    ];
    if (changed) {
      state = nextList;
    }
  }

  void updateLatencyByIp(String ip, int? latencyMs, {bool? isOnline}) {
    bool changed = false;
    final nextList = <HostState>[
      for (final h in state)
        if (h.ip == ip)
          (() {
            final nextOnline = isOnline ?? (latencyMs != null);
            if (h.latencyMs == latencyMs && h.isOnline == nextOnline) {
              return h;
            }
            changed = true;
            return h.copyWith(
              latencyMs: latencyMs,
              clearLatency: latencyMs == null,
              isOnline: nextOnline,
            );
          })()
        else
          h,
    ];
    if (changed) {
      state = nextList;
    }
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
    bool stateChanged = false;
    final nextList = <HostState>[
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
            final nextCpu = cpuVal ?? h.cpuUsage;
            final nextRam = ramVal ?? h.ramUsage;
            final nextDisk = diskVal ?? h.diskUsage;
            final nextCores = coresVal ?? h.cpuCores;
            final nextRamUsed = ramUsedVal ?? h.ramUsedGb;
            final nextRamTotal = ramTotalVal ?? h.ramTotalGb;
            final nextUptime = uptimeVal ?? h.uptimeSec;
            final nextViewOnly = viewOnlyVal ?? h.viewOnlyMode;
            final nextOs = osVal ?? h.osName;
            if (nextName == h.name &&
                nextMac == h.mac &&
                h.isOnline &&
                nextCpu == h.cpuUsage &&
                nextRam == h.ramUsage &&
                nextDisk == h.diskUsage &&
                nextCores == h.cpuCores &&
                nextRamUsed == h.ramUsedGb &&
                nextRamTotal == h.ramTotalGb &&
                nextUptime == h.uptimeSec &&
                nextViewOnly == h.viewOnlyMode &&
                nextOs == h.osName) {
              return h;
            }
            stateChanged = true;
            return h.copyWith(
              name: nextName,
              mac: nextMac,
              isOnline: true,
              cpuUsage: nextCpu,
              ramUsage: nextRam,
              diskUsage: nextDisk,
              cpuCores: nextCores,
              ramUsedGb: nextRamUsed,
              ramTotalGb: nextRamTotal,
              uptimeSec: nextUptime,
              viewOnlyMode: nextViewOnly,
              osName: nextOs,
            );
          })()
        else
          h,
    ];
    if (stateChanged) {
      state = nextList;
    }

    if (persistentMetadataChanged) {
      _persistHosts();
    }

    final now = DateTime.now();
    if ((Platform.isAndroid || Platform.isIOS) &&
        now.difference(_lastHomeWidgetSync).inSeconds >= 5) {
      _lastHomeWidgetSync = now;
      final displayHost = state.where((h) => h.ip == ip).firstOrNull;
      try {
        unawaited(
          OsIntegrationsManager.instance
              .updateHomeScreenWidget(
                hostName: displayHost?.name ??
                    (hostname.isNotEmpty ? hostname : 'Host PC'),
                hostIp: ip,
                hostMac: displayHost?.mac ?? '00:00:00:00:00:00',
                isOnline: true,
                cpuUsage: (cpuVal ?? 0).toDouble(),
                ramUsage: (ramVal ?? 0).toDouble(),
              )
              .catchError((_) {}),
        );
      } catch (_) {}
    }
  }
}

final selectedHostIdProvider = StateProvider<String>((ref) => '');

class CommandLogItem {
  static int _nextId = 1;
  final int id;
  final String timestamp;
  final String hostName;
  final String command;
  final String status;
  final bool isError;

  CommandLogItem({
    int? id,
    required this.timestamp,
    required this.hostName,
    required this.command,
    required this.status,
    this.isError = false,
  }) : id = id ?? (_nextId++);
}

// =====================================================================
// ROOT APPLICATION ENTRY WITH PERSISTENCE & CLAMPED ACCESSIBILITY SCALER
// =====================================================================
Future<void> _openHiveBoxSafely(String boxName) async {
  try {
    if (!Hive.isBoxOpen(boxName)) {
      await Hive.openBox(boxName);
    }
  } catch (e) {
    debugPrint('Hive box "$boxName" open failed ($e); recreating cleanly.');
    try {
      await Hive.deleteBoxFromDisk(boxName);
      await Hive.openBox(boxName);
    } catch (inner) {
      debugPrint('Hive box "$boxName" recovery failed: $inner');
    }
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    debugPrint('FLUTTER ERROR CAUGHT: ${details.exceptionAsString()}');
  };

  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('CENTRALIZED ERROR CAUGHT: $error');
    return true;
  };

  try {
    await Hive.initFlutter();
    await Future.wait([
      _openHiveBoxSafely(_kGhostDevicesBox),
      _openHiveBoxSafely(kAppPrefsBoxName),
      _openHiveBoxSafely(kVaultSecretsBoxName),
    ]);
  } catch (e) {
    debugPrint('Hive storage bootstrap warning: $e');
  }

  try {
    await appSecretStore.init();
    if (Hive.isBoxOpen(_kGhostDevicesBox)) {
      await appSecretStore.migrateLegacyPairingKeys(Hive.box(_kGhostDevicesBox));
    }
    if (Hive.isBoxOpen(kVaultSecretsBoxName)) {
      await appSecretStore.migrateLegacyPairingKeys(
        Hive.box(kVaultSecretsBoxName),
      );
    }
    _migrateLegacySecretsIfNeeded();
  } catch (e) {
    debugPrint('SecureSecretStore bootstrap warning: $e');
  }

  runApp(const ProviderScope(child: AINetControllerApp()));
}

class AINetControllerApp extends ConsumerWidget {
  const AINetControllerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reducedMotion = ref.watch(
      appPreferencesProvider.select((p) => p.reducedMotion),
    );
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
            disableAnimations: reducedMotion || mq.disableAnimations,
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
  static const MethodChannel _deeplinkChannel =
      MethodChannel('com.cst.autonomouslan/deeplink');

  int _currentTabIndex = 0;
  final TextEditingController _commandController = TextEditingController();
  final TextEditingController _fleetSearchController = TextEditingController();
  final List<CommandLogItem> _commandLogs = [];
  String _fleetSearchQuery = '';
  bool _isScanning = false;
  bool _isPinging = false;

  @override
  void initState() {
    super.initState();
    if (Platform.isAndroid || Platform.isIOS) {
      try {
        unawaited(
          OsIntegrationsManager.instance
              .initialize(onAction: _handleQuickAction)
              .catchError((_) {}),
        );
      } catch (_) {}
      _initDeepLinkListener();
    }
  }

  void _initDeepLinkListener() {
    _deeplinkChannel.setMethodCallHandler((MethodCall call) async {
      if (call.method == 'onUri' && call.arguments is String) {
        await _handleIncomingPairingLink(call.arguments as String);
      }
      return null;
    });
    unawaited(
      _deeplinkChannel
          .invokeMethod<String>('getInitialUri')
          .then((uri) {
            if (uri != null && uri.trim().isNotEmpty) {
              unawaited(_handleIncomingPairingLink(uri));
            }
          })
          .catchError((_) {}),
    );
  }

  /// Parses both `ainet://pair?host=...&port=...&pin=...` and
  /// `http(s)://.../#pair_ip=...&pair_port=...&pair_pin=...` QR/pairing links.
  Future<bool> _handleIncomingPairingLink(String rawInput) async {
    final trimmed = rawInput.trim();
    if (trimmed.isEmpty) return false;
    try {
      final uri = Uri.tryParse(trimmed);
      if (uri == null) return false;
      final Map<String, String> params = <String, String>{
        ...uri.queryParameters,
      };
      if (uri.fragment.isNotEmpty) {
        try {
          params.addAll(Uri.splitQueryString(uri.fragment));
        } catch (_) {}
      }
      final String ip = (params['host'] ?? params['pair_ip'] ?? '').trim();
      if (!NetworkValidators.isValidIpOrHost(ip)) return false;
      final int port = int.tryParse(
            (params['port'] ?? params['pair_port'] ?? '8765').trim(),
          ) ??
          8765;
      final String pin = (params['pin'] ?? params['pair_pin'] ?? '').trim();
      final String token =
          (params['token'] ?? params['pair_token'] ?? '').trim();
      final String rawName =
          (params['name'] ?? params['pair_name'] ?? 'PC-$ip').trim();
      final String proto =
          (params['proto'] ?? params['pair_proto'] ?? '').trim().toLowerCase();
      String certFp = (params['fp'] ?? params['pair_fp'] ?? '').trim();
      final bool useTls = proto == 'wss' || certFp.isNotEmpty;

      String resolvedSecret = token;
      if (RegExp(r'^\d{6}$').hasMatch(pin)) {
        final exchanged = await _pairWithHostPin(
          ip,
          pin,
          port: port,
          useTls: useTls,
          certFingerprint: certFp.isNotEmpty ? certFp : null,
        );
        if (exchanged != null && exchanged.pairingToken.isNotEmpty) {
          resolvedSecret = exchanged.pairingToken;
          if (exchanged.certFingerprint != null &&
              exchanged.certFingerprint!.isNotEmpty) {
            certFp = exchanged.certFingerprint!;
          }
        }
      }

      if (resolvedSecret.isNotEmpty || certFp.isNotEmpty) {
        saveHostPairingSecret(ip, resolvedSecret, certFingerprint: certFp);
      }
      if (!mounted) return false;
      if (resolvedSecret.isNotEmpty &&
          ref.read(globalPairingSecretProvider).trim().isEmpty) {
        ref.read(globalPairingSecretProvider.notifier).state = resolvedSecret;
      }

      final cleanName = NetworkValidators.sanitizeLabel(
        rawName.isNotEmpty ? rawName : 'PC-$ip',
      );
      final hostId = 'PC-${ip.replaceAll('.', '-')}-$port';
      final existing =
          ref.read(fleetProvider).where((h) => h.ip == ip).firstOrNull;
      if (existing != null) {
        ref.read(fleetProvider.notifier).editHost(
              existing.id,
              name: cleanName,
              ip: ip,
              wsPort: port,
              mac: existing.mac,
              sharedSecret: resolvedSecret.isNotEmpty
                  ? resolvedSecret
                  : existing.sharedSecret,
              useTls: useTls || existing.useTls,
              certFingerprint:
                  certFp.isNotEmpty ? certFp : existing.certFingerprint,
            );
        ref.read(selectedHostIdProvider.notifier).state = existing.id;
      } else {
        final host = HostState(
          id: hostId,
          name: cleanName,
          ip: ip,
          wsPort: port,
          mac: '00:00:00:00:00:00',
          isOnline: resolvedSecret.isNotEmpty,
          sharedSecret: resolvedSecret,
          useTls: useTls,
          certFingerprint: certFp,
        );
        ref.read(fleetProvider.notifier).addHost(host);
        ref.read(selectedHostIdProvider.notifier).state = host.id;
      }
      _showToast(
        resolvedSecret.isNotEmpty
            ? 'Paired with $cleanName ($ip:$port)!'
            : 'Added $cleanName ($ip:$port) — enter 6-digit PIN to pair.',
        accentColor: resolvedSecret.isNotEmpty
            ? CyberColors.success
            : CyberColors.warning,
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  void _handleQuickAction(String action) {
    if (!mounted) return;
    switch (action) {
      case 'action_wake_pc':
        unawaited(_wakeAllOfflineHosts(ref.read(fleetProvider)));
        break;
      case 'action_scan_fleet':
        unawaited(_scanForPcs());
        break;
      case 'action_open_terminal':
        setState(() => _currentTabIndex = 1);
        break;
      case 'action_panic_kill':
        unawaited(_triggerPanicKillAll());
        break;
    }
  }

  Future<void> _triggerPanicKillAll() async {
    final hosts = ref.read(fleetProvider).where((h) => h.isOnline).toList();
    int triggered = 0;
    for (final host in hosts) {
      if (!mounted) break;
      try {
        final client = await _acquireConnectedClient(host);
        if (client != null) {
          client.retain();
          try {
            if (client.sendPanicKill()) triggered++;
          } finally {
            client.release();
          }
        }
      } catch (_) {}
    }
    HostConnectionPool.instance.disposeAll();
    _showToast(
      triggered > 0
          ? 'Emergency PANIC KILL sent to $triggered active workstation(s).'
          : 'All local remote sessions disconnected (Emergency Panic).',
      accentColor: _kDangerColor,
    );
  }

  @override
  void dispose() {
    if (Platform.isAndroid || Platform.isIOS) {
      _deeplinkChannel.setMethodCallHandler(null);
      OsIntegrationsManager.instance.clearQuickActionHandler(_handleQuickAction);
    }
    HostConnectionPool.instance.disposeAll();
    _commandController.dispose();
    _fleetSearchController.dispose();
    super.dispose();
  }

  void _hapticTap() {
    if (!ref.read(appPreferencesProvider).hapticsEnabled) return;
    unawaited(HapticFeedback.selectionClick().catchError((_) {}));
  }

  void _showToast(
    String message, {
    Color? accentColor,
    Duration duration = const Duration(seconds: 2),
  }) {
    if (!mounted) return;
    final palette = context.palette;
    final Color effectiveAccent = accentColor ?? palette.primary;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          backgroundColor: palette.isDaylight
              ? const Color(0xF5FFFFFF)
              : palette.surfaceElevated,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: BorderSide(
              color: effectiveAccent.withValues(alpha: 0.42),
            ),
          ),
          content: Text(
            message,
            style: TextStyle(
              color: palette.isDaylight
                  ? (accentColor == null ? palette.textPrimary : effectiveAccent)
                  : effectiveAccent,
              fontFamily: 'monospace',
              fontSize: 12,
              fontWeight: FontWeight.w600,
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
    final normalizedMac = NetworkValidators.normalizeMac(mac);
    if (NetworkValidators.parseMacBytes(mac) == null || normalizedMac == null) {
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
      await OsIntegrationsManager.instance.sendGratuitousArpAndWake(
        targetMac: normalizedMac,
        targetIp: targetIp?.trim() ?? '',
        routerIp: '',
      );

      if (!silent) {
        final subnetHint = (targetIp != null && targetIp.trim().isNotEmpty)
            ? ' & ${NetworkValidators.deriveBroadcastIp(targetIp)}'
            : '';
        _showToast(
          'WoL Magic Packet dispatched to $normalizedMac (255.255.255.255$subnetHint)',
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
    final Set<String> discoveredIps = <String>{};

    try {
      // Phase 1: Instant UDP LAN broadcast discovery (CST_DISCOVER_V1)
      try {
        final udpHosts = await LanDiscoveryService.discover(
          timeout: const Duration(milliseconds: 1100),
        );
        if (!mounted) return;
        for (final host in udpHosts) {
          if (!NetworkValidators.isValidIpOrHost(host.ip)) continue;
          if (!discoveredIps.add(host.ip)) continue;
          final measuredMs = await _measureTcpLatency(host.ip, host.wsPort);
          final safeName = NetworkValidators.sanitizeLabel(
            host.hostname.trim().isNotEmpty
                ? host.hostname
                : 'Host PC (${host.ip})',
          );
          final hostId = 'PC-${host.ip.replaceAll('.', '-')}-${host.wsPort}';
          foundPcs.add(
            HostState(
              id: hostId,
              name: safeName,
              ip: host.ip,
              wsPort: host.wsPort,
              mac: '00:00:00:00:00:00',
              isOnline: true,
              osName: host.os,
              useTls: host.useTls,
              certFingerprint: loadHostCertFingerprint(host.ip),
              latencyMs: measuredMs ?? 1,
            ),
          );
        }
      } catch (e) {
        debugPrint('UDP discovery notice: $e');
      }

      // Phase 2: Directed TCP/WebSocket subnet scan fallback for networks blocking UDP broadcast
      final Set<String> candidateIps = {
        for (final h in ref.read(fleetProvider))
          if (NetworkValidators.isValidIpOrHost(h.ip)) h.ip,
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
              final int o0 = int.tryParse(parts[0]) ?? 0;
              final int o1 = int.tryParse(parts[1]) ?? 0;
              final bool isRfc1918 = o0 == 10 ||
                  (o0 == 192 && o1 == 168) ||
                  (o0 == 172 && o1 >= 16 && o1 <= 31);
              if (!isRfc1918) continue;
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

      candidateIps.removeAll(discoveredIps);
      final ipList = candidateIps.toList(growable: false);
      const chunkSize = 40;
      for (int i = 0; i < ipList.length; i += chunkSize) {
        if (!mounted) return;
        final end =
            (i + chunkSize > ipList.length) ? ipList.length : i + chunkSize;
        final chunk = ipList.sublist(i, end);
        await Future.wait(
          chunk.map((ip) async {
            if (ip != '127.0.0.1' && ip != '10.0.2.2') {
              Socket? preflight;
              try {
                preflight = await Socket.connect(
                  ip,
                  scanPort,
                  timeout: const Duration(milliseconds: 180),
                );
                preflight.destroy();
              } catch (_) {
                return; // Skip unreachable IPs before WebSocket handshake
              }
            }

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
            final hostId = 'PC-${ip.replaceAll('.', '-')}-$scanPort';

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
    if (effectiveSecret.isEmpty) {
      _showToast(
        'Enter the 6-digit PIN from ${host.name} to pair & view its screen.',
        accentColor: CyberColors.warning,
      );
      unawaited(_showHostEditorDialog(existing: host));
      return;
    }
    final effectiveFp = host.certFingerprint.trim().isNotEmpty
        ? host.certFingerprint.trim()
        : loadHostCertFingerprint(host.ip);
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => FullscreenStreamPage(
          hostIp: host.ip,
          hostName: host.name,
          wsPort: host.wsPort,
          sharedSecret: effectiveSecret,
          useTls: host.useTls || prefs.preferTls,
          certFingerprint: effectiveFp.isNotEmpty ? effectiveFp : null,
          targetFps: prefs.targetFps,
          keepScreenAwake: prefs.keepScreenAwake,
          initialInputMode: prefs.defaultInputMode,
          autoLandscape: prefs.fullscreenAutoLandscape,
          touchVisualFeedback: prefs.touchVisualFeedback,
          hapticsEnabled: prefs.hapticsEnabled,
          qualityPreset: prefs.streamQualityPreset,
          trackpadSensitivity: prefs.trackpadSensitivity,
          onQualityPresetChanged: (preset) => ref
              .read(appPreferencesProvider.notifier)
              .setStreamQualityPreset(preset),
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
            final dlgPalette = ctx.palette;
            final primary = dlgPalette.primary;
            return AlertDialog(
              insetPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              backgroundColor: dlgPalette.surfaceElevated,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(color: dlgPalette.dividerColor),
              ),
              title: Text(
                existing == null ? 'Add Workstation' : 'Edit Workstation',
                style: TextStyle(
                  color: dlgPalette.textPrimary,
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
                      style: TextStyle(color: dlgPalette.textPrimary, fontSize: 13),
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
                            style: TextStyle(
                              color: dlgPalette.textPrimary,
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
                            style: TextStyle(
                              color: dlgPalette.textPrimary,
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
                      style: TextStyle(
                        color: dlgPalette.textPrimary,
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
                      obscureText: secretCtrl.text.trim().length > 6 &&
                          !RegExp(r'^\d+$').hasMatch(secretCtrl.text.trim()),
                      onChanged: (_) => setDialogState(() {}),
                      style: TextStyle(
                        color: dlgPalette.textPrimary,
                        fontSize: 13,
                        fontFamily: 'monospace',
                      ),
                      decoration: const InputDecoration(
                        labelText: '6-Digit PIN or Pairing Token',
                        hintText: 'e.g. 482910 or ainet_...',
                      ),
                    ),
                    const SizedBox(height: 6),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          padding: EdgeInsets.zero,
                        ),
                        icon: Icon(Icons.qr_code_2_rounded,
                            size: 16, color: primary),
                        label: Text(
                          'Paste Pairing Link from Clipboard',
                          style: TextStyle(color: primary, fontSize: 11.5),
                        ),
                        onPressed: isSaving
                            ? null
                            : () async {
                                final nav = Navigator.of(ctx);
                                final clip =
                                    await Clipboard.getData('text/plain');
                                final txt = clip?.text?.trim() ?? '';
                                if (txt.isEmpty || !mounted) return;
                                final ok =
                                    await _handleIncomingPairingLink(txt);
                                if (ok && nav.mounted) {
                                  nav.pop();
                                } else if (ctx.mounted) {
                                  setDialogState(() {
                                    validationError =
                                        'Clipboard does not contain a valid ainet://pair or #pair_ip= link.';
                                  });
                                }
                              },
                      ),
                    ),
                    SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      activeThumbColor: primary,
                      activeTrackColor: primary.withValues(alpha: 0.45),
                      title: Text(
                        'Require WSS TLS',
                        style: TextStyle(
                          color: dlgPalette.textSecondary,
                          fontSize: 12,
                        ),
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
                  child: Text(
                    'Cancel',
                    style: TextStyle(color: dlgPalette.textSecondary),
                  ),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: primary,
                    foregroundColor: dlgPalette.isDaylight
                        ? Colors.white
                        : const Color(0xFF090B1D),
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
                              if (ctx.mounted) {
                                setDialogState(() {
                                  isSaving = false;
                                  validationError =
                                      'PIN pairing failed — verify the 6-digit PIN shown on the PC Agent ($ip:$parsedPort).';
                                });
                              }
                              return;
                            }
                          }

                          if (secret.isNotEmpty || certFp.isNotEmpty) {
                            saveHostPairingSecret(
                              ip,
                              secret,
                              certFingerprint: certFp,
                            );
                          }
                          if (!mounted) return;
                          if (secret.isNotEmpty &&
                              ref.read(globalPairingSecretProvider).trim().isEmpty) {
                            ref
                                .read(globalPairingSecretProvider.notifier)
                                .state = secret;
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
                            final id = 'PC-${ip.replaceAll('.', '-')}-$parsedPort';
                            final host = HostState(
                              id: id,
                              name: name,
                              ip: ip,
                              wsPort: parsedPort!,
                              mac: normalizedMac,
                              isOnline: secret.isNotEmpty,
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

  Future<HostConnectionClient?> _acquireConnectedClient(HostState host) async {
    final prefs = ref.read(appPreferencesProvider);
    final secret = _resolveSecretForHost(host);
    if (secret.isEmpty) {
      _showToast(
        'Pairing secret required before connecting to ${host.name}.',
        accentColor: CyberColors.warning,
      );
      return null;
    }
    final resolvedFp = host.certFingerprint.trim().isNotEmpty
        ? host.certFingerprint.trim()
        : loadHostCertFingerprint(host.ip);
    final client = HostConnectionPool.instance.acquire(
      hostIp: host.ip,
      port: host.wsPort,
      sharedSecret: secret,
      useTls: host.useTls || prefs.preferTls,
      certFingerprint: resolvedFp.isNotEmpty ? resolvedFp : null,
    );
    await client.ensureConnected(timeout: const Duration(seconds: 7));
    return client;
  }

  Future<void> _showHostClipboardActions(HostState host) async {
    final palette = context.palette;
    final primary = palette.primary;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: palette.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: Icon(Icons.upload_rounded, color: primary),
                title: const Text('Push Phone Clipboard to PC'),
                onTap: () async {
                  Navigator.of(ctx).pop();
                  try {
                    final data = await Clipboard.getData('text/plain');
                    final txt = data?.text ?? '';
                    if (txt.isEmpty) {
                      _showToast('Phone clipboard is empty.',
                          accentColor: CyberColors.warning);
                      return;
                    }
                    if (!mounted) return;
                    final client = await _acquireConnectedClient(host);
                    if (client == null) return;
                    client.retain();
                    try {
                      client.sendClipboard(txt);
                    } finally {
                      client.release();
                    }
                    _showToast(
                      'Pushed ${txt.length} clipboard characters to ${host.name}.',
                    );
                  } catch (e) {
                    _showToast('Clipboard push failed: $e',
                        accentColor: _kDangerColor);
                  }
                },
              ),
              ListTile(
                leading: Icon(Icons.download_rounded, color: primary),
                title: const Text('Pull PC Clipboard to Phone'),
                onTap: () async {
                  Navigator.of(ctx).pop();
                  if (!mounted) return;
                  try {
                    final client = await _acquireConnectedClient(host);
                    if (client == null) return;
                    client.retain();
                    try {
                      final nextClip = client.clipboardStream.first
                          .timeout(const Duration(seconds: 5));
                      client.requestClipboard();
                      final text = await nextClip;
                      await Clipboard.setData(ClipboardData(text: text));
                      _showToast(
                        text.isEmpty
                            ? 'PC clipboard is empty.'
                            : 'Copied ${text.length} chars from ${host.name}.',
                      );
                    } finally {
                      client.release();
                    }
                  } catch (e) {
                    _showToast('Clipboard pull failed: $e',
                        accentColor: _kDangerColor);
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showHostAudioActions(HostState host) async {
    final palette = context.palette;
    final primary = palette.primary;
    HostConnectionClient? client;
    try {
      client = await _acquireConnectedClient(host);
    } catch (e) {
      _showToast('Failed to connect to ${host.name}: $e',
          accentColor: _kDangerColor);
    }
    if (client == null) return;
    if (!mounted) {
      client.retain();
      client.release();
      return;
    }
    final activeClient = client..retain();
    try {
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: palette.surfaceElevated,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        builder: (ctx) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
            child: Wrap(
              spacing: 10,
              runSpacing: 10,
              alignment: WrapAlignment.center,
              children: [
                ActionChip(
                  avatar: const Icon(Icons.skip_previous_rounded, size: 18),
                  label: const Text('Prev'),
                  onPressed: () => activeClient.sendAudioCommand('prev'),
                ),
                ActionChip(
                  avatar: Icon(Icons.play_arrow_rounded,
                      size: 18, color: primary),
                  label: const Text('Play/Pause'),
                  onPressed: () => activeClient.sendAudioCommand('play_pause'),
                ),
                ActionChip(
                  avatar: const Icon(Icons.skip_next_rounded, size: 18),
                  label: const Text('Next'),
                  onPressed: () => activeClient.sendAudioCommand('next'),
                ),
                ActionChip(
                  avatar: const Icon(Icons.volume_down_rounded, size: 18),
                  label: const Text('Vol -'),
                  onPressed: () => activeClient.sendAudioCommand('volume_down'),
                ),
                ActionChip(
                  avatar: const Icon(Icons.volume_off_rounded, size: 18),
                  label: const Text('Mute'),
                  onPressed: () => activeClient.sendAudioCommand('mute'),
                ),
                ActionChip(
                  avatar: const Icon(Icons.volume_up_rounded, size: 18),
                  label: const Text('Vol +'),
                  onPressed: () => activeClient.sendAudioCommand('volume_up'),
                ),
                ActionChip(
                  avatar: const Icon(Icons.lock_rounded,
                      size: 18, color: _kDangerColor),
                  label: const Text('Lock PC'),
                  onPressed: () {
                    Navigator.of(ctx).pop();
                    activeClient.sendAudioCommand('lock_pc');
                    _showToast('Sent lock_pc command to ${host.name}.',
                        accentColor: CyberColors.warning);
                  },
                ),
              ],
            ),
          ),
        ),
      );
    } finally {
      activeClient.release();
    }
  }

  Future<void> _showSendFileToHostDialog(HostState host) async {
    final pathCtrl = TextEditingController();
    final noteNameCtrl = TextEditingController(text: 'mobile_note.txt');
    final noteBodyCtrl = TextEditingController();

    final submitted = await showDialog<bool>(
          context: context,
          builder: (ctx) {
            final dlgPalette = ctx.palette;
            return AlertDialog(
              backgroundColor: dlgPalette.surfaceElevated,
              title: Text('Send Encrypted File -> ${host.name}'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: pathCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Local File Path (optional)',
                        hintText: '/storage/emulated/0/Download/file.bin',
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Or send a text note payload directly:',
                      style: TextStyle(
                        fontSize: 11,
                        color: dlgPalette.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: noteNameCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Target Filename',
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: noteBodyCtrl,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: 'Quick Text Content',
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(false),
                  child: const Text('Cancel'),
                ),
                ElevatedButton(
                  onPressed: () => Navigator.of(ctx).pop(true),
                  child: const Text('Send AEAD'),
                ),
              ],
            );
          },
        ) ??
        false;

    final filePath = pathCtrl.text.trim();
    final noteName = noteNameCtrl.text.trim().isNotEmpty
        ? noteNameCtrl.text.trim()
        : 'mobile_note.txt';
    final noteBody = noteBodyCtrl.text;
    Future<void>.delayed(const Duration(milliseconds: 300), () {
      pathCtrl.dispose();
      noteNameCtrl.dispose();
      noteBodyCtrl.dispose();
    });

    if (!submitted || !mounted) return;
    if (filePath.isEmpty && noteBody.isEmpty) {
      _showToast('Enter a file path or text content to transfer.',
          accentColor: CyberColors.warning);
      return;
    }

    File? tempFile;
    File targetFile;
    HostConnectionClient? client;
    ValueNotifier<TransferProgress>? activeProgressNotifier;
    bool dialogDisposed = false;
    try {
      if (filePath.isNotEmpty) {
        targetFile = File(filePath);
        if (!await targetFile.exists()) {
          _showToast('File not found: $filePath', accentColor: _kDangerColor);
          return;
        }
      } else {
        String safeName = NetworkValidators.sanitizeLabel(noteName)
            .replaceAll(RegExp(r'[^a-zA-Z0-9._-]'), '_');
        if (safeName.isEmpty || safeName == '.' || safeName == '..') {
          safeName = 'mobile_note.txt';
        }
        tempFile = File(
            '${Directory.systemTemp.path}${Platform.pathSeparator}$safeName');
        await tempFile.writeAsString(noteBody, flush: true);
        targetFile = tempFile;
      }

      if (!mounted) return;
      client = await _acquireConnectedClient(host);
      if (client == null) return;
      client.retain();
      if (!mounted) return;

      final fileLen = await targetFile.length();
      if (!mounted) return;
      final engine = FileTransferEngine();
      final progressNotifier = ValueNotifier<TransferProgress>(
        TransferProgress(
          transferId: 0,
          filename: targetFile.uri.pathSegments.last,
          totalBytes: fileLen,
          bytesSent: 0,
          speedBytesPerSec: 0,
          eta: Duration.zero,
          state: TransferState.hashing,
        ),
      );
      activeProgressNotifier = progressNotifier;

      unawaited(
        showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (dlgCtx) => ValueListenableBuilder<TransferProgress>(
            valueListenable: progressNotifier,
            builder: (_, prog, _) {
              return FileTransferProgressDialog(
                progress: prog,
                onCancel: () {
                  if (prog.state == TransferState.completed ||
                      prog.state == TransferState.failed ||
                      prog.state == TransferState.cancelled) {
                    Navigator.of(dlgCtx).pop();
                  } else {
                    engine.cancel();
                    Navigator.of(dlgCtx).pop();
                  }
                },
              );
            },
          ),
        ).whenComplete(() {
          dialogDisposed = true;
          progressNotifier.dispose();
        }),
      );

      final activeClient = client;
      await for (final progress in engine.sendFile(
        file: targetFile,
        sendPacket: activeClient.sendRawEncryptedPacket,
        ackStream: activeClient.fileAckStream,
        packetBuilder: (opcode, payload) =>
            activeClient.encryptFrame(opcode, payload),
      )) {
        if (!dialogDisposed) {
          progressNotifier.value = progress;
        }
        if (progress.state == TransferState.completed) {
          _showToast('Encrypted transfer complete: ${progress.filename}');
          break;
        }
        if (progress.state == TransferState.failed) {
          _showToast(
            progress.errorMessage ?? 'Encrypted file transfer failed',
            accentColor: _kDangerColor,
          );
          break;
        }
      }
    } catch (e) {
      if (activeProgressNotifier != null && !dialogDisposed) {
        final prev = activeProgressNotifier.value;
        activeProgressNotifier.value = TransferProgress(
          transferId: prev.transferId,
          filename: prev.filename,
          totalBytes: prev.totalBytes,
          bytesSent: prev.bytesSent,
          speedBytesPerSec: 0,
          eta: Duration.zero,
          state: TransferState.failed,
          errorMessage: e.toString(),
        );
      }
      _showToast('File transfer error: $e', accentColor: _kDangerColor);
    } finally {
      client?.release();
      if (tempFile != null && await tempFile.exists()) {
        unawaited(tempFile.delete().catchError((_) => tempFile!));
      }
    }
  }

  Future<void> _showHostActionsSheet(HostState host) async {
    _hapticTap();
    final palette = context.palette;
    final hasValidMac = NetworkValidators.normalizeMac(host.mac) != null;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: palette.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        final sheetPalette = ctx.palette;
        final primary = sheetPalette.primary;
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
                    color: sheetPalette.textTertiary.withValues(alpha: 0.35),
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
                          host.isOnline ? sheetPalette.success : primary,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            host.name,
                            style: TextStyle(
                              color: sheetPalette.textPrimary,
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                            ),
                          ),
                          Text(
                            '${host.ip}:${host.wsPort}${host.latencyMs != null ? ' • ${host.latencyMs}ms' : ''}',
                            style: TextStyle(
                              color: sheetPalette.textSecondary,
                              fontFamily: 'monospace',
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                Divider(height: 20, color: sheetPalette.dividerColor),
                Flexible(
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ListTile(
                          leading:
                              Icon(Icons.cast_connected_rounded, color: primary),
                          title: const Text('Open Live Stream'),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            ref.read(selectedHostIdProvider.notifier).state =
                                host.id;
                            _openStreamScreen(host);
                          },
                        ),
                        ListTile(
                          leading: Icon(Icons.terminal_rounded, color: primary),
                          title: const Text('Open Terminal Session'),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            ref.read(selectedHostIdProvider.notifier).state =
                                host.id;
                            setState(() => _currentTabIndex = 1);
                          },
                        ),
                        ListTile(
                          leading: Icon(
                            Icons.content_paste_go_rounded,
                            color: sheetPalette.textSecondary,
                          ),
                          title: const Text('Sync Clipboard with PC'),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            _showHostClipboardActions(host);
                          },
                        ),
                        ListTile(
                          leading: Icon(
                            Icons.tune_rounded,
                            color: sheetPalette.textSecondary,
                          ),
                          title: const Text('Remote Audio & Lock PC'),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            _showHostAudioActions(host);
                          },
                        ),
                        ListTile(
                          leading: Icon(
                            Icons.upload_file_rounded,
                            color: primary,
                          ),
                          title: const Text('Send File to PC (AEAD 0x0C)'),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            _showSendFileToHostDialog(host);
                          },
                        ),
                        ListTile(
                          leading: Icon(
                            Icons.network_ping_rounded,
                            color: sheetPalette.success,
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
                                ? sheetPalette.warning
                                : sheetPalette.textTertiary,
                          ),
                          title: const Text('Send Wake-on-LAN Packet'),
                          subtitle: hasValidMac
                              ? Text(host.mac,
                                  style: const TextStyle(fontSize: 11))
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
                          leading: Icon(Icons.copy_rounded,
                              color: sheetPalette.textSecondary),
                          title: const Text('Copy IP Address'),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            Clipboard.setData(ClipboardData(text: host.ip));
                            _showToast('Copied ${host.ip} to clipboard');
                          },
                        ),
                        ListTile(
                          leading: Icon(Icons.edit_rounded,
                              color: sheetPalette.textSecondary),
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
            insetPadding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            scrollable: true,
            backgroundColor: ctx.palette.surfaceElevated,
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
            final dlgPalette = ctx.palette;
            return AlertDialog(
              insetPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              scrollable: true,
              backgroundColor: dlgPalette.surfaceElevated,
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
                    style: TextStyle(
                      color: dlgPalette.warning,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: dlgPalette.terminalBackground,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: dlgPalette.dividerColor),
                    ),
                    child: Text(
                      command,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 11.5,
                        color: dlgPalette.terminalText,
                      ),
                    ),
                  ),
                  if (biometricArmed) ...[
                    const SizedBox(height: 10),
                    Text(
                      'Device Biometric HITL guard is armed — confirm only if you intended this action.',
                      style: TextStyle(
                        color: dlgPalette.textSecondary,
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
    if (!approved) return false;
    if (biometricArmed) {
      final gateRes = await BiometricSecurityGate.instance.verifyApproval(
        commandId: 'local-${DateTime.now().millisecondsSinceEpoch}',
        shellCommand: command,
        targetHostId: 'mobile-operator',
        riskLevel: 'HIGH',
      );
      return gateRes.isApproved;
    }
    return true;
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
    final initialLog = CommandLogItem(
      timestamp: timeStr,
      hostName: targetLabel,
      command: trimmed,
      status: targetHost == null
          ? 'Select a PC workstation in Fleet before dispatching commands.'
          : 'Authenticating via AI-NET/3.0-SECURE WebSocket (${targetHost.ip}:${targetHost.wsPort})...',
      isError: targetHost == null,
    );
    final int logId = initialLog.id;

    void updateLatestStatus(String status, {bool isError = false}) {
      if (!mounted) return;
      setState(() {
        final idx = _commandLogs.indexWhere((e) => e.id == logId);
        final updated = CommandLogItem(
          id: logId,
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
          if (_commandLogs.length > 100) {
            _commandLogs.removeRange(100, _commandLogs.length);
          }
        }
      });
    }

    setState(() {
      _commandLogs.insert(0, initialLog);
      if (_commandLogs.length > 100) {
        _commandLogs.removeRange(100, _commandLogs.length);
      }
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

    HostConnectionClient? retainedClient;
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
      )..retain();
      retainedClient = client;

      final lowerCmd = trimmed.toLowerCase();
      if (lowerCmd.startsWith('ai:') || lowerCmd.startsWith('ollama:')) {
        final prompt = trimmed.substring(trimmed.indexOf(':') + 1).trim();
        if (prompt.isEmpty) {
          updateLatestStatus('Provide a prompt after ai: or ollama:.',
              isError: true);
          return;
        }
        await client.ensureConnected(timeout: const Duration(seconds: 7));
        final buf = StringBuffer();
        final done = Completer<void>();
        Timer? idleTimer;
        void resetIdle(Duration wait) {
          idleTimer?.cancel();
          idleTimer = Timer(wait, () {
            if (!done.isCompleted) done.complete();
          });
        }

        bool hadError = false;
        final sub = client.llmTokenStream.listen((token) {
          if (token.trimLeft().startsWith('{')) {
            try {
              final parsed = jsonDecode(token);
              if (parsed is Map) {
                if (parsed['done'] == true) {
                  if (!done.isCompleted) done.complete();
                  return;
                }
                if (parsed['error'] != null) {
                  hadError = true;
                  final prefix = buf.isEmpty ? '' : '[Ollama Stream]\n${buf.toString()}\n\n';
                  updateLatestStatus(
                    '${prefix}Ollama Error: ${parsed['error']}',
                    isError: true,
                  );
                  if (!done.isCompleted) done.complete();
                  return;
                }
              }
            } catch (_) {}
          }
          buf.write(token);
          updateLatestStatus('[Ollama Stream]\n${buf.toString()}');
          resetIdle(const Duration(seconds: 3));
        });

        try {
          if (!client.sendOllamaPrompt(prompt)) {
            updateLatestStatus('Unable to dispatch encrypted Ollama prompt.',
                isError: true);
            return;
          }
          updateLatestStatus('[Ollama Stream] Awaiting host AI tokens...');
          resetIdle(const Duration(seconds: 12));
          await done.future;
          if (buf.isEmpty && !hadError) {
            updateLatestStatus(
              'No response from host Ollama bridge within 12s.',
              isError: true,
            );
          }
        } finally {
          idleTimer?.cancel();
          await sub.cancel();
        }
        return;
      }

      final res = await client.executeCommand(
        trimmed,
        timeout: const Duration(seconds: 45),
      );
      final out = res.output.trim();
      final failed = res.exitCode != 0 || res.status == 'error' || res.status == 'timeout';
      updateLatestStatus(
        '[${res.status} • exit ${res.exitCode}] ${out.isNotEmpty ? out : "(no output)"}',
        isError: failed,
      );
    } catch (e) {
      updateLatestStatus('Dispatch error: $e', isError: true);
    } finally {
      retainedClient?.release();
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

    final isDaylight = ref.watch(
      appPreferencesProvider.select((p) => p.themeMode == AppThemeMode.daylight),
    );

    return AdaptiveScaffold(
      title: 'AI NetController',
      navItems: navDestinations,
      selectedIndex: _currentTabIndex,
      onIndexChanged: (idx) => setState(() => _currentTabIndex = idx),
      actions: [
        IconButton(
          tooltip: isDaylight
              ? 'Switch to Vibrant Dark Glass'
              : 'Switch to Bright Daylight Glass',
          icon: Icon(
            isDaylight ? Icons.wb_sunny_rounded : Icons.nightlight_round,
            color: isDaylight ? const Color(0xFFF59E0B) : primary,
            size: 21,
          ),
          onPressed: () {
            _hapticTap();
            ref.read(appPreferencesProvider.notifier).toggleThemeMode();
          },
        ),
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
    final hasCompletedOnboarding = ref.watch(
      appPreferencesProvider.select((p) => p.hasCompletedOnboarding),
    );
    if (hasCompletedOnboarding) return const SizedBox.shrink();
    final palette = context.palette;
    final primary = palette.primary;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 10),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            primary.withValues(alpha: 0.16),
            palette.surfaceElevated.withValues(alpha: 0.88),
          ],
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: primary.withValues(alpha: 0.38)),
        boxShadow: [
          BoxShadow(
            color: primary.withValues(alpha: 0.14),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FluidSpecularBar(
            isSelected: true,
            height: 1.0,
            margin: EdgeInsets.only(left: 6, right: 6, bottom: 6),
          ),
          Row(
            children: [
              Icon(Icons.auto_awesome_rounded, color: primary, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'New to AI NetController?',
                  style: TextStyle(
                    color: palette.textPrimary,
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
                icon: Icon(
                  Icons.close_rounded,
                  size: 16,
                  color: palette.textSecondary,
                ),
                onPressed: () => ref
                    .read(appPreferencesProvider.notifier)
                    .setOnboardingCompleted(true),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            'Gestures, Wake-on-LAN & PIN pairing tips.',
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFleetToolbar(List<HostState> hosts) {
    final palette = context.palette;
    final primary = palette.primary;
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
                      icon: Icon(
                        Icons.bolt_rounded,
                        size: 15,
                        color: palette.warning,
                      ),
                      label: Text(
                        'Wake All',
                        style: TextStyle(
                          color: palette.warning,
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
            style: TextStyle(color: palette.terminalText, fontSize: 12.5),
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
              hintStyle: TextStyle(
                color: palette.textTertiary,
                fontSize: 12,
              ),
              filled: true,
              fillColor: palette.terminalBackground,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(color: palette.glassBorderIdle),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(color: palette.glassBorderIdle),
              ),
            ),
          ),
        ],
        const SizedBox(height: 8),
      ],
    );
  }

  Widget _buildEmptyFleetState() {
    final palette = context.palette;
    final primary = palette.primary;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 16),
      padding: const EdgeInsets.fromLTRB(24, 14, 24, 24),
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: false),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: palette.glassBorderIdle),
        boxShadow: palette.elevationShadows(isSelected: false),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const FluidSpecularBar(
            isSelected: true,
            height: 1.0,
            margin: EdgeInsets.only(left: 12, right: 12, bottom: 14),
          ),
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  primary.withValues(alpha: 0.24),
                  primary.withValues(alpha: 0.06),
                ],
              ),
              border: Border.all(color: primary.withValues(alpha: 0.38)),
              boxShadow: [
                BoxShadow(
                  color: primary.withValues(alpha: 0.22),
                  blurRadius: 16,
                ),
              ],
            ),
            child: Icon(Icons.devices_rounded, color: primary, size: 24),
          ),
          const SizedBox(height: 14),
          Text(
            'No Workstations Found',
            style: TextStyle(
              color: palette.textPrimary,
              fontSize: 15,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Scan your Wi-Fi network to detect active PCs running the AI NetController host daemon, or manually register an IP address.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: palette.textSecondary,
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
                  foregroundColor: palette.isDaylight
                      ? Colors.white
                      : const Color(0xFF090B1D),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                ),
                icon: _isScanning
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: palette.isDaylight
                              ? Colors.white
                              : const Color(0xFF090B1D),
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
                  foregroundColor: palette.textPrimary,
                  side: BorderSide(color: palette.dividerColor, width: 1.2),
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
      useTls: host.useTls,
      onTap: () {
        ref.read(selectedHostIdProvider.notifier).state = host.id;
        if (host.isOnline) _openStreamScreen(host);
      },
      onWakeOnLan: () => _sendWakeOnLan(host.mac, targetIp: host.ip),
      onOpenStream: () => _openStreamScreen(host),
      onOpenFullscreen: () => _openStreamScreen(host),
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
        padding: FluidSize.pagePadding(context),
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
    final pad = FluidSize.pagePadding(context);
    if (hosts.isEmpty) {
      return ListView(
        padding: pad,
        children: [
          _buildOnboardingBanner(),
          _buildFleetToolbar(hosts),
          _buildEmptyFleetState(),
        ],
      );
    }

    return Padding(
      padding: pad,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final cols = constraints.maxWidth < 460 ? 1 : 2;
          final extent =
              (206.0 * FluidSize.getScaleFactor(context).clamp(0.92, 1.18))
                  .roundToDouble();
          return CustomScrollView(
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
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: cols,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                    mainAxisExtent: extent,
                  ),
                  delegate: SliverChildBuilderDelegate(
                    (context, index) => _buildDeviceCardFor(filtered[index]),
                    childCount: filtered.length,
                  ),
                ),
            ],
          );
        },
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
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
              useTls: host.useTls,
              onTap: () {
                ref.read(selectedHostIdProvider.notifier).state = host.id;
              },
              onWakeOnLan: () => _sendWakeOnLan(host.mac, targetIp: host.ip),
              onOpenStream: () => _openStreamScreen(host),
              onOpenFullscreen: () => _openStreamScreen(host),
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
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: _buildEmptyFleetState(),
        ),
      );
    }

    final (
      preferTls,
      targetFps,
      keepScreenAwake,
      defaultInputMode,
      touchVisualFeedback,
      hapticsEnabled,
      streamQualityPreset,
      trackpadSensitivity,
    ) = ref.watch(
      appPreferencesProvider.select(
        (p) => (
          p.preferTls,
          p.targetFps,
          p.keepScreenAwake,
          p.defaultInputMode,
          p.touchVisualFeedback,
          p.hapticsEnabled,
          p.streamQualityPreset,
          p.trackpadSensitivity,
        ),
      ),
    );
    final palette = context.palette;
    return LayoutBuilder(
      key: ValueKey<String>(host.id),
      builder: (context, constraints) {
        final availH = constraints.maxHeight;
        final isShortPane = availH.isFinite && availH < 480;
        final maxPreviewH = availH.isFinite
            ? (availH * (isShortPane ? 0.40 : 0.48)).clamp(96.0, 420.0)
            : 360.0;
        final pad = isShortPane ? 10.0 : 16.0;

        final previewWidget = ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxPreviewH),
          child: Align(
            alignment: Alignment.topCenter,
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: host.isOnline
                  ? ViewportStreamWidget(
                      key: ValueKey('online-${host.id}'),
                      hostIp: host.ip,
                      hostName: host.name,
                      wsPort: host.wsPort,
                      isInline: true,
                      sharedSecret: _resolveSecretForHost(host),
                      useTls: host.useTls || preferTls,
                      certFingerprint: host.certFingerprint.trim().isNotEmpty
                          ? host.certFingerprint.trim()
                          : loadHostCertFingerprint(host.ip),
                      targetFps: targetFps,
                      keepScreenAwake: keepScreenAwake,
                      initialInputMode: defaultInputMode,
                      touchVisualFeedback: touchVisualFeedback,
                      hapticsEnabled: hapticsEnabled,
                      qualityPreset: streamQualityPreset,
                      trackpadSensitivity: trackpadSensitivity,
                      onQualityPresetChanged: (preset) => ref
                          .read(appPreferencesProvider.notifier)
                          .setStreamQualityPreset(preset),
                      onTelemetry: (data) => ref
                          .read(fleetProvider.notifier)
                          .updateTelemetryByIp(host.ip, data),
                      onToggleFullscreen: () => _openStreamScreen(host),
                    )
                  : Container(
                      key: ValueKey('offline-${host.id}'),
                      decoration: BoxDecoration(
                        gradient: palette.cardBevelGradient(isSelected: false),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: palette.glassBorderIdle),
                      ),
                      child: Center(
                        child: SingleChildScrollView(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.power_settings_new_rounded,
                                size: isShortPane ? 28 : 40,
                                color: palette.textTertiary,
                              ),
                              SizedBox(height: isShortPane ? 6 : 12),
                              Text(
                                '${host.name} is currently in S3/S5 Sleep State',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: palette.textSecondary,
                                ),
                              ),
                              SizedBox(height: isShortPane ? 8 : 12),
                              ElevatedButton.icon(
                                icon: Icon(
                                  Icons.bolt_rounded,
                                  color: palette.isDaylight
                                      ? Colors.white
                                      : Colors.black,
                                ),
                                label: const Text('WAKE ON LAN (WoL)'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: palette.warning,
                                  foregroundColor: palette.isDaylight
                                      ? Colors.white
                                      : Colors.black,
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
          ),
        );

        return Padding(
          padding: EdgeInsets.all(pad),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 240),
                switchInCurve: Curves.easeOutCubic,
                child: previewWidget,
              ),
              SizedBox(height: isShortPane ? 10 : 16),
              Expanded(
                child: _buildTerminalCommandsTab(host, isEmbedded: true),
              ),
            ],
          ),
        );
      },
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
    final palette = context.palette;
    final primary = palette.primary;
    final terminalHistory = ref.watch(
      appPreferencesProvider.select((p) => p.terminalHistory),
    );
    final commands = const [
      'Get-Process | Sort-Object CPU -Descending | Select -First 8',
      'ipconfig /all',
      'Get-Service | Where-Object Status -eq "Running"',
      'systeminfo',
      'nvidia-smi',
    ];

    final targetHeader = host != null
        ? 'Command Console · ${host.name} (${host.ip})'
        : 'Command Console · Select or Add a Host';

    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: isEmbedded ? EdgeInsets.zero : FluidSize.pagePadding(context),
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 8,
          runSpacing: 6,
          children: [
            _buildSectionHeader(targetHeader),
            if (!isEmbedded && hosts.length > 1 && host != null)
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 180),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: host.id,
                    isExpanded: true,
                    isDense: true,
                    dropdownColor: palette.surfaceElevated,
                    style: TextStyle(
                      color: primary,
                      fontFamily: 'monospace',
                      fontWeight: FontWeight.w700,
                      fontSize: 11.5,
                    ),
                    items: hosts
                        .map(
                          (h) => DropdownMenuItem<String>(
                            value: h.id,
                            child: Text(
                              h.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (nextId) {
                      if (nextId != null) {
                        ref.read(selectedHostIdProvider.notifier).state =
                            nextId;
                      }
                    },
                  ),
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
                style: TextStyle(
                  color: palette.terminalText,
                  fontFamily: 'monospace',
                  fontSize: 12.5,
                ),
                decoration: InputDecoration(
                  hintText: 'Enter PowerShell or Bash command...',
                  hintStyle: TextStyle(
                    color: palette.textSecondary,
                    fontFamily: 'monospace',
                    fontSize: 12,
                  ),
                  filled: true,
                  fillColor: palette.terminalBackground,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 13,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide(color: palette.glassBorderIdle),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide(color: palette.glassBorderIdle),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide(color: primary, width: 1.5),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            FluidPressScale(
              pressedScale: 0.91,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: primary,
                  foregroundColor: Colors.white,
                  elevation: 6,
                  shadowColor: primary.withValues(alpha: 0.45),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(24),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 14,
                  ),
                ),
                onPressed: () =>
                    _dispatchCommand(_commandController.text, host),
                child: const Text(
                  'Run',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: commands.map((cmd) {
            return FluidPressScale(
              pressedScale: 0.92,
              child: ActionChip(
                backgroundColor: palette.terminalBackground,
                side: BorderSide(color: primary.withValues(alpha: 0.35)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
                label: Text(
                  cmd.split('|').first.trim(),
                  style: TextStyle(
                    color: primary,
                    fontSize: context.fluidFont(11),
                    fontWeight: FontWeight.w600,
                    fontFamily: 'monospace',
                  ),
                ),
                onPressed: () => _dispatchCommand(cmd, host),
              ),
            );
          }).toList(),
        ),
        if (terminalHistory.isNotEmpty) ...[
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(child: _buildSectionHeader('Recent Command History')),
              TextButton(
                onPressed: () => ref
                    .read(appPreferencesProvider.notifier)
                    .clearTerminalHistory(),
                child: Text(
                  'Clear History',
                  style: TextStyle(
                    color: palette.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ),
            ],
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: terminalHistory.map((item) {
                return Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: ActionChip(
                    backgroundColor: palette.terminalBackground,
                    side: BorderSide(color: palette.glassBorderIdle),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                    ),
                    label: Text(
                      item,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: palette.terminalText,
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
                'Terminal Output · Sandboxed Job Object',
              ),
            ),
            if (_commandLogs.isNotEmpty)
              TextButton(
                onPressed: () => setState(() => _commandLogs.clear()),
                child: Text(
                  'Clear Log',
                  style: TextStyle(
                    color: palette.textSecondary,
                    fontSize: 11,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        RepaintBoundary(
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: palette.terminalBackground,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                color: palette.isDaylight
                    ? Colors.white.withValues(alpha: 0.90)
                    : primary.withValues(alpha: 0.34),
                width: 1.2,
              ),
              boxShadow: palette.elevationShadows(isSelected: false),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const FluidSpecularBar(
                  isSelected: true,
                  height: 1.2,
                  margin: EdgeInsets.only(bottom: 12),
                ),
                _commandLogs.isEmpty
                    ? Text(
                        host != null
                            ? 'Ready on ${host.name} (${host.ip}:${host.wsPort}). Select a preset or type a command above to execute.'
                            : 'No active command session. Add a workstation in the Fleet tab to execute remote commands.',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          color: palette.textSecondary,
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
                                      icon: Icon(
                                        Icons.copy_rounded,
                                        size: 14,
                                        color: palette.textSecondary,
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
                                        ? palette.accent
                                        : palette.terminalText,
                                    fontSize: context.fluidFont(10.5),
                                  ),
                                ),
                              ],
                            ),
                          );
                        }).toList(),
                      ),
              ],
            ),
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

    bool isSaving = false;
    await showDialog<void>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            final dlgPalette = ctx.palette;
            final primary = dlgPalette.primary;
            return AlertDialog(
              insetPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              scrollable: true,
              backgroundColor: dlgPalette.surfaceElevated,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(color: dlgPalette.dividerColor),
              ),
              title: Text(
                'Pair Workstation Credentials',
                style: TextStyle(color: dlgPalette.textPrimary, fontSize: 16),
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: secretCtrl,
                    obscureText: true,
                    style: TextStyle(
                      color: dlgPalette.textPrimary,
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
                      style: TextStyle(
                        color: dlgPalette.textPrimary,
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
                  onPressed: isSaving ? null : () => Navigator.of(ctx).pop(),
                  child: Text(
                    'Cancel',
                    style: TextStyle(color: dlgPalette.textSecondary),
                  ),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: primary,
                    foregroundColor: dlgPalette.isDaylight
                        ? Colors.white
                        : const Color(0xFF090B1D),
                  ),
                  onPressed: isSaving
                      ? null
                      : () async {
                          setDialogState(() => isSaving = true);
                          String nextSecret = secretCtrl.text.trim();
                          String? nextCertFp = targetHost?.certFingerprint;
                          final pin = pinCtrl.text.trim();
                          bool? pinPaired;
                          if (targetHost != null &&
                              RegExp(r'^\d{6}$').hasMatch(pin)) {
                            final exchanged = await _pairWithHostPin(
                              targetHost.ip,
                              pin,
                              port: targetHost.wsPort,
                              useTls: targetHost.useTls ||
                                  ref.read(appPreferencesProvider).preferTls,
                              certFingerprint:
                                  targetHost.certFingerprint.isNotEmpty
                                      ? targetHost.certFingerprint
                                      : null,
                            );
                            if (exchanged != null &&
                                exchanged.pairingToken.isNotEmpty) {
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
                            saveHostPairingSecret(
                              targetHost?.ip ?? '',
                              nextSecret,
                              certFingerprint: nextCertFp,
                            );
                            if (mounted) {
                              ref
                                  .read(globalPairingSecretProvider.notifier)
                                  .state = nextSecret;
                              if (targetHost != null) {
                                ref.read(fleetProvider.notifier).setHostSecret(
                                      targetHost.ip,
                                      nextSecret,
                                      certFingerprint: nextCertFp,
                                    );
                              }
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
                  child: Text(
                    isSaving ? 'Pairing...' : 'Save & Pair',
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
          backgroundColor: ctx.palette.surfaceElevated,
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
            backgroundColor: ctx.palette.surfaceElevated,
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
    if (!mounted) return;
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
    final palette = context.palette;
    final disableAnim = MediaQuery.disableAnimationsOf(context);
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
        return AnimatedContainer(
          duration:
              disableAnim ? Duration.zero : const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Color.lerp(palette.surfaceElevated, primary, 0.12)!
                    .withValues(alpha: 0.90),
                palette.surface.withValues(alpha: 0.85),
              ],
            ),
            borderRadius: BorderRadius.circular(11),
            border: Border.all(color: primary.withValues(alpha: 0.30)),
            boxShadow: [
              BoxShadow(
                color: (palette.isDaylight
                        ? const Color(0xFF4C3E94)
                        : Colors.black)
                    .withValues(alpha: palette.isDaylight ? 0.10 : 0.32),
                blurRadius: 8,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Text(
            label,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: context.fluidFont(9.5),
              color: palette.textSecondary,
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildAppearanceStudioCard(AppPreferencesState prefs) {
    final prefsNotifier = ref.read(appPreferencesProvider.notifier);
    final palette = context.palette;
    final primary = palette.primary;
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final dur = disableAnim ? Duration.zero : const Duration(milliseconds: 220);

    return Container(
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: false),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: palette.glassBorderIdle, width: 1.2),
        boxShadow: palette.elevationShadows(isSelected: false),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const FluidSpecularBar(
              isSelected: true,
              height: 1.2,
              margin: EdgeInsets.only(left: 8, right: 8, bottom: 12),
            ),
            Row(
              children: [
                Icon(
                  prefs.themeMode == AppThemeMode.daylight
                      ? Icons.wb_sunny_rounded
                      : Icons.nightlight_round,
                  color: prefs.themeMode == AppThemeMode.daylight
                      ? const Color(0xFFF59E0B)
                      : primary,
                  size: 18,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Liquid Glass Polarity',
                    style: TextStyle(
                      color: palette.textPrimary,
                      fontWeight: FontWeight.w800,
                      fontSize: 13.5,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: AppThemeMode.values.map((mode) {
                final selected = prefs.themeMode == mode;
                final isSun = mode == AppThemeMode.daylight;
                return Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(right: isSun ? 8 : 0),
                    child: FluidPressScale(
                      pressedScale: 0.94,
                      onTap: () {
                        _hapticTap();
                        prefsNotifier.setThemeMode(mode);
                      },
                      child: AnimatedContainer(
                        key: ValueKey('theme-mode-${mode.name}'),
                        duration: dur,
                        curve: Curves.easeOutCubic,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 10,
                        ),
                        decoration: BoxDecoration(
                          gradient: selected ? palette.heroGradient : null,
                          color: selected
                              ? null
                              : palette.surfaceElevated.withValues(alpha: 0.45),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: selected
                                ? Colors.white.withValues(alpha: 0.55)
                                : palette.glassBorderIdle,
                          ),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              isSun
                                  ? Icons.wb_sunny_rounded
                                  : Icons.nightlight_round,
                              size: 16,
                              color: selected
                                  ? Colors.white
                                  : (isSun
                                      ? const Color(0xFFF59E0B)
                                      : palette.primary),
                            ),
                            const SizedBox(width: 6),
                            Flexible(
                              child: Text(
                                mode.label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: selected
                                      ? Colors.white
                                      : palette.textPrimary,
                                  fontWeight: FontWeight.w700,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Icon(Icons.palette_rounded, color: primary, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Hero Accent Palette (Saved Across Restarts)',
                    style: TextStyle(
                      color: palette.textPrimary,
                      fontWeight: FontWeight.w800,
                      fontSize: 13.5,
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
                final swatchColor = preset.resolvedPrimary(prefs.themeMode);
                final isSelected = prefs.accent == preset;
                return Semantics(
                  button: true,
                  selected: isSelected,
                  label: 'Theme color ${_formatEnumLabel(preset)}',
                  child: InkWell(
                    key: ValueKey('accent-${preset.name}'),
                    borderRadius: BorderRadius.circular(20),
                    onTap: () {
                      _hapticTap();
                      prefsNotifier.setAccent(preset);
                    },
                    child: AnimatedScale(
                      scale: isSelected ? 1.05 : 1.0,
                      duration: dur,
                      curve: Curves.easeOutBack,
                      child: AnimatedContainer(
                        duration: dur,
                        curve: Curves.easeOutCubic,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          gradient: isSelected
                              ? LinearGradient(
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                  colors: [
                                    swatchColor,
                                    preset.resolvedSecondary(prefs.themeMode),
                                  ],
                                )
                              : null,
                          color: isSelected
                              ? null
                              : palette.surfaceElevated.withValues(alpha: 0.45),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: isSelected
                                ? Colors.white.withValues(alpha: 0.55)
                                : palette.glassBorderIdle,
                            width: isSelected ? 1.4 : 1,
                          ),
                          boxShadow: isSelected
                              ? [
                                  BoxShadow(
                                    color: swatchColor.withValues(alpha: 0.32),
                                    blurRadius: 12,
                                    offset: const Offset(0, 4),
                                  ),
                                ]
                              : null,
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              width: 14,
                              height: 14,
                              decoration: BoxDecoration(
                                color: isSelected ? Colors.white : swatchColor,
                                shape: BoxShape.circle,
                                boxShadow: [
                                  BoxShadow(
                                    color: swatchColor.withValues(alpha: 0.45),
                                    blurRadius: 6,
                                  ),
                                ],
                              ),
                              child: isSelected
                                  ? Icon(
                                      Icons.check_rounded,
                                      size: 10,
                                      color: swatchColor,
                                    )
                                  : null,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              _formatEnumLabel(preset),
                              style: TextStyle(
                                color: isSelected
                                    ? Colors.white
                                    : palette.textPrimary,
                                fontWeight: isSelected
                                    ? FontWeight.w800
                                    : FontWeight.w600,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
            Text(
              'Optical Glass Finish',
              style: TextStyle(
                color: palette.textSecondary,
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: GlassIntensity.values.map((intensity) {
                final selected = prefs.glassIntensity == intensity;
                return ChoiceChip(
                  label: Text(intensity.label),
                  selected: selected,
                  selectedColor: primary.withValues(alpha: 0.22),
                  labelStyle: TextStyle(
                    color: selected ? primary : palette.textSecondary,
                    fontWeight: selected ? FontWeight.bold : FontWeight.w600,
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
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Reduced Motion & Animations',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: palette.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Minimizes spring motion and aurora effects for battery savings.',
                        style: TextStyle(
                          fontSize: 11,
                          color: palette.textSecondary,
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
      padding: FluidSize.pagePadding(context),
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
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.fromLTRB(14, 11, 14, 14),
          decoration: BoxDecoration(
            gradient: context.palette.cardBevelGradient(isSelected: false),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(
              color: context.palette.glassBorderIdle,
              width: 1.15,
            ),
            boxShadow: context.palette.elevationShadows(isSelected: false),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const FluidSpecularBar(
                isSelected: false,
                height: 1.1,
                margin: EdgeInsets.only(left: 6, right: 6, bottom: 10),
              ),
              Text(
                'Target Stream Frame Rate',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: context.palette.textPrimary,
                  fontSize: context.fluidFont(12.5),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Persisted decode & frame pacing cap for battery/smoothness.',
                style: TextStyle(
                  color: context.palette.textSecondary,
                  fontSize: context.fluidFont(10.5),
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
                      fontWeight: active ? FontWeight.bold : FontWeight.w600,
                      color: active ? primary : context.palette.textSecondary,
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
          trailing: Text(
            'UDP 9',
            style: TextStyle(
              color: context.palette.warning,
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        _buildSettingsToggleTile(
          icon: Icons.vibration_rounded,
          title: 'Haptic Touch Feedback',
          subtitle: 'Subtle tactile vibration when interacting with controls.',
          value: prefs.hapticsEnabled,
          onChanged: prefsNotifier.setHapticsEnabled,
        ),
        _buildSettingsToggleTile(
          icon: Icons.wb_sunny_rounded,
          title: 'Keep Screen Awake During Stream',
          subtitle: 'Prevents display sleep while viewing live PC stream.',
          value: prefs.keepScreenAwake,
          onChanged: prefsNotifier.setKeepScreenAwake,
        ),
        const SizedBox(height: 14),
        _buildSectionHeader('TOUCHSCREEN & FULLSCREEN CONTROLS'),
        const SizedBox(height: 8),
        _buildTouchInputModeCard(prefs, prefsNotifier, primary),
        _buildSettingsToggleTile(
          icon: Icons.screen_rotation_rounded,
          title: 'Auto-Landscape in Fullscreen',
          subtitle: 'Automatically rotates to landscape when opening live PC control.',
          value: prefs.fullscreenAutoLandscape,
          onChanged: prefsNotifier.setFullscreenAutoLandscape,
        ),
        _buildSettingsToggleTile(
          icon: Icons.touch_app_rounded,
          title: 'Touch Visual Feedback',
          subtitle: 'Shows animated tap ripples, cursor reticle, and long-press right-click ring.',
          value: prefs.touchVisualFeedback,
          onChanged: prefsNotifier.setTouchVisualFeedback,
        ),
        _buildStreamQualityPresetCard(prefs, prefsNotifier, primary),
        _buildTrackpadSensitivityCard(prefs, prefsNotifier, primary),
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
            subtitle:
                'Restores Bright Daylight & Iridescent Violet defaults (keeps paired hosts).',
            trailing: Icon(
              Icons.restore_rounded,
              color: context.palette.textSecondary,
            ),
          ),
        ),
        _buildSettingsTile(
          icon: Icons.verified_rounded,
          title: 'AI NetController Mobile',
          subtitle:
              'Impeller Hardware Engine • AI-NET/3.0-SECURE Protocol',
          trailing: Text(
            'v0.85.0-alpha',
            style: TextStyle(
              color: context.palette.success,
              fontFamily: 'monospace',
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildTouchInputModeCard(
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    Color primary,
  ) {
    final palette = context.palette;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 14),
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: false),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: palette.glassBorderIdle, width: 1.15),
        boxShadow: palette.elevationShadows(isSelected: false),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FluidSpecularBar(
            isSelected: false,
            height: 1.1,
            margin: EdgeInsets.only(left: 6, right: 6, bottom: 10),
          ),
          Text(
            'Default Remote Input Mode',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: palette.textPrimary,
              fontSize: context.fluidFont(12.5),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Direct Touch moves the PC cursor directly under your finger; Trackpad uses relative glides.',
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(10.5),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final mode in RemoteInputMode.values)
                ChoiceChip(
                  key: ValueKey('input-mode-${mode.name}'),
                  avatar: Icon(
                    mode == RemoteInputMode.touchscreen
                        ? Icons.touch_app_rounded
                        : Icons.mouse_rounded,
                    size: 15,
                    color: prefs.defaultInputMode == mode
                        ? primary
                        : palette.textSecondary,
                  ),
                  label: Text(
                    mode == RemoteInputMode.touchscreen
                        ? 'Direct Touch'
                        : 'Trackpad',
                  ),
                  selected: prefs.defaultInputMode == mode,
                  selectedColor: primary.withValues(alpha: 0.22),
                  labelStyle: TextStyle(
                    fontSize: 11.5,
                    fontWeight: prefs.defaultInputMode == mode
                        ? FontWeight.bold
                        : FontWeight.w600,
                    color: prefs.defaultInputMode == mode
                        ? primary
                        : palette.textSecondary,
                  ),
                  onSelected: (_) {
                    _hapticTap();
                    prefsNotifier.setDefaultInputMode(mode);
                  },
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStreamQualityPresetCard(
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    Color primary,
  ) {
    final palette = context.palette;
    const labels = <String, String>{
      'auto': 'Auto',
      'low': 'Low',
      'balanced': 'Balanced',
      'crisp': 'Crisp',
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 14),
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: false),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: palette.glassBorderIdle, width: 1.15),
        boxShadow: palette.elevationShadows(isSelected: false),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FluidSpecularBar(
            isSelected: false,
            height: 1.1,
            margin: EdgeInsets.only(left: 6, right: 6, bottom: 10),
          ),
          Text(
            'Stream Visual Quality Preset',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: palette.textPrimary,
              fontSize: context.fluidFont(12.5),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Balances bandwidth vs desktop text crispness across Wi-Fi conditions.',
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(10.5),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: kValidStreamQualityPresets.map((preset) {
              final active = prefs.streamQualityPreset == preset;
              return ChoiceChip(
                key: ValueKey('quality-preset-$preset'),
                label: Text(labels[preset] ?? preset),
                selected: active,
                selectedColor: primary.withValues(alpha: 0.22),
                labelStyle: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: active ? FontWeight.bold : FontWeight.w600,
                  color: active ? primary : palette.textSecondary,
                ),
                onSelected: (_) {
                  _hapticTap();
                  prefsNotifier.setStreamQualityPreset(preset);
                },
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildTrackpadSensitivityCard(
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    Color primary,
  ) {
    final palette = context.palette;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 10),
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: false),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: palette.glassBorderIdle, width: 1.15),
        boxShadow: palette.elevationShadows(isSelected: false),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FluidSpecularBar(
            isSelected: false,
            height: 1.1,
            margin: EdgeInsets.only(left: 6, right: 6, bottom: 10),
          ),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Trackpad Pointer Sensitivity',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: palette.textPrimary,
                    fontSize: context.fluidFont(12.5),
                  ),
                ),
              ),
              Text(
                '${prefs.trackpadSensitivity.toStringAsFixed(1)}x',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.w800,
                  color: primary,
                  fontSize: context.fluidFont(11.5),
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            'Cursor velocity gain when using Trackpad (PAD) mode.',
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(10.5),
            ),
          ),
          Slider(
            key: const ValueKey('trackpad-sensitivity-slider'),
            value: prefs.trackpadSensitivity.clamp(0.6, 3.0),
            min: 0.6,
            max: 3.0,
            divisions: 24,
            activeColor: primary,
            onChanged: prefsNotifier.setTrackpadSensitivity,
          ),
        ],
      ),
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
    final palette = context.palette;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 11, 14, 14),
        decoration: BoxDecoration(
          gradient: palette.cardBevelGradient(isSelected: false),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: palette.glassBorderIdle, width: 1.15),
          boxShadow: palette.elevationShadows(isSelected: false),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const FluidSpecularBar(
              isSelected: false,
              height: 1.1,
              margin: EdgeInsets.only(left: 6, right: 6, bottom: 10),
            ),
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    gradient: palette.heroGradient,
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.55),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: palette.primary.withValues(alpha: 0.28),
                        blurRadius: 10,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: Icon(icon, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          color: palette.textPrimary,
                          fontSize: context.fluidFont(12.5),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: TextStyle(
                          color: palette.textSecondary,
                          fontSize: context.fluidFont(10.5),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                trailing,
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    final palette = context.palette;
    final primary = palette.primary;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 3,
          height: 12,
          margin: const EdgeInsets.only(right: 7),
          decoration: BoxDecoration(
            color: primary,
            borderRadius: BorderRadius.circular(2),
            boxShadow: [
              BoxShadow(
                color: primary.withValues(alpha: 0.55),
                blurRadius: 6,
              ),
            ],
          ),
        ),
        Flexible(
          child: Text(
            title,
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(10),
              fontWeight: FontWeight.bold,
              letterSpacing: 1.5,
            ),
          ),
        ),
      ],
    );
  }
}
