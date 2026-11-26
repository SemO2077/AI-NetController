import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:hive_flutter/hive_flutter.dart';

const String kHistoryBoxName = 'activity_history';
const String kHistoryEntriesKey = 'activity_entries_v1';
const int kMaxActivityHistoryEntries = 200;

/// Categories for unified mobile activity & Wake-on-LAN history entries.
enum ActivityCategory { wol, command, connection, system }

const Set<String> _validStatuses = <String>{'success', 'failed', 'info'};

String _normalizeEntryStatus(String? raw, {String fallback = 'info'}) {
  final normalized = raw?.trim().toLowerCase();
  if (normalized != null && _validStatuses.contains(normalized)) {
    return normalized;
  }
  return fallback;
}

@immutable
class ActivityHistoryEntry {
  final String id;
  final int timestampMs;
  final ActivityCategory category;
  final String hostName;
  final String hostIp;
  final String mac;
  final String title;
  final String detail;
  final String status;
  final int? latencyMs;
  final Map<String, dynamic> meta;

  const ActivityHistoryEntry({
    required this.id,
    required this.timestampMs,
    required this.category,
    this.hostName = '',
    this.hostIp = '',
    this.mac = '',
    required this.title,
    this.detail = '',
    this.status = 'info',
    this.latencyMs,
    this.meta = const <String, dynamic>{},
  });

  DateTime get timestamp => DateTime.fromMillisecondsSinceEpoch(timestampMs);

  ActivityHistoryEntry copyWith({
    String? id,
    int? timestampMs,
    ActivityCategory? category,
    String? hostName,
    String? hostIp,
    String? mac,
    String? title,
    String? detail,
    String? status,
    int? latencyMs,
    bool clearLatency = false,
    Map<String, dynamic>? meta,
  }) {
    return ActivityHistoryEntry(
      id: id ?? this.id,
      timestampMs: timestampMs ?? this.timestampMs,
      category: category ?? this.category,
      hostName: hostName ?? this.hostName,
      hostIp: hostIp ?? this.hostIp,
      mac: mac ?? this.mac,
      title: title ?? this.title,
      detail: detail ?? this.detail,
      status: status ?? this.status,
      latencyMs: clearLatency ? null : (latencyMs ?? this.latencyMs),
      meta: meta ?? this.meta,
    );
  }

  Map<String, dynamic> toMap() => <String, dynamic>{
    'id': id,
    'timestampMs': timestampMs,
    'category': category.name,
    'hostName': hostName,
    'hostIp': hostIp,
    'mac': mac,
    'title': title,
    'detail': detail,
    'status': status,
    'latencyMs': latencyMs,
    'meta': Map<String, dynamic>.from(meta),
  };

  factory ActivityHistoryEntry.fromMap(Map<dynamic, dynamic> raw) {
    final rawTs = raw['timestampMs'];
    final int timestampMs = rawTs is int
        ? rawTs
        : (rawTs is num && rawTs.isFinite ? rawTs.toInt() : 0);

    final categoryName = raw['category']?.toString().trim();
    final category = ActivityCategory.values.firstWhere(
      (e) => e.name == categoryName,
      orElse: () => ActivityCategory.system,
    );

    final rawId = (raw['id'] ?? '').toString().trim();
    final id = rawId.isNotEmpty ? rawId : '${category.name}_$timestampMs';

    final rawLatency = raw['latencyMs'];
    final int? latencyMs = rawLatency is int
        ? rawLatency
        : (rawLatency is num && rawLatency.isFinite
              ? rawLatency.toInt()
              : null);

    final rawMeta = raw['meta'];
    final Map<String, dynamic> meta = rawMeta is Map
        ? Map<String, dynamic>.unmodifiable(<String, dynamic>{
            for (final entry in rawMeta.entries)
              entry.key.toString(): entry.value,
          })
        : const <String, dynamic>{};

    return ActivityHistoryEntry(
      id: id,
      timestampMs: timestampMs,
      category: category,
      hostName: (raw['hostName'] ?? '').toString(),
      hostIp: (raw['hostIp'] ?? '').toString(),
      mac: (raw['mac'] ?? '').toString(),
      title: (raw['title'] ?? '').toString(),
      detail: (raw['detail'] ?? '').toString(),
      status: _normalizeEntryStatus(raw['status']?.toString()),
      latencyMs: latencyMs,
      meta: meta,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is ActivityHistoryEntry &&
        other.id == id &&
        other.timestampMs == timestampMs &&
        other.category == category &&
        other.hostName == hostName &&
        other.hostIp == hostIp &&
        other.mac == mac &&
        other.title == title &&
        other.detail == detail &&
        other.status == status &&
        other.latencyMs == latencyMs &&
        mapEquals(other.meta, meta);
  }

  @override
  int get hashCode => Object.hash(
    id,
    timestampMs,
    category,
    hostName,
    hostIp,
    mac,
    title,
    detail,
    status,
    latencyMs,
    Object.hashAllUnordered(
      meta.entries.map((e) => Object.hash(e.key, e.value)),
    ),
  );
}

class HistoryNotifier extends StateNotifier<List<ActivityHistoryEntry>> {
  HistoryNotifier({Box? boxOverride})
    : _boxOverride = boxOverride,
      super(const <ActivityHistoryEntry>[]) {
    _hydrateFromStorage();
  }

