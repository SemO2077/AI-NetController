import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:ai_netcontroller/protocol/binary_protocol.dart';
import 'package:ai_netcontroller/security/crypto_engine.dart' as ce;
import 'package:ai_netcontroller/services/app_preferences.dart';
import 'package:ai_netcontroller/services/host_connection_client.dart';
import 'package:ai_netcontroller/services/lan_discovery_service.dart';
import 'package:ai_netcontroller/services/zero_gc_video_pipeline.dart';
import 'package:crypto/crypto.dart' as crypto_pkg;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';

// Tiny valid baseline JPEGs for ZeroGcVideoRenderer frame-size callback tests.
const String _kJpeg16x12Base64 =
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

const String _kJpeg32x18Base64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9'
    'PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhC'
    'Y2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAAR'
    'CAASACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA'
    'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK'
    'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG'
    'h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl'
    '5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA'
    'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk'
    'NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE'
    'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk'
    '5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCGiiivKPogooooAKKKKACiiigD/9k=';

class _DecryptedClientFrame {
  final int opcode;
  final int seq;
  final Uint8List payload;

  const _DecryptedClientFrame({
    required this.opcode,
    required this.seq,
    required this.payload,
  });
}

/// Pure-Dart mock host agent implementing canonical 0xC5 0x71 OP_AUTH,
/// Mutual X25519 ECDH, ChaCha20-Poly1305 AEAD, and encrypted OP_PING echo.
class _MockHostServer {
  final HttpServer _server;
  final String psk;
  bool rejectAuth;
  int connectionCount = 0;

  final List<WebSocket> _activeSockets = <WebSocket>[];
  final StreamController<_DecryptedClientFrame> _receivedCtrl =
      StreamController<_DecryptedClientFrame>.broadcast();

  _MockHostServer._(this._server, this.psk, {this.rejectAuth = false}) {
    _server.listen((HttpRequest req) async {
      if (!WebSocketTransformer.isUpgradeRequest(req)) {
        req.response.statusCode = HttpStatus.badRequest;
        await req.response.close();
        return;
      }
      final ws = await WebSocketTransformer.upgrade(req);
      connectionCount++;
      _activeSockets.add(ws);
      _handleSocket(ws);
    });
  }

  int get port => _server.port;
  Stream<_DecryptedClientFrame> get receivedFrames => _receivedCtrl.stream;

