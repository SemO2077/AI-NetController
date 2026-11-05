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
import { triggerHapticFeedback } from '../services/hapticService';
import { copyToClipboard } from '../utils/clipboard';
import { HostDevice, WolSchedule } from '../types';
import { useTranslation } from '../i18n/useTranslation';
import { useUIStore } from '../store/uiStore';
import { wolHistoryStore } from '../store/wolHistoryStore';

export type BotRole = 'commander' | 'diagnostics' | 'fast_triage';
export type GeminiModelId =
  | 'gemini-3.8-flash'
  | 'gemini-3.1-flash-lite'
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
        ? 'Здравейте! Аз съм Вашият **CST Fleet Commander AI** с директен 120Hz контрол над компютъра и автоматични ъпдейти.\n\nМога да управлявам **мишката и клавиатурата** на PC-то (`Opcode 0x08`), да изпълнявам **Shell команди**, да изпращам **Wake-on-LAN** пакети, да управлявам **PC Демона** и да инсталирам **системни и AI обновления**.'
        : 'Hello! I am your **CST Fleet Commander AI** with live 120Hz PC control and autonomous update capabilities.\n\nI can directly control your PC **mouse & keyboard** (`Opcode 0x08`), execute **Shell commands**, broadcast **Wake-on-LAN** packets, configure the **PC Host Daemon**, and run **System & AI Model Updates**.',
    [language]
  );

  const ROLES = useMemo(
    () => [
      {
        id: 'commander' as BotRole,
        label: language === 'bg' ? 'PC & Флот' : 'PC & Fleet',
        model: (selectedModel || 'gemini-3.8-flash') as GeminiModelId,
        icon: Sparkles,
        placeholder:
          language === 'bg'
            ? 'напр. „Кликни на (960, 540)“, „Напиши ipconfig“, „Обнови AI моделите“...'
            : 'e.g. "Click at (960, 540)", "Type hello on PC", "Update all AI models"...',
      },
      {
        id: 'diagnostics' as BotRole,
        label: language === 'bg' ? 'Сигурност' : 'Security',
        model: (selectedModel || 'gemini-3.8-flash') as GeminiModelId,
        icon: Shield,
        placeholder: language === 'bg' ? 'Одит на PC демона и CST/3.0 протокола...' : 'Audit PC daemon & CST/3.0 security...',
      },
      {
        id: 'fast_triage' as BotRole,
        label: language === 'bg' ? 'Бърз Контрол' : 'Quick Action',
        model: (selectedModel || 'gemini-3.8-flash') as GeminiModelId,
        icon: Terminal,
        placeholder: language === 'bg' ? 'Бърза команда или клавишна комбинация...' : 'Fast shell command or keyboard shortcut...',
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

  const [showControlDeck, setShowControlDeck] = useState<boolean>(true);
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
        modelUsed: selectedModel || 'gemini-3.8-flash',
      },
    ];
  });

  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === 'welcome'
          ? { ...m, content: welcomeText, modelUsed: selectedModel || 'gemini-3.8-flash' }
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-20)));
    } catch {}
  }, [messages]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
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
    triggerHapticFeedback('selection');
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
    const fresh: ChatMessage = {
      id: `init-${Date.now()}`,
      role: 'model',
      content:
        language === 'bg'
          ? 'Разговорът е изчистен. Готов съм за PC контрол, диагностика или системни обновления.'
          : 'Conversation cleared. Ready for PC control, diagnostics, or system updates.',
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

  // Build rich localized AiActionItem list from server actions or raw text
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

      // Client fallback regex parser if serverActions wasn't populated
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

  // Execute or Re-Run a single AI Action Item on the PC / Server
  const handleExecuteActionItem = async (messageId: string, action: AiActionItem) => {
    triggerHapticFeedback('medium');
    setExecutingActionId(action.id);

    try {
      if (action.type === 'rescan') {
        onTriggerRescan?.();
        setExecutingActionId(null);
        return;
      }
      if (action.type === 'lab_mode') {
        onToggleLabMode?.();
        setExecutingActionId(null);
        return;
      }

      // Also invoke local UI callbacks when relevant
      if (action.type === 'shell_exec' && action.payload?.command && onSendCommand) {
        onSendCommand(action.payload.command, action.target || selectedTarget);
      } else if (action.type === 'screen_capture' && onViewScreen) {
        const hostObj = hosts.find((h) => h.id === action.target) || primaryHost;
        if (hostObj) {
          onViewScreen(hostObj);
        }
      } else if (
        onSendInputOpcode &&
        (action.type === 'mouse_click' ||
          action.type === 'mouse_double_click' ||
          action.type === 'mouse_move' ||
          action.type === 'mouse_scroll' ||
          action.type === 'keyboard_type' ||
          action.type === 'keyboard_hotkey' ||
          action.type === 'media_control')
      ) {
        onSendInputOpcode(
          action.type === 'media_control' ? 0x09 : 0x08,
          { ...(action.payload || {}), type: action.type }
        );
      }

      const res = await fetch('/api/pc-control/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...action.payload,
          type: action.type,
          target: action.target || primaryHost?.id || '',
          mac: action.payload?.mac || primaryHost?.mac || '',
        }),
      });
      const data = await res.json();

      if (action.type === 'wol') {
        const targetHost =
          hosts.find((h) => h.id === action.target || h.name === action.target) || primaryHost;
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

      // Update action execution result inside the message state
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.actions) return m;
          return {
            ...m,
            actions: m.actions.map((a) =>
              a.id === action.id
                ? {
                    ...a,
                    executionResult: {
                      success: Boolean(data.success),
                      summary: data.summary || (data.success ? 'Executed on PC' : data.error || 'Execution blocked'),
                      output: data.output,
                      opcode: data.opcode,
                      durationMs: data.durationMs,
                      blockedByViewOnly: data.blockedByViewOnly,
                    },
                  }
                : a
            ),
          };
        })
      );
      triggerHapticFeedback(data.success ? 'heavy' : 'warning');
    } catch (err: any) {
      console.error('Action execution error:', err);
    } finally {
      setExecutingActionId(null);
    }
  };

  const handleSendMessage = async (textOverride?: string) => {
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
        protocolVersion: 'CST/3.0-SECURE',
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
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Server responded with ${response.status}`);
      }

      const replyContent = data.reply || '';
      const actions = buildActionItems(replyContent, data.actions, data.executionResults);

      // If autoExecute is on and a shell command, input event, or WoL was executed by the AI, sync with terminal, WebSocket & WoL history
      if (autoExecutePcActions && Array.isArray(data.actions)) {
        data.actions.forEach((act: any, idx: number) => {
          if (act.type === 'shell_exec' && act.command && onSendCommand) {
            onSendCommand(act.command, act.target || primaryHost?.id || '');
          } else if (act.type === 'rescan' && onTriggerRescan) {
            onTriggerRescan();
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
          } else if (act.type === 'wol') {
            const execRes = Array.isArray(data.executionResults) ? data.executionResults[idx] : undefined;
            const isSuccess = execRes ? Boolean(execRes.success) : true;
            const targetHost =
              hosts.find((h) => h.id === act.target || h.name === act.target) || primaryHost;
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
                  : `AI Copilot auto-WoL failed: ${execRes?.error || execRes?.summary || 'Blocked'}`,
                detailsBg: isSuccess
                  ? `AI Копилот автоматично изпрати 102-байтов UDP Magic Packet към ${targetHost?.name || act.target} (${resolvedMac}).`
                  : `Неуспешно автоматично AI събуждане (WoL): ${execRes?.error || execRes?.summary || 'Блокирано'}`,
              });
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
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  };

  // Auto-dispatch proactive AI diagnostic prompt from HostCard anomaly pill
  useEffect(() => {
    if (pendingChatPrompt && !isLoading) {
      const promptToRun = pendingChatPrompt;
      setPendingChatPrompt(null);
      handleSendMessage(promptToRun);
    }
  }, [pendingChatPrompt, isLoading, setPendingChatPrompt]);

  const handleCopy = (id: string, text: string) => {
    triggerHapticFeedback('light');
    copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  // Quick 1-Tap AI PC Control & Update Deck items
  const quickControlDeck = useMemo(() => {
    const bg = language === 'bg';
    const hostName = primaryHost?.name || primaryHost?.id || (language === 'bg' ? 'Няма хост' : 'No Host');
    return [
      {
        id: 'deck-hotkey',
        icon: Zap,
        label: bg ? 'Диспечер на задачи (Task Manager)' : 'Open Task Manager',
        color: 'text-indigo-300 border-indigo-400/30 bg-indigo-500/10 hover:bg-indigo-500/20',
        prompt: bg
          ? `Изпрати клавишна комбинация ctrl,shift,esc за отваряне на Task Manager на ${hostName}`
          : `Open Task Manager on ${hostName} using ctrl,shift,esc`,
      },
      {
        id: 'deck-desktop',
        icon: Monitor,
        label: bg ? 'Покажи работния плот (Win+D)' : 'Show Desktop (Win+D)',
        color: 'text-cyan-300 border-cyan-400/30 bg-cyan-500/10 hover:bg-cyan-500/20',
        prompt: bg
          ? `Покажи работния плот на ${hostName} чрез клавишна комбинация win,d`
          : `Show desktop on ${hostName} using win,d`,
      },
      {
        id: 'deck-explorer',
        icon: Terminal,
        label: bg ? 'Файлов мениджър (Win+E)' : 'Open File Explorer',
        color: 'text-amber-300 border-amber-400/30 bg-amber-500/10 hover:bg-amber-500/20',
        prompt: bg
          ? `Отвори файловия мениджър на ${hostName} чрез win,e`
          : `Open File Explorer on ${hostName} using win,e`,
      },
      {
        id: 'deck-switch',
        icon: RefreshCw,
        label: bg ? 'Смени прозорец (Alt+Tab)' : 'Switch Window (Alt+Tab)',
        color: 'text-sky-300 border-sky-400/30 bg-sky-500/10 hover:bg-sky-500/20',
        prompt: bg
          ? `Превключи активния прозорец на ${hostName} чрез alt,tab`
          : `Switch active window on ${hostName} using alt,tab`,
      },
      {
        id: 'deck-click',
        icon: MousePointerClick,
        label: bg ? 'Ляв клик (960, 540)' : 'Left Click (960, 540)',
        color: 'text-cyan-300 border-cyan-400/30 bg-cyan-500/10 hover:bg-cyan-500/20',
        prompt: bg
          ? `Кликни с левия бутон на мишката на координати 960, 540 на ${hostName}`
          : `Click the left mouse button at coordinates 960, 540 on ${hostName}`,
      },
      {
        id: 'deck-right-click',
        icon: MousePointerClick,
        label: bg ? 'Десен клик (960, 540)' : 'Right Click (960, 540)',
        color: 'text-purple-300 border-purple-400/30 bg-purple-500/10 hover:bg-purple-500/20',
        prompt: bg
          ? `Кликни с десния бутон на мишката на координати 960, 540 на ${hostName}`
          : `Right click the mouse at coordinates 960, 540 on ${hostName}`,
      },
      {
        id: 'deck-type',
        icon: Keyboard,
        label: bg ? 'Напиши Статус Команда' : 'Type Status Command',
        color: 'text-sky-300 border-sky-400/30 bg-sky-500/10 hover:bg-sky-500/20',
        prompt: bg
          ? `Напиши "ipconfig /all" чрез клавиатурата на ${hostName} и натисни Enter`
          : `Type "ipconfig /all" on ${hostName} keyboard and press Enter`,
      },
      {
        id: 'deck-update',
        icon: DownloadCloud,
        label: bg ? 'Системен Ъпдейт' : 'Run System Update',
        color: 'text-emerald-300 border-emerald-400/35 bg-emerald-500/12 hover:bg-emerald-500/25',
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
          <div key={index} className="my-2.5 rounded-2xl bg-black/60 border border-white/10 overflow-hidden text-[12px] font-mono shadow-inner">
            <div className="flex items-center justify-between px-3.5 py-1.5 bg-white/[0.04] border-b border-white/5 text-[10px] text-slate-400">
              <span className="uppercase tracking-wider font-semibold text-cyan-400">{lang || 'SHELL'}</span>
              <button
                type="button"
                onClick={() => handleCopy(`code-${index}`, code)}
                className="hover:text-white transition flex items-center space-x-1 cursor-pointer min-h-[28px] px-1.5"
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
            <pre className="p-3.5 overflow-x-auto text-slate-200 select-text leading-relaxed">
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
    <div className="flex-1 flex flex-col justify-between w-full max-w-5xl 2xl:max-w-7xl mx-auto px-1 sm:px-3 pb-1 select-none">
      {/* 1. Tier 2 Optical Glass Header Bar with Role Pills & Auto-Execute Toggle */}
      <header className="flex-none py-2 px-3 mb-2 rounded-full bg-[#081024]/95 backdrop-blur-2xl border border-white/18 border-t-cyan-400/50 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_24px_rgba(0,240,255,0.12)] transform-gpu flex items-center justify-between relative gap-2 flex-wrap sm:flex-nowrap">
        <div className="absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/40 to-transparent pointer-events-none" />

        {/* Gemini Identity & Active Target */}
        <div className="flex items-center space-x-2.5 pl-1 min-w-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400/20 to-blue-500/20 border border-cyan-400/30 flex items-center justify-center shadow-[0_0_12px_rgba(0,212,255,0.25)] shrink-0">
            <Sparkles className="w-4 h-4 text-cyan-300 icon-sparkle-live" />
          </div>
          <div className="flex flex-col min-w-0">
            <h2 className="font-display text-xs sm:text-[13px] font-bold text-white tracking-tight flex items-center space-x-1.5">
              <span className="truncate">Gemini PC Copilot</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399] shrink-0" />
            </h2>
            <span className="text-[10px] font-mono text-cyan-300/80 truncate">
              {selectedModel || activeRoleConfig.model} • {primaryHost ? primaryHost.name : (language === 'bg' ? 'Няма хост' : 'No Host')}
            </span>
          </div>
        </div>

        {/* Right Controls: Auto-Exec Toggle + Role Selector + Clear */}
        <div className="flex items-center space-x-1.5 shrink-0 ml-auto">
          {/* Auto-Execute PC Actions Toggle */}
          <button
            type="button"
            onClick={toggleAutoExecute}
            className={`px-2.5 py-1.5 min-h-[36px] rounded-full text-[10px] sm:text-[11px] font-semibold border transition flex items-center space-x-1.5 cursor-pointer bubble-tap ${
              autoExecutePcActions
                ? 'bg-emerald-500/18 text-emerald-300 border-emerald-400/40 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                : 'bg-white/[0.04] text-slate-400 border-white/10 hover:text-white'
            }`}
            title={
              language === 'bg'
                ? 'Автоматично изпълнявай AI команди за мишка, клавиатура и обновления'
                : 'Automatically execute AI mouse, keyboard, shell, and update actions'
            }
          >
            <span
              className={`w-2 h-2 rounded-full ${
                autoExecutePcActions ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-slate-500'
              }`}
            />
            <span className="hidden md:inline">
              {language === 'bg' ? 'Авто-PC Контрол' : 'Auto-PC Control'}
            </span>
          </button>

          {/* Toggle Quick Control Deck */}
          <button
            type="button"
            onClick={() => {
              triggerHapticFeedback('light');
              setShowControlDeck((prev) => !prev);
            }}
            className={`w-9 h-9 rounded-full border flex items-center justify-center transition cursor-pointer bubble-tap ${
              showControlDeck
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
                : 'bg-white/[0.04] text-slate-400 border-white/10 hover:text-white'
            }`}
            title={language === 'bg' ? 'AI Панел за Бърз Контрол' : 'AI Quick Control Deck'}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>

          {/* Segmented Role Selector with Sliding Lens */}
          <div className="flex items-center glass-liquid-subtle p-1 rounded-full">
            {ROLES.map((r) => {
              const isSelected = activeRole === r.id;
              const Icon = r.icon;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleRoleSelect(r.id)}
                  className={`group relative px-2.5 sm:px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors duration-200 cursor-pointer flex items-center space-x-1.5 z-10 whitespace-nowrap min-h-[36px] ${
                    isSelected ? 'text-cyan-200' : 'text-white/50 hover:text-white/85'
                  }`}
                >
                  {isSelected && (
                    <motion.div
                      layoutId="geminiRoleLens"
                      className="absolute inset-0 rounded-full bg-gradient-to-r from-cyan-500/25 to-sky-500/20 border border-cyan-400/45 shadow-[0_0_12px_rgba(56,189,248,0.25)] -z-10 transform-gpu"
                      transition={{ type: 'spring', stiffness: 480, damping: 24, mass: 0.6 }}
                    />
                  )}
                  <Icon className="w-3.5 h-3.5 shrink-0 icon-bubbly" />
                  <span className="font-display">{r.label}</span>
                </button>
              );
            })}
          </div>

          {messages.length > 1 && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.08, rotate: -8 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleClearHistory}
              className="group w-9 h-9 rounded-full glass-liquid-subtle hover:bg-white/10 text-white/55 hover:text-white flex items-center justify-center transition cursor-pointer transform-gpu"
              title={language === 'bg' ? 'Изчисти чата' : 'Clear chat'}
              aria-label={language === 'bg' ? 'Изчисти чата' : 'Clear chat'}
            >
              <Trash2 className="w-4 h-4 icon-bubbly" />
            </motion.button>
          )}
        </div>
      </header>

      {/* 1.5 Direct AI PC Control & Update Deck */}
      <AnimatePresence initial={false}>
        {showControlDeck && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 460, damping: 28 }}
            className="flex-none overflow-hidden mb-2"
          >
            <div className="px-3 py-2 rounded-2xl bg-[#081124]/90 backdrop-blur-2xl border border-cyan-400/20 flex items-center gap-2 overflow-x-auto scrollbar-none [mask-image:linear-gradient(to_right,black_92%,transparent_100%)]">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 shrink-0 flex items-center gap-1 pr-1 border-r border-white/10">
                <Zap className="w-3 h-3 text-cyan-400" />
                <span>{language === 'bg' ? 'AI PC Контрол:' : 'AI PC Deck:'}</span>
              </span>
              {quickControlDeck.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleSendMessage(item.prompt)}
                    className={`min-h-[38px] px-3.5 py-2 rounded-full border text-xs font-semibold flex items-center space-x-2 shrink-0 transition cursor-pointer bubble-tap ${item.color}`}
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
                  className="min-h-[38px] px-3.5 py-2 rounded-full border border-white/15 bg-white/[0.04] hover:bg-white/10 text-slate-300 text-xs font-semibold flex items-center space-x-1.5 shrink-0 transition cursor-pointer ml-auto"
                >
                  <RefreshCw className="w-3 h-3 text-emerald-400" />
                  <span>{language === 'bg' ? 'Update Център' : 'Update Center'}</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Scrollable Conversation Thread with Bouncy Overscroll */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-3 px-1 space-y-4 bouncy-scroll"
      >
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 14, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 24, mass: 0.6 }}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              {/* Message Bubble */}
              <div
                className={`text-xs sm:text-[13px] leading-relaxed relative ${
                  isUser
                    ? 'glass-liquid-elevated bg-cyan-500/20 text-white border border-cyan-400/35 rounded-[1.5rem] rounded-tr-xs px-4 py-2.5 max-w-[85%] lg:max-w-[75%] shadow-[0_8px_20px_rgba(0,212,255,0.15)]'
                    : 'glass-liquid text-slate-100 rounded-[1.75rem] rounded-tl-xs p-4 max-w-[95%] sm:max-w-[88%] lg:max-w-[84%] border border-white/10 shadow-lg'
                }`}
              >
                {!isUser && (
                  <div className="flex items-center justify-between gap-3 mb-2 text-[10px] text-cyan-300/80 font-mono border-b border-white/6 pb-1.5">
                    <span className="flex items-center space-x-1 font-semibold truncate">
                      <Bot className="w-3 h-3 shrink-0" />
                      <span className="truncate">{msg.modelUsed || activeRoleConfig.model}</span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {msg.durationMs && (
                        <span className="flex items-center space-x-0.5 text-white/40 tabular-nums">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{msg.durationMs}ms</span>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.id, msg.content.replace(/\[ACTION:[^\]]+\]/gi, '').trim())}
                        className="min-h-[32px] px-2 py-1 rounded-lg text-white/45 hover:text-cyan-300 hover:bg-white/5 transition flex items-center gap-1 cursor-pointer text-xs"
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

                {/* Interactive PC Control & System Update Action Cards */}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-3.5 pt-3 border-t border-white/10 space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-cyan-300/80">
                      <span>
                        {language === 'bg'
                          ? `Изпълними AI Действия (${msg.actions.length})`
                          : `Executable AI Directives (${msg.actions.length})`}
                      </span>
                      <span>CST/3.0-SECURE</span>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      {msg.actions.map((action) => {
                        const exec = action.executionResult;
                        const isRunning = executingActionId === action.id;

                        return (
                          <div
                            key={action.id}
                            className={`rounded-2xl p-3 border transition-all ${
                              exec?.success
                                ? 'bg-emerald-950/25 border-emerald-500/35'
                                : exec && !exec.success
                                ? 'bg-amber-950/25 border-amber-500/35'
                                : 'bg-white/[0.03] border-white/12'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center space-x-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
                                  {getActionIcon(action.type)}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-white truncate">
                                    {action.label}
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-400 flex items-center gap-2 flex-wrap">
                                    <span>{exec?.opcode || action.subtitle || action.type.toUpperCase()}</span>
                                    {exec?.durationMs !== undefined && (
                                      <span className="text-emerald-400">• {exec.durationMs}ms</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 ml-auto">
                                {exec && (
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold flex items-center space-x-1 ${
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
                                  className="px-3 py-1.5 min-h-[34px] rounded-full bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 border border-cyan-400/40 text-[11px] font-semibold flex items-center space-x-1 cursor-pointer transition bubble-tap"
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>
                                    {isRunning
                                      ? language === 'bg'
                                        ? 'Изпълнява...'
                                        : 'Running...'
                                      : exec
                                      ? language === 'bg'
                                        ? 'Изпълни пак'
                                        : 'Re-Run'
                                      : language === 'bg'
                                      ? 'Изпълни сега'
                                      : 'Execute Now'}
                                  </span>
                                </button>

                                {action.type === 'system_update' && onOpenUpdateCenter && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenUpdateCenter()}
                                    className="px-2.5 py-1.5 min-h-[34px] rounded-full bg-white/[0.06] hover:bg-white/12 text-slate-200 border border-white/15 text-[11px] font-medium flex items-center space-x-1 cursor-pointer"
                                  >
                                    <span>{language === 'bg' ? 'Детайли' : 'Details'}</span>
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                )}

                                {action.type === 'daemon_control' && onOpenDaemonGui && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenDaemonGui()}
                                    className="px-2.5 py-1.5 min-h-[34px] rounded-full bg-white/[0.06] hover:bg-white/12 text-slate-200 border border-white/15 text-[11px] font-medium flex items-center space-x-1 cursor-pointer"
                                  >
                                    <span>{language === 'bg' ? 'Демон GUI' : 'Daemon GUI'}</span>
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {exec?.summary && (
                              <div className="mt-2 text-[11px] text-slate-300 font-medium">
                                {exec.summary}
                              </div>
                            )}

                            {exec?.output && (
                              <pre className="mt-1.5 p-2 rounded-xl bg-black/50 border border-white/8 text-[10px] font-mono text-emerald-300/90 overflow-x-auto max-h-28">
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
            </motion.div>
          );
        })}

        {/* Loading Indicator Pill */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center space-x-2.5 px-4 py-2.5 rounded-full glass-liquid-subtle border border-cyan-400/30 text-cyan-300 text-xs font-mono w-max shadow-md"
          >
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>
              {language === 'bg'
                ? 'Gemini анализира и подготвя PC действия...'
                : 'Gemini reasoning & preparing PC actions...'}
            </span>
          </motion.div>
        )}
      </div>

      {/* 3. Tier 2 Liquid Glass Input Capsule Bar */}
      <footer className="flex-none pt-1">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="relative bg-[#081024]/95 backdrop-blur-2xl border border-white/18 border-t-cyan-400/50 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_24px_rgba(0,240,255,0.12)] transform-gpu rounded-full p-1.5 flex items-center"
        >
          <div className="absolute inset-x-8 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/40 to-transparent pointer-events-none" />

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
            className="flex-1 bg-transparent px-4 py-2 text-xs sm:text-sm text-slate-100 placeholder-slate-400/70 focus:outline-none resize-none max-h-24 leading-relaxed font-medium"
          />

          {isLoading ? (
            <button
              type="button"
              onClick={handleStopGeneration}
              className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-400/40 flex items-center justify-center transition cursor-pointer shrink-0 bubble-tap"
              title={language === 'bg' ? 'Спри генерирането' : 'Stop generation'}
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputPrompt.trim()}
              className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-all duration-200 shrink-0 cursor-pointer bubble-tap ${
                inputPrompt.trim()
                  ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 font-bold shadow-[0_0_16px_rgba(0,212,255,0.5)]'
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
