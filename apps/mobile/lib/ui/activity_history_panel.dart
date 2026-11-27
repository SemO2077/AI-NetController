import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../security/network_validators.dart';
import '../services/app_preferences.dart';
import '../services/history_store.dart';
import '../services/os_integrations_manager.dart';
import '../theme/fluid_theme.dart';
import 'wol_hub_panel.dart' show ToastCallback;

/// Unified chronological Activity & Audit History Center supporting category
/// filtering, instant search, JSON/CSV clipboard export, and 1-tap actions.
class ActivityHistoryPanel extends ConsumerStatefulWidget {
  final ActivityCategory? initialCategory;
  final Future<void> Function(ActivityHistoryEntry entry)? onRerunCommand;
  final Future<void> Function(ActivityHistoryEntry entry)? onResendWol;
  final ToastCallback? onToast;
  final bool scrollable;

  const ActivityHistoryPanel({
    super.key,
    this.initialCategory,
    this.onRerunCommand,
    this.onResendWol,
    this.onToast,
    this.scrollable = false,
  });

  @override
  ConsumerState<ActivityHistoryPanel> createState() =>
      _ActivityHistoryPanelState();
}

class _ActivityHistoryPanelState extends ConsumerState<ActivityHistoryPanel> {
  ActivityCategory? _selectedCategory;
  bool _failedOnly = false;
  late final TextEditingController _searchController;
  String _query = '';
  final Set<String> _expandedIds = <String>{};
  final Set<String> _busyIds = <String>{};

  @override
  void initState() {
    super.initState();
    _selectedCategory = widget.initialCategory;
    _searchController = TextEditingController();
  }

