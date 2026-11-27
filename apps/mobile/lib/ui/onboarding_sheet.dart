import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/fluid_theme.dart';

class AdaptiveOnboardingSheet extends StatefulWidget {
  final VoidCallback? onCompleted;

  const AdaptiveOnboardingSheet({super.key, this.onCompleted});

  static Future<void> show(
    BuildContext context, {
    VoidCallback? onCompleted,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => AdaptiveOnboardingSheet(onCompleted: onCompleted),
    );
  }

  @override
  State<AdaptiveOnboardingSheet> createState() =>
      _AdaptiveOnboardingSheetState();
}

class _AdaptiveOnboardingSheetState extends State<AdaptiveOnboardingSheet> {
  int _currentPage = 0;
  final PageController _pageController = PageController();

  static const int _totalPages = 4;

  void _completeAndClose() {
    widget.onCompleted?.call();
    if (mounted) Navigator.of(context).pop();
  }

  void _goToPage(int index) {
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    if (disableAnim) {
      _pageController.jumpToPage(index);
    } else {
      unawaited(
        _pageController.animateToPage(
          index,
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOutCubic,
        ),
      );
    }
  }

  void _nextPage() {
    unawaited(HapticFeedback.selectionClick().catchError((_) {}));
    if (_currentPage < _totalPages - 1) {
      _goToPage(_currentPage + 1);
    } else {
      _completeAndClose();
    }
  }

