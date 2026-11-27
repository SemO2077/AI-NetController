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
import 'services/history_store.dart';
import 'services/host_connection_client.dart';
import 'services/lan_discovery_service.dart';
import 'services/os_integrations_manager.dart';
import 'theme/fluid_theme.dart';
import 'ui/adaptive_layout_builder.dart';
import 'ui/connection_diagnostics_sheet.dart';
import 'ui/fullscreen_stream_page.dart';
import 'ui/host_snapshot_preview.dart';
import 'ui/onboarding_sheet.dart';
import 'ui/responsive_device_card.dart';
import 'ui/settings_command_deck.dart';
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
  final bool isPinned;

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
    this.isPinned = false,
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
    bool? isPinned,
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
      isPinned: isPinned ?? this.isPinned,
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
        if (isPinned) 'isPinned': true,
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
    final isPinned = raw['isPinned'] == true;

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
      isPinned: isPinned,
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

  void togglePinHost(String id) {
    bool changed = false;
    final nextList = <HostState>[
      for (final h in state)
        if (h.id == id)
          (() {
            changed = true;
            return h.copyWith(isPinned: !h.isPinned);
          })()
        else
          h,
    ];
    if (changed) {
      state = nextList;
      _persistHosts();
    }
  }

  void setHostPinned(String id, bool pinned) {
    bool changed = false;
    final nextList = <HostState>[
      for (final h in state)
        if (h.id == id && h.isPinned != pinned)
          (() {
            changed = true;
            return h.copyWith(isPinned: pinned);
          })()
        else
          h,
    ];
    if (changed) {
      state = nextList;
      _persistHosts();
    }
  }

  void mergeDiscoveredMetadata(
    String ip, {
    String? mac,
    String? osName,
    int? latencyMs,
    bool? isOnline,
  }) {
    final String cleanMac =
        mac != null ? (NetworkValidators.normalizeMac(mac) ?? '') : '';
    final String cleanOs = osName != null
        ? NetworkValidators.sanitizeLabel(osName)
        : '';
    bool stateChanged = false;
    bool persistNeeded = false;
    final nextList = <HostState>[
      for (final h in state)
        if (h.ip == ip)
          (() {
            final nextOnline = isOnline ?? h.isOnline;
            final nextLat = latencyMs ?? h.latencyMs;
            final nextMac =
                (cleanMac.isNotEmpty && h.mac == '00:00:00:00:00:00')
                    ? cleanMac
                    : h.mac;
            final nextOs =
                (cleanOs.isNotEmpty &&
                        cleanOs != 'Unknown' &&
                        h.osName.trim().isEmpty)
                    ? cleanOs
                    : h.osName;
            if (nextMac != h.mac || nextOs != h.osName) {
              persistNeeded = true;
            }
            if (nextOnline == h.isOnline &&
                nextLat == h.latencyMs &&
                nextMac == h.mac &&
                nextOs == h.osName) {
              return h;
            }
            stateChanged = true;
            return h.copyWith(
              isOnline: nextOnline,
              latencyMs: nextLat,
              mac: nextMac,
              osName: nextOs,
            );
          })()
        else
          h,
    ];
    if (stateChanged) {
      state = nextList;
    }
    if (persistNeeded) {
      _persistHosts();
    }
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
      _openHiveBoxSafely(kHistoryBoxName),
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

enum _FleetStatusFilter { all, online, sleeping, pinned }

class _MainAdaptiveScreenState extends ConsumerState<MainAdaptiveScreen> {
  static const MethodChannel _deeplinkChannel =
      MethodChannel('com.cst.autonomouslan/deeplink');

  int _currentTabIndex = 0;
  String? _expandedHostId;
  final TextEditingController _commandController = TextEditingController();
  final TextEditingController _fleetSearchController = TextEditingController();
  final List<CommandLogItem> _commandLogs = [];
  String _fleetSearchQuery = '';
  _FleetStatusFilter _fleetFilter = _FleetStatusFilter.all;
  bool _showFleetSearch = false;
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
            ? context.palette.success
            : context.palette.warning,
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
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;
    final palette = context.palette;
    final Color effectiveAccent = accentColor ?? palette.primary;
    messenger
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

  Future<WolDispatchResult> _dispatchWolCore({
    required String targetMac,
    String targetIp = '',
    String hostName = '',
    int port = 9,
    String? customBroadcastIp,
    int burstCount = 1,
    bool sendGratuitousArp = true,
  }) {
    _hapticTap();
    final String trimmedBroadcast = customBroadcastIp?.trim() ?? '';
    return OsIntegrationsManager.instance.sendWakePacketDetailed(
      targetMac: targetMac,
      targetIp: targetIp.trim(),
      port: port,
      customBroadcastIp: trimmedBroadcast.isNotEmpty &&
              NetworkValidators.isValidIpv4(trimmedBroadcast)
          ? trimmedBroadcast
          : null,
      burstCount: burstCount,
      sendBothPorts: port == 9,
      sendGratuitousArp: sendGratuitousArp,
    );
  }

  String _resolveHostNameForWol(String normalizedMac, String? targetIp) {
    final cleanIp = targetIp?.trim() ?? '';
    for (final host in ref.read(fleetProvider)) {
      if (NetworkValidators.normalizeMac(host.mac) == normalizedMac ||
          (cleanIp.isNotEmpty && host.ip.trim() == cleanIp)) {
        return host.name;
      }
    }
    return '';
  }

  Future<void> _sendWakeOnLan(
    String mac, {
    String? targetIp,
    String? hostName,
    bool silent = false,
  }) async {
    final normalizedMac = NetworkValidators.normalizeMac(mac);
    if (NetworkValidators.parseMacBytes(mac) == null || normalizedMac == null) {
      if (!silent) {
        _showToast(
          'Cannot send Wake-on-LAN: set a valid non-zero MAC address on this workstation.',
          accentColor: context.palette.warning,
          duration: const Duration(seconds: 3),
        );
      }
      return;
    }

    final prefs = ref.read(appPreferencesProvider);
    final cleanIp = targetIp?.trim() ?? '';
    final resolvedHostName = (hostName != null && hostName.trim().isNotEmpty)
        ? hostName.trim()
        : _resolveHostNameForWol(normalizedMac, cleanIp);
    final broadcastOverride = prefs.wolBroadcastOverride.trim();

    try {
      final result = await _dispatchWolCore(
        targetMac: normalizedMac,
        targetIp: cleanIp,
        hostName: resolvedHostName,
        port: prefs.wolPort,
        customBroadcastIp:
            broadcastOverride.isNotEmpty ? broadcastOverride : null,
        burstCount: prefs.wolBurstCount,
        sendGratuitousArp: prefs.wolSendGratuitousArp,
      );
      if (!mounted) return;
      await ref.read(historyProvider.notifier).recordWol(
            mac: result.mac.isNotEmpty ? result.mac : normalizedMac,
            hostName: resolvedHostName,
            hostIp: cleanIp,
            success: result.success,
            port: result.port,
            broadcastIp: broadcastOverride,
            burstCount: result.burstCount,
            latencyMs: result.latencyMs,
            targets: result.targets,
            error: result.error,
            extraMeta: <String, dynamic>{'garp': prefs.wolSendGratuitousArp},
          );

      if (!silent && mounted) {
        if (result.success) {
          final targetsText = result.targets.isNotEmpty
              ? result.targets.join(', ')
              : '255.255.255.255';
          _showToast(
            'WoL Magic Packet dispatched to $normalizedMac ($targetsText · UDP ${result.port})',
            accentColor: context.palette.warning,
          );
        } else {
          _showToast(
            'Wake-on-LAN dispatch failed: ${result.error ?? 'unknown error'}',
            accentColor: _kDangerColor,
          );
        }
      }
    } catch (e) {
      debugPrint('WoL Socket Error: $e');
      if (mounted) {
        unawaited(
          ref.read(historyProvider.notifier).recordWol(
                mac: normalizedMac,
                hostName: resolvedHostName,
                hostIp: cleanIp,
                success: false,
                port: prefs.wolPort,
                broadcastIp: broadcastOverride,
                burstCount: prefs.wolBurstCount,
                error: e.toString(),
                extraMeta: <String, dynamic>{
                  'garp': prefs.wolSendGratuitousArp,
                },
              ),
        );
      }
      if (!silent && mounted) {
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
        accentColor: context.palette.warning,
      );
      return;
    }

    for (final host in targets) {
      await _sendWakeOnLan(
        host.mac,
        targetIp: host.ip,
        hostName: host.name,
        silent: true,
      );
    }
    if (!mounted) return;
    _showToast(
      'Sent Wake-on-LAN packets to ${targets.length} sleeping workstation(s).',
      accentColor: context.palette.warning,
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
    unawaited(
      ref.read(historyProvider.notifier).recordConnection(
            hostIp: host.ip,
            hostName: host.name,
            mac: host.mac,
            success: ms != null,
            event: ms != null
                ? 'TCP reachability ping succeeded (${ms}ms)'
                : 'Host did not respond to TCP ping on port ${host.wsPort}',
            port: host.wsPort,
            latencyMs: ms,
            title: ms != null
                ? 'Reachable: ${host.name}'
                : 'Unreachable: ${host.name}',
          ),
    );
    _showToast(
      ms != null
          ? '${host.name} (${host.ip}:${host.wsPort}) reachable in ${ms}ms'
          : '${host.name} (${host.ip}:${host.wsPort}) did not respond',
      accentColor: ms != null
          ? context.palette.success
          : context.palette.warning,
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
          final wasOnline = host.isOnline;
          final isNowOnline = ms != null;
          if (isNowOnline) onlineCount++;
          ref.read(fleetProvider.notifier).updateLatencyByIp(
                host.ip,
                ms,
                isOnline: isNowOnline,
              );
          if (wasOnline != isNowOnline) {
            unawaited(
              ref.read(historyProvider.notifier).recordConnection(
                    hostIp: host.ip,
                    hostName: host.name,
                    mac: host.mac,
                    success: isNowOnline,
                    event: isNowOnline
                        ? 'Host came online during fleet ping (${ms}ms)'
                        : 'Host went offline during fleet ping',
                    port: host.wsPort,
                    latencyMs: ms,
                  ),
            );
          }
        }),
      );
      if (mounted) {
        _showToast(
          'Health check complete: $onlineCount / ${hosts.length} online',
          accentColor: onlineCount > 0
              ? context.palette.success
              : context.palette.warning,
        );
      }
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
              mac: host.mac.isNotEmpty ? host.mac : '00:00:00:00:00:00',
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
            ref.read(fleetProvider.notifier).mergeDiscoveredMetadata(
                  pc.ip,
                  mac: pc.mac,
                  osName: pc.osName,
                  latencyMs: pc.latencyMs,
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
          accentColor: context.palette.success,
          duration: const Duration(seconds: 3),
        );
      } else {
        _showToast(
          'No active PCs found on port $scanPort. Verify the PC agent is running.',
          accentColor: context.palette.warning,
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
        accentColor: context.palette.warning,
      );
      unawaited(_showHostEditorDialog(existing: host));
      return;
    }
    final effectiveFp = host.certFingerprint.trim().isNotEmpty
        ? host.certFingerprint.trim()
        : loadHostCertFingerprint(host.ip);
    unawaited(
      ref.read(historyProvider.notifier).recordConnection(
            hostIp: host.ip,
            hostName: host.name,
            mac: host.mac,
            success: true,
            status: 'info',
            event:
                'Opened fullscreen stream (${prefs.targetFps}fps · ${prefs.streamQualityPreset})',
            port: host.wsPort,
            latencyMs: host.latencyMs,
            title: 'Stream Session · ${host.name}',
          ),
    );
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
          instantTapMode: prefs.instantTapMode,
          longPressDelayMs: prefs.longPressDelayMs,
          scrollSensitivity: prefs.scrollSensitivity,
          naturalScroll: prefs.naturalScroll,
          pinchZoomEnabled: prefs.pinchZoomEnabled,
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
    final defaultSecret = existing != null
        ? existing.sharedSecret
        : ref.read(globalPairingSecretProvider);
    final defaultTls =
        existing?.useTls ?? ref.read(appPreferencesProvider).preferTls;

    await showDialog<void>(
      context: context,
      builder: (_) => _HostEditorDialog(
        existing: existing,
        defaultPort: defaultPort,
        defaultSecret: defaultSecret,
        defaultTls: defaultTls,
        onPastePairingLink: _handleIncomingPairingLink,
        onSave: ({
          required String name,
          required String ip,
          required int port,
          required String normalizedMac,
          required String rawSecret,
          required bool useTls,
        }) async {
          String secret = rawSecret;
          String certFp =
              existing?.certFingerprint.trim().isNotEmpty == true
                  ? existing!.certFingerprint.trim()
                  : loadHostCertFingerprint(ip);
          if (RegExp(r'^\d{6}$').hasMatch(secret)) {
            final exchanged = await _pairWithHostPin(
              ip,
              secret,
              port: port,
              useTls: useTls,
              certFingerprint: certFp.isNotEmpty ? certFp : null,
            );
            if (exchanged != null && exchanged.pairingToken.isNotEmpty) {
              secret = exchanged.pairingToken;
              if (exchanged.certFingerprint != null &&
                  exchanged.certFingerprint!.isNotEmpty) {
                certFp = exchanged.certFingerprint!;
              }
            } else {
              return 'PIN pairing failed — verify the 6-digit PIN shown on the PC Agent ($ip:$port).';
            }
          }

          if (secret.isNotEmpty || certFp.isNotEmpty) {
            saveHostPairingSecret(ip, secret, certFingerprint: certFp);
          }
          if (!mounted) return null;
          if (secret.isNotEmpty &&
              ref.read(globalPairingSecretProvider).trim().isEmpty) {
            ref.read(globalPairingSecretProvider.notifier).state = secret;
          }

          if (existing != null) {
            ref.read(fleetProvider.notifier).editHost(
                  existing.id,
                  name: name,
                  ip: ip,
                  wsPort: port,
                  mac: normalizedMac,
                  sharedSecret: secret,
                  useTls: useTls,
                  certFingerprint: certFp,
                );
          } else {
            final id = 'PC-${ip.replaceAll('.', '-')}-$port';
            final host = HostState(
              id: id,
              name: name,
              ip: ip,
              wsPort: port,
              mac: normalizedMac,
              isOnline: secret.isNotEmpty,
              sharedSecret: secret,
              useTls: useTls,
              certFingerprint: certFp,
            );
            ref.read(fleetProvider.notifier).addHost(host);
            ref.read(selectedHostIdProvider.notifier).state = host.id;
          }
          return null;
        },
      ),
    );
  }

  Future<HostConnectionClient?> _acquireConnectedClient(HostState host) async {
    final prefs = ref.read(appPreferencesProvider);
    final secret = _resolveSecretForHost(host);
    if (secret.isEmpty) {
      _showToast(
        'Pairing secret required before connecting to ${host.name}.',
        accentColor: context.palette.warning,
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
    final wasEstablished = client.isVaultEstablished;
    try {
      await client.ensureConnected(timeout: const Duration(seconds: 7));
      if (!wasEstablished && client.isVaultEstablished && mounted) {
        unawaited(
          ref.read(historyProvider.notifier).recordConnection(
                hostIp: host.ip,
                hostName: host.name,
                mac: host.mac,
                success: true,
                event: 'Encrypted WebSocket session established',
                port: host.wsPort,
                latencyMs: client.latencyMs ?? host.latencyMs,
              ),
        );
      }
      return client;
    } catch (e) {
      if (mounted) {
        unawaited(
          ref.read(historyProvider.notifier).recordConnection(
                hostIp: host.ip,
                hostName: host.name,
                mac: host.mac,
                success: false,
                event: 'WebSocket connection failed: $e',
                port: host.wsPort,
              ),
        );
      }
      rethrow;
    }
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
                      if (mounted) {
                        _showToast('Phone clipboard is empty.',
                            accentColor: context.palette.warning);
                      }
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
                    if (mounted) {
                      _showToast('Sent lock_pc command to ${host.name}.',
                          accentColor: context.palette.warning);
                    }
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
    final payload = await showDialog<
        ({String filePath, String noteName, String noteBody})>(
      context: context,
      builder: (_) => _SendFileDialog(hostName: host.name),
    );
    if (payload == null || !mounted) return;
    final filePath = payload.filePath;
    final noteName = payload.noteName;
    final noteBody = payload.noteBody;
    if (filePath.isEmpty && noteBody.isEmpty) {
      _showToast('Enter a file path or text content to transfer.',
          accentColor: context.palette.warning);
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
                          leading: Icon(
                            host.isPinned
                                ? Icons.star_rounded
                                : Icons.star_outline_rounded,
                            color: host.isPinned
                                ? sheetPalette.warning
                                : sheetPalette.textSecondary,
                          ),
                          title: Text(
                            host.isPinned
                                ? 'Unpin Workstation'
                                : 'Pin Workstation to Top',
                          ),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            _togglePinHost(host);
                          },
                        ),
                        ListTile(
                          leading: Icon(Icons.copy_rounded,
                              color: sheetPalette.textSecondary),
                          title: const Text('Copy IP Address'),
                          subtitle: Text(
                            host.ip,
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                            ),
                          ),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            unawaited(
                              Clipboard.setData(ClipboardData(text: host.ip))
                                  .catchError((_) {}),
                            );
                            _showToast(
                              'Copied IP ${host.ip} to clipboard',
                              accentColor: context.palette.success,
                            );
                          },
                        ),
                        ListTile(
                          leading: Icon(Icons.lan_rounded,
                              color: sheetPalette.textSecondary),
                          title: const Text('Copy Endpoint (IP:Port)'),
                          subtitle: Text(
                            '${host.ip}:${host.wsPort}',
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                            ),
                          ),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            final endpoint = '${host.ip}:${host.wsPort}';
                            unawaited(
                              Clipboard.setData(ClipboardData(text: endpoint))
                                  .catchError((_) {}),
                            );
                            _showToast(
                              'Copied Endpoint $endpoint to clipboard',
                              accentColor: context.palette.success,
                            );
                          },
                        ),
                        if (hasValidMac)
                          ListTile(
                            leading: Icon(Icons.router_rounded,
                                color: sheetPalette.textSecondary),
                            title: const Text('Copy MAC Address'),
                            subtitle: Text(
                              host.mac.toUpperCase(),
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                              ),
                            ),
                            onTap: () {
                              Navigator.of(ctx).pop();
                              final mac = host.mac.toUpperCase();
                              unawaited(
                                Clipboard.setData(ClipboardData(text: mac))
                                    .catchError((_) {}),
                              );
                              _showToast(
                                'Copied MAC $mac to clipboard',
                                accentColor: context.palette.success,
                              );
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
    if (_expandedHostId == host.id) {
      setState(() => _expandedHostId = null);
    }
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
      if (!authorized) {
        if (mounted) {
          unawaited(
            ref.read(historyProvider.notifier).recordCommand(
                  command: trimmed,
                  hostName: targetHost?.name ?? '',
                  hostIp: targetHost?.ip ?? '',
                  mac: targetHost?.mac ?? '',
                  success: false,
                  detail: 'Blocked by operator HITL guard: $trimmed',
                ),
          );
          _showToast(
            'Command blocked by operator HITL guard.',
            accentColor: context.palette.warning,
          );
        }
        return;
      }
      if (!mounted) return;
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
      if (mounted) {
        unawaited(
          ref.read(historyProvider.notifier).recordCommand(
                command: trimmed,
                hostName: targetHost.name,
                hostIp: targetHost.ip,
                mac: targetHost.mac,
                success: false,
                detail: 'Pairing secret required for $trimmed',
              ),
        );
      }
      return;
    }

    HostConnectionClient? retainedClient;
    bool wasVaultEstablished = false;
    final Stopwatch cmdWatch = Stopwatch()..start();
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
      wasVaultEstablished = client.isVaultEstablished;

      final lowerCmd = trimmed.toLowerCase();
      if (lowerCmd.startsWith('ai:') || lowerCmd.startsWith('ollama:')) {
        final prompt = trimmed.substring(trimmed.indexOf(':') + 1).trim();
        if (prompt.isEmpty) {
          updateLatestStatus('Provide a prompt after ai: or ollama:.',
              isError: true);
          if (mounted) {
            unawaited(
              ref.read(historyProvider.notifier).recordCommand(
                    command: trimmed,
                    hostName: targetHost.name,
                    hostIp: targetHost.ip,
                    mac: targetHost.mac,
                    success: false,
                    detail: 'Provide a prompt after ai: or ollama:.',
                  ),
            );
          }
          return;
        }
        await client.ensureConnected(timeout: const Duration(seconds: 7));
        if (!wasVaultEstablished && client.isVaultEstablished && mounted) {
          wasVaultEstablished = true;
          unawaited(
            ref.read(historyProvider.notifier).recordConnection(
                  hostIp: targetHost.ip,
                  hostName: targetHost.name,
                  mac: targetHost.mac,
                  success: true,
                  event: 'Encrypted WebSocket session established',
                  port: targetHost.wsPort,
                  latencyMs: client.latencyMs ?? targetHost.latencyMs,
                ),
          );
        }
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
        String? ollamaErrorMsg;
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
                  ollamaErrorMsg = parsed['error'].toString();
                  final prefix = buf.isEmpty ? '' : '[Ollama Stream]\n${buf.toString()}\n\n';
                  updateLatestStatus(
                    '${prefix}Ollama Error: $ollamaErrorMsg',
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
            if (mounted) {
              unawaited(
                ref.read(historyProvider.notifier).recordCommand(
                      command: trimmed,
                      hostName: targetHost.name,
                      hostIp: targetHost.ip,
                      mac: targetHost.mac,
                      success: false,
                      detail: 'Unable to dispatch encrypted Ollama prompt.',
                    ),
              );
            }
            return;
          }
          updateLatestStatus('[Ollama Stream] Awaiting host AI tokens...');
          resetIdle(const Duration(seconds: 12));
          await done.future;
          cmdWatch.stop();
          final bool timedOutNoReply = buf.isEmpty && !hadError;
          if (timedOutNoReply) {
            updateLatestStatus(
              'No response from host Ollama bridge within 12s.',
              isError: true,
            );
          }
          if (mounted) {
            final bool ok = !hadError && !timedOutNoReply;
            unawaited(
              ref.read(historyProvider.notifier).recordCommand(
                    command: trimmed,
                    hostName: targetHost.name,
                    hostIp: targetHost.ip,
                    mac: targetHost.mac,
                    success: ok,
                    latencyMs: cmdWatch.elapsedMilliseconds,
                    detail: ok
                        ? trimmed
                        : (ollamaErrorMsg ??
                            'No response from host Ollama bridge within 12s.'),
                  ),
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
      cmdWatch.stop();
      if (!wasVaultEstablished && client.isVaultEstablished && mounted) {
        wasVaultEstablished = true;
        unawaited(
          ref.read(historyProvider.notifier).recordConnection(
                hostIp: targetHost.ip,
                hostName: targetHost.name,
                mac: targetHost.mac,
                success: true,
                event: 'Encrypted WebSocket session established',
                port: targetHost.wsPort,
                latencyMs: client.latencyMs ?? targetHost.latencyMs,
              ),
        );
      }
      final out = res.output.trim();
      final failed = res.exitCode != 0 || res.status == 'error' || res.status == 'timeout';
      updateLatestStatus(
        '[${res.status} • exit ${res.exitCode}] ${out.isNotEmpty ? out : "(no output)"}',
        isError: failed,
      );
      if (mounted) {
        final String trimmedOut =
            out.length > 360 ? '${out.substring(0, 360)}…' : out;
        try {
          unawaited(
            ref.read(historyProvider.notifier).recordCommand(
                  command: trimmed,
                  hostName: targetHost.name,
                  hostIp: targetHost.ip,
                  mac: targetHost.mac,
                  success: !failed,
                  exitCode: res.exitCode,
                  latencyMs: cmdWatch.elapsedMilliseconds,
                  detail: trimmedOut.isNotEmpty
                      ? '$trimmed\n$trimmedOut'
                      : trimmed,
                  extraMeta: <String, dynamic>{'status': res.status},
                ),
          );
        } catch (_) {}
      }
    } catch (e) {
      cmdWatch.stop();
      updateLatestStatus('Dispatch error: $e', isError: true);
      if (mounted) {
        try {
          if (!wasVaultEstablished) {
            unawaited(
              ref.read(historyProvider.notifier).recordConnection(
                    hostIp: targetHost.ip,
                    hostName: targetHost.name,
                    mac: targetHost.mac,
                    success: false,
                    event: 'Session handshake failed: $e',
                    port: targetHost.wsPort,
                  ),
            );
          }
          unawaited(
            ref.read(historyProvider.notifier).recordCommand(
                  command: trimmed,
                  hostName: targetHost.name,
                  hostIp: targetHost.ip,
                  mac: targetHost.mac,
                  success: false,
                  latencyMs: cmdWatch.elapsedMilliseconds,
                  detail: '$trimmed — Dispatch error: $e',
                ),
          );
        } catch (_) {}
      }
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
        return _buildSettingsTab(hosts);
      default:
        return _buildCompactListFleet(hosts);
    }
  }

  void _togglePinHost(HostState host) {
    _hapticTap();
    final nextPinned = !host.isPinned;
    ref.read(fleetProvider.notifier).togglePinHost(host.id);
    _showToast(
      nextPinned
          ? 'Pinned ${host.name} to top of Fleet.'
          : 'Unpinned ${host.name}.',
      accentColor: nextPinned ? context.palette.warning : null,
    );
  }

  List<HostState> _filteredHosts(
    List<HostState> hosts, {
    required FleetSortMode sortMode,
  }) {
    final query = _fleetSearchQuery.trim().toLowerCase();
    final filtered = hosts.where((h) {
      switch (_fleetFilter) {
        case _FleetStatusFilter.all:
          break;
        case _FleetStatusFilter.online:
          if (!h.isOnline) return false;
        case _FleetStatusFilter.sleeping:
          if (h.isOnline) return false;
        case _FleetStatusFilter.pinned:
          if (!h.isPinned) return false;
      }
      if (query.isEmpty) return true;
      return h.name.toLowerCase().contains(query) ||
          h.ip.toLowerCase().contains(query) ||
          h.mac.toLowerCase().contains(query) ||
          h.osName.toLowerCase().contains(query);
    }).toList();

    final indexById = <String, int>{
      for (int i = 0; i < hosts.length; i++) hosts[i].id: i,
    };

    filtered.sort((a, b) {
      if (a.isPinned != b.isPinned) {
        return a.isPinned ? -1 : 1;
      }
      switch (sortMode) {
        case FleetSortMode.defaultOrder:
          return (indexById[a.id] ?? 0).compareTo(indexById[b.id] ?? 0);
        case FleetSortMode.onlineFirst:
          if (a.isOnline != b.isOnline) return a.isOnline ? -1 : 1;
          return (indexById[a.id] ?? 0).compareTo(indexById[b.id] ?? 0);
        case FleetSortMode.nameAsc:
          final cmp = a.name.toLowerCase().compareTo(b.name.toLowerCase());
          return cmp != 0
              ? cmp
              : (indexById[a.id] ?? 0).compareTo(indexById[b.id] ?? 0);
        case FleetSortMode.latencyAsc:
          if (a.isOnline != b.isOnline) return a.isOnline ? -1 : 1;
          final int latA = a.latencyMs ?? 1 << 30;
          final int latB = b.latencyMs ?? 1 << 30;
          if (latA != latB) return latA.compareTo(latB);
          return a.name.toLowerCase().compareTo(b.name.toLowerCase());
      }
    });

    return List<HostState>.unmodifiable(filtered);
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

  Widget _buildFleetToolbar(
    List<HostState> hosts, {
    required FleetSortMode sortMode,
  }) {
    final palette = context.palette;
    final primary = palette.primary;
    final onlineCount = hosts.where((h) => h.isOnline).length;
    final sleepingCount = hosts.length - onlineCount;
    final pinnedCount = hosts.where((h) => h.isPinned).length;
    final hasSleepingWithMac = hosts.any(
      (h) => !h.isOnline && NetworkValidators.normalizeMac(h.mac) != null,
    );
    final bool showSearchField =
        hosts.length > 2 || _showFleetSearch || _fleetSearchQuery.isNotEmpty;

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
              'WORKSTATIONS ($onlineCount/${hosts.length} ONLINE)',
            ),
            if (hosts.isNotEmpty)
              Wrap(
                spacing: 4,
                runSpacing: 2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (hosts.length <= 2)
                    IconButton(
                      key: const ValueKey('fleet-search-toggle-btn'),
                      tooltip: showSearchField
                          ? 'Hide workstation search'
                          : 'Search workstations',
                      visualDensity: VisualDensity.compact,
                      constraints: const BoxConstraints(
                        minWidth: 32,
                        minHeight: 32,
                      ),
                      padding: EdgeInsets.zero,
                      icon: Icon(
                        showSearchField
                            ? Icons.search_off_rounded
                            : Icons.search_rounded,
                        size: 17,
                        color: showSearchField ? primary : palette.textSecondary,
                      ),
                      onPressed: () {
                        _hapticTap();
                        setState(() {
                          _showFleetSearch = !showSearchField;
                          if (!_showFleetSearch) {
                            _fleetSearchController.clear();
                            _fleetSearchQuery = '';
                          }
                        });
                      },
                    ),
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
                        : Icon(Icons.network_ping_rounded,
                            size: 15, color: primary),
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
        if (hosts.length >= 2) ...[
          const SizedBox(height: 6),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            child: Row(
              children: [
                _buildFleetFilterPill(
                  key: const ValueKey('fleet-filter-all'),
                  label: 'All (${hosts.length})',
                  selected: _fleetFilter == _FleetStatusFilter.all,
                  color: primary,
                  onTap: () => setState(() => _fleetFilter = _FleetStatusFilter.all),
                ),
                const SizedBox(width: 6),
                _buildFleetFilterPill(
                  key: const ValueKey('fleet-filter-online'),
                  label: 'Online ($onlineCount)',
                  selected: _fleetFilter == _FleetStatusFilter.online,
                  color: palette.success,
                  onTap: () => setState(
                    () => _fleetFilter = _fleetFilter == _FleetStatusFilter.online
                        ? _FleetStatusFilter.all
                        : _FleetStatusFilter.online,
                  ),
                ),
                const SizedBox(width: 6),
                _buildFleetFilterPill(
                  key: const ValueKey('fleet-filter-sleeping'),
                  label: 'Sleeping ($sleepingCount)',
                  selected: _fleetFilter == _FleetStatusFilter.sleeping,
                  color: palette.warning,
                  onTap: () => setState(
                    () => _fleetFilter =
                        _fleetFilter == _FleetStatusFilter.sleeping
                            ? _FleetStatusFilter.all
                            : _FleetStatusFilter.sleeping,
                  ),
                ),
                if (pinnedCount > 0 ||
                    _fleetFilter == _FleetStatusFilter.pinned) ...[
                  const SizedBox(width: 6),
                  _buildFleetFilterPill(
                    key: const ValueKey('fleet-filter-pinned'),
                    label: 'Pinned ($pinnedCount)',
                    icon: Icons.star_rounded,
                    selected: _fleetFilter == _FleetStatusFilter.pinned,
                    color: palette.warning,
                    onTap: () => setState(
                      () => _fleetFilter =
                          _fleetFilter == _FleetStatusFilter.pinned
                              ? _FleetStatusFilter.all
                              : _FleetStatusFilter.pinned,
                    ),
                  ),
                ],
                const SizedBox(width: 8),
                PopupMenuButton<FleetSortMode>(
                  key: const ValueKey('fleet-sort-btn'),
                  tooltip: 'Sort workstations',
                  color: palette.surfaceElevated,
                  initialValue: sortMode,
                  onSelected: (nextMode) {
                    _hapticTap();
                    unawaited(
                      ref
                          .read(appPreferencesProvider.notifier)
                          .setFleetSortMode(nextMode),
                    );
                  },
                  itemBuilder: (_) => [
                    for (final mode in FleetSortMode.values)
                      PopupMenuItem<FleetSortMode>(
                        key: ValueKey('fleet-sort-${mode.name}'),
                        value: mode,
                        child: Row(
                          children: [
                            Icon(
                              mode == sortMode
                                  ? Icons.check_rounded
                                  : Icons.sort_rounded,
                              size: 16,
                              color: mode == sortMode
                                  ? primary
                                  : palette.textSecondary,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              'Sort: ${mode.label}',
                              style: TextStyle(
                                color: mode == sortMode
                                    ? primary
                                    : palette.textPrimary,
                                fontWeight: mode == sortMode
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                                fontSize: 12.5,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: sortMode != FleetSortMode.defaultOrder
                          ? palette.secondary.withValues(
                              alpha: palette.isDaylight ? 0.12 : 0.20,
                            )
                          : palette.terminalBackground,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: sortMode != FleetSortMode.defaultOrder
                            ? palette.secondary.withValues(alpha: 0.45)
                            : palette.dividerColor,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.swap_vert_rounded,
                          size: 13.5,
                          color: sortMode != FleetSortMode.defaultOrder
                              ? palette.secondary
                              : palette.textSecondary,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          sortMode.label,
                          style: TextStyle(
                            color: sortMode != FleetSortMode.defaultOrder
                                ? palette.secondary
                                : palette.textSecondary,
                            fontSize: context.fluidFont(10.5),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        if (showSearchField) ...[
          const SizedBox(height: 6),
          TextField(
            key: const ValueKey('fleet-search-input'),
            controller: _fleetSearchController,
            onChanged: (val) => setState(() => _fleetSearchQuery = val),
            style: TextStyle(color: palette.terminalText, fontSize: 12.5),
            decoration: InputDecoration(
              isDense: true,
              prefixIcon: Icon(Icons.search_rounded, size: 18, color: primary),
              suffixIcon: _fleetSearchQuery.isNotEmpty
                  ? IconButton(
                      tooltip: 'Clear fleet search',
                      icon: const Icon(Icons.clear_rounded, size: 16),
                      onPressed: () {
                        _fleetSearchController.clear();
                        setState(() => _fleetSearchQuery = '');
                      },
                    )
                  : null,
              hintText: 'Filter by hostname, IP, MAC, or OS...',
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

  Widget _buildFleetFilterPill({
    required Key key,
    required String label,
    IconData? icon,
    required bool selected,
    required Color color,
    required VoidCallback onTap,
  }) {
    final palette = context.palette;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: key,
        onTap: () {
          _hapticTap();
          onTap();
        },
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: selected
                ? color.withValues(alpha: palette.isDaylight ? 0.15 : 0.22)
                : palette.terminalBackground,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: selected
                  ? color.withValues(alpha: 0.55)
                  : palette.dividerColor,
              width: selected ? 1.25 : 1.0,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(
                  icon,
                  size: 12.5,
                  color: selected ? color : palette.textSecondary,
                ),
                const SizedBox(width: 4),
              ],
              Text(
                label,
                style: TextStyle(
                  color: selected ? color : palette.textSecondary,
                  fontSize: context.fluidFont(10.5),
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildNoMatchingHostsState() {
    final palette = context.palette;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 16),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: false),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: palette.glassBorderIdle),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.filter_list_off_rounded,
            size: 28,
            color: palette.textTertiary,
          ),
          const SizedBox(height: 8),
          Text(
            'No workstations match the current filter.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: palette.textPrimary,
              fontWeight: FontWeight.w700,
              fontSize: context.fluidFont(13),
            ),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            key: const ValueKey('fleet-reset-filters-btn'),
            onPressed: () {
              _hapticTap();
              _fleetSearchController.clear();
              setState(() {
                _fleetSearchQuery = '';
                _fleetFilter = _FleetStatusFilter.all;
              });
            },
            icon: const Icon(Icons.clear_all_rounded, size: 16),
            label: const Text('Reset Filters'),
          ),
        ],
      ),
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

  Future<void> _sendQuickAudioAction(
    HostState host,
    String action, {
    required String successMessage,
  }) async {
    _hapticTap();
    HostConnectionClient? client;
    try {
      client = await _acquireConnectedClient(host);
      if (client == null || !mounted) return;
      client.retain();
      try {
        final sent = client.sendAudioCommand(action);
        if (sent) {
          _showToast(
            successMessage,
            accentColor: action == 'lock_pc' ? context.palette.warning : null,
          );
        } else {
          _showToast(
            'Unable to send $action to ${host.name}: vault not ready.',
            accentColor: context.palette.warning,
          );
        }
      } finally {
        client.release();
      }
    } catch (e) {
      _showToast(
        'Failed to send $action to ${host.name}: $e',
        accentColor: _kDangerColor,
      );
    }
  }

  void _openHostDiagnostics(HostState host) {
    _hapticTap();
    final prefs = ref.read(appPreferencesProvider);
    final secret = _resolveSecretForHost(host);
    final effectiveFp = host.certFingerprint.trim().isNotEmpty
        ? host.certFingerprint.trim()
        : loadHostCertFingerprint(host.ip);
    final effectiveTls = host.useTls || prefs.preferTls;

    HostConnectionClient? pooledClient;
    HostConnectionSnapshot snap;
    if (secret.isNotEmpty &&
        NetworkValidators.isValidIpOrHost(host.ip) &&
        NetworkValidators.isValidPort(host.wsPort)) {
      pooledClient = HostConnectionPool.instance.acquire(
        hostIp: host.ip,
        port: host.wsPort,
        sharedSecret: secret,
        useTls: effectiveTls,
        certFingerprint: effectiveFp.isNotEmpty ? effectiveFp : null,
      );
      snap = pooledClient.snapshot;
      if (snap.phase == HostConnectionPhase.disconnected && host.isOnline) {
        snap = HostConnectionSnapshot(
          latencyMs: host.latencyMs,
          phase: HostConnectionPhase.disconnected,
        );
      }
    } else {
      snap = HostConnectionSnapshot(
        latencyMs: host.latencyMs,
        phase: secret.isEmpty
            ? HostConnectionPhase.authFailed
            : HostConnectionPhase.disconnected,
        errorMessage: secret.isEmpty
            ? 'Pairing secret required before connecting to ${host.name}.'
            : null,
      );
    }

    unawaited(
      ConnectionDiagnosticsSheet.show(
        context,
        hostName: host.name,
        hostIp: host.ip,
        wsPort: host.wsPort,
        useTls: effectiveTls,
        snapshot: snap,
        currentFps: prefs.targetFps,
        qualityPreset: prefs.streamQualityPreset,
        onReconnect: () {
          if (pooledClient != null) {
            unawaited(
              pooledClient.reconnectNow().then((_) {
                if (!mounted) return;
                ref.read(historyProvider.notifier).recordConnection(
                      hostIp: host.ip,
                      hostName: host.name,
                      mac: host.mac,
                      success: true,
                      event: 'Manual reconnect succeeded',
                      port: host.wsPort,
                      latencyMs: pooledClient?.latencyMs,
                    );
              }).catchError((Object e) {
                if (!mounted) return;
                ref.read(historyProvider.notifier).recordConnection(
                      hostIp: host.ip,
                      hostName: host.name,
                      mac: host.mac,
                      success: false,
                      event: 'Manual reconnect failed: $e',
                      port: host.wsPort,
                    );
                _showToast(
                  'Reconnect failed: $e',
                  accentColor: _kDangerColor,
                );
              }),
            );
          } else {
            unawaited(_showHostEditorDialog(existing: host));
          }
        },
        onRequestKeyframe: pooledClient != null
            ? () {
                pooledClient?.requestKeyframe();
              }
            : null,
      ),
    );
  }

  Future<void> _rerunHistoryCommand(ActivityHistoryEntry entry) async {
    final rawCmd = entry.meta['command']?.toString().trim() ?? '';
    final cmd = rawCmd.isNotEmpty ? rawCmd : entry.detail.trim();
    if (cmd.isEmpty) {
      _showToast(
        'No command payload to re-run.',
        accentColor: context.palette.warning,
      );
      return;
    }
    final hosts = ref.read(fleetProvider);
    final selectedId = ref.read(selectedHostIdProvider);
    HostState? targetHost;
    if (entry.hostIp.trim().isNotEmpty) {
      targetHost =
          hosts.where((h) => h.ip.trim() == entry.hostIp.trim()).firstOrNull;
    }
    targetHost ??= hosts.where((h) => h.id == selectedId).firstOrNull;
    targetHost ??= hosts.isNotEmpty ? hosts.first : null;
    if (targetHost != null) {
      ref.read(selectedHostIdProvider.notifier).state = targetHost.id;
    }
    setState(() => _currentTabIndex = 1);
    await _dispatchCommand(cmd, targetHost);
  }

  void _importSanitizedHosts(List<Map<String, dynamic>> rawHosts) {
    final fleetNotifier = ref.read(fleetProvider.notifier);
    final existingByIp = <String, HostState>{
      for (final h in ref.read(fleetProvider)) h.ip: h,
    };
    for (final raw in rawHosts) {
      final parsed = HostState.fromSavedMap(raw);
      if (parsed == null) continue;
      final existing = existingByIp[parsed.ip];
      if (existing != null) {
        fleetNotifier.editHost(
          existing.id,
          name: parsed.name,
          ip: parsed.ip,
          wsPort: parsed.wsPort,
          mac: parsed.mac,
          useTls: parsed.useTls,
        );
        if (parsed.isPinned) {
          fleetNotifier.setHostPinned(existing.id, true);
        }
      } else {
        fleetNotifier.addHost(parsed);
      }
    }
  }

  Widget _buildDeviceCardFor(
    HostState host, {
    required bool preferTls,
    required int cardSnapshotIntervalSec,
    bool isSelected = false,
  }) {
    final bool isExpanded = _expandedHostId == host.id;
    final effectiveFp = host.certFingerprint.trim().isNotEmpty
        ? host.certFingerprint.trim()
        : loadHostCertFingerprint(host.ip);
    final effectiveSecret = _resolveSecretForHost(host);

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
      isPinned: host.isPinned,
      onTogglePin: () => _togglePinHost(host),
      onCopyText: (label, value) {
        _hapticTap();
        _showToast(
          'Copied $label: $value',
          accentColor: context.palette.success,
        );
      },
      useTls: host.useTls || preferTls,
      isExpanded: isExpanded,
      onToggleExpand: () {
        _hapticTap();
        ref.read(selectedHostIdProvider.notifier).state = host.id;
        setState(() {
          _expandedHostId = _expandedHostId == host.id ? null : host.id;
        });
      },
      expandedPreview: isExpanded
          ? HostSnapshotPreview(
              hostId: host.id,
              hostName: host.name,
              hostIp: host.ip,
              wsPort: host.wsPort,
              sharedSecret: effectiveSecret,
              useTls: host.useTls || preferTls,
              certFingerprint: effectiveFp.isNotEmpty ? effectiveFp : null,
              isOnline: host.isOnline,
              mac: host.mac,
              refreshIntervalSec: cardSnapshotIntervalSec,
              onTapFullscreen: () => _openStreamScreen(host),
              onWakeOnLan: () => _sendWakeOnLan(
                host.mac,
                targetIp: host.ip,
                hostName: host.name,
              ),
              onCopyMac: () {
                _hapticTap();
                _showToast(
                  'Copied MAC: ${host.mac.toUpperCase()}',
                  accentColor: context.palette.success,
                );
              },
            )
          : null,
      osName: host.osName,
      cpuCores: host.cpuCores,
      ramUsedGb: host.ramUsedGb,
      ramTotalGb: host.ramTotalGb,
      diskUsage: host.diskUsage,
      uptimeSec: host.uptimeSec,
      wsPort: host.wsPort,
      viewOnlyMode: host.viewOnlyMode,
      onTap: () {
        ref.read(selectedHostIdProvider.notifier).state = host.id;
        if (host.isOnline) _openStreamScreen(host);
      },
      onWakeOnLan: () => _sendWakeOnLan(
        host.mac,
        targetIp: host.ip,
        hostName: host.name,
      ),
      onOpenStream: () => _openStreamScreen(host),
      onOpenFullscreen: () => _openStreamScreen(host),
      onOpenTerminal: () {
        _hapticTap();
        ref.read(selectedHostIdProvider.notifier).state = host.id;
        setState(() => _currentTabIndex = 1);
      },
      onSyncClipboard: () => _showHostClipboardActions(host),
      onToggleMute: () => _sendQuickAudioAction(
        host,
        'mute',
        successMessage: 'Toggled mute on ${host.name}.',
      ),
      onLockPc: () => _sendQuickAudioAction(
        host,
        'lock_pc',
        successMessage: 'Sent lock_pc command to ${host.name}.',
      ),
      onOpenDiagnostics: () => _openHostDiagnostics(host),
      onLongPress: () => _showHostActionsSheet(host),
      onMoreActions: () => _showHostActionsSheet(host),
    );
  }

  // -------------------------------------------------------------------
  // 1. COMPACT FLEET VIEW (SINGLE COLUMN SCROLL + PULL TO REFRESH)
  // -------------------------------------------------------------------
  Widget _buildCompactListFleet(List<HostState> hosts) {
    final fleetPrefs = ref.watch(
      appPreferencesProvider.select(
        (p) => (
          preferTls: p.preferTls,
          cardSnapshotIntervalSec: p.cardSnapshotIntervalSec,
          fleetSortMode: p.fleetSortMode,
        ),
      ),
    );
    final filtered = _filteredHosts(hosts, sortMode: fleetPrefs.fleetSortMode);
    return RefreshIndicator(
      onRefresh: hosts.isEmpty ? _scanForPcs : _pingAllHosts,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        padding: FluidSize.pagePadding(context),
        children: [
          _buildOnboardingBanner(),
          _buildFleetToolbar(hosts, sortMode: fleetPrefs.fleetSortMode),
          if (hosts.isEmpty)
            _buildEmptyFleetState()
          else if (filtered.isEmpty)
            _buildNoMatchingHostsState()
          else
            ...filtered.map(
              (host) => _buildDeviceCardFor(
                host,
                preferTls: fleetPrefs.preferTls,
                cardSnapshotIntervalSec: fleetPrefs.cardSnapshotIntervalSec,
              ),
            ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // 2. MEDIUM FLEET VIEW (RESPONSIVE NON-CLIPPING 2-COLUMN LAYOUT)
  // -------------------------------------------------------------------
  Widget _buildMediumGridFleet(List<HostState> hosts) {
    final fleetPrefs = ref.watch(
      appPreferencesProvider.select(
        (p) => (
          preferTls: p.preferTls,
          cardSnapshotIntervalSec: p.cardSnapshotIntervalSec,
          fleetSortMode: p.fleetSortMode,
        ),
      ),
    );
    final filtered = _filteredHosts(hosts, sortMode: fleetPrefs.fleetSortMode);
    final pad = FluidSize.pagePadding(context);

    return RefreshIndicator(
      onRefresh: hosts.isEmpty ? _scanForPcs : _pingAllHosts,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final isTwoCol = constraints.maxWidth >= 460;
          final List<Widget> fleetItems;
          if (hosts.isEmpty) {
            fleetItems = [_buildEmptyFleetState()];
          } else if (filtered.isEmpty) {
            fleetItems = [_buildNoMatchingHostsState()];
          } else if (!isTwoCol) {
            fleetItems = [
              for (final host in filtered)
                _buildDeviceCardFor(
                  host,
                  preferTls: fleetPrefs.preferTls,
                  cardSnapshotIntervalSec: fleetPrefs.cardSnapshotIntervalSec,
                ),
            ];
          } else {
            fleetItems = <Widget>[];
            int i = 0;
            while (i < filtered.length) {
              final current = filtered[i];
              if (current.id == _expandedHostId) {
                fleetItems.add(
                  _buildDeviceCardFor(
                    current,
                    preferTls: fleetPrefs.preferTls,
                    cardSnapshotIntervalSec: fleetPrefs.cardSnapshotIntervalSec,
                  ),
                );
                i += 1;
                continue;
              }
              final hasPair = i + 1 < filtered.length &&
                  filtered[i + 1].id != _expandedHostId;
              fleetItems.add(
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: _buildDeviceCardFor(
                        current,
                        preferTls: fleetPrefs.preferTls,
                        cardSnapshotIntervalSec:
                            fleetPrefs.cardSnapshotIntervalSec,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: hasPair
                          ? _buildDeviceCardFor(
                              filtered[i + 1],
                              preferTls: fleetPrefs.preferTls,
                              cardSnapshotIntervalSec:
                                  fleetPrefs.cardSnapshotIntervalSec,
                            )
                          : const SizedBox.shrink(),
                    ),
                  ],
                ),
              );
              i += hasPair ? 2 : 1;
            }
          }

          return ListView(
            physics: const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            padding: pad,
            children: [
              _buildOnboardingBanner(),
              _buildFleetToolbar(hosts, sortMode: fleetPrefs.fleetSortMode),
              ...fleetItems,
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
    final fleetPrefs = ref.watch(
      appPreferencesProvider.select(
        (p) => (
          preferTls: p.preferTls,
          cardSnapshotIntervalSec: p.cardSnapshotIntervalSec,
          fleetSortMode: p.fleetSortMode,
        ),
      ),
    );
    final filtered = _filteredHosts(hosts, sortMode: fleetPrefs.fleetSortMode);
    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      children: [
        _buildOnboardingBanner(),
        _buildFleetToolbar(hosts, sortMode: fleetPrefs.fleetSortMode),
        if (hosts.isEmpty)
          _buildEmptyFleetState()
        else if (filtered.isEmpty)
          _buildNoMatchingHostsState()
        else
          ...filtered.map(
            (host) => _buildDeviceCardFor(
              host,
              preferTls: fleetPrefs.preferTls,
              cardSnapshotIntervalSec: fleetPrefs.cardSnapshotIntervalSec,
              isSelected: host.id == selectedId,
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
      instantTapMode,
      longPressDelayMs,
      scrollSensitivity,
      naturalScroll,
      pinchZoomEnabled,
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
          p.instantTapMode,
          p.longPressDelayMs,
          p.scrollSensitivity,
          p.naturalScroll,
          p.pinchZoomEnabled,
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
                      instantTapMode: instantTapMode,
                      longPressDelayMs: longPressDelayMs,
                      scrollSensitivity: scrollSensitivity,
                      naturalScroll: naturalScroll,
                      pinchZoomEnabled: pinchZoomEnabled,
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
                                  color: palette.onWarning,
                                ),
                                label: const Text('WAKE ON LAN (WoL)'),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: palette.warning,
                                  foregroundColor: palette.onWarning,
                                ),
                                onPressed: () => _sendWakeOnLan(
                                  host.mac,
                                  targetIp: host.ip,
                                  hostName: host.name,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
            ),
          ),
        );

        final switcherDuration = MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 240);
        return Padding(
          padding: EdgeInsets.all(pad),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AnimatedSwitcher(
                duration: switcherDuration,
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
              child: ValueListenableBuilder<TextEditingValue>(
                valueListenable: _commandController,
                builder: (context, cmdVal, _) {
                  return TextField(
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
                      suffixIcon: cmdVal.text.isNotEmpty
                          ? IconButton(
                              tooltip: 'Clear command',
                              icon: const Icon(Icons.close_rounded, size: 17),
                              onPressed: () => _commandController.clear(),
                            )
                          : null,
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
                  );
                },
              ),
            ),
            const SizedBox(width: 8),
            FluidPressScale(
              pressedScale: 0.91,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: primary,
                  foregroundColor: palette.onPrimary,
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
                      _commandController.value = TextEditingValue(
                        text: item,
                        selection: TextSelection.collapsed(offset: item.length),
                      );
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
    final hosts = ref.read(fleetProvider);
    final selectedId = ref.read(selectedHostIdProvider);
    HostState? targetHost;
    if (hosts.isNotEmpty) {
      targetHost = hosts.firstWhere(
        (h) => h.id == selectedId,
        orElse: () => hosts.first,
      );
    }

    final result = await showDialog<
        ({bool? pinPaired, String nextSecret})>(
      context: context,
      builder: (_) => _PairingSecretDialog(
        targetHost: targetHost,
        onSubmit: ({required String secretInput, required String pin}) async {
          String nextSecret = secretInput;
          String? nextCertFp = targetHost?.certFingerprint;
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
            saveHostPairingSecret(
              targetHost?.ip ?? '',
              nextSecret,
              certFingerprint: nextCertFp,
            );
            if (mounted) {
              ref.read(globalPairingSecretProvider.notifier).state = nextSecret;
              if (targetHost != null) {
                ref.read(fleetProvider.notifier).setHostSecret(
                      targetHost.ip,
                      nextSecret,
                      certFingerprint: nextCertFp,
                    );
              }
            }
          }
          return (pinPaired: pinPaired, nextSecret: nextSecret);
        },
      ),
    );
    if (result == null || !mounted) return;
    if (result.pinPaired != null) {
      _showToast(
        result.pinPaired!
            ? 'Paired with ${targetHost?.ip} — session token saved.'
            : 'PIN pairing failed — verify the 6-digit PIN on the PC daemon.',
        accentColor: result.pinPaired!
            ? context.palette.success
            : context.palette.warning,
      );
    } else if (result.nextSecret.isNotEmpty) {
      _showToast(
        'Pairing token stored in secure local vault.',
        accentColor: context.palette.success,
      );
    }
  }

  Future<void> _showDiscoveryPortDialog(int currentPort) async {
    final int? parsed = await showDialog<int>(
      context: context,
      builder: (_) => _ScanPortDialog(initialPort: currentPort),
    );
    if (parsed == null || !mounted) return;
    unawaited(
      ref.read(appPreferencesProvider.notifier).setCustomScanPort(parsed),
    );
    _showToast('Default scan port updated to $parsed');
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
      accentColor: context.palette.warning,
    );
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

  Widget _buildSettingsTab(List<HostState> hosts) {
    final savedSecret = ref.watch(globalPairingSecretProvider);
    final hasSecret = savedSecret.trim().isNotEmpty ||
        hosts.any((h) => h.sharedSecret.trim().isNotEmpty);

    return SettingsCommandDeck(
      hosts: hosts
          .map(
            (h) => SettingsHostSummary(
              id: h.id,
              name: h.name,
              ip: h.ip,
              wsPort: h.wsPort,
              mac: h.mac,
              isOnline: h.isOnline,
              osName: h.osName,
              useTls: h.useTls,
              isPinned: h.isPinned,
            ),
          )
          .toList(growable: false),
      savedGlobalSecret: savedSecret,
      hasConfiguredSecretOverride: hasSecret,
      onOpenPairingDialog: _showPairingSecretDialog,
      onOpenDiscoveryPortDialog: _showDiscoveryPortDialog,
      onConfirmPurgeAllSecrets: _confirmPurgeAllSecrets,
      onOpenOnboardingGuide: () => AdaptiveOnboardingSheet.show(
        context,
        onCompleted: () =>
            ref.read(appPreferencesProvider.notifier).setOnboardingCompleted(true),
      ),
      onImportSanitizedHosts: _importSanitizedHosts,
      onRerunCommand: _rerunHistoryCommand,
      onDispatchWol: _dispatchWolCore,
      onToast: (message, {Color? accentColor}) =>
          _showToast(message, accentColor: accentColor),
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

class _HostEditorDialog extends StatefulWidget {
  final HostState? existing;
  final int defaultPort;
  final String defaultSecret;
  final bool defaultTls;
  final Future<bool> Function(String rawLink) onPastePairingLink;
  final Future<String?> Function({
    required String name,
    required String ip,
    required int port,
    required String normalizedMac,
    required String rawSecret,
    required bool useTls,
  }) onSave;

  const _HostEditorDialog({
    required this.existing,
    required this.defaultPort,
    required this.defaultSecret,
    required this.defaultTls,
    required this.onPastePairingLink,
    required this.onSave,
  });

  @override
  State<_HostEditorDialog> createState() => _HostEditorDialogState();
}

class _HostEditorDialogState extends State<_HostEditorDialog> {
  late final TextEditingController _nameCtrl;
  late final TextEditingController _ipCtrl;
  late final TextEditingController _portCtrl;
  late final TextEditingController _macCtrl;
  late final TextEditingController _secretCtrl;
  late bool _useTls;
  String? _validationError;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    _nameCtrl = TextEditingController(text: existing?.name ?? '');
    _ipCtrl = TextEditingController(text: existing?.ip ?? '');
    _portCtrl = TextEditingController(text: widget.defaultPort.toString());
    _macCtrl = TextEditingController(
      text: (existing != null && existing.mac != '00:00:00:00:00:00')
          ? existing.mac
          : '',
    );
    _secretCtrl = TextEditingController(text: widget.defaultSecret);
    _useTls = widget.defaultTls;
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _ipCtrl.dispose();
    _portCtrl.dispose();
    _macCtrl.dispose();
    _secretCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dlgPalette = context.palette;
    final primary = dlgPalette.primary;
    final existing = widget.existing;
    final secretTrimmed = _secretCtrl.text.trim();

    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
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
              controller: _nameCtrl,
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
                    controller: _ipCtrl,
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
                    controller: _portCtrl,
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
              controller: _macCtrl,
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
              controller: _secretCtrl,
              obscureText: secretTrimmed.length > 6 &&
                  !RegExp(r'^\d+$').hasMatch(secretTrimmed),
              onChanged: (_) => setState(() {}),
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
                icon: Icon(Icons.qr_code_2_rounded, size: 16, color: primary),
                label: Text(
                  'Paste Pairing Link from Clipboard',
                  style: TextStyle(color: primary, fontSize: 11.5),
                ),
                onPressed: _isSaving
                    ? null
                    : () async {
                        final nav = Navigator.of(context);
                        final clip = await Clipboard.getData('text/plain');
                        final txt = clip?.text?.trim() ?? '';
                        if (txt.isEmpty || !mounted) return;
                        final ok = await widget.onPastePairingLink(txt);
                        if (ok && nav.mounted) {
                          nav.pop();
                        } else if (mounted) {
                          setState(() {
                            _validationError =
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
              value: _useTls,
              onChanged:
                  _isSaving ? null : (v) => setState(() => _useTls = v),
            ),
            if (_validationError != null) ...[
              const SizedBox(height: 10),
              Text(
                _validationError!,
                style: const TextStyle(color: _kDangerColor, fontSize: 11.5),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: Text(
            'Cancel',
            style: TextStyle(color: dlgPalette.textSecondary),
          ),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: primary,
            foregroundColor: dlgPalette.onPrimary,
          ),
          onPressed: _isSaving
              ? null
              : () async {
                  final ip = _ipCtrl.text.trim();
                  final parsedPort = int.tryParse(_portCtrl.text.trim());
                  final rawMac = _macCtrl.text.trim();

                  if (!NetworkValidators.isValidIpOrHost(ip)) {
                    setState(() {
                      _validationError =
                          'Enter a valid IPv4 address or LAN hostname.';
                    });
                    return;
                  }
                  if (!NetworkValidators.isValidPort(parsedPort)) {
                    setState(() {
                      _validationError = 'Port must be between 1 and 65535.';
                    });
                    return;
                  }

                  String normalizedMac = '00:00:00:00:00:00';
                  if (rawMac.isNotEmpty) {
                    final maybeMac = NetworkValidators.normalizeMac(rawMac);
                    if (maybeMac == null) {
                      setState(() {
                        _validationError =
                            'MAC must be 12 hex characters (AA:BB:CC:DD:EE:FF).';
                      });
                      return;
                    }
                    normalizedMac = maybeMac;
                  }

                  setState(() {
                    _validationError = null;
                    _isSaving = true;
                  });

                  final name = _nameCtrl.text.trim().isNotEmpty
                      ? NetworkValidators.sanitizeLabel(_nameCtrl.text)
                      : 'PC-$ip';

                  final navigator = Navigator.of(context);
                  final err = await widget.onSave(
                    name: name,
                    ip: ip,
                    port: parsedPort!,
                    normalizedMac: normalizedMac,
                    rawSecret: _secretCtrl.text.trim(),
                    useTls: _useTls,
                  );
                  if (!mounted) return;
                  if (err != null) {
                    setState(() {
                      _isSaving = false;
                      _validationError = err;
                    });
                    return;
                  }
                  navigator.pop();
                },
          child: Text(
            _isSaving
                ? 'Pairing...'
                : (existing == null ? 'Save PC' : 'Update PC'),
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
      ],
    );
  }
}

class _SendFileDialog extends StatefulWidget {
  final String hostName;

  const _SendFileDialog({required this.hostName});

  @override
  State<_SendFileDialog> createState() => _SendFileDialogState();
}

class _SendFileDialogState extends State<_SendFileDialog> {
  late final TextEditingController _pathCtrl;
  late final TextEditingController _noteNameCtrl;
  late final TextEditingController _noteBodyCtrl;

  @override
  void initState() {
    super.initState();
    _pathCtrl = TextEditingController();
    _noteNameCtrl = TextEditingController(text: 'mobile_note.txt');
    _noteBodyCtrl = TextEditingController();
  }

  @override
  void dispose() {
    _pathCtrl.dispose();
    _noteNameCtrl.dispose();
    _noteBodyCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dlgPalette = context.palette;
    return AlertDialog(
      backgroundColor: dlgPalette.surfaceElevated,
      title: Text('Send Encrypted File -> ${widget.hostName}'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _pathCtrl,
              decoration: const InputDecoration(
                labelText: 'Local File Path (optional)',
                hintText: '/storage/emulated/0/Download/file.bin',
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'Or send a text note payload directly:',
              style: TextStyle(fontSize: 11, color: dlgPalette.textSecondary),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _noteNameCtrl,
              decoration: const InputDecoration(labelText: 'Target Filename'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _noteBodyCtrl,
              maxLines: 3,
              decoration:
                  const InputDecoration(labelText: 'Quick Text Content'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: dlgPalette.primary,
            foregroundColor: dlgPalette.onPrimary,
          ),
          onPressed: () {
            final noteName = _noteNameCtrl.text.trim().isNotEmpty
                ? _noteNameCtrl.text.trim()
                : 'mobile_note.txt';
            Navigator.of(context).pop((
              filePath: _pathCtrl.text.trim(),
              noteName: noteName,
              noteBody: _noteBodyCtrl.text,
            ));
          },
          child: const Text('Send AEAD'),
        ),
      ],
    );
  }
}

class _PairingSecretDialog extends StatefulWidget {
  final HostState? targetHost;
  final Future<({bool? pinPaired, String nextSecret})> Function({
    required String secretInput,
    required String pin,
  }) onSubmit;

  const _PairingSecretDialog({
    required this.targetHost,
    required this.onSubmit,
  });

  @override
  State<_PairingSecretDialog> createState() => _PairingSecretDialogState();
}

class _PairingSecretDialogState extends State<_PairingSecretDialog> {
  late final TextEditingController _secretCtrl;
  late final TextEditingController _pinCtrl;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _secretCtrl = TextEditingController();
    _pinCtrl = TextEditingController();
  }

  @override
  void dispose() {
    _secretCtrl.dispose();
    _pinCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dlgPalette = context.palette;
    final primary = dlgPalette.primary;
    final targetHost = widget.targetHost;
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
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
            controller: _secretCtrl,
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
              controller: _pinCtrl,
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
          onPressed: _isSaving ? null : () => Navigator.of(context).pop(),
          child: Text(
            'Cancel',
            style: TextStyle(color: dlgPalette.textSecondary),
          ),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: primary,
            foregroundColor: dlgPalette.onPrimary,
          ),
          onPressed: _isSaving
              ? null
              : () async {
                  final navigator = Navigator.of(context);
                  setState(() => _isSaving = true);
                  final res = await widget.onSubmit(
                    secretInput: _secretCtrl.text.trim(),
                    pin: _pinCtrl.text.trim(),
                  );
                  if (!mounted) return;
                  navigator.pop(res);
                },
          child: Text(
            _isSaving ? 'Pairing...' : 'Save & Pair',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
      ],
    );
  }
}

class _ScanPortDialog extends StatefulWidget {
  final int initialPort;

  const _ScanPortDialog({required this.initialPort});

  @override
  State<_ScanPortDialog> createState() => _ScanPortDialogState();
}

class _ScanPortDialogState extends State<_ScanPortDialog> {
  late final TextEditingController _portCtrl;
  String? _errorMsg;

  @override
  void initState() {
    super.initState();
    _portCtrl = TextEditingController(text: widget.initialPort.toString());
  }

  @override
  void dispose() {
    _portCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return AlertDialog(
      backgroundColor: palette.surfaceElevated,
      title: const Text('LAN Discovery Port'),
      content: TextField(
        controller: _portCtrl,
        keyboardType: TextInputType.number,
        decoration: InputDecoration(
          labelText: 'TCP WebSocket Port',
          hintText: '8765',
          errorText: _errorMsg,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: palette.primary,
            foregroundColor: palette.onPrimary,
          ),
          onPressed: () {
            final parsed = int.tryParse(_portCtrl.text.trim());
            if (!NetworkValidators.isValidPort(parsed)) {
              setState(() => _errorMsg = 'Enter a valid port (1 - 65535)');
              return;
            }
            Navigator.of(context).pop(parsed);
          },
          child: const Text('Save'),
        ),
      ],
    );
  }
}
