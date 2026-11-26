import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:ai_netcontroller/protocol/binary_protocol.dart';
import 'package:ai_netcontroller/security/crypto_engine.dart' as ce;
import 'package:ai_netcontroller/services/file_transfer_engine.dart';
import 'package:ai_netcontroller/services/frame_decrypt_isolate.dart';
import 'package:ai_netcontroller/services/host_connection_client.dart';
import 'package:ai_netcontroller/services/thermal_governor.dart';
import 'package:ai_netcontroller/services/zero_gc_video_pipeline.dart';
import 'package:ai_netcontroller/theme/fluid_theme.dart';
import 'package:ai_netcontroller/ui/fullscreen_stream_page.dart';
import 'package:ai_netcontroller/ui/pip_stream_viewer.dart';
import 'package:ai_netcontroller/ui/remote_keyboard_bar.dart';
import 'package:ai_netcontroller/ui/touch_coordinate_mapper.dart';
import 'package:ai_netcontroller/ui/touch_feedback_overlay.dart';
import 'package:ai_netcontroller/ui/viewport_stream_widget.dart';
import 'package:crypto/crypto.dart' as crypto_pkg;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const String _kTinyJpegBase64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9'
    'PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhC'
    'Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAAR'
    'CAAMABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA'
    'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK'
    'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG'
    'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl'
    '5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA'
    'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk'
    'NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE'
    'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk'
    '5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooor6I8c/9k=';

class _QolDecryptedFrame {
  final int opcode;
  final Uint8List payload;
  const _QolDecryptedFrame(this.opcode, this.payload);
}

/// Minimal mock host implementing canonical 0xC5 0x71 OP_AUTH + Mutual X25519
/// AEAD + OP_DISPLAY_ENUM + OP_FRAME for HUD/FPS/monitor QOL tests.
class _QolMockHost {
  final HttpServer _server;
  final String psk;
  final List<WebSocket> _sockets = <WebSocket>[];
  final StreamController<_QolDecryptedFrame> _rxCtrl =
      StreamController<_QolDecryptedFrame>.broadcast();

  _QolMockHost._(this._server, this.psk) {
    _server.listen((HttpRequest req) async {
      if (!WebSocketTransformer.isUpgradeRequest(req)) {
        req.response.statusCode = HttpStatus.badRequest;
        await req.response.close();
        return;
      }
      final ws = await WebSocketTransformer.upgrade(req);
      _sockets.add(ws);
      _serve(ws);
    });
  }

  int get port => _server.port;
  Stream<_QolDecryptedFrame> get received => _rxCtrl.stream;

