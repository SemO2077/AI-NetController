import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../security/network_validators.dart';

/// Metadata for a PC Host Agent discovered via LAN UDP broadcast (`CST_DISCOVER_V1`).
@immutable
class DiscoveredLanHost {
  final String ip;
  final String hostname;
  final int wsPort;
  final bool useTls;
  final String os;
  final String version;
  final String mac;

  const DiscoveredLanHost({
    required this.ip,
    required this.hostname,
    this.wsPort = 8765,
    this.useTls = false,
    this.os = 'Unknown',
    this.version = '',
    this.mac = '',
  });

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is DiscoveredLanHost &&
        other.ip == ip &&
        other.hostname == hostname &&
        other.wsPort == wsPort &&
        other.useTls == useTls &&
        other.os == os &&
        other.version == version &&
        other.mac == mac;
  }

  @override
  int get hashCode =>
      Object.hash(ip, hostname, wsPort, useTls, os, version, mac);

  @override
  String toString() =>
      'DiscoveredLanHost(ip: $ip, hostname: $hostname, wsPort: $wsPort, '
      'useTls: $useTls, os: $os, version: $version, mac: $mac)';
}

/// Lightweight UDP LAN broadcast discovery client for AI NetController Host Agents.
class LanDiscoveryService {
  static const String protocolId = 'CST_DISCOVER_V1';
  static const int defaultUdpPort = 8766;
  static const int _maxPayloadBytes = 4096;
  static const int _maxFieldLength = 128;

  static String _sanitizeText(Object? raw, {required String fallback}) {
    if (raw is! String) return fallback;
    final cleaned = raw
        .replaceAll(RegExp(r'[\x00-\x1F\x7F]'), '')
        .trim();
    if (cleaned.isEmpty) return fallback;
    if (cleaned.length <= _maxFieldLength) return cleaned;
    return cleaned.substring(0, _maxFieldLength);
  }