  final Box? _boxOverride;
  int _seqCounter = 0;

  Box? get _box {
    if (_boxOverride != null && _boxOverride.isOpen) return _boxOverride;
    if (Hive.isBoxOpen(kHistoryBoxName)) return Hive.box(kHistoryBoxName);
    return null;
  }

  void _hydrateFromStorage() {
    final box = _box;
    if (box == null) return;

    final raw = box.get(kHistoryEntriesKey);
    if (raw is! List) return;

    final parsed = <ActivityHistoryEntry>[];
    for (final item in raw) {
      if (item is Map) {
        try {
          parsed.add(ActivityHistoryEntry.fromMap(item));
        } catch (_) {
          // Skip corrupt individual entries cleanly.
        }
      }
      if (parsed.length >= kMaxActivityHistoryEntries) break;
    }
    state = List<ActivityHistoryEntry>.unmodifiable(parsed);
  }

  Future<void> _persist() async {
    final box = _box;
    if (box == null) return;
    await box.put(
      kHistoryEntriesKey,
      state.map((e) => e.toMap()).toList(growable: false),
    );
  }

  String _nextId(ActivityCategory category, int nowMs) {
    _seqCounter++;
    return '${category.name}_${nowMs}_$_seqCounter';
  }

  Future<ActivityHistoryEntry> _appendEntry({
    required ActivityCategory category,
    required String title,
    required String detail,
    required String status,
    String hostName = '',
    String hostIp = '',
    String mac = '',
    int? latencyMs,
    Map<String, dynamic> meta = const <String, dynamic>{},
  }) async {
    final int nowMs = DateTime.now().millisecondsSinceEpoch;
    final entry = ActivityHistoryEntry(
      id: _nextId(category, nowMs),
      timestampMs: nowMs,
      category: category,
      hostName: hostName.trim(),
      hostIp: hostIp.trim(),
      mac: mac.trim(),
      title: title,
      detail: detail,
      status: _normalizeEntryStatus(status),
      latencyMs: latencyMs,
      meta: Map<String, dynamic>.unmodifiable(meta),
    );

    final next = <ActivityHistoryEntry>[
      entry,
      ...state,
    ].take(kMaxActivityHistoryEntries).toList(growable: false);
    state = List<ActivityHistoryEntry>.unmodifiable(next);
    await _persist();
    return entry;
  }

