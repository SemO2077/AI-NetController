import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto_pkg;
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../protocol/binary_protocol.dart';
import '../security/biometric_security_gate.dart';
import '../security/crypto_engine.dart';

/// Result returned by an encrypted X25519 + ChaCha20-Poly1305 PIN pairing exchange.
class PairingResult {
  final String pairingToken;
  final String? certFingerprint;

  const PairingResult({
    required this.pairingToken,
    this.certFingerprint,
  });
}

/// Immutable status snapshot of a persistent host connection.
class HostConnectionSnapshot {
  final bool isConnecting;
  final bool isConnected;
  final bool isAuthenticated;
  final bool isVaultEstablished;
  final int? latencyMs;
  final String? errorMessage;

  const HostConnectionSnapshot({
    this.isConnecting = false,
    this.isConnected = false,
    this.isAuthenticated = false,
    this.isVaultEstablished = false,
    this.latencyMs,
    this.errorMessage,
  });
}

/// Hardened WebSocket + Mutual ECDH + ChaCha20-Poly1305 AEAD transport client
/// communicating with `agent/agent.py` over the canonical 12-byte binary frame
/// protocol (`0xC5 0x71`).
class HostConnectionClient {
  final String hostIp;
  final int port;
  final String sharedSecret;
  final bool useTls;
  final String? certFingerprint;

  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  CryptoEngine? _crypto;
  Timer? _pingTimer;
  Timer? _watchdogTimer;
  Timer? _reconnectTimer;
  Completer<void>? _connectCompleter;
  Future<void> _shellQueue = Future<void>.value();

  bool _disposed = false;
  bool _manualDisconnect = false;
  bool _isConnecting = false;
  bool _isConnected = false;
  bool _isAuthenticated = false;
  bool _isVaultEstablished = false;
  bool _mutualInFlight = false;
  int _controlSeq = 0;
  int _reconnectAttempt = 0;
  int? _latencyMs;
  String? _errorMessage;
  DateTime _lastInboundAt = DateTime.fromMillisecondsSinceEpoch(0);
  int _aeadDecryptErrors = 0;
  int _retainCount = 0;
  final Map<int, Stopwatch> _pendingPings = <int, Stopwatch>{};
  final Random _rnd = Random.secure();

  final StreamController<Uint8List> _frameCtrl =
      StreamController<Uint8List>.broadcast(sync: true);
  final StreamController<Map<String, dynamic>> _telemetryCtrl =
      StreamController<Map<String, dynamic>>.broadcast();
  final StreamController<ShellResult> _shellCtrl =
      StreamController<ShellResult>.broadcast();
  final StreamController<ProtocolPacket> _fileAckCtrl =
      StreamController<ProtocolPacket>.broadcast();
  final StreamController<String> _clipCtrl =
      StreamController<String>.broadcast();
  final StreamController<List<Map<String, dynamic>>> _displayEnumCtrl =
      StreamController<List<Map<String, dynamic>>>.broadcast();
  final StreamController<Map<String, dynamic>> _hitlRawCtrl =
      StreamController<Map<String, dynamic>>.broadcast();
  final StreamController<HostConnectionSnapshot> _stateCtrl =
      StreamController<HostConnectionSnapshot>.broadcast();

  HostConnectionClient({
    required this.hostIp,
    this.port = 8765,
    required this.sharedSecret,
    this.useTls = false,
    this.certFingerprint,
  });

  bool get isConnecting => _isConnecting;
  bool get isConnected => _isConnected;
  bool get isAuthenticated => _isAuthenticated;
  bool get isVaultEstablished => _isVaultEstablished;
  int? get latencyMs => _latencyMs;
  String? get errorMessage => _errorMessage;

  HostConnectionSnapshot get snapshot => HostConnectionSnapshot(
        isConnecting: _isConnecting,
        isConnected: _isConnected,
        isAuthenticated: _isAuthenticated,
        isVaultEstablished: _isVaultEstablished,
        latencyMs: _latencyMs,
        errorMessage: _errorMessage,
      );