  @override
  void dispose() {
    _searchController.dispose();
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

  void _exportJson(int count) {
    _hapticTap();
    final json = ref
        .read(historyProvider.notifier)
        .exportAsJson(category: _selectedCategory);
    unawaited(Clipboard.setData(ClipboardData(text: json)).catchError((_) {}));
    _notify(
      'Copied $count JSON activity ${count == 1 ? 'entry' : 'entries'} to clipboard.',
      accentColor: context.palette.success,
    );
  }

  void _exportCsv(int count) {
    _hapticTap();
    final csv = ref
        .read(historyProvider.notifier)
        .exportAsCsv(category: _selectedCategory);
    unawaited(Clipboard.setData(ClipboardData(text: csv)).catchError((_) {}));
    _notify(
      'Copied $count CSV activity ${count == 1 ? 'entry' : 'entries'} to clipboard.',
      accentColor: context.palette.success,
    );
  }

  Future<void> _confirmClear() async {
    _hapticTap();
    final String scopeLabel = _selectedCategory == null
        ? 'All Activity'
        : _categoryLabel(_selectedCategory!);
    final bool confirmed =
        await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: ctx.palette.surfaceElevated,
            title: Text('Clear $scopeLabel History?'),
            content: Text(
              _selectedCategory == null
                  ? 'This permanently removes all recorded commands, connections, WoL dispatches, and system events.'
                  : 'This permanently removes all recorded $scopeLabel events from history.',
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
                child: const Text('Clear'),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed || !mounted) return;
    final notifier = ref.read(historyProvider.notifier);
    if (_selectedCategory == null) {
      await notifier.clearAll();
    } else {
      await notifier.clearCategory(_selectedCategory!);
    }
    if (!mounted) return;
    setState(() => _expandedIds.clear());
    _notify('Cleared $scopeLabel history.');
  }

  void _copyEntry(ActivityHistoryEntry entry) {
    _hapticTap();
    final parts = <String>[
      if (entry.title.trim().isNotEmpty) entry.title.trim(),
      if (entry.hostName.trim().isNotEmpty || entry.hostIp.trim().isNotEmpty)
        '${entry.hostName.trim()} (${entry.hostIp.trim()})'.trim(),
      if (entry.mac.trim().isNotEmpty) 'MAC: ${entry.mac.trim()}',
      if (entry.detail.trim().isNotEmpty) entry.detail.trim(),
    ];
    final text = parts.join('\n');
    unawaited(Clipboard.setData(ClipboardData(text: text)).catchError((_) {}));
    _notify('Copied event details to clipboard.');
  }

  Future<void> _handleRerunCommand(ActivityHistoryEntry entry) async {
    if (_busyIds.contains(entry.id)) return;
    _hapticTap();
    if (widget.onRerunCommand != null) {
      setState(() => _busyIds.add(entry.id));
      try {
        await widget.onRerunCommand!(entry);
      } finally {
        if (mounted) {
          setState(() => _busyIds.remove(entry.id));
        }
      }
      return;
    }

    final String cmd = _extractCommand(entry);
    unawaited(Clipboard.setData(ClipboardData(text: cmd)).catchError((_) {}));
    _notify('Copied command "$cmd" to clipboard.');
  }

  Future<void> _handleResendWol(ActivityHistoryEntry entry) async {
    if (_busyIds.contains(entry.id)) return;
    _hapticTap();

    setState(() => _busyIds.add(entry.id));
    try {
      if (widget.onResendWol != null) {
        await widget.onResendWol!(entry);
        return;
      }

      final String? mac = NetworkValidators.normalizeMac(entry.mac);
      if (mac == null) {
        _notify(
          'Cannot re-send WoL: missing valid MAC address.',
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
          (rawBurst is num ? rawBurst.toInt() : prefs.wolBurstCount).clamp(
            1,
            5,
          );

      final result = await OsIntegrationsManager.instance
          .sendWakePacketDetailed(
            targetMac: mac,
            targetIp: NetworkValidators.isValidIpv4(entry.hostIp)
                ? entry.hostIp.trim()
                : '',
            port: port,
            customBroadcastIp: NetworkValidators.isValidIpv4(broadcastIp)
                ? broadcastIp
                : null,
            burstCount: burstCount,
            sendBothPorts: port == 9,
            sendGratuitousArp: prefs.wolSendGratuitousArp,
          );

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
    } finally {
      if (mounted) {
        setState(() => _busyIds.remove(entry.id));
      }
    }
  }

  String _extractCommand(ActivityHistoryEntry entry) {
    final rawMetaCmd = entry.meta['command']?.toString().trim() ?? '';
    if (rawMetaCmd.isNotEmpty) return rawMetaCmd;
    if (entry.detail.trim().isNotEmpty) return entry.detail.trim();
    return entry.title.trim();
  }

  String _categoryLabel(ActivityCategory category) {
    return switch (category) {
      ActivityCategory.command => 'Commands',
      ActivityCategory.connection => 'Connections',
      ActivityCategory.wol => 'WoL',
      ActivityCategory.system => 'System',
    };
  }

  IconData _categoryIcon(ActivityCategory category) {
    return switch (category) {
      ActivityCategory.command => Icons.terminal_rounded,
      ActivityCategory.connection => Icons.lan_rounded,
      ActivityCategory.wol => Icons.bolt_rounded,
      ActivityCategory.system => Icons.tune_rounded,
    };
  }

  Color _categoryColor(CyberPalette palette, ActivityCategory category) {
    return switch (category) {
      ActivityCategory.command => palette.primary,
      ActivityCategory.connection => palette.sky,
      ActivityCategory.wol => palette.warning,
      ActivityCategory.system => palette.secondary,
    };
  }

  String _statusBadgeText(String status) {
    return switch (status) {
      'success' => 'OK',
      'failed' => 'ERR',
      _ => 'INFO',
    };
  }

  Color _statusBadgeColor(CyberPalette palette, String status) {
    return switch (status) {
      'success' => palette.success,
      'failed' => palette.accent,
      _ => palette.sky,
    };
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

  bool _matchesQuery(ActivityHistoryEntry entry, String q) {
    if (q.isEmpty) return true;
    final String statusAlias = _statusBadgeText(entry.status).toLowerCase();
    final String metaJoined = entry.meta.values.join(' ').toLowerCase();
    final String hay =
        '${entry.hostName} ${entry.hostIp} ${entry.mac} ${entry.title} ${entry.detail} ${entry.status} $statusAlias ${entry.category.name} $metaJoined'
            .toLowerCase();
    return hay.contains(q);
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final entries = ref.watch(historyProvider);

    final int allCount = entries.length;
    final int commandCount = entries
        .where((e) => e.category == ActivityCategory.command)
        .length;
    final int connectionCount = entries
        .where((e) => e.category == ActivityCategory.connection)
        .length;
    final int wolCount = entries
        .where((e) => e.category == ActivityCategory.wol)
        .length;
    final int systemCount = entries
        .where((e) => e.category == ActivityCategory.system)
        .length;
    final int failedCount = entries.where((e) => e.status == 'failed').length;

    final String q = _query.trim().toLowerCase();
    final List<ActivityHistoryEntry> filtered =
        entries
            .where((e) {
              if (_selectedCategory != null && e.category != _selectedCategory) {
                return false;
              }
              if (_failedOnly && e.status != 'failed') {
                return false;
              }
              return _matchesQuery(e, q);
            })
            .toList(growable: false)
          ..sort((a, b) => b.timestampMs.compareTo(a.timestampMs));

    final int scopedExportCount = _selectedCategory == null
        ? allCount
        : entries.where((e) => e.category == _selectedCategory).length;
    final bool hasNarrowingFilter =
        _selectedCategory != null || _failedOnly || q.isNotEmpty;

    final Widget headerAndControls = Container(
      padding: const EdgeInsets.fromLTRB(14, 11, 14, 14),
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: false),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: palette.glassBorderIdle, width: 1.15),
        boxShadow: palette.elevationShadows(isSelected: false),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          const FluidSpecularBar(
            isSelected: true,
            height: 1.1,
            margin: EdgeInsets.only(left: 6, right: 6, bottom: 10),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _buildFilterChip(
                context,
                key: const ValueKey('history-filter-all'),
                label: 'All ($allCount)',
                selected: _selectedCategory == null,
                color: palette.primary,
                onTap: () => setState(() => _selectedCategory = null),
              ),
              _buildFilterChip(
                context,
                key: const ValueKey('history-filter-command'),
                label: 'Commands ($commandCount)',
                selected: _selectedCategory == ActivityCategory.command,
                color: palette.primary,
                onTap: () => setState(
                  () => _selectedCategory = ActivityCategory.command,
                ),
              ),
              _buildFilterChip(
                context,
                key: const ValueKey('history-filter-connection'),
                label: 'Connections ($connectionCount)',
                selected: _selectedCategory == ActivityCategory.connection,
                color: palette.sky,
                onTap: () => setState(
                  () => _selectedCategory = ActivityCategory.connection,
                ),
              ),
              _buildFilterChip(
                context,
                key: const ValueKey('history-filter-wol'),
                label: 'WoL ($wolCount)',
                selected: _selectedCategory == ActivityCategory.wol,
                color: palette.warning,
                onTap: () =>
                    setState(() => _selectedCategory = ActivityCategory.wol),
              ),
              if (systemCount > 0)
                _buildFilterChip(
                  context,
                  key: const ValueKey('history-filter-system'),
                  label: 'System ($systemCount)',
                  selected: _selectedCategory == ActivityCategory.system,
                  color: palette.secondary,
                  onTap: () => setState(
                    () => _selectedCategory = ActivityCategory.system,
                  ),
                ),
              if (failedCount > 0)
                _buildFilterChip(
                  context,
                  key: const ValueKey('history-filter-failed'),
                  label: 'Errors ($failedCount)',
                  selected: _failedOnly,
                  color: palette.accent,
                  onTap: () => setState(() => _failedOnly = !_failedOnly),
                ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            key: const ValueKey('history-search-input'),
            controller: _searchController,
            onChanged: (value) => setState(() => _query = value),
            style: TextStyle(
              color: palette.textPrimary,
              fontSize: context.fluidFont(12),
            ),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Filter by host, command, MAC, or status...',
              prefixIcon: const Icon(Icons.search_rounded, size: 18),
              suffixIcon: _query.isNotEmpty
                  ? IconButton(
                      tooltip: 'Clear history search',
                      icon: const Icon(Icons.close_rounded, size: 16),
                      onPressed: () {
                        _searchController.clear();
                        setState(() => _query = '');
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
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                key: const ValueKey('history-export-json-btn'),
                style: OutlinedButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  foregroundColor: palette.primary,
                  side: BorderSide(
                    color: palette.primary.withValues(alpha: 0.45),
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: scopedExportCount > 0
                    ? () => _exportJson(scopedExportCount)
                    : null,
                icon: const Icon(Icons.data_object_rounded, size: 15),
                label: const Text(
                  'Export JSON',
                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
                ),
              ),
              OutlinedButton.icon(
                key: const ValueKey('history-export-csv-btn'),
                style: OutlinedButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  foregroundColor: palette.secondary,
                  side: BorderSide(
                    color: palette.secondary.withValues(alpha: 0.45),
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: scopedExportCount > 0
                    ? () => _exportCsv(scopedExportCount)
                    : null,
                icon: const Icon(Icons.table_chart_outlined, size: 15),
                label: const Text(
                  'Export CSV',
                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
                ),
              ),
              OutlinedButton.icon(
                key: const ValueKey('history-clear-btn'),
                style: OutlinedButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  foregroundColor: palette.accent,
                  side: BorderSide(
                    color: palette.accent.withValues(alpha: 0.45),
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                onPressed: scopedExportCount > 0 ? _confirmClear : null,
                icon: const Icon(Icons.delete_sweep_rounded, size: 15),
                label: const Text(
                  'Clear',
                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          if (hasNarrowingFilter && entries.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'Showing ${filtered.length} of $allCount recorded ${allCount == 1 ? 'event' : 'events'}',
              style: TextStyle(
                color: palette.textSecondary,
                fontFamily: 'monospace',
                fontSize: context.fluidFont(10),
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ],
      ),
    );

    final Widget timelineBody = filtered.isEmpty
        ? _buildEmptyState(context, hasTotalEntries: entries.isNotEmpty)
        : Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              for (int i = 0; i < filtered.length; i++) ...[
                if (i > 0) const SizedBox(height: 10),
                _buildTimelineCard(context, filtered[i]),
              ],
            ],
          );

    if (widget.scrollable) {
      return ListView(
        physics: const BouncingScrollPhysics(),
        children: [
          headerAndControls,
          const SizedBox(height: 12),
          timelineBody,
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        headerAndControls,
        const SizedBox(height: 12),
        timelineBody,
      ],
    );
  }

  Widget _buildFilterChip(
    BuildContext context, {
    required Key key,
    required String label,
    required bool selected,
    required Color color,
    required VoidCallback onTap,
  }) {
    final palette = context.palette;
    return ChoiceChip(
      key: key,
      label: Text(label),
      selected: selected,
      selectedColor: color.withValues(alpha: 0.22),
      labelStyle: TextStyle(
        fontSize: context.fluidFont(11),
        fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
        color: selected ? color : palette.textSecondary,
      ),
      onSelected: (_) {
        _hapticTap();
        onTap();
      },
    );
  }

  Widget _buildEmptyState(
    BuildContext context, {
    required bool hasTotalEntries,
  }) {
    final palette = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      decoration: BoxDecoration(
        gradient: palette.cardBevelGradient(isSelected: false),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: palette.glassBorderIdle, width: 1.1),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              color: palette.primary.withValues(alpha: 0.12),
              border: Border.all(
                color: palette.primary.withValues(alpha: 0.30),
              ),
            ),
            child: Icon(
              hasTotalEntries
                  ? Icons.filter_list_off_rounded
                  : Icons.history_toggle_off_rounded,
              color: palette.primary,
              size: 24,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            hasTotalEntries
                ? 'No Activity Matches Your Filter'
                : 'No Activity History Recorded Yet',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: palette.textPrimary,
              fontWeight: FontWeight.w800,
              fontSize: context.fluidFont(13),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            hasTotalEntries
                ? 'Adjust the category pill or search query to inspect earlier events.'
                : 'Remote shell commands, workstation connections, and Wake-on-LAN dispatches will appear here automatically.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: palette.textSecondary,
              fontSize: context.fluidFont(11),
              height: 1.35,
            ),
          ),
          if (hasTotalEntries) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () {
                _searchController.clear();
                setState(() {
                  _query = '';
                  _selectedCategory = null;
                  _failedOnly = false;
                });
              },
              icon: const Icon(Icons.clear_all_rounded, size: 16),
              label: const Text('Reset Filters'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildTimelineCard(BuildContext context, ActivityHistoryEntry entry) {
    final palette = context.palette;
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final Duration animDur = disableAnim
        ? Duration.zero
        : const Duration(milliseconds: 200);
    final bool isExpanded = _expandedIds.contains(entry.id);
    final bool isBusy = _busyIds.contains(entry.id);

    final Color catColor = _categoryColor(palette, entry.category);
    final String statusLabel = _statusBadgeText(entry.status);
    final Color statusColor = _statusBadgeColor(palette, entry.status);

    final String hostLine = <String>[
      if (entry.hostName.trim().isNotEmpty) entry.hostName.trim(),
      if (entry.hostIp.trim().isNotEmpty) entry.hostIp.trim(),
    ].join(' • ');

    final bool canRerun = entry.category == ActivityCategory.command;
    final bool canResendWol =
        entry.category == ActivityCategory.wol &&
        NetworkValidators.normalizeMac(entry.mac) != null;

    final String detailPreview = entry.detail.trim().split('\n').first.trim();
    final bool showCollapsedPreview =
        !isExpanded &&
        detailPreview.isNotEmpty &&
        detailPreview != entry.title.trim();

    return RepaintBoundary(
      child: Container(
        key: ValueKey('history-entry-${entry.id}'),
        decoration: BoxDecoration(
          gradient: palette.cardBevelGradient(isSelected: isExpanded),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(
            color: isExpanded
                ? catColor.withValues(alpha: 0.45)
                : palette.glassBorderIdle,
            width: 1.15,
          ),
          boxShadow: palette.elevationShadows(isSelected: isExpanded),
        ),
        clipBehavior: Clip.antiAlias,
        child: Material(
          type: MaterialType.transparency,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              FluidSpecularBar(
                isSelected: isExpanded,
                height: 1.1,
                margin: const EdgeInsets.only(left: 14, right: 14, top: 8),
              ),
              InkWell(
                onTap: () {
                  _hapticTap();
                  setState(() {
                    if (isExpanded) {
                      _expandedIds.remove(entry.id);
                    } else {
                      _expandedIds.add(entry.id);
                    }
                  });
                },
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(13, 10, 13, 12),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(11),
                          color: catColor.withValues(
                            alpha: palette.isDaylight ? 0.14 : 0.20,
                          ),
                          border: Border.all(
                            color: catColor.withValues(alpha: 0.42),
                          ),
                        ),
                        child: Icon(
                          _categoryIcon(entry.category),
                          color: catColor,
                          size: 18,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              entry.title.trim().isNotEmpty
                                  ? entry.title.trim()
                                  : _categoryLabel(entry.category),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: palette.textPrimary,
                                fontWeight: FontWeight.w800,
                                fontSize: context.fluidFont(12.5),
                              ),
                            ),
                            if (showCollapsedPreview) ...[
                              const SizedBox(height: 2),
                              Text(
                                detailPreview,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: palette.textSecondary,
                                  fontFamily: 'monospace',
                                  fontSize: context.fluidFont(10.5),
                                ),
                              ),
                            ],
                            if (hostLine.isNotEmpty) ...[
                              const SizedBox(height: 2),
                              Text(
                                hostLine,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: palette.textTertiary,
                                  fontFamily: 'monospace',
                                  fontSize: context.fluidFont(10),
                                ),
                              ),
                            ],
                        const SizedBox(height: 5),
                        Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            _miniPill(
                              context,
                              text: _formatTimestamp(entry.timestampMs),
                              color: palette.textSecondary,
                              isNeutral: true,
                            ),
                            if (entry.latencyMs != null)
                              _miniPill(
                                context,
                                text: '${entry.latencyMs}ms',
                                color: palette.sky,
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 7,
                          vertical: 2.5,
                        ),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(
                            alpha: palette.isDaylight ? 0.13 : 0.18,
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
                      const SizedBox(height: 6),
                      Icon(
                        isExpanded
                            ? Icons.expand_less_rounded
                            : Icons.expand_more_rounded,
                        size: 18,
                        color: palette.textSecondary,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          AnimatedSize(
            duration: animDur,
            curve: Curves.easeOutCubic,
            child: isExpanded
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(13, 0, 13, 13),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Divider(color: palette.dividerColor, height: 1),
                        const SizedBox(height: 10),
                        if (entry.detail.trim().isNotEmpty) ...[
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: palette.surface.withValues(alpha: 0.70),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: palette.dividerColor),
                            ),
                            child: Text(
                              entry.detail.trim(),
                              style: TextStyle(
                                color: palette.textPrimary,
                                fontFamily: 'monospace',
                                fontSize: context.fluidFont(11),
                                height: 1.35,
                              ),
                            ),
                          ),
                          const SizedBox(height: 8),
                        ],
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            _miniPill(
                              context,
                              text: _categoryLabel(entry.category),
                              color: catColor,
                            ),
                            if (entry.mac.trim().isNotEmpty)
                              _miniPill(
                                context,
                                text: 'MAC ${entry.mac.trim()}',
                                color: palette.primary,
                              ),
                            if (entry.meta['port'] != null)
                              _miniPill(
                                context,
                                text: 'Port ${entry.meta['port']}',
                                color: palette.textSecondary,
                                isNeutral: true,
                              ),
                            if (entry.meta['burstCount'] != null)
                              _miniPill(
                                context,
                                text: '${entry.meta['burstCount']}x burst',
                                color: palette.textSecondary,
                                isNeutral: true,
                              ),
                            if (entry.meta['broadcastIp']
                                    ?.toString()
                                    .trim()
                                    .isNotEmpty ??
                                false)
                              _miniPill(
                                context,
                                text: entry.meta['broadcastIp']
                                    .toString()
                                    .trim(),
                                color: palette.textSecondary,
                                isNeutral: true,
                              ),
                            if (entry.meta['exitCode'] != null)
                              _miniPill(
                                context,
                                text: 'Exit ${entry.meta['exitCode']}',
                                color: statusColor,
                              ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 8,
                          runSpacing: 6,
                          children: [
                            OutlinedButton.icon(
                              key: ValueKey('history-copy-${entry.id}'),
                              style: OutlinedButton.styleFrom(
                                visualDensity: VisualDensity.compact,
                                foregroundColor: palette.textPrimary,
                                side: BorderSide(color: palette.dividerColor),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(11),
                                ),
                              ),
                              onPressed: () => _copyEntry(entry),
                              icon: const Icon(Icons.copy_rounded, size: 14),
                              label: const Text(
                                'Copy',
                                style: TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            if (canRerun)
                              OutlinedButton.icon(
                                key: ValueKey('history-rerun-${entry.id}'),
                                style: OutlinedButton.styleFrom(
                                  visualDensity: VisualDensity.compact,
                                  foregroundColor: palette.primary,
                                  side: BorderSide(
                                    color: palette.primary.withValues(
                                      alpha: 0.45,
                                    ),
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(11),
                                  ),
                                ),
                                onPressed: isBusy
                                    ? null
                                    : () => _handleRerunCommand(entry),
                                icon: isBusy
                                    ? SizedBox(
                                        width: 12,
                                        height: 12,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: palette.primary,
                                        ),
                                      )
                                    : const Icon(
                                        Icons.play_arrow_rounded,
                                        size: 15,
                                      ),
                                label: const Text(
                                  'Re-run',
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            if (canResendWol)
                              OutlinedButton.icon(
                                key: ValueKey('history-resend-${entry.id}'),
                                style: OutlinedButton.styleFrom(
                                  visualDensity: VisualDensity.compact,
                                  foregroundColor: palette.warning,
                                  side: BorderSide(
                                    color: palette.warning.withValues(
                                      alpha: 0.50,
                                    ),
                                  ),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(11),
                                  ),
                                ),
                                onPressed: isBusy
                                    ? null
                                    : () => _handleResendWol(entry),
                                icon: isBusy
                                    ? SizedBox(
                                        width: 12,
                                        height: 12,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: palette.warning,
                                        ),
                                      )
                                    : const Icon(Icons.bolt_rounded, size: 15),
                                label: const Text(
                                  'Re-send WoL',
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            IconButton(
                              key: ValueKey('history-delete-${entry.id}'),
                              tooltip: 'Remove entry',
                              constraints: const BoxConstraints(
                                minWidth: 36,
                                minHeight: 36,
                              ),
                              icon: Icon(
                                Icons.delete_outline_rounded,
                                size: 18,
                                color: palette.textTertiary,
                              ),
                              onPressed: () {
                                _hapticTap();
                                unawaited(
                                  ref
                                      .read(historyProvider.notifier)
                                      .removeById(entry.id),
                                );
                              },
                            ),
                          ],
                        ),
                      ],
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ],
      ),
      ),
      ),
    );
  }

  Widget _miniPill(
    BuildContext context, {
    required String text,
    required Color color,
    bool isNeutral = false,
  }) {
    final palette = context.palette;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(
        color: isNeutral
            ? palette.surface.withValues(alpha: 0.72)
            : color.withValues(alpha: palette.isDaylight ? 0.10 : 0.16),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: isNeutral
              ? palette.dividerColor
              : color.withValues(alpha: 0.35),
        ),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: color,
          fontFamily: 'monospace',
          fontSize: context.fluidFont(9.5),
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
