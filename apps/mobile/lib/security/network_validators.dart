import 'dart:convert';
import 'dart:typed_data';

/// Strict input validation, normalization, and HITL security inspection utilities.
class NetworkValidators {
  static final RegExp _ipv4Re = RegExp(
    r'^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$',
  );
  static final RegExp _hostnameRe = RegExp(
    r'^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$',
  );
  static final RegExp _hexOnlyRe = RegExp(r'[^0-9A-Fa-f]');
  static final RegExp _ctrlCharRe = RegExp(r'[\x00-\x1F\x7F]');

  static String sanitizeLabel(String raw, {int maxLength = 48}) {
    final cleaned = raw.replaceAll(_ctrlCharRe, '').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.substring(0, maxLength);
  }

  static bool isValidIpOrHost(String raw) {
    final value = raw.trim();
    if (value.isEmpty || value.length > 253) return false;
    if (_ipv4Re.hasMatch(value)) return true;
    return _hostnameRe.hasMatch(value);
  }

  static bool isValidIpv4(String raw) => _ipv4Re.hasMatch(raw.trim());

  static bool isValidPort(int? port) =>
      port != null && port >= 1 && port <= 65535;

  /// Normalizes a MAC address into `AA:BB:CC:DD:EE:FF` or returns null if invalid.
  static String? normalizeMac(String raw) {
    final hex = raw.replaceAll(_hexOnlyRe, '').toUpperCase();
    if (hex.length != 12) return null;
    if (hex == '000000000000') return null;
    final parts = <String>[];
    for (int i = 0; i < 12; i += 2) {
      parts.add(hex.substring(i, i + 2));
    }
    return parts.join(':');
  }

  static Uint8List? parseMacBytes(String raw) {
    final hex = raw.replaceAll(_hexOnlyRe, '');
    if (hex.length != 12 || hex == '000000000000') return null;
    final bytes = Uint8List(6);
    for (int i = 0; i < 6; i++) {
      bytes[i] = int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16);
    }
    return bytes;
  }

  /// Computes a private-network directed broadcast address when [ip] is IPv4,
  /// falling back to `255.255.255.255`.
  static String deriveBroadcastIp(String ip) {
    final clean = ip.trim();
    if (!isValidIpv4(clean)) return '255.255.255.255';
    final parts = clean.split('.');
    return '${parts[0]}.${parts[1]}.${parts[2]}.255';
  }

  /// Validates and builds a WebSocket URI, rejecting non-ws/wss schemes.
  static Uri buildWebSocketUri(String host, int port, {bool useTls = false}) {
    final cleanHost = host.trim();
    if (!isValidIpOrHost(cleanHost)) {
      throw ArgumentError('Invalid host address: $cleanHost');
    }
    if (!isValidPort(port)) {
      throw ArgumentError('Invalid port: $port');
    }
    return Uri(scheme: useTls ? 'wss' : 'ws', host: cleanHost, port: port);
  }

  /// Returns a risk reason string if [command] matches destructive / elevated-risk
  /// patterns requiring explicit HITL confirmation (or biometric gate if enabled).
  static String? inspectCommandRisk(String command) {
    final normalized = _normalizeForInspection(command);
    if (normalized.isEmpty) return null;

    final checks = <({RegExp pattern, String reason})>[
      (
        pattern: RegExp(r'\brm\s+(-[a-z]*[rf][a-z]*\s+)*(/|\\|\*|--no-preserve-root)'),
        reason: 'Recursive filesystem deletion detected',
      ),
      (
        pattern: RegExp(r'\b(del|erase|rd|rmdir)\s+.*(/s|/q|c:\\)'),
        reason: 'Bulk Windows file or directory deletion detected',
      ),
      (
        pattern: RegExp(r'\b(format|mkfs|diskpart|dd\s+if=|fdisk|bcdedit)\b'),
        reason: 'Disk partitioning or formatting utility detected',
      ),
      (
        pattern: RegExp(r'\b(shutdown|reboot|poweroff|halt|init\s+0)\b'),
        reason: 'Host shutdown or reboot command detected',
      ),
      (
        pattern: RegExp(r'\b(taskkill|kill\s+-9|killall|stop-process|pkill)\b'),
        reason: 'Forced process termination command detected',
      ),
      (
        pattern: RegExp(r'\b(reg\s+delete|net\s+user|netsh\s+advfirewall|iptables\s+-f|ufw\s+disable)\b'),
        reason: 'Security policy or account modification detected',
      ),
      (
        pattern: RegExp(r'(powershell.*-enc|iex\s*\(|invoke-expression|curl.*\|\s*(sh|bash))'),
        reason: 'Encoded or piped remote code execution pattern detected',
      ),
    ];

    for (final item in checks) {
      if (item.pattern.hasMatch(normalized)) {
        return item.reason;
      }
    }
    return null;
  }

  static String _normalizeForInspection(String command) {
    String lower = command.toLowerCase();
    // Collapse common shell caret / quote obfuscation before matching
    lower = lower.replaceAll('^', '').replaceAll('"', '').replaceAll("'", '');
    // Decode standalone base64 fragments when prefixed cleanly
    final b64Match = RegExp(r'-enc(?:odedcommand)?\s+([a-z0-9+/=]{8,})', caseSensitive: false)
        .firstMatch(command);
    if (b64Match != null) {
      try {
        final decodedBytes = base64Decode(b64Match.group(1)!);
        final utf8Text = utf8.decode(decodedBytes, allowMalformed: true).toLowerCase();
        lower = '$lower $utf8Text';
      } catch (_) {}
    }
    return lower.trim();
  }
}