  Stream<Uint8List> get frameStream => _frameCtrl.stream;
  Stream<Map<String, dynamic>> get telemetryStream => _telemetryCtrl.stream;
  Stream<ShellResult> get shellResultStream => _shellCtrl.stream;
  Stream<ProtocolPacket> get fileAckStream => _fileAckCtrl.stream;
  Stream<String> get clipboardStream => _clipCtrl.stream;
  Stream<List<Map<String, dynamic>>> get displayEnumStream =>
      _displayEnumCtrl.stream;
  Stream<Map<String, dynamic>> get hitlChallengeStream => _hitlRawCtrl.stream;
  Stream<HostConnectionSnapshot> get stateStream => _stateCtrl.stream;

  void _emitState() {
    if (!_stateCtrl.isClosed) {
      _stateCtrl.add(snapshot);
    }
  }

  int _nextControlSeq() => ++_controlSeq;

  static String _normalizeFp(String raw) =>
      raw.replaceAll(':', '').replaceAll(' ', '').trim().toLowerCase();

  static String _certSha256(X509Certificate cert) =>
      crypto_pkg.sha256.convert(cert.der).toString().toLowerCase();

  static bool _constantTimeHexEq(String a, String b) {
    final ab = utf8.encode(a);
    final bb = utf8.encode(b);
    if (ab.length != bb.length) return false;
    int diff = 0;
    for (int i = 0; i < ab.length; i++) {
      diff |= ab[i] ^ bb[i];
    }
    return diff == 0;
  }

  /// Opens a `ws://` or `wss://` WebSocket with optional SHA-256 certificate pinning.
  static Future<WebSocket> openRawWebSocket(
    Uri uri, {
    String? expectedCertFingerprint,
    void Function(String sha256Hex)? onObservedCertSha256,
    Duration timeout = const Duration(seconds: 6),
  }) async {
    final HttpClient httpClient = HttpClient()..connectionTimeout = timeout;
    final String expectedFp = _normalizeFp(expectedCertFingerprint ?? '');
    if (uri.scheme == 'wss') {
      httpClient.badCertificateCallback =
          (X509Certificate cert, String host, int port) {
        final String actualFp = _certSha256(cert);
        onObservedCertSha256?.call(actualFp);
        if (expectedFp.isNotEmpty) {
          return _constantTimeHexEq(actualFp, expectedFp);
        }
        return false;
      };
    }
    try {
      return await WebSocket.connect(uri.toString(), customClient: httpClient)
          .timeout(timeout);
    } finally {
      httpClient.close();
    }
  }

  /// Probes whether an actual AI NetController daemon (emitting 16B `OP_AUTH`
  /// challenge header `0xC5 0x71 0x06`) is listening on `[ip]:[port]`.
  static Future<bool> probeHostAgent(
    String ip, {
    int port = 8765,
    bool useTls = false,
    Duration timeout = const Duration(milliseconds: 550),
  }) async {
    WebSocket? ws;
    try {
      final HttpClient client = HttpClient()..connectionTimeout = timeout;
      if (useTls) {
        // Discovery probe only verifies the canonical 0xC5 0x71 OP_AUTH banner.
        client.badCertificateCallback = (_, __, ___) => true;
      }
      final uri = Uri(scheme: useTls ? 'wss' : 'ws', host: ip, port: port);
      ws = await WebSocket.connect(uri.toString(), customClient: client)
          .timeout(timeout);
      client.close();
      final dynamic firstMsg = await ws.first.timeout(timeout);
      if (firstMsg is Uint8List || firstMsg is List<int>) {
        final bytes = firstMsg is Uint8List
            ? firstMsg
            : Uint8List.fromList(firstMsg as List<int>);
        final pkt = parsePacket(bytes);
        return pkt != null &&
            pkt.opcode == BinaryOpcode.auth &&
            pkt.payload.length == 16;
      }
      return false;
    } catch (_) {
      return false;
    } finally {
      try {
        await ws?.close();
      } catch (_) {}
    }
  }

