import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart' as crypto_pkg;
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../protocol/binary_protocol.dart';
import '../protocol/fragmentation_engine.dart';
import '../security/biometric_security_gate.dart';
import '../security/crypto_engine.dart';
import 'frame_decrypt_isolate.dart';

/// Result returned by an encrypted X25519 + ChaCha20-Poly1305 PIN pairing exchange.
class PairingResult {
  final String pairingToken;
  final String? certFingerprint;

  const PairingResult({
    required this.pairingToken,
    this.certFingerprint,
  });
}

/// Lifecycle phase of a persistent host connection.
enum HostConnectionPhase {
  disconnected,
  connecting,
  authenticating,
  securingVault,
  connected,
  reconnecting,
  authFailed,
}

/// Immutable status snapshot of a persistent host connection.
class HostConnectionSnapshot {
  final bool isConnecting;
  final bool isConnected;
  final bool isAuthenticated;
  final bool isVaultEstablished;
  final int? latencyMs;
  final String? errorMessage;
  final HostConnectionPhase phase;
  final int reconnectAttempt;
  final DateTime? connectedSince;
  final String? errorHint;

  const HostConnectionSnapshot({
    this.isConnecting = false,
    this.isConnected = false,
    this.isAuthenticated = false,
    this.isVaultEstablished = false,
    this.latencyMs,
    this.errorMessage,
    this.phase = HostConnectionPhase.disconnected,
    this.reconnectAttempt = 0,
    this.connectedSince,
    this.errorHint,
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
  FrameDecryptIsolate? _frameDecryptIsolate;
  Timer? _pingTimer;
  Timer? _watchdogTimer;
  Timer? _reconnectTimer;
  Completer<void>? _connectCompleter;
  Future<void> _shellQueue = Future<void>.value();

  bool _disposed = false;
  bool _manualDisconnect = false;
  bool _authRejected = false;
  bool _isConnecting = false;
  bool _isConnected = false;
  bool _isAuthenticated = false;
  bool _isVaultEstablished = false;
  bool _authChallengeResponded = false;
  bool _mutualInFlight = false;
  int _controlSeq = 0;
  int _reconnectAttempt = 0;
  int _connectionGeneration = 0;
  int? _latencyMs;
  String? _errorMessage;
  String? _errorHint;
  HostConnectionPhase _phase = HostConnectionPhase.disconnected;
  DateTime? _connectedSince;
  Uint8List? _lastFrame;
  int _lastFrameSeq = 0;
  DateTime _lastInboundAt = DateTime.fromMillisecondsSinceEpoch(0);
  int _aeadDecryptErrors = 0;
  int _retainCount = 0;
  final ValueNotifier<int> frameKbPerSecNotifier = ValueNotifier<int>(0);
  final List<({int tsMs, int bytes})> _throughputSamples =
      <({int tsMs, int bytes})>[];
  int _throughputWindowBytes = 0;
  final Map<int, Stopwatch> _pendingPings = <int, Stopwatch>{};
  final Set<String> _inFlightHitlIds = <String>{};
  final Random _rnd = Random.secure();
  late final PacketReassembler _reassembler;
  StreamSubscription<int>? _frameSyncSub;
  int _activeMonitorIndex = 1;

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
  final StreamController<String> _llmCtrl =
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
  }) {
    _reassembler = PacketReassembler();
    _frameSyncSub = _reassembler.onFrameSyncRequested.listen((syncOpcode) {
      if (_isVaultEstablished) {
        sendEncrypted(syncOpcode, Uint8List(0));
      }
    });
  }

  bool get isConnecting => _isConnecting;
  bool get isConnected => _isConnected;
  bool get isAuthenticated => _isAuthenticated;
  bool get isVaultEstablished => _isVaultEstablished;
  int? get latencyMs => _latencyMs;
  String? get errorMessage => _errorMessage;
  HostConnectionPhase get phase => _phase;
  int get reconnectAttempt => _reconnectAttempt;
  DateTime? get connectedSince => _connectedSince;
  String? get errorHint => _errorHint;
  int get activeMonitorIndex => _activeMonitorIndex;
  Uint8List? get lastFrame => _lastFrame;
  int get lastFrameSeq => _lastFrameSeq;

  HostConnectionSnapshot get snapshot => HostConnectionSnapshot(
        isConnecting: _isConnecting,
        isConnected: _isConnected,
        isAuthenticated: _isAuthenticated,
        isVaultEstablished: _isVaultEstablished,
        latencyMs: _latencyMs,
        errorMessage: _errorMessage,
        phase: _phase,
        reconnectAttempt: _reconnectAttempt,
        connectedSince: _connectedSince,
        errorHint: _errorHint,
      );

  Stream<Uint8List> get frameStream => _frameCtrl.stream;
  Stream<Map<String, dynamic>> get telemetryStream => _telemetryCtrl.stream;
  Stream<ShellResult> get shellResultStream => _shellCtrl.stream;
  Stream<ProtocolPacket> get fileAckStream => _fileAckCtrl.stream;
  Stream<String> get clipboardStream => _clipCtrl.stream;
  Stream<String> get llmTokenStream => _llmCtrl.stream;
  Stream<List<Map<String, dynamic>>> get displayEnumStream =>
      _displayEnumCtrl.stream;
  Stream<Map<String, dynamic>> get hitlChallengeStream => _hitlRawCtrl.stream;
  Stream<HostConnectionSnapshot> get stateStream => _stateCtrl.stream;

  void _setError(String? message) {
    final String? clean =
        (message != null && message.trim().isNotEmpty) ? message.trim() : null;
    _errorMessage = clean;
    _errorHint = clean == null
        ? null
        : buildErrorHint(clean, port: port, useTls: useTls);
  }

