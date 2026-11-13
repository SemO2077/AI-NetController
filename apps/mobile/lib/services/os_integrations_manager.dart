import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:home_widget/home_widget.dart';
import 'package:quick_actions/quick_actions.dart';
import '../security/network_validators.dart';

/// Advanced OS Integrations & Wake-on-LAN Manager
/// ---------------------------------------------------------------------
/// Capabilities:
/// 1. RFC 826 Gratuitous ARP builder & 102-Byte IEEE 802.3 UDP Magic Packet (Ports 7 and 9)
/// 2. Android Quick Settings & Launcher Shortcuts (quick_actions)
/// 3. Android/iOS Home Screen Widgets with Background Isolate 1-Tap WoL (home_widget)

/// Background entry point for 1-tap Home Screen Widget interactions
@pragma('vm:entry-point')
void widgetBackgroundCallback(Uri? uri) async {
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
    await OsIntegrationsManager.instance.sendGratuitousArpAndWake(
      targetMac: mac,
      targetIp: ip,
      routerIp: routerIp ?? '',
    );
  }
}

class OsIntegrationsManager {
  static final OsIntegrationsManager instance = OsIntegrationsManager._internal();
  OsIntegrationsManager._internal();

  final QuickActions _quickActions = const QuickActions();
  bool _isInitialized = false;

  /// Callback hook when launcher shortcut or QS tile is triggered
  Function(String actionType)? onQuickActionTriggered;

  /// Initializes Quick Actions and Home Screen Widget listeners
  Future<void> initialize({Function(String actionType)? onAction}) async {
    if (_isInitialized) return;
    onQuickActionTriggered = onAction;

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
          icon: 'ic_wol_power',
        ),
        const ShortcutItem(
          type: 'action_panic_kill',
          localizedTitle: 'Emergency Lock',
          icon: 'ic_panic_kill',
        ),
        const ShortcutItem(
          type: 'action_scan_fleet',
          localizedTitle: 'Scan LAN Fleet',
          icon: 'ic_radar_scan',
        ),
        const ShortcutItem(
          type: 'action_open_terminal',
          localizedTitle: 'Remote Shell',
          icon: 'ic_terminal',
        ),
      ]);
    } catch (e) {
      debugPrint('QuickActions init error: $e');
    }

    // 2. Setup Home Screen Widget Background Communication
    try {
      HomeWidget.setAppGroupId('group.com.cst.netcontroller');
      HomeWidget.registerInteractivityCallback(widgetBackgroundCallback);
    } catch (e) {
      debugPrint('HomeWidget init error: $e');
    }

    _isInitialized = true;
  }

  /// Synchronizes current fleet status to the native Home Screen Widget
  Future<void> updateHomeScreenWidget({
    required String hostName,
    required String hostIp,
    required String hostMac,
    required bool isOnline,
    required double cpuUsage,
    required double ramUsage,
  }) async {
    try {
      await HomeWidget.saveWidgetData<String>('target_name', hostName);
      await HomeWidget.saveWidgetData<String>('target_ip', hostIp);
      await HomeWidget.saveWidgetData<String>('target_mac', hostMac);
      await HomeWidget.saveWidgetData<bool>('is_online', isOnline);
      await HomeWidget.saveWidgetData<String>(
        'status_text',
        isOnline ? 'ONLINE' : 'OFFLINE',
      );
      await HomeWidget.saveWidgetData<String>(
        'metrics_text',
        isOnline
            ? 'CPU ${cpuUsage.toStringAsFixed(0)}% • RAM ${ramUsage.toStringAsFixed(0)}%'
            : 'Ready for WoL',
      );
      await HomeWidget.saveWidgetData<String>(
        'last_updated',
        '${DateTime.now().hour.toString().padLeft(2, '0')}:${DateTime.now().minute.toString().padLeft(2, '0')}',
      );

      // Trigger native widget refresh on Android / iOS
      await HomeWidget.updateWidget(
        name: 'CstStatusWidgetProvider',
        androidName: 'CstStatusWidgetProvider',
        iOSName: 'CstStatusWidget',
      );
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
  /// across global broadcast and directed subnet broadcast (UDP ports 7 and [port]).
  Future<bool> sendGratuitousArpAndWake({
    required String targetMac,
    required String targetIp,
    required String routerIp,
    int port = 9,
  }) async {
    final Uint8List? macBytes = NetworkValidators.parseMacBytes(targetMac);
    if (macBytes == null || !NetworkValidators.isValidPort(port)) {
      debugPrint('WoL aborted: invalid MAC ($targetMac) or port ($port)');
      return false;
    }

    RawDatagramSocket? socket;
    try {
      socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      socket.broadcastEnabled = true;

      // Generate standard 102-byte Magic Packet: 6x 0xFF + 16x MAC
      final Uint8List magicPacket = Uint8List(102);
      magicPacket.fillRange(0, 6, 0xFF);
      for (int i = 0; i < 16; i++) {
        magicPacket.setRange(6 + (i * 6), 12 + (i * 6), macBytes);
      }

      final InternetAddress globalBroadcast = InternetAddress('255.255.255.255');
      socket.send(magicPacket, globalBroadcast, port);
      if (port != 7) {
        socket.send(magicPacket, globalBroadcast, 7);
      }

      // Also send directed /24 subnet broadcast using targetIp or routerIp
      final String subnetSeed =
          NetworkValidators.isValidIpv4(targetIp) ? targetIp : routerIp;
      if (NetworkValidators.isValidIpv4(subnetSeed)) {
        final String directed = NetworkValidators.deriveBroadcastIp(subnetSeed);
        if (directed != '255.255.255.255') {
          try {
            socket.send(magicPacket, InternetAddress(directed), port);
          } catch (_) {}
        }
      }

      return true;
    } catch (e) {
      debugPrint('WoL packet broadcast error: $e');
      return false;
    } finally {
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
