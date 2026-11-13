package com.cst.autonomouslan

import android.content.Context
import android.os.Build
import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class MainActivity : FlutterFragmentActivity() {
    companion object {
        private const val KEYSTORE_CHANNEL = "com.cst.autonomouslan/keystore"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val MASTER_KEY_ALIAS = "ai_netcontroller_master_aes_v1"
        private const val PREFS_NAME = "ai_net_keystore_prefs"
        private const val WRAPPED_KEY_PREF = "wrapped_hive_key_v1"
        private const val AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val HIVE_KEY_BYTES = 32
    }

    private val keystoreLock = Any()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, KEYSTORE_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "getOrCreateHiveKey" -> {
                        try {
                            result.success(getOrCreateHiveKey())
                        } catch (e: Exception) {
                            result.error("KEYSTORE_ERROR", "Failed to unlock hardware-backed vault key", null)
                        }
                    }
                    "sealSecret" -> {
                        val plain = call.argument<ByteArray>("plain")
                        if (plain == null) {
                            result.error("INVALID_ARGS", "Missing 'plain' byte array", null)
                        } else {
                            try {
                                result.success(sealWithKeystore(plain))
                            } catch (e: Exception) {
                                result.error("KEYSTORE_SEAL_ERROR", "Failed to seal secret", null)
                            }
                        }
                    }
                    "unsealSecret" -> {
                        val blob = call.argument<ByteArray>("blob")
                        if (blob == null || blob.size < 13) {
                            result.error("INVALID_ARGS", "Missing or malformed sealed blob", null)
                        } else {
                            try {
                                result.success(unsealWithKeystore(blob))
                            } catch (e: Exception) {
                                result.error("KEYSTORE_UNSEAL_ERROR", "Failed to unseal secret", null)
                            }
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun getOrCreateMasterKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = keyStore.getKey(MASTER_KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            MASTER_KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    private fun sealWithKeystore(plain: ByteArray): ByteArray {
        val masterKey = getOrCreateMasterKey()
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, masterKey)
        val iv = cipher.iv
        val encrypted = cipher.doFinal(plain)
        val out = ByteArray(1 + iv.size + encrypted.size)
        out[0] = iv.size.toByte()
        System.arraycopy(iv, 0, out, 1, iv.size)
        System.arraycopy(encrypted, 0, out, 1 + iv.size, encrypted.size)
        return out
    }

    private fun unsealWithKeystore(blob: ByteArray): ByteArray {
        val ivLen = blob[0].toInt() and 0xFF
        if (ivLen < 12 || blob.size <= 1 + ivLen + 16) {
            throw IllegalArgumentException("Malformed keystore sealed payload")
        }
        val iv = blob.copyOfRange(1, 1 + ivLen)
        val ct = blob.copyOfRange(1 + ivLen, blob.size)
        val masterKey = getOrCreateMasterKey()
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, masterKey, GCMParameterSpec(GCM_TAG_BITS, iv))
        return cipher.doFinal(ct)
    }

    private fun getOrCreateHiveKey(): ByteArray {
        synchronized(keystoreLock) {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val encoded = prefs.getString(WRAPPED_KEY_PREF, null)
            if (!encoded.isNullOrEmpty()) {
                try {
                    val unwrapped = unsealWithKeystore(Base64.decode(encoded, Base64.NO_WRAP))
                    if (unwrapped.size == HIVE_KEY_BYTES) {
                        return unwrapped
                    }
                    unwrapped.fill(0)
                } catch (_: Exception) {
                    // Keystore alias invalidated (e.g. restore/reinstall); rotate cleanly
                }
            }
            val freshKey = ByteArray(HIVE_KEY_BYTES)
            SecureRandom().nextBytes(freshKey)
            val sealed = sealWithKeystore(freshKey)
            prefs.edit()
                .putString(WRAPPED_KEY_PREF, Base64.encodeToString(sealed, Base64.NO_WRAP))
                .apply()
            return freshKey
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Enable hardware accelerated smooth rendering pipeline
        window.setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        )

        // Automatically unlock highest available display refresh rate (120Hz / 90Hz)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val targetModeId = getHighRefreshRateModeId()
            if (targetModeId != 0) {
                val params = window.attributes
                params.preferredDisplayModeId = targetModeId
                window.attributes = params
            }
        }
    }

    private fun getHighRefreshRateModeId(): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val display = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                display
            } else {
                @Suppress("DEPRECATION")
                windowManager.defaultDisplay
            }
            val modes = display?.supportedModes ?: return 0
            val activeMode = display.mode
            var highestRate = 60.0f
            var targetModeId = 0
            for (mode in modes) {
                if (activeMode != null &&
                    (mode.physicalWidth != activeMode.physicalWidth ||
                        mode.physicalHeight != activeMode.physicalHeight)
                ) {
                    continue
                }
                if (mode.refreshRate > highestRate) {
                    highestRate = mode.refreshRate
                    targetModeId = mode.modeId
                }
            }
            return targetModeId
        }
        return 0
    }
}
