import 'dart:async';
import 'dart:math';
import '../protocol/binary_protocol.dart';

/// Offline simulation engine for sandbox preview modes
/// or testing without active physical LAN PC hardware.
class DemoSandboxEngine {
  static final DemoSandboxEngine _instance = DemoSandboxEngine._internal();
  factory DemoSandboxEngine() => _instance;
  DemoSandboxEngine._internal();

  final _telemetryController = StreamController<TelemetryData>.broadcast();
  final _shellController = StreamController<ShellResult>.broadcast();
  final _hitlController = StreamController<HitlApprovalEvent>.broadcast();

  Stream<TelemetryData> get telemetryStream => _telemetryController.stream;
  Stream<ShellResult> get shellStream => _shellController.stream;
  Stream<HitlApprovalEvent> get hitlStream => _hitlController.stream;

  Timer? _telemetryTimer;
  bool _isRunning = false;
  final Random _random = Random();

  void start() {
    if (_isRunning) return;
    _isRunning = true;

    // Periodic mock hardware telemetry
    _telemetryTimer = Timer.periodic(const Duration(seconds: 2), (timer) {
      if (!_telemetryController.hasListener) return;

      final double cpu = 18.0 + _random.nextDouble() * 24.0;
      final double ram = 54.0 + _random.nextDouble() * 6.0;

      _telemetryController.add(TelemetryData(
        hostname: 'LAB-WORKSTATION-01',
        cpuPercent: double.parse(cpu.toStringAsFixed(1)),
        ramPercent: double.parse(ram.toStringAsFixed(1)),
        os: 'Windows 11 Pro (23H2)',
        status: 'autonomous_ready',
        timestamp: DateTime.now(),
      ));
    });
  }

  void stop() {
    _isRunning = false;
    _telemetryTimer?.cancel();
  }

  /// Simulates remote execution of terminal and LLM commands
  Future<void> executeCommand(String command) async {
    final lower = command.toLowerCase().trim();

    // Check for high-risk pattern to trigger HITL approval
    if (lower.contains('del /f') ||
        lower.contains('rmdir') ||
        lower.contains('format') ||
        lower.contains('shutdown')) {
      final approvalId = 'demo_${DateTime.now().millisecondsSinceEpoch}';
      _hitlController.add(HitlApprovalEvent(
        approvalId: approvalId,
        command: command,
        reason: 'Restricted administrative command pattern detected.',
        timestamp: DateTime.now().millisecondsSinceEpoch / 1000.0,
      ));
      return;
    }

    // Simulate processing latency
    await Future.delayed(const Duration(milliseconds: 350));

    String output;
    int exitCode = 0;

    if (lower.startsWith('ollama run') || lower.startsWith('ai:')) {
      output = '''[Ollama Local Engine: deepseek-r1:14b]
Host telemetry verified:
- CPU Load: Optimal (24.2%)
- Memory Budget: 8.4GB / 32GB Allocated
- Agentic OS Bridge status: Sandboxed (Windows Job Object ACTIVE)
Recommendation: System operating within normal thermal envelope.''';
    } else if (lower == 'ipconfig' || lower == 'ifconfig') {
      output = '''Windows IP Configuration

Ethernet adapter vEthernet (WSL):
   IPv4 Address. . . . . . . . . . . : 172.28.16.1
   Subnet Mask . . . . . . . . . . . : 255.255.240.0

Wireless LAN adapter Wi-Fi 6E:
   IPv4 Address. . . . . . . . . . . : 192.168.1.105
   Subnet Mask . . . . . . . . . . . : 255.255.255.0
   Default Gateway . . . . . . . . . : 192.168.1.1
   Directed Broadcast. . . . . . . . : 192.168.1.255''';
    } else if (lower == 'systeminfo') {
      output = '''Host Name:                 LAB-WORKSTATION-01
OS Name:                   Microsoft Windows 11 Pro
OS Version:                10.0.22631 N/A Build 22631
System Manufacturer:       Micro-Star International Co., Ltd.
Processor(s):              1 Processor(s) Installed. [01]: AMD Ryzen 9 7950X 16-Core
Total Physical Memory:     32,540 MB
Available Physical Memory: 15,280 MB
Virtualization Enabled:    Yes (Hyper-V / WSL2)''';
    } else if (lower == 'dir' || lower == 'ls') {
      output = ''' Volume in drive C has no label.
 Volume Serial Number is 4C18-932F

 Directory of C:\\AI_NetController\\Workspace

09/11/2026  10:14 AM    <DIR>          .
09/11/2026  10:14 AM    <DIR>          ..
09/11/2026  10:02 AM            42,198 agent.py
09/11/2026  09:45 AM             1,266 build_agent.spec
09/11/2026  09:40 AM               420 requirements.txt
               3 File(s)         43,884 bytes
               2 Dir(s)  482,109,247,488 bytes free''';
    } else {
      output = 'Command executed successfully: $command\nJob Object limit: 256MB RAM / Process group bound.';
    }

    _shellController.add(ShellResult(
      status: 'success',
      exitCode: exitCode,
      output: output,
      command: command,
    ));
  }

  /// Approves or rejects simulated HITL request
  void resolveHitl(String approvalId, bool approved) {
    if (approved) {
      _shellController.add(ShellResult(
        status: 'success',
        exitCode: 0,
        output: '[HITL OPERATOR OVERRIDE ACCEPTED]\nCommand executed with manual authorization.',
        command: 'Operator Approval: $approvalId',
      ));
    } else {
      _shellController.add(ShellResult(
        status: 'blocked',
        exitCode: 1,
        output: '[HITL SECURITY REJECTED]\nExecution aborted by operator policy.',
        command: 'Operator Rejected: $approvalId',
      ));
    }
  }

  void dispose() {
    stop();
  }
}
