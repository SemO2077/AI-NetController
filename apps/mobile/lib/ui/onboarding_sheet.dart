import 'dart:ui';
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

  void _nextPage() {
    HapticFeedback.selectionClick();
    if (_currentPage < _totalPages - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      );
    } else {
      _completeAndClose();
    }
  }

  void _prevPage() {
    if (_currentPage > 0) {
      _pageController.previousPage(
        duration: const Duration(milliseconds: 280),
        curve: Curves.easeOutCubic,
      );
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
    final sigma = palette.glass.blurSigma;
    final steps = <Map<String, dynamic>>[
      {
        'title': 'Welcome to AI NetController',
        'subtitle': 'Local-First Workstation Orchestration',
        'icon': Icons.bolt_rounded,
        'color': palette.primary,
        'badge': 'v0.51.0 Local-First',
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

    final content = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 8),
          child: Container(
            width: 44,
            height: 4.5,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(3),
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
                padding:
                    const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const SizedBox(height: 8),
                    Container(
                      width: 76,
                      height: 76,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: stepColor.withValues(alpha: 0.12),
                        border: Border.all(
                          color: stepColor.withValues(alpha: 0.4),
                          width: 1.5,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: stepColor.withValues(alpha: 0.25),
                            blurRadius: 22,
                          ),
                        ],
                      ),
                      child: Icon(
                        step['icon'] as IconData,
                        size: 38,
                        color: stepColor,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: stepColor.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: stepColor.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Text(
                        step['badge'] as String,
                        style: TextStyle(
                          color: stepColor,
                          fontSize: 11,
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      step['title'] as String,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: palette.textPrimary,
                        fontSize: 19,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 0.2,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      step['subtitle'] as String,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: stepColor.withValues(alpha: 0.85),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      step['description'] as String,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: palette.textSecondary,
                        fontSize: 13,
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
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              if (_currentPage > 0)
                TextButton(
                  onPressed: _prevPage,
                  child: Text(
                    'Back',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.72),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                )
              else
                TextButton(
                  onPressed: _completeAndClose,
                  child: Text(
                    'Skip',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.48),
                    ),
                  ),
                ),
              Row(
                children: List.generate(_totalPages, (i) {
                  final active = i == _currentPage;
                  return AnimatedContainer(
                    duration: const Duration(milliseconds: 220),
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    width: active ? 22 : 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: active
                          ? palette.primary
                          : Colors.white.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(3),
                    ),
                  );
                }),
              ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: palette.primary,
                  foregroundColor: Colors.black,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                ),
                onPressed: _nextPage,
                child: Text(
                  _currentPage < _totalPages - 1 ? 'Next' : 'Get Started',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.80,
        maxWidth: 520,
      ),
      margin: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: palette.background.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(
          color: palette.primary.withValues(alpha: 0.38),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: palette.primary.withValues(alpha: 0.16),
            blurRadius: 32,
            spreadRadius: 1,
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: sigma > 0
            ? BackdropFilter(
                filter: ImageFilter.blur(sigmaX: sigma, sigmaY: sigma),
                child: content,
              )
            : content,
      ),
    );
  }
}