  /// Performs X25519 + ChaCha20-Poly1305 encrypted PIN pairing (`PAIR_INIT` ->
  /// `PAIR_CHALLENGE` -> `PAIR_FINISH` -> `PAIR_RESULT`) so neither the 6-digit
  /// PIN nor the provisioned `pairingToken` traverses the network in plaintext.
  static Future<PairingResult?> pairWithHostPin({
    required String ip,
    required String pin,
    int port = 8765,
    bool useTls = false,
    String? expectedCertFingerprint,
    String deviceName = 'AI NetController Mobile',
    Duration timeout = const Duration(seconds: 6),
  }) async {
    final String cleanPin = pin.trim();
    if (cleanPin.isEmpty) return null;

    WebSocket? ws;
    StreamSubscription? sub;
    final Completer<PairingResult?> completer = Completer<PairingResult?>();
    String? observedFp;

    final Uint8List cliPriv = X25519.generatePrivateKey();
    final Uint8List cliPub = X25519.publicFromPrivate(cliPriv);
    final Uint8List cliNonce = Uint8List(kSaltSize);
    final Random rnd = Random.secure();
    for (int i = 0; i < kSaltSize; i++) {
      cliNonce[i] = rnd.nextInt(256);
    }
    Uint8List? pairKey;
    Uint8List? aad;

    try {
      final uri = Uri(scheme: useTls ? 'wss' : 'ws', host: ip, port: port);
      ws = await openRawWebSocket(
        uri,
        expectedCertFingerprint: expectedCertFingerprint,
        onObservedCertSha256: (fp) => observedFp = fp,
        timeout: timeout,
      );

      sub = ws.listen(
        (dynamic message) {
          if (completer.isCompleted || message is! String) return;
          try {
            final dynamic decoded = jsonDecode(message);
            if (decoded is! Map<String, dynamic>) return;
            final String event = (decoded['event'] ?? '').toString();

            if (event == 'PAIR_CHALLENGE') {
              final Uint8List srvPub =
                  base64Decode((decoded['host_pub'] ?? '').toString());
              final Uint8List srvNonce =
                  base64Decode((decoded['host_nonce'] ?? '').toString());
              if (srvPub.length != 32 || srvNonce.length != 16) {
                completer.complete(null);
                return;
              }
              final Uint8List shared = X25519.scalarMult(cliPriv, srvPub);
              int nonZero = 0;
              for (int i = 0; i < shared.length; i++) {
                nonZero |= shared[i];
              }
              if (nonZero == 0) {
                zeroize(shared);
                completer.complete(null);
                return;
              }
              zeroize(cliPriv);

              final Uint8List salt = Uint8List(32);
              salt.setRange(0, 16, cliNonce);
              salt.setRange(16, 32, srvNonce);
              pairKey = hkdfExpandAndExtract(
                salt,
                shared,
                Uint8List.fromList(utf8.encode('CST_PAIR_WRAP_V1')),
                kKeySize,
              );
              zeroize(shared);

              final List<int> prefix = utf8.encode('CST_PAIR_V1');
              final Uint8List aadBuf = Uint8List(
                prefix.length +
                    cliPub.length +
                    srvPub.length +
                    cliNonce.length +
                    srvNonce.length,
              );
              int pos = 0;
              aadBuf.setRange(pos, pos + prefix.length, prefix);
              pos += prefix.length;
              aadBuf.setRange(pos, pos + 32, cliPub);
              pos += 32;
              aadBuf.setRange(pos, pos + 32, srvPub);
              pos += 32;
              aadBuf.setRange(pos, pos + 16, cliNonce);
              pos += 16;
              aadBuf.setRange(pos, pos + 16, srvNonce);
              aad = aadBuf;

              final Uint8List clientNonce = Uint8List(kNonceSize); // 0x00 * 12
              final Uint8List plain = Uint8List.fromList(
                utf8.encode(jsonEncode({'pin': cleanPin, 'device': deviceName})),
              );
              final Uint8List ctAndTag = ChaCha20Poly1305.encrypt(
                pairKey!,
                clientNonce,
                plain,
                aad: aad,
              );
              final Uint8List wrapped = Uint8List(kNonceSize + ctAndTag.length);
              wrapped.setRange(0, kNonceSize, clientNonce);
              wrapped.setRange(kNonceSize, wrapped.length, ctAndTag);

              ws?.add(jsonEncode({
                'action': 'PAIR_FINISH',
                'ciphertext': base64Encode(wrapped),
                'device': deviceName,
              }));
            } else if (event == 'PAIR_RESULT') {
              if (pairKey == null || aad == null) {
                completer.complete(null);
                return;
              }
              final Uint8List rawCt =
                  base64Decode((decoded['ciphertext'] ?? '').toString());
              if (rawCt.length < kNonceSize + kTagSize) {
                completer.complete(null);
                return;
              }
              // Expected host reply nonce: struct.pack(">IQ", 0, 1)
              final Uint8List expectedNonce = Uint8List(kNonceSize);
              ByteData.sublistView(expectedNonce)
                ..setUint32(0, 0, Endian.big)
                ..setUint64(4, 1, Endian.big);
              final Uint8List gotNonce = Uint8List.sublistView(rawCt, 0, kNonceSize);
              if (!constantTimeEquals(gotNonce, expectedNonce)) {
                completer.complete(null);
                return;
              }
              final Uint8List? plain = ChaCha20Poly1305.decrypt(
                pairKey!,
                gotNonce,
                Uint8List.sublistView(rawCt, kNonceSize),
                aad: aad,
              );
              if (plain == null) {
                completer.complete(null);
                return;
              }
              final dynamic resMap = jsonDecode(utf8.decode(plain));
              zeroize(plain);
              if (resMap is Map<String, dynamic> &&
                  resMap['pairingToken'] is String) {
                final tok = (resMap['pairingToken'] as String).trim();
                if (tok.isNotEmpty) {
                  completer.complete(PairingResult(
                    pairingToken: tok,
                    certFingerprint: observedFp ?? expectedCertFingerprint,
                  ));
                  return;
                }
              }
              completer.complete(null);
            } else if (event == 'ERROR') {
              completer.complete(null);
            }
          } catch (_) {
            if (!completer.isCompleted) completer.complete(null);
          }
        },
        onError: (_) {
          if (!completer.isCompleted) completer.complete(null);
        },
        onDone: () {
          if (!completer.isCompleted) completer.complete(null);
        },
      );

      ws.add(jsonEncode({
        'action': 'PAIR_INIT',
        'client_pub': base64Encode(cliPub),
        'client_nonce': base64Encode(cliNonce),
        'device': deviceName,
      }));

      return await completer.future.timeout(timeout, onTimeout: () => null);
    } catch (_) {
      return null;
    } finally {
      zeroize(cliPriv);
      if (pairKey != null) zeroize(pairKey!);
      await sub?.cancel();
      try {
        await ws?.close();
      } catch (_) {}
    }
  }

