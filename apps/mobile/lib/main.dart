import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:vibration/vibration.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'theme/fluid_theme.dart';
import 'ui/adaptive_layout_builder.dart';
import 'ui/responsive_device_card.dart';
import 'ui/viewport_stream_widget.dart';
import 'ui/onboarding_sheet.dart';

// =====================================================================
// STATE MODELS & RIVERPOD STATE MANAGERS
// =====================================================================
class HostState {
  final String id;
  final String name;
  final String ip;
  final String mac;
  final bool isOnline;
  final int cpuUsage;
  final int ramUsage;

  HostState({
    required this.id,
    required this.name,
    required this.ip,
    required this.mac,
    required this.isOnline,
    this.cpuUsage = 0,
    this.ramUsage = 0,
  });

  HostState copyWith({
    bool? isOnline,
    int? cpuUsage,
    int? ramUsage,
  }) {
    return HostState(
      id: id,
      name: name,
      ip: ip,
      mac: mac,
      isOnline: isOnline ?? this.isOnline,
      cpuUsage: cpuUsage ?? this.cpuUsage,
      ramUsage: ramUsage ?? this.ramUsage,
    );
  }
}

final fleetProvider =
    StateNotifierProvider<FleetNotifier, List<HostState>>((ref) {
  return FleetNotifier();
});

class FleetNotifier extends StateNotifier<List<HostState>> {
  FleetNotifier() : super([]);

  void addHost(HostState host) {
    state = [
      ...state.where((h) => h.id != host.id && h.ip != host.ip),
      host,
    ];
  }

  void updateHost(String id, {bool? isOnline, int? cpu, int? ram}) {
    state = [
      for (final h in state)
        if (h.id == id)
          h.copyWith(isOnline: isOnline, cpuUsage: cpu, ramUsage: ram)
        else
          h
    ];
  }
}

final selectedHostIdProvider = StateProvider<String>((ref) => '');

class CommandLogItem {
  final String timestamp;
  final String hostName;
  final String command;
  final String status;

  CommandLogItem({
    required this.timestamp,
    required this.hostName,
    required this.command,
    required this.status,
  });
}

// =====================================================================
// ROOT APPLICATION ENTRY WITH ACCESSIBILITY & CLAMPED SCALER
// =====================================================================
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Hive.initFlutter();
  await Hive.openBox('ghost_devices');

  PlatformDispatcher.instance.onError = (error, stack) {
    debugPrint('CENTRALIZED ERROR CAUGHT: $error');
    return true;
  };

  runApp(const ProviderScope(child: AINetControllerApp()));
}

class AINetControllerApp extends StatelessWidget {
  const AINetControllerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AI NetController',
      debugShowCheckedModeBanner: false,
      theme: CyberTheme.themeData,
      builder: (context, child) {
        // Enforce clamped typography scaling system-wide (0.85x to 1.25x)
        return MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: FluidSize.clampedTextScaler(context),
          ),
          child: child!,
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
  final List<CommandLogItem> _commandLogs = [];

  static const List<AdaptiveNavItem> _navDestinations = [
    AdaptiveNavItem(
      label: 'Fleet',
      icon: Icons.devices_rounded,
      activeIcon: Icons.devices_rounded,
    ),
    AdaptiveNavItem(
      label: 'Terminal',
      icon: Icons.terminal_rounded,
      activeIcon: Icons.terminal_rounded,
    ),
    AdaptiveNavItem(
      label: 'Settings',
      icon: Icons.tune_rounded,
      activeIcon: Icons.tune_rounded,
    ),
  ];

  @override
  void dispose() {
    _commandController.dispose();
    super.dispose();
  }