  static Future<_QolMockHost> start({String psk = 'qol_stream_secret_42'}) async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    return _QolMockHost._(server, psk);
  }

  void _serve(WebSocket ws) {
    final authNonce = Uint8List.fromList(List<int>.generate(16, (i) => i + 11));
    bool authed = false;
    bool vault = false;
    Uint8List? hostPriv;
    Uint8List? hostN2;
    Uint8List? kRx;
    Uint8List? kTx;
    int txSeq = 0;

    Uint8List encrypt(int opcode, Uint8List plain, {int? seq}) {
      txSeq++;
      final int wireLen = ce.kNonceSize + plain.length + ce.kTagSize;
      final out = Uint8List(kHeaderSize + wireLen);
      out[0] = kMagicByte0;
      out[1] = kMagicByte1;
      out[2] = opcode & 0xFF;
      out[3] = ProtocolFlags.encrypted;
      final bd = ByteData.sublistView(out);
      bd.setUint32(4, (seq ?? txSeq) & 0xFFFFFFFF, Endian.big);
      bd.setUint32(8, wireLen, Endian.big);
      bd.setUint32(12, 0, Endian.big);
      bd.setUint64(16, txSeq, Endian.big);
      ce.ChaCha20Poly1305.encryptInto(
        kTx!,
        Uint8List.sublistView(out, 12, 24),
        plain,
        out,
        24,
        aad: Uint8List.sublistView(out, 0, kHeaderSize),
      );
      return out;
    }

    void send(Uint8List data) {
      if (ws.readyState != WebSocket.open) return;
      try {
        ws.add(data);
      } catch (_) {}
    }

    send(packPacket(BinaryOpcode.auth, authNonce, seq: 1));

    ws.listen(
      (dynamic msg) {
        if (msg is! List<int>) return;
        final raw = msg is Uint8List ? msg : Uint8List.fromList(msg);
        final pkt = parsePacket(raw);
        if (pkt == null) return;

        if (!authed) {
          authed = true;
          send(packPacket(BinaryOpcode.auth, utf8.encode('OK_AUTHENTICATED'), seq: 2));
          return;
        }
        if (!vault) {
          final txt = utf8.decode(pkt.payload, allowMalformed: true);
          if (txt.startsWith('INIT_ECDH_VAULT_M:') && pkt.payload.length == 34) {
            final cliChal = Uint8List.sublistView(pkt.payload, 18, 34);
            hostPriv = ce.X25519.generatePrivateKey();
            final hostPub = ce.X25519.publicFromPrivate(hostPriv!);
            hostN2 = Uint8List.fromList(List<int>.generate(16, (i) => i + 40));
            final core59 = Uint8List.fromList(<int>[
              ...ce.kMagicBytes,
              ...hostPub,
              ...hostN2!,
            ]);
            final mac = crypto_pkg.Hmac(crypto_pkg.sha256, utf8.encode(psk))
                .convert(<int>[...utf8.encode('CST_HOST_CHAL_M:'), ...cliChal, ...core59])
                .bytes;
            send(packPacket(
              BinaryOpcode.auth,
              Uint8List.fromList(<int>[...core59, ...mac]),
              flags: ProtocolFlags.compressed,
              seq: 3,
            ));
          } else if (pkt.payload.length == 80 && hostPriv != null) {
            final cliPub = Uint8List.sublistView(pkt.payload, 0, 32);
            final cliN1 = Uint8List.sublistView(pkt.payload, 32, 48);
            final shared = ce.X25519.scalarMult(hostPriv!, cliPub);
            final salt = Uint8List(32)
              ..setRange(0, 16, cliN1)
              ..setRange(16, 32, hostN2!);
            kRx = ce.hkdfExpandAndExtract(
              salt,
              shared,
              Uint8List.fromList(utf8.encode(ce.kCtxClientTx)),
              ce.kKeySize,
            );
            kTx = ce.hkdfExpandAndExtract(
              salt,
              shared,
              Uint8List.fromList(utf8.encode(ce.kCtxHostTx)),
              ce.kKeySize,
            );
            vault = true;
            send(packPacket(BinaryOpcode.auth, utf8.encode('OK_ECDH_VAULT'), seq: 4));
            // Push initial display list & sample JPEG frame
            send(encrypt(
              BinaryOpcode.displayEnum,
              Uint8List.fromList(utf8.encode(jsonEncode({
                'active': 2,
                'monitors': [
                  {'index': 1, 'width': 1920, 'height': 1080},
                  {'index': 2, 'width': 2560, 'height': 1440},
                ],
              }))),
            ));
            send(encrypt(BinaryOpcode.frame, base64Decode(_kTinyJpegBase64)));
          }
          return;
        }

        if ((pkt.flags & ProtocolFlags.encrypted) == 0 ||
            pkt.payload.length < ce.kNonceSize + ce.kTagSize) {
          return;
        }
        final plain = ce.ChaCha20Poly1305.decrypt(
          kRx!,
          Uint8List.sublistView(pkt.payload, 0, ce.kNonceSize),
          Uint8List.sublistView(pkt.payload, ce.kNonceSize),
          aad: Uint8List.sublistView(raw, 0, kHeaderSize),
        );
        if (plain == null) return;
        if (!_rxCtrl.isClosed) {
          _rxCtrl.add(_QolDecryptedFrame(pkt.opcode, plain));
        }
        if (pkt.opcode == BinaryOpcode.ping) {
          send(encrypt(BinaryOpcode.ping, Uint8List(0), seq: pkt.seq));
        }
      },
      onDone: () => _sockets.remove(ws),
      onError: (_) => _sockets.remove(ws),
    );
  }

  Future<void> close() async {
    for (final ws in List<WebSocket>.from(_sockets)) {
      try {
        await ws.close();
      } catch (_) {}
    }
    _sockets.clear();
    await _rxCtrl.close();
    await _server.close(force: true);
  }
}