  /// Ensures an authenticated, AEAD-upgraded session is open with the host.
  Future<void> ensureConnected({Duration timeout = const Duration(seconds: 7)}) async {
    if (_disposed) {
      throw StateError('HostConnectionClient has been disposed');
    }
    if (_isConnected && _isAuthenticated && _isVaultEstablished) {
      return;
    }
    if (_connectCompleter != null && !_connectCompleter!.isCompleted) {
      return _connectCompleter!.future.timeout(timeout);
    }

    _manualDisconnect = false;
    final Completer<void> completer = Completer<void>();
    _connectCompleter = completer;

    final String secret = sharedSecret.trim();
    if (secret.isEmpty) {
      _errorMessage = 'Pairing secret required before connecting to host.';
      _isConnecting = false;
      _emitState();
      if (!completer.isCompleted) {
        completer.completeError(StateError(_errorMessage!));
      }
      return completer.future;
    }

    _cleanupTransportOnly();
    _isConnecting = true;
    _errorMessage = null;
    _emitState();

    try {
      final uri = Uri(scheme: useTls ? 'wss' : 'ws', host: hostIp, port: port);
      final ws = await openRawWebSocket(
        uri,
        expectedCertFingerprint: certFingerprint,
        timeout: timeout,
      );
      if (_disposed) {
        await ws.close();
        if (!completer.isCompleted) completer.completeError(StateError('Disposed'));
        return completer.future;
      }

      _channel = IOWebSocketChannel(ws);
      _lastInboundAt = DateTime.now();

      _subscription = _channel!.stream.listen(
        (dynamic message) => _handleIncoming(message, secret, completer),
        onError: (Object err) {
          _handleDisconnect('Socket connection error: $err', completer);
        },
        onDone: () {
          _handleDisconnect('Connection closed by host.', completer);
        },
      );

      return await completer.future.timeout(
        timeout,
        onTimeout: () {
          _handleDisconnect('Vault handshake timed out ($hostIp:$port)', completer);
          throw TimeoutException('Handshake timeout with $hostIp:$port');
        },
      );
    } catch (e) {
      _isConnecting = false;
      _isConnected = false;
      _isAuthenticated = false;
      _isVaultEstablished = false;
      _errorMessage = 'Failed to connect: $e';
      _emitState();
      _scheduleReconnect();
      if (!completer.isCompleted) completer.completeError(e);
      return completer.future;
    }
  }

