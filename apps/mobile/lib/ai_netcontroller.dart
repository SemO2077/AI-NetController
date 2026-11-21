/// AI NetController — Mobile Core Library
/// Unified export for binary protocol, security, services, theme, and UI.
library;

export 'protocol/binary_protocol.dart';
export 'protocol/fragmentation_engine.dart' hide kFlagEncrypted;
export 'protocol/network_framer.dart' hide kMaxPayloadSize;

export 'security/crypto_channel.dart';
export 'security/crypto_engine.dart'
    hide kKeySize, kNonceSize, kTagSize, ChaCha20Poly1305;
export 'security/biometric_security_gate.dart';
export 'security/network_validators.dart';
export 'security/secure_secret_store.dart';

export 'services/app_preferences.dart';
export 'services/file_transfer_engine.dart';
export 'services/frame_decrypt_isolate.dart';
export 'services/history_store.dart';
export 'services/host_connection_client.dart';
export 'services/lan_discovery_service.dart';
export 'services/os_integrations_manager.dart';
export 'services/thermal_governor.dart';
export 'services/zero_gc_video_pipeline.dart';

export 'theme/fluid_theme.dart';

export 'ui/activity_history_panel.dart';
export 'ui/adaptive_layout_builder.dart';
export 'ui/connection_diagnostics_sheet.dart';
export 'ui/fullscreen_stream_page.dart';
export 'ui/host_snapshot_preview.dart';
export 'ui/remote_keyboard_bar.dart';
export 'ui/responsive_device_card.dart';
export 'ui/settings_command_deck.dart';
export 'ui/touch_coordinate_mapper.dart';
export 'ui/touch_feedback_overlay.dart';
export 'ui/viewport_stream_widget.dart';
export 'ui/onboarding_sheet.dart';
export 'ui/samsung_pill_nav_bar.dart';
export 'ui/pip_stream_viewer.dart';
export 'ui/wol_hub_panel.dart';

export 'demo/demo_sandbox.dart';
