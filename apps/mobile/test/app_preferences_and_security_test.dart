import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:ai_netcontroller/security/crypto_engine.dart' as engine;
import 'package:ai_netcontroller/security/network_validators.dart';
import 'package:ai_netcontroller/services/app_preferences.dart';
import 'package:ai_netcontroller/theme/fluid_theme.dart';
import 'package:ai_netcontroller/main.dart' as app;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';

Future<void> _cleanupHiveTempDir(Directory tempDir) async {
  await Future<void>.delayed(const Duration(milliseconds: 50));
  for (final name in [kAppPrefsBoxName, 'ghost_devices', kVaultSecretsBoxName]) {
    if (Hive.isBoxOpen(name)) {
      await Hive.box(name).flush();
    }
  }
  await Hive.close();
  if (tempDir.existsSync()) {
    for (int attempt = 0; attempt < 8; attempt++) {
      try {
        tempDir.deleteSync(recursive: true);
        break;
      } on FileSystemException {
        if (attempt == 7) rethrow;
        await Future<void>.delayed(const Duration(milliseconds: 40));
      }
    }
  }
}

void main() {
  group('AppPreferencesNotifier Persistence', () {
    late Directory tempDir;

    setUp(() async {
      tempDir = Directory.systemTemp.createTempSync('ai_net_prefs_test_');
      Hive.init(tempDir.path);
    });

    tearDown(() => _cleanupHiveTempDir(tempDir));

    test('persists theme accent color, glass intensity, FPS, and flags across cold restart', () async {
      final nonDefaultAccent = CyberAccentPreset.values.last;
      final box = await Hive.openBox(kAppPrefsBoxName);
      final notifier = AppPreferencesNotifier(boxOverride: box);

      await notifier.setAccent(nonDefaultAccent);
      await notifier.setGlassIntensity(GlassIntensity.minimal);
      await notifier.setReducedMotion(true);
      await notifier.setTargetFps(60);
      await notifier.setBiometricLockEnabled(true);
      await notifier.setPreferTls(true);
      await notifier.setEnableE2eVault(false);
      await notifier.setOnboardingCompleted(true);
      await notifier.setCustomScanPort(9443);

      // Simulate cold app restart by closing and reopening Hive from disk.
      await box.close();
      final reopenedBox = await Hive.openBox(kAppPrefsBoxName);
      final restored = AppPreferencesNotifier(boxOverride: reopenedBox).state;

      expect(restored.accent, equals(nonDefaultAccent));
      expect(restored.glassIntensity, equals(GlassIntensity.minimal));
      expect(restored.reducedMotion, isTrue);
      expect(restored.targetFps, equals(60));
      expect(restored.biometricLockEnabled, isTrue);
      expect(restored.preferTls, isTrue);
      expect(restored.enableE2eVault, isFalse);
      expect(restored.hasCompletedOnboarding, isTrue);
      expect(restored.customScanPort, equals(9443));
    });

    test('clamps invalid FPS / ports and maintains deduplicated terminal history cap', () async {
      final box = await Hive.openBox(kAppPrefsBoxName);
      final notifier = AppPreferencesNotifier(boxOverride: box);

      await notifier.setTargetFps(120); // unsupported value -> default 30
      await notifier.setCustomScanPort(0); // invalid -> unchanged 8765
      await notifier.setCustomScanPort(70000); // invalid -> unchanged 8765

      expect(notifier.state.targetFps, equals(30));
      expect(notifier.state.customScanPort, equals(8765));

      for (int i = 0; i < 30; i++) {
        await notifier.pushTerminalCommand('cmd-$i');
      }
      await notifier.pushTerminalCommand('cmd-5');

      expect(notifier.state.terminalHistory.length, equals(25));
      expect(notifier.state.terminalHistory.first, equals('cmd-5'));
      expect(
        notifier.state.terminalHistory.where((e) => e == 'cmd-5').length,
        equals(1),
      );

      await notifier.clearTerminalHistory();
      expect(notifier.state.terminalHistory, isEmpty);

      await notifier.setAccent(CyberAccentPreset.values.last);
      await notifier.resetDefaults();
      expect(notifier.state.accent, equals(CyberAccentPreset.cyan));
      expect(notifier.state.hasCompletedOnboarding, isTrue);
    });
  });

  group('FleetNotifier & Vault Secret Migration Persistence', () {
    late Directory tempDir;

    setUp(() async {
      tempDir = Directory.systemTemp.createTempSync('ai_net_fleet_test_');
      Hive.init(tempDir.path);
    });

    tearDown(() => _cleanupHiveTempDir(tempDir));

    test('persists hosts across restarts, resets live telemetry, and purges removed secrets', () async {
      final ghostBox = await Hive.openBox('ghost_devices');
      await Hive.openBox(kVaultSecretsBoxName);

      final notifier = app.FleetNotifier(hostBoxOverride: ghostBox);
      notifier.addHost(
        app.HostState(
          id: 'WS-01',
          name: 'Workstation One',
          ip: '192.168.10.42',
          wsPort: 8765,
          mac: 'aa-bb-cc-dd-ee-ff',
          isOnline: true,
          cpuUsage: 74,
          ramUsage: 62,
          latencyMs: 12,
          sharedSecret: 'ainet_super_secret_token',
        ),
      );

      expect(notifier.state.single.mac, equals('AA:BB:CC:DD:EE:FF'));
      expect(app.loadHostPairingSecret('192.168.10.42'),
          equals('ainet_super_secret_token'));

      await Future<void>.delayed(const Duration(milliseconds: 50));
      await ghostBox.close();
      await Hive.box(kVaultSecretsBoxName).close();

      final reopenedGhost = await Hive.openBox('ghost_devices');
      await Hive.openBox(kVaultSecretsBoxName);

      final restored = app.FleetNotifier(hostBoxOverride: reopenedGhost);
      expect(restored.state.length, equals(1));
      final host = restored.state.single;
      expect(host.ip, equals('192.168.10.42'));
      expect(host.mac, equals('AA:BB:CC:DD:EE:FF'));
      expect(host.isOnline, isFalse);
      expect(host.cpuUsage, equals(0));
      expect(host.latencyMs, isNull);
      expect(host.sharedSecret, equals('ainet_super_secret_token'));

      // Edit host IP migrates secret and persists update.
      restored.editHost(
        host.id,
        name: 'Studio Rig',
        ip: '192.168.10.99',
        wsPort: 9001,
        mac: '11:22:33:44:55:66',
      );
      expect(app.loadHostPairingSecret('192.168.10.99'),
          equals('ainet_super_secret_token'));

      // Removing host deletes saved entry and secret.
      restored.removeHost(host.id, purgeSecret: true);
      expect(restored.state, isEmpty);
      expect(Hive.box(kVaultSecretsBoxName).get('__secret_192.168.10.99'),
          isNull);
    });

    test('migrates legacy secrets out of ghost_devices into vault_secrets', () async {
      final legacyBox = await Hive.openBox('ghost_devices');
      await legacyBox.put('__global_pairing_secret__', 'legacy_global_tok');
      await legacyBox.put('__secret_10.0.0.5', 'legacy_host_tok');
      await Hive.openBox(kVaultSecretsBoxName);

      expect(app.loadHostPairingSecret('10.0.0.5'), equals('legacy_host_tok'));
      expect(app.loadGlobalPairingSecret(), equals('legacy_global_tok'));
      expect(legacyBox.containsKey('__secret_10.0.0.5'), isFalse);
      expect(legacyBox.containsKey('__global_pairing_secret__'), isFalse);
    });
  });

  group('NetworkValidators Security & Validation', () {
    test('validates IPv4, hostnames, MACs, broadcast calculation, and WS URIs', () {
      expect(NetworkValidators.isValidIpv4('192.168.1.50'), isTrue);
      expect(NetworkValidators.isValidIpv4('999.168.1.50'), isFalse);
      expect(NetworkValidators.isValidIpOrHost('workstation.local'), isTrue);
      expect(NetworkValidators.isValidIpOrHost('bad host!'), isFalse);
      expect(NetworkValidators.isValidPort(8765), isTrue);
      expect(NetworkValidators.isValidPort(0), isFalse);
      expect(NetworkValidators.isValidPort(65536), isFalse);

      expect(NetworkValidators.normalizeMac('aa-bb-cc-dd-ee-ff'),
          equals('AA:BB:CC:DD:EE:FF'));
      expect(NetworkValidators.normalizeMac('00:00:00:00:00:00'), isNull);
      expect(NetworkValidators.deriveBroadcastIp('10.20.30.44'),
          equals('10.20.30.255'));
      expect(NetworkValidators.deriveBroadcastIp('my-host.local'),
          equals('255.255.255.255'));

      final tlsUri = NetworkValidators.buildWebSocketUri(
        '192.168.1.10',
        8765,
        useTls: true,
      );
      expect(tlsUri.scheme, equals('wss'));
      expect(tlsUri.host, equals('192.168.1.10'));
      expect(tlsUri.port, equals(8765));

      expect(
        () => NetworkValidators.buildWebSocketUri('invalid host!!', 8765),
        throwsArgumentError,
      );
    });

    test('detects direct and obfuscated high-risk commands', () {
      expect(NetworkValidators.inspectCommandRisk('ipconfig /all'), isNull);
      expect(NetworkValidators.inspectCommandRisk('nvidia-smi'), isNull);

      expect(NetworkValidators.inspectCommandRisk('rm -rf /'), isNotNull);
      expect(NetworkValidators.inspectCommandRisk('shutdown /s /t 0'), isNotNull);
      // Caret obfuscation defense
      expect(NetworkValidators.inspectCommandRisk('s^h^u^t^d^o^w^n /r'), isNotNull);
      // Encoded PowerShell payload
      final encoded = base64Encode(utf8.encode('Stop-Process -Name explorer'));
      expect(
        NetworkValidators.inspectCommandRisk('powershell -EncodedCommand $encoded'),
        isNotNull,
      );
    });

    test('CryptoEngine ChaCha20-Poly1305 matches RFC 8439 and Poly1305 r[8] clamp vectors', () {
      Uint8List hex(String h) => Uint8List.fromList([
            for (int i = 0; i < h.length; i += 2)
              int.parse(h.substring(i, i + 2), radix: 16),
          ]);

      // RFC 8439 Section 2.8.2 AEAD test vector
      final rfcKey = hex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
      final rfcNonce = hex('070000004041424344454647');
      final rfcAad = hex('50515253c0c1c2c3c4c5c6c7');
      final rfcPt = Uint8List.fromList(utf8.encode(
        "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
      ));
      const expectedRfcOut =
          'd31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d6'
          '3dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b36'
          '92ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc'
          '3ff4def08e4b7a9de576d26586cec64b61161ae10b594f09e26a7e902ecbd0600691';
      final rfcCt = engine.ChaCha20Poly1305.encrypt(rfcKey, rfcNonce, rfcPt, aad: rfcAad);
      expect(
        rfcCt.map((b) => b.toRadixString(16).padLeft(2, '0')).join(),
        equals(expectedRfcOut),
      );
      expect(
        engine.ChaCha20Poly1305.decrypt(rfcKey, rfcNonce, rfcCt, aad: rfcAad),
        equals(rfcPt),
      );

      // Regression vector where Poly1305 OTK r[8] = 0x3b (r[8] & 3 != 0)
      final k2 = Uint8List.fromList(List.generate(32, (i) => (i + 2) % 256));
      final n2 = Uint8List.fromList(List.generate(12, (i) => i));
      final aad2 = Uint8List.fromList(utf8.encode('aad'));
      final pt2 = Uint8List.fromList(utf8.encode('clamp_regression_check'));
      const expectedK2Out =
          '3ddc80e190a868822cf6afb51c01e67d738cc5a713fac9ad107cf3331655b074b655bbdc4d71';
      final ct2 = engine.ChaCha20Poly1305.encrypt(k2, n2, pt2, aad: aad2);
      expect(
        ct2.map((b) => b.toRadixString(16).padLeft(2, '0')).join(),
        equals(expectedK2Out),
      );
      expect(
        engine.ChaCha20Poly1305.decrypt(k2, n2, hex(expectedK2Out), aad: aad2),
        equals(pt2),
      );
    });
  });

  group('Responsive UI, Theme Persistence & Adaptive Layouts', () {
    testWidgets('persists selected accent color across full ProviderScope rebuild', (tester) async {
      final tempDir = Directory.systemTemp.createTempSync('ai_net_widget_1_');
      await tester.runAsync(() async {
        Hive.init(tempDir.path);
        await Hive.openBox('ghost_devices');
        await Hive.openBox(kAppPrefsBoxName);
        await Hive.openBox(kVaultSecretsBoxName);
      });
      addTearDown(() async {
        await tester.runAsync(() async {
          await Hive.close();
          if (tempDir.existsSync()) {
            tempDir.deleteSync(recursive: true);
          }
        });
      });

      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);

      final secondAccent = CyberAccentPreset.values[1];
      final expectedColor = CyberTheme.fromPalette(
        CyberPalette.fromPreset(secondAccent),
      ).colorScheme.primary;

      await tester.pumpWidget(
        const ProviderScope(child: app.AINetControllerApp()),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      // Switch to Settings tab via its navigation icon.
      await tester.tap(find.byIcon(Icons.tune_rounded).last);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      // Tap non-default accent swatch.
      final swatchFinder = find.byKey(ValueKey('accent-${secondAccent.name}'));
      await tester.ensureVisible(swatchFinder);
      await tester.runAsync(() async {
        await tester.tap(swatchFinder);
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      final materialAppBefore =
          tester.widget<MaterialApp>(find.byType(MaterialApp));
      expect(materialAppBefore.theme?.colorScheme.primary, equals(expectedColor));

      // Dispose and recreate app root to verify Hive persistence rehydrates theme.
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      await tester.pumpWidget(
        const ProviderScope(child: app.AINetControllerApp()),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      final materialAppAfter =
          tester.widget<MaterialApp>(find.byType(MaterialApp));
      expect(materialAppAfter.theme?.colorScheme.primary, equals(expectedColor));
    });

    testWidgets('renders Medium 2-col grid and Expanded tab switching cleanly without overflow', (tester) async {
      final tempDir = Directory.systemTemp.createTempSync('ai_net_widget_2_');
      await tester.runAsync(() async {
        Hive.init(tempDir.path);
        await Hive.openBox('ghost_devices');
        await Hive.openBox(kAppPrefsBoxName);
        await Hive.openBox(kVaultSecretsBoxName);
      });
      addTearDown(() async {
        await tester.runAsync(() async {
          await Hive.close();
          if (tempDir.existsSync()) {
            tempDir.deleteSync(recursive: true);
          }
        });
      });

      addTearDown(tester.view.resetPhysicalSize);

      // Medium tablet portrait (700x900) with populated hosts
      tester.view.physicalSize = const Size(700, 900);
      tester.view.devicePixelRatio = 1.0;

      final container = ProviderContainer();
      addTearDown(container.dispose);
      await tester.runAsync(() async {
        container.read(app.fleetProvider.notifier).addHost(
              app.HostState(
                id: 'PC-1',
                name: 'Alpha Render Node',
                ip: '192.168.1.10',
                mac: 'AA:BB:CC:DD:EE:01',
                isOnline: false,
                cpuUsage: 42,
                ramUsage: 61,
                latencyMs: 8,
              ),
            );
        container.read(app.fleetProvider.notifier).addHost(
              app.HostState(
                id: 'PC-2',
                name: 'Beta Build Box',
                ip: '192.168.1.11',
                mac: 'AA:BB:CC:DD:EE:02',
                isOnline: false,
              ),
            );
        await Future<void>.delayed(const Duration(milliseconds: 50));
      });

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const app.AINetControllerApp(),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Alpha Render Node'), findsOneWidget);
      expect(find.text('Beta Build Box'), findsOneWidget);

      // Switch to Expanded tablet/landscape width (1024x768)
      tester.view.physicalSize = const Size(1024, 768);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      // Switch tabs on Expanded layout (previously stuck on split pane!)
      await tester.tap(find.byIcon(Icons.tune_rounded).first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('APPEARANCE STUDIO (PERSISTENT)'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.terminal_rounded).first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Run'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.devices_rounded).first);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Alpha Render Node'), findsWidgets);
      expect(find.text('Beta Build Box'), findsOneWidget);

      expect(tester.takeException(), isNull);
    });
  });
}