  void _handleIncoming(
    dynamic message,
    String secret,
    Completer<void>? connectCompleter,
  ) {
    if (_disposed) return;
    _lastInboundAt = DateTime.now();

    if (message is! Uint8List && message is! List<int>) {
      // Anti-downgrade: once ECDH vault is established, never accept plaintext JSON control frames.
      if (_isVaultEstablished) {
        _errorMessage = 'Rejected unencrypted control frame after AEAD vault lock.';
        _emitState();
      }
      return;
    }

    final Uint8List raw = message is Uint8List
        ? message
        : Uint8List.fromList(message as List<int>);
    final ProtocolPacket? packet = parsePacket(raw);
    if (packet == null) return;

    // 1. Pre-Vault OP_AUTH & Mutual ECDH Handshake
    if (!_isVaultEstablished) {
      if (packet.opcode == BinaryOpcode.auth) {
        final String statusStr =
            utf8.decode(packet.payload, allowMalformed: true).trim();
        if (!_isAuthenticated && packet.payload.length == 16) {
          final hmacSha256 = crypto_pkg.Hmac(crypto_pkg.sha256, utf8.encode(secret));
          final digest = hmacSha256.convert(packet.payload);
          _channel?.sink.add(packPacket(
            BinaryOpcode.auth,
            digest.bytes,
            seq: _nextControlSeq(),
          ));
        } else if (!_isAuthenticated &&
            (statusStr == 'OK_AUTHENTICATED' || statusStr == 'AUTH_OK')) {
          _isAuthenticated = true;
          _isConnected = true;
          _emitState();

          if (!_mutualInFlight) {
            _mutualInFlight = true;
            _crypto?.dispose();
            _crypto = CryptoEngine(preSharedKey: secret);
            _channel?.sink.add(packPacket(
              BinaryOpcode.auth,
              _crypto!.buildMutualInitPayload(),
              seq: _nextControlSeq(),
            ));
          }
        } else if (_isAuthenticated &&
            (packet.flags & ProtocolFlags.compressed) != 0 &&
            (packet.payload.length == 91 || packet.payload.length == 59)) {
          final Uint8List? hsResp = packet.payload.length == 91
              ? _crypto?.processMutualHostChallenge(packet.payload)
              : _crypto?.processHostChallenge(packet.payload);
          if (hsResp == null) {
            _handleDisconnect(
              'Host mutual cryptographic proof verification failed!',
              connectCompleter,
            );
            return;
          }
          _channel?.sink.add(packPacket(
            BinaryOpcode.auth,
            hsResp,
            seq: _nextControlSeq(),
          ));
        } else if (_isAuthenticated && statusStr == 'OK_ECDH_VAULT') {
          _isVaultEstablished = true;
          _isConnecting = false;
          _reconnectAttempt = 0;
          _aeadDecryptErrors = 0;
          _errorMessage = null;
          _startTimers();
          _emitState();
          if (connectCompleter != null && !connectCompleter.isCompleted) {
            connectCompleter.complete();
          }
        } else if (statusStr.isNotEmpty) {
          _handleDisconnect('Auth rejected: $statusStr', connectCompleter);
        }
      } else if (packet.opcode == BinaryOpcode.error) {
        final err = utf8.decode(packet.payload, allowMalformed: true).trim();
        _handleDisconnect(
          err.isNotEmpty ? err : 'Host authentication failed',
          connectCompleter,
        );
      }
      return;
    }

    // 2. Strict Post-Vault AEAD Gate (Zero Plaintext Tolerance)
    if ((packet.flags & ProtocolFlags.encrypted) == 0) {
      _aeadDecryptErrors++;
      _errorMessage =
          'Anti-downgrade guard: dropped unencrypted frame (op 0x${packet.opcode.toRadixString(16)})';
      _emitState();
      if (_aeadDecryptErrors >= 3) {
        _handleDisconnect('Repeated unencrypted downgrade frames', connectCompleter);
      }
      return;
    }

    final Uint8List? plaintext = _crypto?.decryptWirePacket(raw);
    if (plaintext == null) {
      _aeadDecryptErrors++;
      _errorMessage = 'AEAD tag or replay check failed on host frame.';
      _emitState();
      if (_aeadDecryptErrors >= 5) {
        _handleDisconnect('Persistent AEAD verification failure', connectCompleter);
      }
      return;
    }
    _aeadDecryptErrors = 0;

    // 3. Dispatch Authenticated & Decrypted Payload
    switch (packet.opcode) {
      case BinaryOpcode.ping:
        final sw = _pendingPings.remove(packet.seq);
        if (sw != null) {
          sw.stop();
          _latencyMs = sw.elapsedMilliseconds;
          _emitState();
        }
        break;
      case BinaryOpcode.frame:
        if (!_frameCtrl.isClosed) _frameCtrl.add(plaintext);
        break;
      case BinaryOpcode.telemetry:
        try {
          final decoded = jsonDecode(utf8.decode(plaintext, allowMalformed: true));
          if (decoded is Map<String, dynamic> && !_telemetryCtrl.isClosed) {
            _telemetryCtrl.add(decoded);
          }
        } catch (_) {}
        break;
      case BinaryOpcode.shell:
        try {
          final rawStr = utf8.decode(plaintext, allowMalformed: true);
          final parsed = jsonDecode(rawStr);
          if (parsed is Map<String, dynamic> && !_shellCtrl.isClosed) {
            _shellCtrl.add(ShellResult.fromJson(parsed));
          }
        } catch (_) {}
        break;
      case BinaryOpcode.hitl:
        try {
          final decoded = jsonDecode(utf8.decode(plaintext, allowMalformed: true));
          if (decoded is Map<String, dynamic> && !_hitlRawCtrl.isClosed) {
            _hitlRawCtrl.add(decoded);
          }
        } catch (_) {}
        break;
      case BinaryOpcode.clip:
        final text = utf8.decode(plaintext, allowMalformed: true);
        if (!_clipCtrl.isClosed) _clipCtrl.add(text);
        break;
      case BinaryOpcode.displayEnum:
        try {
          final decoded = jsonDecode(utf8.decode(plaintext, allowMalformed: true));
          if (decoded is Map<String, dynamic> && decoded['monitors'] is List) {
            final mons = (decoded['monitors'] as List)
                .whereType<Map>()
                .map((m) => Map<String, dynamic>.from(m))
                .toList();
            if (!_displayEnumCtrl.isClosed) _displayEnumCtrl.add(mons);
          }
        } catch (_) {}
        break;
      case BinaryOpcode.fileTransfer:
        if (!_fileAckCtrl.isClosed) {
          _fileAckCtrl.add(ProtocolPacket(
            opcode: packet.opcode,
            flags: packet.flags,
            seq: packet.seq,
            payload: plaintext,
          ));
        }
        break;
      case BinaryOpcode.error:
        final err = utf8.decode(plaintext, allowMalformed: true).trim();
        if (err.isNotEmpty) {
          _errorMessage = err;
          _emitState();
          if (!_shellCtrl.isClosed) {
            _shellCtrl.add(ShellResult(
              status: 'error',
              exitCode: -1,
              output: err,
              command: '',
            ));
          }
        }
        break;
    }
  }

