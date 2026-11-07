import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:vibration/vibration.dart';
import '../theme/fluid_theme.dart';

class AdaptiveOnboardingSheet extends StatefulWidget {
  const AdaptiveOnboardingSheet({super.key});

  static Future<void> show(BuildContext context) async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => const AdaptiveOnboardingSheet(),
    );
  }

  @override
  State<AdaptiveOnboardingSheet> createState() => _AdaptiveOnboardingSheetState();
}

class _AdaptiveOnboardingSheetState extends State<AdaptiveOnboardingSheet> {
  int _currentPage = 0;
  final PageController _pageController = PageController();

  static const int _totalPages = 4;

  final List<Map<String, dynamic>> _steps = [
    {
      'title': 'Добре дошли в AI NetController',
      'subtitle': 'Автономно Управление на Локална Компютърна Инфраструктура',
      'icon': Icons.bolt_rounded,
      'color': CyberColors.primary,
      'badge': 'v0.31.3 Local-First',
      'description':
          'Платформа от ново поколение за пълен отдалечен достъп, нисколатентен 120Hz видео стрийминг и управление с изкуствен интелект без външни облачни сървъри.',
    },
    {
      'title': 'Zero-Trust Сигурност & HITL',
      'subtitle': 'Криптография от Военен Клас & Човешки Надзор',
      'icon': Icons.shield_rounded,
      'color': CyberColors.success,
      'badge': 'RFC 8439 + RFC 6479',
      'description':
          'Всяка сесия е защитена с ефемерен X25519 & ChaCha20-Poly1305. Критичните команди изискват изрично биометрично одобрение или задържане на бутон.',
    },
    {
      'title': 'Бързо Сдвояване с Компютър',
      'subtitle': 'mDNS Авто-Откриване или QR Сканиране',
      'icon': Icons.qr_code_scanner_rounded,
      'color': CyberColors.secondary,
      'badge': 'Port 8765 Ready',
      'description':
          'Стартирайте AI_NetController_HostAgent_v0.31.3_win64.exe на вашия компютър. Мобилното приложение го открива автоматично в локалната мрежа чрез mDNS или чрез сканиране на QR код.',
    },
    {
      'title': '120Hz Екран & Виртуално Дистанционно',
      'subtitle': 'Интуитивни Жестове, Тракпад & WoL',
      'icon': Icons.touch_app_rounded,
      'color': CyberColors.warning,
      'badge': 'Sub-5ms Latency',
      'description':
          'Управлявайте мишката и клавиатурата чрез виртуалния тракпад, събуждайте спящи хостове през Wake-on-LAN и изпълнявайте шел скриптове от телефона си.',
    },
  ];

  void _nextPage() {
    Vibration.hasVibrator().then((has) {
      if (has == true) Vibration.vibrate(duration: 25);
    });
    if (_currentPage < _totalPages - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
    } else {
      Navigator.pop(context);
    }
  }

  void _prevPage() {
    if (_currentPage > 0) {
      _pageController.previousPage(
        duration: const Duration(milliseconds: 320),
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
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.82,
      ),
      margin: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: CyberColors.background.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(
          color: CyberColors.primary.withValues(alpha: 0.35),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: CyberColors.primary.withValues(alpha: 0.18),
            blurRadius: 36,
            spreadRadius: 2,
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Top Drag Handle & Step Indicator
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

              // Page Slider
              Expanded(
                child: PageView.builder(
                  controller: _pageController,
                  onPageChanged: (idx) => setState(() => _currentPage = idx),
                  itemCount: _totalPages,
                  itemBuilder: (ctx, index) {
                    final step = _steps[index];
                    final Color stepColor = step['color'];

                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          // Hero Badge & Icon
                          Container(
                            width: 80,
                            height: 80,
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
                                  blurRadius: 24,
                                ),
                              ],
                            ),
                            child: Icon(
                              step['icon'],
                              size: 40,
                              color: stepColor,
                            ),
                          ),
                          const SizedBox(height: 18),

                          // Step Badge
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
                              step['badge'],
                              style: TextStyle(
                                color: stepColor,
                                fontSize: 11,
                                fontFamily: 'monospace',
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),

                          // Title
                          Text(
                            step['title'],
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 19,
                              fontWeight: FontWeight.bold,
                              letterSpacing: -0.3,
                            ),
                          ),
                          const SizedBox(height: 6),

                          // Subtitle
                          Text(
                            step['subtitle'],
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: stepColor,
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 14),

                          // Description
                          Text(
                            step['description'],
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.68),
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

              // Bottom Navigation & Dots
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.between,
                  children: [
                    // Back or Skip Button
                    if (_currentPage > 0)
                      TextButton(
                        onPressed: _prevPage,
                        child: Text(
                          'Назад',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.7),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      )
                    else
                      TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: Text(
                          'Пропусни',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.4),
                          ),
                        ),
                      ),

                    // Step Dots Indicator
                    Row(
                      children: List.generate(_totalPages, (i) {
                        final active = i == _currentPage;
                        return AnimatedContainer(
                          duration: const Duration(milliseconds: 250),
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          width: active ? 22 : 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: active
                                ? CyberColors.primary
                                : Colors.white.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(3),
                            boxShadow: active
                                ? [
                                    BoxShadow(
                                      color: CyberColors.primary.withValues(alpha: 0.6),
                                      blurRadius: 6,
                                    ),
                                  ]
                                : null,
                          ),
                        );
                      }),
                    ),

                    // Next or Finish Button
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: CyberColors.primary,
                        foregroundColor: Colors.black,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 18, vertical: 12),
                      ),
                      onPressed: _nextPage,
                      child: Text(
                        _currentPage < _totalPages - 1 ? 'Напред' : 'Старт',
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
          ),
        ),
      ),
    );
  }
}
