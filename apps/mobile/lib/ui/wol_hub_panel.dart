import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../security/network_validators.dart';
import '../services/app_preferences.dart';
import '../services/history_store.dart';
import '../services/os_integrations_manager.dart';
import '../theme/fluid_theme.dart';

/// Lightweight host summary passed into settings/WoL UI panels without
/// introducing a circular dependency on `main.dart`.
@immutable
class SettingsHostSummary {
  final String id;
  final String name;
  final String ip;
  final int wsPort;
  final String mac;
  final bool isOnline;
  final String osName;
  final bool useTls;

  const SettingsHostSummary({
    required this.id,
    required this.name,
    required this.ip,
    this.wsPort = 8765,
    this.mac = '00:00:00:00:00:00',
    this.isOnline = false,
    this.osName = '',
    this.useTls = false,
  });

  bool get hasValidMac => NetworkValidators.normalizeMac(mac) != null;

  /// Returns a strictly sanitized non-secret map compatible with
  /// [AppPreferencesNotifier.exportConfigJson].
  Map<String, dynamic> toSanitizedMap() => <String, dynamic>{
    'id': id,
    'name': name,
    'ip': ip,
    'wsPort': wsPort,
    'mac': mac,
    'osName': osName,
    'useTls': useTls,
  };
}

/// Optional callback signature for dispatching a Wake-on-LAN packet.
typedef WolDispatchCallback =
    Future<WolDispatchResult> Function({
      required String targetMac,
      String targetIp,
      String hostName,
      int port,
      String? customBroadcastIp,
      int burstCount,
      bool sendGratuitousArp,
    });

/// Optional toast notification callback matching `AINetControllerApp._showToast`.
typedef ToastCallback = void Function(String message, {Color? accentColor});

/// Interactive Wake-on-LAN Command Hub with Quick Wake Dispatcher,
/// WoL network tuning controls, and persistent WoL dispatch history.
class WolHubPanel extends ConsumerStatefulWidget {
  final List<SettingsHostSummary> hosts;
  final WolDispatchCallback? onDispatchWol;
  final ToastCallback? onToast;

  const WolHubPanel({
    super.key,
    this.hosts = const <SettingsHostSummary>[],
    this.onDispatchWol,
    this.onToast,
  });

  @override
  ConsumerState<WolHubPanel> createState() => _WolHubPanelState();
}

class _WolHubPanelState extends ConsumerState<WolHubPanel> {
  late final TextEditingController _macController;
  late final TextEditingController _ipController;
  late final TextEditingController _historySearchController;

  String? _selectedHostId;
  String _selectedHostName = '';
  String _historyQuery = '';
  String? _macValidationError;
  bool _isSendingSingle = false;
  bool _isWakingAll = false;
  final Set<String> _resendingEntryIds = <String>{};

  @override
  void initState() {
    super.initState();
    _macController = TextEditingController();
    _ipController = TextEditingController();
    _historySearchController = TextEditingController();
    _seedInitialHostSelection();
  }

  void _seedInitialHostSelection() {
    if (widget.hosts.isEmpty) return;
    final SettingsHostSummary initial = widget.hosts.firstWhere(
      (h) => !h.isOnline && h.hasValidMac,
      orElse: () => widget.hosts.firstWhere(
        (h) => h.hasValidMac,
        orElse: () => widget.hosts.first,
      ),
    );
    _applyHostSelection(initial, notify: false);
  }

  void _applyHostSelection(SettingsHostSummary host, {bool notify = true}) {
    void update() {
      _selectedHostId = host.id;
      _selectedHostName = host.name;
      _macController.text = host.hasValidMac
          ? (NetworkValidators.normalizeMac(host.mac) ?? host.mac)
          : '';
      _ipController.text = host.ip;
      _macValidationError = null;
    }

    if (notify) {
      setState(update);
    } else {
      update();
    }
  }

  void _selectCustomTarget() {
    _hapticTap();
    setState(() {
      _selectedHostId = null;
      _selectedHostName = '';
      _macValidationError = null;
    });
  }