  void _prevPage() {
    if (_currentPage > 0) {
      _goToPage(_currentPage - 1);
    }
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.palette;
    final disableAnim = MediaQuery.disableAnimationsOf(context);
    final steps = <Map<String, dynamic>>[
      {
        'title': 'Welcome to AI NetController',
        'subtitle': 'Local-First Workstation Orchestration',
        'icon': Icons.bolt_rounded,
        'color': palette.primary,
        'badge': 'v0.100.0 Local-First',
        'description':
            'Direct LAN fleet control, hardware-accelerated screen streaming, Wake-on-LAN, and diagnostics without external cloud dependencies.',
      },
      {
        'title': 'Zero-Trust Security & HITL',
        'subtitle': 'Ephemeral ECDH & Explicit Human Approval',
        'icon': Icons.shield_rounded,
        'color': palette.success,
        'badge': 'X25519 + ChaCha20-Poly1305',
        'description':
            'Sessions support end-to-end AEAD encryption with sliding-window replay defense. Destructive commands always require explicit confirmation.',
      },
      {
        'title': 'Fast Host Pairing',
        'subtitle': 'LAN Scanner & 6-Digit Ephemeral PIN',
        'icon': Icons.qr_code_scanner_rounded,
        'color': palette.secondary,
        'badge': 'Port 8765 Ready',
        'description':
            'Run the desktop host agent on your PC, scan your LAN subnet or add a host manually, and pair securely using a one-time 6-digit PIN.',
      },
      {
        'title': 'Persistent Personalization',
        'subtitle': 'Custom Themes, Telemetry & Virtual Input',
        'icon': Icons.palette_rounded,
        'color': palette.warning,
        'badge': 'Saved Across Restarts',
        'description':
            'Customize accent colors, glass depth, stream FPS, and security gates in Settings — your preferences and workstations stay saved automatically.',
      },
    ];

    final size = MediaQuery.sizeOf(context);
    final isShort = size.height < 460;
    final isUltraCompact = size.width < 340;
    final iconOrbSize = isShort ? 52.0 : 76.0;

    final content = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: EdgeInsets.only(top: isShort ? 8 : 12, bottom: isShort ? 4 : 8),
          child: Container(
            width: 44,
            height: 4.5,
            decoration: BoxDecoration(
              color: palette.textTertiary.withValues(alpha: 0.35),
              borderRadius: BorderRadius.circular(999),
            ),
          ),
        ),
        Expanded(
          child: PageView.builder(
            controller: _pageController,
            onPageChanged: (idx) => setState(() => _currentPage = idx),
            itemCount: _totalPages,
            itemBuilder: (ctx, index) {
              final step = steps[index];
              final Color stepColor = step['color'] as Color;

              return SingleChildScrollView(
                padding: EdgeInsets.symmetric(
                  horizontal: isUltraCompact ? 14 : 24,
                  vertical: isShort ? 6 : 12,
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox(height: isShort ? 2 : 8),
                    Container(
                      width: iconOrbSize,
                      height: iconOrbSize,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(isShort ? 16 : 22),
                        gradient: palette.squircleGradient(
                          stepColor,
                          Color.lerp(stepColor, palette.secondary, 0.45)!,
                        ),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.45),
                          width: 1.2,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: stepColor.withValues(
                                alpha: palette.isDaylight ? 0.30 : 0.36),
                            blurRadius: 22,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: Icon(
                        step['icon'] as IconData,
                        size: isShort ? 26 : 36,
                        color: Colors.white,
                      ),
                    ),
                    SizedBox(height: isShort ? 8 : 16),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(
                        color: stepColor.withValues(
                            alpha: palette.isDaylight ? 0.12 : 0.18),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                          color: stepColor.withValues(alpha: 0.32),
                        ),
                      ),
                      child: Text(
                        step['badge'] as String,
                        style: TextStyle(
                          color: stepColor,
                          fontSize: context.fluidFont(11),
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    SizedBox(height: isShort ? 6 : 12),
                    Text(
                      step['title'] as String,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: palette.textPrimary,
                        fontSize: context.fluidFont(isShort ? 16 : 19),
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.2,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      step['subtitle'] as String,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: stepColor,
                        fontSize: context.fluidFont(12),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    SizedBox(height: isShort ? 6 : 12),
                    Text(
                      step['description'] as String,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: palette.textSecondary,
                        fontSize: context.fluidFont(13),
                        height: 1.45,
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(
            isUltraCompact ? 12 : 20,
            4,
            isUltraCompact ? 12 : 20,
            isShort ? 10 : 20,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              if (_currentPage > 0)
                TextButton(
                  style: TextButton.styleFrom(
                    minimumSize: const Size(44, 40),
                    padding: EdgeInsets.symmetric(
                        horizontal: isUltraCompact ? 8 : 14),
                  ),
                  onPressed: _prevPage,
                  child: Text(
                    'Back',
                    style: TextStyle(
                      color: palette.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                )
              else
                TextButton(
                  style: TextButton.styleFrom(
                    minimumSize: const Size(44, 40),
                    padding: EdgeInsets.symmetric(
                        horizontal: isUltraCompact ? 8 : 14),
                  ),
                  onPressed: _completeAndClose,
                  child: Text(
                    'Skip',
                    style: TextStyle(
                      color: palette.textTertiary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: List.generate(_totalPages, (i) {
                  final active = i == _currentPage;
                  return Semantics(
                    button: true,
                    selected: active,
                    label: 'Step ${i + 1} of $_totalPages',
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => _goToPage(i),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 3,
                          vertical: 8,
                        ),
                        child: AnimatedContainer(
                          duration: disableAnim
                              ? Duration.zero
                              : const Duration(milliseconds: 220),
                          width: active ? (isUltraCompact ? 16 : 22) : 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: active
                                ? palette.primary
                                : palette.textTertiary.withValues(alpha: 0.35),
                            borderRadius: BorderRadius.circular(999),
                          ),
                        ),
                      ),
                    ),
                  );
                }),
              ),
              Flexible(
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: palette.primary,
                    foregroundColor: palette.onPrimary,
                    elevation: 0,
                    shape: const StadiumBorder(),
                    padding: EdgeInsets.symmetric(
                      horizontal: isUltraCompact ? 14 : 20,
                      vertical: isShort ? 9 : 12,
                    ),
                  ),
                  onPressed: _nextPage,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      _currentPage < _totalPages - 1 ? 'Next' : 'Get Started',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );

    return SafeArea(
      child: Center(
        heightFactor: 1.0,
        child: RepaintBoundary(
          child: Container(
            constraints: BoxConstraints(
              maxHeight: (size.height * 0.86).clamp(180.0, 540.0),
              maxWidth: 520,
            ),
            margin: EdgeInsets.all(isShort ? 8 : 12),
            decoration: BoxDecoration(
              color: palette.surface
                  .withValues(alpha: palette.isDaylight ? 0.96 : 0.97),
              borderRadius: BorderRadius.circular(28),
              border: Border.all(
                color: palette.isDaylight
                    ? Colors.white.withValues(alpha: 0.9)
                    : palette.primary.withValues(alpha: 0.36),
                width: 1.2,
              ),
              boxShadow: [
                BoxShadow(
                  color: palette.primary
                      .withValues(alpha: palette.isDaylight ? 0.14 : 0.22),
                  blurRadius: 32,
                  offset: const Offset(0, 12),
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(28),
              child: content,
            ),
          ),
        ),
      ),
    );
  }
}
