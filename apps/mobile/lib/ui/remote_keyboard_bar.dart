import 'dart:async';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/fluid_theme.dart';

/// Latch state for sticky modifier keys (`CTRL`, `ALT`, `SHIFT`, `WIN`).
enum _ModifierLatchState {
  off,
  latched, // One-shot: applies to the next key/character, then releases.
  locked, // Persistent: stays active until tapped off.
}

/// Inline live remote keyboard bar, sticky modifier latches, & PC macro strip.
///
/// Supports:
/// - **LIVE mode** (default): streams characters and backspaces to the remote PC
///   in real time as the user types on the phone's soft keyboard.
/// - **BATCH (`TEXT`) mode**: buffers text cleanly for passwords or multi-word
///   commands, dispatching on Send / Enter.
/// - **Sticky Modifiers (`CTRL`, `ALT`, `SHIFT`, `WIN`)**: tap for 1-shot latch
///   or long-press to lock across multiple combos. Applies automatically to both
///   shortcut keys (e.g. `SHIFT` + `TAB`, `ALT` + `F4`) and live typed keys
///   (e.g. `CTRL` + `f`).
/// - **Quick Clipboard Push/Pull** (when callbacks are wired) and expandable
///   **MACROS** + **Fn (`F1`–`F12`)** strips.
class RemoteKeyboardBar extends StatefulWidget {
  final void Function(String text, {bool pressEnter}) onTypeText;
  final void Function(String key) onKey;
  final void Function(List<String> keys) onHotkey;
  final VoidCallback? onClose;
  final VoidCallback? onPushClipboard;
  final VoidCallback? onPullClipboard;
  final bool autofocus;
  final bool hapticsEnabled;

  const RemoteKeyboardBar({
    super.key,
    required this.onTypeText,
    required this.onKey,
    required this.onHotkey,
    this.onClose,
    this.onPushClipboard,
    this.onPullClipboard,
    this.autofocus = true,
    this.hapticsEnabled = true,
  });

  @override
  State<RemoteKeyboardBar> createState() => _RemoteKeyboardBarState();
}

class _RemoteKeyboardBarState extends State<RemoteKeyboardBar> {
  static const List<String> _modifierOrder = <String>[
    'ctrl',
    'alt',
    'shift',
    'win',
  ];

  final TextEditingController _textController = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  bool _liveMode = true;
  bool _showFunctionKeys = false;
  bool _showMacros = false;
  String _prevLiveText = '';

  final Map<String, _ModifierLatchState> _modifiers =
      <String, _ModifierLatchState>{
    'ctrl': _ModifierLatchState.off,
    'alt': _ModifierLatchState.off,
    'shift': _ModifierLatchState.off,
    'win': _ModifierLatchState.off,
  };