  @override
  void didUpdateWidget(covariant WolHubPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_selectedHostId == null &&
        _macController.text.isEmpty &&
        _ipController.text.isEmpty &&
        widget.hosts.isNotEmpty) {
      _seedInitialHostSelection();
    }
  }

  @override
  void dispose() {
    _macController.dispose();
    _ipController.dispose();
    _historySearchController.dispose();
    super.dispose();
  }

  void _hapticTap() {
    if (!ref.read(appPreferencesProvider).hapticsEnabled) return;
    unawaited(HapticFeedback.selectionClick().catchError((_) {}));
  }

  void _notify(String message, {Color? accentColor}) {
    if (!mounted) return;
    if (widget.onToast != null) {
      widget.onToast!(message, accentColor: accentColor);
      return;
    }
    final palette = context.palette;
    final Color effectiveAccent = accentColor ?? palette.primary;
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
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
          duration: const Duration(seconds: 2),
        ),
      );
  }

  Future<WolDispatchResult> _dispatchPacket({
    required String targetMac,
    required String targetIp,
    required String hostName,
    required int port,
    required String broadcastOverride,
    required int burstCount,
    required bool sendGratuitousArp,
  }) async {
    final String safeIp = NetworkValidators.isValidIpv4(targetIp)
        ? targetIp.trim()
        : '';
    final String safeBroadcast = NetworkValidators.isValidIpv4(broadcastOverride)
        ? broadcastOverride.trim()
        : '';

    final WolDispatchResult result;
    if (widget.onDispatchWol != null) {
      result = await widget.onDispatchWol!(
        targetMac: targetMac,
        targetIp: safeIp,
        hostName: hostName,
        port: port,
        customBroadcastIp: safeBroadcast.isEmpty ? null : safeBroadcast,
        burstCount: burstCount,
        sendGratuitousArp: sendGratuitousArp,
      );
    } else {
      result = await OsIntegrationsManager.instance.sendWakePacketDetailed(
        targetMac: targetMac,
        targetIp: safeIp,
        port: port,
        customBroadcastIp: safeBroadcast.isEmpty ? null : safeBroadcast,
        burstCount: burstCount,
        sendBothPorts: port == 9,
        sendGratuitousArp: sendGratuitousArp,
      );
    }

    await ref
        .read(historyProvider.notifier)
        .recordWol(
          mac: result.mac.isNotEmpty ? result.mac : targetMac,
          hostName: hostName,
          hostIp: targetIp.trim(),
          success: result.success,
          port: result.port,
          broadcastIp: safeBroadcast,
          burstCount: result.burstCount,
          latencyMs: result.latencyMs,
          targets: result.targets,
          error: result.error,
          extraMeta: <String, dynamic>{'garp': sendGratuitousArp},
        );

    return result;
  }

  Future<void> _sendSinglePacket() async {
    if (_isSendingSingle) return;
    _hapticTap();

    final String? normalizedMac = NetworkValidators.normalizeMac(
      _macController.text,
    );
    if (normalizedMac == null) {
      setState(() {
        _macValidationError = 'Enter a valid MAC (e.g. AA:BB:CC:DD:EE:FF)';
      });
      _notify(
        'Invalid MAC address for Wake-on-LAN.',
        accentColor: context.palette.warning,
      );
      return;
    }

    setState(() {
      _macValidationError = null;
      _isSendingSingle = true;
    });

    final prefs = ref.read(appPreferencesProvider);
    final String rawIp = _ipController.text.trim();
    final String matchedHostName = _resolveHostNameForInput(
      normalizedMac,
      rawIp,
    );

    try {
      final result = await _dispatchPacket(
        targetMac: normalizedMac,
        targetIp: rawIp,
        hostName: matchedHostName,
        port: prefs.wolPort,
        broadcastOverride: prefs.wolBroadcastOverride,
        burstCount: prefs.wolBurstCount,
        sendGratuitousArp: prefs.wolSendGratuitousArp,
      );
      if (!mounted) return;
      if (result.success) {
        _notify(
          'Magic Packet sent to $normalizedMac (${result.burstCount}x • UDP ${result.port}) • ${result.latencyMs}ms',
          accentColor: context.palette.success,
        );
      } else {
        _notify(
          result.error ?? 'Failed to broadcast WoL Magic Packet.',
          accentColor: context.palette.accent,
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSendingSingle = false);
      }
    }
  }

  String _resolveHostNameForInput(String normalizedMac, String ip) {
    if (_selectedHostName.trim().isNotEmpty) {
      return _selectedHostName.trim();
    }
    for (final host in widget.hosts) {
      if (NetworkValidators.normalizeMac(host.mac) == normalizedMac ||
          (ip.isNotEmpty && host.ip.trim() == ip)) {
        return host.name;
      }
    }
    return '';
  }

  Future<void> _wakeAllOffline() async {
    if (_isWakingAll) return;
    _hapticTap();

    final List<SettingsHostSummary> targets = widget.hosts
        .where((h) => !h.isOnline && h.hasValidMac)
        .toList(growable: false);

    if (targets.isEmpty) {
      _notify(
        'No offline saved workstations have a valid MAC address.',
        accentColor: context.palette.warning,
      );
      return;
    }

    setState(() => _isWakingAll = true);
    final prefs = ref.read(appPreferencesProvider);
    int successCount = 0;

    try {
      for (final host in targets) {
        final mac = NetworkValidators.normalizeMac(host.mac)!;
        final res = await _dispatchPacket(
          targetMac: mac,
          targetIp: host.ip,
          hostName: host.name,
          port: prefs.wolPort,
          broadcastOverride: prefs.wolBroadcastOverride,
          burstCount: prefs.wolBurstCount,
          sendGratuitousArp: prefs.wolSendGratuitousArp,
        );
        if (res.success) {
          successCount++;
        }
      }
      if (!mounted) return;
      _notify(
        'Wake All complete: $successCount/${targets.length} Magic Packet bursts sent.',
        accentColor: successCount > 0
            ? context.palette.success
            : context.palette.accent,
      );
    } finally {
      if (mounted) {
        setState(() => _isWakingAll = false);
      }
    }
  }

  Future<void> _resendHistoryEntry(ActivityHistoryEntry entry) async {
    if (_resendingEntryIds.contains(entry.id)) return;
    _hapticTap();

    final String? mac = NetworkValidators.normalizeMac(entry.mac);
    if (mac == null) {
      _notify(
        'Cannot re-send: entry is missing a valid MAC address.',
        accentColor: context.palette.warning,
      );
      return;
    }

    final prefs = ref.read(appPreferencesProvider);
    final Object? rawPort = entry.meta['port'];
    final int parsedPort = rawPort is num ? rawPort.toInt() : prefs.wolPort;
    final int port = NetworkValidators.isValidPort(parsedPort)
        ? parsedPort
        : prefs.wolPort;

    final String broadcastIp =
        (entry.meta['broadcastIp']?.toString().trim().isNotEmpty ?? false)
        ? entry.meta['broadcastIp'].toString().trim()
        : prefs.wolBroadcastOverride;

    final Object? rawBurst = entry.meta['burstCount'];
    final int burstCount = (rawBurst is num ? rawBurst.toInt() : prefs.wolBurstCount)
        .clamp(1, 5);

    setState(() => _resendingEntryIds.add(entry.id));
    try {
      final result = await _dispatchPacket(
        targetMac: mac,
        targetIp: entry.hostIp,
        hostName: entry.hostName,
        port: port,
        broadcastOverride: broadcastIp,
        burstCount: burstCount,
        sendGratuitousArp: prefs.wolSendGratuitousArp,
      );
      if (!mounted) return;
      _notify(
        result.success
            ? 'Re-sent Magic Packet to $mac on UDP ${result.port}.'
            : (result.error ?? 'Re-send failed for $mac.'),
        accentColor: result.success
            ? context.palette.success
            : context.palette.accent,
      );
    } finally {
      if (mounted) {
        setState(() => _resendingEntryIds.remove(entry.id));
      }
    }
  }

  void _copyMac(String mac) {
    _hapticTap();
    unawaited(Clipboard.setData(ClipboardData(text: mac)).catchError((_) {}));
    _notify('Copied MAC $mac to clipboard.');
  }

  Future<void> _showCustomPortDialog(int currentPort) async {
    final ctrl = TextEditingController(text: currentPort.toString());
    String? errorMsg;
    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: ctx.palette.surfaceElevated,
          title: const Text('Custom WoL UDP Port'),
          content: TextField(
            key: const ValueKey('wol-custom-port-input'),
            controller: ctrl,
            keyboardType: TextInputType.number,
            decoration: InputDecoration(
              labelText: 'UDP Port (1 - 65535)',
              hintText: '9',
              errorText: errorMsg,
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                final parsed = int.tryParse(ctrl.text.trim());
                if (!NetworkValidators.isValidPort(parsed)) {
                  setDialogState(() {
                    errorMsg = 'Enter a valid port (1 - 65535)';
                  });
                  return;
                }
                unawaited(
                  ref.read(appPreferencesProvider.notifier).setWolPort(parsed!),
                );
                Navigator.of(ctx).pop();
                _notify('WoL UDP port updated to $parsed.');
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    ).whenComplete(() {
      unawaited(
        Future<void>.delayed(const Duration(milliseconds: 300), ctrl.dispose),
      );
    });
  }

  Future<void> _showBroadcastOverrideDialog(String currentOverride) async {
    final ctrl = TextEditingController(text: currentOverride);
    String? errorMsg;
    await showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          backgroundColor: ctx.palette.surfaceElevated,
          title: const Text('Broadcast IP Override'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Leave blank to use automatic global (255.255.255.255) + directed /24 subnet broadcast.',
                style: TextStyle(
                  fontSize: 12,
                  color: ctx.palette.textSecondary,
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                key: const ValueKey('wol-custom-broadcast-input'),
                controller: ctrl,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: 'Broadcast IPv4 Address',
                  hintText: '192.168.1.255',
                  errorText: errorMsg,
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                unawaited(
                  ref
                      .read(appPreferencesProvider.notifier)
                      .setWolBroadcastOverride(''),
                );
                Navigator.of(ctx).pop();
                _notify('WoL broadcast reset to Auto Subnet.');
              },
              child: const Text('Auto Subnet'),
            ),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                final trimmed = ctrl.text.trim();
                if (trimmed.isNotEmpty &&
                    !NetworkValidators.isValidIpv4(trimmed)) {
                  setDialogState(() {
                    errorMsg = 'Enter a valid IPv4 address (e.g. 192.168.1.255)';
                  });
                  return;
                }
                unawaited(
                  ref
                      .read(appPreferencesProvider.notifier)
                      .setWolBroadcastOverride(trimmed),
                );
                Navigator.of(ctx).pop();
                _notify(
                  trimmed.isEmpty
                      ? 'WoL broadcast set to Auto Subnet.'
                      : 'WoL broadcast override set to $trimmed.',
                );
              },
              child: const Text('Apply'),
            ),
          ],
        ),
      ),
    ).whenComplete(() {
      unawaited(
        Future<void>.delayed(const Duration(milliseconds: 300), ctrl.dispose),
      );
    });
  }

  Future<void> _confirmClearWolHistory() async {
    final bool confirmed =
        await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: ctx.palette.surfaceElevated,
            title: const Text('Clear WoL History?'),
            content: const Text(
              'Removes all recorded Wake-on-LAN dispatch attempts from persistent activity history.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: ctx.palette.accent,
                  foregroundColor: Colors.white,
                ),
                onPressed: () => Navigator.of(ctx).pop(true),
                child: const Text('Clear WoL'),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed || !mounted) return;
    await ref
        .read(historyProvider.notifier)
        .clearCategory(ActivityCategory.wol);
    if (!mounted) return;
    _notify('Wake-on-LAN history cleared.');
  }

  String _formatTimestamp(int timestampMs) {
    if (timestampMs <= 0) return '--:--';
    final dt = DateTime.fromMillisecondsSinceEpoch(timestampMs);
    final now = DateTime.now();
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    final ss = dt.second.toString().padLeft(2, '0');
    if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
      return '$hh:$mm:$ss';
    }
    const months = <String>[
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${months[dt.month - 1]} ${dt.day} $hh:$mm';
  }

  @override
  Widget build(BuildContext context) {
    final prefs = ref.watch(appPreferencesProvider);
    final prefsNotifier = ref.read(appPreferencesProvider.notifier);
    final allHistory = ref.watch(historyProvider);
    final wolEntries = allHistory
        .where((e) => e.category == ActivityCategory.wol)
        .toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildQuickDispatcherCard(context, prefs),
        const SizedBox(height: 12),
        _buildTuningCard(context, prefs, prefsNotifier),
        const SizedBox(height: 12),
        _buildWolHistoryCard(context, wolEntries),
      ],
    );
  }

  Widget _buildGlassCard(
    BuildContext context, {
    required Widget child,
    bool isSelected = false,
  }) {
    final palette = context.palette;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 14),
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: isSelected),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: isSelected
              ? palette.primary.withValues(alpha: 0.48)
              : palette.glassBorderIdle,
          width: 1.15,
        ),
        boxShadow: palette.elevationShadows(isSelected: isSelected),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          FluidSpecularBar(
            isSelected: isSelected,
            height: 1.1,
            margin: const EdgeInsets.only(left: 6, right: 6, bottom: 10),
          ),
          child,
        ],
      ),
    );
  }

  Widget _buildQuickDispatcherCard(
    BuildContext context,
    AppPreferencesState prefs,
  ) {
    final palette = context.palette;
    final offlineWithMacCount = widget.hosts
        .where((h) => !h.isOnline && h.hasValidMac)
        .length;

    return _buildGlassCard(
      context,
      isSelected: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  gradient: palette.squircleGradient(
                    palette.warning,
                    palette.secondary,
                  ),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.50),
                  ),
                ),
                child: const Icon(
                  Icons.bolt_rounded,
                  color: Colors.white,
                  size: 19,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Quick Wake Dispatcher',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: palette.textPrimary,
                        fontWeight: FontWeight.w800,
                        fontSize: context.fluidFont(13.5),
                      ),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      '102-byte IEEE 802.3 Magic Packet • UDP ${prefs.wolPort} • ${prefs.wolBurstCount}x burst',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: palette.textSecondary,
                        fontSize: context.fluidFont(10.5),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (widget.hosts.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              'TARGET WORKSTATION',
              style: TextStyle(
                color: palette.textTertiary,
                fontSize: context.fluidFont(9.5),
                fontWeight: FontWeight.w800,
                letterSpacing: 1.1,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final host in widget.hosts)
                  ChoiceChip(
                    key: ValueKey('wol-host-chip-${host.id}'),
                    selected: _selectedHostId == host.id,
                    selectedColor: palette.primary.withValues(alpha: 0.22),
                    avatar: Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: host.isOnline
                            ? palette.success
                            : palette.warning,
                      ),
                    ),
                    label: Text(
                      host.hasValidMac ? host.name : '${host.name} (No MAC)',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    labelStyle: TextStyle(
                      fontSize: context.fluidFont(11),
                      fontWeight: _selectedHostId == host.id
                          ? FontWeight.w700
                          : FontWeight.w600,
                      color: _selectedHostId == host.id
                          ? palette.primary
                          : palette.textPrimary,
                    ),
                    onSelected: (_) {
                      _hapticTap();
                      _applyHostSelection(host);
                    },
                  ),
                ChoiceChip(
                  key: const ValueKey('wol-host-chip-custom'),
                  selected: _selectedHostId == null,
                  selectedColor: palette.secondary.withValues(alpha: 0.22),
                  avatar: Icon(
                    Icons.edit_rounded,
                    size: 14,
                    color: _selectedHostId == null
                        ? palette.secondary
                        : palette.textSecondary,
                  ),
                  label: const Text('Custom Target'),
                  labelStyle: TextStyle(
                    fontSize: context.fluidFont(11),
                    fontWeight: _selectedHostId == null
                        ? FontWeight.w700
                        : FontWeight.w600,
                    color: _selectedHostId == null
                        ? palette.secondary
                        : palette.textPrimary,
                  ),
                  onSelected: (_) => _selectCustomTarget(),
                ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('wol-mac-input'),
            controller: _macController,
            textCapitalization: TextCapitalization.characters,
            style: TextStyle(
              color: palette.textPrimary,
              fontFamily: 'monospace',
              fontSize: context.fluidFont(12.5),
            ),
            onChanged: (_) {
              if (_macValidationError != null || _selectedHostId != null) {
                setState(() {
                  _macValidationError = null;
                  _selectedHostId = null;
                  _selectedHostName = '';
                });
              }
            },
            decoration: InputDecoration(
              isDense: true,
              labelText: 'Target MAC Address',
              hintText: 'AA:BB:CC:DD:EE:FF',
              errorText: _macValidationError,
              prefixIcon: const Icon(Icons.memory_rounded, size: 18),
              suffixIcon: _macController.text.isNotEmpty
                  ? IconButton(
                      tooltip: 'Clear MAC',
                      icon: const Icon(Icons.close_rounded, size: 17),
                      onPressed: () {
                        setState(() {
                          _macController.clear();
                          _macValidationError = null;
                          _selectedHostId = null;
                          _selectedHostName = '';
                        });
                      },
                    )
                  : null,
              filled: true,
              fillColor: palette.surface.withValues(alpha: 0.55),
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
          const SizedBox(height: 10),
          TextField(
            key: const ValueKey('wol-ip-input'),
            controller: _ipController,
            keyboardType: TextInputType.url,
            style: TextStyle(
              color: palette.textPrimary,
              fontFamily: 'monospace',
              fontSize: context.fluidFont(12),
            ),
            decoration: InputDecoration(
              isDense: true,
              labelText: 'Target Host IP (optional, for directed subnet ARP)',
              hintText: '192.168.1.50',
              prefixIcon: const Icon(Icons.lan_rounded, size: 18),
              filled: true,
              fillColor: palette.surface.withValues(alpha: 0.55),
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
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FluidPressScale(
                pressedScale: 0.96,
                child: ElevatedButton.icon(
                  key: const ValueKey('wol-send-btn'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: palette.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 11,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: _isSendingSingle ? null : _sendSinglePacket,
                  icon: _isSendingSingle
                      ? const SizedBox(
                          width: 15,
                          height: 15,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.bolt_rounded, size: 17),
                  label: Text(
                    _isSendingSingle ? 'Sending...' : 'Send Magic Packet',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),
              OutlinedButton.icon(
                key: const ValueKey('wol-wake-all-btn'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: palette.warning,
                  side: BorderSide(
                    color: palette.warning.withValues(alpha: 0.55),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 11,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                onPressed: (_isWakingAll || offlineWithMacCount == 0)
                    ? null
                    : _wakeAllOffline,
                icon: _isWakingAll
                    ? SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: palette.warning,
                        ),
                      )
                    : const Icon(Icons.power_settings_new_rounded, size: 17),
                label: Text(
                  offlineWithMacCount > 0
                      ? 'Wake All Offline ($offlineWithMacCount)'
                      : 'Wake All Offline',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTuningCard(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) {
    final palette = context.palette;
    final bool isModified = prefs.isModified(SettingsSection.wol);
    final bool isCustomPort = prefs.wolPort != 7 && prefs.wolPort != 9;
    final bool hasCustomBroadcast = prefs.wolBroadcastOverride.trim().isNotEmpty;

    return _buildGlassCard(
      context,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.tune_rounded, size: 18, color: palette.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'WoL Network Tuning',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: palette.textPrimary,
                    fontWeight: FontWeight.w800,
                    fontSize: context.fluidFont(13),
                  ),
                ),
              ),
              if (isModified)
                TextButton.icon(
                  key: const ValueKey('wol-reset-tuning-btn'),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    foregroundColor: palette.primary,
                  ),
                  onPressed: () {
                    _hapticTap();
                    unawaited(prefsNotifier.resetSection(SettingsSection.wol));
                    _notify('WoL tuning reset to defaults.');
                  },
                  icon: const Icon(Icons.restart_alt_rounded, size: 15),
                  label: const Text('Reset'),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'UDP Destination Port',
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(11),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final port in const <int>[7, 9])
                ChoiceChip(
                  key: ValueKey('wol-port-$port'),
                  label: Text('UDP $port'),
                  selected: prefs.wolPort == port,
                  selectedColor: palette.primary.withValues(alpha: 0.22),
                  labelStyle: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11.5,
                    fontWeight: prefs.wolPort == port
                        ? FontWeight.w800
                        : FontWeight.w600,
                    color: prefs.wolPort == port
                        ? palette.primary
                        : palette.textSecondary,
                  ),
                  onSelected: (_) {
                    _hapticTap();
                    unawaited(prefsNotifier.setWolPort(port));
                  },
                ),
              ChoiceChip(
                key: const ValueKey('wol-port-custom'),
                label: Text(
                  isCustomPort ? 'Custom (${prefs.wolPort})' : 'Custom...',
                ),
                selected: isCustomPort,
                selectedColor: palette.secondary.withValues(alpha: 0.22),
                labelStyle: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11.5,
                  fontWeight: isCustomPort ? FontWeight.w800 : FontWeight.w600,
                  color: isCustomPort
                      ? palette.secondary
                      : palette.textSecondary,
                ),
                onSelected: (_) {
                  _hapticTap();
                  unawaited(_showCustomPortDialog(prefs.wolPort));
                },
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Broadcast IP Override',
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(11),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ChoiceChip(
                key: const ValueKey('wol-broadcast-auto'),
                label: const Text('Auto Subnet'),
                selected: !hasCustomBroadcast,
                selectedColor: palette.primary.withValues(alpha: 0.22),
                labelStyle: TextStyle(
                  fontSize: 11.5,
                  fontWeight: !hasCustomBroadcast
                      ? FontWeight.w800
                      : FontWeight.w600,
                  color: !hasCustomBroadcast
                      ? palette.primary
                      : palette.textSecondary,
                ),
                onSelected: (_) {
                  _hapticTap();
                  unawaited(prefsNotifier.setWolBroadcastOverride(''));
                },
              ),
              ChoiceChip(
                key: const ValueKey('wol-broadcast-custom'),
                label: Text(
                  hasCustomBroadcast
                      ? prefs.wolBroadcastOverride
                      : 'Custom IPv4...',
                ),
                selected: hasCustomBroadcast,
                selectedColor: palette.secondary.withValues(alpha: 0.22),
                labelStyle: TextStyle(
                  fontFamily: hasCustomBroadcast ? 'monospace' : null,
                  fontSize: 11.5,
                  fontWeight: hasCustomBroadcast
                      ? FontWeight.w800
                      : FontWeight.w600,
                  color: hasCustomBroadcast
                      ? palette.secondary
                      : palette.textSecondary,
                ),
                onSelected: (_) {
                  _hapticTap();
                  unawaited(
                    _showBroadcastOverrideDialog(prefs.wolBroadcastOverride),
                  );
                },
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Magic Packet Burst Count',
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(11),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (int count = 1; count <= 5; count++)
                ChoiceChip(
                  key: ValueKey('wol-burst-$count'),
                  label: Text('${count}x'),
                  selected: prefs.wolBurstCount == count,
                  selectedColor: palette.primary.withValues(alpha: 0.22),
                  labelStyle: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11.5,
                    fontWeight: prefs.wolBurstCount == count
                        ? FontWeight.w800
                        : FontWeight.w600,
                    color: prefs.wolBurstCount == count
                        ? palette.primary
                        : palette.textSecondary,
                  ),
                  onSelected: (_) {
                    _hapticTap();
                    unawaited(prefsNotifier.setWolBurstCount(count));
                  },
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Gratuitous ARP Cache Injection',
                      style: TextStyle(
                        color: palette.textPrimary,
                        fontSize: context.fluidFont(12),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Primes Wi-Fi AP ARP mapping before sending Magic Packets.',
                      style: TextStyle(
                        color: palette.textSecondary,
                        fontSize: context.fluidFont(10.5),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Switch.adaptive(
                key: const ValueKey('wol-garp-switch'),
                value: prefs.wolSendGratuitousArp,
                activeTrackColor: palette.primary.withValues(alpha: 0.5),
                activeThumbColor: palette.primary,
                onChanged: (enabled) {
                  _hapticTap();
                  unawaited(prefsNotifier.setWolSendGratuitousArp(enabled));
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildWolHistoryCard(
    BuildContext context,
    List<ActivityHistoryEntry> wolEntries,
  ) {
    final palette = context.palette;
    final int totalCount = wolEntries.length;
    final int sentCount = wolEntries.where((e) => e.status != 'failed').length;
    final int failedCount = wolEntries
        .where((e) => e.status == 'failed')
        .length;

    final String q = _historyQuery.trim().toLowerCase();
    final List<ActivityHistoryEntry> filtered = q.isEmpty
        ? wolEntries
        : wolEntries
              .where((e) {
                final hay =
                    '${e.hostName} ${e.hostIp} ${e.mac} ${e.title} ${e.detail} ${e.status} ${e.meta['broadcastIp'] ?? ''} ${e.meta['port'] ?? ''}'
                        .toLowerCase();
                return hay.contains(q);
              })
              .toList(growable: false);

    return _buildGlassCard(
      context,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.history_rounded, size: 18, color: palette.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'WoL Dispatch History',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: palette.textPrimary,
                    fontWeight: FontWeight.w800,
                    fontSize: context.fluidFont(13),
                  ),
                ),
              ),
              if (wolEntries.isNotEmpty)
                TextButton.icon(
                  key: const ValueKey('wol-clear-history-btn'),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    foregroundColor: palette.accent,
                  ),
                  onPressed: _confirmClearWolHistory,
                  icon: const Icon(Icons.delete_outline_rounded, size: 16),
                  label: const Text('Clear'),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _statPill(
                context,
                label: 'Total $totalCount',
                color: palette.primary,
              ),
              _statPill(
                context,
                label: 'Sent $sentCount',
                color: palette.success,
              ),
              _statPill(
                context,
                label: 'Failed $failedCount',
                color: failedCount > 0 ? palette.accent : palette.textSecondary,
              ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            key: const ValueKey('wol-history-search'),
            controller: _historySearchController,
            onChanged: (value) => setState(() => _historyQuery = value),
            style: TextStyle(
              color: palette.textPrimary,
              fontSize: context.fluidFont(12),
            ),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Filter WoL logs by host, MAC, IP, or status...',
              prefixIcon: const Icon(Icons.search_rounded, size: 18),
              suffixIcon: _historyQuery.isNotEmpty
                  ? IconButton(
                      tooltip: 'Clear WoL search',
                      icon: const Icon(Icons.close_rounded, size: 16),
                      onPressed: () {
                        _historySearchController.clear();
                        setState(() => _historyQuery = '');
                      },
                    )
                  : null,
              filled: true,
              fillColor: palette.surface.withValues(alpha: 0.55),
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
          const SizedBox(height: 10),
          if (filtered.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 18),
              decoration: BoxDecoration(
                color: palette.surface.withValues(alpha: 0.45),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: palette.dividerColor),
              ),
              child: Column(
                children: [
                  Icon(
                    Icons.bolt_outlined,
                    size: 26,
                    color: palette.textTertiary,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    wolEntries.isEmpty
                        ? 'No Wake-on-LAN Packets Sent Yet'
                        : 'No Matching WoL Entries',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: palette.textPrimary,
                      fontWeight: FontWeight.w700,
                      fontSize: context.fluidFont(12),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    wolEntries.isEmpty
                        ? 'Every Magic Packet sent from cards or Quick Wake appears here with target telemetry.'
                        : 'Try clearing your WoL history filter.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: palette.textSecondary,
                      fontSize: context.fluidFont(10.5),
                    ),
                  ),
                ],
              ),
            )
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (int i = 0; i < filtered.length; i++) ...[
                  if (i > 0) const SizedBox(height: 8),
                  _buildWolEntryTile(context, filtered[i]),
                ],
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildWolEntryTile(BuildContext context, ActivityHistoryEntry entry) {
    final palette = context.palette;
    final bool isFailed = entry.status == 'failed';
    final Color statusColor = isFailed ? palette.accent : palette.success;
    final String statusLabel = isFailed ? 'FAILED' : 'SENT';
    final String hostTitle = entry.hostName.trim().isNotEmpty
        ? entry.hostName.trim()
        : (entry.hostIp.trim().isNotEmpty
              ? entry.hostIp.trim()
              : (entry.mac.trim().isNotEmpty ? entry.mac.trim() : 'Target PC'));

    final Object? rawPort = entry.meta['port'];
    final int port = rawPort is num ? rawPort.toInt() : 9;
    final Object? rawBurst = entry.meta['burstCount'];
    final int burstCount = rawBurst is num ? rawBurst.toInt() : 1;
    final String broadcastRaw = (entry.meta['broadcastIp'] ?? '')
        .toString()
        .trim();
    final List<String> targets = entry.meta['targets'] is List
        ? (entry.meta['targets'] as List).map((e) => e.toString()).toList()
        : const <String>[];
    final String broadcastLabel = broadcastRaw.isNotEmpty
        ? broadcastRaw
        : (targets.isNotEmpty ? targets.join(', ') : 'Auto Subnet');

    final bool hasValidMac = NetworkValidators.normalizeMac(entry.mac) != null;
    final bool isResending = _resendingEntryIds.contains(entry.id);

    return Container(
      key: ValueKey('wol-history-entry-${entry.id}'),
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: palette.surface.withValues(alpha: 0.65),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: palette.dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      hostTitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: palette.textPrimary,
                        fontWeight: FontWeight.w800,
                        fontSize: context.fluidFont(12),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      entry.mac.isNotEmpty ? entry.mac : 'Unknown MAC',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: palette.primary,
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w700,
                        fontSize: context.fluidFont(10.5),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: statusColor.withValues(
                    alpha: palette.isDaylight ? 0.12 : 0.18,
                  ),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: statusColor.withValues(alpha: 0.45),
                  ),
                ),
                child: Text(
                  statusLabel,
                  style: TextStyle(
                    color: statusColor,
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.w800,
                    fontSize: context.fluidFont(9.5),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 5,
            children: [
              _metaChip(context, 'UDP $port'),
              _metaChip(context, '${burstCount}x burst'),
              _metaChip(context, broadcastLabel),
              _metaChip(context, _formatTimestamp(entry.timestampMs)),
              if (entry.latencyMs != null)
                _metaChip(context, '${entry.latencyMs}ms'),
            ],
          ),
          if (entry.detail.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              entry.detail,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: palette.textSecondary,
                fontSize: context.fluidFont(10.5),
              ),
            ),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              if (hasValidMac)
                OutlinedButton.icon(
                  key: ValueKey('wol-resend-${entry.id}'),
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    foregroundColor: palette.primary,
                    side: BorderSide(
                      color: palette.primary.withValues(alpha: 0.45),
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(11),
                    ),
                  ),
                  onPressed: isResending
                      ? null
                      : () => _resendHistoryEntry(entry),
                  icon: isResending
                      ? SizedBox(
                          width: 12,
                          height: 12,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: palette.primary,
                          ),
                        )
                      : const Icon(Icons.replay_rounded, size: 14),
                  label: Text(
                    isResending ? 'Sending...' : 'Re-Send',
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              if (entry.mac.trim().isNotEmpty)
                OutlinedButton.icon(
                  key: ValueKey('wol-copy-mac-${entry.id}'),
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                    foregroundColor: palette.textPrimary,
                    side: BorderSide(color: palette.dividerColor),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(11),
                    ),
                  ),
                  onPressed: () => _copyMac(entry.mac.trim()),
                  icon: const Icon(Icons.copy_rounded, size: 14),
                  label: const Text(
                    'Copy MAC',
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statPill(
    BuildContext context, {
    required String label,
    required Color color,
  }) {
    final palette = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: palette.isDaylight ? 0.10 : 0.16),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontFamily: 'monospace',
          fontSize: context.fluidFont(10),
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  Widget _metaChip(BuildContext context, String label) {
    final palette = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(
        color: palette.surfaceElevated.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: palette.dividerColor),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: palette.textSecondary,
          fontFamily: 'monospace',
          fontSize: context.fluidFont(9.5),
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