  /// Records a Wake-on-LAN dispatch attempt and metadata.
  Future<ActivityHistoryEntry> recordWol({
    required String mac,
    String hostName = '',
    String hostIp = '',
    bool success = true,
    String? status,
    int port = 9,
    String broadcastIp = '',
    int burstCount = 1,
    int? latencyMs,
    String? title,
    String? detail,
    List<String>? targets,
    String? error,
    Map<String, dynamic> extraMeta = const <String, dynamic>{},
  }) {
    final String resolvedStatus = status != null
        ? _normalizeEntryStatus(status, fallback: success ? 'success' : 'failed')
        : (success ? 'success' : 'failed');
    final bool isOk = resolvedStatus != 'failed';

    final String resolvedTitle =
        title ?? (isOk ? 'Wake-on-LAN Sent' : 'Wake-on-LAN Failed');
    final String targetHint = broadcastIp.trim().isNotEmpty
        ? broadcastIp.trim()
        : (targets != null && targets.isNotEmpty
              ? targets.join(', ')
              : 'auto broadcast');
    final String resolvedDetail =
        detail ??
        (isOk
            ? 'MAC ${mac.trim()} • UDP $port • ${burstCount}x burst • $targetHint'
            : (error != null && error.trim().isNotEmpty
                  ? error.trim()
                  : 'Failed to dispatch WoL packet to ${mac.trim()}'));

    final meta = <String, dynamic>{
      ...extraMeta,
      'port': port,
      'broadcastIp': broadcastIp.trim(),
      'burstCount': burstCount,
      if (targets != null) 'targets': List<String>.from(targets),
      if (error != null && error.trim().isNotEmpty) 'error': error.trim(),
    };

    return _appendEntry(
      category: ActivityCategory.wol,
      hostName: hostName,
      hostIp: hostIp,
      mac: mac,
      title: resolvedTitle,
      detail: resolvedDetail,
      status: resolvedStatus,
      latencyMs: latencyMs,
      meta: meta,
    );
  }

  /// Records a remote terminal/shell command execution.
  Future<ActivityHistoryEntry> recordCommand({
    required String command,
    String hostName = '',
    String hostIp = '',
    String mac = '',
    bool success = true,
    String? status,
    int? exitCode,
    int? latencyMs,
    String? title,
    String? detail,
    Map<String, dynamic> extraMeta = const <String, dynamic>{},
  }) {
    final String resolvedStatus = status != null
        ? _normalizeEntryStatus(status, fallback: success ? 'success' : 'failed')
        : (success ? 'success' : 'failed');
    final bool isOk = resolvedStatus != 'failed';
    final String cleanCmd = command.trim();

    final String resolvedTitle =
        title ?? (isOk ? 'Remote Command Executed' : 'Remote Command Failed');
    final String resolvedDetail = detail ?? cleanCmd;

    final meta = <String, dynamic>{
      ...extraMeta,
      'command': cleanCmd,
      if (exitCode != null) 'exitCode': exitCode,
    };

    return _appendEntry(
      category: ActivityCategory.command,
      hostName: hostName,
      hostIp: hostIp,
      mac: mac,
      title: resolvedTitle,
      detail: resolvedDetail,
      status: resolvedStatus,
      latencyMs: latencyMs,
      meta: meta,
    );
  }

  /// Records a host session connection or transport lifecycle event.
  Future<ActivityHistoryEntry> recordConnection({
    required String hostIp,
    String hostName = '',
    String mac = '',
    bool success = true,
    String? status,
    String? event,
    int? port,
    int? latencyMs,
    String? title,
    String? detail,
    Map<String, dynamic> extraMeta = const <String, dynamic>{},
  }) {
    final String resolvedStatus = status != null
        ? _normalizeEntryStatus(status, fallback: success ? 'success' : 'failed')
        : (success ? 'success' : 'failed');
    final bool isOk = resolvedStatus != 'failed';
    final String label = hostName.trim().isNotEmpty
        ? hostName.trim()
        : hostIp.trim();

    final String resolvedTitle =
        title ??
        (isOk
            ? 'Connected to $label'
            : 'Connection Failed ($label)');
    final String resolvedDetail =
        detail ??
        (event != null && event.trim().isNotEmpty
            ? event.trim()
            : (isOk
                  ? 'Encrypted WebSocket session established'
                  : 'Unable to establish encrypted session'));

    final meta = <String, dynamic>{
      ...extraMeta,
      if (port != null) 'port': port,
      if (event != null && event.trim().isNotEmpty) 'event': event.trim(),
    };

    return _appendEntry(
      category: ActivityCategory.connection,
      hostName: hostName,
      hostIp: hostIp,
      mac: mac,
      title: resolvedTitle,
      detail: resolvedDetail,
      status: resolvedStatus,
      latencyMs: latencyMs,
      meta: meta,
    );
  }

