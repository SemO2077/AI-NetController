import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../security/network_validators.dart';
import '../services/app_preferences.dart';
import '../services/history_store.dart';
import '../services/os_integrations_manager.dart';
import '../theme/fluid_theme.dart';
import 'activity_history_panel.dart';
import 'onboarding_sheet.dart';
import 'wol_hub_panel.dart';

export 'wol_hub_panel.dart'
    show SettingsHostSummary, ToastCallback, WolDispatchCallback;

/// Operational hubs presented in the top Bento quick-deck.
enum SettingsDeckHub { streaming, touch, wol, history, security, network }

class _SearchableSettingEntry {
  final String id;
  final String category;
  final String title;
  final String subtitle;
  final List<String> keywords;
  final Widget Function(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  )
  builder;

  const _SearchableSettingEntry({
    required this.id,
    required this.category,
    required this.title,
    required this.subtitle,
    required this.keywords,
    required this.builder,
  });

  bool matches(String queryLower) {
    final tokens = queryLower
        .split(RegExp(r'\s+'))
        .where((t) => t.isNotEmpty)
        .toList(growable: false);
    if (tokens.isEmpty) return true;
    final haystack =
        '${title.toLowerCase()} ${subtitle.toLowerCase()} ${category.toLowerCase()} ${keywords.join(' ').toLowerCase()}';
    for (final token in tokens) {
      if (!haystack.contains(token)) return false;
    }
    return true;
  }
}

/// Ground-up Command-Deck Control Hub for streaming, touch controls,
/// Wake-on-LAN, unified audit history, security vault, appearance studio,
/// and sanitized JSON config backup/restore.
class SettingsCommandDeck extends ConsumerStatefulWidget {
  final List<SettingsHostSummary> hosts;
  final String savedGlobalSecret;
  final bool? hasConfiguredSecretOverride;
  final VoidCallback? onOpenPairingDialog;
  final ValueChanged<int>? onOpenDiscoveryPortDialog;
  final VoidCallback? onConfirmPurgeAllSecrets;
  final VoidCallback? onOpenOnboardingGuide;
  final ValueChanged<List<Map<String, dynamic>>>? onImportSanitizedHosts;
  final Future<void> Function(ActivityHistoryEntry entry)? onRerunCommand;
  final WolDispatchCallback? onDispatchWol;
  final ToastCallback? onToast;
  final SettingsDeckHub initialHub;
  final bool initialAppearanceExpanded;

  const SettingsCommandDeck({
    super.key,
    this.hosts = const <SettingsHostSummary>[],
    this.savedGlobalSecret = '',
    this.hasConfiguredSecretOverride,
    this.onOpenPairingDialog,
    this.onOpenDiscoveryPortDialog,
    this.onConfirmPurgeAllSecrets,
    this.onOpenOnboardingGuide,
    this.onImportSanitizedHosts,
    this.onRerunCommand,
    this.onDispatchWol,
    this.onToast,
    this.initialHub = SettingsDeckHub.streaming,
    this.initialAppearanceExpanded = false,
  });

  @override
  ConsumerState<SettingsCommandDeck> createState() =>
      _SettingsCommandDeckState();
}

class _SettingsCommandDeckState extends ConsumerState<SettingsCommandDeck> {
  late SettingsDeckHub _activeHub;
  late bool _appearanceExpanded;
  late final TextEditingController _searchController;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _activeHub = widget.initialHub;
    _appearanceExpanded = widget.initialAppearanceExpanded;
    _searchController = TextEditingController();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  bool get _hasSecret =>
      widget.hasConfiguredSecretOverride ??
      widget.savedGlobalSecret.trim().isNotEmpty;

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

  String _formatEnumLabel(Enum value) {
    final raw = value.name;
    if (raw.isEmpty) return raw;
    return '${raw[0].toUpperCase()}${raw.substring(1)}';
  }

  Future<void> _handleOpenDiscoveryPort(int currentPort) async {
    _hapticTap();
    if (widget.onOpenDiscoveryPortDialog != null) {
      widget.onOpenDiscoveryPortDialog!(currentPort);
      return;
    }
    final int? parsed = await showDialog<int>(
      context: context,
      builder: (_) => _DiscoveryPortDialog(initialPort: currentPort),
    );
    if (parsed == null || !mounted) return;
    unawaited(
      ref.read(appPreferencesProvider.notifier).setCustomScanPort(parsed),
    );
    _notify('Default scan port updated to $parsed.');
  }

  void _handleOpenOnboarding() {
    _hapticTap();
    if (widget.onOpenOnboardingGuide != null) {
      widget.onOpenOnboardingGuide!();
      return;
    }
    unawaited(
      AdaptiveOnboardingSheet.show(
        context,
        onCompleted: () => unawaited(
          ref.read(appPreferencesProvider.notifier).setOnboardingCompleted(true),
        ),
      ),
    );
  }

  void _handleOpenPairing() {
    _hapticTap();
    if (widget.onOpenPairingDialog != null) {
      widget.onOpenPairingDialog!();
      return;
    }
    _notify('Open Fleet Pairing to configure or rotate workstation tokens.');
  }

  void _handlePurgeSecrets() {
    _hapticTap();
    if (widget.onConfirmPurgeAllSecrets != null) {
      widget.onConfirmPurgeAllSecrets!();
      return;
    }
    _notify('No host vault handler attached to purge pairing secrets.');
  }

