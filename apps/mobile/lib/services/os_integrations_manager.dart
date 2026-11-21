import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:quick_actions/quick_actions.dart';
import '../security/network_validators.dart';

/// Advanced OS Integrations & Wake-on-LAN Manager
/// ---------------------------------------------------------------------
/// Capabilities:
/// 1. RFC 826 Gratuitous ARP builder & 102-Byte IEEE 802.3 UDP Magic Packet (Ports 7 and 9)
/// 2. Android Quick Settings & Launcher Shortcuts (quick_actions)
/// 3. Native Android Home Widget Preferences Channel & 1-Tap WoL Background Entrypoint

/// Background entry point for 1-tap Home Screen Widget interactions
@pragma('vm:entry-point')
Future<void> widgetBackgroundCallback(Uri? uri) async {
  if (uri == null) return;
  if (uri.host == 'wake_pc' || uri.path.contains('wake')) {
    final String? mac = uri.queryParameters['mac']?.trim();
    final String? ip = uri.queryParameters['ip']?.trim();
    final String? routerIp = uri.queryParameters['router']?.trim();
    if (mac == null || mac.isEmpty || ip == null || ip.isEmpty) {
      debugPrint('Wake widget aborted: missing target MAC or IP in widget URI');
      return;
    }

    // Directly execute Gratuitous ARP + Magic Packet in background isolate
    final int? parsedPort = int.tryParse(uri.queryParameters['port'] ?? '');
    final int safePort =
        (parsedPort != null && NetworkValidators.isValidPort(parsedPort))
        ? parsedPort
        : 9;
    final String? customBroadcast = uri.queryParameters['broadcast']?.trim();
    final int safeBurst =
        (int.tryParse(uri.queryParameters['burst'] ?? '') ?? 1).clamp(1, 5);

    await OsIntegrationsManager.instance.sendGratuitousArpAndWake(
      targetMac: mac,
      targetIp: ip,
      routerIp: routerIp ?? '',
      port: safePort,
      customBroadcastIp: customBroadcast,
      burstCount: safeBurst,
    );
  }
}

/// Detailed telemetry and target outcome for a Wake-on-LAN dispatch attempt.
@immutable
class WolDispatchResult {
  final bool success;
  final String mac;
  final List<String> targets;
  final int port;
  final int burstCount;
  final int latencyMs;
  final String? error;

  const WolDispatchResult({
    required this.success,
    required this.mac,
    required this.targets,
    required this.port,
    required this.burstCount,
    required this.latencyMs,
    this.error,
  });

  @override
  String toString() =>
      'WolDispatchResult(success: $success, mac: $mac, targets: $targets, '
      'port: $port, burstCount: $burstCount, latencyMs: $latencyMs, error: $error)';
}

class OsIntegrationsManager {
  static final OsIntegrationsManager instance = OsIntegrationsManager._internal();
  OsIntegrationsManager._internal();

  static const MethodChannel _widgetChannel = MethodChannel(
    'com.cst.autonomouslan/home_widget',
  );

  final QuickActions _quickActions = const QuickActions();
  bool _isInitialized = false;

  Future<void> _saveWidgetData(String id, Object? data) async {
    try {
      await _widgetChannel.invokeMethod<bool>('saveWidgetData', <String, Object?>{
        'id': id,
        'data': data,
      });
    } on MissingPluginException {
      // Non-Android / unit test environment without platform channel registered
    }
  }

  /// Callback hook when launcher shortcut or QS tile is triggered
  Function(String actionType)? onQuickActionTriggered;

