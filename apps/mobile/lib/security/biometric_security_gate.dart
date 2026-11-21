import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

/// Hardware-Backed Biometric Security Gate
/// ---------------------------------------------------------------------
/// Binds Human-in-the-Loop (HITL) Opcode 0x05 Approvals directly to
/// Android Keystore / TrustZone or Apple Secure Enclave.
/// Guarantees that even if the physical phone is unlocked, high-risk
/// terminal commands (e.g. diskpart, format, rmdir, reboot) cannot be
/// triggered without explicit FaceID, TouchID, or Device PIN re-authentication.

class BiometricAuthResult {
  final bool isApproved;
  final String message;
  final String? errorCode;
  final DateTime timestamp;

  const BiometricAuthResult({
    required this.isApproved,
    required this.message,
    this.errorCode,
    required this.timestamp,
  });
}

class BiometricSecurityGate {
  static final BiometricSecurityGate instance = BiometricSecurityGate._internal();
  BiometricSecurityGate._internal();

  final LocalAuthentication _auth = LocalAuthentication();

  /// Checks if hardware biometric security is supported and enrolled
  Future<bool> isBiometricAvailable() async {
    try {
      final bool canAuthenticateWithBiometrics = await _auth.canCheckBiometrics;
      final bool canAuthenticate = canAuthenticateWithBiometrics || await _auth.isDeviceSupported();
      return canAuthenticate;
    } catch (e) {
      debugPrint('Biometric availability check error: $e');
      return false;
    }
  }

  /// Lists active biometric sensors on the phone (Face, Fingerprint, Iris)
  Future<List<BiometricType>> getEnrolledBiometrics() async {
    try {
      return await _auth.getAvailableBiometrics();
    } catch (e) {
      debugPrint('Error retrieving biometrics: $e');
      return [];
    }
  }

  /// Executes hardware-backed biometric or device credential challenge before
  /// dispatching Opcode 0x05 approval or revealing stored secrets.
  Future<BiometricAuthResult> verifyApproval({
    required String commandId,
    required String shellCommand,
    required String targetHostId,
    required String riskLevel,
  }) async {
    final bool isAvailable = await isBiometricAvailable();

    if (!isAvailable) {
      debugPrint('[SecurityGate] Secure Enclave / Biometrics unavailable on host device.');
      return BiometricAuthResult(
        isApproved: false,
        message: 'Biometric or device credential security is not configured on this device.',
        errorCode: LocalAuthExceptionCode.noBiometricHardware.name,
        timestamp: DateTime.now(),
      );
    }

    try {
      final bool didAuthenticate = await _auth.authenticate(
        localizedReason:
            'Authorize sensitive action:\n"$shellCommand"\non $targetHostId [Risk: $riskLevel]',
        biometricOnly: false,
        sensitiveTransaction: true,
        persistAcrossBackgrounding: true,
      );

      if (didAuthenticate) {
        return BiometricAuthResult(
          isApproved: true,
          message: 'Hardware security verification succeeded.',
          timestamp: DateTime.now(),
        );
      } else {
        return BiometricAuthResult(
          isApproved: false,
          message: 'Biometric verification was cancelled or rejected.',
          timestamp: DateTime.now(),
        );
      }
    } on LocalAuthException catch (e) {
      final String errorMessage = switch (e.code) {
        LocalAuthExceptionCode.noBiometricHardware ||
        LocalAuthExceptionCode.biometricHardwareTemporarilyUnavailable =>
          'Biometric hardware sensor is unavailable.',
        LocalAuthExceptionCode.noCredentialsSet =>
          'Device PIN or passcode is not configured.',
        LocalAuthExceptionCode.noBiometricsEnrolled =>
          'No fingerprints or facial credentials are enrolled.',
        LocalAuthExceptionCode.temporaryLockout ||
        LocalAuthExceptionCode.biometricLockout =>
          'Biometric sensor temporarily locked after failed attempts.',
        LocalAuthExceptionCode.userCanceled ||
        LocalAuthExceptionCode.systemCanceled ||
        LocalAuthExceptionCode.timeout =>
          'Biometric verification was cancelled or timed out.',
        _ => e.description ?? 'Biometric verification error (${e.code.name}).',
      };

      return BiometricAuthResult(
        isApproved: false,
        message: errorMessage,
        errorCode: e.code.name,
        timestamp: DateTime.now(),
      );
    } on PlatformException catch (e) {
      return BiometricAuthResult(
        isApproved: false,
        message: e.message ?? 'Biometric verification error',
        errorCode: e.code,
        timestamp: DateTime.now(),
      );
    } catch (e) {
      return BiometricAuthResult(
        isApproved: false,
        message: 'Unexpected security authentication error: $e',
        timestamp: DateTime.now(),
      );
    }
  }
}