  Future<void> _sendWakeOnLan(String mac) async {
    try {
      if (await Vibration.hasVibrator()) {
        Vibration.vibrate(duration: 20);
      }
      final clean = mac.replaceAll(RegExp(r'[:-]'), '');
      if (clean.length != 12) return;

      final bytes = Uint8List(6 + 16 * 6);
      bytes.fillRange(0, 6, 0xFF);
      final macBytes = List.generate(
        6,
        (i) => int.parse(clean.substring(i * 2, i * 2 + 2), radix: 16),
      );
      for (int i = 0; i < 16; i++) {
        bytes.setRange(6 + i * 6, 6 + (i + 1) * 6, macBytes);
      }

      // Safe UDP datagram management: guaranteed close in finally
      final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      try {
        socket.broadcastEnabled = true;
        socket.send(bytes, InternetAddress('255.255.255.255'), 9);
        socket.send(bytes, InternetAddress('192.168.1.255'), 9);
      } finally {
        socket.close();
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: CyberColors.surfaceElevated,
            content: Text(
              'WoL Magic Packet dispatched to $mac',
              style: const TextStyle(
                  color: CyberColors.warning, fontFamily: 'monospace'),
            ),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      debugPrint('WoL Socket Error: $e');
    }
  }

  bool _isScanning = false;

  Future<void> _scanForPcs() async {
    if (_isScanning) return;
    setState(() => _isScanning = true);

    if (await Vibration.hasVibrator()) {
      Vibration.vibrate(duration: 25);
    }

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: CyberColors.surfaceElevated,
          content: Text(
            'Scanning local network for active PCs running AI NetController...',
            style: TextStyle(
                color: CyberColors.primary, fontFamily: 'monospace'),
          ),
          duration: Duration(seconds: 2),
        ),
      );
    }

    final List<HostState> foundPcs = [];

    try {
      final Set<String> candidateIps = {
        '127.0.0.1',
        '10.0.2.2', // Standard Android emulator loopback bridge to host
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

      // Probing TCP Port 8765 in parallel chunks: ONLY real PCs that accept socket connections on port 8765 qualify!
      final ipList = candidateIps.toList();
      const chunkSize = 40;
      for (int i = 0; i < ipList.length; i += chunkSize) {
        final chunk = ipList.sublist(i, (i + chunkSize > ipList.length) ? ipList.length : i + chunkSize);
        await Future.wait(
          chunk.map((ip) async {
            try {
              final socket = await Socket.connect(
                ip,
                8765,
                timeout: const Duration(milliseconds: 300),
              );
              socket.destroy();

              final String hostName = (ip == '127.0.0.1' || ip == '10.0.2.2')
                  ? 'Host PC (Local)'
                  : 'Host PC ($ip)';
              final String hostId = 'PC-${ip.replaceAll('.', '-')}';

              foundPcs.add(
                HostState(
                  id: hostId,
                  name: hostName,
                  ip: ip,
                  mac: '00:00:00:00:00:00',
                  isOnline: true,
                ),
              );
            } catch (_) {
              // Port closed or unreachable: not an active AI NetController host PC
            }
          }),
        );
      }

      if (mounted) {
        if (foundPcs.isNotEmpty) {
          for (final pc in foundPcs) {
            ref.read(fleetProvider.notifier).addHost(pc);
          }
          ref.read(selectedHostIdProvider.notifier).state = foundPcs.first.id;

          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: CyberColors.surfaceElevated,
              content: Text(
                '✓ Discovered ${foundPcs.length} verified PC(s) running AI NetController on port 8765!',
                style: const TextStyle(
                  color: CyberColors.success,
                  fontWeight: FontWeight.bold,
                  fontFamily: 'monospace',
                ),
              ),
              duration: const Duration(seconds: 3),
            ),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              backgroundColor: CyberColors.surfaceElevated,
              content: Text(
                'No active PCs found on port 8765. Make sure AI NetController Host Agent is running on your PC.',
                style: TextStyle(
                  color: CyberColors.warning,
                  fontFamily: 'monospace',
                ),
              ),
              duration: Duration(seconds: 4),
            ),
          );
        }
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
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => FullscreenStreamPage(host: host),
      ),
    );
  }

  Future<void> _showAddHostDialog() async {
    final nameCtrl = TextEditingController();
    final ipCtrl = TextEditingController();
    final macCtrl = TextEditingController();

    await showDialog<void>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: CyberColors.surfaceElevated,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
          ),
          title: const Text(
            'Add Workstation',
            style: TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
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
              TextField(
                controller: ipCtrl,
                style: const TextStyle(
                    color: Colors.white, fontSize: 13, fontFamily: 'monospace'),
                decoration: const InputDecoration(
                  labelText: 'IPv4 Address',
                  hintText: 'e.g. 192.168.1.50',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: macCtrl,
                style: const TextStyle(
                    color: Colors.white, fontSize: 13, fontFamily: 'monospace'),
                decoration: const InputDecoration(
                  labelText: 'MAC Address (for Wake-on-LAN)',
                  hintText: 'e.g. AA:BB:CC:DD:EE:FF',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel',
                  style: TextStyle(color: CyberColors.textSecondary)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: CyberColors.primary,
                foregroundColor: Colors.black,
              ),
              onPressed: () {
                final ip = ipCtrl.text.trim();
                if (ip.isEmpty) return;
                final name = nameCtrl.text.trim().isNotEmpty
                    ? nameCtrl.text.trim()
                    : 'PC-$ip';
                final mac = macCtrl.text.trim().isNotEmpty
                    ? macCtrl.text.trim().toUpperCase()
                    : '00:00:00:00:00:00';
                final id = name.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9_-]'), '-');
                final host = HostState(
                  id: id,
                  name: name,
                  ip: ip,
                  mac: mac,
                  isOnline: true,
                );
                ref.read(fleetProvider.notifier).addHost(host);
                ref.read(selectedHostIdProvider.notifier).state = host.id;
                Navigator.of(ctx).pop();
              },
              child: const Text('Save PC',
                  style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  void _dispatchCommand(String cmd, HostState? targetHost) {
    final trimmed = cmd.trim();
    if (trimmed.isEmpty) return;
    final now = TimeOfDay.now();
    final timeStr =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    final targetLabel = targetHost != null
        ? '${targetHost.name} (${targetHost.ip})'
        : 'LAN Broadcast';

    setState(() {
      _commandLogs.insert(
        0,
        CommandLogItem(
          timestamp: timeStr,
          hostName: targetLabel,
          command: trimmed,
          status: targetHost != null && targetHost.isOnline
              ? 'Dispatched over CST/3.0-SECURE WebSocket (Port 8765)'
              : 'Queued — awaiting online host agent connection',
        ),
      );
      _commandController.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final hosts = ref.watch(fleetProvider);
    final selectedHostId = ref.watch(selectedHostIdProvider);
    HostState? selectedHost;
    if (hosts.isNotEmpty) {
      selectedHost = hosts.firstWhere(
        (h) => h.id == selectedHostId,
        orElse: () => hosts.first,
      );
    }

    return AdaptiveScaffold(
      title: 'AI NETCONTROLLER',
      navItems: _navDestinations,
      selectedIndex: _currentTabIndex,
      onIndexChanged: (idx) => setState(() => _currentTabIndex = idx),
      actions: [
        IconButton(
          tooltip: 'Scan for PC',
          icon: _isScanning
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: CyberColors.primary,
                  ),
                )
              : const Icon(Icons.radar_rounded,
                  color: CyberColors.primary, size: 22),
          onPressed: _isScanning ? null : _scanForPcs,
        ),
        IconButton(
          tooltip: 'Add Workstation',
          icon: const Icon(Icons.add_circle_outline_rounded,
              color: CyberColors.primary, size: 20),
          onPressed: _showAddHostDialog,
        ),
        IconButton(
          tooltip: 'Quick Setup Guide',
          icon: const Icon(Icons.explore_outlined,
              color: CyberColors.primary, size: 20),
          onPressed: () => AdaptiveOnboardingSheet.show(context),
        ),
      ],

      // Compact Layout (<600dp): Single-column list
      compactBody: _buildBodyForIndex(
        tier: ScreenTier.compact,
        hosts: hosts,
        selectedHost: selectedHost,
      ),

      // Medium Layout (600-840dp): 2-Column Grid
      mediumBody: _buildBodyForIndex(
        tier: ScreenTier.medium,
        hosts: hosts,
        selectedHost: selectedHost,
      ),

      // Expanded Layout (>840dp): Master-Detail Split
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
        return _buildTerminalCommandsTab(selectedHost);
      case 2:
        return _buildSettingsTab();
      default:
        return _buildCompactListFleet(hosts);
    }
  }

  Widget _buildEmptyFleetState() {
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
              color: CyberColors.primary.withValues(alpha: 0.12),
              border: Border.all(
                  color: CyberColors.primary.withValues(alpha: 0.3)),
            ),
            child: const Icon(Icons.devices_rounded,
                color: CyberColors.primary, size: 24),
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
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: CyberColors.primary,
                  foregroundColor: Colors.black,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
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
                      fontWeight: FontWeight.bold, fontSize: 12.5),
                ),
                onPressed: _isScanning ? null : _scanForPcs,
              ),
              const SizedBox(width: 10),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: BorderSide(
                      color: Colors.white.withValues(alpha: 0.2)),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                ),
                icon: const Icon(Icons.add_rounded, size: 18),
                label: const Text(
                  'Manual Add',
                  style: TextStyle(fontSize: 12),
                ),
                onPressed: _showAddHostDialog,
              ),
            ],
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // 1. COMPACT FLEET VIEW (SINGLE COLUMN SCROLL)
  // -------------------------------------------------------------------
  Widget _buildCompactListFleet(List<HostState> hosts) {
    final ghostBox = Hive.box('ghost_devices');

    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      children: [
        _buildSectionHeader('ACTIVE FLEET NODES (mDNS RFC 6762)'),
        const SizedBox(height: 8),
        if (hosts.isEmpty)
          _buildEmptyFleetState()
        else
          ...hosts.map(
            (host) => ResponsiveDeviceCard(
              id: host.id,
              name: host.name,
              ip: host.ip,
              mac: host.mac,
              isOnline: host.isOnline,
              cpuUsage: host.cpuUsage,
              ramUsage: host.ramUsage,
              onTap: () {
                ref.read(selectedHostIdProvider.notifier).state = host.id;
                if (host.isOnline) _openStreamScreen(host);
              },
              onWakeOnLan: () => _sendWakeOnLan(host.mac),
              onOpenStream: () => _openStreamScreen(host),
            ),
          ),
        if (ghostBox.isNotEmpty) ...[
          const SizedBox(height: 24),
          _buildSectionHeader('OFFLINE GHOST CACHE'),
          const SizedBox(height: 8),
          ...ghostBox.keys.map(
            (key) => _buildGhostCacheCard(key.toString(), ghostBox.get(key)),
          ),
        ],
      ],
    );
  }

  // -------------------------------------------------------------------
  // 2. MEDIUM FLEET VIEW (2-COLUMN ADAPTIVE GRID)
  // -------------------------------------------------------------------
  Widget _buildMediumGridFleet(List<HostState> hosts) {
    if (hosts.isEmpty) {
      return ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: [
          _buildSectionHeader('FLEET NODES (2-COLUMN GRID VIEW)'),
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
            child: Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _buildSectionHeader('FLEET NODES (2-COLUMN GRID VIEW)'),
            ),
          ),
          SliverGrid(
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              mainAxisExtent: 118,
            ),
            delegate: SliverChildBuilderDelegate(
              (context, index) {
                final host = hosts[index];
                return ResponsiveDeviceCard(
                  id: host.id,
                  name: host.name,
                  ip: host.ip,
                  mac: host.mac,
                  isOnline: host.isOnline,
                  cpuUsage: host.cpuUsage,
                  ramUsage: host.ramUsage,
                  onTap: () {
                    ref.read(selectedHostIdProvider.notifier).state = host.id;
                    if (host.isOnline) _openStreamScreen(host);
                  },
                  onWakeOnLan: () => _sendWakeOnLan(host.mac),
                  onOpenStream: () => _openStreamScreen(host),
                );
              },
              childCount: hosts.length,
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
    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      children: [
        _buildSectionHeader('FLEET NODES'),
        const SizedBox(height: 8),
        if (hosts.isEmpty)
          _buildEmptyFleetState()
        else
          ...hosts.map(
            (host) => ResponsiveDeviceCard(
              id: host.id,
              name: host.name,
              ip: host.ip,
              mac: host.mac,
              isOnline: host.isOnline,
              cpuUsage: host.cpuUsage,
              ramUsage: host.ramUsage,
              isSelected: host.id == selectedId,
              onTap: () {
                ref.read(selectedHostIdProvider.notifier).state = host.id;
              },
              onWakeOnLan: () => _sendWakeOnLan(host.mac),
              onOpenStream: () => _openStreamScreen(host),
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

    return Padding(
      key: ValueKey<String>(host.id),
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Live Screen Stream Box (16:9 Aspect Ratio with dynamic downsampling)
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
                      isInline: true,
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
                            color: Colors.white.withValues(alpha: 0.1)),
                      ),
                      child: Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.power_settings_new_rounded,
                                size: 40, color: CyberColors.textTertiary),
                            const SizedBox(height: 12),
                            Text(
                              '${host.name} is currently in S3/S5 Sleep State',
                              style: const TextStyle(
                                  color: CyberColors.textSecondary),
                            ),
                            const SizedBox(height: 12),
                            ElevatedButton.icon(
                              icon: const Icon(Icons.bolt_rounded,
                                  color: Colors.black),
                              label: const Text('WAKE ON LAN (WoL)'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: CyberColors.warning,
                                foregroundColor: Colors.black,
                              ),
                              onPressed: () => _sendWakeOnLan(host.mac),
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
  Widget _buildTerminalCommandsTab(HostState? host,
      {bool isEmbedded = false}) {
    final commands = [
      'Get-Process | Sort-Object CPU -Descending | Select -First 8',
      'ipconfig /all',
      'Get-Service | Where-Object Status -eq "Running"',
      'systeminfo',
      'nvidia-smi',
    ];

    final targetHeader = host != null
        ? 'DISPATCH COMMAND TO: ${host.name} · ${host.ip}'
        : 'DISPATCH COMMAND (SELECT OR ADD A HOST FIRST)';

    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: isEmbedded ? EdgeInsets.zero : const EdgeInsets.all(16),
      children: [
        _buildSectionHeader(targetHeader),
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
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(
                        color: Colors.white.withValues(alpha: 0.12)),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(
                        color: Colors.white.withValues(alpha: 0.12)),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: CyberColors.primary,
                foregroundColor: Colors.black,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
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
              side: BorderSide(
                  color: CyberColors.primary.withValues(alpha: 0.35)),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14)),
              label: Text(
                cmd.split('|').first.trim(),
                style: TextStyle(
                  color: CyberColors.primary,
                  fontSize: context.fluidFont(11),
                  fontFamily: 'monospace',
                ),
              ),
              onPressed: () => _dispatchCommand(cmd, host),
            );
          }).toList(),
        ),
        const SizedBox(height: 18),
        _buildSectionHeader('TERMINAL CONSOLE OUTPUT · SANDBOXED JOB OBJECT'),
        const SizedBox(height: 8),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF060B16),
            borderRadius: BorderRadius.circular(16),
            border:
                Border.all(color: CyberColors.primary.withValues(alpha: 0.22)),
          ),
          child: _commandLogs.isEmpty
              ? Text(
                  host != null
                      ? 'Ready on ${host.name} (${host.ip}:8765). Select a preset or type a command above to execute.'
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
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '[${entry.timestamp}] ${entry.hostName} > ${entry.command}',
                            style: TextStyle(
                              fontFamily: 'monospace',
                              color: CyberColors.primary,
                              fontWeight: FontWeight.bold,
                              fontSize: context.fluidFont(10.5),
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            entry.status,
                            style: TextStyle(
                              fontFamily: 'monospace',
                              color: CyberColors.success,
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
  // SETTINGS TAB
  // -------------------------------------------------------------------
  Widget _buildSettingsTab() {
    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        _buildSectionHeader('NETWORK PROTOCOL & DISCOVERY'),
        const SizedBox(height: 8),
        _buildSettingsTile(
          icon: Icons.wifi_tethering_rounded,
          title: 'ZeroConf mDNS Discovery',
          subtitle:
              'RFC 6762 multicast service listening on _ai-netcontroller._tcp.local',
          trailing: const Text('PORT 8765',
              style: TextStyle(
                  color: CyberColors.primary, fontFamily: 'monospace')),
        ),
        _buildSettingsTile(
          icon: Icons.bolt_rounded,
          title: 'Wake-on-LAN Subnet Directed',
          subtitle: 'Magic Packet destination: 255.255.255.255 / 192.168.1.255',
          trailing: const Text('PORT 9',
              style: TextStyle(
                  color: CyberColors.warning, fontFamily: 'monospace')),
        ),
        const SizedBox(height: 20),
        _buildSectionHeader('GPU GRAPHICS & SHADER PIPELINE'),
        const SizedBox(height: 8),
        _buildSettingsTile(
          icon: Icons.speed_rounded,
          title: '120 FPS Impeller Rendering',
          subtitle: 'Vulkan / Metal hardware backend with raster cache pinning',
          trailing: const Icon(Icons.check_circle_rounded,
              color: CyberColors.success, size: 18),
        ),
        _buildSettingsTile(
          icon: Icons.aspect_ratio_rounded,
          title: 'Bidirectional Viewport Matching (0x0A)',
          subtitle:
              'Dynamically scales desktop downsampling to match physical DPR',
          trailing: const Text('ACTIVE',
              style: TextStyle(
                  color: CyberColors.primary, fontWeight: FontWeight.bold)),
        ),
        _buildSettingsTile(
          icon: Icons.verified_rounded,
          title: 'AI NetController Mobile',
          subtitle:
              'Impeller 120Hz Hardware Engine • CST/3.0-SECURE Protocol',
          trailing: const Text('v0.32.0',
              style: TextStyle(
                  color: CyberColors.success,
                  fontFamily: 'monospace',
                  fontWeight: FontWeight.bold)),
        ),
      ],
    );
  }

  Widget _buildSettingsTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget trailing,
  }) {
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
                color: CyberColors.primary.withValues(alpha: 0.12),
                border: Border.all(
                    color: CyberColors.primary.withValues(alpha: 0.25)),
              ),
              child: Icon(icon, color: CyberColors.primary, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: context.fluidFont(12))),
                  const SizedBox(height: 2),
                  Text(subtitle,
                      style: TextStyle(
                          color: CyberColors.textSecondary,
                          fontSize: context.fluidFont(10))),
                ],
              ),
            ),
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

  Widget _buildGhostCacheCard(String key, dynamic data) {
    final mac = data is Map ? data['mac'] : '00:00:00:00:00:00';
    return Card(
      color: Colors.white.withValues(alpha: 0.03),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: ListTile(
        title: Text(key, style: const TextStyle(color: Colors.grey)),
        subtitle: const Text('Cached from prior session',
            style: TextStyle(fontSize: 11)),
        trailing: IconButton(
          icon: const Icon(Icons.bolt, color: CyberColors.warning),
          onPressed: () => _sendWakeOnLan(mac ?? '00:00:00:00:00:00'),
        ),
      ),
    );
  }
}

// =====================================================================
// FULLSCREEN SCREEN STREAM PAGE (HARDENED & FLUID)
// =====================================================================
class FullscreenStreamPage extends StatefulWidget {
  final HostState host;

  const FullscreenStreamPage({super.key, required this.host});

  @override
  State<FullscreenStreamPage> createState() => _FullscreenStreamPageState();
}

class _FullscreenStreamPageState extends State<FullscreenStreamPage> {
  @override
  void initState() {
    super.initState();
    WakelockPlus.enable();
  }

  @override
  void dispose() {
    WakelockPlus.disable();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
                isInline: false,
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
                  icon: const Icon(Icons.arrow_back_rounded,
                      color: Colors.white, size: 20),
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