  /// Derives an actionable human-readable troubleshooting tip from a transport
  /// or handshake error string.
  static String? buildErrorHint(
    String? errorMessage, {
    int port = 8765,
    bool useTls = false,
  }) {
    if (errorMessage == null || errorMessage.trim().isEmpty) return null;
    final String lower = errorMessage.toLowerCase();

    if (lower.contains('pairing secret required')) {
      return 'Enter the pairing secret or pair with the 6-digit PIN shown on the PC Host Agent before connecting.';
    }
    if (lower.contains('geofence') || lower.contains('subnet')) {
      return 'Host subnet geofence blocked this connection. Connect your phone to the same LAN/Wi-Fi subnet as the PC.';
    }
    if (lower.contains('blacklisted') ||
        lower.contains('rate limit') ||
        lower.contains('too many')) {
      return 'Host temporarily rate-limited this device after repeated failures. Wait briefly or restart the PC Host Agent.';
    }
    if (lower.contains('handshakeexception') ||
        lower.contains('bad certificate') ||
        lower.contains('certificate') ||
        lower.contains('x509') ||
        lower.contains('tls') ||
        lower.contains('ssl')) {
      return 'TLS certificate mismatch or untrusted cert. Re-pair the host to pin its new certificate, or toggle TLS in host settings.';
    }
    if (lower.contains('mutual cryptographic proof') ||
        lower.contains('auth') ||
        lower.contains('rejected') ||
        lower.contains('unauthorized') ||
        lower.contains('invalid secret') ||
        lower.contains('invalid token') ||
        lower.contains('origin not permitted')) {
      return 'Pairing secret mismatch. Re-pair this device using a fresh 6-digit PIN from the PC Host Agent.';
    }
    if (lower.contains('aead') ||
        lower.contains('downgrade') ||
        lower.contains('unencrypted') ||
        lower.contains('replay')) {
      return 'Encrypted vault check failed. Tap Reconnect for a fresh ECDH session or re-pair if the issue persists.';
    }
    if (lower.contains('connection refused') ||
        lower.contains('actively refused') ||
        lower.contains('errno = 111') ||
        lower.contains('errno = 10061')) {
      return 'Connection refused on port $port. Confirm the PC Host Agent is running and Windows Firewall allows TCP port $port.';
    }
    if (lower.contains('timed out') ||
        lower.contains('timeout') ||
        lower.contains('no route to host') ||
        lower.contains('network is unreachable') ||
        lower.contains('host is down') ||
        lower.contains('errno = 113') ||
        lower.contains('errno = 10060') ||
        lower.contains('errno = 10065')) {
      return 'Host did not respond on port $port. Check Wi-Fi, allow TCP port $port in Windows Firewall, or send Wake-on-LAN if the PC is asleep.';
    }
    if (lower.contains('failed host lookup') ||
        lower.contains('no such host') ||
        lower.contains('nodename nor servname')) {
      return 'Could not resolve host address. Verify the PC IP address or run LAN discovery again.';
    }
    if (lower.contains('heartbeat') ||
        lower.contains('watchdog') ||
        lower.contains('closed by host') ||
        lower.contains('connection reset') ||
        lower.contains('broken pipe') ||
        lower.contains('socket')) {
      return 'Connection dropped. Check Wi-Fi stability and confirm the PC Host Agent is still running on port $port.';
    }
    if (useTls) {
      return 'Verify the PC Host Agent is running with TLS on port $port, firewall allows TCP port $port, and the pairing secret matches.';
    }
    return 'Verify the PC Host Agent is running on port $port, Windows Firewall allows TCP port $port, and both devices share the same Wi-Fi/LAN.';
  }