  /// Encrypts a canonical 12-byte wire frame using the active AEAD vault session.
  Uint8List encryptFrame(int opcode, Uint8List plaintext, {int? seq}) {
    if (_disposed || !_isVaultEstablished || _crypto == null) {
      throw StateError('AEAD vault session is not established.');
    }
    return _crypto!.encryptWirePacket(opcode, plaintext, forcedSeq: seq);
  }

  /// Encrypts and dispatches a canonical 12-byte wire frame over the AEAD vault.
  bool sendEncrypted(int opcode, Uint8List plaintext, {int? seq}) {
    if (_disposed ||
        _channel == null ||
        !_isConnected ||
        !_isVaultEstablished ||
        _crypto == null) {
      return false;
    }
    try {
      final Uint8List framed = _crypto!.encryptWirePacket(
        opcode,
        plaintext,
        forcedSeq: seq,
      );
      _channel!.sink.add(framed);
      return true;
    } catch (e) {
      _errorMessage = 'Encrypted transmit error: $e';
      _emitState();
      return false;
    }
  }

  /// Signs a host HITL challenge with biometric approval + pairing secret HMAC-SHA256.
  Future<bool> respondToHitlChallenge(Map<String, dynamic> challenge) async {
    final String approvalId = (challenge['approval_id'] ?? '').toString();
    final String nonce =
        (challenge['challenge_nonce'] ?? challenge['nonce'] ?? '').toString();
    final String command =
        (challenge['command'] ?? challenge['proposed_command'] ?? '').toString();
    if (approvalId.isEmpty) return false;

    final gateRes = await BiometricSecurityGate.instance.verifyApproval(
      commandId: approvalId,
      shellCommand: command,
      targetHostId: hostIp,
      riskLevel: 'CRITICAL',
    );

    if (!gateRes.isApproved) {
      return sendEncrypted(
        BinaryOpcode.hitl,
        Uint8List.fromList(utf8.encode(jsonEncode({
          'approval_id': approvalId,
          'approved': false,
        }))),
      );
    }

    final hmac = crypto_pkg.Hmac(
      crypto_pkg.sha256,
      utf8.encode(sharedSecret.trim()),
    );
    final String sig =
        hmac.convert(utf8.encode('$approvalId:$nonce:$command')).toString();

    return sendEncrypted(
      BinaryOpcode.hitl,
      Uint8List.fromList(utf8.encode(jsonEncode({
        'approval_id': approvalId,
        'approved': true,
        'signature': sig,
      }))),
    );
  }

