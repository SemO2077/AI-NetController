import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Maximize2,
  Minimize2,
  Camera,
  RefreshCw,
  Monitor,
  Activity,
  Shield,
  Terminal,
  Cpu,
  Keyboard,
  Volume2,
  VolumeX,
  Lock,
  Send,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Layers,
  FolderOpen,
  Globe,
  AppWindow,
  Play,
  XCircle,
  CheckCircle2,
  Loader2,
  Hand,
  Clipboard,
  KeyRound
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HostDevice } from '../../types';
import { ScreenAspectPreset, computeContainedScreenRect } from '../../utils/viewportScale';
import { subscribeScreenFrames, getLatestScreenFrame } from '../../store/screenStore';
import { useUIStore } from '../../store/uiStore';
import { triggerHapticFeedback } from '../../services/hapticService';
import { buildHostWsUri, getStoredAuthToken, pairHostWithPin } from '../../services/securityService';
import { copyToClipboard } from '../../utils/clipboard';
import { useTranslation } from '../../i18n/useTranslation';

export interface ScreenViewerModalProps {
  isOpen?: boolean;
  device: HostDevice | null;
  onClose: () => void;
  isCapturing?: boolean;
  isConnected?: boolean;
  wsUrl?: string;
  availableDisplays?: Array<{ id?: number; index?: number; label?: string; name?: string; width: number; height: number; primary?: boolean }>;
  activeDisplayIndex?: number;
  lastHostClipboard?: { text: string; updatedAt: number } | null;
  isVaultEncrypted?: boolean;
  onConnectWs?: (url?: string) => void;
  onOpenConnection?: () => void;
  onRefreshFrame?: (dimensions?: { width: number; height: number }, silent?: boolean) => void;
  onSendInputOpcode?: (opcode: number, payload: Record<string, any> | string) => boolean;
}

interface ClickRipple {
  id: number;
  xPct: number;
  yPct: number;
  button: 'left' | 'right' | 'double';
  label: string;
}

interface ContextMenuState {
  xPct: number;
  yPct: number;
  pxX: number;
  pxY: number;
}

