import 'dart:convert';
import 'dart:io';

import 'package:ai_netcontroller/ai_netcontroller.dart';
import 'package:ai_netcontroller/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';

double _contrastRatio(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final lighter = la > lb ? la : lb;
  final darker = la > lb ? lb : la;
  return (lighter + 0.05) / (darker + 0.05);
}

Future<Directory> _openQolHiveBoxes(String prefix) async {
  final dir = Directory.systemTemp.createTempSync(prefix);
  Hive.init(dir.path);
  await Hive.openBox('ghost_devices');
  await Hive.openBox(kAppPrefsBoxName);
  await Hive.openBox(kVaultSecretsBoxName);
  await Hive.openBox(kHistoryBoxName);
  return dir;
}

Future<void> _closeQolHiveDir(Directory dir) async {
  await Future<void>.delayed(const Duration(milliseconds: 40));
  await Hive.close();
  if (dir.existsSync()) {
    for (int i = 0; i < 8; i++) {
      try {
        dir.deleteSync(recursive: true);
        break;
      } on FileSystemException {
        if (i == 7) rethrow;
        await Future<void>.delayed(const Duration(milliseconds: 40));
      }
    }
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Theme Contrast & CyberPalette Ergonomics', () {
    test('luminance-aware foreground tokens maintain readable contrast across all 6 presets in Dark & Daylight', () {
      for (final mode in AppThemeMode.values) {
        for (final preset in CyberAccentPreset.values) {
          for (final glass in GlassIntensity.values) {
            final palette = CyberPalette.fromPreset(
              preset,
              glass: glass,
              themeMode: mode,
            );

            expect(
              _contrastRatio(palette.onPrimary, palette.primary),
              greaterThanOrEqualTo(4.4),
              reason: 'onPrimary contrast failed for $mode/$preset/$glass',
            );
            expect(
              _contrastRatio(palette.onSecondary, palette.secondary),
              greaterThanOrEqualTo(4.4),
              reason: 'onSecondary contrast failed for $mode/$preset/$glass',
            );
            expect(
              _contrastRatio(palette.onWarning, palette.warning),
              greaterThanOrEqualTo(4.4),
              reason: 'onWarning contrast failed for $mode/$preset/$glass',
            );
            expect(
              _contrastRatio(palette.onAccent, palette.accent),
              greaterThanOrEqualTo(4.4),
              reason: 'onAccent contrast failed for $mode/$preset/$glass',
            );

            final midHero = Color.lerp(palette.primary, palette.secondary, 0.5)!;
            expect(
              _contrastRatio(palette.onHeroGradient, midHero),
              greaterThanOrEqualTo(4.4),
              reason: 'onHeroGradient contrast failed for $mode/$preset/$glass',
            );

            final theme = CyberTheme.fromPalette(palette);
            expect(theme.colorScheme.onPrimary, equals(palette.onPrimary));
            expect(theme.colorScheme.onSecondary, equals(palette.onSecondary));
          }
        }
      }

      // Daylight frosted border is visibly tinted rather than pure white-on-white
      final daylightFrosted = CyberPalette.fromPreset(
        CyberAccentPreset.violet,
        glass: GlassIntensity.minimal,
        themeMode: AppThemeMode.daylight,
      );
      expect(daylightFrosted.glassBorderIdle, isNot(equals(Colors.white)));
      expect(
        _contrastRatio(daylightFrosted.warning, daylightFrosted.background),
        greaterThanOrEqualTo(4.3),
      );
      expect(
        _contrastRatio(daylightFrosted.success, daylightFrosted.background),
        greaterThanOrEqualTo(4.3),
      );
    });
  });

  group('Preferences, Sort Persistence, Pinning & Backward-Compatible Config JSON', () {
    late Directory tempDir;

    setUp(() async {
      tempDir = await _openQolHiveBoxes('ai_net_qol_prefs_');
    });

    tearDown(() => _closeQolHiveDir(tempDir));

    test('fleetSortMode persists across restarts, ignores corrupt Hive values, and does not dirty SettingsSection badges', () async {
      final box = Hive.box(kAppPrefsBoxName);
      final notifier = AppPreferencesNotifier(boxOverride: box);

      expect(notifier.state.fleetSortMode, equals(FleetSortMode.defaultOrder));
      await notifier.setFleetSortMode(FleetSortMode.latencyAsc);
      expect(notifier.state.fleetSortMode, equals(FleetSortMode.latencyAsc));

      // Sorting the fleet should not light up Settings "Modified" badges.
      for (final section in SettingsSection.values) {
        expect(notifier.state.isModified(section), isFalse);
      }

      // No-op setter guard: repeating an already-persisted value should not notify listeners
      await notifier.setTargetFps(30);
      int notifications = 0;
      final sub = notifier.addListener((_) => notifications++, fireImmediately: false);
      await notifier.setFleetSortMode(FleetSortMode.latencyAsc);
      await notifier.setTargetFps(30);
      expect(notifications, equals(0));
      sub();

      // Cold restart restores fleetSortMode
      await box.close();
      final reopened = await Hive.openBox(kAppPrefsBoxName);
      final restored = AppPreferencesNotifier(boxOverride: reopened).state;
      expect(restored.fleetSortMode, equals(FleetSortMode.latencyAsc));

      // Corrupt Hive value safely falls back
      await reopened.put('fleetSortMode', 'nonexistent_sort_mode');
      final recovered = AppPreferencesNotifier(boxOverride: reopened).state;
      expect(recovered.fleetSortMode, equals(FleetSortMode.defaultOrder));
    });

    test('Config JSON export/import preserves isPinned & fleetSortMode, strips secrets, and loads legacy backups', () async {
      final box = Hive.box(kAppPrefsBoxName);
      final notifier = AppPreferencesNotifier(boxOverride: box);
      await notifier.setFleetSortMode(FleetSortMode.nameAsc);

      final exported = notifier.exportConfigJson(
        hosts: [
          {
            'id': 'PC-PIN',
            'name': 'Pinned Rig',
            'ip': '192.168.1.44',
            'wsPort': 8765,
            'mac': 'aa-bb-cc-dd-ee-44',
            'useTls': true,
            'isPinned': true,
            'sharedSecret': 'TOP_SECRET_SHOULD_BE_STRIPPED',
            'pairingToken': 'TOKEN_STRIPPED',
          },
        ],
      );

      expect(exported, isNot(contains('TOP_SECRET_SHOULD_BE_STRIPPED')));
      expect(exported, isNot(contains('TOKEN_STRIPPED')));
      final decoded = jsonDecode(exported) as Map<String, dynamic>;
      final prefsMap = decoded['preferences'] as Map<String, dynamic>;
      expect(prefsMap['fleetSortMode'], equals('nameAsc'));
      final hostsList = decoded['hosts'] as List<dynamic>;
      expect((hostsList.first as Map<String, dynamic>)['isPinned'], isTrue);

      // Reset and re-import
      await notifier.setFleetSortMode(FleetSortMode.defaultOrder);
      final importRes = await notifier.importConfigJson(exported);
      expect(importRes.ok, isTrue);
      expect(notifier.state.fleetSortMode, equals(FleetSortMode.nameAsc));
      expect(importRes.importedHosts.length, equals(1));
      expect(importRes.importedHosts.first['isPinned'], isTrue);
      expect(importRes.importedHosts.first.containsKey('sharedSecret'), isFalse);

      // Backward compatibility: legacy v1 JSON missing fleetSortMode & isPinned
      await notifier.setFleetSortMode(FleetSortMode.onlineFirst);
      final legacyJson = jsonEncode({
        'version': 1,
        'preferences': {
          'targetFps': 30,
          'themeMode': 'dark',
        },
        'hosts': [
          {
            'id': 'LEGACY-1',
            'name': 'Legacy Box',
            'ip': '10.0.0.15',
            'wsPort': 8765,
            'mac': '11:22:33:44:55:66',
          },
        ],
      });
      final legacyRes = await notifier.importConfigJson(legacyJson);
      expect(legacyRes.ok, isTrue);
      expect(notifier.state.targetFps, equals(30));
      expect(notifier.state.fleetSortMode, equals(FleetSortMode.onlineFirst));
      expect(legacyRes.importedHosts.first['isPinned'], isNull);
    });

    test('FleetNotifier toggles & persists isPinned and merges discovered MAC/OS cleanly', () async {
      final hostBox = Hive.box('ghost_devices');
      final fleet = app.FleetNotifier(hostBoxOverride: hostBox);
      fleet.addHost(
        app.HostState(
          id: 'PC-A',
          name: 'Workstation A',
          ip: '192.168.1.20',
          mac: '00:00:00:00:00:00',
          isOnline: true,
        ),
      );

      fleet.togglePinHost('PC-A');
      expect(fleet.state.first.isPinned, isTrue);

      fleet.mergeDiscoveredMetadata(
        '192.168.1.20',
        mac: 'aa-bb-cc-11-22-33',
        osName: 'Windows 11 Pro',
      );
      expect(fleet.state.first.mac, equals('AA:BB:CC:11:22:33'));
      expect(fleet.state.first.osName, equals('Windows 11 Pro'));

      // Existing valid MAC must not be overwritten by subsequent discovery
      fleet.mergeDiscoveredMetadata(
        '192.168.1.20',
        mac: 'FF:EE:DD:CC:BB:AA',
        osName: 'Linux',
      );
      expect(fleet.state.first.mac, equals('AA:BB:CC:11:22:33'));
      expect(fleet.state.first.osName, equals('Windows 11 Pro'));

      // Cold restart preserves isPinned & normalized MAC
      await hostBox.close();
      final reopened = await Hive.openBox('ghost_devices');
      final reloaded = app.FleetNotifier(hostBoxOverride: reopened);
      expect(reloaded.state.first.isPinned, isTrue);
      expect(reloaded.state.first.mac, equals('AA:BB:CC:11:22:33'));
    });
  });

  group('LanDiscoveryService & HistoryStore QOL Hardening', () {
    late Directory tempDir;

    setUp(() async {
      tempDir = await _openQolHiveBoxes('ai_net_qol_lan_hist_');
    });

    tearDown(() => _closeQolHiveDir(tempDir));

    test('LanDiscoveryService parses optional MAC and skips APIPA 169.254.x.x broadcast targets', () {
      final parsed = LanDiscoveryService.parseDiscoveryPayload(
        jsonEncode({
          'protocol': LanDiscoveryService.protocolId,
          'hostname': 'Studio-Desktop',
          'ws_port': 8765,
          'tls': true,
          'os': 'Windows 11',
          'mac': 'de-ad-be-ef-00-11',
        }),
        '192.168.1.88',
      );
      expect(parsed, isNotNull);
      expect(parsed!.mac, equals('DE:AD:BE:EF:00:11'));
      expect(parsed.useTls, isTrue);

      // Invalid MAC degrades gracefully to empty string without dropping host
      final badMac = LanDiscoveryService.parseDiscoveryPayload(
        jsonEncode({
          'protocol': LanDiscoveryService.protocolId,
          'hostname': 'Lab-PC',
          'mac': 'NOT_A_MAC',
        }),
        '192.168.1.89',
      );
      expect(badMac, isNotNull);
      expect(badMac!.mac, isEmpty);

      final targets = LanDiscoveryService.deriveBroadcastTargets([
        '127.0.0.1',
        '0.0.0.0',
        '169.254.42.19',
        '192.168.50.14',
        '10.0.2.9',
      ]);
      expect(targets, contains('255.255.255.255'));
      expect(targets, contains('192.168.50.255'));
      expect(targets, contains('10.0.2.255'));
      expect(targets, isNot(contains('169.254.42.255')));
      expect(targets, isNot(contains('127.0.0.255')));
    });

    test('HistoryNotifier supports entriesOverride exports and safe empty clears', () async {
      final box = Hive.box(kHistoryBoxName);
      final history = HistoryNotifier(boxOverride: box);

      // Empty clear is a safe no-op
      await history.clearAll();
      await history.clearCategory(ActivityCategory.wol);
      expect(history.state, isEmpty);

      final e1 = await history.recordCommand(
        command: 'echo "hello, world"',
        hostName: 'Alpha',
        hostIp: '192.168.1.10',
        success: true,
      );
      await history.recordWol(
        mac: 'AA:BB:CC:DD:EE:01',
        hostName: 'SleepNode',
        hostIp: '192.168.1.11',
        success: false,
        error: 'UDP timeout',
      );

      final filteredJson = history.exportAsJson(entriesOverride: [e1]);
      final decoded = jsonDecode(filteredJson) as Map<String, dynamic>;
      expect(decoded['count'], equals(1));

      final filteredCsv = history.exportAsCsv(entriesOverride: [e1]);
      expect(filteredCsv, contains('echo ""hello, world""'));
      expect(filteredCsv, isNot(contains('SleepNode')));
    });
  });

  group('Fleet Dashboard Filtering, Pinning, Sorting & Copy Feedback Widgets', () {
    testWidgets(
      'Fleet supports pin-to-top, status filters, sort modes, and empty-filter reset',
      (tester) async {
        late Directory tempDir;
        await tester.runAsync(() async {
          tempDir = await _openQolHiveBoxes('ai_net_qol_fleet_ui_');
        });
        addTearDown(() async {
          HostConnectionPool.instance.disposeAll();
          await tester.runAsync(() => _closeQolHiveDir(tempDir));
        });

        tester.view.physicalSize = const Size(560, 1200);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        final container = ProviderContainer();
        addTearDown(container.dispose);

        await tester.runAsync(() async {
          await container
              .read(appPreferencesProvider.notifier)
              .setOnboardingCompleted(true);
          final fleet = container.read(app.fleetProvider.notifier);
          fleet.addHost(
            app.HostState(
              id: 'PC-Z',
              name: 'Zeta Server',
              ip: '192.168.1.30',
              mac: 'AA:BB:CC:DD:EE:30',
              isOnline: true,
              latencyMs: 42,
            ),
          );
          fleet.addHost(
            app.HostState(
              id: 'PC-A',
              name: 'Alpha Studio',
              ip: '192.168.1.10',
              mac: 'AA:BB:CC:DD:EE:10',
              isOnline: true,
              latencyMs: 8,
            ),
          );
          fleet.addHost(
            app.HostState(
              id: 'PC-S',
              name: 'Sleep Render',
              ip: '192.168.1.20',
              mac: 'AA:BB:CC:DD:EE:20',
              isOnline: false,
            ),
          );
          await Future<void>.delayed(const Duration(milliseconds: 30));
        });

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: const app.AINetControllerApp(),
          ),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        // 3 hosts => search bar is visible by default
        expect(find.byKey(const ValueKey('fleet-search-input')), findsOneWidget);

        // Pin sleeping PC-S -> tap inside runAsync so Hive disk write runs in real async zone
        final pinBtn = find.byKey(const ValueKey('device-card-pin-PC-S'));
        await tester.runAsync(() async {
          await tester.tap(pinBtn);
          await Future<void>.delayed(const Duration(milliseconds: 50));
        });
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 250));

        expect(
          container.read(app.fleetProvider).firstWhere((h) => h.id == 'PC-S').isPinned,
          isTrue,
        );
        expect(find.byKey(const ValueKey('fleet-filter-pinned')), findsOneWidget);

        // Scroll horizontal filter bar left once so both Pinned & Sort pills are in view
        final filterBar = find.ancestor(
          of: find.byKey(const ValueKey('fleet-sort-btn')),
          matching: find.byType(SingleChildScrollView),
        );
        await tester.drag(filterBar, const Offset(-320, 0));
        await tester.pump();

        // Filter to Pinned only -> only Sleep Render remains visible
        await tester.tap(find.byKey(const ValueKey('fleet-filter-pinned')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));
        expect(find.text('Sleep Render'), findsOneWidget);
        expect(find.text('Alpha Studio'), findsNothing);
        expect(find.text('Zeta Server'), findsNothing);

        // Search for unmatched query -> empty filter state + Reset Filters
        await tester.enterText(
          find.byKey(const ValueKey('fleet-search-input')),
          'zzz-no-match',
        );
        await tester.pump();
        expect(
          find.text('No workstations match the current filter.'),
          findsOneWidget,
        );
        await tester.tap(find.byKey(const ValueKey('fleet-reset-filters-btn')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));
        expect(find.text('Alpha Studio'), findsOneWidget);
        expect(find.text('Zeta Server'), findsOneWidget);
        expect(find.text('Sleep Render'), findsOneWidget);

        // Sort by Name -> open PopupMenuButton inside runAsync so showMenu().then(onSelected)
        // executes setFleetSortMode's Hive write in the real async zone
        await tester.runAsync(() async {
          await tester.tap(find.byKey(const ValueKey('fleet-sort-btn')));
          await Future<void>.delayed(const Duration(milliseconds: 20));
        });
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        await tester.runAsync(() async {
          await tester.tap(find.byKey(const ValueKey('fleet-sort-nameAsc')));
          await Future<void>.delayed(const Duration(milliseconds: 60));
        });
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));

        expect(
          container.read(appPreferencesProvider).fleetSortMode,
          equals(FleetSortMode.nameAsc),
        );
        final yPinned = tester.getTopLeft(find.text('Sleep Render')).dy;
        final yAlpha = tester.getTopLeft(find.text('Alpha Studio')).dy;
        final yZeta = tester.getTopLeft(find.text('Zeta Server')).dy;
        expect(yPinned, lessThan(yAlpha));
        expect(yAlpha, lessThan(yZeta));
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'ResponsiveDeviceCard & ConnectionDiagnosticsSheet copy actions give feedback and dispose timers cleanly on unmount',
      (tester) async {
        final copied = <(String, String)>[];
        final clipboardWrites = <String>[];

        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          if (call.method == 'Clipboard.setData') {
            final args = call.arguments as Map<dynamic, dynamic>?;
            if (args?['text'] is String) {
              clipboardWrites.add(args!['text'] as String);
            }
          }
          return null;
        });
        addTearDown(() {
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(SystemChannels.platform, null);
        });

        await tester.pumpWidget(
          MaterialApp(
            theme: CyberTheme.fromPalette(
              CyberPalette.fromPreset(
                CyberAccentPreset.violet,
                themeMode: AppThemeMode.daylight,
              ),
            ),
            home: Scaffold(
              body: SingleChildScrollView(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    ResponsiveDeviceCard(
                      id: 'PC-COPY',
                      name: 'Studio Rig',
                      ip: '192.168.1.77',
                      wsPort: 8765,
                      mac: 'AA:BB:CC:DD:EE:77',
                      isOnline: true,
                      isExpanded: true,
                      latencyMs: 12,
                      onCopyText: (label, value) => copied.add((label, value)),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        // Tap IP, MAC, Endpoint copy buttons on ResponsiveDeviceCard
        await tester.tap(find.byKey(const ValueKey('device-card-copy-ip-PC-COPY')));
        await tester.pump();
        await tester.tap(find.byKey(const ValueKey('device-card-copy-mac-PC-COPY')));
        await tester.pump();
        await tester.tap(
          find.byKey(const ValueKey('device-card-copy-endpoint-PC-COPY')),
        );
        await tester.pump();

        expect(
          copied,
          equals([
            ('IP', '192.168.1.77'),
            ('MAC', 'AA:BB:CC:DD:EE:77'),
            ('Endpoint', '192.168.1.77:8765'),
          ]),
        );

        // Mount ConnectionDiagnosticsSheet cleanly (no nested scrollables) and test copy report
        await tester.pumpWidget(
          MaterialApp(
            theme: CyberTheme.fromPalette(
              CyberPalette.fromPreset(
                CyberAccentPreset.violet,
                themeMode: AppThemeMode.daylight,
              ),
            ),
            home: Scaffold(
              body: ConnectionDiagnosticsSheet(
                hostName: 'Studio Rig',
                hostIp: '192.168.1.77',
                wsPort: 8765,
                useTls: true,
                snapshot: const HostConnectionSnapshot(
                  phase: HostConnectionPhase.connected,
                  isVaultEstablished: true,
                  latencyMs: 12,
                ),
                currentFps: 60,
                qualityPreset: 'high',
                onReconnect: () {},
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        final copyReportBtn = find.byKey(
          const ValueKey('diagnostics-copy-report-btn'),
        );
        await tester.tap(copyReportBtn);
        await tester.pump();
        expect(find.text('Diagnostics copied'), findsOneWidget);
        expect(
          clipboardWrites.any((s) => s.contains('AI NetController Diagnostics')),
          isTrue,
        );

        // Unmount immediately while feedback timers are still active -> zero pending timer errors
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
        expect(tester.takeException(), isNull);
      },
    );
  });

  group('Settings Deck, WoL Hub & Activity History QOL Interactions', () {
    testWidgets(
      'Settings multi-word search & empty-search suggestion chips work smoothly',
      (tester) async {
        late Directory tempDir;
        await tester.runAsync(() async {
          tempDir = await _openQolHiveBoxes('ai_net_qol_deck_');
        });
        addTearDown(() async {
          await tester.runAsync(() => _closeQolHiveDir(tempDir));
        });

        tester.view.physicalSize = const Size(430, 932);
        tester.view.devicePixelRatio = 1.0;
        addTearDown(() {
          tester.view.resetPhysicalSize();
          tester.view.resetDevicePixelRatio();
        });

        final container = ProviderContainer();
        addTearDown(container.dispose);

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              theme: CyberTheme.themeData,
              home: Scaffold(
                body: SettingsCommandDeck(
                  hosts: const [],
                  savedGlobalSecret: '',
                  onToast: (String _, {Color? accentColor}) {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        final searchField = find.byKey(const ValueKey('settings-search-input'));
        // Tokenized out-of-order multi-word search (would fail naive substring match)
        await tester.enterText(searchField, 'ecdh vault');
        await tester.pump();
        expect(
          find.textContaining('E2E AEAD Payload Vault'),
          findsOneWidget,
        );

        // Non-matching query displays suggestion chips; tapping 'trackpad' fills search
        await tester.enterText(searchField, 'nonexistent_token_xyz');
        await tester.pump();
        expect(find.text('No Matching Settings Found'), findsOneWidget);
        final trackpadChip = find.widgetWithText(ActionChip, 'trackpad');
        expect(trackpadChip, findsOneWidget);
        await tester.ensureVisible(trackpadChip);
        await tester.pump();
        await tester.tap(trackpadChip);
        await tester.pump();
        expect(find.text('No Matching Settings Found'), findsNothing);
        expect(find.text('Trackpad Pointer Sensitivity'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets(
      'WoL Hub custom MAC clear button & status pills and Activity History Errors filter work cleanly',
      (tester) async {
        late Directory tempDir;
        await tester.runAsync(() async {
          tempDir = await _openQolHiveBoxes('ai_net_qol_wol_hist_');
        });
        addTearDown(() async {
          await tester.runAsync(() => _closeQolHiveDir(tempDir));
        });

        final container = ProviderContainer();
        addTearDown(container.dispose);

        await tester.runAsync(() async {
          final history = container.read(historyProvider.notifier);
          await history.recordWol(
            mac: 'AA:BB:CC:DD:EE:01',
            hostName: 'Good-Node',
            hostIp: '192.168.1.50',
            success: true,
          );
          await history.recordWol(
            mac: 'AA:BB:CC:DD:EE:02',
            hostName: 'Fail-Node',
            hostIp: '192.168.1.51',
            success: false,
            error: 'Socket error',
          );
          await history.recordCommand(
            command: 'whoami',
            hostName: 'Good-Node',
            hostIp: '192.168.1.50',
            success: true,
            detail: 'whoami\ndesktop\\admin',
          );
        });

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp(
              theme: CyberTheme.themeData,
              home: Scaffold(
                body: SingleChildScrollView(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    children: [
                      WolHubPanel(
                        hosts: const [],
                        onToast: (String _, {Color? accentColor}) {},
                      ),
                      const SizedBox(height: 16),
                      ActivityHistoryPanel(
                        onToast: (String _, {Color? accentColor}) {},
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        // WoL custom target MAC clear icon appears reactively & clears input
        final macInput = find.byKey(const ValueKey('wol-mac-input'));
        await tester.enterText(macInput, '11:22:33:44:55:66');
        await tester.pump();
        final clearMacBtn = find.byTooltip('Clear MAC');
        expect(clearMacBtn, findsOneWidget);
        await tester.tap(clearMacBtn);
        await tester.pump();
        expect(find.text('11:22:33:44:55:66'), findsNothing);

        // WoL status filter pill: Failed 1 filters to Fail-Node only
        final failedPill = find.text('Failed 1');
        await tester.ensureVisible(failedPill);
        await tester.pump();
        await tester.tap(failedPill);
        await tester.pump();
        expect(find.textContaining('Fail-Node'), findsWidgets);

        // Activity History Errors chip narrows to failed entries & shows Showing X of Y
        final errorsChip = find.byKey(const ValueKey('history-filter-failed'));
        await tester.ensureVisible(errorsChip);
        await tester.pump();
        await tester.tap(errorsChip);
        await tester.pump();
        expect(find.text('Showing 1 of 3 recorded events'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  });
}
