import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:hive_flutter/hive_flutter.dart';

/// Encrypted local storage for host credentials (`pairingToken`) and pinned TLS
/// certificate fingerprints, backed by Android Keystore (`AES/GCM/NoPadding`)
/// wrapping a 256-bit `HiveAesCipher` box key.
class SecureSecretStore {
  static final SecureSecretStore instance = SecureSecretStore();

  static const MethodChannel _keystoreChannel =
      MethodChannel('com.cst.autonomouslan/keystore');
  static const String vaultBoxName = 'ghost_vault_v2';
  static const String legacySentinel = '__KS_VAULT__';
  static const String globalHostKey = '__global__';

  final Future<Uint8List?> Function()? _customKeyProvider;
  Box<dynamic>? _vaultBox;
  final Map<String, String> _memoryFallback = <String, String>{};
  bool _initialized = false;

  SecureSecretStore({
    Future<Uint8List?> Function()? keyProvider,
  }) : _customKeyProvider = keyProvider;

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    Uint8List? masterKey;
    try {
      if (_customKeyProvider != null) {
        masterKey = await _customKeyProvider!();
      } else if (Platform.isAndroid) {
        masterKey =
            await _keystoreChannel.invokeMethod<Uint8List>('getOrCreateHiveKey');
      } else {
        // Off-Android desktop/test harness: generate an ephemeral CSPRNG key rather than unencrypted storage.
        final rnd = Random.secure();
        masterKey = Uint8List.fromList(
          List<int>.generate(32, (_) => rnd.nextInt(256)),
        );
      }
    } on MissingPluginException {
      masterKey = null;
    } catch (_) {
      masterKey = null;
    }