export const ScreenViewerModal: React.FC<ScreenViewerModalProps> = ({
  isOpen = true,
  device,
  onClose,
  isCapturing: externalCapturing = false,
  isConnected,
  wsUrl,
  availableDisplays = [],
  activeDisplayIndex = 1,
  lastHostClipboard = null,
  isVaultEncrypted = false,
  onConnectWs,
  onOpenConnection,
  onRefreshFrame,
  onSendInputOpcode
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';
  const selectedModel = useUIStore((s) => s.selectedModel);

  const [quality, setQuality] = useState<'High' | 'Medium' | 'Low'>('High');
  const [aspectPreset, setAspectPreset] = useState<ScreenAspectPreset>('fit');
  const [zoomFactor, setZoomFactor] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [localCapturing, setLocalCapturing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [streamTimedOut, setStreamTimedOut] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [liveFps, setLiveFps] = useState(0);
  const [inlinePin, setInlinePin] = useState('');
  const [isPairingInline, setIsPairingInline] = useState(false);
  const [inlinePairError, setInlinePairError] = useState<string | null>(null);
  const [pendingAiActions, setPendingAiActions] = useState<Array<Record<string, any>>>([]);

  const isCapturing = localCapturing || externalCapturing;
  const isWsReady = isConnected !== false;
  const isDeviceOnline = Boolean(
    device &&
      (device.isOnline ||
        (device as any).status === 'Online' ||
        (isWsReady && hasFrame))
  );

  // Remote Input State
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number }>({ x: 50, y: 50 });

  // AI & Keyboard Bar State
  const [inputMode, setInputMode] = useState<'ai' | 'keyboard'>('ai');
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiBusy, setIsAiBusy] = useState(false);
  const [aiStatusReply, setAiStatusReply] = useState<string | null>(null);
  const [keyboardText, setKeyboardText] = useState('');
  const [lastActionFeedback, setLastActionFeedback] = useState<string | null>(null);
  const [showQuickActions, setShowQuickActions] = useState(true);

  // One-Tap Left Click & Long-Press (1s Hold) Right Click State
  const [ripples, setRipples] = useState<ClickRipple[]>([]);
  const [holdIndicator, setHoldIndicator] = useState<{ xPct: number; yPct: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const screenStageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasNatSizeRef = useRef<{ width: number; height: number }>({ width: 1920, height: 1080 });
  const hasFrameRef = useRef(false);
  const isPausedRef = useRef(isPaused);
  const pendingFrameRef = useRef<ArrayBuffer | null>(null);
  const decodingRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const onRefreshFrameRef = useRef(onRefreshFrame);
  const onSendInputOpcodeRef = useRef(onSendInputOpcode);
  onRefreshFrameRef.current = onRefreshFrame;
  onSendInputOpcodeRef.current = onSendInputOpcode;
  isPausedRef.current = isPaused;
  const aiInputRef = useRef<HTMLInputElement>(null);
  const keyboardInputRef = useRef<HTMLInputElement>(null);
  const lastMouseMoveSentRef = useRef<number>(0);

  const holdTimerRef = useRef<number | null>(null);
  const holdIndicatorTimerRef = useRef<number | null>(null);
  const timersRef = useRef<Set<number>>(new Set());
  const lastClipboardSeenRef = useRef<number>(0);
  const pointerDownInfoRef = useRef<{
    startX: number;
    startY: number;
    xPct: number;
    yPct: number;
    holdTriggered: boolean;
    pointerId: number;
  } | null>(null);

  const scheduleTimer = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  const showFeedback = useCallback((msg: string) => {
    setLastActionFeedback(msg);
  }, []);

  useEffect(() => {
    if (!lastActionFeedback) return;
    const timer = window.setTimeout(() => setLastActionFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [lastActionFeedback]);

  const addRipple = useCallback(
    (xPct: number, yPct: number, button: 'left' | 'right' | 'double', label: string) => {
      const id = Date.now() + Math.random();
      setRipples((prev) => [...prev.slice(-4), { id, xPct, yPct, button, label }]);
      scheduleTimer(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id));
      }, 900);
    },
    [scheduleTimer]
  );

  useEffect(() => {
    if (!isOpen || !lastHostClipboard || lastHostClipboard.updatedAt === lastClipboardSeenRef.current) {
      return;
    }
    lastClipboardSeenRef.current = lastHostClipboard.updatedAt;
    if (lastHostClipboard.text) {
      copyToClipboard(lastHostClipboard.text);
      showFeedback(
        isBg
          ? `Клипбордът от PC е копиран (${lastHostClipboard.text.length} знака)`
          : `Copied PC clipboard (${lastHostClipboard.text.length} chars)`
      );
    } else {
      showFeedback(isBg ? 'Клипбордът на PC е празен' : 'Remote PC clipboard is empty');
    }
  }, [isOpen, lastHostClipboard, isBg, showFeedback]);

  // Execute a real PC control action via authenticated binary WebSocket (no dual WS+HTTP dispatch)
  const dispatchPcAction = useCallback(
    async (payload: Record<string, any>, feedbackLabel?: string) => {
      if (!device || !isDeviceOnline) return;

      const isShellAction = payload.type === 'terminal_command' || payload.type === 'shell_exec';
      if (!isShellAction && !isWsReady) {
        showFeedback(
          isBg
            ? 'Няма активна WebSocket връзка с хост агента'
            : 'Host agent WebSocket disconnected — connect first'
        );
        return;
      }

      if (onSendInputOpcode && isWsReady && !isShellAction) {
        const isAudioOrLock = payload.type === 'media_control' || payload.type === 'lock_pc';
        const sentViaWs = onSendInputOpcode(isAudioOrLock ? 0x09 : 0x08, payload);
        if (sentViaWs) {
          if (feedbackLabel) showFeedback(feedbackLabel);
          return;
        }
      }

      try {
        const res = await fetch('/api/pc-control/execute', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: device.id,
            hostIp: device.ip,
            ...payload
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showFeedback(
            data?.error ||
              (isBg ? `Грешка при команда (HTTP ${res.status})` : `Host control error (HTTP ${res.status})`)
          );
          return;
        }
        if (feedbackLabel) {
          showFeedback(feedbackLabel);
        } else if (data.summary) {
          showFeedback(data.summary);
        }
      } catch {
        showFeedback(isBg ? 'Няма връзка с Control Server' : 'Control server unreachable');
      }
    },
    [device, isBg, isDeviceOnline, isWsReady, onSendInputOpcode, showFeedback]
  );

  const handleInlinePairOrConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!device || isPairingInline) return;
    const targetWs = buildHostWsUri(device.ip, device.port || 8765);
    setInlinePairError(null);
    const cleanPin = inlinePin.trim();
    if (!cleanPin) {
      if (getStoredAuthToken(targetWs)) {
        onConnectWs?.(targetWs);
        showFeedback(isBg ? 'Свързване с хоста...' : 'Connecting to host...');
        return;
      }
      setInlinePairError(
        isBg ? 'Въведете 6-цифрения PIN от PC агента.' : 'Enter the 6-digit PIN shown in the PC Agent.'
      );
      return;
    }
    if (!/^\d{6}$/.test(cleanPin)) {
      setInlinePairError(isBg ? 'PIN кодът трябва да е 6 цифри.' : 'PIN must be 6 digits.');
      return;
    }
    setIsPairingInline(true);
    try {
      const tok = await pairHostWithPin(targetWs, cleanPin);
      if (tok) {
        setInlinePin('');
        onConnectWs?.(targetWs);
        triggerHapticFeedback('heavy');
        showFeedback(isBg ? '✓ Успешно сдвоен! Свързване...' : '✓ Paired! Connecting stream...');
      } else {
        setInlinePairError(
          isBg
            ? 'Невалиден PIN или агентът не отговаря.'
            : 'Invalid PIN or host agent is unreachable.'
        );
      }
    } finally {
      setIsPairingInline(false);
    }
  };

  // Apply visual updates when AI returns actions
  const showRemoteActionRipple = useCallback(
    (act: Record<string, any>) => {
      const type = String(act.type || '').toLowerCase();
      if (type !== 'mouse_click' && type !== 'mouse_double_click' && type !== 'mouse_move') {
        return;
      }
      const natW = canvasNatSizeRef.current.width || 1920;
      const natH = canvasNatSizeRef.current.height || 1080;
      const rawX = typeof act.x === 'number' ? act.x : natW / 2;
      const rawY = typeof act.y === 'number' ? act.y : natH / 2;
      const xPct = Math.max(1, Math.min(99, (rawX / natW) * 100));
      const yPct = Math.max(1, Math.min(99, (rawY / natH) * 100));
      setCursorPos({ x: xPct, y: yPct });
      if (type === 'mouse_click' || type === 'mouse_double_click') {
        const btn =
          type === 'mouse_double_click'
            ? 'double'
            : act.button === 'right'
              ? 'right'
              : act.button === 'double'
                ? 'double'
                : 'left';
        addRipple(
          xPct,
          yPct,
          btn,
          btn === 'right'
            ? isBg
              ? 'Десен клик'
              : 'Right Click'
            : isBg
              ? 'Ляв клик'
              : 'Left Click'
        );
      }
    },
    [addRipple, isBg]
  );

  // Send natural language prompt to the AI PC Copilot
  const handleSendAiCommand = async (customPrompt?: string) => {
    const promptText = (customPrompt ?? aiPrompt).trim();
    if (!promptText || !device || isAiBusy) return;

    triggerHapticFeedback('medium');
    if (!customPrompt) setAiPrompt('');
    setIsAiBusy(true);
    setContextMenu(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: promptText }],
          model: selectedModel || 'gemini-2.5-flash',
          role: 'commander',
          autoExecute: false,
          fleetContext: {
            selectedTarget: device.id,
            hosts: [
              {
                id: device.id,
                name: device.name,
                status: isDeviceOnline ? 'Online' : 'Offline',
                ip: device.ip,
                os: device.os,
                cpu: device.cpuUsage ?? device.cpu ?? 0,
                ram: device.ramUsage ?? device.ram ?? 0,
                gpu: 0
              }
            ]
          }
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
      }

      const actions: Array<Record<string, any>> = Array.isArray(data.actions) ? data.actions : [];
      setPendingAiActions(actions);

      const cleanReply = String(data.reply || '')
        .replace(/```pc_action[\s\S]*?```/gi, '')
        .replace(/\*\*/g, '')
        .trim();

      setAiStatusReply(
        cleanReply ||
          (isBg ? `ИИ предложи ${actions.length} действие(я) за "${promptText}"` : `AI proposed ${actions.length} action(s) for "${promptText}"`)
      );
      showFeedback(
        actions.length > 0
          ? isBg
            ? `ИИ предложи ${actions.length} действие(я) — потвърдете за изпълнение`
            : `AI proposed ${actions.length} action(s) — tap Approve to run`
          : isBg
            ? 'ИИ обработи заявката'
            : 'AI processed instruction'
      );
      triggerHapticFeedback('medium');
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setAiStatusReply(
        isBg
          ? `Неуспешно изпращане: ${msg}`
          : `Failed to reach AI Control Server: ${msg}`
      );
      showFeedback(isBg ? 'Грешка при връзка със сървъра' : 'Control server request failed');
    } finally {
      setIsAiBusy(false);
    }
  };

  // Send direct keyboard text
  const handleSendKeyboardText = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!keyboardText.trim() || !device) return;
    triggerHapticFeedback('light');
    const textToSend = keyboardText;
    setKeyboardText('');
    dispatchPcAction(
      {
        type: 'type_text',
        text: textToSend,
        pressEnter: true
      },
      isBg ? `Въведен текст: "${textToSend}"` : `Typed: "${textToSend}"`
    );
  };

  // Pointer Gesture Engine:
  // - Single Click / Tap (< 1000ms) => Left Click at (x, y)
  // - Press & Hold (>= 1000ms) => Right Click at (x, y) + Context Menu
  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdIndicatorTimerRef.current !== null) {
      window.clearTimeout(holdIndicatorTimerRef.current);
      holdIndicatorTimerRef.current = null;
    }
    setHoldIndicator(null);
  };

  const getNativeScreenDimensions = useCallback(() => {
    const nat = canvasNatSizeRef.current;
    return {
      width: nat.width > 0 ? nat.width : 1920,
      height: nat.height > 0 ? nat.height : 1080,
    };
  }, []);

  const getRenderedScreenRect = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return screenStageRef.current?.getBoundingClientRect() ?? null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || aspectPreset === 'fill') {
      return rect;
    }
    const natW = canvasNatSizeRef.current.width > 0 ? canvasNatSizeRef.current.width : 1920;
    const natH = canvasNatSizeRef.current.height > 0 ? canvasNatSizeRef.current.height : 1080;
    const scale = Math.min(rect.width / natW, rect.height / natH);
    const renderedW = natW * scale;
    const renderedH = natH * scale;
    return {
      left: rect.left + (rect.width - renderedW) / 2,
      top: rect.top + (rect.height - renderedH) / 2,
      width: renderedW,
      height: renderedH,
    };
  }, [aspectPreset]);

  const computePointerPercentages = useCallback(
    (clientX: number, clientY: number) => {
      const rect = getRenderedScreenRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { xPct: 50, yPct: 50 };
      }
      const xPct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      const yPct = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
      return { xPct, yPct };
    },
    [getRenderedScreenRect]
  );

  const triggerLeftClickAt = useCallback(
    (xPct: number, yPct: number) => {
      const { width: natW, height: natH } = getNativeScreenDimensions();
      const pxX = Math.round((xPct / 100) * natW);
      const pxY = Math.round((yPct / 100) * natH);
      triggerHapticFeedback('light');
      setCursorPos({ x: xPct, y: yPct });
      setContextMenu(null);
      addRipple(
        xPct,
        yPct,
        'left',
        isBg ? `Ляв клик (${pxX}, ${pxY})` : `Left Click (${pxX}, ${pxY})`
      );
      dispatchPcAction(
        {
          type: 'mouse_click',
          button: 'left',
          x: pxX,
          y: pxY
        },
        isBg ? `Ляв клик @ ${pxX}, ${pxY}` : `Left Click @ ${pxX}, ${pxY}`
      );
    },
    [addRipple, dispatchPcAction, getNativeScreenDimensions, isBg]
  );

  const triggerRightClickAt = useCallback(
    (xPct: number, yPct: number) => {
      const { width: natW, height: natH } = getNativeScreenDimensions();
      const pxX = Math.round((xPct / 100) * natW);
      const pxY = Math.round((yPct / 100) * natH);
      triggerHapticFeedback('heavy');
      setCursorPos({ x: xPct, y: yPct });
      addRipple(
        xPct,
        yPct,
        'right',
        isBg ? `Десен клик (${pxX}, ${pxY})` : `Right Click (${pxX}, ${pxY})`
      );
      setContextMenu({ xPct, yPct, pxX, pxY });
      dispatchPcAction(
        {
          type: 'mouse_click',
          button: 'right',
          x: pxX,
          y: pxY
        },
        isBg ? `Десен клик (задържане) @ ${pxX}, ${pxY}` : `Right Click (Hold) @ ${pxX}, ${pxY}`
      );
    },
    [addRipple, dispatchPcAction, getNativeScreenDimensions, isBg]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!device || !isDeviceOnline) return;
    // Ignore clicks inside the floating context menu itself
    if ((e.target as HTMLElement).closest('[data-context-menu="true"]')) {
      return;
    }

    const { xPct, yPct } = computePointerPercentages(e.clientX, e.clientY);

    // Desktop physical right mouse button triggers right click immediately
    if (e.button === 2) {
      e.preventDefault();
      triggerRightClickAt(xPct, yPct);
      return;
    }

    setCursorPos({ x: xPct, y: yPct });

    pointerDownInfoRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      xPct,
      yPct,
      holdTriggered: false,
      pointerId: e.pointerId
    };

    clearHoldTimer();
    // Delay hold indicator by 200ms so normal taps/clicks never flash purple
    holdIndicatorTimerRef.current = window.setTimeout(() => {
      if (pointerDownInfoRef.current && !pointerDownInfoRef.current.holdTriggered) {
        setHoldIndicator({
          xPct: pointerDownInfoRef.current.xPct,
          yPct: pointerDownInfoRef.current.yPct,
        });
      }
    }, 200);

    // Hold for 1.0 second (1000ms) -> Right Click
    holdTimerRef.current = window.setTimeout(() => {
      if (pointerDownInfoRef.current) {
        pointerDownInfoRef.current.holdTriggered = true;
        setHoldIndicator(null);
        triggerRightClickAt(pointerDownInfoRef.current.xPct, pointerDownInfoRef.current.yPct);
      }
    }, 1000);
  };

  const handleViewportDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!device || !isDeviceOnline || !isWsReady) return;
    if ((e.target as HTMLElement).closest('[data-context-menu="true"]')) return;
    const { xPct, yPct } = computePointerPercentages(e.clientX, e.clientY);
    const { width: natW, height: natH } = getNativeScreenDimensions();
    const pxX = Math.round((xPct / 100) * natW);
    const pxY = Math.round((yPct / 100) * natH);
    triggerHapticFeedback('medium');
    setCursorPos({ x: xPct, y: yPct });
    addRipple(xPct, yPct, 'double', isBg ? `Двоен клик (${pxX}, ${pxY})` : `Double Click (${pxX}, ${pxY})`);
    dispatchPcAction(
      { type: 'mouse_click', button: 'double', x: pxX, y: pxY },
      isBg ? `Двоен клик @ ${pxX}, ${pxY}` : `Double Click @ ${pxX}, ${pxY}`
    );
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!device || !isDeviceOnline) return;
    const { xPct, yPct } = computePointerPercentages(e.clientX, e.clientY);

    if (pointerDownInfoRef.current) {
      const dx = Math.abs(e.clientX - pointerDownInfoRef.current.startX);
      const dy = Math.abs(e.clientY - pointerDownInfoRef.current.startY);

      // If user drags finger more than 14px, cancel long-press right click and move cursor smoothly
      if (dx > 14 || dy > 14) {
        clearHoldTimer();
        setCursorPos({ x: xPct, y: yPct });
        const now = Date.now();
        if (onSendInputOpcode && now - lastMouseMoveSentRef.current >= 55) {
          lastMouseMoveSentRef.current = now;
          const { width: natW, height: natH } = getNativeScreenDimensions();
          onSendInputOpcode(0x08, {
            type: 'mouse_move',
            x: Math.round((xPct / 100) * natW),
            y: Math.round((yPct / 100) * natH),
          });
        }
      }
      return;
    }

    if (e.pointerType === 'mouse') {
      setCursorPos({ x: xPct, y: yPct });
      const now = Date.now();
      if (onSendInputOpcode && now - lastMouseMoveSentRef.current >= 75) {
        lastMouseMoveSentRef.current = now;
        const { width: natW, height: natH } = getNativeScreenDimensions();
        onSendInputOpcode(0x08, {
          type: 'mouse_move',
          x: Math.round((xPct / 100) * natW),
          y: Math.round((yPct / 100) * natH),
        });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerDownInfoRef.current) return;
    const info = pointerDownInfoRef.current;
    pointerDownInfoRef.current = null;
    clearHoldTimer();

    if (e.button === 2) return;

    const dx = Math.abs(e.clientX - info.startX);
    const dy = Math.abs(e.clientY - info.startY);

    // If hold wasn't triggered and pointer didn't drag far -> One-Click Left Click!
    if (!info.holdTriggered && dx <= 16 && dy <= 16) {
      triggerLeftClickAt(info.xPct, info.yPct);
    }
  };

  const handlePointerCancel = () => {
    pointerDownInfoRef.current = null;
    clearHoldTimer();
  };

  // Track remote viewport stage size cleanly via ResizeObserver
  useEffect(() => {
    if (!isOpen) return;
    const el = screenStageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, isFullscreen]);

  // Zero-bufferbloat 60 FPS hardware canvas decoder (createImageBitmap + requestAnimationFrame)
  useEffect(() => {
    if (!isOpen || !device || !isDeviceOnline || !isWsReady) {
      hasFrameRef.current = false;
      setHasFrame(false);
      setLiveFps(0);
      setStreamTimedOut(false);
      return;
    }

    let cancelled = false;
    let activeBitmap: ImageBitmap | null = null;
    hasFrameRef.current = false;
    setHasFrame(false);
    setLiveFps(0);
    setStreamTimedOut(false);
    frameCountRef.current = 0;
    pendingFrameRef.current = null;
    decodingRef.current = false;

    const paintBitmapToCanvas = (bitmap: ImageBitmap) => {
      activeBitmap = bitmap;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        const bmp = activeBitmap;
        activeBitmap = null;
        try {
          if (cancelled || isPausedRef.current || !bmp) return;
          const canvas = canvasRef.current;
          if (canvas) {
            if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
              canvas.width = bmp.width;
              canvas.height = bmp.height;
            }
            canvasNatSizeRef.current = { width: bmp.width, height: bmp.height };
            const ctx = canvas.getContext('2d', { alpha: false });
            if (ctx) {
              ctx.drawImage(bmp, 0, 0);
            }
          }
          frameCountRef.current += 1;
          if (!hasFrameRef.current) {
            hasFrameRef.current = true;
            setHasFrame(true);
            setStreamTimedOut(false);
          }
        } finally {
          if (bmp) {
            try {
              bmp.close();
            } catch {
              // ignore
            }
          }
          decodingRef.current = false;
          if (!cancelled && !isPausedRef.current && pendingFrameRef.current) {
            void pumpNextFrame();
          }
        }
      });
    };

    const pumpNextFrame = async () => {
      if (cancelled || decodingRef.current || isPausedRef.current) return;
      const buf = pendingFrameRef.current;
      if (!buf) return;
      pendingFrameRef.current = null;
      decodingRef.current = true;

      try {
        const blob = new Blob([buf], { type: 'image/jpeg' });
        if (typeof createImageBitmap === 'function') {
          const bitmap = await createImageBitmap(blob);
          if (cancelled || isPausedRef.current) {
            try {
              bitmap.close();
            } catch {
              // ignore
            }
            decodingRef.current = false;
            return;
          }
          paintBitmapToCanvas(bitmap);
          return;
        }

        // Fallback decoder if createImageBitmap is unavailable
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          if (cancelled || isPausedRef.current) {
            decodingRef.current = false;
            return;
          }
          rafIdRef.current = window.requestAnimationFrame(() => {
            rafIdRef.current = null;
            try {
              const canvas = canvasRef.current;
              if (canvas) {
                const nw = img.naturalWidth || 1920;
                const nh = img.naturalHeight || 1080;
                if (canvas.width !== nw || canvas.height !== nh) {
                  canvas.width = nw;
                  canvas.height = nh;
                }
                canvasNatSizeRef.current = { width: nw, height: nh };
                const ctx = canvas.getContext('2d', { alpha: false });
                ctx?.drawImage(img, 0, 0);
              }
              frameCountRef.current += 1;
              if (!hasFrameRef.current) {
                hasFrameRef.current = true;
                setHasFrame(true);
                setStreamTimedOut(false);
              }
            } finally {
              decodingRef.current = false;
              if (!cancelled && !isPausedRef.current && pendingFrameRef.current) {
                void pumpNextFrame();
              }
            }
          });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          decodingRef.current = false;
          if (!cancelled && !isPausedRef.current && pendingFrameRef.current) {
            void pumpNextFrame();
          }
        };
        img.src = url;
      } catch {
        decodingRef.current = false;
        if (!cancelled && !isPausedRef.current && pendingFrameRef.current) {
          void pumpNextFrame();
        }
      }
    };

    const unsubscribe = subscribeScreenFrames((bytes) => {
      if (cancelled || isPausedRef.current) return;
      pendingFrameRef.current = bytes;
      void pumpNextFrame();
    });

    const initialBuf = getLatestScreenFrame();
    if (initialBuf && !isPausedRef.current) {
      pendingFrameRef.current = initialBuf;
      void pumpNextFrame();
    }

    const fpsTimer = window.setInterval(() => {
      setLiveFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(fpsTimer);
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (activeBitmap) {
        try {
          activeBitmap.close();
        } catch {
          // ignore
        }
        activeBitmap = null;
      }
      pendingFrameRef.current = null;
      decodingRef.current = false;
    };
  }, [isOpen, device?.id, isDeviceOnline, isWsReady]);

  // Trigger initial push-stream sync, display enumeration, and single 2.5s recovery keyframe request
  useEffect(() => {
    if (!isOpen || !device || !isDeviceOnline || !isWsReady) return;
    onSendInputOpcodeRef.current?.(0x0a, { stream_enabled: !isPaused });
    if (!isPaused) {
      onRefreshFrameRef.current?.(undefined, true);
    }
    onSendInputOpcodeRef.current?.(0x0d, {});
    const recoveryTimer = window.setTimeout(() => {
      if (!hasFrameRef.current && !isPausedRef.current) {
        onRefreshFrameRef.current?.(undefined, true);
      }
    }, 2500);
    return () => window.clearTimeout(recoveryTimer);
  }, [isOpen, device?.id, isDeviceOnline, isWsReady, isPaused]);

  // Negotiate optimal viewport dimensions, quality & FPS with 180ms debounce
  useEffect(() => {
    if (!isOpen || !device || !isDeviceOnline || !isWsReady) return;
    if (stageSize.width <= 0 || stageSize.height <= 0) return;

    const qualityMap: Record<'High' | 'Medium' | 'Low', { maxW: number; maxH: number; q: number; fps: number }> = {
      High: { maxW: 1920, maxH: 1080, q: 82, fps: 60 },
      Medium: { maxW: 1280, maxH: 720, q: 65, fps: 45 },
      Low: { maxW: 854, maxH: 480, q: 45, fps: 30 },
    };
    const preset = qualityMap[quality];
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    const width = Math.max(320, Math.min(preset.maxW, Math.round(stageSize.width * dpr)));
    const height = Math.max(180, Math.min(preset.maxH, Math.round(stageSize.height * dpr)));

    const timer = window.setTimeout(() => {
      onSendInputOpcodeRef.current?.(0x0a, {
        width,
        height,
        quality: preset.q,
        fps: preset.fps,
      });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [isOpen, device?.id, isDeviceOnline, isWsReady, stageSize.width, stageSize.height, quality]);

  // Avoid infinite spinner if WebSocket is connected but no JPEG frame arrives within 10s
  useEffect(() => {
    if (!isOpen || !device || !isDeviceOnline || !isWsReady || hasFrame) {
      setStreamTimedOut(false);
      return;
    }
    const timeoutId = window.setTimeout(() => setStreamTimedOut(true), 10000);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, device?.id, isDeviceOnline, isWsReady, hasFrame]);

  // Clean up long-press hold timer on unmount
  useEffect(() => {
    return () => {
      clearHoldTimer();
    };
  }, []);

  // Keyboard shortcuts: Escape (exit fullscreen / close), F (fullscreen), I (focus input / Shift+I toggle mode)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
      );

      if (e.key === 'Escape') {
        e.preventDefault();
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          onClose();
        }
        return;
      }

      if (isEditable || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setIsFullscreen((prev) => !prev);
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        if (e.shiftKey) {
          setInputMode((prev) => (prev === 'ai' ? 'keyboard' : 'ai'));
        } else if (inputMode === 'keyboard') {
          keyboardInputRef.current?.focus();
        } else {
          aiInputRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isFullscreen, inputMode, onClose]);

  const handleCapture = () => {
    const canvas = canvasRef.current;
    if (!device || !hasFrame || !canvas || canvas.width <= 0 || canvas.height <= 0) return;
    const safeName = (device.name || device.id || 'host').replace(/\s+/g, '_');
    const filename = `capture_${safeName}_${Date.now()}.jpg`;
    triggerHapticFeedback('medium');
    setLocalCapturing(true);

    try {
      const snapshotHref = canvas.toDataURL('image/jpeg', 0.92);
      const a = document.createElement('a');
      a.href = snapshotHref;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // Ignore canvas export errors
    }

    scheduleTimer(() => {
      setLocalCapturing(false);
      triggerHapticFeedback('medium');
    }, 220);
  };

  const toggleFullscreen = () => {
    triggerHapticFeedback('light');
    setIsFullscreen(!isFullscreen);
  };

  // Common PC Quick Actions
  const commonQuickActions = [
    {
      id: 'taskmgr',
      label: isBg ? 'Диспечер на задачи' : 'Task Manager',
      shortcut: device?.os === 'linux' ? 'SysMon' : 'taskmgr',
      icon: Activity,
      color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20',
      onClick: () => {
        triggerHapticFeedback('medium');
        setContextMenu(null);
        dispatchPcAction(
          {
            type: 'terminal_command',
            command:
              device?.os === 'linux'
                ? 'gnome-system-monitor || xfce4-taskmanager || ksysguard'
                : 'start taskmgr',
          },
          isBg ? 'Стартиран Диспечер на задачите' : 'Launched Task Manager'
        );
      }
    },
    {
      id: 'desktop',
      label: isBg ? 'Покажи работния плот' : 'Show Desktop',
      shortcut: 'Win+D',
      icon: Layers,
      color: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20',
      onClick: () => {
        triggerHapticFeedback('light');
        setContextMenu(null);
        dispatchPcAction(
          { type: 'key_combo', keys: 'win,d' },
          isBg ? 'Превключен работен плот (Win+D)' : 'Toggled Show Desktop (Win+D)'
        );
      }
    },
    {
      id: 'switch_app',
      label: isBg ? 'Смени прозорец' : 'Switch Window',
      shortcut: 'Alt+Tab',
      icon: AppWindow,
      color: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20',
      onClick: () => {
        triggerHapticFeedback('light');
        setContextMenu(null);
        dispatchPcAction(
          { type: 'key_combo', keys: 'alt,tab' },
          isBg ? 'Превключен активен прозорец (Alt+Tab)' : 'Switched active window (Alt+Tab)'
        );
      }
    },
    {
      id: 'explorer',
      label: isBg ? 'Файлов мениджър' : 'File Explorer',
      shortcut: 'Win+E',
      icon: FolderOpen,
      color: 'text-amber-400 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20',
      onClick: () => {
        triggerHapticFeedback('light');
        setContextMenu(null);
        dispatchPcAction(
          { type: 'key_combo', keys: 'win,e' },
          isBg ? 'Отворен Файлов мениджър (Win+E)' : 'Opened File Explorer (Win+E)'
        );
      }
    },
    {
      id: 'browser',
      label: isBg ? 'Уеб браузър' : 'Web Browser',
      shortcut: 'HTTPS',
      icon: Globe,
      color: 'text-sky-400 border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20',
      onClick: () => {
        triggerHapticFeedback('light');
        setContextMenu(null);
        dispatchPcAction(
          {
            type: 'terminal_command',
            command:
              device?.os === 'linux'
                ? 'xdg-open https://google.com'
                : 'start https://google.com',
          },
          isBg ? 'Стартиран уеб браузър' : 'Launched Web Browser'
        );
      }
    },
    {
      id: 'close_win',
      label: isBg ? 'Затвори приложение' : 'Close Window',
      shortcut: 'Alt+F4',
      icon: XCircle,
      color: 'text-rose-400 border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20',
      onClick: () => {
        triggerHapticFeedback('medium');
        setContextMenu(null);
        dispatchPcAction(
          { type: 'key_combo', keys: 'alt,f4' },
          isBg ? 'Затворен активен прозорец (Alt+F4)' : 'Closed active window (Alt+F4)'
        );
      }
    },
    {
      id: 'scroll_up',
      label: isBg ? 'Скрол нагоре' : 'Scroll Up',
      shortcut: '+300',
      icon: ArrowUp,
      color: 'text-slate-300 border-white/15 bg-white/5 hover:bg-white/10',
      onClick: () => {
        triggerHapticFeedback('light');
        dispatchPcAction(
          { type: 'mouse_scroll', dy: 300 },
          isBg ? 'Скрол нагоре' : 'Scrolled Up'
        );
      }
    },
    {
      id: 'scroll_down',
      label: isBg ? 'Скрол надолу' : 'Scroll Down',
      shortcut: '-300',
      icon: ArrowDown,
      color: 'text-slate-300 border-white/15 bg-white/5 hover:bg-white/10',
      onClick: () => {
        triggerHapticFeedback('light');
        dispatchPcAction(
          { type: 'mouse_scroll', dy: -300 },
          isBg ? 'Скрол надолу' : 'Scrolled Down'
        );
      }
    },
    {
      id: 'play_pause',
      label: isBg ? 'Медия Пауза/Пусни' : 'Play / Pause',
      shortcut: 'Media',
      icon: Play,
      color: 'text-purple-400 border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20',
      onClick: () => {
        triggerHapticFeedback('light');
        dispatchPcAction(
          { type: 'media_control', command: 'play_pause' },
          isBg ? 'Медия: Пусни / Пауза' : 'Media: Play / Pause'
        );
      }
    },
    {
      id: 'mute',
      label: isBg ? 'Заглуши звука' : 'Mute Audio',
      shortcut: 'Mute',
      icon: VolumeX,
      color: 'text-slate-300 border-white/15 bg-white/5 hover:bg-white/10',
      onClick: () => {
        triggerHapticFeedback('light');
        dispatchPcAction(
          { type: 'media_control', command: 'mute' },
          isBg ? 'Звукът е превключен (Mute)' : 'Toggled System Mute'
        );
      }
    },
    {
      id: 'vol_up',
      label: isBg ? 'Увеличи звука' : 'Volume +',
      shortcut: 'Vol+',
      icon: Volume2,
      color: 'text-slate-300 border-white/15 bg-white/5 hover:bg-white/10',
      onClick: () => {
        triggerHapticFeedback('light');
        dispatchPcAction(
          { type: 'media_control', command: 'volume_up' },
          isBg ? 'Звукът е увеличен' : 'Volume Increased'
        );
      }
    },
    {
      id: 'lock_pc',
      label: isBg ? 'Заключи компютъра' : 'Lock PC',
      shortcut: 'Win+L',
      icon: Lock,
      color: 'text-amber-300 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20',
      onClick: () => {
        triggerHapticFeedback('heavy');
        dispatchPcAction(
          { type: 'lock_pc' },
          isBg ? 'Работната станция е заключена' : 'Workstation Locked'
        );
      }
    }
  ];

  const aiSuggestions = isBg
    ? [
        'Отвори Task Manager',
        'Отвори браузър с youtube.com',
        'Покажи работния плот',
        'Отвори файловия мениджър',
        'Напиши Hello World',
        'Десен клик в центъра'
      ]
    : [
        'Open Task Manager',
        'Open browser to youtube.com',
        'Show desktop',
        'Open File Explorer',
        'Type Hello World',
        'Right click center'
      ];

  return (
    <AnimatePresence>
      {isOpen && device ? (
        <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4"
      >
        <motion.div
          initial={{ scale: 0.96, y: 16 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.96, y: 16 }}
          transition={{ type: 'spring', stiffness: 360, damping: 30 }}
          className={`bg-[#090d16] border border-white/10 rounded-2xl overflow-hidden flex flex-col shadow-2xl transition-all duration-300 ${
            isFullscreen ? 'w-full h-full rounded-none' : 'w-full max-w-6xl max-h-[96vh]'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-3.5 sm:px-4 py-3 bg-[#111726] border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
              <div className="relative shrink-0">
                <Monitor className="w-5 h-5 text-cyan-400" />
                {isDeviceOnline && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-white font-bold text-sm flex items-center gap-2 truncate">
                  {device.name}
                  <span className="text-[11px] font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded border border-white/10 hidden sm:inline">
                    {device.ip}
                  </span>
                </h3>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 min-w-0 truncate">
                  <span className="flex items-center gap-1 text-cyan-300 font-medium truncate">
                    <Hand className="w-3 h-3" />
                    {isBg
                      ? '1 клик = Ляв бутон • Задръж 1 сек = Десен бутон'
                      : '1 Tap = Left Click • Hold 1s = Right Click'}
                  </span>
                  {typeof device.ping === 'number' && device.ping > 0 && (
                    <span className="hidden md:flex items-center gap-1">
                      <Activity className="w-3 h-3 text-emerald-400" />
                      {device.ping}ms
                    </span>
                  )}
                  {hasFrame ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 tabular-nums">
                      LIVE · {liveFps} FPS
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/20 hidden lg:inline">
                      AWAITING STREAM
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              {availableDisplays.length > 1 && onSendInputOpcode && isWsReady && (
                <div className="hidden sm:flex items-center gap-1 bg-black/40 border border-white/10 rounded-lg p-0.5">
                  {availableDisplays.map((disp, idx) => {
                    const dispIdx = disp.index ?? disp.id ?? idx + 1;
                    const active = activeDisplayIndex === dispIdx;
                    return (
                      <button
                        key={dispIdx}
                        type="button"
                        onClick={() => {
                          triggerHapticFeedback('light');
                          onSendInputOpcode(0x0d, { monitor: dispIdx });
                          showFeedback(
                            isBg ? `Монитор ${dispIdx}` : `Switched to Display ${dispIdx}`
                          );
                        }}
                        className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition cursor-pointer ${
                          active
                            ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                            : 'text-slate-400 hover:text-white'
                        }`}
                        title={disp.label || disp.name || `Display ${dispIdx}`}
                      >
                        M{dispIdx}
                      </button>
                    );
                  })}
                </div>
              )}

              {onSendInputOpcode && isWsReady && (
                <button
                  type="button"
                  onClick={async () => {
                    triggerHapticFeedback('light');
                    let textToPush = '';
                    try {
                      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                        textToPush = await navigator.clipboard.readText();
                      }
                    } catch {
                      // Pull-only if browser blocks clipboard read
                    }
                    onSendInputOpcode(0x07, textToPush);
                    showFeedback(
                      textToPush
                        ? isBg
                          ? 'Клипбордът е синхронизиран с PC'
                          : 'Synced clipboard with PC'
                        : isBg
                        ? 'Извличане на клипборда от PC...'
                        : 'Pulling PC clipboard...'
                    );
                  }}
                  className="p-2 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer"
                  title={isBg ? 'Синхронизирай клипборд (Pull/Push)' : 'Sync Clipboard (Pull/Push)'}
                >
                  <Clipboard className="w-4 h-4 text-cyan-300" />
                </button>
              )}

              <button
                onClick={() => setShowQuickActions(!showQuickActions)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  showQuickActions
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
                }`}
                title={isBg ? 'Бързи контроли за ПК' : 'PC Quick Actions'}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {isBg ? 'Бързи действия' : 'Quick Actions'}
                </span>
              </button>

              <select
                value={aspectPreset}
                onChange={(e) => setAspectPreset(e.target.value as ScreenAspectPreset)}
                className="bg-black/40 border border-white/10 text-white text-xs rounded-lg px-2 py-1.5 outline-none focus:border-cyan-500 cursor-pointer hidden md:block"
                title={isBg ? 'Съотношение на екрана' : 'Aspect Ratio Preset'}
              >
                <option value="fit">{isBg ? 'Адаптивно (Fit)' : 'Auto Fit'}</option>
                <option value="16:9">16:9 (1080p/4K)</option>
                <option value="16:10">16:10 (Workstation)</option>
                <option value="21:9">21:9 (Ultrawide)</option>
                <option value="4:3">4:3 (Classic)</option>
                <option value="fill">{isBg ? 'Запълване (Fill)' : 'Stretch Fill'}</option>
              </select>

              <div className="hidden lg:flex items-center gap-1 bg-black/40 border border-white/10 rounded-lg p-0.5">
                {[1, 1.5, 2].map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setZoomFactor(z)}
                    className={`px-2 py-1 rounded text-[11px] font-mono font-bold transition cursor-pointer ${
                      zoomFactor === z
                        ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {z}x
                  </button>
                ))}
              </div>

              <select
                value={quality}
                onChange={(e) => {
                  const nextQuality = e.target.value as 'High' | 'Medium' | 'Low';
                  setQuality(nextQuality);
                  if (isDeviceOnline) {
                    showFeedback(
                      isWsReady
                        ? isBg
                          ? `Качество: ${nextQuality}`
                          : `Stream quality: ${nextQuality}`
                        : isBg
                        ? 'Качеството ще се приложи при активен поток'
                        : 'Quality preset saved for active stream'
                    );
                  }
                }}
                className="bg-black/40 border border-white/10 text-white text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-cyan-500 hidden md:block"
              >
                <option value="High">{isBg ? 'Високо (1080p)' : 'High (1080p)'}</option>
                <option value="Medium">{isBg ? 'Средно (720p)' : 'Medium (720p)'}</option>
                <option value="Low">{isBg ? 'Ниско (480p)' : 'Low (480p)'}</option>
              </select>

              <button
                onClick={() => {
                  const nextPaused = !isPaused;
                  setIsPaused(nextPaused);
                  if (!nextPaused) {
                    onRefreshFrame?.(undefined, true);
                  }
                }}
                className={`p-2 rounded-lg border transition-colors ${
                  isPaused
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                }`}
                title={isPaused ? (isBg ? 'Продължи потока' : 'Resume Stream') : (isBg ? 'Пауза на потока' : 'Pause Stream')}
              >
                <RefreshCw
                  className={`w-4 h-4 ${!isPaused && isDeviceOnline && isWsReady ? 'animate-spin' : ''}`}
                  style={{ animationDuration: '4s' }}
                />
              </button>

              <button
                onClick={handleCapture}
                disabled={isCapturing || !isDeviceOnline || !hasFrame}
                className="p-2 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-50 hidden sm:flex"
                title={isBg ? 'Снимка на екрана' : 'Take Screenshot'}
              >
                <Camera className="w-4 h-4" />
              </button>

              <button
                onClick={toggleFullscreen}
                className="p-2 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition-colors"
                title={isBg ? 'Цял екран' : 'Toggle Fullscreen'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>

              <button
                onClick={onClose}
                className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
                title={isBg ? 'Затвори' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Interactive Remote Screen Viewport */}
          <div
            ref={screenStageRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onDoubleClick={handleViewportDoubleClick}
            onContextMenu={(e) => {
              // Prevent mobile browser native long-press menu
              e.preventDefault();
            }}
            className="relative flex-1 min-h-[250px] sm:min-h-[380px] bg-black flex items-center justify-center overflow-hidden select-none touch-none cursor-crosshair"
          >
            {isDeviceOnline ? (
              <>
                {!isWsReady ? (
                  <div className="flex flex-col items-center gap-3 text-slate-300 px-6 text-center max-w-md z-10">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-400/35 flex items-center justify-center text-amber-300">
                      <KeyRound className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-white">
                      {isBg
                        ? 'Свържете се с PC агента за жива картина'
                        : 'Connect to PC Agent for Live Screen'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {isBg
                        ? `Въведете 6-цифрения PIN от ${device.name} (${device.ip}) или натиснете Свържи, ако вече сте сдвоени.`
                        : `Enter the 6-digit PIN shown on ${device.name} (${device.ip}), or click Connect if already paired.`}
                    </p>
                    <form
                      onSubmit={handleInlinePairOrConnect}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="w-full flex items-center gap-2 pt-1"
                    >
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={inlinePin}
                        onChange={(e) => setInlinePin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder={isBg ? '6-цифрен PIN (по избор)' : '6-digit PIN (optional)'}
                        className="flex-1 min-h-[40px] px-3 py-2 rounded-xl bg-slate-950 border border-white/15 focus:border-cyan-400 text-xs font-mono text-amber-200 tracking-widest outline-none"
                      />
                      <button
                        type="submit"
                        disabled={isPairingInline}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 text-slate-950 text-xs font-mono font-bold transition cursor-pointer shrink-0"
                      >
                        {isPairingInline
                          ? isBg
                            ? 'Сдвояване...'
                            : 'Pairing...'
                          : inlinePin.trim()
                          ? isBg
                            ? 'Сдвои & Свържи'
                            : 'Pair & Connect'
                          : isBg
                          ? 'Свържи'
                          : 'Connect'}
                      </button>
                    </form>
                    {inlinePairError && (
                      <p className="text-[11px] text-rose-300 font-mono">{inlinePairError}</p>
                    )}
                    {onOpenConnection && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={onOpenConnection}
                        className="text-[11px] text-cyan-300 hover:text-cyan-200 underline cursor-pointer"
                      >
                        {isBg ? 'Разширени WebSocket настройки' : 'Advanced WebSocket Settings'}
                      </button>
                    )}
                  </div>
                ) : (
                  (() => {
                    const fittedRect =
                      stageSize.width > 0 && stageSize.height > 0 && aspectPreset !== 'fit'
                        ? computeContainedScreenRect(stageSize.width, stageSize.height, aspectPreset, 1)
                        : null;
                    return (
                      <div
                        className={`relative w-full h-full flex items-center justify-center ${
                          zoomFactor > 1 ? 'overflow-auto' : 'overflow-hidden'
                        }`}
                      >
                        <div
                          className="relative w-full h-full flex items-center justify-center overflow-hidden"
                          style={{
                            transform: zoomFactor > 1 ? `scale(${zoomFactor})` : undefined,
                            transformOrigin: '50% 50%',
                            transition: 'transform 0.15s ease-out',
                          }}
                        >
                          <canvas
                            ref={canvasRef}
                            className={`pointer-events-none transition-opacity duration-150 ${
                              aspectPreset === 'fill'
                                ? 'w-full h-full object-fill'
                                : fittedRect
                                ? 'max-w-full max-h-full object-contain'
                                : 'w-full h-full object-contain'
                            } ${hasFrame ? (localCapturing ? 'opacity-75 scale-[0.99]' : 'opacity-100') : 'opacity-0'}`}
                            style={{
                              width: fittedRect ? `${fittedRect.width}px` : undefined,
                              height: fittedRect ? `${fittedRect.height}px` : undefined,
                              aspectRatio:
                                aspectPreset === '16:9'
                                  ? '16 / 9'
                                  : aspectPreset === '16:10'
                                  ? '16 / 10'
                                  : aspectPreset === '21:9'
                                  ? '21 / 9'
                                  : aspectPreset === '4:3'
                                  ? '4 / 3'
                                  : undefined,
                            }}
                          />
                        </div>

                        {!hasFrame && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 px-6 text-center pointer-events-auto">
                            {streamTimedOut ? (
                              <>
                                <XCircle className="w-8 h-8 text-amber-400" />
                                <p className="text-sm font-mono text-amber-200 max-w-md">
                                  {isBg
                                    ? 'Няма получен видео кадър от хост агента.'
                                    : 'No video frame received yet from host agent.'}
                                </p>
                                {onRefreshFrame && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStreamTimedOut(false);
                                      onRefreshFrame(undefined, true);
                                    }}
                                    className="px-3.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 text-xs font-mono font-bold transition cursor-pointer"
                                  >
                                    {isBg ? 'Поискай кадър отново' : 'Request Screen Frame'}
                                  </button>
                                )}
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-8 h-8 animate-spin text-cyan-500" />
                                <p className="text-sm font-mono">
                                  {isBg
                                    ? 'Установяване на автентикиран видео поток...'
                                    : 'Establishing authenticated screen stream...'}
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}

                {/* Touch Gesture Helper Pill (Top Left) */}
                <div className="absolute top-3 left-3 pointer-events-none flex flex-wrap items-center gap-2 z-20">
                  <div className="px-2.5 py-1 rounded-lg bg-black/75 backdrop-blur-md border border-white/15 text-[11px] text-slate-200 flex items-center gap-2 shadow-lg">
                    <span className="inline-flex items-center gap-1 text-cyan-400 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      {isBg ? '1 Докосване = Ляв клик' : '1 Tap = Left Click'}
                    </span>
                    <span className="text-slate-600">|</span>
                    <span className="inline-flex items-center gap-1 text-purple-400 font-semibold">
                      <span className="w-2 h-2 rounded-full bg-purple-400" />
                      {isBg ? 'Задръж 1 сек = Десен клик' : 'Hold 1s = Right Click'}
                    </span>
                  </div>
                </div>

                {/* Live Action Feedback Toast */}
                <AnimatePresence>
                  {lastActionFeedback && (
                    <motion.div
                      initial={{ opacity: 0, y: -12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      className="absolute top-3 right-3 px-3 py-1.5 rounded-xl bg-black/85 border border-cyan-500/40 text-cyan-300 text-xs font-mono shadow-xl pointer-events-none z-30 flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{lastActionFeedback}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Hold-to-Right-Click 1s Progress Ring */}
                <AnimatePresence>
                  {holdIndicator && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      style={{
                        left: `${holdIndicator.xPct}%`,
                        top: `${holdIndicator.yPct}%`
                      }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-30 flex flex-col items-center"
                    >
                      <svg className="w-16 h-16 -rotate-90">
                        <circle
                          cx="32"
                          cy="32"
                          r="26"
                          stroke="rgba(168, 85, 247, 0.25)"
                          strokeWidth="4"
                          fill="rgba(15, 23, 42, 0.45)"
                        />
                        <motion.circle
                          cx="32"
                          cy="32"
                          r="26"
                          stroke="#a855f7"
                          strokeWidth="4"
                          strokeLinecap="round"
                          fill="transparent"
                          strokeDasharray={164}
                          initial={{ strokeDashoffset: 164 }}
                          animate={{ strokeDashoffset: 0 }}
                          transition={{ duration: 1.0, ease: 'linear' }}
                        />
                      </svg>
                      <span className="mt-1 px-2 py-0.5 rounded bg-purple-950/90 border border-purple-500/40 text-[10px] font-bold text-purple-200 whitespace-nowrap shadow">
                        {isBg ? 'Задръж за Десен клик...' : 'Hold for Right Click...'}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Visual Click Ripples (Left Click = Cyan, Right Click = Purple) */}
                <AnimatePresence>
                  {ripples.map((r) => (
                    <motion.div
                      key={r.id}
                      initial={{ opacity: 0.95, scale: 0.4 }}
                      animate={{ opacity: 0, scale: 2.1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.75, ease: 'easeOut' }}
                      style={{ left: `${r.xPct}%`, top: `${r.yPct}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-20"
                    >
                      <div
                        className={`w-12 h-12 rounded-full border-2 ${
                          r.button === 'right'
                            ? 'border-purple-400 bg-purple-500/25 shadow-[0_0_25px_rgba(168,85,247,0.7)]'
                            : 'border-cyan-400 bg-cyan-500/25 shadow-[0_0_25px_rgba(34,211,238,0.7)]'
                        }`}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>

                {/* Simulated Remote Cursor Indicator */}
                <div
                  style={{ left: `${cursorPos.x}%`, top: `${cursorPos.y}%` }}
                  className="absolute w-5 h-5 -ml-2.5 -mt-2.5 pointer-events-none transition-all duration-100 z-20"
                >
                  <div className="w-full h-full rounded-full border-2 border-cyan-400 bg-cyan-400/30 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
                  <span className="absolute left-6 top-0 px-2 py-0.5 rounded bg-black/85 border border-cyan-400/30 text-[10.5px] font-mono font-semibold text-cyan-300 whitespace-nowrap shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                    {Math.round((cursorPos.x / 100) * (canvasNatSizeRef.current.width || 1920))},
                    {Math.round((cursorPos.y / 100) * (canvasNatSizeRef.current.height || 1080))}
                  </span>
                </div>

                {/* Interactive Remote Right-Click Context Menu */}
                <AnimatePresence>
                  {contextMenu && (
                    <motion.div
                      data-context-menu="true"
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.92 }}
                      style={{
                        left: `${Math.min(72, Math.max(6, contextMenu.xPct))}%`,
                        top: `${Math.min(62, Math.max(8, contextMenu.yPct))}%`
                      }}
                      className="absolute z-40 w-56 rounded-xl bg-[#111827]/95 backdrop-blur-xl border border-purple-500/40 shadow-2xl p-1.5 text-xs text-slate-200"
                    >
                      <div className="px-2.5 py-1.5 border-b border-white/10 flex items-center justify-between text-[10px] font-mono text-purple-300">
                        <span>
                          {isBg ? 'ДЕСЕН КЛИК МЕНЮ' : 'RIGHT-CLICK MENU'} ({contextMenu.pxX}, {contextMenu.pxY})
                        </span>
                        <button
                          onClick={() => setContextMenu(null)}
                          className="text-slate-400 hover:text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="py-1 space-y-0.5">
                        <button
                          onClick={() => {
                            setContextMenu(null);
                            dispatchPcAction(
                              {
                                type: 'mouse_click',
                                button: 'double',
                                x: contextMenu.pxX,
                                y: contextMenu.pxY
                              },
                              isBg ? 'Двоен клик изпълнен' : 'Double Click executed'
                            );
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg hover:bg-white/10 flex items-center justify-between text-left transition-colors"
                        >
                          <span>{isBg ? 'Отвори / Двоен клик тук' : 'Open / Double-Click Here'}</span>
                          <span className="text-[10px] text-slate-400 font-mono">2x Click</span>
                        </button>
                        <button
                          onClick={() => {
                            setContextMenu(null);
                            dispatchPcAction(
                              {
                                type: 'terminal_command',
                                command:
                                  device?.os === 'linux'
                                    ? 'gnome-system-monitor || xfce4-taskmanager || ksysguard'
                                    : 'start taskmgr',
                              },
                              isBg ? 'Стартиран Диспечер на задачите' : 'Launched Task Manager'
                            );
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg hover:bg-white/10 flex items-center justify-between text-left transition-colors text-emerald-300"
                        >
                          <span>{isBg ? 'Диспечер на задачите' : 'Open Task Manager'}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {device?.os === 'linux' ? 'SysMon' : 'taskmgr'}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setContextMenu(null);
                            dispatchPcAction(
                              { type: 'key_combo', keys: 'win,e' },
                              isBg ? 'Отворен Файлов мениджър' : 'Opened File Explorer'
                            );
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg hover:bg-white/10 flex items-center justify-between text-left transition-colors"
                        >
                          <span>{isBg ? 'Файлов мениджър' : 'Open File Explorer'}</span>
                          <span className="text-[10px] text-slate-400 font-mono">Win+E</span>
                        </button>
                        <button
                          onClick={() => {
                            setContextMenu(null);
                            dispatchPcAction(
                              { type: 'key_combo', keys: 'win,d' },
                              isBg ? 'Покажи работния плот' : 'Show Desktop'
                            );
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg hover:bg-white/10 flex items-center justify-between text-left transition-colors"
                        >
                          <span>{isBg ? 'Покажи работния плот' : 'Show Desktop'}</span>
                          <span className="text-[10px] text-slate-400 font-mono">Win+D</span>
                        </button>
                        <button
                          onClick={() => {
                            setContextMenu(null);
                            dispatchPcAction(
                              { type: 'key_combo', keys: 'f5' },
                              isBg ? 'Опресняване (F5)' : 'Refreshed Desktop (F5)'
                            );
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg hover:bg-white/10 flex items-center justify-between text-left transition-colors"
                        >
                          <span>{isBg ? 'Опресни екрана' : 'Refresh Screen'}</span>
                          <span className="text-[10px] text-slate-400 font-mono">F5</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {isPaused && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30">
                    <div className="bg-[#141414] border border-white/10 px-6 py-4 rounded-2xl flex flex-col items-center gap-2">
                      <span className="text-amber-400 font-bold tracking-widest uppercase text-xs">
                        {isBg ? 'Потокът е на пауза' : 'Stream Paused'}
                      </span>
                      <button
                        onClick={() => {
                          setIsPaused(false);
                          onRefreshFrame?.(undefined, true);
                        }}
                        className="mt-2 px-4 py-1.5 bg-cyan-500 text-black font-semibold text-xs rounded-lg hover:bg-cyan-400 transition-colors"
                      >
                        {isBg ? 'Продължи' : 'Resume'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 text-slate-500 p-6 text-center">
                <Monitor className="w-12 h-12 text-slate-700" />
                <p className="text-sm">
                  {isBg
                    ? 'Устройството е офлайн. Стартирайте компютъра, за да гледате и управлявате екрана.'
                    : 'Device is offline. Wake the PC to view and control its screen.'}
                </p>
              </div>
            )}
          </div>

          {/* Common PC Quick Actions Strip */}
          <AnimatePresence>
            {showQuickActions && isDeviceOnline && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="bg-[#0e1422] border-t border-white/10 px-3 py-2.5 shrink-0 overflow-hidden"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Cpu className="w-3 h-3 text-cyan-400" />
                    {isBg ? 'Бързи действия за компютър (1 докосване)' : 'Common PC Quick Actions (1-Tap)'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() =>
                        dispatchPcAction(
                          { type: 'key_combo', keys: 'enter' },
                          isBg ? 'Клавиш Enter' : 'Sent Enter Key'
                        )
                      }
                      className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-slate-300"
                    >
                      Enter
                    </button>
                    <button
                      onClick={() =>
                        dispatchPcAction(
                          { type: 'key_combo', keys: 'esc' },
                          isBg ? 'Клавиш Escape' : 'Sent Escape Key'
                        )
                      }
                      className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-slate-300"
                    >
                      Esc
                    </button>
                    <button
                      onClick={() =>
                        dispatchPcAction(
                          { type: 'key_combo', keys: 'backspace' },
                          isBg ? 'Клавиш Backspace' : 'Sent Backspace'
                        )
                      }
                      className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-slate-300"
                    >
                      Backspace
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
                  {commonQuickActions.map((item) => {
                    const IconComponent = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={item.onClick}
                        className={`shrink-0 px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all active:scale-95 ${item.color}`}
                      >
                        <IconComponent className="w-3.5 h-3.5 shrink-0" />
                        <span className="whitespace-nowrap">{item.label}</span>
                        <span className="text-[10px] opacity-65 font-mono hidden sm:inline">
                          {item.shortcut}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Built-in AI PC Command Text Box & Direct Keyboard Bar */}
          {isDeviceOnline && (
            <div className="bg-[#12192b] border-t border-white/10 px-3 sm:px-4 py-3 shrink-0 space-y-2">
              {/* AI Status Reply Banner + Explicit 1-Tap Approval for Proposed Actions */}
              <AnimatePresence>
                {(aiStatusReply || pendingAiActions.length > 0) && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-xs text-cyan-200"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate">{aiStatusReply}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {pendingAiActions.length > 0 && (
                        <button
                          type="button"
                          onClick={async () => {
                            const toRun = pendingAiActions;
                            setPendingAiActions([]);
                            for (const act of toRun) {
                              showRemoteActionRipple(act);
                              await dispatchPcAction(
                                act,
                                isBg
                                  ? `Изпълнено ИИ действие: ${act.type || 'action'}`
                                  : `Executed AI action: ${act.type || 'action'}`
                              );
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 border border-emerald-400/40 text-emerald-200 text-[11px] font-bold cursor-pointer"
                        >
                          {isBg
                            ? `Потвърди (${pendingAiActions.length})`
                            : `Approve & Run (${pendingAiActions.length})`}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setAiStatusReply(null);
                          setPendingAiActions([]);
                        }}
                        className="text-slate-400 hover:text-white shrink-0 p-0.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Mode Switcher + Input Form */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/10 shrink-0">
                  <button
                    type="button"
                    onClick={() => setInputMode('ai')}
                    className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      inputMode === 'ai'
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isBg ? 'ИИ Управление' : 'AI PC Control'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('keyboard')}
                    className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      inputMode === 'keyboard'
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Keyboard className="w-3.5 h-3.5" />
                    <span>{isBg ? 'Клавиатура' : 'Direct Type'}</span>
                  </button>
                </div>

                {inputMode === 'ai' ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendAiCommand();
                    }}
                    className="flex-1 flex items-center gap-2"
                  >
                    <div className="relative flex-1">
                      <Sparkles className="w-4 h-4 text-cyan-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={aiInputRef}
                        type="text"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder={
                          isBg
                            ? 'Кажете на ИИ какво да направи на ПК (напр. "Отвори Task Manager", "Пусни youtube.com")...'
                            : 'Tell AI what to do on your PC (e.g. "Open Task Manager", "Open youtube.com", "Show desktop")...'
                        }
                        className="w-full bg-black/50 border border-cyan-500/30 rounded-xl pl-10 pr-3 py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isAiBusy || !aiPrompt.trim()}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 hover:opacity-95 disabled:opacity-40 transition-all shrink-0 shadow-lg shadow-cyan-500/20"
                    >
                      {isAiBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>{isBg ? 'Изпълни' : 'Run AI'}</span>
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleSendKeyboardText} className="flex-1 flex items-center gap-2">
                    <div className="relative flex-1">
                      <Keyboard className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={keyboardInputRef}
                        type="text"
                        value={keyboardText}
                        onChange={(e) => setKeyboardText(e.target.value)}
                        placeholder={
                          isBg
                            ? 'Въведете текст директно към активния прозорец на компютъра...'
                            : 'Type text directly into the active window on the PC...'
                        }
                        className="w-full bg-black/50 border border-white/15 rounded-xl pl-10 pr-3 py-2 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!keyboardText.trim()}
                      className="px-4 py-2 rounded-xl bg-cyan-500 text-black text-xs sm:text-sm font-bold flex items-center gap-1.5 hover:bg-cyan-400 disabled:opacity-40 transition-colors shrink-0"
                    >
                      <CornerDownLeft className="w-3.5 h-3.5" />
                      <span>{isBg ? 'Напиши' : 'Type'}</span>
                    </button>
                  </form>
                )}
              </div>

              {/* Quick AI Prompt Chips */}
              {inputMode === 'ai' && (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 shrink-0 mr-1">
                    {isBg ? 'ИИ Команди:' : 'Try AI:'}
                  </span>
                  {aiSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={isAiBusy}
                      onClick={() => handleSendAiCommand(suggestion)}
                      className="shrink-0 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-500/30 text-[11px] text-slate-300 hover:text-cyan-300 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer Status */}
          <div className="px-4 py-2 bg-[#0b0f19] border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 shrink-0">
            <div className="flex items-center gap-4">
              {(() => {
                const isEncryptedWs = wsUrl
                  ? wsUrl.startsWith('wss://')
                  : typeof window !== 'undefined' && window.location.protocol === 'https:';
                const secureShield = isVaultEncrypted || isEncryptedWs;
                const badgeText = isVaultEncrypted
                  ? isEncryptedWs
                    ? 'WSS + ChaCha20-Poly1305 AEAD'
                    : isBg
                    ? 'E2E ChaCha20-Poly1305 AEAD'
                    : 'ChaCha20-Poly1305 AEAD'
                  : isEncryptedWs
                  ? isBg
                    ? 'Криптиран WSS (TLS) Поток'
                    : 'Encrypted WSS (TLS) Stream'
                  : isBg
                  ? 'HMAC-SHA256 Локален Поток (LAN)'
                  : 'HMAC-Authenticated LAN Stream';
                return (
                  <span className={`flex items-center gap-1.5 ${isVaultEncrypted ? 'text-emerald-300' : ''}`}>
                    <Shield className={`w-3.5 h-3.5 ${secureShield ? 'text-emerald-400' : 'text-cyan-400'}`} />
                    {badgeText}
                  </span>
                );
              })()}
              <span className="hidden sm:flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-cyan-500" />
                {isBg ? 'Протокол: AI-NET/3.0' : 'Protocol: AI-NET/3.0'}
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono">
              <span className="text-cyan-400">
                {isBg ? 'Курсор' : 'Cursor'}:{' '}
                {Math.round((cursorPos.x / 100) * (canvasNatSizeRef.current.width || 1920))}x
                {Math.round((cursorPos.y / 100) * (canvasNatSizeRef.current.height || 1080))}
              </span>
              <span>{device.ip}:{device.port || 8765}</span>
            </div>
          </div>
        </motion.div>
      </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