  /// Executes a shell command over the encrypted AEAD vault channel,
  /// automatically driving interactive biometric HITL approval if requested.
  Future<ShellResult> executeCommand(
    String command, {
    Duration timeout = const Duration(seconds: 25),
  }) {
    final Future<ShellResult> next = _shellQueue.then((_) async {
      await ensureConnected(timeout: const Duration(seconds: 7));

      final Completer<ShellResult> completer = Completer<ShellResult>();
      late final StreamSubscription<ShellResult> shellSub;
      late final StreamSubscription<Map<String, dynamic>> hitlSub;

      shellSub = shellResultStream.listen((res) {
        if (!completer.isCompleted) {
          completer.complete(res);
        }
      });
      hitlSub = hitlChallengeStream.listen((chal) async {
        await respondToHitlChallenge(chal);
      });

      try {
        final sent = sendEncrypted(
          BinaryOpcode.shell,
          Uint8List.fromList(utf8.encode(command)),
        );
        if (!sent) {
          throw StateError('Unable to transmit encrypted shell command.');
        }
        return await completer.future.timeout(
          timeout,
          onTimeout: () => ShellResult(
            status: 'timeout',
            exitCode: -1,
            output: 'Command timed out awaiting response from $hostIp:$port.',
            command: command,
          ),
        );
      } finally {
        await shellSub.cancel();
        await hitlSub.cancel();
      }
    });
    _shellQueue = next.then((_) {}, onError: (_) {});
    return next;
  }

