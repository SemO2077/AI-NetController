package com.cst.autonomouslan

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterFragmentActivity

class MainActivity : FlutterFragmentActivity() {
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