  /// Pure parser for a single UDP discovery JSON response.
  ///
  /// Uses [sourceIp] as the authoritative host IP (ignoring any untrusted IP
  /// fields inside the JSON payload) and never parses or retains secrets.
  static DiscoveredLanHost? parseDiscoveryPayload(String raw, String sourceIp) {
    final String cleanIp = sourceIp.trim();
    if (cleanIp.isEmpty || InternetAddress.tryParse(cleanIp) == null) {
      return null;
    }
    if (raw.isEmpty || raw.length > _maxPayloadBytes) {
      return null;
    }

    try {
      final dynamic decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) {
        return null;
      }
      if (decoded['protocol'] != protocolId) {
        return null;
      }

      int wsPort = 8765;
      final dynamic rawPort = decoded.containsKey('ws_port')
          ? decoded['ws_port']
          : decoded['wsPort'];
      if (rawPort != null) {
        if (rawPort is int) {
          wsPort = rawPort;
        } else if (rawPort is num && rawPort.isFinite && rawPort == rawPort.truncate()) {
          wsPort = rawPort.toInt();
        } else {
          return null;
        }
        if (wsPort < 1 || wsPort > 65535) {
          return null;
        }
      }

      final dynamic rawTls = decoded.containsKey('tls')
          ? decoded['tls']
          : (decoded.containsKey('use_tls')
              ? decoded['use_tls']
              : decoded['useTls']);
      final bool useTls = rawTls is bool ? rawTls : false;

      final String hostname = _sanitizeText(
        decoded['hostname'],
        fallback: cleanIp,
      );
      final String os = _sanitizeText(
        decoded['os'],
        fallback: 'Unknown',
      );
      final String version = _sanitizeText(
        decoded['version'],
        fallback: '',
      );
      final dynamic rawMac = decoded['mac'];
      final String mac = rawMac is String
          ? (NetworkValidators.normalizeMac(rawMac) ?? '')
          : '';

      return DiscoveredLanHost(
        ip: cleanIp,
        hostname: hostname,
        wsPort: wsPort,
        useTls: useTls,
        os: os,
        version: version,
        mac: mac,
      );
    } catch (_) {
      return null;
    }
  }

  /// Derives deduplicated IPv4 broadcast target strings (`255.255.255.255` plus
  /// `/24` directed broadcast addresses derived from [localIpv4Addresses]).
  static List<String> deriveBroadcastTargets(
    Iterable<String> localIpv4Addresses,
  ) {
    final Set<String> targets = <String>{'255.255.255.255'};
    for (final rawIp in localIpv4Addresses) {
      final parts = rawIp.trim().split('.');
      if (parts.length != 4) continue;
      final octets = <int>[];
      bool valid = true;
      for (final p in parts) {
        final v = int.tryParse(p);
        if (v == null || v < 0 || v > 255) {
          valid = false;
          break;
        }
        octets.add(v);
      }
      if (!valid) continue;
      // Skip loopback (127.x), unspecified (0.x), and APIPA link-local (169.254.x)
      if (octets[0] == 127 ||
          octets[0] == 0 ||
          (octets[0] == 169 && octets[1] == 254)) {
        continue;
      }
      targets.add('${octets[0]}.${octets[1]}.${octets[2]}.255');
    }
    return targets.toList(growable: false);
  }

  /// Broadcasts `CST_DISCOVER_V1` over UDP and collects unique LAN hosts
  /// replying before [timeout].
  ///
  /// Gracefully returns an empty list on socket or OS permission failures.
  static Future<List<DiscoveredLanHost>> discover({
    int udpPort = defaultUdpPort,
    Duration timeout = const Duration(milliseconds: 1200),
    @visibleForTesting List<InternetAddress>? targetAddressesOverride,
  }) async {
    if (udpPort < 1 || udpPort > 65535 || timeout <= Duration.zero) {
      return const <DiscoveredLanHost>[];
    }

    RawDatagramSocket? socket;
    StreamSubscription<RawSocketEvent>? sub;
    try {
      socket = await RawDatagramSocket.bind(
        InternetAddress.anyIPv4,
        0,
        reuseAddress: true,
      );
      socket.broadcastEnabled = true;

      final List<InternetAddress> targets = <InternetAddress>[];
      if (targetAddressesOverride != null) {
        targets.addAll(targetAddressesOverride);
      } else {
        final List<String> localIps = <String>[];
        try {
          final interfaces = await NetworkInterface.list(
            type: InternetAddressType.IPv4,
            includeLoopback: false,
          );
          for (final iface in interfaces) {
            for (final addr in iface.addresses) {
              localIps.add(addr.address);
            }
          }
        } catch (_) {
          // Proceed with global 255.255.255.255 broadcast if interface listing fails.
        }
        for (final ipStr in deriveBroadcastTargets(localIps)) {
          final parsed = InternetAddress.tryParse(ipStr);
          if (parsed != null) {
            targets.add(parsed);
          }
        }
      }

      final Map<String, DiscoveredLanHost> discovered =
          <String, DiscoveredLanHost>{};

      const int maxDatagramsPerEvent = 64;
      sub = socket.listen(
        (RawSocketEvent event) {
          if (event != RawSocketEvent.read || socket == null) return;
          int processed = 0;
          while (processed < maxDatagramsPerEvent) {
            final Datagram? datagram = socket.receive();
            if (datagram == null) break;
            processed++;
            if (datagram.data.length > _maxPayloadBytes) continue;
            final String raw = utf8.decode(datagram.data, allowMalformed: true);
            final DiscoveredLanHost? host = parseDiscoveryPayload(
              raw,
              datagram.address.address,
            );
            if (host != null) {
              discovered[host.ip] = host;
            }
          }
        },
        onError: (_) {},
      );

      final List<int> probeBytes = utf8.encode(protocolId);
      void sendProbeBurst() {
        final s = socket;
        if (s == null) return;
        for (final target in targets) {
          try {
            s.send(probeBytes, target, udpPort);
          } catch (_) {
            // Ignore per-interface send errors (e.g., VPN / unroutable NIC).
          }
        }
      }

      sendProbeBurst();
      if (timeout > const Duration(milliseconds: 450)) {
        final Duration firstHalf = const Duration(milliseconds: 350);
        await Future<void>.delayed(firstHalf);
        sendProbeBurst();
        await Future<void>.delayed(timeout - firstHalf);
      } else {
        await Future<void>.delayed(timeout);
      }

      final List<DiscoveredLanHost> results = discovered.values.toList()
        ..sort((a, b) {
          final cmp = a.hostname.toLowerCase().compareTo(
            b.hostname.toLowerCase(),
          );
          return cmp != 0 ? cmp : a.ip.compareTo(b.ip);
        });
      return List<DiscoveredLanHost>.unmodifiable(results);
    } catch (_) {
      return const <DiscoveredLanHost>[];
    } finally {
      await sub?.cancel();
      socket?.close();
    }
  }
}