  /// Computes snappy LAN reconnect backoff delay in milliseconds:
  /// `500ms, 1s, 2s, 4s, 8s` (capped at 8s) scaled by [jitterFactor] (`0.8..1.2`).
  static int computeReconnectDelayMs(
    int attemptIndex, {
    double jitterFactor = 1.0,
  }) {
    final int clampedAttempt =
        attemptIndex < 0 ? 0 : (attemptIndex > 4 ? 4 : attemptIndex);
    final int baseMs = min(8000, 500 * (1 << clampedAttempt));
    final double safeJitter =
        jitterFactor.isFinite ? jitterFactor.clamp(0.8, 1.2) : 1.0;
    return (baseMs * safeJitter).round();
  }

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
        if (expectedFp.length == 64) {
          return _constantTimeHexEq(actualFp, expectedFp);
        }
        return false;
      };
    }
    bool connected = false;
    try {
      final ws = await WebSocket.connect(
        uri.toString(),
        customClient: httpClient,
        compression: CompressionOptions.compressionOff,
      ).timeout(timeout);
      ws.pingInterval = const Duration(seconds: 5);
      connected = true;
      return ws;
    } finally {
      httpClient.close(force: !connected);
    }
  }

  /// Probes whether an actual AI NetController daemon (emitting 16B `OP_AUTH`
  /// challenge header `0xC5 0x71 0x06`) is listening on `[ip]:[port]`.
  static Future<bool> probeHostAgent(
    String ip, {
    int port = 8765,
    bool useTls = false,
    Duration timeout = const Duration(milliseconds: 1000),
  }) async {
    WebSocket? ws;
    final HttpClient client = HttpClient()..connectionTimeout = timeout;
    try {
      if (useTls) {
        // Discovery probe only verifies the canonical 0xC5 0x71 OP_AUTH banner.
        client.badCertificateCallback = (_, _, _) => true;
      }
      final uri = Uri(scheme: useTls ? 'wss' : 'ws', host: ip, port: port);
      ws = await WebSocket.connect(uri.toString(), customClient: client)
          .timeout(timeout);
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
      client.close(force: true);
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
              if (pairKey != null) return;
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
              zeroize(plain);
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

  /// Resets reconnect state, tears down any stale transport, and initiates an
  /// immediate fresh connection handshake.
  Future<void> reconnectNow({
    Duration timeout = const Duration(seconds: 7),
  }) {
    if (_disposed) {
      return Future<void>.error(
        StateError('HostConnectionClient has been disposed'),
      );
    }
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _reconnectAttempt = 0;
    _manualDisconnect = false;
    _authRejected = false;
    final pendingCompleter = _connectCompleter;
    _connectCompleter = null;
    _cleanupTransportOnly();
    _setError(null);
    if (pendingCompleter != null && !pendingCompleter.isCompleted) {
      pendingCompleter.completeError(
        StateError('Reconnect requested by client.'),
      );
    }
    return ensureConnected(timeout: timeout);
  }

  /// Notifies the client that the mobile app woke or returned to the foreground.
  ///
  /// When connected, immediately sends an encrypted RTT ping to verify socket
  /// liveness; when disconnected or waiting to reconnect (and not manually
  /// disconnected or auth-failed), immediately triggers [reconnectNow].
  void notifyAppResumed() {
    if (_disposed) return;
    if (_isConnected &&
        _isVaultEstablished &&
        _crypto != null &&
        _channel != null) {
      if (DateTime.now().difference(_lastInboundAt).inSeconds >= 8) {
        _lastInboundAt = DateTime.now().subtract(const Duration(seconds: 8));
      }
      if (!_sendPingNow()) {
        unawaited(reconnectNow().catchError((_) {}));
      }
      return;
    }
    if (!_manualDisconnect &&
        !_authRejected &&
        !_isConnecting &&
        sharedSecret.trim().isNotEmpty) {
      unawaited(reconnectNow().catchError((_) {}));
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
    _authRejected = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;

    final String secret = sharedSecret.trim();
    if (secret.isEmpty) {
      _authRejected = true;
      _cleanupTransportOnly();
      _setError('Pairing secret required before connecting to host.');
      _phase = HostConnectionPhase.authFailed;
      _emitState();
      throw StateError(_errorMessage!);
    }

    final Completer<void> completer = Completer<void>();
    // Guard against unhandled async errors if caller stops awaiting or times out.
    unawaited(completer.future.catchError((_) {}));
    _connectCompleter = completer;

    _cleanupTransportOnly();
    final int gen = _connectionGeneration;
    _isConnecting = true;
    _phase = _reconnectAttempt > 0
        ? HostConnectionPhase.reconnecting
        : HostConnectionPhase.connecting;
    _setError(null);
    _emitState();

    Timer? handshakeTimer;
    try {
      final uri = Uri(scheme: useTls ? 'wss' : 'ws', host: hostIp, port: port);
      final ws = await openRawWebSocket(
        uri,
        expectedCertFingerprint: certFingerprint,
        timeout: timeout,
      );
      if (_disposed ||
          _manualDisconnect ||
          gen != _connectionGeneration ||
          _connectCompleter != completer ||
          completer.isCompleted) {
        unawaited(ws.close().catchError((_) {}));
        if (!completer.isCompleted) {
          completer.completeError(
            StateError('Connection aborted before handshake'),
          );
        }
        return await completer.future;
      }

      ws.pingInterval = const Duration(seconds: 5);
      _channel = IOWebSocketChannel(ws);
      _lastInboundAt = DateTime.now();
      _phase = HostConnectionPhase.authenticating;
      _emitState();

      handshakeTimer = Timer(timeout, () {
        if (!_disposed &&
            gen == _connectionGeneration &&
            !completer.isCompleted) {
          _handleDisconnect(
            'Vault handshake timed out ($hostIp:$port)',
            completer,
            errorOverride: TimeoutException('Handshake timeout with $hostIp:$port'),
          );
        }
      });

      _subscription = _channel!.stream.listen(
        (dynamic message) {
          if (gen != _connectionGeneration || _disposed) return;
          _handleIncoming(message, secret, completer);
        },
        onError: (Object err) {
          if (gen != _connectionGeneration || _disposed) return;
          _handleDisconnect('Socket connection error: $err', completer);
        },
        onDone: () {
          if (gen != _connectionGeneration || _disposed) return;
          _handleDisconnect('Connection closed by host.', completer);
        },
      );

      return await completer.future;
    } catch (e) {
      if (_connectCompleter == completer) {
        _connectCompleter = null;
      }
      final bool staleAttempt = gen != _connectionGeneration;
      final bool handledByDisconnect = completer.isCompleted;
      if (!handledByDisconnect) {
        if (!staleAttempt) {
          _cleanupTransportOnly();
          if (!_manualDisconnect) {
            _setError('Failed to connect: $e');
            if (!_disposed && !_authRejected) {
              _scheduleReconnect();
            } else {
              _phase = _authRejected
                  ? HostConnectionPhase.authFailed
                  : HostConnectionPhase.disconnected;
              _emitState();
            }
          } else {
            _phase = HostConnectionPhase.disconnected;
            _emitState();
          }
        }
        completer.completeError(e);
      } else if (!staleAttempt &&
          !_disposed &&
          !_manualDisconnect &&
          !_authRejected &&
          !(_reconnectTimer?.isActive ?? false)) {
        _scheduleReconnect();
      }
      return completer.future;
    } finally {
      handshakeTimer?.cancel();
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
        _setError('Rejected unencrypted control frame after AEAD vault lock.');
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
        if (!_isAuthenticated &&
            (statusStr == 'OK_AUTHENTICATED' || statusStr == 'AUTH_OK')) {
          _isAuthenticated = true;
          _isConnected = true;
          _phase = HostConnectionPhase.securingVault;
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
        } else if (!_isAuthenticated &&
            !_authChallengeResponded &&
            packet.payload.length == 16) {
          // IMPORTANT: Check 'OK_AUTHENTICATED' before length == 16 because
          // "OK_AUTHENTICATED" is itself 16 ASCII bytes.
          _authChallengeResponded = true;
          if (_phase != HostConnectionPhase.authenticating) {
            _phase = HostConnectionPhase.authenticating;
            _emitState();
          }
          final hmacSha256 = crypto_pkg.Hmac(crypto_pkg.sha256, utf8.encode(secret));
          final digest = hmacSha256.convert(packet.payload);
          _channel?.sink.add(packPacket(
            BinaryOpcode.auth,
            digest.bytes,
            seq: _nextControlSeq(),
          ));
        } else if (_isAuthenticated &&
            (packet.flags & ProtocolFlags.compressed) != 0 &&
            (packet.payload.length == 91 || packet.payload.length == 59)) {
          final Uint8List? hsResp = packet.payload.length == 91
              ? _crypto?.processMutualHostChallenge(packet.payload)
              : _crypto?.processHostChallenge(packet.payload);
          if (hsResp == null) {
            _authRejected = true;
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
          _connectedSince = DateTime.now();
          _phase = HostConnectionPhase.connected;
          _setError(null);
          _spinUpFrameDecryptIsolate();
          _startTimers();
          _sendPingNow();
          requestKeyframe();
          requestDisplayEnum();
          _emitState();
          if (connectCompleter != null && !connectCompleter.isCompleted) {
            if (_connectCompleter == connectCompleter) {
              _connectCompleter = null;
            }
            connectCompleter.complete();
          }
        } else if (statusStr.isNotEmpty) {
          _authRejected = true;
          _handleDisconnect('Auth rejected: $statusStr', connectCompleter);
        }
      } else if (packet.opcode == BinaryOpcode.error) {
        final err = utf8.decode(packet.payload, allowMalformed: true).trim();
        _authRejected = true;
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
      _setError(
        'Anti-downgrade guard: dropped unencrypted frame (op 0x${packet.opcode.toRadixString(16)})',
      );
      _emitState();
      if (_aeadDecryptErrors >= 3) {
        _handleDisconnect('Repeated unencrypted downgrade frames', connectCompleter);
      }
      return;
    }

    // 2a. Route non-fragmented encrypted OP_FRAME through the persistent decrypt isolate
    final bool isNonFragmentedFrame = packet.opcode == BinaryOpcode.frame &&
        (packet.flags & ProtocolFlags.isFragmented) == 0;
    if (isNonFragmentedFrame && _frameDecryptIsolate != null) {
      if (packet.payload.length < kNonceSize + kTagSize ||
          raw.length < kHeaderSize + kNonceSize + kTagSize) {
        _recordAeadError(connectCompleter);
        return;
      }
      final ByteData nonceBd = ByteData.sublistView(
        raw,
        kHeaderSize,
        kHeaderSize + kNonceSize,
      );
      final int epoch = nonceBd.getUint32(0, Endian.big);
      final int nonceSeq = nonceBd.getUint64(4, Endian.big);
      if (epoch != 0 || !(_crypto?.canAcceptInboundSeq(nonceSeq) ?? false)) {
        _recordAeadError(connectCompleter);
        return;
      }
      _frameDecryptIsolate!.enqueueEncryptedFrame(raw, packet.seq);
      return;
    }

    final Uint8List? plaintext = _crypto?.decryptWirePacket(raw);
    if (plaintext == null) {
      _recordAeadError(connectCompleter);
      return;
    }
    _aeadDecryptErrors = 0;

    // 2b. Reassemble fragmented payloads transparently before dispatching
    int dispatchOpcode = packet.opcode;
    int dispatchSeq = packet.seq;
    int dispatchFlags = packet.flags;
    Uint8List dispatchPayload = plaintext;
    if ((packet.flags & ProtocolFlags.isFragmented) != 0) {
      final ProtocolPacket? completed = _reassembler.ingestPacket(
        packet.opcode,
        packet.flags & ~ProtocolFlags.encrypted,
        packet.seq,
        plaintext,
      );
      if (completed == null) return;
      dispatchOpcode = completed.opcode;
      dispatchSeq = completed.seq;
      dispatchFlags = completed.flags;
      dispatchPayload = completed.payload;
    }

    // 3. Dispatch Authenticated & Decrypted Payload
    switch (dispatchOpcode) {
      case BinaryOpcode.ping:
        final sw = _pendingPings.remove(dispatchSeq);
        if (sw != null) {
          sw.stop();
          _latencyMs = sw.elapsedMilliseconds;
          _emitState();
        }
        break;
      case BinaryOpcode.frame:
        _deliverVideoFrame(dispatchPayload, dispatchSeq);
        break;
      case BinaryOpcode.telemetry:
        try {
          final decoded =
              jsonDecode(utf8.decode(dispatchPayload, allowMalformed: true));
          if (decoded is Map<String, dynamic> && !_telemetryCtrl.isClosed) {
            _telemetryCtrl.add(decoded);
          }
        } catch (_) {}
        break;
      case BinaryOpcode.shell:
        try {
          final rawStr = utf8.decode(dispatchPayload, allowMalformed: true);
          final parsed = jsonDecode(rawStr);
          if (parsed is Map<String, dynamic> && !_shellCtrl.isClosed) {
            _shellCtrl.add(ShellResult.fromJson(parsed));
          }
        } catch (_) {}
        break;
      case BinaryOpcode.hitl:
        try {
          final decoded =
              jsonDecode(utf8.decode(dispatchPayload, allowMalformed: true));
          if (decoded is Map<String, dynamic> && !_hitlRawCtrl.isClosed) {
            _hitlRawCtrl.add(decoded);
          }
        } catch (_) {}
        break;
      case BinaryOpcode.clip:
        final text = utf8.decode(dispatchPayload, allowMalformed: true);
        if (!_clipCtrl.isClosed) _clipCtrl.add(text);
        break;
      case BinaryOpcode.llmStream:
        final chunk = utf8.decode(dispatchPayload, allowMalformed: true);
        if (!_llmCtrl.isClosed) _llmCtrl.add(chunk);
        break;
      case BinaryOpcode.displayEnum:
        try {
          final decoded =
              jsonDecode(utf8.decode(dispatchPayload, allowMalformed: true));
          if (decoded is Map<String, dynamic>) {
            final active = (decoded['active'] as num?)?.toInt();
            if (active != null && active > 0) {
              _activeMonitorIndex = active;
            }
            if (decoded['monitors'] is List) {
              final mons = (decoded['monitors'] as List)
                  .whereType<Map>()
                  .map((m) => Map<String, dynamic>.from(m))
                  .toList();
              if (!_displayEnumCtrl.isClosed) _displayEnumCtrl.add(mons);
            }
          }
        } catch (_) {}
        break;
      case BinaryOpcode.fileTransfer:
        if (!_fileAckCtrl.isClosed) {
          _fileAckCtrl.add(ProtocolPacket(
            opcode: dispatchOpcode,
            flags: dispatchFlags,
            seq: dispatchSeq,
            payload: dispatchPayload,
          ));
        }
        break;
      case BinaryOpcode.error:
        final err = utf8.decode(dispatchPayload, allowMalformed: true).trim();
        if (err.isNotEmpty) {
          _setError(err);
          _emitState();
        }
        break;
    }
  }

  void _spinUpFrameDecryptIsolate() {
    _frameDecryptIsolate?.dispose();
    _frameDecryptIsolate = null;
    final Uint8List? recvKeyCopy = _crypto?.copyRecvKeyForIsolate();
    if (recvKeyCopy == null) return;

    final int activeGen = _connectionGeneration;
    try {
      _frameDecryptIsolate = FrameDecryptIsolate(
        recvKey: recvKeyCopy,
        onFrameDecrypted: (int seq, Uint8List plaintext) {
          if (_disposed ||
              activeGen != _connectionGeneration ||
              !_isVaultEstablished) {
            return;
          }
          final int nonceSeq = _frameDecryptIsolate?.lastVerifiedNonceSeq ?? 0;
          if (nonceSeq <= 0 || !(_crypto?.commitInboundSeq(nonceSeq) ?? false)) {
            _recordAeadError(null);
            return;
          }
          _aeadDecryptErrors = 0;
          _deliverVideoFrame(plaintext, seq);
        },
        onFrameDropped: (int droppedSeq) {
          if (_disposed ||
              activeGen != _connectionGeneration ||
              !_isVaultEstablished) {
            return;
          }
          sendFrameAck(droppedSeq);
        },
        onDecryptError: (int seq, String reason) {
          if (_disposed ||
              activeGen != _connectionGeneration ||
              !_isVaultEstablished) {
            return;
          }
          if (reason == 'jpeg') {
            final int nonceSeq = _frameDecryptIsolate?.lastVerifiedNonceSeq ?? 0;
            if (nonceSeq > 0) {
              _crypto?.commitInboundSeq(nonceSeq);
            }
            sendFrameAck(seq);
            requestKeyframe();
          } else {
            _recordAeadError(null);
          }
        },
      );
    } finally {
      zeroize(recvKeyCopy);
    }
  }

  void _recordAeadError(Completer<void>? connectCompleter) {
    _aeadDecryptErrors++;
    _setError('AEAD tag or replay check failed on host frame.');
    _emitState();
    if (_aeadDecryptErrors >= 5) {
      _handleDisconnect('Persistent AEAD verification failure', connectCompleter);
    }
  }

  void _deliverVideoFrame(Uint8List frameBytes, int seq) {
    _lastFrameSeq = seq;
    _lastFrame = frameBytes;
    _recordFrameThroughputBytes(frameBytes.length);
    if (!_frameCtrl.isClosed) {
      _frameCtrl.add(frameBytes);
    }
  }

  void _pruneFrameThroughput(int nowMs) {
    final int cutoffMs = nowMs - 1000;
    while (_throughputSamples.isNotEmpty &&
        _throughputSamples.first.tsMs < cutoffMs) {
      _throughputWindowBytes -= _throughputSamples.first.bytes;
      _throughputSamples.removeAt(0);
    }
    if (_throughputWindowBytes < 0) {
      _throughputWindowBytes = 0;
    }
    final int kbPerSec = (_throughputWindowBytes / 1024).round();
    if (!_disposed && frameKbPerSecNotifier.value != kbPerSec) {
      frameKbPerSecNotifier.value = kbPerSec;
    }
  }

  void _recordFrameThroughputBytes(int bytes) {
    if (_disposed) return;
    final int nowMs = DateTime.now().millisecondsSinceEpoch;
    _throughputSamples.add((tsMs: nowMs, bytes: bytes));
    _throughputWindowBytes += bytes;
    _pruneFrameThroughput(nowMs);
  }

  void _resetFrameThroughput() {
    _throughputSamples.clear();
    _throughputWindowBytes = 0;
    if (!_disposed && frameKbPerSecNotifier.value != 0) {
      frameKbPerSecNotifier.value = 0;
    }
  }

  /// Encrypts a canonical 12-byte wire frame using the active AEAD vault session.
  Uint8List encryptFrame(int opcode, Uint8List plaintext, {int? seq}) {
    if (_disposed || !_isVaultEstablished || _crypto == null) {
      throw StateError('AEAD vault session is not established.');
    }
    return _crypto!.encryptWirePacket(opcode, plaintext, forcedSeq: seq);
  }

  /// Sends an already-encrypted canonical wire frame produced by [encryptFrame].
  bool sendRawEncryptedPacket(Uint8List encryptedFrame) {
    if (_disposed ||
        _channel == null ||
        !_isConnected ||
        !_isVaultEstablished) {
      return false;
    }
    try {
      _channel!.sink.add(encryptedFrame);
      return true;
    } catch (e) {
      _setError('Encrypted transmit error: $e');
      _emitState();
      return false;
    }
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
      _setError('Encrypted transmit error: $e');
      _emitState();
      return false;
    }
  }

  static int _encodeNormalizedCoord(double value) {
    if (value.isNaN) return 0;
    return (value.clamp(0.0, 1.0) * 65535).round().clamp(0, 65535);
  }

  /// Encodes a 6-byte `!BHHB` absolute cursor move payload (`type = 4`).
  static Uint8List encodeAbsoluteMouseMove(double nx, double ny) {
    final Uint8List buf = Uint8List(6);
    final ByteData bd = ByteData.sublistView(buf);
    bd.setUint8(0, 4);
    bd.setUint16(1, _encodeNormalizedCoord(nx), Endian.big);
    bd.setUint16(3, _encodeNormalizedCoord(ny), Endian.big);
    bd.setUint8(5, 0);
    return buf;
  }

  /// Encodes a 6-byte `!BHHB` absolute click payload (`type = 5`).
  /// [buttonCode]: `1=left, 2=right, 3=middle, 4=double`.
  static Uint8List encodeAbsoluteMouseClick(
    double nx,
    double ny, {
    int buttonCode = 1,
  }) {
    final Uint8List buf = Uint8List(6);
    final ByteData bd = ByteData.sublistView(buf);
    bd.setUint8(0, 5);
    bd.setUint16(1, _encodeNormalizedCoord(nx), Endian.big);
    bd.setUint16(3, _encodeNormalizedCoord(ny), Endian.big);
    bd.setUint8(5, buttonCode.clamp(1, 4));
    return buf;
  }

  /// Encodes a 6-byte `!BHHB` absolute mouse button down/up payload (`type = 6`).
  /// [actionCode]: `1=lDown, 2=lUp, 3=rDown, 4=rUp, 5=mDown, 6=mUp`.
  static Uint8List encodeAbsoluteMouseButton(
    double nx,
    double ny, {
    required int actionCode,
  }) {
    final Uint8List buf = Uint8List(6);
    final ByteData bd = ByteData.sublistView(buf);
    bd.setUint8(0, 6);
    bd.setUint16(1, _encodeNormalizedCoord(nx), Endian.big);
    bd.setUint16(3, _encodeNormalizedCoord(ny), Endian.big);
    bd.setUint8(5, actionCode.clamp(1, 6));
    return buf;
  }

  /// Encodes a 6-byte `!BhhB` 2D scroll payload (`type = 7`).
  static Uint8List encodeScroll2D(int dx, int dy) {
    final Uint8List buf = Uint8List(6);
    final ByteData bd = ByteData.sublistView(buf);
    bd.setUint8(0, 7);
    bd.setInt16(1, dx.clamp(-5000, 5000), Endian.big);
    bd.setInt16(3, dy.clamp(-5000, 5000), Endian.big);
    bd.setUint8(5, 0);
    return buf;
  }

  /// Moves the PC cursor directly to normalized monitor coordinates `(nx, ny)` in `[0.0, 1.0]`.
  bool sendAbsoluteMouseMove(double nx, double ny) =>
      sendEncrypted(BinaryOpcode.input, encodeAbsoluteMouseMove(nx, ny));

  /// Moves and clicks at normalized coordinates `(nx, ny)` (`buttonCode`: 1=left, 2=right, 3=middle, 4=double).
  bool sendAbsoluteMouseClick(double nx, double ny, {int buttonCode = 1}) =>
      sendEncrypted(
        BinaryOpcode.input,
        encodeAbsoluteMouseClick(nx, ny, buttonCode: buttonCode),
      );

  /// Sends mouse button down/up at normalized coordinates `(nx, ny)`.
  /// [actionCode]: `1=lDown, 2=lUp, 3=rDown, 4=rUp, 5=mDown, 6=mUp`.
  bool sendAbsoluteMouseButton(
    double nx,
    double ny, {
    required int actionCode,
  }) =>
      sendEncrypted(
        BinaryOpcode.input,
        encodeAbsoluteMouseButton(nx, ny, actionCode: actionCode),
      );

  /// Sends a 2D scroll delta (`dx` horizontal, `dy` vertical), clamped to `[-5000, 5000]`.
  bool sendScroll2D(int dx, int dy) =>
      sendEncrypted(BinaryOpcode.input, encodeScroll2D(dx, dy));

  /// Sends an encrypted Client Frame Decode ACK (`0x0E`) containing the 4-byte
  /// big-endian uint32 [frameSeq] to replenish host backpressure credit.
  bool sendFrameAck(int frameSeq) {
    final Uint8List buf = Uint8List(4);
    ByteData.sublistView(buf).setUint32(0, frameSeq & 0xFFFFFFFF, Endian.big);
    return sendEncrypted(BinaryOpcode.frameAck, buf);
  }

  /// Sends encrypted viewport resolution, JPEG quality, and FPS tuning (`0x0A`).
  bool sendViewportConfig({
    required int width,
    required int height,
    required int quality,
    required int fps,
    bool frameAck = true,
    int? maxWidth,
    int? maxHeight,
  }) {
    final Map<String, dynamic> payload = <String, dynamic>{
      'width': width.clamp(160, 7680),
      'height': height.clamp(90, 4320),
      'quality': quality.clamp(10, 100),
      'fps': fps.clamp(5, 60),
      'frame_ack': frameAck,
      if (maxWidth != null) 'max_width': maxWidth.clamp(160, 7680),
      if (maxHeight != null) 'max_height': maxHeight.clamp(90, 4320),
    };
    return sendEncrypted(
      BinaryOpcode.viewportResize,
      Uint8List.fromList(utf8.encode(jsonEncode(payload))),
    );
  }

  /// Requests a single lightweight JPEG preview snapshot (`0x0A`) without
  /// starting continuous desktop streaming.
  bool requestSnapshot({
    int maxWidth = 640,
    int maxHeight = 360,
    int quality = 55,
  }) {
    final Map<String, dynamic> payload = <String, dynamic>{
      'snapshot': true,
      'stream_enabled': false,
      'width': maxWidth.clamp(160, 7680),
      'height': maxHeight.clamp(90, 4320),
      'quality': quality.clamp(10, 100),
      'frame_ack': true,
    };
    return sendEncrypted(
      BinaryOpcode.viewportResize,
      Uint8List.fromList(utf8.encode(jsonEncode(payload))),
    );
  }

  /// Sends clipboard text (`0x07`) to overwrite the host PC clipboard.
  bool sendClipboard(String text) =>
      sendEncrypted(BinaryOpcode.clip, Uint8List.fromList(utf8.encode(text)));

  /// Requests the host PC's current clipboard contents (`0x07` empty payload).
  bool requestClipboard() => sendEncrypted(BinaryOpcode.clip, Uint8List(0));

  /// Dispatches a remote audio/media/lock control command (`0x09`) to the host PC.
  /// Supported actions: `volume_up`, `volume_down`, `mute`, `play_pause`, `next`, `prev`, `lock_pc`.
  bool sendAudioCommand(String action, {int steps = 1}) {
    return sendEncrypted(
      BinaryOpcode.audio,
      Uint8List.fromList(
        utf8.encode(jsonEncode({'action': action, 'steps': steps})),
      ),
    );
  }

  /// Requests an immediate keyframe sync (`0xED`) over the encrypted channel.
  bool requestKeyframe() =>
      sendEncrypted(BinaryOpcode.frameSync, Uint8List.fromList(utf8.encode('{}')));

  /// Pauses or resumes video stream frames for this client session (`0x0A`).
  bool setStreamEnabled(bool enabled) => sendEncrypted(
        BinaryOpcode.viewportResize,
        Uint8List.fromList(utf8.encode(jsonEncode({'stream_enabled': enabled}))),
      );

  /// Sends an encrypted Emergency Panic Kill command (`0x05`) to the host daemon.
  bool sendPanicKill() => sendEncrypted(
        BinaryOpcode.hitl,
        Uint8List.fromList(utf8.encode(jsonEncode({'action': 'PANIC_KILL_ALL'}))),
      );

  /// Requests monitor list (`switchMonitorIndex == null`) or switches active host display (`0x0D`).
  bool requestDisplayEnum({int? switchMonitorIndex}) {
    final Uint8List payload = switchMonitorIndex == null
        ? Uint8List(0)
        : Uint8List.fromList(
            utf8.encode(jsonEncode({'monitor': switchMonitorIndex})),
          );
    return sendEncrypted(BinaryOpcode.displayEnum, payload);
  }

  /// Sends a prompt to the host's local Ollama bridge (`0x0B`), streaming tokens on [llmTokenStream].
  bool sendOllamaPrompt(String prompt,
      {String model = 'qwen2.5-coder:latest'}) {
    return sendEncrypted(
      BinaryOpcode.llmStream,
      Uint8List.fromList(
        utf8.encode(jsonEncode({'model': model, 'prompt': prompt})),
      ),
    );
  }

  /// Signs a host HITL challenge with biometric approval + pairing secret HMAC-SHA256.
  Future<bool> respondToHitlChallenge(Map<String, dynamic> challenge) async {
    final String approvalId = (challenge['approval_id'] ?? '').toString();
    final String nonce =
        (challenge['challenge_nonce'] ?? challenge['nonce'] ?? '').toString();
    final String command =
        (challenge['command'] ?? challenge['proposed_command'] ?? '').toString();
    if (approvalId.isEmpty || _inFlightHitlIds.contains(approvalId)) return false;
    _inFlightHitlIds.add(approvalId);
    try {
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
    } finally {
      _inFlightHitlIds.remove(approvalId);
    }
  }

  /// Executes a shell command over the encrypted AEAD vault channel,
  /// automatically driving interactive biometric HITL approval if requested.
  Future<ShellResult> executeCommand(
    String command, {
    Duration timeout = const Duration(seconds: 45),
  }) {
    final Future<ShellResult> next = _shellQueue.then((_) async {
      await ensureConnected(timeout: const Duration(seconds: 7));

      final Completer<ShellResult> completer = Completer<ShellResult>();
      late final StreamSubscription<ShellResult> shellSub;
      late final StreamSubscription<Map<String, dynamic>> hitlSub;
      late final StreamSubscription<HostConnectionSnapshot> stateSub;

      shellSub = shellResultStream.listen(
        (res) {
          if (!completer.isCompleted) {
            completer.complete(res);
          }
        },
        onDone: () {
          if (!completer.isCompleted) {
            completer.complete(ShellResult(
              status: 'error',
              exitCode: -1,
              output: 'Connection closed while awaiting response from $hostIp:$port.',
              command: command,
            ));
          }
        },
      );
      hitlSub = hitlChallengeStream.listen((chal) {
        unawaited(respondToHitlChallenge(chal).catchError((_) => false));
      });
      stateSub = stateStream.listen((snap) {
        if (!snap.isConnected && !snap.isConnecting && !completer.isCompleted) {
          completer.complete(ShellResult(
            status: 'error',
            exitCode: -1,
            output: snap.errorMessage ??
                'Connection lost while awaiting response from $hostIp:$port.',
            command: command,
          ));
        }
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
        await stateSub.cancel();
      }
    });
    _shellQueue = next.then((_) {}, onError: (_) {});
    return next;
  }

  bool _sendPingNow() {
    if (_disposed ||
        !_isVaultEstablished ||
        _crypto == null ||
        _channel == null) {
      return false;
    }
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
      _channel!.sink.add(pkt);
      return true;
    } catch (_) {
      _pendingPings.remove(seq)?.stop();
      return false;
    }
  }

  void _startTimers() {
    _pingTimer?.cancel();
    _watchdogTimer?.cancel();

    _pingTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      _sendPingNow();
    });

    _watchdogTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (_disposed || !_isConnected) return;
      _pruneFrameThroughput(DateTime.now().millisecondsSinceEpoch);
      final silenceSec = DateTime.now().difference(_lastInboundAt).inSeconds;
      if (silenceSec >= 12) {
        _handleDisconnect('Heartbeat watchdog timeout ($silenceSec s silence)', null);
      }
    });
  }

  void _handleDisconnect(
    String reason,
    Completer<void>? connectCompleter, {
    Object? errorOverride,
  }) {
    final String lower = reason.toLowerCase();
    final bool permanentAuthOrPolicyFailure = _authRejected ||
        lower.contains('auth') ||
        lower.contains('blacklisted') ||
        lower.contains('geofence') ||
        lower.contains('pairing secret required') ||
        lower.contains('origin not permitted');
    if (permanentAuthOrPolicyFailure) {
      _authRejected = true;
    }
    _cleanupTransportOnly();
    _setError(reason);

    final bool willReconnect = !_disposed &&
        !_manualDisconnect &&
        !permanentAuthOrPolicyFailure;
    if (willReconnect) {
      _scheduleReconnect();
    } else {
      _phase = permanentAuthOrPolicyFailure
          ? HostConnectionPhase.authFailed
          : HostConnectionPhase.disconnected;
      _emitState();
    }

    if (connectCompleter != null) {
      if (_connectCompleter == connectCompleter) {
        _connectCompleter = null;
      }
      if (!connectCompleter.isCompleted) {
        connectCompleter.completeError(errorOverride ?? StateError(reason));
      }
    }
  }

  void _scheduleReconnect() {
    if (_disposed || _manualDisconnect || _authRejected) return;
    if (_reconnectTimer?.isActive ?? false) {
      _phase = HostConnectionPhase.reconnecting;
      _emitState();
      return;
    }
    final int attemptIndex = _reconnectAttempt;
    _reconnectAttempt++;
    final double jitter = 0.8 + (_rnd.nextDouble() * 0.4); // +/- 20%
    final int delayMs = computeReconnectDelayMs(
      attemptIndex,
      jitterFactor: jitter,
    );
    _phase = HostConnectionPhase.reconnecting;
    _emitState();
    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () {
      _reconnectTimer = null;
      if (_disposed || _manualDisconnect || _authRejected) return;
      unawaited(ensureConnected().catchError((_) {}));
    });
  }

  void _cleanupTransportOnly() {
    _connectionGeneration++;
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
    _authChallengeResponded = false;
    _isConnecting = false;
    _mutualInFlight = false;
    _connectedSince = null;
    _latencyMs = null;
    _lastFrame = null;
    _lastFrameSeq = 0;
    _resetFrameThroughput();
    _frameDecryptIsolate?.dispose();
    _frameDecryptIsolate = null;
    unawaited(_subscription?.cancel());
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
    if (_retainCount <= 0) return;
    _retainCount--;
    if (_retainCount == 0) {
      disconnect();
    }
  }

  void disconnect() {
    _manualDisconnect = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _reconnectAttempt = 0;
    final pendingCompleter = _connectCompleter;
    _connectCompleter = null;
    _cleanupTransportOnly();
    _phase = HostConnectionPhase.disconnected;
    _emitState();
    if (pendingCompleter != null && !pendingCompleter.isCompleted) {
      pendingCompleter.completeError(StateError('Connection closed by client.'));
    }
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    disconnect();
    _frameDecryptIsolate?.dispose();
    _frameDecryptIsolate = null;
    frameKbPerSecNotifier.dispose();
    unawaited(_frameSyncSub?.cancel());
    _reassembler.dispose();
    unawaited(_frameCtrl.close());
    unawaited(_telemetryCtrl.close());
    unawaited(_shellCtrl.close());
    unawaited(_fileAckCtrl.close());
    unawaited(_clipCtrl.close());
    unawaited(_llmCtrl.close());
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
    final String normFp = HostConnectionClient._normalizeFp(certFingerprint ?? '');
    final HostConnectionClient? existing = _clients[k];
    if (existing != null &&
        !existing._disposed &&
        existing.sharedSecret.trim() == sharedSecret.trim() &&
        existing.useTls == useTls &&
        HostConnectionClient._normalizeFp(existing.certFingerprint ?? '') == normFp) {
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

  void invalidate(String hostIp, {int? port}) {
    if (port != null) {
      final k = _key(hostIp, port);
      _clients.remove(k)?.dispose();
      return;
    }
    final prefix = '$hostIp:';
    final keysToRemove =
        _clients.keys.where((k) => k.startsWith(prefix)).toList(growable: false);
    for (final k in keysToRemove) {
      _clients.remove(k)?.dispose();
    }
  }

  void disposeAll() {
    for (final client in _clients.values) {
      client.dispose();
    }
    _clients.clear();
  }
}
