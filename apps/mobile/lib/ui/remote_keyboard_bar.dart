import 'dart:async';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/fluid_theme.dart';

/// Inline live remote keyboard bar & scrollable PC shortcut strip.
///
/// Supports:
/// - **LIVE mode** (default): streams characters and backspaces to the remote PC
///   in real time as the user types on the phone's soft keyboard.
/// - **BATCH mode**: buffers text cleanly for passwords or multi-word commands,
///   dispatching on Send / Enter.
/// - **Scrollable PC Shortcut Strip**: `Esc`, `Tab`, `Win`, `Win+D`, `Alt+Tab`,
///   `Ctrl+C/V/Z/S/A`, `Alt+F4`, `Bksp`, `Del`, `Enter`, Arrow keys, navigation
///   keys, and an expandable `F1`–`F12` function row.
class RemoteKeyboardBar extends StatefulWidget {
  final void Function(String text, {bool pressEnter}) onTypeText;
  final void Function(String key) onKey;
  final void Function(List<String> keys) onHotkey;
  final VoidCallback? onClose;
  final bool autofocus;
  final bool hapticsEnabled;

  const RemoteKeyboardBar({
    super.key,
    required this.onTypeText,
    required this.onKey,
    required this.onHotkey,
    this.onClose,
    this.autofocus = true,
    this.hapticsEnabled = true,
  });

  @override
  State<RemoteKeyboardBar> createState() => _RemoteKeyboardBarState();
}

class _RemoteKeyboardBarState extends State<RemoteKeyboardBar> {
  final TextEditingController _textController = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  bool _liveMode = true;
  bool _showFunctionKeys = false;
  String _prevLiveText = '';