  Future<void> _handleResendWolFromHistory(ActivityHistoryEntry entry) async {
    final String? mac = NetworkValidators.normalizeMac(entry.mac);
    if (mac == null) {
      _notify(
        'Cannot re-send WoL: entry has no valid MAC address.',
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
    final int burstCount =
        (rawBurst is num ? rawBurst.toInt() : prefs.wolBurstCount).clamp(1, 5);

    final String safeIp = NetworkValidators.isValidIpv4(entry.hostIp)
        ? entry.hostIp.trim()
        : '';
    final String? safeBroadcast = NetworkValidators.isValidIpv4(broadcastIp)
        ? broadcastIp
        : null;

    final WolDispatchResult result;
    if (widget.onDispatchWol != null) {
      result = await widget.onDispatchWol!(
        targetMac: mac,
        targetIp: safeIp,
        hostName: entry.hostName,
        port: port,
        customBroadcastIp: safeBroadcast,
        burstCount: burstCount,
        sendGratuitousArp: prefs.wolSendGratuitousArp,
      );
    } else {
      result = await OsIntegrationsManager.instance.sendWakePacketDetailed(
        targetMac: mac,
        targetIp: safeIp,
        port: port,
        customBroadcastIp: safeBroadcast,
        burstCount: burstCount,
        sendBothPorts: port == 9,
        sendGratuitousArp: prefs.wolSendGratuitousArp,
      );
    }

    await ref
        .read(historyProvider.notifier)
        .recordWol(
          mac: result.mac.isNotEmpty ? result.mac : mac,
          hostName: entry.hostName,
          hostIp: entry.hostIp,
          success: result.success,
          port: result.port,
          broadcastIp: broadcastIp,
          burstCount: result.burstCount,
          latencyMs: result.latencyMs,
          targets: result.targets,
          error: result.error,
        );

    if (!mounted) return;
    _notify(
      result.success
          ? 'Re-sent WoL packet to $mac (UDP ${result.port}).'
          : (result.error ?? 'Failed to re-send WoL packet.'),
      accentColor: result.success
          ? context.palette.success
          : context.palette.accent,
    );
  }

  Future<void> _exportConfigJson() async {
    _hapticTap();
    final prefsNotifier = ref.read(appPreferencesProvider.notifier);
    final hostMaps = widget.hosts
        .map((h) => h.toSanitizedMap())
        .toList(growable: false);
    final jsonText = prefsNotifier.exportConfigJson(hosts: hostMaps);

    unawaited(
      Clipboard.setData(ClipboardData(text: jsonText)).catchError((_) {}),
    );
    _notify(
      'Sanitized Config JSON copied to clipboard (${hostMaps.length} host(s)).',
      accentColor: context.palette.success,
    );

    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetCtx) {
        final palette = sheetCtx.palette;
        final size = MediaQuery.sizeOf(sheetCtx);
        return SafeArea(
          child: Container(
            constraints: BoxConstraints(
              maxHeight: (size.height * 0.78).clamp(240.0, 620.0),
              maxWidth: 580,
            ),
            margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            decoration: BoxDecoration(
              color: palette.surfaceElevated.withValues(alpha: 0.97),
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: palette.glassBorderIdle, width: 1.2),
              boxShadow: palette.elevationShadows(isSelected: true),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: palette.textTertiary.withValues(alpha: 0.35),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Icon(
                      Icons.shield_outlined,
                      color: palette.success,
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Exported Config JSON',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: palette.textPrimary,
                          fontWeight: FontWeight.w800,
                          fontSize: 15,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Close',
                      icon: const Icon(Icons.close_rounded, size: 20),
                      onPressed: () => Navigator.of(sheetCtx).pop(),
                    ),
                  ],
                ),
                Text(
                  'Sanitized backup — pairing secrets, PINs, and fingerprints are strictly omitted.',
                  style: TextStyle(
                    color: palette.textSecondary,
                    fontSize: 11.5,
                  ),
                ),
                const SizedBox(height: 10),
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: palette.surface.withValues(alpha: 0.85),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: palette.dividerColor),
                    ),
                    child: SingleChildScrollView(
                      child: SelectableText(
                        jsonText,
                        style: TextStyle(
                          color: palette.textPrimary,
                          fontFamily: 'monospace',
                          fontSize: 11,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  alignment: WrapAlignment.end,
                  children: [
                    OutlinedButton(
                      onPressed: () => Navigator.of(sheetCtx).pop(),
                      child: const Text('Close'),
                    ),
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: palette.primary,
                        foregroundColor: palette.onPrimary,
                      ),
                      onPressed: () {
                        unawaited(
                          Clipboard.setData(
                            ClipboardData(text: jsonText),
                          ).catchError((_) {}),
                        );
                        _notify('Copied Config JSON to clipboard.');
                      },
                      icon: const Icon(Icons.copy_rounded, size: 16),
                      label: const Text('Copy JSON'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _showImportConfigDialog() async {
    _hapticTap();
    final result = await showDialog<
        ({bool ok, String message, List<Map<String, dynamic>> importedHosts})>(
      context: context,
      builder: (_) => _ImportConfigDialog(
        onImport: (raw) =>
            ref.read(appPreferencesProvider.notifier).importConfigJson(raw),
      ),
    );
    if (result == null || !result.ok || !mounted) return;
    if (result.importedHosts.isNotEmpty) {
      widget.onImportSanitizedHosts?.call(result.importedHosts);
    }
    await ref.read(historyProvider.notifier).recordSystem(
          title: 'Configuration Restored',
          detail: result.message,
          status: 'success',
        );
    if (!mounted) return;
    _notify(
      result.message,
      accentColor: context.palette.success,
    );
  }

  Future<void> _confirmResetAll() async {
    _hapticTap();
    final bool confirmed =
        await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: ctx.palette.surfaceElevated,
            title: const Text('Reset All Preferences?'),
            content: const Text(
              'Restores default theme, streaming, touch, WoL, security, and network settings while keeping paired workstations.',
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
                child: const Text('Reset All'),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed || !mounted) return;
    await ref.read(appPreferencesProvider.notifier).resetDefaults();
    if (!mounted) return;
    _notify('Preferences restored to default settings.');
  }

  @override
  Widget build(BuildContext context) {
    final prefs = ref.watch(appPreferencesProvider);
    final prefsNotifier = ref.read(appPreferencesProvider.notifier);
    final historyCount = ref.watch(
      historyProvider.select((entries) => entries.length),
    );
    final palette = context.palette;
    final String queryLower = _searchQuery.trim().toLowerCase();

    return ListView(
      physics: const BouncingScrollPhysics(),
      padding: FluidSize.pagePadding(context),
      children: [
        _buildLiveControlDeckHeader(context, prefs, palette),
        const SizedBox(height: 12),
        _buildSearchBar(context, palette),
        const SizedBox(height: 14),
        if (queryLower.isNotEmpty) ...[
          _buildSearchResultsSection(
            context,
            queryLower: queryLower,
            prefs: prefs,
            prefsNotifier: prefsNotifier,
            palette: palette,
          ),
        ] else ...[
          _buildSectionHeader(context, 'OPERATIONAL COMMAND BENTO'),
          const SizedBox(height: 8),
          _buildOperationalBentoGrid(
            context,
            prefs: prefs,
            historyCount: historyCount,
            palette: palette,
          ),
          const SizedBox(height: 14),
          _buildActiveHubDeck(
            context,
            prefs: prefs,
            prefsNotifier: prefsNotifier,
            palette: palette,
          ),
          const SizedBox(height: 18),
          _buildSectionHeader(context, 'APPEARANCE STUDIO (PERSISTENT)'),
          const SizedBox(height: 8),
          _buildAppearanceBentoTile(context, prefs, palette),
          AnimatedSize(
            duration: MediaQuery.disableAnimationsOf(context)
                ? Duration.zero
                : const Duration(milliseconds: 240),
            curve: Curves.easeOutCubic,
            child: _appearanceExpanded
                ? Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: _buildAppearanceStudioCard(
                      context,
                      prefs,
                      prefsNotifier,
                      palette,
                    ),
                  )
                : const SizedBox.shrink(),
          ),
          const SizedBox(height: 18),
          _buildSectionHeader(context, 'BACKUP & MAINTENANCE'),
          const SizedBox(height: 8),
          _buildConfigBackupCard(context, palette),
          _buildQuickStartTile(context, palette),
          _buildResetAllTile(context, palette),
          _buildAboutTile(context, palette),
        ],
      ],
    );
  }

  Widget _buildLiveControlDeckHeader(
    BuildContext context,
    AppPreferencesState prefs,
    CyberPalette palette,
  ) {
    final int totalCount = widget.hosts.length;
    final int onlineCount = widget.hosts.where((h) => h.isOnline).length;
    final bool vaultLocked = _hasSecret && prefs.enableE2eVault;

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 14),
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: true),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: palette.primary.withValues(alpha: 0.42),
          width: 1.2,
        ),
        boxShadow: palette.elevationShadows(isSelected: true),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const FluidSpecularBar(
            isSelected: true,
            height: 1.2,
            margin: EdgeInsets.only(left: 6, right: 6, bottom: 10),
          ),
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(13),
                  gradient: palette.heroGradient,
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.55),
                  ),
                ),
                child: const Icon(
                  Icons.dashboard_customize_rounded,
                  color: Colors.white,
                  size: 20,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Command Deck',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: palette.textPrimary,
                        fontWeight: FontWeight.w800,
                        fontSize: context.fluidFont(15),
                        letterSpacing: -0.2,
                      ),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      'Live operational telemetry, controls & vault state',
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
          const SizedBox(height: 10),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: [
              _telemetryBadge(
                context,
                icon: vaultLocked
                    ? Icons.verified_user_rounded
                    : Icons.lock_open_rounded,
                label: vaultLocked ? 'Vault Locked' : 'Setup Needed',
                color: vaultLocked ? palette.success : palette.warning,
                onTap: () => _jumpToHub(SettingsDeckHub.security),
              ),
              _telemetryBadge(
                context,
                icon: Icons.devices_rounded,
                label: '$onlineCount/$totalCount Online',
                color: onlineCount > 0 ? palette.sky : palette.textSecondary,
              ),
              _telemetryBadge(
                context,
                icon: Icons.speed_rounded,
                label:
                    '${prefs.targetFps}fps • ${prefs.streamQualityPreset.toUpperCase()}',
                color: palette.primary,
                onTap: () => _jumpToHub(SettingsDeckHub.streaming),
              ),
              _telemetryBadge(
                context,
                icon: Icons.bolt_rounded,
                label: 'WoL UDP ${prefs.wolPort}',
                color: palette.secondary,
                onTap: () => _jumpToHub(SettingsDeckHub.wol),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _jumpToHub(SettingsDeckHub hub) {
    _hapticTap();
    if (_searchQuery.isNotEmpty) {
      _searchController.clear();
    }
    setState(() {
      _searchQuery = '';
      _activeHub = hub;
    });
  }

  Widget _telemetryBadge(
    BuildContext context, {
    required IconData icon,
    required String label,
    required Color color,
    VoidCallback? onTap,
  }) {
    final palette = context.palette;
    final Widget badge = Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: palette.isDaylight ? 0.11 : 0.17),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.36)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: color,
                fontFamily: 'monospace',
                fontSize: context.fluidFont(10),
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return badge;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: badge,
      ),
    );
  }

  Widget _buildSearchBar(BuildContext context, CyberPalette palette) {
    return Container(
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: _searchQuery.isNotEmpty),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: _searchQuery.isNotEmpty
              ? palette.primary.withValues(alpha: 0.50)
              : palette.glassBorderIdle,
          width: 1.15,
        ),
        boxShadow: palette.elevationShadows(isSelected: false),
      ),
      child: TextField(
        key: const ValueKey('settings-search-input'),
        controller: _searchController,
        onChanged: (value) => setState(() => _searchQuery = value),
        style: TextStyle(
          color: palette.textPrimary,
          fontSize: context.fluidFont(12.5),
          fontWeight: FontWeight.w600,
        ),
        decoration: InputDecoration(
          hintText: 'Search all settings (fps, trackpad, WoL, vault, theme)...',
          hintStyle: TextStyle(
            color: palette.textTertiary,
            fontSize: context.fluidFont(11.5),
          ),
          prefixIcon: Icon(
            Icons.search_rounded,
            size: 20,
            color: palette.primary,
          ),
          suffixIcon: _searchQuery.isNotEmpty
              ? IconButton(
                  tooltip: 'Clear search',
                  icon: const Icon(Icons.close_rounded, size: 18),
                  onPressed: () {
                    _searchController.clear();
                    setState(() => _searchQuery = '');
                  },
                )
              : null,
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 14,
            vertical: 12,
          ),
        ),
      ),
    );
  }

  Widget _buildOperationalBentoGrid(
    BuildContext context, {
    required AppPreferencesState prefs,
    required int historyCount,
    required CyberPalette palette,
  }) {
    final tiles = <Widget>[
      _buildBentoHubTile(
        context,
        key: const ValueKey('settings-hub-streaming'),
        hub: SettingsDeckHub.streaming,
        icon: Icons.live_tv_rounded,
        title: 'Streaming',
        readout:
            '${prefs.targetFps}fps • ${prefs.streamQualityPreset.toUpperCase()} • ${prefs.cardSnapshotIntervalSec == 0 ? 'Manual' : '${prefs.cardSnapshotIntervalSec}s'}',
        isModified: prefs.isModified(SettingsSection.streaming),
        gradientStart: palette.primary,
        gradientEnd: palette.sky,
        palette: palette,
      ),
      _buildBentoHubTile(
        context,
        key: const ValueKey('settings-hub-touch'),
        hub: SettingsDeckHub.touch,
        icon: Icons.touch_app_rounded,
        title: 'Touch & Controls',
        readout:
            '${prefs.defaultInputMode == RemoteInputMode.touchscreen ? 'Direct Touch' : 'Trackpad'} • ${prefs.trackpadSensitivity.toStringAsFixed(1)}x',
        isModified: prefs.isModified(SettingsSection.touch),
        gradientStart: palette.secondary,
        gradientEnd: palette.primary,
        palette: palette,
      ),
      _buildBentoHubTile(
        context,
        key: const ValueKey('settings-hub-wol'),
        hub: SettingsDeckHub.wol,
        icon: Icons.bolt_rounded,
        title: 'Wake-on-LAN',
        readout:
            'UDP ${prefs.wolPort} • ${prefs.wolBurstCount}x${prefs.wolBroadcastOverride.isNotEmpty ? ' • Custom' : ' • Auto'}',
        isModified: prefs.isModified(SettingsSection.wol),
        gradientStart: palette.warning,
        gradientEnd: palette.accent,
        palette: palette,
      ),
      _buildBentoHubTile(
        context,
        key: const ValueKey('settings-hub-history'),
        hub: SettingsDeckHub.history,
        icon: Icons.history_rounded,
        title: 'History & Audit',
        readout:
            '$historyCount ${historyCount == 1 ? 'recorded event' : 'recorded events'}',
        badgeText: historyCount > 0 ? '$historyCount' : null,
        badgeColor: palette.sky,
        gradientStart: palette.sky,
        gradientEnd: palette.secondary,
        palette: palette,
      ),
      _buildBentoHubTile(
        context,
        key: const ValueKey('settings-hub-security'),
        hub: SettingsDeckHub.security,
        icon: Icons.shield_rounded,
        title: 'Security & Vault',
        readout:
            '${prefs.enableE2eVault ? 'AEAD On' : 'AEAD Off'} • ${prefs.preferTls ? 'WSS' : 'WS'}',
        isModified: prefs.isModified(SettingsSection.security),
        gradientStart: palette.success,
        gradientEnd: palette.sky,
        palette: palette,
      ),
      _buildBentoHubTile(
        context,
        key: const ValueKey('settings-hub-network'),
        hub: SettingsDeckHub.network,
        icon: Icons.wifi_tethering_rounded,
        title: 'Network',
        readout: 'Scan Port ${prefs.customScanPort}',
        isModified: prefs.isModified(SettingsSection.network),
        gradientStart: palette.primary,
        gradientEnd: palette.secondary,
        palette: palette,
      ),
    ];

    return LayoutBuilder(
      builder: (context, constraints) {
        final bool singleCol = constraints.maxWidth < 300;
        if (singleCol) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (int i = 0; i < tiles.length; i++) ...[
                if (i > 0) const SizedBox(height: 10),
                tiles[i],
              ],
            ],
          );
        }

        final rows = <Widget>[];
        for (int i = 0; i < tiles.length; i += 2) {
          if (i > 0) rows.add(const SizedBox(height: 10));
          rows.add(
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: tiles[i]),
                  const SizedBox(width: 10),
                  Expanded(
                    child: i + 1 < tiles.length
                        ? tiles[i + 1]
                        : const SizedBox.shrink(),
                  ),
                ],
              ),
            ),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: rows,
        );
      },
    );
  }

  Widget _buildBentoHubTile(
    BuildContext context, {
    required Key key,
    required SettingsDeckHub hub,
    required IconData icon,
    required String title,
    required String readout,
    required Color gradientStart,
    required Color gradientEnd,
    required CyberPalette palette,
    bool isModified = false,
    String? badgeText,
    Color? badgeColor,
  }) {
    final bool selected = _activeHub == hub;
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final Duration dur = disableAnim
        ? Duration.zero
        : const Duration(milliseconds: 200);

    final String? effectiveBadge = badgeText ?? (isModified ? 'Modified' : null);
    final Color effectiveBadgeColor = badgeColor ?? palette.warning;

    return Semantics(
      button: true,
      selected: selected,
      label: '$title hub, $readout',
      child: FluidPressScale(
        pressedScale: 0.96,
        onTap: () {
          _hapticTap();
          setState(() => _activeHub = hub);
        },
        child: AnimatedContainer(
        key: key,
        duration: dur,
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
        decoration: BoxDecoration(
          gradient: palette.cardBevelGradient(isSelected: selected),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(
            color: selected
                ? palette.primary.withValues(alpha: 0.72)
                : palette.glassBorderIdle,
            width: selected ? 1.6 : 1.1,
          ),
          boxShadow: palette.elevationShadows(
            isSelected: selected,
            glowColor: gradientStart,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            FluidSpecularBar(
              isSelected: selected,
              height: 1.0,
              margin: const EdgeInsets.only(left: 4, right: 4, bottom: 9),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(11),
                    gradient: palette.squircleGradient(
                      gradientStart,
                      gradientEnd,
                    ),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.50),
                    ),
                  ),
                  child: Icon(icon, color: Colors.white, size: 18),
                ),
                if (effectiveBadge != null) ...[
                  const SizedBox(width: 6),
                  Flexible(
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 2.5,
                      ),
                      decoration: BoxDecoration(
                        color: effectiveBadgeColor.withValues(
                          alpha: palette.isDaylight ? 0.14 : 0.20,
                        ),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                          color: effectiveBadgeColor.withValues(alpha: 0.42),
                        ),
                      ),
                      child: Text(
                        effectiveBadge,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: effectiveBadgeColor,
                          fontFamily: 'monospace',
                          fontSize: context.fluidFont(9),
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 10),
            Text(
              title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: palette.textPrimary,
                fontWeight: FontWeight.w800,
                fontSize: context.fluidFont(12.5),
              ),
            ),
            const SizedBox(height: 3),
            Text(
              readout,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: selected ? palette.primary : palette.textSecondary,
                fontFamily: 'monospace',
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                fontSize: context.fluidFont(10),
              ),
            ),
          ],
        ),
      ),
      ),
    );
  }

  SettingsSection? _sectionForHub(SettingsDeckHub hub) {
    return switch (hub) {
      SettingsDeckHub.streaming => SettingsSection.streaming,
      SettingsDeckHub.touch => SettingsSection.touch,
      SettingsDeckHub.wol => SettingsSection.wol,
      SettingsDeckHub.history => null,
      SettingsDeckHub.security => SettingsSection.security,
      SettingsDeckHub.network => SettingsSection.network,
    };
  }

  String _hubTitle(SettingsDeckHub hub) {
    return switch (hub) {
      SettingsDeckHub.streaming => 'Streaming & Performance',
      SettingsDeckHub.touch => 'Touch & Controls',
      SettingsDeckHub.wol => 'Wake-on-LAN Hub',
      SettingsDeckHub.history => 'History & Audit Center',
      SettingsDeckHub.security => 'Security & Vault',
      SettingsDeckHub.network => 'Network & Discovery',
    };
  }

  Widget _buildActiveHubDeck(
    BuildContext context, {
    required AppPreferencesState prefs,
    required AppPreferencesNotifier prefsNotifier,
    required CyberPalette palette,
  }) {
    final SettingsSection? section = _sectionForHub(_activeHub);
    final bool isModified = section != null && prefs.isModified(section);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: _buildSectionHeader(
                context,
                _hubTitle(_activeHub).toUpperCase(),
              ),
            ),
            if (isModified)
              TextButton.icon(
                key: ValueKey('reset-section-${section.name}'),
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  foregroundColor: palette.primary,
                ),
                onPressed: () {
                  _hapticTap();
                  unawaited(prefsNotifier.resetSection(section));
                  _notify('${_hubTitle(_activeHub)} reset to defaults.');
                },
                icon: const Icon(Icons.restart_alt_rounded, size: 15),
                label: const Text(
                  'Reset Section',
                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        switch (_activeHub) {
          SettingsDeckHub.streaming => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildTargetFpsCard(context, prefs, prefsNotifier, palette),
              _buildStreamQualityPresetCard(
                context,
                prefs,
                prefsNotifier,
                palette,
              ),
              _buildSnapshotIntervalCard(
                context,
                prefs,
                prefsNotifier,
                palette,
              ),
              _buildKeepScreenAwakeTile(context, prefs, prefsNotifier),
            ],
          ),
          SettingsDeckHub.touch => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildTouchInputModeCard(context, prefs, prefsNotifier, palette),
              _buildInstantTapTile(context, prefs, prefsNotifier),
              _buildAutoLandscapeTile(context, prefs, prefsNotifier),
              _buildTouchVisualTile(context, prefs, prefsNotifier),
              _buildHapticsTile(context, prefs, prefsNotifier),
              _buildTrackpadSensitivityCard(
                context,
                prefs,
                prefsNotifier,
                palette,
              ),
              _buildLongPressDelayCard(context, prefs, prefsNotifier, palette),
              _buildScrollSensitivityCard(
                context,
                prefs,
                prefsNotifier,
                palette,
              ),
              _buildNaturalScrollTile(context, prefs, prefsNotifier),
              _buildPinchZoomTile(context, prefs, prefsNotifier),
            ],
          ),
          SettingsDeckHub.wol => WolHubPanel(
            hosts: widget.hosts,
            onDispatchWol: widget.onDispatchWol,
            onToast: _notify,
          ),
          SettingsDeckHub.history => ActivityHistoryPanel(
            onRerunCommand: widget.onRerunCommand,
            onResendWol: _handleResendWolFromHistory,
            onToast: _notify,
          ),
          SettingsDeckHub.security => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildPairingTokenTile(context, palette),
              _buildE2eVaultTile(context, prefs, prefsNotifier),
              _buildPreferTlsTile(context, prefs, prefsNotifier),
              _buildBiometricTile(context, prefs, prefsNotifier),
              if (_hasSecret)
                _buildPurgeSecretsButton(context, palette),
            ],
          ),
          SettingsDeckHub.network => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildDiscoveryPortTile(context, prefs, palette),
              _buildWolSummaryJumpTile(context, prefs, palette),
              _buildQuickStartTile(context, palette),
            ],
          ),
        },
      ],
    );
  }

  Widget _buildAppearanceBentoTile(
    BuildContext context,
    AppPreferencesState prefs,
    CyberPalette palette,
  ) {
    final bool isModified = prefs.isModified(SettingsSection.appearance);
    final Color swatchA = prefs.accent.resolvedPrimary(prefs.themeMode);
    final Color swatchB = prefs.accent.resolvedSecondary(prefs.themeMode);

    return FluidPressScale(
      pressedScale: 0.98,
      onTap: () {
        _hapticTap();
        setState(() => _appearanceExpanded = !_appearanceExpanded);
      },
      child: Container(
        key: const ValueKey('settings-hub-appearance'),
        padding: const EdgeInsets.fromLTRB(14, 11, 14, 14),
        decoration: BoxDecoration(
          gradient: palette.cardBevelGradient(isSelected: _appearanceExpanded),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: _appearanceExpanded
                ? palette.primary.withValues(alpha: 0.58)
                : palette.glassBorderIdle,
            width: _appearanceExpanded ? 1.5 : 1.15,
          ),
          boxShadow: palette.elevationShadows(isSelected: _appearanceExpanded),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FluidSpecularBar(
              isSelected: _appearanceExpanded,
              height: 1.1,
              margin: const EdgeInsets.only(left: 6, right: 6, bottom: 10),
            ),
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    gradient: palette.squircleGradient(swatchA, swatchB),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.55),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: swatchA.withValues(alpha: 0.28),
                        blurRadius: 10,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.palette_rounded,
                    color: Colors.white,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            'Appearance Studio',
                            style: TextStyle(
                              color: palette.textPrimary,
                              fontWeight: FontWeight.w800,
                              fontSize: context.fluidFont(13.5),
                            ),
                          ),
                          if (isModified)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: palette.warning.withValues(
                                  alpha: palette.isDaylight ? 0.14 : 0.20,
                                ),
                                borderRadius: BorderRadius.circular(999),
                                border: Border.all(
                                  color: palette.warning.withValues(
                                    alpha: 0.45,
                                  ),
                                ),
                              ),
                              child: Text(
                                'Modified',
                                style: TextStyle(
                                  color: palette.warning,
                                  fontFamily: 'monospace',
                                  fontSize: context.fluidFont(9),
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          Container(
                            width: 12,
                            height: 12,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              gradient: LinearGradient(
                                colors: [swatchA, swatchB],
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              '${prefs.themeMode.label} • ${prefs.accent.label} • ${prefs.glassIntensity.label}',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: palette.textSecondary,
                                fontSize: context.fluidFont(10.5),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 6),
                Icon(
                  _appearanceExpanded
                      ? Icons.expand_less_rounded
                      : Icons.expand_more_rounded,
                  color: palette.textSecondary,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAppearanceStudioCard(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  ) {
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
            _buildPolarityControls(context, prefs, prefsNotifier, palette, dur),
            const SizedBox(height: 16),
            _buildAccentPaletteControls(
              context,
              prefs,
              prefsNotifier,
              palette,
              dur,
            ),
            const SizedBox(height: 16),
            _buildGlassIntensityControls(
              context,
              prefs,
              prefsNotifier,
              palette,
            ),
            const SizedBox(height: 12),
            _buildReducedMotionRow(context, prefs, prefsNotifier, palette),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                key: const ValueKey('reset-appearance-btn'),
                style: OutlinedButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  foregroundColor: primary,
                  side: BorderSide(color: primary.withValues(alpha: 0.45)),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: () {
                  _hapticTap();
                  unawaited(
                    prefsNotifier.resetSection(SettingsSection.appearance),
                  );
                  _notify('Appearance Studio reset to defaults.');
                },
                icon: const Icon(Icons.restart_alt_rounded, size: 15),
                label: const Text(
                  'Reset Appearance',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPolarityControls(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
    Duration dur,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              prefs.themeMode == AppThemeMode.daylight
                  ? Icons.wb_sunny_rounded
                  : Icons.nightlight_round,
              color: prefs.themeMode == AppThemeMode.daylight
                  ? const Color(0xFFF59E0B)
                  : palette.primary,
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
        LayoutBuilder(
          builder: (context, constraints) {
            final bool stackVertical = constraints.maxWidth < 250;
            final children = AppThemeMode.values.map((mode) {
              final selected = prefs.themeMode == mode;
              final isSun = mode == AppThemeMode.daylight;
              final button = FluidPressScale(
                pressedScale: 0.94,
                onTap: () {
                  _hapticTap();
                  unawaited(prefsNotifier.setThemeMode(mode));
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
                        isSun ? Icons.wb_sunny_rounded : Icons.nightlight_round,
                        size: 16,
                        color: selected
                            ? palette.onHeroGradient
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
                                ? palette.onHeroGradient
                                : palette.textPrimary,
                            fontWeight: FontWeight.w700,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              );
              return stackVertical
                  ? Padding(
                      padding: EdgeInsets.only(bottom: isSun ? 8 : 0),
                      child: button,
                    )
                  : Expanded(
                      child: Padding(
                        padding: EdgeInsets.only(right: isSun ? 8 : 0),
                        child: button,
                      ),
                    );
            }).toList();

            return stackVertical
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: children,
                  )
                : Row(children: children);
          },
        ),
      ],
    );
  }

  Widget _buildAccentPaletteControls(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
    Duration dur,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.palette_rounded, color: palette.primary, size: 18),
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
            final swatchSecondary = preset.resolvedSecondary(prefs.themeMode);
            final swatchMid =
                Color.lerp(swatchColor, swatchSecondary, 0.5) ?? swatchColor;
            final swatchOnFill = CyberPalette.contrastInkFor(swatchMid);
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
                  unawaited(prefsNotifier.setAccent(preset));
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
                                swatchSecondary,
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
                            color: isSelected ? swatchOnFill : swatchColor,
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
                                ? swatchOnFill
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
      ],
    );
  }

  Widget _buildGlassIntensityControls(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
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
              key: ValueKey('glass-intensity-${intensity.name}'),
              label: Text(intensity.label),
              selected: selected,
              selectedColor: palette.primary.withValues(alpha: 0.22),
              labelStyle: TextStyle(
                color: selected ? palette.primary : palette.textSecondary,
                fontWeight: selected ? FontWeight.bold : FontWeight.w600,
                fontSize: 12,
              ),
              onSelected: (_) {
                _hapticTap();
                unawaited(prefsNotifier.setGlassIntensity(intensity));
              },
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _buildReducedMotionRow(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  ) {
    return Row(
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
                style: TextStyle(fontSize: 11, color: palette.textSecondary),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Switch.adaptive(
          key: const ValueKey('reduced-motion-switch'),
          activeTrackColor: palette.primary.withValues(alpha: 0.5),
          activeThumbColor: palette.primary,
          value: prefs.reducedMotion,
          onChanged: (v) {
            _hapticTap();
            unawaited(prefsNotifier.setReducedMotion(v));
          },
        ),
      ],
    );
  }

  // ===================================================================
  // SHARED INTERACTIVE SETTING CARDS (REUSED IN HUBS + SEARCH RESULTS)
  // ===================================================================

  Widget _buildGlassCardShell(
    BuildContext context, {
    required Widget child,
    double bottomMargin = 12,
  }) {
    final palette = context.palette;
    return Container(
      margin: EdgeInsets.only(bottom: bottomMargin),
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 14),
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: false),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: palette.glassBorderIdle, width: 1.15),
        boxShadow: palette.elevationShadows(isSelected: false),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const FluidSpecularBar(
            isSelected: false,
            height: 1.1,
            margin: EdgeInsets.only(left: 6, right: 6, bottom: 10),
          ),
          child,
        ],
      ),
    );
  }

  Widget _buildTargetFpsCard(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  ) {
    return _buildGlassCardShell(
      context,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Target Stream Frame Rate',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: palette.textPrimary,
              fontSize: context.fluidFont(12.5),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Persisted decode & frame pacing cap for battery/smoothness.',
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(10.5),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: kValidTargetFps.map((fps) {
              final active = prefs.targetFps == fps;
              return ChoiceChip(
                key: ValueKey('target-fps-$fps'),
                label: Text('${fps}fps'),
                selected: active,
                selectedColor: palette.primary.withValues(alpha: 0.24),
                labelStyle: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: active ? FontWeight.bold : FontWeight.w600,
                  color: active ? palette.primary : palette.textSecondary,
                ),
                onSelected: (_) {
                  _hapticTap();
                  unawaited(prefsNotifier.setTargetFps(fps));
                },
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildStreamQualityPresetCard(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  ) {
    const labels = <String, String>{
      'auto': 'Auto',
      'low': 'Low',
      'balanced': 'Balanced',
      'crisp': 'Crisp',
    };
    return _buildGlassCardShell(
      context,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
                selectedColor: palette.primary.withValues(alpha: 0.22),
                labelStyle: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: active ? FontWeight.bold : FontWeight.w600,
                  color: active ? palette.primary : palette.textSecondary,
                ),
                onSelected: (_) {
                  _hapticTap();
                  unawaited(prefsNotifier.setStreamQualityPreset(preset));
                },
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildSnapshotIntervalCard(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  ) {
    return _buildGlassCardShell(
      context,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Card Snapshot Refresh Interval',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              color: palette.textPrimary,
              fontSize: context.fluidFont(12.5),
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Controls how often expanded Home PC cards request live preview snapshots.',
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(10.5),
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: kValidCardSnapshotIntervals.map((sec) {
              final active = prefs.cardSnapshotIntervalSec == sec;
              return ChoiceChip(
                key: ValueKey('snapshot-interval-$sec'),
                label: Text(sec == 0 ? 'Manual' : '${sec}s'),
                selected: active,
                selectedColor: palette.primary.withValues(alpha: 0.22),
                labelStyle: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: active ? FontWeight.bold : FontWeight.w600,
                  color: active ? palette.primary : palette.textSecondary,
                ),
                onSelected: (_) {
                  _hapticTap();
                  unawaited(prefsNotifier.setCardSnapshotIntervalSec(sec));
                },
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildTouchInputModeCard(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  ) {
    return _buildGlassCardShell(
      context,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
                        ? palette.primary
                        : palette.textSecondary,
                  ),
                  label: Text(
                    mode == RemoteInputMode.touchscreen
                        ? 'Direct Touch'
                        : 'Trackpad',
                  ),
                  selected: prefs.defaultInputMode == mode,
                  selectedColor: palette.primary.withValues(alpha: 0.22),
                  labelStyle: TextStyle(
                    fontSize: 11.5,
                    fontWeight: prefs.defaultInputMode == mode
                        ? FontWeight.bold
                        : FontWeight.w600,
                    color: prefs.defaultInputMode == mode
                        ? palette.primary
                        : palette.textSecondary,
                  ),
                  onSelected: (_) {
                    _hapticTap();
                    unawaited(prefsNotifier.setDefaultInputMode(mode));
                  },
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTrackpadSensitivityCard(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  ) {
    return _buildSliderCard(
      context,
      palette: palette,
      sliderKey: const ValueKey('trackpad-sensitivity-slider'),
      title: 'Trackpad Pointer Sensitivity',
      subtitle: 'Cursor velocity gain when using Trackpad (PAD) mode.',
      readout: '${prefs.trackpadSensitivity.toStringAsFixed(1)}x',
      minLabel: '0.6x',
      maxLabel: '3.0x',
      defaultValue: 1.6,
      value: prefs.trackpadSensitivity.clamp(0.6, 3.0),
      min: 0.6,
      max: 3.0,
      divisions: 24,
      onChanged: (v) => unawaited(prefsNotifier.setTrackpadSensitivity(v)),
    );
  }

  Widget _buildLongPressDelayCard(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  ) {
    return _buildSliderCard(
      context,
      palette: palette,
      sliderKey: const ValueKey('long-press-delay-slider'),
      title: 'Long-Press Right-Click Delay',
      subtitle: 'Hold threshold before triggering right-click context menu.',
      readout: '${prefs.longPressDelayMs}ms',
      minLabel: '250ms',
      maxLabel: '700ms',
      defaultValue: 460.0,
      value: prefs.longPressDelayMs.clamp(250, 700).toDouble(),
      min: 250,
      max: 700,
      divisions: 18,
      onChanged: (v) =>
          unawaited(prefsNotifier.setLongPressDelayMs(v.round())),
    );
  }

  Widget _buildScrollSensitivityCard(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
    CyberPalette palette,
  ) {
    return _buildSliderCard(
      context,
      palette: palette,
      sliderKey: const ValueKey('scroll-sensitivity-slider'),
      title: '2-Finger Scroll Speed',
      subtitle: 'Scroll wheel velocity multiplier during two-finger drag.',
      readout: '${prefs.scrollSensitivity.toStringAsFixed(1)}x',
      minLabel: '0.5x',
      maxLabel: '3.0x',
      defaultValue: 1.6,
      value: prefs.scrollSensitivity.clamp(0.5, 3.0),
      min: 0.5,
      max: 3.0,
      divisions: 25,
      onChanged: (v) => unawaited(prefsNotifier.setScrollSensitivity(v)),
    );
  }

  Widget _buildSliderCard(
    BuildContext context, {
    required CyberPalette palette,
    required Key sliderKey,
    required String title,
    required String subtitle,
    required String readout,
    required String minLabel,
    required String maxLabel,
    required double defaultValue,
    required double value,
    required double min,
    required double max,
    required int divisions,
    required ValueChanged<double> onChanged,
  }) {
    final bool isDefault = (value - defaultValue).abs() < 1e-6;
    return _buildGlassCardShell(
      context,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: palette.textPrimary,
                    fontSize: context.fluidFont(12.5),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Tooltip(
                message: isDefault ? 'Default value' : 'Tap to restore default',
                child: InkWell(
                  borderRadius: BorderRadius.circular(999),
                  onTap: isDefault
                      ? null
                      : () {
                          _hapticTap();
                          onChanged(defaultValue);
                        },
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: palette.primary.withValues(
                        alpha: palette.isDaylight ? 0.10 : 0.16,
                      ),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: palette.primary.withValues(
                          alpha: isDefault ? 0.25 : 0.50,
                        ),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          readout,
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.w800,
                            color: palette.primary,
                            fontSize: context.fluidFont(11.5),
                          ),
                        ),
                        if (!isDefault) ...[
                          const SizedBox(width: 4),
                          Icon(
                            Icons.restart_alt_rounded,
                            size: 12,
                            color: palette.primary,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            subtitle,
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(10.5),
            ),
          ),
          Slider(
            key: sliderKey,
            value: value,
            min: min,
            max: max,
            divisions: divisions,
            activeColor: palette.primary,
            onChanged: onChanged,
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  minLabel,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: context.fluidFont(9.5),
                    color: palette.textTertiary,
                  ),
                ),
                Text(
                  maxLabel,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: context.fluidFont(9.5),
                    color: palette.textTertiary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPairingTokenTile(BuildContext context, CyberPalette palette) {
    return InkWell(
      key: const ValueKey('security-pairing-token-tile'),
      onTap: _handleOpenPairing,
      borderRadius: BorderRadius.circular(24),
      child: _buildSettingsTile(
        context,
        icon: Icons.vpn_key_rounded,
        title: 'Workstation Pairing Token / PIN',
        subtitle: _hasSecret
            ? 'Configured in protected local vault — tap to rotate or pair via PIN'
            : 'Not configured — tap to enter token or 6-digit PC PIN',
        trailing: Icon(
          _hasSecret ? Icons.verified_user_rounded : Icons.edit_rounded,
          color: _hasSecret ? palette.success : palette.warning,
          size: 20,
        ),
      ),
    );
  }

  Widget _buildPurgeSecretsButton(BuildContext context, CyberPalette palette) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: OutlinedButton.icon(
        key: const ValueKey('purge-secrets-btn'),
        style: OutlinedButton.styleFrom(
          foregroundColor: palette.accent,
          side: BorderSide(color: palette.accent.withValues(alpha: 0.45)),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
        icon: const Icon(Icons.delete_sweep_rounded, size: 18),
        label: const Text('Purge All Saved Pairing Secrets'),
        onPressed: _handlePurgeSecrets,
      ),
    );
  }

  Widget _buildDiscoveryPortTile(
    BuildContext context,
    AppPreferencesState prefs,
    CyberPalette palette,
  ) {
    return InkWell(
      key: const ValueKey('network-scan-port-tile'),
      onTap: () => unawaited(_handleOpenDiscoveryPort(prefs.customScanPort)),
      borderRadius: BorderRadius.circular(24),
      child: _buildSettingsTile(
        context,
        icon: Icons.wifi_tethering_rounded,
        title: 'LAN Discovery & Default WebSocket Port',
        subtitle: 'Tap to customize port scanned for AI NetController agents.',
        trailing: Text(
          'PORT ${prefs.customScanPort}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: palette.primary,
            fontFamily: 'monospace',
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }

  Widget _buildWolSummaryJumpTile(
    BuildContext context,
    AppPreferencesState prefs,
    CyberPalette palette,
  ) {
    final String broadcastLabel = prefs.wolBroadcastOverride.trim().isNotEmpty
        ? prefs.wolBroadcastOverride.trim()
        : 'Auto Subnet';
    return InkWell(
      key: const ValueKey('network-wol-jump-tile'),
      onTap: () {
        _hapticTap();
        if (_searchQuery.isNotEmpty) {
          _searchController.clear();
        }
        setState(() {
          _searchQuery = '';
          _activeHub = SettingsDeckHub.wol;
        });
      },
      borderRadius: BorderRadius.circular(24),
      child: _buildSettingsTile(
        context,
        icon: Icons.bolt_rounded,
        title: 'Wake-on-LAN Directed Broadcast',
        subtitle:
            'Target: $broadcastLabel • ${prefs.wolBurstCount}x burst • Tap to open WoL Hub',
        trailing: Text(
          'UDP ${prefs.wolPort}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: palette.warning,
            fontFamily: 'monospace',
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }

  Widget _buildConfigBackupCard(BuildContext context, CyberPalette palette) {
    return _buildGlassCardShell(
      context,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(13),
                  gradient: palette.heroGradient,
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.55),
                  ),
                ),
                child: const Icon(
                  Icons.backup_rounded,
                  color: Colors.white,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'JSON Config Backup & Restore',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: palette.textPrimary,
                        fontSize: context.fluidFont(12.5),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Export or restore sanitized preferences & workstation records (secrets excluded).',
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
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ElevatedButton.icon(
                key: const ValueKey('export-config-json-btn'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: palette.primary,
                  foregroundColor: palette.onPrimary,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(13),
                  ),
                ),
                onPressed: _exportConfigJson,
                icon: const Icon(Icons.upload_file_rounded, size: 17),
                label: const Text(
                  'Export Config JSON',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
                ),
              ),
              OutlinedButton.icon(
                key: const ValueKey('import-config-json-btn'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: palette.textPrimary,
                  side: BorderSide(color: palette.primary.withValues(alpha: 0.45)),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(13),
                  ),
                ),
                onPressed: _showImportConfigDialog,
                icon: const Icon(Icons.download_rounded, size: 17),
                label: const Text(
                  'Import Config JSON',
                  style: TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildQuickStartTile(BuildContext context, CyberPalette palette) {
    return InkWell(
      onTap: _handleOpenOnboarding,
      borderRadius: BorderRadius.circular(24),
      child: _buildSettingsTile(
        context,
        icon: Icons.explore_rounded,
        title: 'Interactive Quick-Start Guide',
        subtitle: 'Review touch gestures, E2E vault security, and WoL setup.',
        trailing: Icon(Icons.chevron_right_rounded, color: palette.primary),
      ),
    );
  }

  Widget _buildResetAllTile(BuildContext context, CyberPalette palette) {
    return InkWell(
      key: const ValueKey('reset-all-preferences-btn'),
      onTap: _confirmResetAll,
      borderRadius: BorderRadius.circular(24),
      child: _buildSettingsTile(
        context,
        icon: Icons.restart_alt_rounded,
        title: 'Reset All Preferences',
        subtitle:
            'Restores Bright Daylight & Iridescent Violet defaults (keeps paired hosts).',
        trailing: Icon(Icons.restore_rounded, color: palette.textSecondary),
      ),
    );
  }

  Widget _buildAboutTile(BuildContext context, CyberPalette palette) {
    return _buildSettingsTile(
      context,
      icon: Icons.verified_rounded,
      title: 'AI NetController Mobile',
      subtitle: 'Impeller Hardware Engine • AI-NET/3.0-SECURE Protocol',
      trailing: Text(
        'v0.85.0-alpha',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: palette.success,
          fontFamily: 'monospace',
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _buildKeepScreenAwakeTile(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) => _buildSettingsToggleTile(
    context,
    switchKey: const ValueKey('keep-screen-awake-switch'),
    icon: Icons.wb_sunny_rounded,
    title: 'Keep Screen Awake During Stream',
    subtitle: 'Prevents display sleep while viewing live PC stream.',
    value: prefs.keepScreenAwake,
    onChanged: prefsNotifier.setKeepScreenAwake,
  );

  Widget _buildInstantTapTile(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) => _buildSettingsToggleTile(
    context,
    switchKey: const ValueKey('instant-tap-mode-switch'),
    icon: Icons.flash_on_rounded,
    title: 'Instant-Tap Mode (0ms Click)',
    subtitle:
        'Dispatches left-click immediately on tap lift; disable to wait for double-tap hold delay.',
    value: prefs.instantTapMode,
    onChanged: prefsNotifier.setInstantTapMode,
  );

  Widget _buildAutoLandscapeTile(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) => _buildSettingsToggleTile(
    context,
    switchKey: const ValueKey('auto-landscape-switch'),
    icon: Icons.screen_rotation_rounded,
    title: 'Auto-Landscape in Fullscreen',
    subtitle:
        'Automatically rotates to landscape when opening live PC control.',
    value: prefs.fullscreenAutoLandscape,
    onChanged: prefsNotifier.setFullscreenAutoLandscape,
  );

  Widget _buildTouchVisualTile(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) => _buildSettingsToggleTile(
    context,
    switchKey: const ValueKey('touch-visual-feedback-switch'),
    icon: Icons.touch_app_rounded,
    title: 'Touch Visual Feedback',
    subtitle:
        'Shows animated tap ripples, cursor reticle, and long-press right-click ring.',
    value: prefs.touchVisualFeedback,
    onChanged: prefsNotifier.setTouchVisualFeedback,
  );

  Widget _buildHapticsTile(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) => _buildSettingsToggleTile(
    context,
    switchKey: const ValueKey('haptics-enabled-switch'),
    icon: Icons.vibration_rounded,
    title: 'Haptic Touch Feedback',
    subtitle: 'Subtle tactile vibration when interacting with controls.',
    value: prefs.hapticsEnabled,
    onChanged: prefsNotifier.setHapticsEnabled,
  );

  Widget _buildNaturalScrollTile(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) => _buildSettingsToggleTile(
    context,
    switchKey: const ValueKey('natural-scroll-switch'),
    icon: Icons.swap_vert_rounded,
    title: 'Natural (Inverted) 2-Finger Scroll',
    subtitle:
        'Reverses two-finger scroll direction to match macOS / mobile inertia.',
    value: prefs.naturalScroll,
    onChanged: prefsNotifier.setNaturalScroll,
  );

  Widget _buildPinchZoomTile(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) => _buildSettingsToggleTile(
    context,
    switchKey: const ValueKey('pinch-zoom-switch'),
    icon: Icons.pinch_rounded,
    title: 'Pinch-to-Zoom Live Stream',
    subtitle:
        'Allows two-finger pinch zoom (1x–4x) on the remote desktop surface.',
    value: prefs.pinchZoomEnabled,
    onChanged: prefsNotifier.setPinchZoomEnabled,
  );

  Widget _buildE2eVaultTile(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) => _buildSettingsToggleTile(
    context,
    switchKey: const ValueKey('e2e-vault-switch'),
    icon: Icons.enhanced_encryption_rounded,
    title: 'E2E AEAD Payload Vault (Mutual ECDH)',
    subtitle:
        'Mutual X25519 + ChaCha20-Poly1305 AEAD is active for control & video frames.',
    value: prefs.enableE2eVault,
    onChanged: prefsNotifier.setEnableE2eVault,
  );

  Widget _buildPreferTlsTile(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) => _buildSettingsToggleTile(
    context,
    switchKey: const ValueKey('prefer-tls-switch'),
    icon: Icons.lock_rounded,
    title: 'Prefer WSS/TLS WebSocket Transport',
    subtitle: 'Uses wss:// instead of ws:// when host supports TLS certs.',
    value: prefs.preferTls,
    onChanged: prefsNotifier.setPreferTls,
  );

  Widget _buildBiometricTile(
    BuildContext context,
    AppPreferencesState prefs,
    AppPreferencesNotifier prefsNotifier,
  ) => _buildSettingsToggleTile(
    context,
    switchKey: const ValueKey('biometric-lock-switch'),
    icon: Icons.fingerprint_rounded,
    title: 'Arm Biometric HITL Guard Notice',
    subtitle:
        'Highlights hardware verification prompts for high-risk shell commands.',
    value: prefs.biometricLockEnabled,
    onChanged: prefsNotifier.setBiometricLockEnabled,
  );

  Widget _buildSettingsToggleTile(
    BuildContext context, {
    Key? switchKey,
    required IconData icon,
    required String title,
    required String subtitle,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    final palette = context.palette;
    return _buildSettingsTile(
      context,
      icon: icon,
      title: title,
      subtitle: subtitle,
      trailing: Switch.adaptive(
        key: switchKey,
        value: value,
        activeTrackColor: palette.primary.withValues(alpha: 0.5),
        activeThumbColor: palette.primary,
        onChanged: (next) {
          _hapticTap();
          onChanged(next);
        },
      ),
    );
  }

  Widget _buildSettingsTile(
    BuildContext context, {
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
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 128),
                  child: trailing,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(BuildContext context, String title) {
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
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
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

  // ===================================================================
  // LIVE SETTINGS SEARCH ENGINE
  // ===================================================================

  List<_SearchableSettingEntry> _buildSearchIndex(
    AppPreferencesState prefs,
    CyberPalette palette,
  ) {
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final dur = disableAnim ? Duration.zero : const Duration(milliseconds: 220);

    return <_SearchableSettingEntry>[
      _SearchableSettingEntry(
        id: 'fps',
        category: 'Streaming',
        title: 'Target Stream Frame Rate',
        subtitle: '15fps, 30fps, 60fps pacing cap',
        keywords: const ['fps', 'frame', 'rate', '60', '30', '15', 'stream'],
        builder: (ctx, p, n, pal) => _buildTargetFpsCard(ctx, p, n, pal),
      ),
      _SearchableSettingEntry(
        id: 'quality',
        category: 'Streaming',
        title: 'Stream Visual Quality Preset',
        subtitle: 'Auto, Low, Balanced, Crisp',
        keywords: const ['quality', 'preset', 'auto', 'low', 'balanced', 'crisp'],
        builder: (ctx, p, n, pal) =>
            _buildStreamQualityPresetCard(ctx, p, n, pal),
      ),
      _SearchableSettingEntry(
        id: 'snapshot-interval',
        category: 'Streaming',
        title: 'Card Snapshot Refresh Interval',
        subtitle: 'Manual, 2s, 3s, 5s preview polling',
        keywords: const ['snapshot', 'preview', 'card', 'refresh', 'interval'],
        builder: (ctx, p, n, pal) =>
            _buildSnapshotIntervalCard(ctx, p, n, pal),
      ),
      _SearchableSettingEntry(
        id: 'wakelock',
        category: 'Streaming',
        title: 'Keep Screen Awake During Stream',
        subtitle: 'Prevents display sleep while streaming',
        keywords: const ['awake', 'wakelock', 'sleep', 'screen', 'stream'],
        builder: (ctx, p, n, pal) => _buildKeepScreenAwakeTile(ctx, p, n),
      ),
      _SearchableSettingEntry(
        id: 'input-mode',
        category: 'Touch & Controls',
        title: 'Default Remote Input Mode',
        subtitle: 'Direct Touch vs Trackpad mode',
        keywords: const ['touch', 'touchscreen', 'trackpad', 'input', 'mouse'],
        builder: (ctx, p, n, pal) => _buildTouchInputModeCard(ctx, p, n, pal),
      ),
      _SearchableSettingEntry(
        id: 'instant-tap',
        category: 'Touch & Controls',
        title: 'Instant-Tap Mode (0ms Click)',
        subtitle: '0ms click vs double-tap hold delay',
        keywords: const ['instant', 'tap', 'click', '0ms', 'delay', 'touch'],
        builder: (ctx, p, n, pal) => _buildInstantTapTile(ctx, p, n),
      ),
      _SearchableSettingEntry(
        id: 'auto-landscape',
        category: 'Touch & Controls',
        title: 'Auto-Landscape in Fullscreen',
        subtitle: 'Rotate automatically during live PC stream',
        keywords: const ['landscape', 'rotate', 'orientation', 'fullscreen'],
        builder: (ctx, p, n, pal) => _buildAutoLandscapeTile(ctx, p, n),
      ),
      _SearchableSettingEntry(
        id: 'touch-visual',
        category: 'Touch & Controls',
        title: 'Touch Visual Feedback',
        subtitle: 'Tap ripples, reticle, and long-press ring',
        keywords: const ['ripple', 'visual', 'feedback', 'reticle', 'touch'],
        builder: (ctx, p, n, pal) => _buildTouchVisualTile(ctx, p, n),
      ),
      _SearchableSettingEntry(
        id: 'haptics',
        category: 'Touch & Controls',
        title: 'Haptic Touch Feedback',
        subtitle: 'Tactile vibration for controls',
        keywords: const ['haptic', 'vibration', 'tactile'],
        builder: (ctx, p, n, pal) => _buildHapticsTile(ctx, p, n),
      ),
      _SearchableSettingEntry(
        id: 'trackpad-sensitivity',
        category: 'Touch & Controls',
        title: 'Trackpad Pointer Sensitivity',
        subtitle: 'Relative cursor velocity gain',
        keywords: const ['trackpad', 'sensitivity', 'pointer', 'cursor', 'speed'],
        builder: (ctx, p, n, pal) =>
            _buildTrackpadSensitivityCard(ctx, p, n, pal),
      ),
      _SearchableSettingEntry(
        id: 'long-press-delay',
        category: 'Touch & Controls',
        title: 'Long-Press Right-Click Delay',
        subtitle: 'Hold duration 250ms to 700ms',
        keywords: const ['long', 'press', 'right', 'click', 'delay', 'ms'],
        builder: (ctx, p, n, pal) => _buildLongPressDelayCard(ctx, p, n, pal),
      ),
      _SearchableSettingEntry(
        id: 'scroll-sensitivity',
        category: 'Touch & Controls',
        title: '2-Finger Scroll Speed',
        subtitle: 'Scroll speed multiplier 0.5x to 3.0x',
        keywords: const ['scroll', 'speed', 'two', 'finger', 'wheel'],
        builder: (ctx, p, n, pal) =>
            _buildScrollSensitivityCard(ctx, p, n, pal),
      ),
      _SearchableSettingEntry(
        id: 'natural-scroll',
        category: 'Touch & Controls',
        title: 'Natural (Inverted) 2-Finger Scroll',
        subtitle: 'Invert two-finger scroll axis',
        keywords: const ['natural', 'inverted', 'scroll', 'reverse'],
        builder: (ctx, p, n, pal) => _buildNaturalScrollTile(ctx, p, n),
      ),
      _SearchableSettingEntry(
        id: 'pinch-zoom',
        category: 'Touch & Controls',
        title: 'Pinch-to-Zoom Live Stream',
        subtitle: 'Enable or disable pinch zoom gesture',
        keywords: const ['pinch', 'zoom', 'scale', 'gesture'],
        builder: (ctx, p, n, pal) => _buildPinchZoomTile(ctx, p, n),
      ),
      _SearchableSettingEntry(
        id: 'wol-hub',
        category: 'Wake-on-LAN',
        title: 'Wake-on-LAN Hub & Tuning',
        subtitle: 'Magic Packet dispatcher, UDP port, broadcast IP, burst, ARP',
        keywords: const [
          'wol',
          'wake',
          'magic',
          'packet',
          'udp',
          'broadcast',
          'arp',
          'burst',
          'mac',
        ],
        builder: (ctx, p, n, pal) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildWolSummaryJumpTile(ctx, p, pal),
            _buildSettingsToggleTile(
              ctx,
              switchKey: const ValueKey('wol-garp-switch'),
              icon: Icons.router_rounded,
              title: 'Gratuitous ARP Cache Injection (WoL)',
              subtitle:
                  'Primes Wi-Fi AP ARP mapping before sending Magic Packets.',
              value: p.wolSendGratuitousArp,
              onChanged: n.setWolSendGratuitousArp,
            ),
          ],
        ),
      ),
      _SearchableSettingEntry(
        id: 'history-hub',
        category: 'History & Audit',
        title: 'Unified Activity & Audit History',
        subtitle: 'Commands, connections, WoL dispatches, JSON/CSV export',
        keywords: const ['history', 'audit', 'logs', 'csv', 'activity'],
        builder: (ctx, p, n, pal) => InkWell(
          onTap: () {
            _hapticTap();
            _searchController.clear();
            setState(() {
              _searchQuery = '';
              _activeHub = SettingsDeckHub.history;
            });
          },
          borderRadius: BorderRadius.circular(24),
          child: _buildSettingsTile(
            ctx,
            icon: Icons.history_rounded,
            title: 'Open Activity & Audit History Hub',
            subtitle:
                'Inspect chronological commands, connections, and WoL history.',
            trailing: Icon(Icons.chevron_right_rounded, color: pal.primary),
          ),
        ),
      ),
      _SearchableSettingEntry(
        id: 'pairing-token',
        category: 'Security & Vault',
        title: 'Workstation Pairing Token / PIN',
        subtitle: 'Configure or rotate local pairing credential',
        keywords: const ['pairing', 'token', 'pin', 'secret', 'vault'],
        builder: (ctx, p, n, pal) => _buildPairingTokenTile(ctx, pal),
      ),
      _SearchableSettingEntry(
        id: 'e2e-vault',
        category: 'Security & Vault',
        title: 'E2E AEAD Payload Vault (Mutual ECDH)',
        subtitle: 'X25519 + ChaCha20-Poly1305 encrypted channel',
        keywords: const ['e2e', 'aead', 'vault', 'crypto', 'encryption', 'ecdh'],
        builder: (ctx, p, n, pal) => _buildE2eVaultTile(ctx, p, n),
      ),
      _SearchableSettingEntry(
        id: 'prefer-tls',
        category: 'Security & Vault',
        title: 'Prefer WSS/TLS WebSocket Transport',
        subtitle: 'Use wss:// when workstation supports TLS',
        keywords: const ['tls', 'wss', 'ssl', 'cert', 'websocket'],
        builder: (ctx, p, n, pal) => _buildPreferTlsTile(ctx, p, n),
      ),
      _SearchableSettingEntry(
        id: 'biometric-hitl',
        category: 'Security & Vault',
        title: 'Arm Biometric HITL Guard Notice',
        subtitle: 'Hardware verification prompts for elevated commands',
        keywords: const ['biometric', 'fingerprint', 'hitl', 'guard', 'security'],
        builder: (ctx, p, n, pal) => _buildBiometricTile(ctx, p, n),
      ),
      if (_hasSecret)
        _SearchableSettingEntry(
          id: 'purge-secrets',
          category: 'Security & Vault',
          title: 'Purge All Saved Pairing Secrets',
          subtitle: 'Clear saved pairing credentials from vault',
          keywords: const ['purge', 'delete', 'secrets', 'tokens', 'clear'],
          builder: (ctx, p, n, pal) => _buildPurgeSecretsButton(ctx, pal),
        ),
      _SearchableSettingEntry(
        id: 'scan-port',
        category: 'Network & Discovery',
        title: 'LAN Discovery & Default WebSocket Port',
        subtitle: 'Default TCP agent discovery port',
        keywords: const ['lan', 'discovery', 'scan', 'port', '8765', 'network'],
        builder: (ctx, p, n, pal) => _buildDiscoveryPortTile(ctx, p, pal),
      ),
      _SearchableSettingEntry(
        id: 'polarity',
        category: 'Appearance',
        title: 'Liquid Glass Polarity',
        subtitle: 'Bright Daylight vs Vibrant Dark theme mode',
        keywords: const ['theme', 'mode', 'daylight', 'dark', 'light', 'polarity'],
        builder: (ctx, p, n, pal) => _buildGlassCardShell(
          ctx,
          child: _buildPolarityControls(ctx, p, n, pal, dur),
        ),
      ),
      _SearchableSettingEntry(
        id: 'accent',
        category: 'Appearance',
        title: 'Hero Accent Palette',
        subtitle: 'Violet, Cobalt, Cyan, Emerald, Rose, Amber',
        keywords: const [
          'accent',
          'color',
          'palette',
          'violet',
          'cobalt',
          'cyan',
          'emerald',
          'rose',
          'amber',
        ],
        builder: (ctx, p, n, pal) => _buildGlassCardShell(
          ctx,
          child: _buildAccentPaletteControls(ctx, p, n, pal, dur),
        ),
      ),
      _SearchableSettingEntry(
        id: 'glass-intensity',
        category: 'Appearance',
        title: 'Optical Glass Finish',
        subtitle: 'Frosted, Liquid Glass, Crystal blur intensity',
        keywords: const ['glass', 'blur', 'frosted', 'crystal', 'intensity'],
        builder: (ctx, p, n, pal) => _buildGlassCardShell(
          ctx,
          child: _buildGlassIntensityControls(ctx, p, n, pal),
        ),
      ),
      _SearchableSettingEntry(
        id: 'reduced-motion',
        category: 'Appearance',
        title: 'Reduced Motion & Animations',
        subtitle: 'Minimize spring motion and aurora effects',
        keywords: const ['motion', 'animation', 'battery', 'reduced'],
        builder: (ctx, p, n, pal) => _buildGlassCardShell(
          ctx,
          child: _buildReducedMotionRow(ctx, p, n, pal),
        ),
      ),
      _SearchableSettingEntry(
        id: 'backup-json',
        category: 'Backup & Maintenance',
        title: 'JSON Config Backup & Restore',
        subtitle: 'Export or import sanitized settings and hosts',
        keywords: const ['json', 'backup', 'export', 'import', 'restore', 'config'],
        builder: (ctx, p, n, pal) => _buildConfigBackupCard(ctx, pal),
      ),
      _SearchableSettingEntry(
        id: 'quickstart',
        category: 'Backup & Maintenance',
        title: 'Interactive Quick-Start Guide',
        subtitle: 'Review gestures, E2E vault security, and WoL setup',
        keywords: const ['guide', 'quickstart', 'onboarding', 'help'],
        builder: (ctx, p, n, pal) => _buildQuickStartTile(ctx, pal),
      ),
      _SearchableSettingEntry(
        id: 'reset-all',
        category: 'Backup & Maintenance',
        title: 'Reset All Preferences',
        subtitle: 'Restore default preferences while keeping hosts',
        keywords: const ['reset', 'defaults', 'restore', 'factory'],
        builder: (ctx, p, n, pal) => _buildResetAllTile(ctx, pal),
      ),
    ];
  }

  Widget _buildSearchResultsSection(
    BuildContext context, {
    required String queryLower,
    required AppPreferencesState prefs,
    required AppPreferencesNotifier prefsNotifier,
    required CyberPalette palette,
  }) {
    final matches = _buildSearchIndex(
      prefs,
      palette,
    ).where((item) => item.matches(queryLower)).toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: _buildSectionHeader(
                context,
                'SEARCH RESULTS (${matches.length})',
              ),
            ),
            TextButton.icon(
              onPressed: () {
                _searchController.clear();
                setState(() => _searchQuery = '');
              },
              icon: const Icon(Icons.close_rounded, size: 15),
              label: const Text(
                'Clear',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (matches.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
            decoration: BoxDecoration(
              gradient: palette.cardBevelGradient(isSelected: false),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: palette.glassBorderIdle),
            ),
            child: Column(
              children: [
                Icon(
                  Icons.search_off_rounded,
                  size: 28,
                  color: palette.textTertiary,
                ),
                const SizedBox(height: 8),
                Text(
                  'No Matching Settings Found',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: palette.textPrimary,
                    fontWeight: FontWeight.w800,
                    fontSize: context.fluidFont(13),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Try searching for fps, trackpad, WoL, vault, TLS, backup, or accent.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: palette.textSecondary,
                    fontSize: context.fluidFont(11),
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 6,
                  runSpacing: 6,
                  children: const <String>[
                    'fps',
                    'trackpad',
                    'WoL',
                    'vault',
                    'TLS',
                    'backup',
                    'accent',
                  ].map((term) {
                    return ActionChip(
                      visualDensity: VisualDensity.compact,
                      label: Text(
                        term,
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: context.fluidFont(10.5),
                          fontWeight: FontWeight.w700,
                          color: palette.primary,
                        ),
                      ),
                      side: BorderSide(
                        color: palette.primary.withValues(alpha: 0.35),
                      ),
                      onPressed: () {
                        _hapticTap();
                        _searchController.value = TextEditingValue(
                          text: term,
                          selection: TextSelection.collapsed(
                            offset: term.length,
                          ),
                        );
                        setState(() => _searchQuery = term);
                      },
                    );
                  }).toList(growable: false),
                ),
              ],
            ),
          )
        else
          for (final item in matches) ...[
            Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 4),
              child: Text(
                item.category.toUpperCase(),
                style: TextStyle(
                  color: palette.primary,
                  fontFamily: 'monospace',
                  fontSize: context.fluidFont(9.5),
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.0,
                ),
              ),
            ),
            item.builder(context, prefs, prefsNotifier, palette),
          ],
      ],
    );
  }
}

class _DiscoveryPortDialog extends StatefulWidget {
  final int initialPort;

  const _DiscoveryPortDialog({required this.initialPort});

  @override
  State<_DiscoveryPortDialog> createState() => _DiscoveryPortDialogState();
}

class _DiscoveryPortDialogState extends State<_DiscoveryPortDialog> {
  late final TextEditingController _ctrl;
  String? _errorMsg;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(text: widget.initialPort.toString());
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return AlertDialog(
      backgroundColor: palette.surfaceElevated,
      title: const Text('LAN Discovery Port'),
      content: TextField(
        controller: _ctrl,
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
            final parsed = int.tryParse(_ctrl.text.trim());
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

class _ImportConfigDialog extends StatefulWidget {
  final Future<
          ({bool ok, String message, List<Map<String, dynamic>> importedHosts})>
      Function(String rawJson) onImport;

  const _ImportConfigDialog({required this.onImport});

  @override
  State<_ImportConfigDialog> createState() => _ImportConfigDialogState();
}

class _ImportConfigDialogState extends State<_ImportConfigDialog> {
  late final TextEditingController _ctrl;
  String? _errorMsg;
  bool _isImporting = false;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    return AlertDialog(
      backgroundColor: palette.surfaceElevated,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      title: const Text('Import Config JSON'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Paste a version 1 Config JSON backup. Preferences and sanitized host records will be validated; saved secrets remain protected.',
              style: TextStyle(color: palette.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const ValueKey('import-config-json-input'),
              controller: _ctrl,
              minLines: 4,
              maxLines: 8,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 11.5,
                color: palette.textPrimary,
              ),
              decoration: InputDecoration(
                hintText: '{"version": 1, "preferences": {...}}',
                errorText: _errorMsg,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _isImporting
                    ? null
                    : () async {
                        final data = await Clipboard.getData(
                          Clipboard.kTextPlain,
                        );
                        final text = data?.text ?? '';
                        if (text.trim().isNotEmpty && mounted) {
                          _ctrl.text = text;
                          setState(() => _errorMsg = null);
                        }
                      },
                icon: const Icon(Icons.content_paste_rounded, size: 16),
                label: const Text(
                  'Paste Clipboard',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isImporting ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          key: const ValueKey('import-config-json-submit'),
          style: ElevatedButton.styleFrom(
            backgroundColor: palette.primary,
            foregroundColor: palette.onPrimary,
          ),
          onPressed: _isImporting
              ? null
              : () async {
                  final navigator = Navigator.of(context);
                  setState(() => _isImporting = true);
                  final res = await widget.onImport(_ctrl.text);
                  if (!mounted) return;
                  if (!res.ok) {
                    setState(() {
                      _isImporting = false;
                      _errorMsg = res.message;
                    });
                    return;
                  }
                  navigator.pop(res);
                },
          child: Text(_isImporting ? 'Importing...' : 'Import'),
        ),
      ],
    );
  }
}