  void _startTimers() {
    _pingTimer?.cancel();
    _watchdogTimer?.cancel();

    _pingTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (_disposed || !_isVaultEstablished || _crypto == null) return;
      final Uint8List pkt = _crypto!.encryptWirePacket(
        BinaryOpcode.ping,
        Uint8List(0),
      );
      final int seq = ByteData.sublistView(pkt).getUint32(4, Endian.big);
      if (_pendingPings.length >= 4) {
        _pendingPings.remove(_pendingPings.keys.first)?.stop();
      }
      _pendingPings[seq] = Stopwatch()..start();
      try {
        _channel?.sink.add(pkt);
      } catch (_) {}
    });

    _watchdogTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (_disposed || !_isConnected) return;
      final silenceSec = DateTime.now().difference(_lastInboundAt).inSeconds;
      if (silenceSec >= 12) {
        _handleDisconnect('Heartbeat watchdog timeout ($silenceSec s silence)', null);
      }
    });
  }

  void _handleDisconnect(String reason, Completer<void>? connectCompleter) {
    final bool wasConnecting = _isConnecting;
    _cleanupTransportOnly();
    _errorMessage = reason;
    _emitState();
    if (connectCompleter != null && !connectCompleter.isCompleted) {
      connectCompleter.completeError(StateError(reason));
    }
    if (!_disposed && !_manualDisconnect && !wasConnecting) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    if (_disposed || _manualDisconnect) return;
    if (_reconnectTimer?.isActive ?? false) return;
    final int baseSec = min(15, 1 << min(_reconnectAttempt, 4));
    _reconnectAttempt++;
    final double jitter = 0.8 + (_rnd.nextDouble() * 0.4); // +/- 20%
    final int delayMs = (baseSec * 1000 * jitter).round();
    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () {
      if (_disposed || _manualDisconnect) return;
      unawaited(ensureConnected().catchError((_) {}));
    });
  }

  void _cleanupTransportOnly() {
    _pingTimer?.cancel();
    _pingTimer = null;
    _watchdogTimer?.cancel();
    _watchdogTimer = null;
    for (final sw in _pendingPings.values) {
      sw.stop();
    }
    _pendingPings.clear();
    _isConnected = false;
    _isAuthenticated = false;
    _isVaultEstablished = false;
    _isConnecting = false;
    _mutualInFlight = false;
    _subscription?.cancel();
    _subscription = null;
    try {
      _channel?.sink.close();
    } catch (_) {}
    _channel = null;
    _crypto?.dispose();
    _crypto = null;
  }

  void retain() {
    _retainCount++;
  }

  void release() {
    if (_retainCount > 0) {
      _retainCount--;
    }
    if (_retainCount == 0) {
      disconnect();
    }
  }

  void disconnect() {
    _manualDisconnect = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _cleanupTransportOnly();
    _emitState();
  }

  void dispose() {
    _disposed = true;
    disconnect();
    unawaited(_frameCtrl.close());
    unawaited(_telemetryCtrl.close());
    unawaited(_shellCtrl.close());
    unawaited(_fileAckCtrl.close());
    unawaited(_clipCtrl.close());
    unawaited(_displayEnumCtrl.close());
    unawaited(_hitlRawCtrl.close());
    unawaited(_stateCtrl.close());
  }
}

/// Manages pooled, AEAD-authenticated persistent connections keyed by host endpoint.
class HostConnectionPool {
  static final HostConnectionPool instance = HostConnectionPool._();
  HostConnectionPool._();

  final Map<String, HostConnectionClient> _clients =
      <String, HostConnectionClient>{};

  static String _key(String ip, int port) => '$ip:$port';

  HostConnectionClient acquire({
    required String hostIp,
    int port = 8765,
    required String sharedSecret,
    bool useTls = false,
    String? certFingerprint,
  }) {
    final String k = _key(hostIp, port);
    final HostConnectionClient? existing = _clients[k];
    if (existing != null &&
        existing.sharedSecret.trim() == sharedSecret.trim() &&
        existing.useTls == useTls &&
        (existing.certFingerprint ?? '') == (certFingerprint ?? '')) {
      return existing;
    }
    existing?.dispose();
    final created = HostConnectionClient(
      hostIp: hostIp,
      port: port,
      sharedSecret: sharedSecret,
      useTls: useTls,
      certFingerprint: certFingerprint,
    );
    _clients[k] = created;
    return created;
  }

  void invalidate(String hostIp, {int port = 8765}) {
    final k = _key(hostIp, port);
    _clients.remove(k)?.dispose();
  }

  void disposeAll() {
    for (final client in _clients.values) {
      client.dispose();
    }
    _clients.clear();
  }
}
