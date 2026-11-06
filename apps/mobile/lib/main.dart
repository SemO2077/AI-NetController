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

  static const List<AdaptiveNavItem> _navDestinations = [
    AdaptiveNavItem(
      label: 'Устройства',
      icon: Icons.devices_rounded,
      activeIcon: Icons.devices_rounded,
    ),
    AdaptiveNavItem(
      label: 'Команди',
      icon: Icons.terminal_rounded,
      activeIcon: Icons.terminal_rounded,
    ),
    AdaptiveNavItem(
      label: 'Настройки',
      icon: Icons.tune_rounded,
      activeIcon: Icons.tune_rounded,
    ),
  ];

  Future<void> _sendWakeOnLan(String mac) async {
    try {
      if (await Vibration.hasVibrator()) {
        Vibration.vibrate(duration: 40);
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

  void _openStreamScreen(HostState host) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => FullscreenStreamPage(host: host),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hosts = ref.watch(fleetProvider);
    final selectedHostId = ref.watch(selectedHostIdProvider);
    final selectedHost = hosts.firstWhere(
      (h) => h.id == selectedHostId,
      orElse: () => hosts.first,
    );

    return AdaptiveScaffold(
      title: 'AI NETCONTROLLER',
      navItems: _navDestinations,
      selectedIndex: _currentTabIndex,
      onIndexChanged: (idx) => setState(() => _currentTabIndex = idx),
      actions: [
        IconButton(
          tooltip: 'App Tour & Onboarding',
          icon: const Icon(Icons.explore_outlined,
              color: CyberColors.primary, size: 20),
          onPressed: () => AdaptiveOnboardingSheet.show(context),
        ),
        IconButton(
          tooltip: 'Test HITL Security Gate',
          icon: const Icon(Icons.shield_outlined,
              color: CyberColors.primary, size: 20),
          onPressed: () async {
            final authorized = await AdaptiveHitlController.showApprovalPrompt(
              context: context,
              hostName: selectedHost.name,
              command: 'rmdir /s /q C:\\CST_TempCache && format E: /fs:ntfs /q',
              riskLevel: 'CRITICAL',
              reasoning:
                  'Purge volatile artifacts and sanitize auxiliary storage drive.',
            );
            if (mounted && authorized != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  backgroundColor: authorized
                      ? CyberColors.surfaceElevated
                      : Colors.red.shade900,
                  content: Text(
                    authorized
                        ? 'Operator AUTHORIZED command execution'
                        : 'Operator REJECTED command',
                    style: TextStyle(
                      color: authorized ? CyberColors.success : Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              );
            }
          },
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
    required HostState selectedHost,
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
        const SizedBox(height: 24),
        _buildSectionHeader('OFFLINE GHOST CACHE'),
        const SizedBox(height: 8),
        ...ghostBox.keys.map(
          (key) => _buildGhostCacheCard(key.toString(), ghostBox.get(key)),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------
  // 2. MEDIUM FLEET VIEW (2-COLUMN ADAPTIVE GRID)
  // -------------------------------------------------------------------
  Widget _buildMediumGridFleet(List<HostState> hosts) {
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
  Widget _buildDetailConsolePane(HostState host) {
    return Padding(
      key: ValueKey<String>(host.id),
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Live Screen Stream Box (16:9 Aspect Ratio with dynamic downsampling)
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 280),
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
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(22),
                      child: BackdropFilter(
                        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
                        child: Container(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [
                                Colors.white.withValues(alpha: 0.06),
                                CyberColors.surfaceElevated
                                    .withValues(alpha: 0.75),
                              ],
                            ),
                            borderRadius: BorderRadius.circular(22),
                            border: Border.all(
                                color: Colors.white.withValues(alpha: 0.12)),
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
  Widget _buildTerminalCommandsTab(HostState host, {bool isEmbedded = false}) {
    final commands = [
      'Get-Process | Sort-Object CPU -Descending | Select -First 8',
      'ipconfig /all',
      'Get-Service | Where-Object Status -eq "Running"',
      'systeminfo',
      'nvidia-smi',
    ];

    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: isEmbedded ? EdgeInsets.zero : const EdgeInsets.all(16),
      children: [
        _buildSectionHeader('DISPATCH COMMAND TO: ${host.name} · ${host.ip}'),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: commands.map((cmd) {
            return ActionChip(
              backgroundColor:
                  CyberColors.surfaceElevated.withValues(alpha: 0.75),
              side: BorderSide(
                  color: CyberColors.primary.withValues(alpha: 0.35)),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(18)),
              label: Text(
                cmd.split('|').first.trim(),
                style: TextStyle(
                  color: CyberColors.primary,
                  fontSize: context.fluidFont(11),
                  fontFamily: 'monospace',
                ),
              ),
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    backgroundColor: CyberColors.surfaceElevated,
                    content: Text(
                      'Dispatched: $cmd',
                      style: const TextStyle(
                          fontFamily: 'monospace', color: CyberColors.primary),
                    ),
                  ),
                );
              },
            );
          }).toList(),
        ),
        const SizedBox(height: 18),
        _buildSectionHeader('TERMINAL CONSOLE OUTPUT · SANDBOXED JOB OBJECT'),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.65),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(
                    color: CyberColors.primary.withValues(alpha: 0.25)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'PS C:\\Windows\\system32> Get-Process | Sort-Object CPU\n'
                    ' NPM(K)    PM(M)    WS(M)     CPU(s)      Id  ProcessName\n'
                    ' ------    -----    -----     ------      --  -----------\n'
                    '     45    85.23   112.54      42.12    4102  AI_NetController_HostAgent\n'
                    '     98   312.45   489.12      24.08    1184  explorer\n'
                    '     22    45.10    62.30       8.15    8912  svchost\n'
                    '     14    12.40    18.90       1.20    7210  dwmd\n'
                    '\n[Process completed in 24ms with code 0]',
                    style: TextStyle(
                      fontFamily: 'monospace',
                      color: CyberColors.success,
                      fontSize: context.fluidFont(10),
                    ),
                  ),
                ],
              ),
            ),
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
          title: 'Bidirectional Viewport Matching (0x09)',
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
              'Impeller 120Hz Hardware Engine • AI-NETCONTROLLER/3.0-SECURE Protocol',
          trailing: const Text('BUILD 29',
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
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Colors.white.withValues(alpha: 0.07),
                  CyberColors.surfaceElevated.withValues(alpha: 0.65),
                ],
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
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
