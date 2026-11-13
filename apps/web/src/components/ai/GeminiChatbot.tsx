import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  Square,
  Trash2,
  Copy,
  Check,
  Sparkles,
  Shield,
  Terminal,
  Zap,
  Power,
  RefreshCw,
  FlaskConical,
  Bot,
  Clock,
  ChevronRight,
  MousePointerClick,
  Keyboard,
  Monitor,
  DownloadCloud,
  CheckCircle2,
  AlertTriangle,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { copyToClipboard } from '../../utils/clipboard';
import { HostDevice, WolSchedule } from '../../types';
import { useTranslation } from '../../i18n/useTranslation';
import { useUIStore } from '../../store/uiStore';
import { wolHistoryStore } from '../../store/wolHistoryStore';

export type BotRole = 'commander' | 'diagnostics' | 'fast_triage';
export type GeminiModelId =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-2.0-flash'
  | 'gemini-flash-latest'
  | string;

export interface AiActionItem {
  id: string;
  type:
    | 'mouse_click'
    | 'mouse_move'
    | 'mouse_double_click'
    | 'mouse_scroll'
    | 'keyboard_type'
    | 'keyboard_hotkey'
    | 'media_control'
    | 'shell_exec'
    | 'wol'
    | 'system_update'
    | 'daemon_control'
    | 'screen_capture'
    | 'rescan'
    | 'lab_mode';
  label: string;
  subtitle?: string;
  target?: string;
  payload?: any;
  executionResult?: {
    success: boolean;
    summary: string;
    output?: string;
    opcode?: string;
    durationMs?: number;
    blockedByViewOnly?: boolean;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  modelUsed?: string;
  durationMs?: number;
  actions?: AiActionItem[];
}

interface GeminiChatbotProps {
  hosts: HostDevice[];
  selectedTarget: string;
  onSendWol?: (device: HostDevice) => void;
  onSelectHost?: (hostId: string) => void;
  onTriggerRescan?: () => void;
  onToggleLabMode?: () => void;
  onSendCommand?: (cmd: string, targetOverride?: string) => void;
  onViewScreen?: (host: HostDevice) => void;
  onSendInputOpcode?: (opcode: number, payload: Record<string, any> | string) => boolean;
  onOpenUpdateCenter?: () => void;
  onOpenDaemonGui?: () => void;
  isRealWsConnected?: boolean;
  latency?: number | null;
  wolSchedules?: WolSchedule[];
}

const STORAGE_KEY = 'cst_gemini_chat_history_v4';
const ROLE_STORAGE_KEY = 'cst_gemini_active_role_v4';
const AUTO_EXEC_STORAGE_KEY = 'cst_gemini_auto_exec_v1';

const GeminiChatbotComponent: React.FC<GeminiChatbotProps> = ({
  hosts,
  selectedTarget,
  onSendWol,
  onSelectHost,
  onTriggerRescan,
  onToggleLabMode,
  onSendCommand,
  onViewScreen,
  onSendInputOpcode,
  onOpenUpdateCenter,
  onOpenDaemonGui,
  isRealWsConnected = false,
  latency = null,
  wolSchedules = [],
}) => {
  const { language } = useTranslation();
  const selectedModel = useUIStore((s) => s.selectedModel);
  const pendingChatPrompt = useUIStore((s) => s.pendingChatPrompt);
  const setPendingChatPrompt = useUIStore((s) => s.setPendingChatPrompt);

  const primaryHost = useMemo(() => {
    const found = hosts.find((h) => h.id === selectedTarget);
    return found || hosts[0] || null;
  }, [hosts, selectedTarget]);

  const welcomeText = useMemo(
    () =>
      language === 'bg'
        ? 'Здравейте! Аз съм Вашият **AI NetController Копилот** с директен контрол над компютъра.\n\nМога да управлявам **мишката и клавиатурата** (`Opcode 0x08`), да изпълнявам **Shell команди**, да изпращам **Wake-on-LAN** пакети и да управлявам **PC Демона**.'
        : 'Hello! I am your **AI NetController Copilot** with direct PC control and diagnostics.\n\nI can control your PC **mouse & keyboard** (`Opcode 0x08`), execute **Shell commands**, broadcast **Wake-on-LAN** packets, and manage the **PC Host Daemon**.',
    [language]
  );

  const ROLES = useMemo(
    () => [
      {
        id: 'commander' as BotRole,
        label: language === 'bg' ? 'Флот' : 'Fleet',
        model: (selectedModel || 'gemini-2.5-flash') as GeminiModelId,
        icon: Sparkles,
        placeholder:
          language === 'bg'
            ? 'напр. „Събуди компютъра“, „Напиши ipconfig“, „Кликни на (960, 540)“...'
            : 'e.g. "Wake my PC", "Run ipconfig", "Click at (960, 540)"...',
      },
      {
        id: 'diagnostics' as BotRole,
        label: language === 'bg' ? 'Одит' : 'Audit',
        model: (selectedModel || 'gemini-2.5-flash') as GeminiModelId,
        icon: Shield,
        placeholder:
          language === 'bg'
            ? 'Одит на PC демона и мрежовата сигурност...'
            : 'Audit PC daemon & network security...',
      },
      {
        id: 'fast_triage' as BotRole,
        label: language === 'bg' ? 'Бързо' : 'Quick',
        model: (selectedModel || 'gemini-2.5-flash') as GeminiModelId,
        icon: Terminal,
        placeholder:
          language === 'bg'
            ? 'Бърза команда или клавишна комбинация...'
            : 'Fast shell command or keyboard shortcut...',
      },
    ],
    [language, selectedModel]
  );

  const [activeRole, setActiveRole] = useState<BotRole>(() => {
    try {
      const saved = localStorage.getItem(ROLE_STORAGE_KEY) as BotRole;
      if (saved && ['commander', 'diagnostics', 'fast_triage'].includes(saved)) return saved;
    } catch {}
    return 'commander';
  });

  const [autoExecutePcActions, setAutoExecutePcActions] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(AUTO_EXEC_STORAGE_KEY);
      if (saved !== null) return saved === 'true';
    } catch {}
    return true;
  });

  const [showControlDeck, setShowControlDeck] = useState<boolean>(false);
  const [executingActionId, setExecutingActionId] = useState<string | null>(null);

  const activeRoleConfig = useMemo(
    () => ROLES.find((r) => r.id === activeRole) || ROLES[0],
    [ROLES, activeRole]
  );

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [
      {
        id: 'welcome',
        role: 'model',
        content: welcomeText,
        timestamp: Date.now(),
        modelUsed: selectedModel || 'gemini-2.5-flash',
      },
    ];
  });

  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === 'welcome'
          ? { ...m, content: welcomeText, modelUsed: selectedModel || 'gemini-2.5-flash' }
          : m
      )
    );
  }, [welcomeText, selectedModel]);

  const [inputPrompt, setInputPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPersistRef = useRef(false);
  const handleSendMessageRef = useRef<(textOverride?: string) => Promise<void>>(async () => {});

  const scrollToBottom = useCallback((smooth = true) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    if (!messages.some((m) => m.role === 'user') && messages.length <= 1) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-20)));
    } catch {}
  }, [messages]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  const toggleAutoExecute = () => {
    triggerHapticFeedback('selection');
    setAutoExecutePcActions((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_EXEC_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const handleRoleSelect = (roleId: BotRole) => {
    setActiveRole(roleId);
    try {
      localStorage.setItem(ROLE_STORAGE_KEY, roleId);
    } catch {}
    textareaRef.current?.focus();
  };

  const handleClearHistory = () => {
    triggerHapticFeedback('warning');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
    skipPersistRef.current = true;
    const fresh: ChatMessage = {
      id: `init-${Date.now()}`,
      role: 'model',
      content:
        language === 'bg'
          ? 'Разговорът е изчистен. Готов съм за PC контрол и диагностика.'
          : 'Conversation cleared. Ready for PC control and diagnostics.',
      timestamp: Date.now(),
      modelUsed: activeRoleConfig.model,
    };
    setMessages([fresh]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const handleStopGeneration = () => {
    triggerHapticFeedback('medium');
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  };

  const buildActionItems = useCallback(
    (
      text: string,
      serverActions?: any[],
      serverExecResults?: Record<string, any>
    ): AiActionItem[] => {
      const items: AiActionItem[] = [];
      const bg = language === 'bg';

      const formatItemFromServerAction = (act: any): AiActionItem => {
        const execRes = serverExecResults?.[act.id];
        const targetName = act.target || primaryHost?.id || '';

        switch (act.type) {
          case 'mouse_click':
            return {
              id: act.id,
              type: 'mouse_click',
              target: targetName,
              label: bg
                ? `Клик (${act.button || 'ляв'}) на (${act.x}, ${act.y})`
                : `Click (${act.button || 'left'}) at (${act.x}, ${act.y})`,
              subtitle: `Opcode 0x08 • ${targetName}`,
              payload: act,
              executionResult: execRes,
            };
          case 'mouse_double_click':
            return {
              id: act.id,
              type: 'mouse_double_click',
              target: targetName,
              label: bg
                ? `Двоен клик на (${act.x}, ${act.y})`
                : `Double-Click at (${act.x}, ${act.y})`,
              subtitle: `Opcode 0x08 • ${targetName}`,
              payload: act,
              executionResult: execRes,
            };
          case 'mouse_move':
            return {
              id: act.id,
              type: 'mouse_move',
              target: targetName,
              label: bg
                ? `Премести курсора до (${act.x}, ${act.y})`
                : `Move Cursor to (${act.x}, ${act.y})`,
              subtitle: `Opcode 0x08 • 120Hz • ${targetName}`,
              payload: act,
              executionResult: execRes,
            };
          case 'mouse_scroll':
            return {
              id: act.id,
              type: 'mouse_scroll',
              target: targetName,
              label: bg
                ? `Скрол на мишката (dy=${act.dy})`
                : `Scroll Mouse Wheel (dy=${act.dy})`,
              subtitle: `Opcode 0x08 • ${targetName}`,
              payload: act,
              executionResult: execRes,
            };
          case 'keyboard_type':
            return {
              id: act.id,
              type: 'keyboard_type',
              target: targetName,
              label: bg
                ? `Напиши: "${act.text}"${act.pressEnter ? ' + Enter' : ''}`
                : `Type: "${act.text}"${act.pressEnter ? ' + Enter' : ''}`,
              subtitle: `Opcode 0x08 Keystroke • ${targetName}`,
              payload: act,
              executionResult: execRes,
            };
          case 'keyboard_hotkey': {
            const combo = Array.isArray(act.keys) ? act.keys.join('+').toUpperCase() : 'CTRL+C';
            return {
              id: act.id,
              type: 'keyboard_hotkey',
              target: targetName,
              label: bg ? `Клавиши [${combo}]` : `Shortcut [${combo}]`,
              subtitle: `Opcode 0x08 Hotkey • ${targetName}`,
              payload: act,
              executionResult: execRes,
            };
          }
          case 'media_control':
            return {
              id: act.id,
              type: 'media_control',
              target: targetName,
              label: bg
                ? `Медия/ОС Контрол: ${String(act.command || '').toUpperCase()}`
                : `Media/OS Control: ${String(act.command || '').toUpperCase()}`,
              subtitle: `Opcode 0x09 • ${targetName}`,
              payload: act,
              executionResult: execRes,
            };
          case 'shell_exec':
            return {
              id: act.id,
              type: 'shell_exec',
              target: targetName,
              label: bg ? `Изпълни: ${act.command}` : `Run Shell: ${act.command}`,
              subtitle: `AST Firewall Verified • ${targetName}`,
              payload: act,
              executionResult: execRes,
            };
          case 'wol': {
            const hostObj =
              hosts.find(
                (h) =>
                  h.id.toLowerCase() === targetName.toLowerCase() ||
                  h.mac.toLowerCase() === targetName.toLowerCase()
              ) || primaryHost;
            const resolvedId = hostObj?.id || targetName || 'UNSET';
            const resolvedName = hostObj?.name || targetName || 'Host';
            const resolvedMac = hostObj?.mac || act.mac || '';
            return {
              id: act.id,
              type: 'wol',
              target: resolvedId,
              label: bg ? `Събуди ${resolvedName} (WoL)` : `Wake ${resolvedName} (WoL)`,
              subtitle: `UDP Port 9 • ${resolvedMac || 'No MAC'}`,
              payload: { ...act, host: hostObj, mac: resolvedMac },
              executionResult: execRes,
            };
          }
          case 'system_update':
            return {
              id: act.id,
              type: 'system_update',
              target: act.componentId || 'ALL',
              label: bg
                ? `Инсталирай Обновления (${act.componentId || 'ALL'})`
                : `Install System & AI Updates (${act.componentId || 'ALL'})`,
              subtitle: bg ? 'OTA Синхронизация на модели и демон' : 'OTA Model & Daemon Sync',
              payload: act,
              executionResult: execRes,
            };
          case 'daemon_control':
            return {
              id: act.id,
              type: 'daemon_control',
              target: 'PC-DAEMON',
              label: bg
                ? `PC Демон: ${String(act.command || 'diagnostics').toUpperCase()}`
                : `PC Daemon: ${String(act.command || 'diagnostics').toUpperCase()}`,
              subtitle: bg ? 'Локална защита и диагностика' : 'Host Daemon IPC Control',
              payload: act,
              executionResult: execRes,
            };
          case 'screen_capture':
            return {
              id: act.id,
              type: 'screen_capture',
              target: targetName,
              label: bg ? `Отвори Live Екран (${targetName})` : `Open Live Screen (${targetName})`,
              subtitle: `Opcode 0x04 TurboJPEG • ${targetName}`,
              payload: act,
              executionResult: execRes,
            };
          case 'rescan':
            return {
              id: act.id,
              type: 'rescan',
              label: bg ? 'Сканирай LAN Мрежата' : 'Rescan LAN Subnet',
              subtitle: 'mDNS + ARP Sweep',
              payload: act,
            };
          default:
            return {
              id: act.id,
              type: 'lab_mode',
              label: bg ? 'Мрежова Конфигурация' : 'Network Config',
              payload: act,
            };
        }
      };

      if (Array.isArray(serverActions) && serverActions.length > 0) {
        return serverActions.map(formatItemFromServerAction);
      }

      const tagRegex = /\[ACTION:([A-Z_]+)([^\]]*)\]/gi;
      let match: RegExpExecArray | null;
      let idx = 0;
      const parseAttr = (attrStr: string, key: string): string | undefined => {
        const quoted = new RegExp(`${key}="([^"]*)"`, 'i').exec(attrStr);
        if (quoted) return quoted[1];
        const unquoted = new RegExp(`${key}=([^\\s\\]]+)`, 'i').exec(attrStr);
        return unquoted ? unquoted[1] : undefined;
      };

      while ((match = tagRegex.exec(text)) !== null) {
        idx += 1;
        const kind = match[1].toUpperCase();
        const attrs = match[2] || '';
        const target = parseAttr(attrs, 'target') || primaryHost?.id || '';
        items.push(
          formatItemFromServerAction({
            id: `client-act-${Date.now()}-${idx}`,
            type: kind.toLowerCase(),
            target,
            x: Number(parseAttr(attrs, 'x') ?? 960),
            y: Number(parseAttr(attrs, 'y') ?? 540),
            dy: Number(parseAttr(attrs, 'dy') ?? -300),
            button: parseAttr(attrs, 'button') || 'left',
            text: parseAttr(attrs, 'text') || '',
            pressEnter: parseAttr(attrs, 'press_enter') !== 'false',
            keys: (parseAttr(attrs, 'keys') || 'ctrl,c').split(','),
            command: parseAttr(attrs, 'command') || 'whoami',
            componentId: parseAttr(attrs, 'target') || 'ALL',
          })
        );
      }

      return items;
    },
    [hosts, language, primaryHost]
  );

  const handleExecuteActionItem = async (messageId: string, action: AiActionItem) => {
    triggerHapticFeedback('medium');
    setExecutingActionId(action.id);

    const updateActionResult = (result: NonNullable<AiActionItem['executionResult']>) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.actions) return m;
          return {
            ...m,
            actions: m.actions.map((a) =>
              a.id === action.id ? { ...a, executionResult: result } : a
            ),
          };
        })
      );
      triggerHapticFeedback(result.success ? 'heavy' : 'warning');
    };

    try {
      if (action.type === 'rescan') {
        onTriggerRescan?.();
        return;
      }
      if (action.type === 'lab_mode') {
        onToggleLabMode?.();
        return;
      }

      const targetKey = String(action.target || '').trim().toLowerCase();
      const explicitHost = targetKey
        ? hosts.find(
            (h) => h.id.toLowerCase() === targetKey || h.name.toLowerCase() === targetKey
          )
        : undefined;
      const targetHost = explicitHost || (!targetKey ? primaryHost : undefined);
      const resolvedTargetId = targetHost?.id || action.target || selectedTarget || '';

      if (action.type === 'screen_capture') {
        if (targetHost && onViewScreen) {
          onSelectHost?.(targetHost.id);
          onViewScreen(targetHost);
          updateActionResult({
            success: true,
            summary:
              language === 'bg'
                ? `Отворен Live екран за ${targetHost.name}`
                : `Opened live screen for ${targetHost.name}`,
            opcode: '0x04 (LIVE_FRAME)',
          });
        } else {
          updateActionResult({
            success: false,
            summary:
              language === 'bg'
                ? `Неуспешно намиране на хост ${action.target || ''}`.trim()
                : `Target host ${action.target || ''} not found`.trim(),
          });
        }
        return;
      }

      const canUseLiveWsForTarget =
        isRealWsConnected && (!targetHost || targetHost.id === selectedTarget);

      if (
        action.type === 'shell_exec' &&
        action.payload?.command &&
        canUseLiveWsForTarget &&
        onSendCommand
      ) {
        onSendCommand(action.payload.command, resolvedTargetId);
        updateActionResult({
          success: true,
          summary:
            language === 'bg'
              ? `Командата е изпратена по WebSocket към ${resolvedTargetId}`
              : `Dispatched command over live WebSocket to ${resolvedTargetId}`,
          opcode: '0x04 (WS SHELL)',
        });
        return;
      }

      if (
        canUseLiveWsForTarget &&
        onSendInputOpcode &&
        (action.type === 'mouse_click' ||
          action.type === 'mouse_double_click' ||
          action.type === 'mouse_move' ||
          action.type === 'mouse_scroll' ||
          action.type === 'keyboard_type' ||
          action.type === 'keyboard_hotkey' ||
          action.type === 'media_control')
      ) {
        const sent = onSendInputOpcode(action.type === 'media_control' ? 0x09 : 0x08, {
          ...(action.payload || {}),
          type: action.type,
        });
        if (sent) {
          updateActionResult({
            success: true,
            summary:
              language === 'bg'
                ? `Входното събитие е изпратено към ${resolvedTargetId}`
                : `Dispatched live input event to ${resolvedTargetId}`,
            opcode: action.type === 'media_control' ? '0x09 (WS_MEDIA)' : '0x08 (WS_INPUT)',
          });
          return;
        }
      }

      if (action.type === 'wol' && onSendWol && targetHost) {
        onSelectHost?.(targetHost.id);
        onSendWol(targetHost);
        updateActionResult({
          success: true,
          summary:
            language === 'bg'
              ? `Отворен WoL контролер за ${targetHost.name}`
              : `Opened WoL dispatcher for ${targetHost.name}`,
          opcode: 'UDP:9 (MAGIC_PACKET)',
        });
        return;
      }

      const postControl = async (confirmationId?: string) =>
        fetch('/api/pc-control/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ...action.payload,
            type: action.type,
            target: resolvedTargetId,
            mac: action.payload?.mac || targetHost?.mac || '',
            hostIp: targetHost?.ip || '',
            ...(confirmationId ? { confirmationId } : {}),
          }),
        });

      let res = await postControl();
      let data = await res.json().catch(() => ({} as any));
      if (res.status === 403 && data?.requiresConfirmation && data?.confirmationId) {
        const promptText =
          language === 'bg'
            ? `Високорисково действие: ${action.label || action.type}\nПотвърдете изпълнението?`
            : `High-risk action: ${action.label || action.type}\nConfirm execution?`;
        if (window.confirm(promptText)) {
          res = await postControl(data.confirmationId);
          data = await res.json().catch(() => ({} as any));
        } else {
          data = {
            ...data,
            success: false,
            summary: language === 'bg' ? 'Отказано от потребителя.' : 'Cancelled by operator.',
          };
        }
      } else if (!res.ok && data?.success !== false) {
        data = {
          ...data,
          success: false,
          summary: data?.error || data?.summary || `HTTP ${res.status}`,
        };
      }

      if (action.type === 'wol') {
        const resolvedMac = action.payload?.mac || targetHost?.mac || '';
        if (resolvedMac) {
          wolHistoryStore.addEntry({
            deviceId: targetHost?.id || action.target || 'CUSTOM-MAC',
            deviceName: targetHost?.name || action.target || 'Target Host',
            mac: resolvedMac,
            broadcastIp: '255.255.255.255',
            port: 9,
            bytesCount: 102,
            status: data.success ? 'success' : 'failed',
            source: 'ai',
            latencyMs: data.durationMs || 8,
            details: data.success
              ? `AI Copilot dispatched 102-byte UDP Magic Packet to ${targetHost?.name || action.target} (${resolvedMac}).`
              : `AI Copilot WoL dispatch failed: ${data.error || data.summary || 'Execution blocked'}`,
            detailsBg: data.success
              ? `AI Копилот изпрати 102-байтов UDP Magic Packet към ${targetHost?.name || action.target} (${resolvedMac}).`
              : `Неуспешно AI събуждане (WoL): ${data.error || data.summary || 'Изпълнението е блокирано'}`,
          });
        }
      }

      updateActionResult({
        success: Boolean(data.success),
        summary:
          data.summary ||
          (data.success ? 'Executed on PC' : data.error || 'Execution blocked'),
        output: data.output,
        opcode: data.opcode,
        durationMs: data.durationMs,
        blockedByViewOnly: data.blockedByViewOnly,
      });
    } catch (err: any) {
      console.error('Action execution error:', err);
      updateActionResult({
        success: false,
        summary: err?.message || (language === 'bg' ? 'Грешка при изпълнение' : 'Action execution error'),
      });
    } finally {
      setExecutingActionId(null);
    }
  };

  const handleSendMessage = useCallback(async (textOverride?: string) => {
    const textToSend = (textOverride || inputPrompt).trim();
    if (!textToSend || isLoading) return;

    triggerHapticFeedback('light');
    setInputPrompt('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: Date.now(),
    };

    const updated = [...messages, userMessage];
    setMessages(updated);
    setIsLoading(true);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const fleetContext = {
        protocolVersion: 'AI-NET/3.0-SECURE',
        networkMode: isRealWsConnected ? 'Live Real WebSocket' : 'Active LAN',
        selectedTarget: primaryHost?.id || 'UNSET',
        hostsTotal: hosts.length,
        hostsOnline: hosts.filter((h) => h.isOnline).length,
        hostsSleeping: hosts.filter((h) => !h.isOnline).length,
        avgLatency: latency,
        activeSchedulesCount: wolSchedules.filter((s) => s.enabled).length,
        hosts: hosts.map((h) => ({
          id: h.id,
          name: h.name,
          ip: h.ip,
          mac: h.mac,
          isOnline: h.isOnline,
          ping: h.ping,
          os: h.os,
        })),
      };

      const payload = {
        messages: updated.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        model: activeRoleConfig.model,
        role: activeRole,
        fleetContext,
        autoExecute: autoExecutePcActions,
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Server responded with ${response.status}`);
      }

      const replyContent = data.reply || '';
      const serverResultsMap =
        data.executionResults &&
        typeof data.executionResults === 'object' &&
        !Array.isArray(data.executionResults)
          ? (data.executionResults as Record<string, any>)
          : undefined;
      const actions = buildActionItems(replyContent, data.actions, serverResultsMap);

      if (autoExecutePcActions && Array.isArray(data.actions)) {
        data.actions.forEach((act: any) => {
          const execRes = serverResultsMap?.[act.id];
          const targetHost =
            hosts.find(
              (h) =>
                h.id.toLowerCase() === String(act.target || '').toLowerCase() ||
                h.name.toLowerCase() === String(act.target || '').toLowerCase()
            ) || (!act.target ? primaryHost : undefined);

          if (act.type === 'rescan' && onTriggerRescan) {
            onTriggerRescan();
          } else if (act.type === 'lab_mode' && onToggleLabMode) {
            onToggleLabMode();
          } else if (act.type === 'screen_capture' && onViewScreen && targetHost) {
            onSelectHost?.(targetHost.id);
            onViewScreen(targetHost);
          } else if (act.type === 'wol') {
            if (!execRes && onSendWol && targetHost) {
              onSendWol(targetHost);
              return;
            }
            const isSuccess = Boolean(execRes?.success);
            const resolvedMac = act.mac || targetHost?.mac || '';
            if (resolvedMac) {
              wolHistoryStore.addEntry({
                deviceId: targetHost?.id || act.target || 'CUSTOM-MAC',
                deviceName: targetHost?.name || act.target || 'Target Host',
                mac: resolvedMac,
                broadcastIp: '255.255.255.255',
                port: 9,
                bytesCount: 102,
                status: isSuccess ? 'success' : 'failed',
                source: 'ai',
                latencyMs: execRes?.durationMs || 8,
                details: isSuccess
                  ? `AI Copilot auto-dispatched 102-byte UDP Magic Packet to ${targetHost?.name || act.target} (${resolvedMac}).`
                  : `AI Copilot auto-WoL failed: ${execRes?.error || execRes?.summary || 'Blocked or unexecuted'}`,
                detailsBg: isSuccess
                  ? `AI Копилот автоматично изпрати 102-байтов UDP Magic Packet към ${targetHost?.name || act.target} (${resolvedMac}).`
                  : `Неуспешно автоматично AI събуждане (WoL): ${execRes?.error || execRes?.summary || 'Блокирано'}`,
              });
            }
          } else if (!execRes) {
            if (act.type === 'shell_exec' && act.command && onSendCommand) {
              onSendCommand(act.command, targetHost?.id || act.target || primaryHost?.id || '');
            } else if (
              onSendInputOpcode &&
              (act.type === 'mouse_click' ||
                act.type === 'mouse_double_click' ||
                act.type === 'mouse_move' ||
                act.type === 'mouse_scroll' ||
                act.type === 'keyboard_type' ||
                act.type === 'keyboard_hotkey' ||
                act.type === 'media_control')
            ) {
              onSendInputOpcode(act.type === 'media_control' ? 0x09 : 0x08, act);
            }
          }
        });
      }

      const botMessage: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: 'model',
        content: replyContent,
        timestamp: Date.now(),
        modelUsed: data.modelUsed || activeRoleConfig.model,
        durationMs: data.durationMs,
        actions: actions.length > 0 ? actions : undefined,
      };

      setMessages((prev) => [...prev, botMessage]);
      triggerHapticFeedback('medium');
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Chat error:', err);
      const errorMessage: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'model',
        content:
          language === 'bg'
            ? `Възникна проблем при връзка с AI ядрото (${err.message || 'Error'}).`
            : `Error contacting AI engine (${err.message || 'Error'}).`,
        timestamp: Date.now(),
        modelUsed: activeRoleConfig.model,
      };
      setMessages((prev) => [...prev, errorMessage]);
      triggerHapticFeedback('warning');
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [
    inputPrompt,
    isLoading,
    messages,
    isRealWsConnected,
    primaryHost,
    hosts,
    latency,
    wolSchedules,
    activeRoleConfig.model,
    activeRole,
    autoExecutePcActions,
    buildActionItems,
    onTriggerRescan,
    onToggleLabMode,
    onViewScreen,
    onSelectHost,
    onSendWol,
    onSendCommand,
    onSendInputOpcode,
    language,
  ]);

  handleSendMessageRef.current = handleSendMessage;

  useEffect(() => {
    if (pendingChatPrompt && !isLoading) {
      const promptToRun = pendingChatPrompt;
      setPendingChatPrompt(null);
      handleSendMessageRef.current(promptToRun);
    }
  }, [pendingChatPrompt, isLoading, setPendingChatPrompt]);

  const handleCopy = (id: string, text: string) => {
    triggerHapticFeedback('light');
    copyToClipboard(text);
    setCopiedId(id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1800);
  };

  const quickControlDeck = useMemo(() => {
    const bg = language === 'bg';
    const hostName =
      primaryHost?.name || primaryHost?.id || (language === 'bg' ? 'Няма хост' : 'No Host');
    return [
      {
        id: 'deck-hotkey',
        icon: Zap,
        label: bg ? 'Task Manager' : 'Task Manager',
        color: 'text-indigo-300 border-indigo-400/40 bg-indigo-500/15 hover:bg-indigo-500/25',
        prompt: bg
          ? `Изпрати клавишна комбинация ctrl,shift,esc за отваряне на Task Manager на ${hostName}`
          : `Open Task Manager on ${hostName} using ctrl,shift,esc`,
      },
      {
        id: 'deck-desktop',
        icon: Monitor,
        label: bg ? 'Работен плот (Win+D)' : 'Show Desktop (Win+D)',
        color: 'text-cyan-300 border-cyan-400/40 bg-cyan-500/15 hover:bg-cyan-500/25',
        prompt: bg
          ? `Покажи работния плот на ${hostName} чрез клавишна комбинация win,d`
          : `Show desktop on ${hostName} using win,d`,
      },
      {
        id: 'deck-explorer',
        icon: Terminal,
        label: bg ? 'Файлове (Win+E)' : 'File Explorer',
        color: 'text-amber-300 border-amber-400/40 bg-amber-500/15 hover:bg-amber-500/25',
        prompt: bg
          ? `Отвори файловия мениджър на ${hostName} чрез win,e`
          : `Open File Explorer on ${hostName} using win,e`,
      },
      {
        id: 'deck-switch',
        icon: RefreshCw,
        label: bg ? 'Смени прозорец' : 'Alt+Tab',
        color: 'text-sky-300 border-sky-400/40 bg-sky-500/15 hover:bg-sky-500/25',
        prompt: bg
          ? `Превключи активния прозорец на ${hostName} чрез alt,tab`
          : `Switch active window on ${hostName} using alt,tab`,
      },
      {
        id: 'deck-type',
        icon: Keyboard,
        label: bg ? 'Мрежов статус' : 'Network Status',
        color: 'text-sky-300 border-sky-400/40 bg-sky-500/15 hover:bg-sky-500/25',
        prompt: bg
          ? `Напиши "ipconfig /all" чрез клавиатурата на ${hostName} и натисни Enter`
          : `Type "ipconfig /all" on ${hostName} keyboard and press Enter`,
      },
      {
        id: 'deck-update',
        icon: DownloadCloud,
        label: bg ? 'Системен Ъпдейт' : 'System Update',
        color: 'text-emerald-300 border-emerald-400/40 bg-emerald-500/18 hover:bg-emerald-500/30',
        prompt: bg
          ? 'Провери за налични обновления и обнови всички AI модели, хост демона и правилата на защитната стена'
          : 'Check for available updates and upgrade all AI models, the PC host daemon, and AST firewall rules now',
      },
    ];
  }, [language, primaryHost]);

  const renderFormattedContent = (content: string) => {
    const cleanText = content.replace(/\[ACTION:[^\]]+\]/gi, '').trim();
    const parts = cleanText.split(/(```[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const lines = part.slice(3, -3).trim().split('\n');
        const firstLine = lines[0].trim();
        const hasLang = /^[a-z0-9_-]+$/i.test(firstLine);
        const lang = hasLang ? firstLine : '';
        const code = (hasLang ? lines.slice(1) : lines).join('\n');

        return (
          <div
            key={index}
            className="my-2 rounded-xl bg-black/60 border border-white/10 overflow-hidden text-[12px] font-mono"
          >
            <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.04] border-b border-white/5 text-[10px] text-slate-400">
              <span className="uppercase tracking-wider font-semibold text-cyan-400">
                {lang || 'SHELL'}
              </span>
              <button
                type="button"
                onClick={() => handleCopy(`code-${index}`, code)}
                className="hover:text-white transition flex items-center gap-1 px-1.5 py-0.5"
              >
                {copiedId === `code-${index}` ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">
                      {language === 'bg' ? 'Копирано' : 'Copied'}
                    </span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>{language === 'bg' ? 'Копирай' : 'Copy'}</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 overflow-x-auto text-slate-200 select-text leading-relaxed">
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      return (
        <div key={index} className="space-y-1.5 whitespace-pre-wrap select-text">
          {part}
        </div>
      );
    });
  };

  const getActionIcon = (type: AiActionItem['type']) => {
    switch (type) {
      case 'mouse_click':
      case 'mouse_double_click':
      case 'mouse_move':
      case 'mouse_scroll':
        return <MousePointerClick className="w-4 h-4 text-cyan-300 shrink-0" />;
      case 'keyboard_type':
      case 'keyboard_hotkey':
      case 'media_control':
        return <Keyboard className="w-4 h-4 text-sky-300 shrink-0" />;
      case 'shell_exec':
        return <Terminal className="w-4 h-4 text-indigo-300 shrink-0" />;
      case 'system_update':
        return <DownloadCloud className="w-4 h-4 text-emerald-300 shrink-0" />;
      case 'daemon_control':
        return <Shield className="w-4 h-4 text-amber-300 shrink-0" />;
      case 'screen_capture':
        return <Monitor className="w-4 h-4 text-purple-300 shrink-0" />;
      case 'wol':
        return <Power className="w-4 h-4 text-emerald-300 shrink-0" />;
      case 'rescan':
        return <RefreshCw className="w-4 h-4 text-cyan-300 shrink-0" />;
      default:
        return <FlaskConical className="w-4 h-4 text-cyan-300 shrink-0" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-between w-full max-w-5xl 2xl:max-w-7xl mx-auto pb-1 select-none">
      {/* 1. Sleek Native Header Bar */}
      <header className="flex-none py-2 px-3 mb-2 rounded-2xl glass-liquid flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-400/35 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-cyan-300" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <h2 className="font-display text-xs sm:text-[13px] font-bold text-white tracking-tight flex items-center gap-1.5 min-w-0">
              <span className="truncate">AI NetController Copilot</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            </h2>
            <span className="text-[10px] font-mono text-cyan-300/80 truncate">
              {selectedModel || activeRoleConfig.model} •{' '}
              {primaryHost ? primaryHost.name : language === 'bg' ? 'Няма хост' : 'No Host'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap">
          <button
            type="button"
            onClick={toggleAutoExecute}
            className={`px-2.5 h-8 rounded-xl text-[10px] sm:text-[11px] font-semibold border transition flex items-center justify-center gap-1.5 active:scale-95 ${
              autoExecutePcActions
                ? 'bg-emerald-500/18 text-emerald-300 border-emerald-400/40'
                : 'bg-[#070d1b] text-slate-400 border-white/10 hover:text-white'
            }`}
            title={
              language === 'bg'
                ? 'Автоматично изпълнявай AI команди'
                : 'Automatically execute AI actions'
            }
          >
            <span
              className={`w-2 h-2 rounded-full ${
                autoExecutePcActions ? 'bg-emerald-400' : 'bg-slate-500'
              }`}
            />
            <span className="hidden md:inline">
              {language === 'bg' ? 'Авто-PC' : 'Auto-PC'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              setShowControlDeck((prev) => !prev);
            }}
            className={`w-8 h-8 rounded-xl border flex items-center justify-center transition active:scale-95 ${
              showControlDeck
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
                : 'bg-[#070d1b] text-slate-400 border-white/10 hover:text-white'
            }`}
            title={language === 'bg' ? 'AI Панел за Бърз Контрол' : 'AI Quick Control Deck'}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center bg-[#070d1b] border border-white/10 p-0.5 rounded-xl">
            {ROLES.map((r) => {
              const isSelected = activeRole === r.id;
              const Icon = r.icon;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleRoleSelect(r.id)}
                  className={`px-2 sm:px-2.5 h-7 rounded-lg text-[11px] font-semibold transition flex items-center gap-1 whitespace-nowrap ${
                    isSelected
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/35'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-display">{r.label}</span>
                </button>
              );
            })}
          </div>

          {messages.length > 1 && (
            <button
              type="button"
              onClick={handleClearHistory}
              className="w-8 h-8 rounded-xl bg-[#070d1b] border border-white/10 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition active:scale-95"
              title={language === 'bg' ? 'Изчисти чата' : 'Clear chat'}
              aria-label={language === 'bg' ? 'Изчисти чата' : 'Clear chat'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* 1.5 Direct AI PC Control Deck (Collapsible) */}
      <AnimatePresence initial={false}>
        {showControlDeck && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-none overflow-hidden mb-2"
          >
            <div className="px-2.5 py-2 rounded-xl bg-[#0b1326] border border-white/10 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 shrink-0 flex items-center gap-1 pr-1.5 border-r border-white/10">
                <Zap className="w-3 h-3 text-cyan-400" />
                <span>{language === 'bg' ? 'Бързи:' : 'Quick:'}</span>
              </span>
              {quickControlDeck.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleSendMessage(item.prompt)}
                    className={`h-8 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 shrink-0 transition active:scale-95 ${item.color}`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
              {onOpenUpdateCenter && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    onOpenUpdateCenter();
                  }}
                  className="h-8 px-3 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/10 text-slate-300 text-xs font-semibold flex items-center gap-1.5 shrink-0 transition ml-auto active:scale-95"
                >
                  <RefreshCw className="w-3 h-3 text-emerald-400" />
                  <span>{language === 'bg' ? 'Обновления' : 'Updates'}</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Scrollable Conversation Thread */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-2 px-0.5 space-y-3 bouncy-scroll"
      >
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`text-xs sm:text-[13px] leading-relaxed relative break-words overflow-hidden ${
                  isUser
                    ? 'bg-cyan-500/20 text-white border border-cyan-400/35 rounded-2xl rounded-tr-xs px-3.5 py-2.5 max-w-[85%] lg:max-w-[75%]'
                    : 'glass-liquid text-slate-100 rounded-2xl rounded-tl-xs p-3.5 max-w-[96%] sm:max-w-[88%] lg:max-w-[84%]'
                }`}
              >
                {!isUser && (
                  <div className="flex items-center justify-between gap-3 mb-2 text-[10px] text-cyan-300/80 font-mono border-b border-white/[0.06] pb-1.5">
                    <span className="flex items-center gap-1 font-semibold truncate">
                      <Bot className="w-3 h-3 shrink-0" />
                      <span className="truncate">{msg.modelUsed || activeRoleConfig.model}</span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {msg.durationMs && (
                        <span className="flex items-center gap-0.5 text-slate-400 tabular-nums">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{msg.durationMs}ms</span>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy(
                            msg.id,
                            msg.content.replace(/\[ACTION:[^\]]+\]/gi, '').trim()
                          )
                        }
                        className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-white/5 transition flex items-center justify-center"
                        title={language === 'bg' ? 'Копирай отговора' : 'Copy response'}
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {renderFormattedContent(msg.content)}

                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-white/10 space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-cyan-300/80">
                      <span>
                        {language === 'bg'
                          ? `AI Действия (${msg.actions.length})`
                          : `AI Directives (${msg.actions.length})`}
                      </span>
                      <span>AI-NET/3.0-SECURE</span>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      {msg.actions.map((action) => {
                        const exec = action.executionResult;
                        const isRunning = executingActionId === action.id;

                        return (
                          <div
                            key={action.id}
                            className={`rounded-xl p-2.5 border transition-all ${
                              exec?.success
                                ? 'bg-emerald-950/25 border-emerald-500/35'
                                : exec && !exec.success
                                ? 'bg-amber-950/25 border-amber-500/35'
                                : 'bg-[#070d1b] border-white/10'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
                                  {getActionIcon(action.type)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-bold text-white break-words">
                                    {action.label}
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-400 flex items-center gap-2 flex-wrap">
                                    <span>
                                      {exec?.opcode || action.subtitle || action.type.toUpperCase()}
                                    </span>
                                    {exec?.durationMs !== undefined && (
                                      <span className="text-emerald-400">• {exec.durationMs}ms</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                                {exec && (
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold flex items-center gap-1 ${
                                      exec.success
                                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                                        : 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
                                    }`}
                                  >
                                    {exec.success ? (
                                      <>
                                        <CheckCircle2 className="w-3 h-3" />
                                        <span>{language === 'bg' ? 'Изпълнено' : 'Executed'}</span>
                                      </>
                                    ) : (
                                      <>
                                        <AlertTriangle className="w-3 h-3" />
                                        <span>{language === 'bg' ? 'Задържано' : 'Blocked'}</span>
                                      </>
                                    )}
                                  </span>
                                )}

                                <button
                                  type="button"
                                  disabled={isRunning}
                                  onClick={() => handleExecuteActionItem(msg.id, action)}
                                  className="px-2.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 border border-cyan-400/40 text-[11px] font-semibold flex items-center gap-1 transition active:scale-95"
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>
                                    {isRunning
                                      ? language === 'bg'
                                        ? 'Изпълнява...'
                                        : 'Running...'
                                      : exec
                                      ? language === 'bg'
                                        ? 'Отново'
                                        : 'Re-Run'
                                      : language === 'bg'
                                      ? 'Изпълни'
                                      : 'Execute'}
                                  </span>
                                </button>

                                {action.type === 'system_update' && onOpenUpdateCenter && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenUpdateCenter()}
                                    className="px-2 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/12 text-slate-200 border border-white/15 text-[11px] font-medium flex items-center gap-1"
                                  >
                                    <span>{language === 'bg' ? 'Детайли' : 'Details'}</span>
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                )}

                                {action.type === 'daemon_control' && onOpenDaemonGui && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenDaemonGui()}
                                    className="px-2 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/12 text-slate-200 border border-white/15 text-[11px] font-medium flex items-center gap-1"
                                  >
                                    <span>{language === 'bg' ? 'Демон' : 'Daemon'}</span>
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {exec?.summary && (
                              <div className="mt-1.5 text-[11px] text-slate-300 font-medium">
                                {exec.summary}
                              </div>
                            )}

                            {exec?.output && (
                              <pre className="mt-1.5 p-2 rounded-lg bg-black/50 border border-white/10 text-[10px] font-mono text-emerald-300/90 overflow-x-auto max-h-28">
                                {exec.output}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0b1326] border border-cyan-400/30 text-cyan-300 text-xs font-mono w-max">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>
              {language === 'bg'
                ? 'Gemini анализира и подготвя действия...'
                : 'Gemini reasoning & preparing actions...'}
            </span>
          </div>
        )}
      </div>

      {/* 3. Prompt Input Bar */}
      <footer className="flex-none pt-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="relative bg-[#0b1326] border border-white/15 focus-within:border-cyan-400/60 rounded-2xl p-1.5 flex items-center gap-1.5"
        >
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={activeRoleConfig.placeholder}
            rows={1}
            className="flex-1 bg-transparent px-3 py-1.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none resize-none max-h-24 leading-relaxed font-medium"
          />

          {isLoading ? (
            <button
              type="button"
              onClick={handleStopGeneration}
              className="w-9 h-9 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-400/40 flex items-center justify-center transition shrink-0 active:scale-95"
              title={language === 'bg' ? 'Спри генерирането' : 'Stop generation'}
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputPrompt.trim()}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition shrink-0 active:scale-95 ${
                inputPrompt.trim()
                  ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold'
                  : 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed'
              }`}
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}
        </form>
      </footer>
    </div>
  );
};

export const GeminiChatbot = React.memo(GeminiChatbotComponent);