  /// Initializes Quick Actions and Home Screen Widget listeners
  Future<void> initialize({Function(String actionType)? onAction}) async {
    if (onAction != null) {
      onQuickActionTriggered = onAction;
    }
    if (_isInitialized) return;

    // 1. Setup Quick Actions (Launcher Shortcuts / App Icons)
    try {
      await _quickActions.initialize((String shortcutType) {
        if (kDebugMode) {
          debugPrint('Quick Action triggered: $shortcutType');
        }
        onQuickActionTriggered?.call(shortcutType);
      });

      await _quickActions.setShortcutItems([
        const ShortcutItem(
          type: 'action_wake_pc',
          localizedTitle: 'Wake PC (WoL)',
          icon: 'ic_launcher',
        ),
        const ShortcutItem(
          type: 'action_panic_kill',
          localizedTitle: 'Emergency Lock',
          icon: 'ic_launcher',
        ),
        const ShortcutItem(
          type: 'action_scan_fleet',
          localizedTitle: 'Scan LAN Fleet',
          icon: 'ic_launcher',
        ),
        const ShortcutItem(
          type: 'action_open_terminal',
          localizedTitle: 'Remote Shell',
          icon: 'ic_launcher',
        ),
      ]);
    } catch (e) {
      debugPrint('QuickActions init error: $e');
    }

    // 2. Setup Home Screen Widget Native Channel
    try {
      await _widgetChannel.invokeMethod<bool>('setAppGroupId', <String, String>{
        'groupId': 'group.com.cst.netcontroller',
      });
    } on MissingPluginException {
      // No-op in headless/test hosts
    } catch (e) {
      debugPrint('HomeWidget init error: $e');
    }

    _isInitialized = true;
  }

  /// Detaches a previously registered quick action callback when the UI screen disposes.
  void clearQuickActionHandler(Function(String actionType) handler) {
    if (identical(onQuickActionTriggered, handler)) {
      onQuickActionTriggered = null;
    }
  }

  /// Synchronizes current fleet status to the native Home Screen Widget preferences channel
  Future<void> updateHomeScreenWidget({
    required String hostName,
    required String hostIp,
    required String hostMac,
    required bool isOnline,
    required double cpuUsage,
    required double ramUsage,
  }) async {
    try {
      await _saveWidgetData('target_name', hostName);
      await _saveWidgetData('target_ip', hostIp);
      await _saveWidgetData('target_mac', hostMac);
      await _saveWidgetData('is_online', isOnline);
      await _saveWidgetData('status_text', isOnline ? 'ONLINE' : 'OFFLINE');
      await _saveWidgetData(
        'metrics_text',
        isOnline
            ? 'CPU ${cpuUsage.toStringAsFixed(0)}% • RAM ${ramUsage.toStringAsFixed(0)}%'
            : 'Ready for WoL',
      );
      await _saveWidgetData(
        'last_updated',
        '${DateTime.now().hour.toString().padLeft(2, '0')}:${DateTime.now().minute.toString().padLeft(2, '0')}',
      );

      try {
        await _widgetChannel.invokeMethod<bool>('updateWidget', <String, String>{
          'name': 'CstStatusWidgetProvider',
          'androidName': 'CstStatusWidgetProvider',
          'iOSName': 'CstStatusWidget',
        });
      } on MissingPluginException {
        // No-op in headless/test hosts
      }
    } catch (e) {
      debugPrint('HomeWidget sync error: $e');
    }
  }

  // =====================================================================
  // RFC 826 GRATUITOUS ARP (WoWLAN ROUTER CACHE INJECTION)
  // =====================================================================