  @override
  void dispose() {
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _haptic() {
    if (!widget.hapticsEnabled) return;
    unawaited(HapticFeedback.selectionClick().catchError((_) {}));
  }

  void _handleTextChanged(String next) {
    if (!_liveMode) {
      setState(() {});
      return;
    }

    // Diff by Unicode scalar values (runes) rather than UTF-16 code units so
    // surrogate-pair characters (e.g. emojis) never emit 2 backspaces or split
    // into invalid lone surrogates.
    final List<int> prevRunes = _prevLiveText.runes.toList(growable: false);
    final List<int> nextRunes = next.runes.toList(growable: false);
    final int minLen = math.min(prevRunes.length, nextRunes.length);
    int common = 0;
    while (common < minLen && prevRunes[common] == nextRunes[common]) {
      common++;
    }

    final int deletions = prevRunes.length - common;
    for (int i = 0; i < deletions; i++) {
      widget.onKey('backspace');
    }

    if (common < nextRunes.length) {
      final String inserted = String.fromCharCodes(nextRunes.sublist(common));
      if (inserted.isNotEmpty) {
        widget.onTypeText(inserted, pressEnter: false);
      }
    }

    _prevLiveText = next;
  }

  void _handleSubmit(String value) {
    _haptic();
    if (_liveMode) {
      widget.onKey('enter');
      _textController.clear();
      _prevLiveText = '';
      _focusNode.requestFocus();
    } else {
      if (value.isNotEmpty) {
        widget.onTypeText(value, pressEnter: true);
        _textController.clear();
        _prevLiveText = '';
      } else {
        widget.onKey('enter');
      }
      setState(() {});
      _focusNode.requestFocus();
    }
  }

  void _sendBatchWithoutEnter() {
    _haptic();
    final String val = _textController.text;
    if (val.isNotEmpty) {
      widget.onTypeText(val, pressEnter: false);
      _textController.clear();
      _prevLiveText = '';
      setState(() {});
    }
  }

  void _triggerKey(String key) {
    _haptic();
    widget.onKey(key);
  }

  void _triggerHotkey(List<String> keys) {
    _haptic();
    widget.onHotkey(keys);
  }

  @override
  Widget build(BuildContext context) {
    final CyberPalette palette = context.palette;
    final double sigma = palette.glass.blurSigma;

    final Widget panel = Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: palette.surfaceElevated.withValues(
          alpha: sigma > 0 ? (palette.isDaylight ? 0.92 : 0.88) : 0.97,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: palette.isDaylight
              ? Colors.white.withValues(alpha: 0.90)
              : palette.primary.withValues(alpha: 0.38),
          width: 1.1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.26),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 1. Live quick-typing row
          Row(
            children: [
              _buildModeChip(palette),
              const SizedBox(width: 6),
              Expanded(
                child: SizedBox(
                  height: 36,
                  child: TextField(
                    key: const ValueKey('remote-keyboard-input'),
                    controller: _textController,
                    focusNode: _focusNode,
                    autofocus: widget.autofocus,
                    autocorrect: !_liveMode,
                    enableSuggestions: !_liveMode,
                    textInputAction: TextInputAction.send,
                    onChanged: _handleTextChanged,
                    onSubmitted: _handleSubmit,
                    style: TextStyle(
                      color: palette.textPrimary,
                      fontSize: 13,
                      fontFamily: 'monospace',
                    ),
                    decoration: InputDecoration(
                      isDense: true,
                      hintText: _liveMode
                          ? 'Live typing to PC...'
                          : 'Compose text to send...',
                      hintStyle: TextStyle(
                        color: palette.textTertiary,
                        fontSize: 11.5,
                      ),
                      filled: true,
                      fillColor: palette.isDaylight
                          ? palette.primary.withValues(alpha: 0.06)
                          : Colors.black.withValues(alpha: 0.28),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 8,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: palette.dividerColor),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(color: palette.dividerColor),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(
                          color: palette.primary,
                          width: 1.3,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 4),
              if (!_liveMode)
                _buildIconKey(
                  palette,
                  tooltip: 'Send Text',
                  icon: Icons.send_rounded,
                  isAccent: _textController.text.isNotEmpty,
                  onTap: _sendBatchWithoutEnter,
                )
              else
                _buildIconKey(
                  palette,
                  tooltip: 'Backspace',
                  icon: Icons.backspace_outlined,
                  onTap: () => _triggerKey('backspace'),
                ),
              const SizedBox(width: 4),
              _buildIconKey(
                palette,
                tooltip: 'Enter',
                icon: Icons.keyboard_return_rounded,
                isAccent: true,
                onTap: () => _handleSubmit(_textController.text),
              ),
              if (widget.onClose != null) ...[
                const SizedBox(width: 4),
                _buildIconKey(
                  palette,
                  tooltip: 'Hide Keyboard Bar',
                  icon: Icons.keyboard_hide_rounded,
                  onTap: widget.onClose!,
                ),
              ],
            ],
          ),
          const SizedBox(height: 7),

          // 2. Scrollable PC shortcut & arrow strip
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            child: Row(
              children: [
                _buildKeycap(
                  palette,
                  label: _showFunctionKeys ? 'Fn ●' : 'Fn',
                  isAccent: _showFunctionKeys,
                  onTap: () {
                    _haptic();
                    setState(() => _showFunctionKeys = !_showFunctionKeys);
                  },
                ),
                const SizedBox(width: 5),
                _buildKeycap(palette, label: 'ESC', onTap: () => _triggerKey('esc')),
                const SizedBox(width: 5),
                _buildKeycap(palette, label: 'TAB', onTap: () => _triggerKey('tab')),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'WIN',
                  onTap: () => _triggerHotkey(const ['win']),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'WIN+D',
                  onTap: () => _triggerHotkey(const ['win', 'd']),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'ALT+TAB',
                  onTap: () => _triggerHotkey(const ['alt', 'tab']),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'CTRL+C',
                  onTap: () => _triggerHotkey(const ['ctrl', 'c']),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'CTRL+V',
                  onTap: () => _triggerHotkey(const ['ctrl', 'v']),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'CTRL+Z',
                  onTap: () => _triggerHotkey(const ['ctrl', 'z']),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'CTRL+S',
                  onTap: () => _triggerHotkey(const ['ctrl', 's']),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'CTRL+A',
                  onTap: () => _triggerHotkey(const ['ctrl', 'a']),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'ALT+F4',
                  isDanger: true,
                  onTap: () => _triggerHotkey(const ['alt', 'f4']),
                ),
                const SizedBox(width: 8),
                // Arrow cluster
                _buildKeycap(palette, label: '←', onTap: () => _triggerKey('left')),
                const SizedBox(width: 4),
                _buildKeycap(palette, label: '↑', onTap: () => _triggerKey('up')),
                const SizedBox(width: 4),
                _buildKeycap(palette, label: '↓', onTap: () => _triggerKey('down')),
                const SizedBox(width: 4),
                _buildKeycap(palette, label: '→', onTap: () => _triggerKey('right')),
                const SizedBox(width: 8),
                // Editing & Navigation
                _buildKeycap(
                  palette,
                  label: 'BKSP',
                  onTap: () => _triggerKey('backspace'),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'DEL',
                  onTap: () => _triggerKey('delete'),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'HOME',
                  onTap: () => _triggerKey('home'),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'END',
                  onTap: () => _triggerKey('end'),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'PGUP',
                  onTap: () => _triggerKey('pageup'),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'PGDN',
                  onTap: () => _triggerKey('pagedown'),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'ENTER',
                  isAccent: true,
                  onTap: () => _triggerKey('enter'),
                ),
              ],
            ),
          ),

          // 3. Expandable F1–F12 function key strip
          if (_showFunctionKeys) ...[
            const SizedBox(height: 6),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(),
              child: Row(
                children: [
                  for (int i = 1; i <= 12; i++) ...[
                    if (i > 1) const SizedBox(width: 5),
                    _buildKeycap(
                      palette,
                      label: 'F$i',
                      onTap: () => _triggerKey('f$i'),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );

    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: sigma > 0
          ? BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
              child: panel,
            )
          : panel,
    );
  }

  Widget _buildModeChip(CyberPalette palette) {
    return Tooltip(
      message: _liveMode
          ? 'Live mode: keys send immediately (tap for Batch)'
          : 'Batch mode: compose text then tap Send (tap for Live)',
      child: InkWell(
        key: const ValueKey('remote-keyboard-mode-toggle'),
        onTap: () {
          _haptic();
          setState(() {
            _liveMode = !_liveMode;
            _textController.clear();
            _prevLiveText = '';
          });
        },
        borderRadius: BorderRadius.circular(10),
        child: Container(
          height: 34,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: _liveMode
                ? palette.primary.withValues(
                    alpha: palette.isDaylight ? 0.16 : 0.24,
                  )
                : palette.surface.withValues(alpha: 0.7),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: _liveMode ? palette.primary : palette.dividerColor,
            ),
          ),
          child: Text(
            _liveMode ? 'LIVE' : 'TEXT',
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: 10,
              fontWeight: FontWeight.w800,
              color: _liveMode ? palette.primary : palette.textSecondary,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildIconKey(
    CyberPalette palette, {
    required String tooltip,
    required IconData icon,
    required VoidCallback onTap,
    bool isAccent = false,
  }) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: isAccent
                ? palette.primary.withValues(
                    alpha: palette.isDaylight ? 0.16 : 0.25,
                  )
                : palette.isDaylight
                    ? palette.primary.withValues(alpha: 0.07)
                    : Colors.white.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isAccent ? palette.primary : palette.dividerColor,
            ),
          ),
          child: Icon(
            icon,
            size: 17,
            color: isAccent ? palette.primary : palette.textPrimary,
          ),
        ),
      ),
    );
  }

  Widget _buildKeycap(
    CyberPalette palette, {
    required String label,
    required VoidCallback onTap,
    bool isAccent = false,
    bool isDanger = false,
  }) {
    final Color fgColor = isDanger
        ? palette.accent
        : isAccent
            ? palette.primary
            : palette.textPrimary;
    final Color borderColor = isDanger
        ? palette.accent.withValues(alpha: 0.55)
        : isAccent
            ? palette.primary
            : palette.dividerColor;
    final Color bgColor = isDanger
        ? palette.accent.withValues(alpha: 0.12)
        : isAccent
            ? palette.primary.withValues(
                alpha: palette.isDaylight ? 0.16 : 0.24,
              )
            : palette.isDaylight
                ? palette.primary.withValues(alpha: 0.06)
                : Colors.white.withValues(alpha: 0.08);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(9),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(color: borderColor),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              color: fgColor,
            ),
          ),
        ),
      ),
    );
  }
}