  @override
  void dispose() {
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  List<String> get _activeModifiers => _modifierOrder
      .where((m) => _modifiers[m] != _ModifierLatchState.off)
      .toList(growable: false);

  bool get _hasActiveModifiers =>
      _modifiers.values.any((s) => s != _ModifierLatchState.off);

  bool get _hasLockedModifiers =>
      _modifiers.values.any((s) => s == _ModifierLatchState.locked);

  void _hapticLight() {
    if (!widget.hapticsEnabled) return;
    unawaited(HapticFeedback.selectionClick().catchError((_) {}));
  }

  void _hapticMedium() {
    if (!widget.hapticsEnabled) return;
    unawaited(HapticFeedback.mediumImpact().catchError((_) {}));
  }

  void _toggleModifierTap(String mod) {
    _hapticLight();
    setState(() {
      final current = _modifiers[mod] ?? _ModifierLatchState.off;
      _modifiers[mod] = current == _ModifierLatchState.off
          ? _ModifierLatchState.latched
          : _ModifierLatchState.off;
    });
  }

  void _toggleModifierLock(String mod) {
    final current = _modifiers[mod] ?? _ModifierLatchState.off;
    if (current == _ModifierLatchState.locked) {
      _hapticLight();
      setState(() => _modifiers[mod] = _ModifierLatchState.off);
    } else {
      _hapticMedium();
      setState(() => _modifiers[mod] = _ModifierLatchState.locked);
    }
  }

  void _releaseOneShotModifiers() {
    bool changed = false;
    for (final key in _modifierOrder) {
      if (_modifiers[key] == _ModifierLatchState.latched) {
        _modifiers[key] = _ModifierLatchState.off;
        changed = true;
      }
    }
    if (changed && mounted) {
      setState(() {});
    }
  }

  void _clearAllModifiers() {
    if (!_hasActiveModifiers) return;
    _hapticLight();
    setState(() {
      for (final key in _modifierOrder) {
        _modifiers[key] = _ModifierLatchState.off;
      }
    });
  }

  static String? _mapSingleCharToHotkeyKey(String ch) {
    if (ch == ' ') return 'space';
    if (ch.length != 1) return null;
    final int code = ch.codeUnitAt(0);
    if (code >= 0x21 && code <= 0x7E) {
      return ch.toLowerCase();
    }
    return null;
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
        final List<String> activeMods = _activeModifiers;
        if (activeMods.isNotEmpty && deletions == 0) {
          final String? hotkeyTarget = _mapSingleCharToHotkeyKey(inserted);
          if (hotkeyTarget != null) {
            _hapticLight();
            widget.onHotkey(<String>[...activeMods, hotkeyTarget]);
            _releaseOneShotModifiers();
            _textController.clear();
            _prevLiveText = '';
            return;
          }
        }
        widget.onTypeText(inserted, pressEnter: false);
      }
    }