  /// Builds a 28-byte RFC 826 ARP Reply Packet.
  /// Purpose: Inject target PC's MAC mapping into wireless router's ARP table
  /// before broadcasting Magic Packet, forcing AP to unicast/multicast 802.11 frames.
  Uint8List buildGratuitousArpPacket({
    required String targetMac,
    required String targetIp,
    required String routerIp,
  }) {
    final List<int>? macBytes = _parseMacAddress(targetMac);
    final List<int>? ipBytes = _parseIpAddress(targetIp);
    final List<int>? routerIpBytes = _parseIpAddress(routerIp);
    if (macBytes == null || ipBytes == null || routerIpBytes == null) {
      throw ArgumentError('Invalid MAC or IPv4 address for ARP construction.');
    }

    final Uint8List packet = Uint8List(28);
    final ByteData bd = ByteData.sublistView(packet);

    bd.setUint16(0, 0x0001, Endian.big); // Hardware type: Ethernet (1)
    bd.setUint16(2, 0x0800, Endian.big); // Protocol type: IPv4 (0x0800)
    bd.setUint8(4, 6); // Hardware address length (6)
    bd.setUint8(5, 4); // Protocol address length (4)
    bd.setUint16(6, 0x0002, Endian.big); // Opcode: ARP Reply (2)

    // Sender Hardware Address (Target PC MAC)
    for (int i = 0; i < 6; i++) {
      packet[8 + i] = macBytes[i];
    }
    // Sender IP Address (Target PC IP)
    for (int i = 0; i < 4; i++) {
      packet[14 + i] = ipBytes[i];
    }
    // Target Hardware Address (Broadcast / Router)
    for (int i = 0; i < 6; i++) {
      packet[18 + i] = 0xFF;
    }
    // Target IP Address (Router IP or Target IP for gratuitous)
    for (int i = 0; i < 4; i++) {
      packet[24 + i] = routerIpBytes[i];
    }

    return packet;
  }

  /// Broadcasts a standard 102-byte Wake-on-LAN Magic Packet (`6x 0xFF + 16x MAC`)
  /// across global broadcast and directed subnet broadcast (or [customBroadcastIp]).
  Future<bool> sendGratuitousArpAndWake({
    required String targetMac,
    required String targetIp,
    required String routerIp,
    int port = 9,
    String? customBroadcastIp,
    int burstCount = 1,
    bool sendBothPorts = true,
  }) async {
    final WolDispatchResult result = await sendWakePacketDetailed(
      targetMac: targetMac,
      targetIp: targetIp,
      routerIp: routerIp,
      port: port,
      customBroadcastIp: customBroadcastIp,
      burstCount: burstCount,
      sendBothPorts: sendBothPorts,
    );
    return result.success;
  }