  /// Records a general system or backup/config lifecycle event.
  Future<ActivityHistoryEntry> recordSystem({
    required String title,
    String detail = '',
    String status = 'info',
    String hostName = '',
    String hostIp = '',
    String mac = '',
    int? latencyMs,
    Map<String, dynamic> meta = const <String, dynamic>{},
  }) {
    return _appendEntry(
      category: ActivityCategory.system,
      hostName: hostName,
      hostIp: hostIp,
      mac: mac,
      title: title,
      detail: detail,
      status: status,
      latencyMs: latencyMs,
      meta: meta,
    );
  }

  Future<void> clearAll() async {
    if (state.isEmpty) return;
    state = const <ActivityHistoryEntry>[];
    await _persist();
  }

  Future<void> clearCategory(ActivityCategory category) async {
    final filtered = state
        .where((entry) => entry.category != category)
        .toList(growable: false);
    if (filtered.length == state.length) return;
    state = List<ActivityHistoryEntry>.unmodifiable(filtered);
    await _persist();
  }

  Future<void> removeById(String id) async {
    final filtered = state
        .where((entry) => entry.id != id)
        .toList(growable: false);
    if (filtered.length == state.length) return;
    state = List<ActivityHistoryEntry>.unmodifiable(filtered);
    await _persist();
  }

  List<ActivityHistoryEntry> _filteredEntries(ActivityCategory? category) {
    if (category == null) return state;
    return state
        .where((entry) => entry.category == category)
        .toList(growable: false);
  }

  /// Exports matching activity entries as a pretty-printed JSON payload.
  String exportAsJson({
    ActivityCategory? category,
    Iterable<ActivityHistoryEntry>? entriesOverride,
  }) {
    final items = entriesOverride != null
        ? entriesOverride.toList(growable: false)
        : _filteredEntries(category);
    final payload = <String, Object?>{
      'version': 1,
      'exportedAt': DateTime.now().toUtc().toIso8601String(),
      'category': category?.name ?? 'all',
      'count': items.length,
      'entries': items.map((e) => e.toMap()).toList(growable: false),
    };
    return const JsonEncoder.withIndent('  ').convert(payload);
  }

  /// Exports matching activity entries as RFC 4180 CSV text.
  String exportAsCsv({
    ActivityCategory? category,
    Iterable<ActivityHistoryEntry>? entriesOverride,
  }) {
    final items = entriesOverride != null
        ? entriesOverride.toList(growable: false)
        : _filteredEntries(category);
    final buffer = StringBuffer(
      'id,timestamp_iso,timestamp_ms,category,status,host_name,host_ip,mac,title,detail,latency_ms,meta_json',
    );
    for (final entry in items) {
      final iso = DateTime.fromMillisecondsSinceEpoch(
        entry.timestampMs,
        isUtc: true,
      ).toIso8601String();
      String metaJson;
      try {
        metaJson = jsonEncode(entry.meta);
      } catch (_) {
        metaJson = '{}';
      }
      buffer.writeln();
      buffer.write(
        <String>[
          _csvField(entry.id),
          _csvField(iso),
          _csvField(entry.timestampMs.toString()),
          _csvField(entry.category.name),
          _csvField(entry.status),
          _csvField(entry.hostName),
          _csvField(entry.hostIp),
          _csvField(entry.mac),
          _csvField(entry.title),
          _csvField(entry.detail),
          _csvField(entry.latencyMs?.toString() ?? ''),
          _csvField(metaJson),
        ].join(','),
      );
    }
    return buffer.toString();
  }

  static String _csvField(String raw) {
    final needsQuoting =
        raw.contains(',') ||
        raw.contains('"') ||
        raw.contains('\n') ||
        raw.contains('\r');
    if (!needsQuoting) return raw;
    return '"${raw.replaceAll('"', '""')}"';
  }
}

final historyProvider =
    StateNotifierProvider<HistoryNotifier, List<ActivityHistoryEntry>>((ref) {
      return HistoryNotifier();
    });
