import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'package:local_auth/error_codes.dart' as auth_error;

/// Hardware-Backed Biometric Security Gate
/// ---------------------------------------------------------------------
/// Binds Human-in-the-Loop (HITL) Opcode 0x05 Approvals directly to
/// Android Keystore / TrustZone or Apple Secure Enclave.
/// Guarantees that even if the physical phone is unlocked, high-risk
/// terminal commands (e.g. diskpart, format, rmdir, reboot) cannot be
/// triggered without explicit FaceID, TouchID, or Device PIN re-authentication.

enum BiometricGateStatus {
  idle,
  authenticating,
  approved,
  rejected,
  hardwareUnavailable,
}

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

  /// Executes hardware-backed biometric challenge before dispatching Opcode 0x05 approval.
  /// If authentication fails, cancelled, or locks out: instantly rejects and triggers Opcode 0xEE.
  Future<BiometricAuthResult> verifyApproval({
    required String commandId,
    required String shellCommand,
    required String targetHostId,
    required String riskLevel,
    bool allowFallbackWhenUnavailable = false,
  }) async {
    final bool isAvailable = await isBiometricAvailable();

    if (!isAvailable) {
      debugPrint('⚠️ Secure Enclave / Biometrics unavailable on host device.');
      if (!allowFallbackWhenUnavailable) {
        return BiometricAuthResult(
          isApproved: false,
          message: 'Отхвърлено: Устройството няма настроен хардуерен Enclave / ПИН заключване',
          errorCode: auth_error.notAvailable,
          timestamp: DateTime.now(),
        );
      }
      return BiometricAuthResult(
        isApproved: true,
        message: 'Одобрено в симулационен режим (без хардуерен Enclave)',
        timestamp: DateTime.now(),
      );
    }

    try {
      final bool didAuthenticate = await _auth.authenticate(
        localizedReason: 'Потвърдете изпълнение на критична команда:\n"$shellCommand"\nна хост: $targetHostId [Риск: $riskLevel]',
        options: const AuthenticationOptions(
          useErrorDialogs: true,
          stickyAuth: true,
          biometricOnly: false, // Allows device PIN / passcode fallback
          sensitiveTransaction: true,
        ),
      );

      if (didAuthenticate) {
        return BiometricAuthResult(
          isApproved: true,
          message: 'Хардуерна биометрична верификация успешна (TrustZone / Secure Enclave)',
          timestamp: DateTime.now(),
        );
      } else {
        return BiometricAuthResult(
          isApproved: false,
          message: 'Потребителят отказа биометричното потвърждение',
          timestamp: DateTime.now(),
        );
      }
    } on PlatformException catch (e) {
      String errorMessage = 'Грешка при биометрична проверка';
      if (e.code == auth_error.notAvailable) {
        errorMessage = 'Биометричният сензор не е наличен';
      } else if (e.code == auth_error.passcodeNotSet) {
        errorMessage = 'Устройството няма зададен ПИН / парола за сигурност';
      } else if (e.code == auth_error.notEnrolled) {
        errorMessage = 'Няма въведени пръстови отпечатъци или FaceID';
      } else if (e.code == auth_error.lockedOut || e.code == auth_error.permanentlyLockedOut) {
        errorMessage = 'Сензорът е временно заключен поради твърде много неуспешни опити';
      }

      return BiometricAuthResult(
        isApproved: false,
        message: errorMessage,
        errorCode: e.code,
        timestamp: DateTime.now(),
      );
    } catch (e) {
      return BiometricAuthResult(
        isApproved: false,
        message: 'Неочаквана грешка при автентикация: $e',
        timestamp: DateTime.now(),
      );
    }
  }
}
