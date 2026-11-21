import 'package:ai_netcontroller/theme/fluid_theme.dart';
import 'package:ai_netcontroller/ui/remote_keyboard_bar.dart';
import 'package:ai_netcontroller/ui/responsive_device_card.dart';
import 'package:ai_netcontroller/ui/touch_coordinate_mapper.dart';
import 'package:ai_netcontroller/ui/touch_feedback_overlay.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TouchCoordinateMapper', () {
    test('maps BoxFit.contain letterboxed 16:9 frame inside portrait viewport', () {
      const container = Size(400, 800);
      const frame = Size(1920, 1080);
      // Fitted size: 400 x 225, centered vertically -> top=287.5, bottom=512.5
      final rect = TouchCoordinateMapper.computeVideoRect(
        containerSize: container,
        frameSize: frame,
        fit: BoxFit.contain,
      );
      expect(rect.left, closeTo(0.0, 1e-6));
      expect(rect.top, closeTo(287.5, 1e-6));
      expect(rect.width, closeTo(400.0, 1e-6));
      expect(rect.height, closeTo(225.0, 1e-6));

      final topLeft = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(0, 287.5),
        containerSize: container,
        frameSize: frame,
      );
      expect(topLeft.isInsideVideo, isTrue);
      expect(topLeft.nx, closeTo(0.0, 1e-6));
      expect(topLeft.ny, closeTo(0.0, 1e-6));

      final bottomRight = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(400, 512.5),
        containerSize: container,
        frameSize: frame,
      );
      expect(bottomRight.isInsideVideo, isTrue);
      expect(bottomRight.nx, closeTo(1.0, 1e-6));
      expect(bottomRight.ny, closeTo(1.0, 1e-6));

      final center = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(200, 400),
        containerSize: container,
        frameSize: frame,
      );
      expect(center.isInsideVideo, isTrue);
      expect(center.nx, closeTo(0.5, 1e-6));
      expect(center.ny, closeTo(0.5, 1e-6));

      // Tap in top black letterbox bar -> outside video, ny clamped to 0.0
      final topBar = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(100, 40),
        containerSize: container,
        frameSize: frame,
      );
      expect(topBar.isInsideVideo, isFalse);
      expect(topBar.nx, closeTo(0.25, 1e-6));
      expect(topBar.ny, equals(0.0));

      // Tap in bottom black letterbox bar -> outside video, ny clamped to 1.0
      final bottomBar = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(300, 760),
        containerSize: container,
        frameSize: frame,
      );
      expect(bottomBar.isInsideVideo, isFalse);
      expect(bottomBar.nx, closeTo(0.75, 1e-6));
      expect(bottomBar.ny, equals(1.0));
    });

    test('maps BoxFit.contain pillarboxed frame inside ultra-wide landscape viewport', () {
      const container = Size(900, 400);
      const frame = Size(1000, 1000);
      // Fitted size: 400 x 400, centered horizontally -> left=250, right=650
      final leftBar = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(100, 200),
        containerSize: container,
        frameSize: frame,
      );
      expect(leftBar.isInsideVideo, isFalse);
      expect(leftBar.nx, equals(0.0));
      expect(leftBar.ny, closeTo(0.5, 1e-6));

      final insideQuarter = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(350, 100),
        containerSize: container,
        frameSize: frame,
      );
      expect(insideQuarter.isInsideVideo, isTrue);
      expect(insideQuarter.nx, closeTo(0.25, 1e-6));
      expect(insideQuarter.ny, closeTo(0.25, 1e-6));
    });

    test('maps BoxFit.cover cropped edges accurately to visible PC region', () {
      const container = Size(400, 400);
      const frame = Size(1920, 1080);
      // Center-cropped source region is 1080x1080 starting at x=420..1500
      final leftEdge = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(0, 200),
        containerSize: container,
        frameSize: frame,
        fit: BoxFit.cover,
      );
      expect(leftEdge.isInsideVideo, isTrue);
      expect(leftEdge.nx, closeTo(420.0 / 1920.0, 1e-6));
      expect(leftEdge.ny, closeTo(0.5, 1e-6));

      final rightEdge = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(400, 200),
        containerSize: container,
        frameSize: frame,
        fit: BoxFit.cover,
      );
      expect(rightEdge.isInsideVideo, isTrue);
      expect(rightEdge.nx, closeTo(1500.0 / 1920.0, 1e-6));
      expect(rightEdge.ny, closeTo(0.5, 1e-6));
    });

    test('inverts pinch-zoom & pan Matrix4 accurately and round-trips', () {
      const container = Size(800, 450);
      const frame = Size(2560, 1440);

      // Zoom 2.5x anchored around focal point (600, 300), panned slightly
      final zoomed = TouchCoordinateMapper.computeZoomPanMatrix(
        currentTransform: Matrix4.identity(),
        targetScale: 2.5,
        previousFocalPoint: const Offset(600, 300),
        currentFocalPoint: const Offset(560, 270),
        containerSize: container,
      );
      expect(TouchCoordinateMapper.extractScale(zoomed), closeTo(2.5, 1e-6));

      const testTap = Offset(560, 270);
      final mapped = TouchCoordinateMapper.mapToNormalized(
        localPosition: testTap,
        containerSize: container,
        frameSize: frame,
        fit: BoxFit.contain,
        transform: zoomed,
      );
      // Since (600, 300) was anchored to (560, 270), tapping (560, 270) should hit
      // the exact normalized point of unzoomed (600, 300) = (0.75, 2/3)
      expect(mapped.isInsideVideo, isTrue);
      expect(mapped.nx, closeTo(600.0 / 800.0, 1e-5));
      expect(mapped.ny, closeTo(300.0 / 450.0, 1e-5));

      // Inverse mapping must round-trip right back to testTap
      final backToViewport = TouchCoordinateMapper.normalizedToViewport(
        normalized: mapped.normalized,
        containerSize: container,
        frameSize: frame,
        fit: BoxFit.contain,
        transform: zoomed,
      );
      expect(backToViewport.dx, closeTo(testTap.dx, 1e-4));
      expect(backToViewport.dy, closeTo(testTap.dy, 1e-4));
    });

    test('clamps zoom scale 1x..4x, resets to identity at 1x, and handles degenerate inputs', () {
      const container = Size(400, 300);

      final overZoom = TouchCoordinateMapper.computeZoomPanMatrix(
        currentTransform: Matrix4.identity(),
        targetScale: 9.0,
        previousFocalPoint: const Offset(200, 150),
        currentFocalPoint: const Offset(200, 150),
        containerSize: container,
      );
      expect(TouchCoordinateMapper.extractScale(overZoom), closeTo(4.0, 1e-6));

      final resetZoom = TouchCoordinateMapper.computeZoomPanMatrix(
        currentTransform: overZoom,
        targetScale: 0.5,
        previousFocalPoint: const Offset(200, 150),
        currentFocalPoint: const Offset(200, 150),
        containerSize: container,
      );
      expect(resetZoom.isIdentity(), isTrue);

      // Zero container / frame / singular matrix never throw
      final singular = Matrix4.zero();
      final safeZero = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(100, 100),
        containerSize: Size.zero,
        frameSize: Size.zero,
        transform: singular,
      );
      expect(safeZero.isInsideVideo, isFalse);
      expect(safeZero.nx, equals(0.5));
      expect(safeZero.ny, equals(0.5));

      final fallbackFrame = TouchCoordinateMapper.mapToNormalized(
        localPosition: const Offset(200, 150),
        containerSize: container,
        frameSize: Size.zero,
        transform: singular,
      );
      expect(fallbackFrame.isInsideVideo, isTrue);
      expect(fallbackFrame.nx, closeTo(0.5, 1e-6));
      expect(fallbackFrame.ny, closeTo(0.5, 1e-6));
    });
  });

  group('TouchFeedbackOverlay', () {
    testWidgets('animates ripples, cursor drag glow, long-press ring, and stops ticker cleanly', (tester) async {
      final controller = TouchFeedbackController();
      addTearDown(controller.dispose);

      await tester.pumpWidget(
        MaterialApp(
          theme: CyberTheme.themeData,
          home: Scaffold(
            body: SizedBox(
              width: 320,
              height: 240,
              child: TouchFeedbackOverlay(controller: controller),
            ),
          ),
        ),
      );

      expect(controller.hasActiveVisuals, isFalse);

      controller.triggerRipple(const Offset(100, 100), style: TouchRippleStyle.tap);
      controller.triggerRipple(const Offset(120, 110), style: TouchRippleStyle.doubleTap);
      controller.updateCursor(const Offset(150, 120), isDragging: true);
      controller.startLongPress(
        const Offset(80, 90),
        duration: const Duration(milliseconds: 300),
      );

      expect(controller.activeRippleCount, equals(2));
      expect(controller.isDragging, isTrue);
      expect(controller.isLongPressActive, isTrue);

      await tester.pump(const Duration(milliseconds: 120));
      controller.completeLongPress(const Offset(80, 90));
      expect(controller.isLongPressActive, isFalse);
      expect(controller.activeRippleCount, equals(3));

      controller.clearCursor();
      // Allow ripples & fade-out to expire so ticker stops cleanly
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 550));
      });
      await tester.pump(const Duration(milliseconds: 16));
      await tester.pumpAndSettle();

      expect(controller.hasActiveVisuals, isFalse);
      expect(tester.takeException(), isNull);
    });
  });

  group('RemoteKeyboardBar', () {
    testWidgets('streams live typing, supports batch mode, shortcuts, and F-keys without narrow overflow', (tester) async {
      final typedEvents = <(String, bool)>[];
      final keyEvents = <String>[];
      final hotkeyEvents = <List<String>>[];
      bool closed = false;

      tester.view.physicalSize = const Size(280, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      await tester.pumpWidget(
        MaterialApp(
          theme: CyberTheme.themeData,
          home: Scaffold(
            body: Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: const EdgeInsets.all(6),
                child: RemoteKeyboardBar(
                  autofocus: false,
                  hapticsEnabled: false,
                  onTypeText: (text, {bool pressEnter = false}) =>
                      typedEvents.add((text, pressEnter)),
                  onKey: keyEvents.add,
                  onHotkey: hotkeyEvents.add,
                  onClose: () => closed = true,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      // 1. Live typing diffing + backspace
      final inputFinder = find.byKey(const ValueKey('remote-keyboard-input'));
      await tester.enterText(inputFinder, 'abc');
      expect(typedEvents, equals([('abc', false)]));

      await tester.enterText(inputFinder, 'ab');
      expect(keyEvents, contains('backspace'));

      await tester.testTextInput.receiveAction(TextInputAction.send);
      await tester.pump();
      expect(keyEvents, contains('enter'));

      // 2. Toggle to Batch (TEXT) mode
      await tester.tap(find.byKey(const ValueKey('remote-keyboard-mode-toggle')));
      await tester.pump();
      expect(find.text('TEXT'), findsOneWidget);

      typedEvents.clear();
      await tester.enterText(inputFinder, 'dir');
      expect(typedEvents, isEmpty); // Buffered until Send
      await tester.tap(find.byTooltip('Send Text'));
      await tester.pump();
      expect(typedEvents, equals([('dir', false)]));

      // 3. Shortcut keys + expandable F1-F12
      await tester.tap(find.text('ESC'));
      await tester.ensureVisible(find.text('WIN+D'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('WIN+D'));
      await tester.ensureVisible(find.text('Fn'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Fn'));
      await tester.pump();
      await tester.ensureVisible(find.text('F5'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('F5'));
      await tester.pump();

      expect(keyEvents, containsAll(['esc', 'f5']));
      expect(hotkeyEvents, contains(equals(['win', 'd'])));

      await tester.tap(find.byTooltip('Hide Keyboard Bar'));
      await tester.pump();
      expect(closed, isTrue);
      expect(tester.takeException(), isNull);
    });
  });

  group('ResponsiveDeviceCard', () {
    testWidgets('shows prominent 1-tap Fullscreen Touch Control CTA, latency & TLS pills for online hosts and WoL for sleeping hosts', (tester) async {
      int openFullscreenCount = 0;
      int openStreamCount = 0;
      int wolCount = 0;

      await tester.pumpWidget(
        MaterialApp(
          theme: CyberTheme.themeData,
          home: Scaffold(
            body: ListView(
              padding: const EdgeInsets.all(12),
              children: [
                ResponsiveDeviceCard(
                  id: 'pc-online',
                  name: 'Studio Workstation',
                  ip: '192.168.1.42',
                  mac: 'AA:BB:CC:DD:EE:FF',
                  isOnline: true,
                  cpuUsage: 34,
                  ramUsage: 58,
                  latencyMs: 14,
                  useTls: true,
                  onOpenFullscreen: () => openFullscreenCount++,
                  onOpenStream: () => openStreamCount++,
                ),
                ResponsiveDeviceCard(
                  id: 'pc-fallback',
                  name: 'Legacy Caller Host',
                  ip: '192.168.1.43',
                  mac: 'AA:BB:CC:DD:EE:01',
                  isOnline: true,
                  onOpenStream: () => openStreamCount++,
                ),
                ResponsiveDeviceCard(
                  id: 'pc-offline',
                  name: 'Render Rig',
                  ip: '192.168.1.44',
                  mac: 'AA:BB:CC:DD:EE:02',
                  isOnline: false,
                  onWakeOnLan: () => wolCount++,
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Online'), findsNWidgets(2));
      expect(find.text('14ms'), findsOneWidget);
      expect(find.text('TLS'), findsOneWidget);
      expect(find.text('Fullscreen Touch Control'), findsNWidgets(2));
      expect(find.text('Sleeping'), findsOneWidget);
      expect(find.text('Wake Sleeping PC (WoL)'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('device-card-touch-cta-pc-online')));
      await tester.pump();
      expect(openFullscreenCount, equals(1));

      await tester.tap(find.byKey(const ValueKey('device-card-touch-cta-pc-fallback')));
      await tester.pump();
      expect(openStreamCount, equals(1));

      await tester.tap(find.byKey(const ValueKey('device-card-wol-cta-pc-offline')));
      await tester.pump();
      expect(wolCount, equals(1));
      expect(tester.takeException(), isNull);
    });

    testWidgets('adapts cleanly inside tight grid extents at 1.35x text scale without overflow', (tester) async {
      int tapCount = 0;
      tester.platformDispatcher.textScaleFactorTestValue = 1.35;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      await tester.pumpWidget(
        MaterialApp(
          theme: CyberTheme.fromPalette(
            CyberPalette.fromPreset(
              CyberAccentPreset.cobalt,
              themeMode: AppThemeMode.dark,
            ),
          ),
          home: Scaffold(
            body: Column(
              children: [
                SizedBox(
                  width: 260,
                  height: 150,
                  child: ResponsiveDeviceCard(
                    id: 'tight-online',
                    name: 'UltraLongWorkstationName-01',
                    ip: '192.168.1.100',
                    mac: 'AA:BB:CC:DD:EE:99',
                    isOnline: true,
                    cpuUsage: 91,
                    ramUsage: 88,
                    latencyMs: 95,
                    useTls: true,
                    onOpenStream: () => tapCount++,
                    onMoreActions: () {},
                  ),
                ),
                SizedBox(
                  width: 260,
                  height: 120,
                  child: ResponsiveDeviceCard(
                    id: 'tight-offline',
                    name: 'SleepingNode-02',
                    ip: '192.168.1.101',
                    mac: 'AA:BB:CC:DD:EE:98',
                    isOnline: false,
                    onWakeOnLan: () => tapCount++,
                    onMoreActions: () {},
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('device-card-touch-cta-tight-online')));
      await tester.tap(find.byKey(const ValueKey('device-card-wol-cta-tight-offline')));
      await tester.pump();
      expect(tapCount, equals(2));
      expect(tester.takeException(), isNull);
    });
  });
}