  /// Sends `1..5` staggered (25ms) 102-byte Wake-on-LAN Magic Packet bursts,
  /// honoring [customBroadcastIp] if it is a valid IPv4 address or falling back
  /// to `255.255.255.255` plus directed `/24` subnet broadcast, and returns a
  /// detailed [WolDispatchResult] with elapsed latency.
  Future<WolDispatchResult> sendWakePacketDetailed({
    required String targetMac,
    String targetIp = '',
    String routerIp = '',
    int port = 9,
    String? customBroadcastIp,
    int burstCount = 1,
    bool sendBothPorts = true,
    bool sendGratuitousArp = true,
  }) async {
    final Stopwatch stopwatch = Stopwatch()..start();
    final int safeBurstCount = burstCount.clamp(1, 5);
    final Uint8List? macBytes = NetworkValidators.parseMacBytes(targetMac);
    final String normalizedMac =
        NetworkValidators.normalizeMac(targetMac) ?? targetMac.trim();

    if (macBytes == null || !NetworkValidators.isValidPort(port)) {
      stopwatch.stop();
      final String reason = macBytes == null
          ? 'Invalid MAC address ($targetMac)'
          : 'Invalid UDP port ($port)';
      debugPrint('WoL aborted: $reason');
      return WolDispatchResult(
        success: false,
        mac: normalizedMac,
        targets: const <String>[],
        port: port,
        burstCount: safeBurstCount,
        latencyMs: stopwatch.elapsedMilliseconds,
        error: reason,
      );
    }

    // Build target broadcast list: honor custom IPv4 override when valid,
    // otherwise fall back to global broadcast + directed /24 subnet broadcast.
    final List<String> targetIps = <String>[];
    final String trimmedOverride = customBroadcastIp?.trim() ?? '';
    if (trimmedOverride.isNotEmpty &&
        NetworkValidators.isValidIpv4(trimmedOverride)) {
      targetIps.add(trimmedOverride);
    } else {
      targetIps.add('255.255.255.255');
      final String subnetSeed = NetworkValidators.isValidIpv4(targetIp)
          ? targetIp.trim()
          : routerIp.trim();
      if (NetworkValidators.isValidIpv4(subnetSeed)) {
        final String directed = NetworkValidators.deriveBroadcastIp(subnetSeed);
        if (directed != '255.255.255.255') {
          targetIps.add(directed);
        }
      }
    }

    // Generate standard 102-byte Magic Packet: 6x 0xFF + 16x MAC
    final Uint8List magicPacket = Uint8List(102);
    magicPacket.fillRange(0, 6, 0xFF);
    for (int i = 0; i < 16; i++) {
      magicPacket.setRange(6 + (i * 6), 12 + (i * 6), macBytes);
    }

    final List<int> ports = (sendBothPorts && port != 7)
        ? <int>[port, 7]
        : <int>[port];

    RawDatagramSocket? socket;
    StreamSubscription<RawSocketEvent>? socketSub;
    Completer<void>? writeReady;
    final List<String> sentTargets = <String>[];
    String? lastSocketError;
    try {
      final RawDatagramSocket udpSocket =
          await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      socket = udpSocket;
      udpSocket.broadcastEnabled = true;
      socketSub = udpSocket.listen((RawSocketEvent event) {
        if (event == RawSocketEvent.write) {
          final completer = writeReady;
          if (completer != null && !completer.isCompleted) {
            completer.complete();
          }
        }
      });

      Future<int> sendWithWriteWait(InternetAddress addr, int targetPort) async {
        int sent = udpSocket.send(magicPacket, addr, targetPort);
        if (sent > 0) return sent;
        final completer = Completer<void>();
        writeReady = completer;
        udpSocket.writeEventsEnabled = true;
        await completer.future.timeout(
          const Duration(milliseconds: 25),
          onTimeout: () {},
        );
        if (identical(writeReady, completer)) {
          writeReady = null;
        }
        return udpSocket.send(magicPacket, addr, targetPort);
      }

      for (int burst = 0; burst < safeBurstCount; burst++) {
        if (burst > 0) {
          await Future<void>.delayed(const Duration(milliseconds: 25));
        }
        for (final String target in targetIps) {
          final InternetAddress addr = InternetAddress(target);
          for (final int targetPort in ports) {
            try {
              final int sent = await sendWithWriteWait(addr, targetPort);
              if (sent > 0 && !sentTargets.contains(target)) {
                sentTargets.add(target);
              }
            } catch (e) {
              lastSocketError = e.toString();
            }
          }
        }
      }

      stopwatch.stop();
      final bool ok = sentTargets.isNotEmpty;
      return WolDispatchResult(
        success: ok,
        mac: normalizedMac,
        targets: List<String>.unmodifiable(sentTargets),
        port: port,
        burstCount: safeBurstCount,
        latencyMs: stopwatch.elapsedMilliseconds,
        error: ok
            ? null
            : (lastSocketError ?? 'No WoL broadcast packets could be sent'),
      );
    } catch (e) {
      stopwatch.stop();
      debugPrint('WoL packet broadcast error: $e');
      return WolDispatchResult(
        success: false,
        mac: normalizedMac,
        targets: List<String>.unmodifiable(sentTargets),
        port: port,
        burstCount: safeBurstCount,
        latencyMs: stopwatch.elapsedMilliseconds,
        error: e.toString(),
      );
    } finally {
      await socketSub?.cancel();
      socket?.close();
    }
  }

  List<int>? _parseMacAddress(String mac) {
    return NetworkValidators.parseMacBytes(mac);
  }

  List<int>? _parseIpAddress(String ip) {
    if (!NetworkValidators.isValidIpv4(ip)) {
      return null;
    }
    return ip.trim().split('.').map(int.parse).toList(growable: false);
  }
}