    if (masterKey != null && masterKey.length == 32) {
      try {
        _vaultBox = await Hive.openBox<dynamic>(
          vaultBoxName,
          encryptionCipher: HiveAesCipher(masterKey),
        );
      } catch (_) {
        _vaultBox = null;
      } finally {
        for (int i = 0; i < masterKey.length; i++) {
          masterKey[i] = 0;
        }
      }
    }
  }

  static String _tokenKey(String hostId) => 'tok:$hostId';
  static String _certKey(String hostId) => 'fp:$hostId';

  Future<void> saveToken(String hostId, String token) async {
    final String clean = token.trim();
    final String key = _tokenKey(hostId);
    if (clean.isEmpty) {
      _memoryFallback.remove(key);
    } else {
      _memoryFallback[key] = clean;
    }
    await init();
    if (_vaultBox != null) {
      if (clean.isEmpty) {
        await _vaultBox!.delete(key);
      } else {
        await _vaultBox!.put(key, clean);
      }
    }
  }

  String? getToken(String hostId) {
    final String key = _tokenKey(hostId);
    final String? cached = _memoryFallback[key];
    if (cached != null && cached.isNotEmpty && cached != legacySentinel) {
      return cached;
    }
    final String? val =
        _vaultBox != null ? _vaultBox!.get(key) as String? : null;
    if (val == null || val.isEmpty || val == legacySentinel) return null;
    _memoryFallback[key] = val;
    return val;
  }

  Future<void> saveCertFingerprint(String hostId, String? fingerprint) async {
    final String clean = (fingerprint ?? '').trim().toLowerCase();
    final String key = _certKey(hostId);
    if (clean.isEmpty) {
      _memoryFallback.remove(key);
    } else {
      _memoryFallback[key] = clean;
    }
    await init();
    if (_vaultBox != null) {
      if (clean.isEmpty) {
        await _vaultBox!.delete(key);
      } else {
        await _vaultBox!.put(key, clean);
      }
    }
  }

  String? getCertFingerprint(String hostId) {
    final String key = _certKey(hostId);
    final String? cached = _memoryFallback[key];
    if (cached != null && cached.isNotEmpty) return cached;
    final String? val =
        _vaultBox != null ? _vaultBox!.get(key) as String? : null;
    if (val == null || val.isEmpty) return null;
    _memoryFallback[key] = val;
    return val;
  }

  Future<void> deleteHostSecrets(String hostId) async {
    await init();
    if (_vaultBox != null) {
      await _vaultBox!.delete(_tokenKey(hostId));
      await _vaultBox!.delete(_certKey(hostId));
    }
    _memoryFallback.remove(_tokenKey(hostId));
    _memoryFallback.remove(_certKey(hostId));
  }

  /// Migrates legacy plaintext `token` values out of unencrypted `ghost_devices`
  /// Hive box into the AES-encrypted keystore vault and scrubs plaintext copies.
  Future<List<Map<String, dynamic>>> migrateLegacyDeviceList(
    Box<dynamic> legacyDeviceBox,
  ) async {
    await init();
    final dynamic raw = legacyDeviceBox.get('devices');
    if (raw == null || raw is! String || raw.isEmpty) {
      return const <Map<String, dynamic>>[];
    }
    final List<dynamic> decoded = jsonDecode(raw) as List<dynamic>;
    final List<Map<String, dynamic>> result = <Map<String, dynamic>>[];
    bool scrubbedLegacy = false;

    for (final dynamic item in decoded) {
      if (item is! Map) continue;
      final Map<String, dynamic> map = Map<String, dynamic>.from(item);
      final String id =
          (map['id']?.toString() ?? '${map['ip'] ?? ''}:${map['port'] ?? 8765}');
      final String rawTok = (map['token']?.toString() ?? '').trim();

      String resolvedToken = '';
      if (rawTok.isNotEmpty && rawTok != legacySentinel) {
        await saveToken(id, rawTok);
        resolvedToken = rawTok;
        map['token'] = legacySentinel;
        scrubbedLegacy = true;
      } else {
        resolvedToken = getToken(id) ?? '';
      }

      final String rawFp = (map['certFingerprint']?.toString() ?? '').trim();
      String resolvedFp = rawFp;
      if (rawFp.isNotEmpty && rawFp != legacySentinel) {
        await saveCertFingerprint(id, rawFp);
        map['certFingerprint'] = legacySentinel;
        scrubbedLegacy = true;
      } else {
        resolvedFp = getCertFingerprint(id) ?? '';
      }

      final Map<String, dynamic> hydrated = Map<String, dynamic>.from(map);
      hydrated['token'] = resolvedToken;
      hydrated['certFingerprint'] = resolvedFp;
      result.add(hydrated);
    }

    if (scrubbedLegacy) {
      final List<Map<String, dynamic>> redacted = result.map((m) {
        final copy = Map<String, dynamic>.from(m);
        if ((copy['token']?.toString() ?? '').isNotEmpty) {
          copy['token'] = legacySentinel;
        }
        if ((copy['certFingerprint']?.toString() ?? '').isNotEmpty) {
          copy['certFingerprint'] = legacySentinel;
        }
        return copy;
      }).toList();
      await legacyDeviceBox.put('devices', jsonEncode(redacted));
    }

    return result;
  }

  /// Migrates legacy pairing secret keys (`__global_pairing_secret__`, `__secret_<ip>`)
  /// plus the serialized `devices` list out of plaintext `ghost_devices` into
  /// the AES-encrypted Keystore vault and scrubs legacy copies.
  Future<void> migrateLegacyPairingKeys(Box<dynamic> legacyBox) async {
    await init();
    final dynamic globalRaw = legacyBox.get('__global_pairing_secret__');
    if (globalRaw is String) {
      final trimmed = globalRaw.trim();
      if (trimmed.isNotEmpty && trimmed != legacySentinel) {
        await saveToken(globalHostKey, trimmed);
        await legacyBox.put('__global_pairing_secret__', legacySentinel);
      }
    }

    for (final dynamic k in legacyBox.keys.toList()) {
      final String ks = k.toString();
      if (ks.startsWith('__secret_')) {
        final String ip = ks.substring('__secret_'.length);
        final dynamic v = legacyBox.get(k);
        if (v is String) {
          final String trimmed = v.trim();
          if (trimmed.isNotEmpty && trimmed != legacySentinel && ip.isNotEmpty) {
            await saveToken(ip, trimmed);
            await legacyBox.put(k, legacySentinel);
          }
        }
      }
    }

    await migrateLegacyDeviceList(legacyBox);
  }
}

final SecureSecretStore appSecretStore = SecureSecretStore.instance;