  static Future<_MockHostServer> start({
    String psk = 'alpha_mock_secret_key_99',
    bool rejectAuth = false,
  }) async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    return _MockHostServer._(server, psk, rejectAuth: rejectAuth);
  }

  void _handleSocket(WebSocket ws) {
    final Uint8List authNonce = Uint8List.fromList(
      List<int>.generate(16, (i) => (i * 13 + 7) & 0xFF),
    );
    bool authed = false;
    bool vaultUp = false;
    Uint8List? hostPriv;
    Uint8List? hostPub;
    Uint8List? hostN2;
    Uint8List? kRxFromClient;
    Uint8List? kTxToClient;
    int txSeq = 0;

    Uint8List encryptHostFrame(int opcode, Uint8List plaintext, {int? seq}) {
      txSeq++;
      final int wireLen = ce.kNonceSize + plaintext.length + ce.kTagSize;
      final Uint8List out = Uint8List(kHeaderSize + wireLen);
      out[0] = kMagicByte0;
      out[1] = kMagicByte1;
      out[2] = opcode & 0xFF;
      out[3] = ProtocolFlags.encrypted;
      final bd = ByteData.sublistView(out);
      bd.setUint32(4, (seq ?? txSeq) & 0xFFFFFFFF, Endian.big);
      bd.setUint32(8, wireLen, Endian.big);
      bd.setUint32(12, 0, Endian.big);
      bd.setUint64(16, txSeq, Endian.big);
      final aad = Uint8List.sublistView(out, 0, kHeaderSize);
      final nonce = Uint8List.sublistView(out, 12, 24);
      ce.ChaCha20Poly1305.encryptInto(
        kTxToClient!,
        nonce,
        plaintext,
        out,
        24,
        aad: aad,
      );
      return out;
    }

    void safeSend(Uint8List data) {
      if (ws.readyState != WebSocket.open) return;
      try {
        ws.add(data);
      } catch (_) {}
    }

    // Send initial 16-byte OP_AUTH challenge
    safeSend(packPacket(BinaryOpcode.auth, authNonce, seq: 1));

    ws.listen(
      (dynamic msg) {
        if (msg is! List<int>) return;
        final raw = msg is Uint8List ? msg : Uint8List.fromList(msg);
        final pkt = parsePacket(raw);
        if (pkt == null) return;

        if (!authed) {
          if (pkt.opcode != BinaryOpcode.auth) return;
          final expected = crypto_pkg.Hmac(
            crypto_pkg.sha256,
            utf8.encode(psk),
          ).convert(authNonce).bytes;
          if (rejectAuth ||
              !ce.constantTimeEquals(
                pkt.payload,
                Uint8List.fromList(expected),
              )) {
            safeSend(packPacket(
              BinaryOpcode.auth,
              utf8.encode('ERR_AUTH_REJECTED'),
              seq: 2,
            ));
            unawaited(ws.close().catchError((_) {}));
            return;
          }
          authed = true;
          safeSend(packPacket(
            BinaryOpcode.auth,
            utf8.encode('OK_AUTHENTICATED'),
            seq: 2,
          ));
          return;
        }

        if (!vaultUp) {
          if (pkt.opcode != BinaryOpcode.auth) return;
          final String asText = utf8.decode(pkt.payload, allowMalformed: true);
          if (asText.startsWith('INIT_ECDH_VAULT_M:') &&
              pkt.payload.length == 34) {
            final clientChal = Uint8List.sublistView(pkt.payload, 18, 34);
            hostPriv = ce.X25519.generatePrivateKey();
            hostPub = ce.X25519.publicFromPrivate(hostPriv!);
            hostN2 = Uint8List.fromList(
              List<int>.generate(16, (i) => (i * 5 + 19) & 0xFF),
            );
            final core59 = Uint8List.fromList(<int>[
              ...ce.kMagicBytes,
              ...hostPub!,
              ...hostN2!,
            ]);
            final proofInput = <int>[
              ...utf8.encode('CST_HOST_CHAL_M:'),
              ...clientChal,
              ...core59,
            ];
            final hostMac = crypto_pkg.Hmac(
              crypto_pkg.sha256,
              utf8.encode(psk),
            ).convert(proofInput).bytes;
            final chal91 = Uint8List.fromList(<int>[...core59, ...hostMac]);
            safeSend(packPacket(
              BinaryOpcode.auth,
              chal91,
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
            kRxFromClient = ce.hkdfExpandAndExtract(
              salt,
              shared,
              Uint8List.fromList(utf8.encode(ce.kCtxClientTx)),
              ce.kKeySize,
            );
            kTxToClient = ce.hkdfExpandAndExtract(
              salt,
              shared,
              Uint8List.fromList(utf8.encode(ce.kCtxHostTx)),
              ce.kKeySize,
            );
            vaultUp = true;
            safeSend(packPacket(
              BinaryOpcode.auth,
              utf8.encode('OK_ECDH_VAULT'),
              seq: 4,
            ));
          }
          return;
        }

        // Post-vault AEAD decrypt
        if ((pkt.flags & ProtocolFlags.encrypted) == 0 ||
            pkt.payload.length < ce.kNonceSize + ce.kTagSize) {
          return;
        }
        final aad = Uint8List.sublistView(raw, 0, kHeaderSize);
        final nonce = Uint8List.sublistView(pkt.payload, 0, ce.kNonceSize);
        final ctAndTag = Uint8List.sublistView(pkt.payload, ce.kNonceSize);
        final plain = ce.ChaCha20Poly1305.decrypt(
          kRxFromClient!,
          nonce,
          ctAndTag,
          aad: aad,
        );
        if (plain == null) return;

        if (!_receivedCtrl.isClosed) {
          _receivedCtrl.add(
            _DecryptedClientFrame(
              opcode: pkt.opcode,
              seq: pkt.seq,
              payload: plain,
            ),
          );
        }

        if (pkt.opcode == BinaryOpcode.ping) {
          safeSend(encryptHostFrame(BinaryOpcode.ping, Uint8List(0), seq: pkt.seq));
        }
      },
      onDone: () => _activeSockets.remove(ws),
      onError: (_) => _activeSockets.remove(ws),
    );
  }

  Future<void> dropAllClients() async {
    final copy = List<WebSocket>.from(_activeSockets);
    _activeSockets.clear();
    for (final ws in copy) {
      try {
        await ws.close();
      } catch (_) {}
    }
  }

  Future<void> close() async {
    await dropAllClients();
    await _receivedCtrl.close();
    await _server.close(force: true);
  }
}

Future<void> _cleanupHiveDir(Directory tempDir) async {
  await Future<void>.delayed(const Duration(milliseconds: 40));
  if (Hive.isBoxOpen(kAppPrefsBoxName)) {
    await Hive.box(kAppPrefsBoxName).flush();
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
  TestWidgetsFlutterBinding.ensureInitialized();

  group('Binary Touchscreen & 2D Scroll Packet Encoding (Types 4, 5, 6, 7)', () {
    test('encodeAbsoluteMouseMove produces exact 6-byte !BHHB with clamping & NaN safety', () {
      final origin = HostConnectionClient.encodeAbsoluteMouseMove(0.0, 0.0);
      expect(origin, equals(Uint8List.fromList([4, 0, 0, 0, 0, 0])));

      final corner = HostConnectionClient.encodeAbsoluteMouseMove(1.0, 1.0);
      expect(corner, equals(Uint8List.fromList([4, 0xFF, 0xFF, 0xFF, 0xFF, 0])));

      final mid = HostConnectionClient.encodeAbsoluteMouseMove(0.5, 0.25);
      final bd = ByteData.sublistView(mid);
      expect(mid.length, equals(6));
      expect(bd.getUint8(0), equals(4));
      expect(bd.getUint16(1, Endian.big), equals((0.5 * 65535).round()));
      expect(bd.getUint16(3, Endian.big), equals((0.25 * 65535).round()));
      expect(bd.getUint8(5), equals(0));

      final clamped = HostConnectionClient.encodeAbsoluteMouseMove(-0.25, 1.75);
      final clampedBd = ByteData.sublistView(clamped);
      expect(clampedBd.getUint16(1, Endian.big), equals(0));
      expect(clampedBd.getUint16(3, Endian.big), equals(65535));

      final nonFinite = HostConnectionClient.encodeAbsoluteMouseMove(
        double.nan,
        double.infinity,
      );
      final nfBd = ByteData.sublistView(nonFinite);
      expect(nfBd.getUint16(1, Endian.big), equals(0));
      expect(nfBd.getUint16(3, Endian.big), equals(65535));
    });

    test('encodeAbsoluteMouseClick produces exact 6-byte !BHHB for left/right/middle/double', () {
      for (final code in [1, 2, 3, 4]) {
        final buf = HostConnectionClient.encodeAbsoluteMouseClick(
          0.75,
          0.1,
          buttonCode: code,
        );
        final bd = ByteData.sublistView(buf);
        expect(buf.length, equals(6));
        expect(bd.getUint8(0), equals(5));
        expect(bd.getUint16(1, Endian.big), equals((0.75 * 65535).round()));
        expect(bd.getUint16(3, Endian.big), equals((0.1 * 65535).round()));
        expect(bd.getUint8(5), equals(code));
      }

      // Default buttonCode is 1 (left) and out-of-range codes clamp to 1..4
      expect(
        HostConnectionClient.encodeAbsoluteMouseClick(0.5, 0.5)[5],
        equals(1),
      );
      expect(
        HostConnectionClient.encodeAbsoluteMouseClick(0.5, 0.5, buttonCode: 0)[5],
        equals(1),
      );
      expect(
        HostConnectionClient.encodeAbsoluteMouseClick(0.5, 0.5, buttonCode: 99)[5],
        equals(4),
      );
    });

    test('encodeAbsoluteMouseButton produces exact 6-byte !BHHB for actionCodes 1..6', () {
      for (final actionCode in [1, 2, 3, 4, 5, 6]) {
        final buf = HostConnectionClient.encodeAbsoluteMouseButton(
          0.2,
          0.8,
          actionCode: actionCode,
        );
        final bd = ByteData.sublistView(buf);
        expect(buf.length, equals(6));
        expect(bd.getUint8(0), equals(6));
        expect(bd.getUint16(1, Endian.big), equals((0.2 * 65535).round()));
        expect(bd.getUint16(3, Endian.big), equals((0.8 * 65535).round()));
        expect(bd.getUint8(5), equals(actionCode));
      }

      expect(
        HostConnectionClient.encodeAbsoluteMouseButton(0.5, 0.5, actionCode: -3)[5],
        equals(1),
      );
      expect(
        HostConnectionClient.encodeAbsoluteMouseButton(0.5, 0.5, actionCode: 99)[5],
        equals(6),
      );
    });

    test('encodeScroll2D produces exact 6-byte !BhhB with signed deltas & [-5000, 5000] clamp', () {
      final buf = HostConnectionClient.encodeScroll2D(-180, 320);
      final bd = ByteData.sublistView(buf);
      expect(buf.length, equals(6));
      expect(bd.getUint8(0), equals(7));
      expect(bd.getInt16(1, Endian.big), equals(-180));
      expect(bd.getInt16(3, Endian.big), equals(320));
      expect(bd.getUint8(5), equals(0));

      final clamped = HostConnectionClient.encodeScroll2D(-99999, 99999);
      final clampedBd = ByteData.sublistView(clamped);
      expect(clampedBd.getInt16(1, Endian.big), equals(-5000));
      expect(clampedBd.getInt16(3, Endian.big), equals(5000));
    });
  });

  group('HostConnectionSnapshot, HostConnectionPhase, Backoff & Error Hints', () {
    test('HostConnectionSnapshot preserves backwards-compatible defaults', () {
      const snap = HostConnectionSnapshot();
      expect(snap.isConnecting, isFalse);
      expect(snap.isConnected, isFalse);
      expect(snap.isAuthenticated, isFalse);
      expect(snap.isVaultEstablished, isFalse);
      expect(snap.latencyMs, isNull);
      expect(snap.errorMessage, isNull);
      expect(snap.phase, equals(HostConnectionPhase.disconnected));
      expect(snap.reconnectAttempt, equals(0));
      expect(snap.connectedSince, isNull);
      expect(snap.errorHint, isNull);
      expect(
        HostConnectionPhase.values,
        equals([
          HostConnectionPhase.disconnected,
          HostConnectionPhase.connecting,
          HostConnectionPhase.authenticating,
          HostConnectionPhase.securingVault,
          HostConnectionPhase.connected,
          HostConnectionPhase.reconnecting,
          HostConnectionPhase.authFailed,
        ]),
      );
    });

    test('buildErrorHint produces actionable hints for firewall, auth, TLS, sleep, and geofence', () {
      expect(HostConnectionClient.buildErrorHint(null), isNull);
      expect(HostConnectionClient.buildErrorHint('   '), isNull);

      final missingSecret = HostConnectionClient.buildErrorHint(
        'Pairing secret required before connecting to host.',
      );
      expect(missingSecret, contains('PIN'));

      final authMismatch = HostConnectionClient.buildErrorHint(
        'Auth rejected: ERR_AUTH_REJECTED',
      );
      expect(authMismatch, contains('Pairing secret mismatch'));

      final tlsMismatch = HostConnectionClient.buildErrorHint(
        'HandshakeException: CERTIFICATE_VERIFY_FAILED',
        useTls: true,
      );
      expect(tlsMismatch, contains('TLS certificate mismatch'));

      final refused = HostConnectionClient.buildErrorHint(
        'SocketException: Connection refused (OS Error: errno = 111)',
        port: 9443,
      );
      expect(refused, contains('9443'));
      expect(refused, contains('Firewall'));

      final asleep = HostConnectionClient.buildErrorHint(
        'Vault handshake timed out (192.168.1.50:8765)',
        port: 8765,
      );
      expect(asleep, contains('Wake-on-LAN'));
      expect(asleep, contains('8765'));

      final geofence = HostConnectionClient.buildErrorHint(
        'Geofence rejected remote subnet',
      );
      expect(geofence, contains('subnet'));
    });

    test('computeReconnectDelayMs follows snappy LAN 500ms..8s progression with +/-20% jitter', () {
      expect(HostConnectionClient.computeReconnectDelayMs(0), equals(500));
      expect(HostConnectionClient.computeReconnectDelayMs(1), equals(1000));
      expect(HostConnectionClient.computeReconnectDelayMs(2), equals(2000));
      expect(HostConnectionClient.computeReconnectDelayMs(3), equals(4000));
      expect(HostConnectionClient.computeReconnectDelayMs(4), equals(8000));
      expect(HostConnectionClient.computeReconnectDelayMs(5), equals(8000));
      expect(HostConnectionClient.computeReconnectDelayMs(20), equals(8000));

      expect(
        HostConnectionClient.computeReconnectDelayMs(0, jitterFactor: 0.8),
        equals(400),
      );
      expect(
        HostConnectionClient.computeReconnectDelayMs(0, jitterFactor: 1.2),
        equals(600),
      );
      expect(
        HostConnectionClient.computeReconnectDelayMs(4, jitterFactor: 0.5),
        equals(6400), // jitter clamped at 0.8
      );
      expect(
        HostConnectionClient.computeReconnectDelayMs(4, jitterFactor: 2.0),
        equals(9600), // jitter clamped at 1.2
      );
    });

    test('live client handshake sets pingInterval=5s, phases, immediate RTT ping, binary touch & viewport, and lifecycle recovery', () async {
      final HttpOverrides? prevOverrides = HttpOverrides.current;
      HttpOverrides.global = null;
      final server = await _MockHostServer.start();
      HostConnectionClient? client;
      StreamSubscription<HostConnectionSnapshot>? stateSub;
      StreamSubscription<_DecryptedClientFrame>? rxSub;
      try {
        // Verify openRawWebSocket applies 5-second pingInterval
        final rawWs = await HostConnectionClient.openRawWebSocket(
          Uri(scheme: 'ws', host: '127.0.0.1', port: server.port),
        );
        expect(rawWs.pingInterval, equals(const Duration(seconds: 5)));
        await rawWs.close();

        // Verify probeHostAgent detects our mock OP_AUTH banner
        expect(
          await HostConnectionClient.probeHostAgent('127.0.0.1', port: server.port),
          isTrue,
        );

        client = HostConnectionClient(
          hostIp: '127.0.0.1',
          port: server.port,
          sharedSecret: server.psk,
        );

        final phases = <HostConnectionPhase>[];
        final snapshots = <HostConnectionSnapshot>[];
        stateSub = client.stateStream.listen((snap) {
          snapshots.add(snap);
          if (phases.isEmpty || phases.last != snap.phase) {
            phases.add(snap.phase);
          }
        });

        final received = <_DecryptedClientFrame>[];
        rxSub = server.receivedFrames.listen(received.add);

        await client.ensureConnected(timeout: const Duration(seconds: 5));

        expect(client.isConnected, isTrue);
        expect(client.isAuthenticated, isTrue);
        expect(client.isVaultEstablished, isTrue);
        expect(client.phase, equals(HostConnectionPhase.connected));
        expect(client.connectedSince, isNotNull);
        expect(client.reconnectAttempt, equals(0));
        expect(client.errorMessage, isNull);
        expect(client.errorHint, isNull);
        expect(
          phases,
          containsAllInOrder([
            HostConnectionPhase.connecting,
            HostConnectionPhase.authenticating,
            HostConnectionPhase.securingVault,
            HostConnectionPhase.connected,
          ]),
        );

        // Wait briefly for the immediate post-vault RTT ping reply (< 1s, not 4s!)
        final rttDeadline = DateTime.now().add(const Duration(seconds: 2));
        while (client.latencyMs == null && DateTime.now().isBefore(rttDeadline)) {
          await Future<void>.delayed(const Duration(milliseconds: 25));
        }
        expect(client.latencyMs, isNotNull);
        expect(client.latencyMs!, greaterThanOrEqualTo(0));
        final int pingsBeforeResume =
            received.where((f) => f.opcode == BinaryOpcode.ping).length;
        expect(pingsBeforeResume, greaterThanOrEqualTo(1));

        // notifyAppResumed() while connected sends an immediate liveness ping
        client.notifyAppResumed();
        final resumePingDeadline = DateTime.now().add(const Duration(seconds: 2));
        while (received.where((f) => f.opcode == BinaryOpcode.ping).length <=
                pingsBeforeResume &&
            DateTime.now().isBefore(resumePingDeadline)) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
        }
        expect(
          received.where((f) => f.opcode == BinaryOpcode.ping).length,
          greaterThan(pingsBeforeResume),
        );

        // Dispatch all new binary touch/scroll & viewport methods over encrypted channel
        expect(client.sendAbsoluteMouseMove(0.5, 0.25), isTrue);
        expect(client.sendAbsoluteMouseClick(0.75, 0.5, buttonCode: 4), isTrue);
        expect(client.sendAbsoluteMouseButton(0.25, 0.75, actionCode: 1), isTrue);
        expect(client.sendScroll2D(-120, 240), isTrue);
        expect(
          client.sendViewportConfig(width: 1920, height: 1080, quality: 82, fps: 60),
          isTrue,
        );

        final cmdDeadline = DateTime.now().add(const Duration(seconds: 2));
        while (received.where((f) => f.opcode == BinaryOpcode.input).length < 4 ||
            received.where((f) => f.opcode == BinaryOpcode.viewportResize).isEmpty) {
          if (DateTime.now().isAfter(cmdDeadline)) break;
          await Future<void>.delayed(const Duration(milliseconds: 20));
        }

        final inputFrames =
            received.where((f) => f.opcode == BinaryOpcode.input).toList();
        expect(inputFrames.length, equals(4));
        expect(
          inputFrames[0].payload,
          equals(HostConnectionClient.encodeAbsoluteMouseMove(0.5, 0.25)),
        );
        expect(
          inputFrames[1].payload,
          equals(HostConnectionClient.encodeAbsoluteMouseClick(0.75, 0.5, buttonCode: 4)),
        );
        expect(
          inputFrames[2].payload,
          equals(HostConnectionClient.encodeAbsoluteMouseButton(0.25, 0.75, actionCode: 1)),
        );
        expect(
          inputFrames[3].payload,
          equals(HostConnectionClient.encodeScroll2D(-120, 240)),
        );

        final vpFrame =
            received.lastWhere((f) => f.opcode == BinaryOpcode.viewportResize);
        final vpJson = jsonDecode(utf8.decode(vpFrame.payload)) as Map<String, dynamic>;
        expect(vpJson, equals({'width': 1920, 'height': 1080, 'quality': 82, 'fps': 60}));

        // Drop server socket -> client emits reconnecting with reconnectAttempt >= 1 and auto-recovers
        await server.dropAllClients();
        final dropDeadline = DateTime.now().add(const Duration(seconds: 2));
        while (!snapshots.any((s) =>
                s.phase == HostConnectionPhase.reconnecting &&
                s.reconnectAttempt >= 1) &&
            DateTime.now().isBefore(dropDeadline)) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
        }
        expect(
          snapshots.any((s) =>
              s.phase == HostConnectionPhase.reconnecting &&
              s.reconnectAttempt >= 1 &&
              s.errorHint != null),
          isTrue,
        );

        // Wait for snappy LAN auto-reconnect (~500ms)
        final recoverDeadline = DateTime.now().add(const Duration(seconds: 3));
        while (!client.isVaultEstablished &&
            DateTime.now().isBefore(recoverDeadline)) {
          await Future<void>.delayed(const Duration(milliseconds: 30));
        }
        expect(client.isVaultEstablished, isTrue);
        expect(client.phase, equals(HostConnectionPhase.connected));
        expect(client.reconnectAttempt, equals(0));

        // retain() / release() ref-counting safety
        client.retain();
        client.retain();
        client.release();
        expect(client.isVaultEstablished, isTrue);
        client.release();
        expect(client.phase, equals(HostConnectionPhase.disconnected));
        expect(client.isConnected, isFalse);

        // notifyAppResumed() after manual disconnect must NOT auto-reconnect
        final int connCountAfterDisconnect = server.connectionCount;
        client.notifyAppResumed();
        await Future<void>.delayed(const Duration(milliseconds: 120));
        expect(server.connectionCount, equals(connCountAfterDisconnect));

        // reconnectNow() clears manual disconnect and reconnects immediately
        await client.reconnectNow(timeout: const Duration(seconds: 5));
        expect(client.isVaultEstablished, isTrue);
        expect(client.phase, equals(HostConnectionPhase.connected));
      } finally {
        await rxSub?.cancel();
        await stateSub?.cancel();
        client?.dispose();
        await server.close();
        HttpOverrides.global = prevOverrides;
      }
    });

    test('auth rejection sets HostConnectionPhase.authFailed, populates errorHint, and blocks auto-reconnect until reconnectNow()', () async {
      final HttpOverrides? prevOverrides = HttpOverrides.current;
      HttpOverrides.global = null;
      final server = await _MockHostServer.start(rejectAuth: true);
      HostConnectionClient? client;
      try {
        client = HostConnectionClient(
          hostIp: '127.0.0.1',
          port: server.port,
          sharedSecret: 'wrong_secret',
        );

        await expectLater(
          client.ensureConnected(timeout: const Duration(seconds: 4)),
          throwsA(isA<StateError>()),
        );
        expect(client.phase, equals(HostConnectionPhase.authFailed));
        expect(client.errorHint, contains('Pairing secret mismatch'));

        final int attemptsAfterReject = server.connectionCount;
        client.notifyAppResumed();
        await Future<void>.delayed(const Duration(milliseconds: 150));
        expect(server.connectionCount, equals(attemptsAfterReject));

        // Empty secret also transitions immediately to authFailed
        final emptySecretClient = HostConnectionClient(
          hostIp: '127.0.0.1',
          port: server.port,
          sharedSecret: '   ',
        );
        await expectLater(
          emptySecretClient.ensureConnected(),
          throwsA(isA<StateError>()),
        );
        expect(emptySecretClient.phase, equals(HostConnectionPhase.authFailed));
        expect(emptySecretClient.errorHint, contains('PIN'));
        emptySecretClient.dispose();
      } finally {
        client?.dispose();
        await server.close();
        HttpOverrides.global = prevOverrides;
      }
    });
  });

  group('LanDiscoveryService & DiscoveredLanHost', () {
    test('parseDiscoveryPayload validates CST_DISCOVER_V1, trusts sourceIp, and rejects malformed inputs', () {
      final validJson = jsonEncode({
        'protocol': 'CST_DISCOVER_V1',
        'hostname': 'Studio-Workstation',
        'ws_port': 9443,
        'tls': true,
        'os': 'Windows 11',
        'version': '0.85.0-alpha',
        'ip': '10.99.99.99', // spoofed field must be ignored
      });
      final host = LanDiscoveryService.parseDiscoveryPayload(
        validJson,
        '192.168.1.42',
      );
      expect(host, isNotNull);
      expect(host!.ip, equals('192.168.1.42'));
      expect(host.hostname, equals('Studio-Workstation'));
      expect(host.wsPort, equals(9443));
      expect(host.useTls, isTrue);
      expect(host.os, equals('Windows 11'));
      expect(host.version, equals('0.85.0-alpha'));

      // Defaults when optional fields omitted & control chars stripped
      final minimal = LanDiscoveryService.parseDiscoveryPayload(
        jsonEncode({
          'protocol': 'CST_DISCOVER_V1',
          'hostname': '  Dev\nBox\t ',
        }),
        '10.0.0.7',
      );
      expect(minimal, isNotNull);
      expect(minimal!.ip, equals('10.0.0.7'));
      expect(minimal.hostname, equals('DevBox'));
      expect(minimal.wsPort, equals(8765));
      expect(minimal.useTls, isFalse);
      expect(minimal.os, equals('Unknown'));
      expect(minimal.version, equals(''));

      // Rejections
      expect(
        LanDiscoveryService.parseDiscoveryPayload(
          jsonEncode({'protocol': 'WRONG_PROTO', 'hostname': 'PC'}),
          '192.168.1.10',
        ),
        isNull,
      );
      expect(
        LanDiscoveryService.parseDiscoveryPayload('not-json', '192.168.1.10'),
        isNull,
      );
      expect(
        LanDiscoveryService.parseDiscoveryPayload(
          jsonEncode({'protocol': 'CST_DISCOVER_V1', 'ws_port': 70000}),
          '192.168.1.10',
        ),
        isNull,
      );
      expect(
        LanDiscoveryService.parseDiscoveryPayload(
          jsonEncode({'protocol': 'CST_DISCOVER_V1', 'ws_port': 0}),
          '192.168.1.10',
        ),
        isNull,
      );
      expect(
        LanDiscoveryService.parseDiscoveryPayload(validJson, 'not-an-ip'),
        isNull,
      );
      expect(
        LanDiscoveryService.parseDiscoveryPayload('x' * 5000, '192.168.1.10'),
        isNull,
      );
    });

    test('deriveBroadcastTargets produces deduplicated /24 directed broadcasts', () {
      final targets = LanDiscoveryService.deriveBroadcastTargets([
        '192.168.1.15',
        '192.168.1.99',
        '10.20.30.40',
        '127.0.0.1',
        '0.0.0.0',
        'invalid',
      ]);
      expect(targets, contains('255.255.255.255'));
      expect(targets, contains('192.168.1.255'));
      expect(targets, contains('10.20.30.255'));
      expect(targets, isNot(contains('127.0.0.255')));
      expect(targets.length, equals(3));
    });

    test('discover performs real UDP probe/response exchange and deduplicates by IP', () async {
      final responder = await RawDatagramSocket.bind(
        InternetAddress.loopbackIPv4,
        0,
      );
      StreamSubscription<RawSocketEvent>? sub;
      try {
        sub = responder.listen((event) {
          if (event != RawSocketEvent.read) return;
          final d = responder.receive();
          if (d == null) return;
          if (utf8.decode(d.data, allowMalformed: true) == 'CST_DISCOVER_V1') {
            final reply = utf8.encode(jsonEncode({
              'protocol': 'CST_DISCOVER_V1',
              'hostname': 'Alpha-Rig',
              'ws_port': 8765,
              'tls': false,
              'os': 'Windows',
              'version': '0.85.0-alpha',
            }));
            // Reply twice + send junk to verify deduplication & filtering
            responder.send(reply, d.address, d.port);
            responder.send(reply, d.address, d.port);
            responder.send(utf8.encode('JUNK'), d.address, d.port);
          }
        });

        final found = await LanDiscoveryService.discover(
          udpPort: responder.port,
          timeout: const Duration(milliseconds: 250),
          targetAddressesOverride: [InternetAddress.loopbackIPv4],
        );
        expect(found.length, equals(1));
        expect(found.single.ip, equals('127.0.0.1'));
        expect(found.single.hostname, equals('Alpha-Rig'));
        expect(found.single.wsPort, equals(8765));
        expect(found.single.useTls, isFalse);
        expect(found.single.os, equals('Windows'));
        expect(found.single.version, equals('0.85.0-alpha'));

        // Invalid port returns empty list gracefully
        expect(await LanDiscoveryService.discover(udpPort: 0), isEmpty);
      } finally {
        await sub?.cancel();
        responder.close();
      }
    });
  });

  group('ZeroGcVideoRenderer Frame Size Callback', () {
    testWidgets('invokes onFrameSizeChanged only when decoded dimensions change and updates lastFrameSize', (tester) async {
      final frameCtrl = StreamController<Uint8List>.broadcast(sync: true);
      final key = GlobalKey<ZeroGcVideoRendererState>();
      final reported = <Size>[];
      final jpeg16x12 = base64Decode(_kJpeg16x12Base64);
      final jpeg32x18 = base64Decode(_kJpeg32x18Base64);

      addTearDown(frameCtrl.close);

      await tester.runAsync(() async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SizedBox(
                width: 320,
                height: 180,
                child: ZeroGcVideoRenderer(
                  key: key,
                  frameStream: frameCtrl.stream,
                  onFrameSizeChanged: reported.add,
                ),
              ),
            ),
          ),
        );

        expect(key.currentState?.lastFrameSize, isNull);
        expect(reported, isEmpty);

        // First 16x12 frame -> notifies once
        frameCtrl.add(jpeg16x12);
        final d1 = DateTime.now().add(const Duration(seconds: 3));
        while (reported.isEmpty && DateTime.now().isBefore(d1)) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }

        // Duplicate 16x12 frame -> must NOT re-fire callback
        frameCtrl.add(jpeg16x12);
        await Future<void>.delayed(const Duration(milliseconds: 80));
        await tester.pump();

        // New 32x18 frame -> notifies with updated dimensions
        frameCtrl.add(jpeg32x18);
        final d2 = DateTime.now().add(const Duration(seconds: 3));
        while (reported.length < 2 && DateTime.now().isBefore(d2)) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }
      });
      await tester.pump();

      expect(reported, equals(const [Size(16, 12), Size(32, 18)]));
      expect(key.currentState?.lastFrameSize, equals(const Size(32, 18)));
    });
  });

  group('AppPreferences New Alpha Control & Stream Preferences', () {
    late Directory tempDir;

    setUp(() {
      tempDir = Directory.systemTemp.createTempSync('ai_net_alpha_prefs_');
      Hive.init(tempDir.path);
    });

    tearDown(() => _cleanupHiveDir(tempDir));

    test('exposes exact alpha defaults and persists all 5 new preferences across restarts', () async {
      final box = await Hive.openBox(kAppPrefsBoxName);
      final notifier = AppPreferencesNotifier(boxOverride: box);

      // Verify exact defaults
      expect(notifier.state.defaultInputMode, equals(RemoteInputMode.touchscreen));
      expect(notifier.state.fullscreenAutoLandscape, isTrue);
      expect(notifier.state.touchVisualFeedback, isTrue);
      expect(notifier.state.streamQualityPreset, equals('auto'));
      expect(notifier.state.trackpadSensitivity, closeTo(1.6, 1e-9));

      // Mutate via all 5 new setters
      await notifier.setDefaultInputMode(RemoteInputMode.trackpad);
      await notifier.setFullscreenAutoLandscape(false);
      await notifier.setTouchVisualFeedback(false);
      await notifier.setStreamQualityPreset('crisp');
      await notifier.setTrackpadSensitivity(2.4);

      // Simulate cold restart
      await box.close();
      final reopened = await Hive.openBox(kAppPrefsBoxName);
      final restored = AppPreferencesNotifier(boxOverride: reopened).state;

      expect(restored.defaultInputMode, equals(RemoteInputMode.trackpad));
      expect(restored.fullscreenAutoLandscape, isFalse);
      expect(restored.touchVisualFeedback, isFalse);
      expect(restored.streamQualityPreset, equals('crisp'));
      expect(restored.trackpadSensitivity, closeTo(2.4, 1e-9));
    });

    test('validates streamQualityPreset, clamps trackpadSensitivity, recovers corrupt Hive values, and resets defaults', () async {
      final box = await Hive.openBox(kAppPrefsBoxName);
      final notifier = AppPreferencesNotifier(boxOverride: box);

      for (final valid in ['auto', 'low', 'balanced', 'crisp']) {
        await notifier.setStreamQualityPreset(valid.toUpperCase());
        expect(notifier.state.streamQualityPreset, equals(valid));
      }
      await notifier.setStreamQualityPreset('ultra_invalid');
      expect(notifier.state.streamQualityPreset, equals('auto'));

      await notifier.setTrackpadSensitivity(0.1);
      expect(notifier.state.trackpadSensitivity, closeTo(0.6, 1e-9));
      await notifier.setTrackpadSensitivity(9.5);
      expect(notifier.state.trackpadSensitivity, closeTo(3.0, 1e-9));
      await notifier.setTrackpadSensitivity(double.nan);
      expect(notifier.state.trackpadSensitivity, closeTo(1.6, 1e-9));
      await notifier.setTrackpadSensitivity(double.negativeInfinity);
      expect(notifier.state.trackpadSensitivity, closeTo(0.6, 1e-9));
      await notifier.setTrackpadSensitivity(double.infinity);
      expect(notifier.state.trackpadSensitivity, closeTo(3.0, 1e-9));

      // resetDefaults restores and persists all 5 fields
      await notifier.setDefaultInputMode(RemoteInputMode.trackpad);
      await notifier.setFullscreenAutoLandscape(false);
      await notifier.setTouchVisualFeedback(false);
      await notifier.setStreamQualityPreset('low');
      await notifier.setTrackpadSensitivity(2.8);
      await notifier.resetDefaults();

      await box.close();
      final afterResetBox = await Hive.openBox(kAppPrefsBoxName);
      final afterReset = AppPreferencesNotifier(boxOverride: afterResetBox).state;
      expect(afterReset.defaultInputMode, equals(RemoteInputMode.touchscreen));
      expect(afterReset.fullscreenAutoLandscape, isTrue);
      expect(afterReset.touchVisualFeedback, isTrue);
      expect(afterReset.streamQualityPreset, equals('auto'));
      expect(afterReset.trackpadSensitivity, closeTo(1.6, 1e-9));

      // Corrupt Hive types recover safely without throwing
      await afterResetBox.put('defaultInputMode', 999);
      await afterResetBox.put('fullscreenAutoLandscape', 'yes');
      await afterResetBox.put('touchVisualFeedback', 1);
      await afterResetBox.put('streamQualityPreset', 'broken');
      await afterResetBox.put('trackpadSensitivity', 42.0);
      final recovered = AppPreferencesNotifier(boxOverride: afterResetBox).state;
      expect(recovered.defaultInputMode, equals(RemoteInputMode.touchscreen));
      expect(recovered.fullscreenAutoLandscape, isTrue);
      expect(recovered.touchVisualFeedback, isTrue);
      expect(recovered.streamQualityPreset, equals('auto'));
      expect(recovered.trackpadSensitivity, closeTo(3.0, 1e-9));
    });
  });
}