void main() {
  group('RemoteKeyboardBar QOL — Sticky Modifiers, Macros, Clipboard & Contrast', () {
    testWidgets('supports 1-shot modifier latch, persistent long-press lock, live char combos, macros, and clipboard triggers', (tester) async {
      final typed = <(String, bool)>[];
      final keys = <String>[];
      final hotkeys = <List<String>>[];
      int pushClipCount = 0;
      int pullClipCount = 0;

      await tester.pumpWidget(
        MaterialApp(
          theme: CyberTheme.fromPalette(
            CyberPalette.fromPreset(
              CyberAccentPreset.cyan,
              themeMode: AppThemeMode.dark,
            ),
          ),
          home: Scaffold(
            body: Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: RemoteKeyboardBar(
                  autofocus: false,
                  hapticsEnabled: false,
                  onTypeText: (t, {bool pressEnter = false}) =>
                      typed.add((t, pressEnter)),
                  onKey: keys.add,
                  onHotkey: hotkeys.add,
                  onPushClipboard: () => pushClipCount++,
                  onPullClipboard: () => pullClipCount++,
                  onClose: () {},
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // 1. Tap CTRL (1-shot latch) -> banner appears -> tap TAB sends ['ctrl', 'tab'] and releases
      await tester.tap(find.byKey(const ValueKey('remote-mod-ctrl')));
      await tester.pump();
      expect(find.textContaining('CTRL + … (1-shot)'), findsOneWidget);

      await tester.tap(find.text('TAB'));
      await tester.pump();
      expect(hotkeys.last, equals(['ctrl', 'tab']));
      expect(find.byKey(const ValueKey('remote-keyboard-clear-mods')), findsNothing);

      // 2. Latch CTRL + SHIFT + live-type 'p' -> sends ['ctrl', 'shift', 'p'] and clears input
      await tester.tap(find.byKey(const ValueKey('remote-mod-ctrl')));
      await tester.tap(find.byKey(const ValueKey('remote-mod-shift')));
      await tester.pump();
      expect(find.textContaining('CTRL + SHIFT + …'), findsOneWidget);

      final input = find.byKey(const ValueKey('remote-keyboard-input'));
      await tester.enterText(input, 'p');
      await tester.pump();
      expect(hotkeys.last, equals(['ctrl', 'shift', 'p']));
      expect(typed, isEmpty);
      expect(tester.widget<TextField>(input).controller?.text, isEmpty);
      expect(find.byKey(const ValueKey('remote-keyboard-clear-mods')), findsNothing);

      // 3. Long-press ALT -> persistent lock stays active across multiple keys until CLEAR
      await tester.longPress(find.byKey(const ValueKey('remote-mod-alt')));
      await tester.pump();
      expect(find.textContaining('ALT + … (Locked)'), findsOneWidget);

      await tester.tap(find.text('TAB'));
      await tester.pump();
      expect(hotkeys.last, equals(['alt', 'tab']));
      // Still locked!
      expect(find.textContaining('ALT + … (Locked)'), findsOneWidget);

      await tester.tap(find.text('ESC'));
      await tester.pump();
      expect(hotkeys.last, equals(['alt', 'esc']));

      await tester.tap(find.byKey(const ValueKey('remote-keyboard-clear-mods')));
      await tester.pump();
      expect(find.byKey(const ValueKey('remote-keyboard-clear-mods')), findsNothing);

      // 4. Expand MACROS strip and invoke REOPEN TAB -> ['ctrl', 'shift', 't']
      final macrosBtn = find.byKey(const ValueKey('remote-keyboard-macros-toggle'));
      await tester.ensureVisible(macrosBtn);
      await tester.pump();
      await tester.tap(macrosBtn);
      await tester.pump();
      final reopenTab = find.text('REOPEN TAB');
      await tester.ensureVisible(reopenTab);
      await tester.pump();
      await tester.tap(reopenTab);
      await tester.pump();
      expect(hotkeys.last, equals(['ctrl', 'shift', 't']));

      // 5. Clipboard Push & Pull buttons
      final pushBtn = find.byKey(const ValueKey('remote-keyboard-clip-push'));
      await tester.ensureVisible(pushBtn);
      await tester.pump();
      await tester.tap(pushBtn);
      final pullBtn = find.byKey(const ValueKey('remote-keyboard-clip-pull'));
      await tester.ensureVisible(pullBtn);
      await tester.pump();
      await tester.tap(pullBtn);
      await tester.pump();
      expect(pushClipCount, equals(1));
      expect(pullClipCount, equals(1));
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders cleanly in Daylight and Dark themes on 280px narrow screen at 1.35x text scale', (tester) async {
      tester.view.physicalSize = const Size(280, 640);
      tester.view.devicePixelRatio = 1.0;
      tester.platformDispatcher.textScaleFactorTestValue = 1.35;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
        tester.platformDispatcher.clearTextScaleFactorTestValue();
      });

      for (final mode in [AppThemeMode.daylight, AppThemeMode.dark]) {
        await tester.pumpWidget(
          MaterialApp(
            theme: CyberTheme.fromPalette(
              CyberPalette.fromPreset(CyberAccentPreset.violet, themeMode: mode),
            ),
            home: Scaffold(
              body: Align(
                alignment: Alignment.bottomCenter,
                child: Padding(
                  padding: const EdgeInsets.all(6),
                  child: RemoteKeyboardBar(
                    autofocus: false,
                    hapticsEnabled: false,
                    onTypeText: (_, {bool pressEnter = false}) {},
                    onKey: (_) {},
                    onHotkey: (_) {},
                    onPushClipboard: () {},
                    onPullClipboard: () {},
                    onClose: () {},
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }
    });
  });

  group('TouchCoordinateMapper & TouchFeedbackOverlay Hardening', () {
    test('handles non-finite focal points, invalid clamp bounds, and singular transforms safely', () {
      const container = Size(400, 300);

      final nanFocal = TouchCoordinateMapper.computeZoomPanMatrix(
        currentTransform: Matrix4.identity(),
        targetScale: 2.0,
        previousFocalPoint: const Offset(double.nan, double.infinity),
        currentFocalPoint: const Offset(double.negativeInfinity, double.nan),
        containerSize: container,
      );
      expect(TouchCoordinateMapper.extractScale(nanFocal), closeTo(2.0, 1e-6));
      expect(nanFocal.storage[12].isFinite, isTrue);
      expect(nanFocal.storage[13].isFinite, isTrue);

      // Invalid clamp bounds (minScale <= 0, maxScale < minScale) must never throw
      final clamped = TouchCoordinateMapper.clampZoomTransform(
        transform: nanFocal,
        containerSize: container,
        minScale: -2.0,
        maxScale: 0.5,
      );
      expect(clamped.isIdentity(), isTrue);

      final nanTransform = Matrix4.identity()..storage[12] = double.nan;
      final pt = TouchCoordinateMapper.normalizedToViewport(
        normalized: const Offset(0.5, 0.5),
        containerSize: container,
        frameSize: const Size(1920, 1080),
        transform: nanTransform,
      );
      expect(pt.dx.isFinite, isTrue);
      expect(pt.dy.isFinite, isTrue);
    });

    test('TouchFeedbackController safely ignores calls after dispose', () {
      final ctrl = TouchFeedbackController();
      ctrl.triggerRipple(const Offset(10, 20));
      ctrl.updateCursor(const Offset(10, 20), isDragging: true);
      ctrl.dispose();

      expect(() => ctrl.triggerRipple(const Offset(30, 40)), returnsNormally);
      expect(() => ctrl.updateCursor(const Offset(30, 40)), returnsNormally);
      expect(() => ctrl.clearCursor(), returnsNormally);
      expect(() => ctrl.startLongPress(const Offset(30, 40)), returnsNormally);
      expect(() => ctrl.cancelLongPress(), returnsNormally);
      expect(() => ctrl.completeLongPress(const Offset(30, 40)), returnsNormally);
      expect(() => ctrl.clearAll(), returnsNormally);
    });
  });

  group('FullscreenStreamPage & ViewportStreamWidget QOL', () {
    testWidgets('re-asserts immersiveSticky on resume, toggles HUD on 3-finger tap, handles close-finger pinch, and renders Daylight glass status card with no duplicate spinner', (tester) async {
      final platformCalls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        platformCalls.add(call);
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
          home: const FullscreenStreamPage(
            hostIp: '127.0.0.1',
            hostName: 'Daylight-PC',
            sharedSecret: '',
            autoLandscape: true,
          ),
        ),
      );
      await tester.pump();

      // Status card is wrapped in high-contrast Liquid Glass container, and
      // ZeroGcVideoRenderer does NOT stack a ghost spinner behind the error overlay.
      expect(find.byKey(const ValueKey('viewport-status-card')), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      // App resume re-enforces immersiveSticky + landscape orientation
      platformCalls.clear();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(
        platformCalls.any(
          (c) =>
              c.method == 'SystemChrome.setEnabledSystemUIMode' &&
              c.arguments == 'SystemUiMode.immersiveSticky',
        ),
        isTrue,
      );

      // 3-finger quick tap collapses HUD -> reveals restore pill -> 3-finger tap restores HUD
      final surfaceTopLeft = tester.getTopLeft(
        find.byKey(const ValueKey('viewport-touch-surface')),
      );
      final f1 = await tester.startGesture(surfaceTopLeft + const Offset(60, 220));
      final f2 = await tester.startGesture(surfaceTopLeft + const Offset(100, 220));
      final f3 = await tester.startGesture(surfaceTopLeft + const Offset(140, 220));
      await tester.pump(const Duration(milliseconds: 40));
      await f1.up();
      await f2.up();
      await f3.up();
      await tester.pump();
      expect(find.byKey(const ValueKey('viewport-hud-restore-pill')), findsOneWidget);

      final r1 = await tester.startGesture(surfaceTopLeft + const Offset(60, 220));
      final r2 = await tester.startGesture(surfaceTopLeft + const Offset(100, 220));
      final r3 = await tester.startGesture(surfaceTopLeft + const Offset(140, 220));
      await tester.pump(const Duration(milliseconds: 40));
      await r1.up();
      await r2.up();
      await r3.up();
      await tester.pump();
      expect(find.byKey(const ValueKey('viewport-rotate-btn')), findsOneWidget);

      // Close-finger pinch start (< 12px apart initially) still zooms smoothly
      final p1 = await tester.startGesture(surfaceTopLeft + const Offset(120, 260));
      final p2 = await tester.startGesture(surfaceTopLeft + const Offset(126, 260));
      await tester.pump();
      await p1.moveBy(const Offset(-10, 0));
      await p2.moveBy(const Offset(10, 0));
      await tester.pump();
      await p1.moveBy(const Offset(-45, 0));
      await p2.moveBy(const Offset(45, 0));
      await tester.pump();
      await p1.up();
      await p2.up();
      await tester.pump();

      expect(find.byKey(const ValueKey('viewport-zoom-reset-pill')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('viewport-zoom-reset-pill')));
      await tester.pump();
      expect(find.byKey(const ValueKey('viewport-zoom-reset-pill')), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('live dock FPS toggle cycles 30->60->15, negotiates OP_VIEWPORT_RESIZE, and hydrates pooled lastMonitors', (tester) async {
      final prevOverrides = HttpOverrides.current;
      HttpOverrides.global = null;
      late _QolMockHost host;
      await tester.runAsync(() async {
        host = await _QolMockHost.start();
      });

      final vpConfigs = <Map<String, dynamic>>[];
      final rxSub = host.received.listen((f) {
        if (f.opcode == BinaryOpcode.viewportResize) {
          vpConfigs.add(
            jsonDecode(utf8.decode(f.payload)) as Map<String, dynamic>,
          );
        }
      });

      addTearDown(() async {
        await rxSub.cancel();
        HostConnectionPool.instance.disposeAll();
        await host.close();
        HttpOverrides.global = prevOverrides;
      });

      final fpsChanges = <int>[];

      await tester.runAsync(() async {
        await tester.pumpWidget(
          MaterialApp(
            theme: CyberTheme.themeData,
            home: Scaffold(
              body: SizedBox(
                width: 640,
                height: 360,
                child: ViewportStreamWidget(
                  hostIp: '127.0.0.1',
                  hostName: 'QOL-Host',
                  wsPort: host.port,
                  sharedSecret: host.psk,
                  targetFps: 30,
                  hapticsEnabled: false,
                  onTargetFpsChanged: fpsChanges.add,
                ),
              ),
            ),
          ),
        );

        final deadline = DateTime.now().add(const Duration(seconds: 4));
        while ((find.byKey(const ValueKey('viewport-fps-btn')).evaluate().isEmpty ||
                find.text('MON 2').evaluate().isEmpty) &&
            DateTime.now().isBefore(deadline)) {
          await Future<void>.delayed(const Duration(milliseconds: 30));
          await tester.pump();
        }
      });
      await tester.pump();

      expect(find.text('FPS:30'), findsOneWidget);
      expect(find.text('MON 2'), findsOneWidget);

      // Verify HostConnectionClient cached lastMonitors
      final pooled = HostConnectionPool.instance.acquire(
        hostIp: '127.0.0.1',
        port: host.port,
        sharedSecret: host.psk,
      );
      expect(pooled.lastMonitors.length, equals(2));
      expect(pooled.activeMonitorIndex, equals(2));

      // Tap FPS toggle -> cycles 30 -> 60 -> 15 and negotiates viewport FPS
      final fpsBtn = find.byKey(const ValueKey('viewport-fps-btn'));
      await tester.ensureVisible(fpsBtn);
      await tester.pump();
      await tester.tap(fpsBtn);
      await tester.pump();
      expect(find.text('FPS:60'), findsOneWidget);

      await tester.tap(fpsBtn);
      await tester.pump();
      expect(find.text('FPS:15'), findsOneWidget);
      expect(fpsChanges, equals([60, 15]));

      await tester.runAsync(() async {
        final deadline = DateTime.now().add(const Duration(seconds: 2));
        while (!vpConfigs.any((m) => m['fps'] == 15) &&
            DateTime.now().isBefore(deadline)) {
          await Future<void>.delayed(const Duration(milliseconds: 25));
        }
      });
      expect(vpConfigs.any((m) => m['fps'] == 60), isTrue);
      expect(vpConfigs.any((m) => m['fps'] == 15), isTrue);
      expect(tester.takeException(), isNull);
    });
  });

  group('PipStreamViewer & Service Hardening', () {
    testWidgets('PipStreamViewer displays monitor resolution badge and respects reduced motion in Daylight & Dark themes', (tester) async {
      final jpegBytes = base64Decode(_kTinyJpegBase64);
      const monitors = [
        MonitorDisplay(index: 1, width: 1920, height: 1080, label: 'Primary'),
        MonitorDisplay(index: 2, width: 2560, height: 1440, label: 'Ultrawide'),
      ];

      for (final mode in [AppThemeMode.daylight, AppThemeMode.dark]) {
        await tester.pumpWidget(
          MaterialApp(
            theme: CyberTheme.fromPalette(
              CyberPalette.fromPreset(CyberAccentPreset.cobalt, themeMode: mode),
            ),
            home: MediaQuery(
              data: const MediaQueryData(disableAnimations: true),
              child: PipStreamViewer(
                frameData: jpegBytes,
                monitors: monitors,
                selectedMonitorIndex: 2,
              ),
            ),
          ),
        );
        await tester.pump();
        expect(find.textContaining('Display 2 · 2560×1440'), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
    });

    test('ThermalGovernor preserves low-battery status message across thermal updates and supports ThermalConfig equality', () {
      final gov = ThermalGovernor.instance;
      addTearDown(() {
        gov.updateBatteryState(percentage: 100, isCharging: false);
        gov.forceProfile(ThermalProfile.nominal);
      });

      expect(ThermalConfig.nominal == ThermalConfig.nominal, isTrue);
      expect(ThermalConfig.lowBattery == ThermalConfig.critical, isFalse);

      gov.updateBatteryState(percentage: 12, isCharging: false);
      expect(gov.isLowBatteryOverride, isTrue);
      expect(gov.currentConfig, equals(ThermalConfig.lowBattery));
      expect(gov.statusMessage, startsWith('Low Battery'));

      // Incoming thermal update while still in low battery must NOT clobber message
      gov.updateThermalState(2);
      expect(gov.profile, equals(ThermalProfile.fair));
      expect(gov.currentConfig, equals(ThermalConfig.lowBattery));
      expect(gov.statusMessage, startsWith('Low Battery'));

      // Plugging charger restores thermal profile status message
      gov.updateBatteryState(percentage: 12, isCharging: true);
      expect(gov.isLowBatteryOverride, isFalse);
      expect(gov.currentConfig, equals(ThermalConfig.fair));
      expect(gov.statusMessage, startsWith('Fair:'));
    });

    test('FileTransferEngine.cancel wakes FINISH ACK wait immediately and sends ABORT', () async {
      final tmpDir = Directory.systemTemp.createTempSync('qol_xfer_');
      final testFile = File('${tmpDir.path}${Platform.pathSeparator}sample.bin');
      await testFile.writeAsBytes(List<int>.generate(128, (i) => i & 0xFF));
      addTearDown(() {
        if (tmpDir.existsSync()) tmpDir.deleteSync(recursive: true);
      });

      final engine = FileTransferEngine();
      final ackCtrl = StreamController<ProtocolPacket>.broadcast();
      addTearDown(ackCtrl.close);
      final sentSubCmds = <int>[];
      int? observedTransferId;

      final sw = Stopwatch()..start();
      final states = <TransferState>[];

      await for (final prog in engine.sendFile(
        file: testFile,
        ackStream: ackCtrl.stream,
        sendPacket: (raw) {
          final pkt = parsePacket(raw);
          if (pkt == null || pkt.payload.isEmpty) return;
          final int subCmd = pkt.payload[0];
          sentSubCmds.add(subCmd);
          if (subCmd == kFileCmdInit && pkt.payload.length >= 5) {
            observedTransferId =
                ByteData.sublistView(pkt.payload).getUint32(1, Endian.big);
            // Emit non-terminal progress ACK so engine waits for FINISH ACK
            final ackPayload = Uint8List(13);
            ByteData.sublistView(ackPayload)
              ..setUint32(0, observedTransferId!, Endian.big)
              ..setUint8(4, kFileStatusProgress);
            ackCtrl.add(ProtocolPacket(
              opcode: BinaryOpcode.fileTransfer,
              flags: 0,
              seq: 1,
              payload: ackPayload,
            ));
          } else if (subCmd == kFileCmdFinish) {
            // Cancel shortly after FINISH -> must abort immediately (< 2s, not 10s!)
            Timer(const Duration(milliseconds: 50), engine.cancel);
          }
        },
      )) {
        states.add(prog.state);
      }
      sw.stop();

      expect(states.last, equals(TransferState.cancelled));
      expect(sentSubCmds, contains(kFileCmdAbort));
      expect(sw.elapsedMilliseconds, lessThan(2000));
    });

    testWidgets('FileTransferProgressDialog displays error message banner, hashing state, and formatted ETA', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: CyberTheme.themeData,
          home: Scaffold(
            body: FileTransferProgressDialog(
              progress: const TransferProgress(
                transferId: 1,
                filename: 'release.zip',
                totalBytes: 1000,
                bytesSent: 500,
                speedBytesPerSec: 2 * 1024 * 1024,
                eta: Duration(seconds: 135),
                state: TransferState.transferring,
              ),
              onCancel: () {},
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('ETA: 2m 15s'), findsOneWidget);
      expect(find.text('2.0 MB/s'), findsOneWidget);

      await tester.pumpWidget(
        MaterialApp(
          theme: CyberTheme.themeData,
          home: Scaffold(
            body: FileTransferProgressDialog(
              progress: const TransferProgress(
                transferId: 1,
                filename: 'release.zip',
                totalBytes: 1000,
                bytesSent: 500,
                speedBytesPerSec: 0,
                eta: Duration.zero,
                state: TransferState.failed,
                errorMessage: 'SHA-256 verification mismatch on host',
              ),
              onCancel: () {},
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('FAILED'), findsOneWidget);
      expect(find.text('SHA-256 verification mismatch on host'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('ZeroGcVideoRenderer showLoadingSpinner=false hides placeholder spinner cleanly', (tester) async {
      final ctrl = StreamController<Uint8List>.broadcast(sync: true);
      addTearDown(ctrl.close);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ZeroGcVideoRenderer(
              frameStream: ctrl.stream,
              showLoadingSpinner: false,
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsNothing);

      // Unmount and emit a late frame on sync broadcast stream -> no crash
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();
      expect(() => ctrl.add(base64Decode(_kTinyJpegBase64)), returnsNormally);
    });

    test('FrameDecryptIsolate sync fallback and dispose leave zero lingering state', () async {
      final key = Uint8List.fromList(List<int>.generate(32, (i) => i + 3));
      final decrypt = FrameDecryptIsolate(recvKey: key, enableIsolate: false);
      await decrypt.ready;
      expect(decrypt.isIsolateReady, isFalse);
      decrypt.dispose();
      expect(decrypt.isDisposed, isTrue);
      // Double dispose is idempotent
      expect(() => decrypt.dispose(), returnsNormally);
    });
  });
}
