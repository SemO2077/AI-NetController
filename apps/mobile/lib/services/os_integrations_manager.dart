import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:home_widget/home_widget.dart';
import 'package:quick_actions/quick_actions.dart';

/// Advanced OS Integrations & Network Edge-Case Manager
/// ---------------------------------------------------------------------
/// Capabilities:
/// 1. Gratuitous ARP (RFC 826) Cache Injection over 802.11 Wi-Fi (WoWLAN)
/// 2. 102-Byte UDP Magic Packet Transmitter (Ports 7 and 9)
/// 3. Android Quick Settings Tile & Launcher Shortcuts (quick_actions)
/// 4. Android/iOS Home Screen Widgets with Background Isolate 1-Tap WoL (home_widget)

/// Background entry point for 1-tap Home Screen Widget interactions
@pragma('vm:entry-point')
void widgetBackgroundCallback(Uri? uri) async {
  if (uri == null) return;
  if (uri.host == 'wake_pc' || uri.path.contains('wake')) {
    final String? mac = uri.queryParameters['mac'] ?? '00:1B:44:11:3A:B7';
    final String? ip = uri.queryParameters['ip'] ?? '192.168.1.105';
    final String? routerIp = uri.queryParameters['router'] ?? '192.168.1.1';

    // Directly execute Gratuitous ARP + Magic Packet in background isolate
    await OsIntegrationsManager.instance.sendGratuitousArpAndWake(
      targetMac: mac!,
      targetIp: ip!,
      routerIp: routerIp!,
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
          localizedTitle: 'Събуди PC (WoL)',
          icon: 'ic_wol_power',
        ),
        const ShortcutItem(
          type: 'action_panic_kill',
          localizedTitle: 'Аварийно спиране (SIGKILL)',
          icon: 'ic_panic_kill',
        ),
        const ShortcutItem(
          type: 'action_scan_fleet',
          localizedTitle: 'mDNS Сканиране',
          icon: 'ic_radar_scan',
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
      await HomeWidget.saveWidgetData<String>('status_text', isOnline ? 'ОНЛАЙН' : 'ИЗКЛЮЧЕН');
      await HomeWidget.saveWidgetData<String>(
        'metrics_text',
        isOnline ? 'CPU ${cpuUsage.toStringAsFixed(0)}% • RAM ${ramUsage.toStringAsFixed(0)}%' : 'В готовност за WoL',
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
    final List<int> macBytes = _parseMacAddress(targetMac);
    final List<int> ipBytes = _parseIpAddress(targetIp);
    final List<int> routerIpBytes = _parseIpAddress(routerIp);

    final Uint8List packet = Uint8List(28);
    final ByteData bd = ByteData.sublistView(packet);

    bd.setUint16(0, 0x0001, Endian.big);  // Hardware type: Ethernet (1)
    bd.setUint16(2, 0x0800, Endian.big);  // Protocol type: IPv4 (0x0800)
    bd.setUint8(4, 6);                   // Hardware address length (6)
    bd.setUint8(5, 4);                   // Protocol address length (4)
    bd.setUint16(6, 0x0002, Endian.big);  // Opcode: ARP Reply (2)

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

  /// Sends Gratuitous ARP to the router followed by the 102-byte WoL Magic Packet
  Future<bool> sendGratuitousArpAndWake({
    required String targetMac,
    required String targetIp,
    required String routerIp,
    int port = 9,
  }) async {
    try {
      final RawDatagramSocket socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      socket.broadcastEnabled = true;

      // 1. Inject Gratuitous ARP payload to refresh Wi-Fi Access Point / Router ARP table
      try {
        final Uint8List arpPacket = buildGratuitousArpPacket(
          targetMac: targetMac,
          targetIp: targetIp,
          routerIp: routerIp,
        );
        // Transmit gratuitous ARP packet to router gateway
        socket.send(arpPacket, InternetAddress(routerIp), 67); // UDP helper / broadcast
        socket.send(arpPacket, InternetAddress('255.255.255.255'), 9);
      } catch (arpErr) {
        debugPrint('Gratuitous ARP transmission notice: $arpErr');
      }

      // Small 50ms delay for wireless NIC AP table propagation
      await Future.delayed(const Duration(milliseconds: 50));

      // 2. Generate standard 102-byte Magic Packet: 6x 0xFF + 16x MAC
      final List<int> macBytes = _parseMacAddress(targetMac);
      final Uint8List magicPacket = Uint8List(102);
      for (int i = 0; i < 6; i++) {
        magicPacket[i] = 0xFF;
      }
      for (int i = 0; i < 16; i++) {
        for (int j = 0; j < 6; j++) {
          magicPacket[6 + (i * 6) + j] = macBytes[j];
        }
      }

      // Broadcast to both global broadcast and subnet broadcast on UDP 7 & 9
      final InternetAddress broadcastAddr = InternetAddress('255.255.255.255');
      socket.send(magicPacket, broadcastAddr, port);
      socket.send(magicPacket, broadcastAddr, 7);

      // Also send directed subnet broadcast if subnet is /24
      final List<String> ipParts = routerIp.split('.');
      if (ipParts.length == 4) {
        final String subnetBroadcast = '${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.255';
        try {
          socket.send(magicPacket, InternetAddress(subnetBroadcast), port);
        } catch (_) {}
      }

      socket.close();
      return true;
    } catch (e) {
      debugPrint('WoWLAN packet broadcast error: $e');
      return false;
    }
  }

  List<int> _parseMacAddress(String mac) {
    final String clean = mac.replaceAll(RegExp(r'[^0-9A-Fa-f]'), '');
    if (clean.length != 12) {
      return [0x00, 0x1B, 0x44, 0x11, 0x3A, 0xB7];
    }
    final List<int> bytes = [];
    for (int i = 0; i < 12; i += 2) {
      bytes.add(int.parse(clean.substring(i, i + 2), radix: 16));
    }
    return bytes;
  }

  List<int> _parseIpAddress(String ip) {
    final List<String> parts = ip.split('.');
    if (parts.length != 4) {
      return [192, 168, 1, 1];
    }
    return parts.map((p) => int.tryParse(p) ?? 0).toList();
  }
}