    _prevLiveText = next;
  }

  void _handleSubmit(String value) {
    _hapticLight();
    if (_liveMode) {
      _dispatchKeyOrModified('enter');
      _textController.clear();
      _prevLiveText = '';
      _focusNode.requestFocus();
    } else {
      if (value.isNotEmpty) {
        widget.onTypeText(value, pressEnter: true);
        _textController.clear();
        _prevLiveText = '';
      } else {
        _dispatchKeyOrModified('enter');
      }
      setState(() {});
      _focusNode.requestFocus();
    }
  }

  void _sendBatchWithoutEnter() {
    _hapticLight();
    final String val = _textController.text;
    if (val.isNotEmpty) {
      widget.onTypeText(val, pressEnter: false);
      _textController.clear();
      _prevLiveText = '';
      setState(() {});
    }
  }

  void _dispatchKeyOrModified(String key) {
    final List<String> activeMods = _activeModifiers;
    if (activeMods.isNotEmpty) {
      widget.onHotkey(<String>[...activeMods, key]);
      _releaseOneShotModifiers();
    } else {
      widget.onKey(key);
    }
  }

  void _triggerKey(String key) {
    _hapticLight();
    _dispatchKeyOrModified(key);
  }

  void _triggerHotkey(List<String> keys, {bool strongHaptic = false}) {
    if (strongHaptic) {
      _hapticMedium();
    } else {
      _hapticLight();
    }
    widget.onHotkey(keys);
    _releaseOneShotModifiers();
  }

  @override
  Widget build(BuildContext context) {
    final CyberPalette palette = context.palette;
    final double sigma = palette.glass.blurSigma;
    final bool reducedMotion =
        MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    final List<String> activeMods = _activeModifiers;
    final bool hasClipboard =
        widget.onPushClipboard != null || widget.onPullClipboard != null;

    final Widget panel = Container(
      padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
      decoration: BoxDecoration(
        color: palette.surfaceElevated.withValues(
          alpha: sigma > 0 ? (palette.isDaylight ? 0.94 : 0.90) : 0.98,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: palette.isDaylight
              ? Colors.white.withValues(alpha: 0.92)
              : palette.primary.withValues(alpha: 0.40),
          width: 1.15,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: palette.isDaylight ? 0.16 : 0.34,
            ),
            blurRadius: 20,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 1. Live / Batch quick-typing input row
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
                      hintText: activeMods.isNotEmpty && _liveMode
                          ? '${activeMods.map((m) => m.toUpperCase()).join('+')}+ key...'
                          : (_liveMode
                              ? 'Live typing to PC...'
                              : 'Compose text to send...'),
                      hintStyle: TextStyle(
                        color: activeMods.isNotEmpty && _liveMode
                            ? palette.primary.withValues(alpha: 0.85)
                            : palette.textTertiary,
                        fontSize: 11.5,
                      ),
                      filled: true,
                      fillColor: palette.isDaylight
                          ? palette.primary.withValues(alpha: 0.06)
                          : Colors.black.withValues(alpha: 0.30),
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
                        borderSide: BorderSide(
                          color: activeMods.isNotEmpty
                              ? palette.primary.withValues(alpha: 0.65)
                              : palette.dividerColor,
                        ),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide(
                          color: palette.primary,
                          width: 1.4,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 5),
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

          // 2. Sticky Modifier Latch Row + Fn / Macros / Clipboard Strip
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            child: Row(
              children: [
                for (int i = 0; i < _modifierOrder.length; i++) ...[
                  if (i > 0) const SizedBox(width: 5),
                  _buildModifierKey(
                    palette,
                    mod: _modifierOrder[i],
                    reducedMotion: reducedMotion,
                  ),
                ],
                _buildRowDivider(palette),
                _buildKeycap(
                  palette,
                  key: const ValueKey('remote-keyboard-fn-toggle'),
                  label: _showFunctionKeys ? 'Fn ●' : 'Fn',
                  isAccent: _showFunctionKeys,
                  onTap: () {
                    _hapticLight();
                    setState(() => _showFunctionKeys = !_showFunctionKeys);
                  },
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  key: const ValueKey('remote-keyboard-macros-toggle'),
                  label: _showMacros ? 'MACROS ●' : 'MACROS',
                  isAccent: _showMacros,
                  onTap: () {
                    _hapticLight();
                    setState(() => _showMacros = !_showMacros);
                  },
                ),
                if (hasClipboard) ...[
                  _buildRowDivider(palette),
                  if (widget.onPushClipboard != null)
                    _buildActionPill(
                      palette,
                      key: const ValueKey('remote-keyboard-clip-push'),
                      icon: Icons.upload_rounded,
                      label: 'PUSH',
                      tooltip: 'Push Phone Clipboard to PC',
                      onTap: () {
                        _hapticLight();
                        widget.onPushClipboard!();
                      },
                    ),
                  if (widget.onPushClipboard != null &&
                      widget.onPullClipboard != null)
                    const SizedBox(width: 5),
                  if (widget.onPullClipboard != null)
                    _buildActionPill(
                      palette,
                      key: const ValueKey('remote-keyboard-clip-pull'),
                      icon: Icons.download_rounded,
                      label: 'PULL',
                      tooltip: 'Pull PC Clipboard to Phone',
                      onTap: () {
                        _hapticLight();
                        widget.onPullClipboard!();
                      },
                    ),
                ],
              ],
            ),
          ),

          // 2b. Active sticky modifier banner (tap CLEAR or press next key)
          if (activeMods.isNotEmpty) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
              decoration: BoxDecoration(
                color: palette.primary.withValues(
                  alpha: palette.isDaylight ? 0.12 : 0.18,
                ),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: palette.primary.withValues(alpha: 0.45),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    _hasLockedModifiers
                        ? Icons.lock_rounded
                        : Icons.radio_button_checked_rounded,
                    size: 13,
                    color: palette.primary,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      '${activeMods.map((m) => m.toUpperCase()).join(' + ')} + … '
                      '${_hasLockedModifiers ? '(Locked)' : '(1-shot)'}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        color: palette.primary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  InkWell(
                    key: const ValueKey('remote-keyboard-clear-mods'),
                    onTap: _clearAllModifiers,
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      child: Text(
                        'CLEAR',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          color: palette.textPrimary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 7),

          // 3. Scrollable PC shortcut & arrow strip
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            child: Row(
              children: [
                _buildKeycap(
                  palette,
                  label: 'ESC',
                  onTap: () => _triggerKey('esc'),
                ),
                const SizedBox(width: 5),
                _buildKeycap(
                  palette,
                  label: 'TAB',
                  onTap: () => _triggerKey('tab'),
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
                  onTap: () =>
                      _triggerHotkey(const ['alt', 'f4'], strongHaptic: true),
                ),
                _buildRowDivider(palette),
                // Arrow cluster
                _buildKeycap(
                  palette,
                  label: '←',
                  onTap: () => _triggerKey('left'),
                ),
                const SizedBox(width: 4),
                _buildKeycap(
                  palette,
                  label: '↑',
                  onTap: () => _triggerKey('up'),
                ),
                const SizedBox(width: 4),
                _buildKeycap(
                  palette,
                  label: '↓',
                  onTap: () => _triggerKey('down'),
                ),
                const SizedBox(width: 4),
                _buildKeycap(
                  palette,
                  label: '→',
                  onTap: () => _triggerKey('right'),
                ),
                _buildRowDivider(palette),
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

          // 4. Expandable Quick Macros strip
          if (_showMacros) ...[
            const SizedBox(height: 6),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              physics: const BouncingScrollPhysics(),
              child: Row(
                children: [
                  _buildKeycap(
                    palette,
                    label: 'CTRL+X',
                    onTap: () => _triggerHotkey(const ['ctrl', 'x']),
                  ),
                  const SizedBox(width: 5),
                  _buildKeycap(
                    palette,
                    label: 'CTRL+F',
                    onTap: () => _triggerHotkey(const ['ctrl', 'f']),
                  ),
                  const SizedBox(width: 5),
                  _buildKeycap(
                    palette,
                    label: 'CTRL+T',
                    onTap: () => _triggerHotkey(const ['ctrl', 't']),
                  ),
                  const SizedBox(width: 5),
                  _buildKeycap(
                    palette,
                    label: 'CTRL+W',
                    onTap: () => _triggerHotkey(const ['ctrl', 'w']),
                  ),
                  const SizedBox(width: 5),
                  _buildKeycap(
                    palette,
                    label: 'REOPEN TAB',
                    onTap: () => _triggerHotkey(const ['ctrl', 'shift', 't']),
                  ),
                  const SizedBox(width: 5),
                  _buildKeycap(
                    palette,
                    label: 'EXPLORER',
                    onTap: () => _triggerHotkey(const ['win', 'e']),
                  ),
                  const SizedBox(width: 5),
                  _buildKeycap(
                    palette,
                    label: 'TASK VIEW',
                    onTap: () => _triggerHotkey(const ['win', 'tab']),
                  ),
                  const SizedBox(width: 5),
                  _buildKeycap(
                    palette,
                    label: 'SNIP',
                    onTap: () => _triggerHotkey(const ['win', 'shift', 's']),
                  ),
                  const SizedBox(width: 5),
                  _buildKeycap(
                    palette,
                    label: 'WIN+L',
                    isDanger: true,
                    onTap: () =>
                        _triggerHotkey(const ['win', 'l'], strongHaptic: true),
                  ),
                ],
              ),
            ),
          ],

          // 5. Expandable F1–F12 function key strip
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

  Widget _buildRowDivider(CyberPalette palette) {
    return Container(
      width: 1,
      height: 20,
      margin: const EdgeInsets.symmetric(horizontal: 7),
      color: palette.dividerColor,
    );
  }

  Widget _buildModifierKey(
    CyberPalette palette, {
    required String mod,
    required bool reducedMotion,
  }) {
    final _ModifierLatchState state =
        _modifiers[mod] ?? _ModifierLatchState.off;
    final bool isLatched = state == _ModifierLatchState.latched;
    final bool isLocked = state == _ModifierLatchState.locked;
    final bool isActive = isLatched || isLocked;
    final String upper = mod.toUpperCase();

    final Color bgColor = isLocked
        ? palette.primary
        : isLatched
            ? palette.primary.withValues(
                alpha: palette.isDaylight ? 0.18 : 0.28,
              )
            : palette.isDaylight
                ? palette.primary.withValues(alpha: 0.06)
                : Colors.white.withValues(alpha: 0.08);

    final Color fgColor = isLocked
        ? (palette.isDaylight ? Colors.white : const Color(0xFF090B1D))
        : isLatched
            ? palette.primary
            : palette.textPrimary;

    final Color borderColor =
        isActive ? palette.primary : palette.dividerColor;

    return Tooltip(
      message: isLocked
          ? '$upper locked (tap to release)'
          : isLatched
              ? '$upper latched for next key (long-press to lock)'
              : 'Tap to latch $upper · Long-press to lock',
      child: Semantics(
        button: true,
        toggled: isActive,
        label: '$upper modifier',
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            key: ValueKey('remote-mod-$mod'),
            onTap: () => _toggleModifierTap(mod),
            onLongPress: () => _toggleModifierLock(mod),
            borderRadius: BorderRadius.circular(10),
            child: AnimatedContainer(
              duration: reducedMotion
                  ? Duration.zero
                  : const Duration(milliseconds: 140),
              constraints: const BoxConstraints(minHeight: 34, minWidth: 46),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: borderColor,
                  width: isActive ? 1.4 : 1.0,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    upper,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      color: fgColor,
                    ),
                  ),
                  if (isLocked) ...[
                    const SizedBox(width: 4),
                    Icon(Icons.lock_rounded, size: 11, color: fgColor),
                  ] else if (isLatched) ...[
                    const SizedBox(width: 4),
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: palette.primary,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildActionPill(
    CyberPalette palette, {
    Key? key,
    required IconData icon,
    required String label,
    required String tooltip,
    required VoidCallback onTap,
  }) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          key: key,
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            constraints: const BoxConstraints(minHeight: 34),
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: palette.sky.withValues(
                alpha: palette.isDaylight ? 0.12 : 0.18,
              ),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: palette.sky.withValues(alpha: 0.45)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 13, color: palette.sky),
                const SizedBox(width: 4),
                Text(
                  label,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: palette.sky,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
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
          _hapticLight();
          setState(() {
            _liveMode = !_liveMode;
            _textController.clear();
            _prevLiveText = '';
          });
        },
        borderRadius: BorderRadius.circular(10),
        child: Container(
          height: 36,
          padding: const EdgeInsets.symmetric(horizontal: 9),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: _liveMode
                ? palette.primary.withValues(
                    alpha: palette.isDaylight ? 0.16 : 0.24,
                  )
                : palette.surface.withValues(alpha: 0.78),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: _liveMode ? palette.primary : palette.dividerColor,
            ),
          ),
          child: Text(
            _liveMode ? 'LIVE' : 'TEXT',
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: 10.5,
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
          width: 36,
          height: 36,
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
            size: 18,
            color: isAccent ? palette.primary : palette.textPrimary,
          ),
        ),
      ),
    );
  }

  Widget _buildKeycap(
    CyberPalette palette, {
    Key? key,
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
        ? palette.accent.withValues(alpha: 0.58)
        : isAccent
            ? palette.primary
            : palette.dividerColor;
    final Color bgColor = isDanger
        ? palette.accent.withValues(alpha: 0.13)
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
        key: key,
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          constraints: const BoxConstraints(minHeight: 34, minWidth: 36),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: BorderRadius.circular(10),
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
