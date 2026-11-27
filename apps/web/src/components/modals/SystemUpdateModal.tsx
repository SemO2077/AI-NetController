import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  RefreshCw,
  CheckCircle2,
  ArrowDownCircle,
  Cpu,
  Brain,
  ShieldCheck,
  Radio,
  Terminal,
  Zap,
  X,
  Search,
  GitCompare,
  Server,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';
import { MODAL_BUBBLE_VARIANTS, SPRING_BUBBLY, SPRING_POP } from '../../utils/springPhysics';

export type ComponentCategory = 'ai_model' | 'core_system' | 'security_rule' | 'network_engine';
export type EngineType = 'ai_engine' | 'host_daemon';
export type ComponentStatus =
  | 'up_to_date'
  | 'available'
  | 'checking'
  | 'updating'
  | 'completed'
  | 'error';
export type DriftSeverity = 'none' | 'minor' | 'moderate' | 'critical';

export interface UpdatableComponent {
  id: string;
  name: string;
  category: ComponentCategory;
  engineType: EngineType;
  currentVersion: string;
  latestVersion: string;
  description: string;
  size: string;
  status: ComponentStatus;
  progress: number;
  driftSeverity: DriftSeverity;
  driftDescription: string;
  compatibilityRequirement: string;
  minRequiredDaemonVersion?: string;
  lastCheckedAt?: string;
  releaseNotes?: string;
}

const parseSemverParts = (raw?: string): [number, number, number] => {
  if (!raw) return [0, 0, 0];
  const m = raw.trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return [0, 0, 0];
  return [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
};

const compareSemver = (a?: string, b?: string): number => {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
};

const INITIAL_COMPONENTS: UpdatableComponent[] = [
  {
    id: 'cst-host-agent',
    name: 'AI NetController Host Agent (EXE + GUI)',
    category: 'core_system',
    engineType: 'host_daemon',
    currentVersion: 'v0.100.0',
    latestVersion: 'v0.100.0',
    description:
      'Native Desktop GUI Control Center, Binary WebSocket Server (0xC5,0x71), Signed Build',
    size: '18.2 MB',
    status: 'up_to_date',
    progress: 100,
    driftSeverity: 'none',
    driftDescription: 'Synchronized with Beta v0.100.0',
    compatibilityRequirement: 'Core supervisor required by local & cloud AI execution bridge.',
    minRequiredDaemonVersion: 'v0.100.0',
    lastCheckedAt: 'Pending check',
    releaseNotes:
      'Beta 0.100.00: Zero-bufferbloat 60 FPS hardware screen streaming, Mutual X25519 + ChaCha20-Poly1305 AEAD Vault, encrypted CST-PAIR-X25519-V1 PIN pairing, and security-hardened cross-platform architecture.',
  },
  {
    id: 'ast-security-rules',
    name: 'AST Security & HITL Policy DB',
    category: 'security_rule',
    engineType: 'host_daemon',
    currentVersion: 'v2026.05',
    latestVersion: 'v2026.05',
    description:
      'Quarantine tokens for high-risk commands (rmdir, format, diskpart, net user, LOLBins)',
    size: '450 KB',
    status: 'up_to_date',
    progress: 100,
    driftSeverity: 'none',
    driftDescription: 'No version drift (Up to date)',
    compatibilityRequirement: 'Requires Host Daemon v0.100.0 for NFKC & caret normalization',
    minRequiredDaemonVersion: 'v0.100.0',
    lastCheckedAt: 'Pending check',
    releaseNotes:
      'Updated heuristics for obfuscated PowerShell/LOLBin execution and symlink traversal.',
  },
  {
    id: 'zeroconf-mdns',
    name: 'ZeroConf mDNS Network Engine',
    category: 'network_engine',
    engineType: 'host_daemon',
    currentVersion: 'v0.154.0',
    latestVersion: 'v0.154.0',
    description: 'RFC 6762 Multi-NIC Discovery & Active L2 ARP Address Cache',
    size: '2.4 MB',
    status: 'up_to_date',
    progress: 100,
    driftSeverity: 'none',
    driftDescription: 'No version drift (Up to date)',
    compatibilityRequirement: 'Dual-stack IPv4/IPv6 compliant',
    minRequiredDaemonVersion: 'v0.100.0',
    lastCheckedAt: 'Pending check',
    releaseNotes: 'Latest RFC 6762 beacon engine.',
  },
  {
    id: 'turbojpeg-pipeline',
    name: 'SIMD TurboJPEG Desktop Grabber',
    category: 'core_system',
    engineType: 'host_daemon',
    currentVersion: 'v1.8.0',
    latestVersion: 'v1.8.0-SIMD',
    description: 'Sub-5ms Adler-32 Delta Hashing & Low-Latency Frame Pipeline',
    size: '4.1 MB',
    status: 'up_to_date',
    progress: 100,
    driftSeverity: 'none',
    driftDescription: 'No version drift (Up to date)',
    compatibilityRequirement: 'Requires Host Agent Daemon >= v0.100.0',
    minRequiredDaemonVersion: 'v0.100.0',
    lastCheckedAt: 'Pending check',
    releaseNotes: 'AVX2/NEON SIMD color space transformation and multi-monitor enumeration.',
  },
  {
    id: 'directed-wol-engine',
    name: 'Directed Wake-on-LAN L3 Engine',
    category: 'network_engine',
    engineType: 'host_daemon',
    currentVersion: 'v1.4.0',
    latestVersion: 'v1.4.0',
    description: 'Subnet-Directed Magic Packet (FF*6 + MAC*16) Multi-Hop Router Traversal',
    size: '890 KB',
    status: 'up_to_date',
    progress: 100,
    driftSeverity: 'none',
    driftDescription: 'No version drift (Up to date)',
    compatibilityRequirement: 'Supports IPv4 Directed Broadcast and persistent schedules',
    minRequiredDaemonVersion: 'v0.100.0',
    lastCheckedAt: 'Pending check',
    releaseNotes: 'Backed by persistent disk schedule storage and NIC WakeOnMagicPacket audit.',
  },
];

const COMPONENT_BG_MAP: Record<
  string,
  { description: string; driftDescription: string; compatibilityRequirement: string }
> = {
  'deepseek-r1': {
    description: 'Локален модел за разсъждение (верига от мисли и синтез на системни команди)',
    driftDescription: '1 минорна версия назад (v1.4 -> v1.5.2)',
    compatibilityRequirement: 'Изисква хост демон >= v0.100.0 за поточно предаване',
  },
  'qwen25-coder': {
    description: 'Автономен генератор на код и скриптове с проверка на синтаксиса',
    driftDescription: '1 минорна версия назад (v2.1.0 -> v2.2.4)',
    compatibilityRequirement: 'Поддържа мрежов протокол AI-NET/3.0 и изолиран процес',
  },
  'llama33-70b': {
    description: 'Водещ оркестратор за многохостов флот и автономно планиране на задачи',
    driftDescription: '1 минорна версия назад (v3.2.0 -> v3.3.1)',
    compatibilityRequirement: 'Съвместим с хост демон v0.100.0 за няколко монитора',
  },
  'llama32-3b': {
    description: 'Лек 3B локален резервен модел (<1.8GB VRAM)',
    driftDescription: 'Няма разминаване във версията (Актуална)',
    compatibilityRequirement: 'Напълно съвместим с мобилния клиент и хост демона',
  },
  'cst-host-agent': {
    description:
      'Графичен контролен център за настолен компютър, двоичен сървър и сертифициран компилатор',
    driftDescription: 'Синхронизиран с Beta v0.100.0',
    compatibilityRequirement: 'Основен супервайзър за AI и отдалечено управление.',
  },
  'ast-security-rules': {
    description:
      'Правила за карантина на високорискови команди (изтриване, форматиране, акаунти)',
    driftDescription: 'Актуална политика за сигурност',
    compatibilityRequirement: 'Изисква хост демон v0.100.0 за NFKC нормализиране',
  },
  'zeroconf-mdns': {
    description: 'Откриване на мрежови интерфейси по RFC 6762 и активен кеш на адреси',
    driftDescription: 'Няма разминаване във версията (Актуална)',
    compatibilityRequirement: 'Съвместим с двоен стек IPv4/IPv6',
  },
  'turbojpeg-pipeline': {
    description: 'Бързо хеширане на делта кадри под 5ms и споделена памет за видео поток',
    driftDescription: 'Актуална версия (v1.8.0)',
    compatibilityRequirement: 'Изисква хост демон >= v0.100.0',
  },
  'directed-wol-engine': {
    description: 'Мрежов двигател за насочени пакети за събуждане през маршрутизатори',
    driftDescription: 'Няма разминаване във версията (Актуална)',
    compatibilityRequirement: 'Поддържа насочено разпръскване IPv4 и постоянни графици',
  },
};

interface SystemUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify?: (message: string, type: 'info' | 'success' | 'warning') => void;
}

export const SystemUpdateModal: React.FC<SystemUpdateModalProps> = ({
  isOpen,
  onClose,
  onNotify,
}) => {
  const { language } = useTranslation();
  const isBg = language === 'bg';
  const [components, setComponents] = useState<UpdatableComponent[]>(INITIAL_COMPONENTS);
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [isCheckingAiEngine, setIsCheckingAiEngine] = useState(false);
  const [isCheckingHostDaemon, setIsCheckingHostDaemon] = useState(false);
  const [checkingComponentId, setCheckingComponentId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<
    'all' | 'ai_model' | 'core_system' | 'security_rule' | 'network_engine'
  >('all');
  const [expandedCompId, setExpandedCompId] = useState<string | null>(null);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [lastSystemAuditTime, setLastSystemAuditTime] = useState<string>('Pending');
  const [isRunningAiAdvisor, setIsRunningAiAdvisor] = useState(false);
  const [aiAdvisory, setAiAdvisory] = useState<{
    analysis: string;
    securityScore: number;
    modelUsed: string;
  } | null>(null);

  const nextLogIdRef = React.useRef<number>(4);
  const [updateLogs, setUpdateLogs] = useState<Array<{ id: number; text: string }>>([
    { id: 1, text: '[INIT] System & AI Model Registry initialized (Beta v0.100.0).' },
    { id: 2, text: '[INFO] Gemini & Local Ollama Runtime checks ready.' },
    { id: 3, text: '[READY] Update Center ready to query /api/update/status and /api/update/check.' },
  ]);

  const appendLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const id = nextLogIdRef.current++;
    setUpdateLogs((prev) => [...prev.slice(-100), { id, text: `[${timestamp}] ${msg}` }]);
  };

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetch('/api/update/status', { credentials: 'include', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (controller.signal.aborted || !data?.components || !Array.isArray(data.components)) return;
        setComponents((prev) => {
          const updatedExisting = prev.map((comp) => {
            const srv = data.components.find((s: any) => s.id === comp.id);
            if (!srv) return comp;
            const isUpToDate = srv.status === 'up_to_date';
            return {
              ...comp,
              currentVersion: srv.currentVersion || comp.currentVersion,
              latestVersion: srv.latestVersion || comp.latestVersion,
              status: isUpToDate ? ('up_to_date' as const) : ('available' as const),
              progress: isUpToDate ? 100 : 0,
              driftSeverity: isUpToDate ? ('none' as const) : comp.driftSeverity,
              driftDescription: isUpToDate
                ? 'No version drift (Up to date)'
                : comp.driftDescription,
            };
          });
          const existingIds = new Set(updatedExisting.map((c) => c.id));
          const extraFromServer: UpdatableComponent[] = data.components
            .filter((s: any) => s?.id && !existingIds.has(s.id))
            .map((s: any) => {
              const isUpToDate = s.status === 'up_to_date';
              return {
                id: String(s.id),
                name: String(s.name || s.id),
                category: (s.category || 'ai_model') as ComponentCategory,
                engineType: (s.category === 'ai_model' ? 'ai_engine' : 'host_daemon') as EngineType,
                currentVersion: String(s.currentVersion || 'installed'),
                latestVersion: String(s.latestVersion || s.currentVersion || 'latest'),
                description: String(s.description || 'Server-reported runtime component'),
                size: String(s.size || '—'),
                status: isUpToDate ? 'up_to_date' : 'available',
                progress: isUpToDate ? 100 : 0,
                driftSeverity: isUpToDate ? 'none' : 'minor',
                driftDescription: isUpToDate ? 'No version drift (Up to date)' : 'Update available',
                compatibilityRequirement: 'Verified by Control Server',
              };
            });
          return [...updatedExisting, ...extraFromServer];
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          appendLog('[WARN] /api/update/status unreachable; start Control Server for live status.');
        }
      });
    return () => {
      controller.abort();
    };
  }, [isOpen]);

  const handleRunAiAdvisor = async () => {
    triggerHapticFeedback('medium');
    setIsRunningAiAdvisor(true);
    appendLog('[AI ADVISOR] Requesting Gemini 2.5 Flash version drift & compatibility analysis...');
    try {
      const res = await fetch('/api/update/ai-analyze', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setAiAdvisory({
        analysis: data.analysis,
        securityScore: data.securityScore ?? 94,
        modelUsed: data.modelUsed || 'gemini-2.5-flash',
      });
      appendLog(
        `[AI ADVISOR] Drift report generated by ${data.modelUsed || 'gemini-2.5-flash'} (Score: ${data.securityScore ?? '--'}/100).`
      );
    } catch (err: any) {
      appendLog(`[AI ADVISOR ERROR] ${err?.message || 'Failed to generate AI analysis'}`);
    } finally {
      setIsRunningAiAdvisor(false);
    }
  };

  const systemCompatibility = useMemo(() => {
    const daemonComp = components.find((c) => c.id === 'cst-host-agent');
    const daemonVersion = daemonComp ? daemonComp.currentVersion : 'v0.100.0';
    const isDaemonLatest =
      daemonComp?.status === 'up_to_date' || daemonComp?.status === 'completed';

    const aiModels = components.filter((c) => c.category === 'ai_model');
    const availableAiUpdates = aiModels.filter((c) => c.status === 'available').length;
    const availableDaemonUpdates = components.filter(
      (c) => c.engineType === 'host_daemon' && c.status === 'available'
    ).length;

    const conflictingModels = aiModels.filter((m) => {
      if (!m.minRequiredDaemonVersion) return false;
      return compareSemver(daemonVersion, m.minRequiredDaemonVersion) < 0 && !isDaemonLatest;
    });

    const hasCriticalConflict = conflictingModels.length > 0;
    const hasDrift = components.some((c) => c.status === 'available');

    let status: 'compatible' | 'drift_warning' | 'incompatible' = 'compatible';
    let summary = isBg
      ? 'Хост демонът и AI двигателите са синхронизирани без протоколно разминаване.'
      : 'Host Daemon and AI Model Engine are synchronized with zero protocol drift.';
    let badgeColor =
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';

    if (hasCriticalConflict) {
      status = 'incompatible';
      summary = isBg
        ? `Хост демонът (${daemonVersion}) изостава спрямо изискванията на AI моделите.`
        : `Host Daemon (${daemonVersion}) is behind minimum required AI bridge version.`;
      badgeColor = 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/35';
    } else if (hasDrift) {
      status = 'drift_warning';
      summary = isBg
        ? `Налични са ${availableAiUpdates} AI актуализации и ${availableDaemonUpdates} обновления за хост демона.`
        : `${availableAiUpdates} AI Model updates and ${availableDaemonUpdates} Host Daemon updates available.`;
      badgeColor =
        'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)] border-[var(--theme-accent)]/35';
    }

    return {
      status,
      summary,
      badgeColor,
      daemonVersion,
      isDaemonLatest,
      availableAiUpdates,
      availableDaemonUpdates,
      conflictingModels,
      totalAvailable: availableAiUpdates + availableDaemonUpdates,
    };
  }, [components, isBg]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUpdatingAll && !isCheckingAll) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isUpdatingAll, isCheckingAll]);

  const runServerCheck = async (
    scope: 'all' | 'ai_engine' | 'host_daemon',
    targetComponentId?: string
  ) => {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const res = await fetch('/api/update/check', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, componentId: targetComponentId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    if (data.systemInfo) {
      appendLog(
        `[SYSTEM INFO] Node ${data.systemInfo.nodeVersion} on ${data.systemInfo.platform} (${data.systemInfo.arch})`
      );
    }
    setLastSystemAuditTime(nowStr);
    const checkedList = Array.isArray(data.checkedComponents) ? data.checkedComponents : [];
    setComponents((prev) => {
      const updatedExisting = prev.map((c) => {
        if (targetComponentId && c.id !== targetComponentId) return c;
        if (!targetComponentId && scope !== 'all' && c.engineType !== scope) return c;
        const srv = checkedList.find((s: any) => s.id === c.id);
        const isUpToDate = srv
          ? srv.status === 'up_to_date'
          : c.status === 'completed' || c.status === 'up_to_date';
        return {
          ...c,
          currentVersion: srv?.currentVersion || c.currentVersion,
          latestVersion: srv?.latestVersion || c.latestVersion,
          lastCheckedAt: nowStr,
          status: isUpToDate ? ('up_to_date' as const) : ('available' as const),
          driftSeverity: isUpToDate ? ('none' as const) : c.driftSeverity,
          driftDescription: isUpToDate ? 'No version drift (Up to date)' : c.driftDescription,
        };
      });
      const existingIds = new Set(updatedExisting.map((c) => c.id));
      const extraFromServer: UpdatableComponent[] = checkedList
        .filter((s: any) => s?.id && !existingIds.has(s.id))
        .map((s: any) => {
          const isUpToDate = s.status === 'up_to_date';
          return {
            id: String(s.id),
            name: String(s.name || s.id),
            category: (s.category || 'ai_model') as ComponentCategory,
            engineType: (s.category === 'ai_model' ? 'ai_engine' : 'host_daemon') as EngineType,
            currentVersion: String(s.currentVersion || 'installed'),
            latestVersion: String(s.latestVersion || s.currentVersion || 'latest'),
            description: String(s.description || 'Server-reported runtime component'),
            size: String(s.size || '—'),
            status: isUpToDate ? 'up_to_date' : 'available',
            progress: isUpToDate ? 100 : 0,
            driftSeverity: isUpToDate ? 'none' : 'minor',
            driftDescription: isUpToDate ? 'No version drift (Up to date)' : 'Update available',
            compatibilityRequirement: 'Verified by Control Server',
            lastCheckedAt: nowStr,
          };
        });
      return [...updatedExisting, ...extraFromServer];
    });
    return data;
  };

  const handleCheckAllUpdates = async () => {
    triggerHapticFeedback('medium');
    setIsCheckingAll(true);
    appendLog('[CHECK ALL] Querying /api/update/check for backend & model registry state...');

    try {
      await runServerCheck('all');
      appendLog('[CHECK COMPLETE] System audit finished via control server.');
      onNotify?.(
        isBg ? 'Системната проверка завърши успешно.' : 'System update check completed.',
        'success'
      );
    } catch (err: any) {
      appendLog(`[CHECK ERROR] ${err?.message || err}`);
    } finally {
      setIsCheckingAll(false);
      triggerHapticFeedback('light');
    }
  };

  const handleCheckAiEngine = async () => {
    triggerHapticFeedback('medium');
    setIsCheckingAiEngine(true);
    appendLog('[CHECK: AI ENGINE] Querying local Ollama & Gemini runtime via /api/update/check...');
    try {
      const data = await runServerCheck('ai_engine');
      const checked = Array.isArray(data?.checkedComponents) ? data.checkedComponents : [];
      const aiPending = checked.filter((c: any) => c.status && c.status !== 'up_to_date').length;
      appendLog(`[AI ENGINE CHECK] Completed (${aiPending} update(s) available).`);
      onNotify?.(
        isBg
          ? `AI двигател: ${aiPending} модела имат налични актуализации.`
          : `AI Model Engine: ${aiPending} model(s) have updates available.`,
        aiPending > 0 ? 'info' : 'success'
      );
    } catch (err: any) {
      appendLog(`[AI CHECK ERROR] ${err?.message || err}`);
    } finally {
      setIsCheckingAiEngine(false);
      triggerHapticFeedback('light');
    }
  };

  const handleCheckHostDaemon = async () => {
    triggerHapticFeedback('medium');
    setIsCheckingHostDaemon(true);
    appendLog('[CHECK: HOST DAEMON] Querying Host Agent & AST rules via /api/update/check...');
    try {
      const data = await runServerCheck('host_daemon');
      const checked = Array.isArray(data?.checkedComponents) ? data.checkedComponents : [];
      const daemonPending = checked.filter((c: any) => c.status && c.status !== 'up_to_date').length;
      appendLog(`[HOST DAEMON CHECK] Completed (${daemonPending} update(s) available).`);
      onNotify?.(
        isBg ? 'Проверката на хост демона завърши.' : 'Host Daemon check completed.',
        daemonPending > 0 ? 'info' : 'success'
      );
    } catch (err: any) {
      appendLog(`[DAEMON CHECK ERROR] ${err?.message || err}`);
    } finally {
      setIsCheckingHostDaemon(false);
      triggerHapticFeedback('light');
    }
  };

  const handleCheckSingleComponent = async (componentId: string) => {
    const item = components.find((c) => c.id === componentId);
    if (!item) return;

    triggerHapticFeedback('light');
    setCheckingComponentId(componentId);
    appendLog(`[COMPONENT AUDIT] Checking manifest for ${item.name}...`);
    try {
      const data = await runServerCheck(item.engineType, componentId);
      const refreshed = Array.isArray(data?.checkedComponents)
        ? data.checkedComponents.find((s: any) => s.id === componentId)
        : undefined;
      const curVer = refreshed?.currentVersion || item.currentVersion;
      const latVer = refreshed?.latestVersion || item.latestVersion;
      const isFreshUpToDate = refreshed ? refreshed.status === 'up_to_date' : item.status === 'up_to_date';
      appendLog(`[AUDIT FINISHED] ${item.name}: Current ${curVer} | Target ${latVer}.`);
      const bgInfo = COMPONENT_BG_MAP[item.id];
      const statusText = isFreshUpToDate
        ? isBg
          ? 'Актуална версия'
          : 'Up to date'
        : isBg
        ? bgInfo?.driftDescription || item.driftDescription
        : item.driftDescription;
      onNotify?.(
        isBg ? `Проверка за ${item.name}: ${statusText}` : `Check for ${item.name}: ${statusText}`,
        'info'
      );
    } catch (err: any) {
      appendLog(`[AUDIT ERROR] ${item.name}: ${err?.message || err}`);
    } finally {
      setCheckingComponentId(null);
    }
  };

  const executeComponentUpdate = async (item: UpdatableComponent) => {
    const res = await fetch('/api/update/execute', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        componentId: item.id,
        model: item.category === 'ai_model' ? item.name : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (Array.isArray(data.logs)) {
      data.logs.forEach((logLine: string) => appendLog(logLine));
    }
    if (!res.ok || data.success === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  };

  const handleUpdateAll = async () => {
    triggerHapticFeedback('heavy');
    setIsUpdatingAll(true);

    const pending = components.filter((c) => c.status === 'available');
    if (pending.length === 0) {
      appendLog('[OK] All components and AI models are already up to date.');
      setIsUpdatingAll(false);
      return;
    }

    appendLog(`[BATCH UPDATE] Updating ${pending.length} component(s) via backend endpoints...`);
    let failedCount = 0;

    for (const item of pending) {
      setComponents((prev) =>
        prev.map((c) => (c.id === item.id ? { ...c, status: 'updating', progress: 35 } : c))
      );
      try {
        await executeComponentUpdate(item);
        setComponents((prev) =>
          prev.map((c) =>
            c.id === item.id
              ? {
                  ...c,
                  currentVersion: c.latestVersion,
                  status: 'completed',
                  progress: 100,
                  driftSeverity: 'none',
                  driftDescription: 'No version drift (Up to date)',
                }
              : c
          )
        );
      } catch (err: any) {
        failedCount += 1;
        appendLog(`[UPDATE FAILED] ${item.name}: ${err?.message || err}`);
        setComponents((prev) =>
          prev.map((c) => (c.id === item.id ? { ...c, status: 'error', progress: 0 } : c))
        );
      }
    }

    setIsUpdatingAll(false);
    triggerHapticFeedback('medium');
    onNotify?.(
      failedCount === 0
        ? isBg
          ? 'Компонентите бяха обновени успешно!'
          : 'Components updated successfully!'
        : isBg
        ? `${failedCount} компонента не можаха да се обновят. Вижте дневника.`
        : `${failedCount} component update(s) failed. Check logs for details.`,
      failedCount === 0 ? 'success' : 'warning'
    );
  };

  const handleUpdateSingle = async (componentId: string) => {
    const item = components.find((c) => c.id === componentId);
    if (!item) return;

    triggerHapticFeedback('medium');
    appendLog(`[UPDATE] Dispatching update for ${item.name}...`);

    setComponents((prev) =>
      prev.map((c) => (c.id === componentId ? { ...c, status: 'updating', progress: 30 } : c))
    );

    try {
      await executeComponentUpdate(item);
      setComponents((prev) =>
        prev.map((c) =>
          c.id === componentId
            ? {
                ...c,
                currentVersion: c.latestVersion,
                status: 'completed',
                progress: 100,
                driftSeverity: 'none',
                driftDescription: 'No version drift (Up to date)',
              }
            : c
        )
      );

      appendLog(`[SUCCESS] ${item.name} updated to ${item.latestVersion}.`);
      onNotify?.(
        isBg
          ? `Компонентът ${item.name} беше успешно обновен!`
          : `Component ${item.name} was updated successfully!`,
        'success'
      );
    } catch (err: any) {
      appendLog(`[UPDATE FAILED] ${item.name}: ${err?.message || err}`);
      setComponents((prev) =>
        prev.map((c) =>
          c.id === componentId ? { ...c, status: 'error', progress: 0 } : c
        )
      );
      onNotify?.(
        isBg
          ? `Неуспешно обновяване на ${item.name}: ${err?.message || 'Грешка'}`
          : `Failed to update ${item.name}: ${err?.message || 'Error'}`,
        'warning'
      );
    }
  };

  const availableCount = components.filter((c) => c.status === 'available').length;
  const filteredList =
    filterCategory === 'all'
      ? components
      : components.filter((c) => c.category === filterCategory);

  const aiModelsCount = components.filter((c) => c.category === 'ai_model').length;

  return (
    <AnimatePresence>
      {isOpen && (
    <div
      id="system-update-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={isBg ? 'Център за системни и AI обновления' : 'System & AI Update Center'}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUpdatingAll && !isCheckingAll) {
          triggerHapticFeedback('light');
          onClose();
        }
      }}
      style={{ backgroundColor: 'var(--backdrop-scrim)' }}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 backdrop-blur-md select-none"
    >
      <motion.div
        id="system-update-modal"
        variants={MODAL_BUBBLE_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        className="w-full max-w-5xl glass-liquid-modal rounded-[28px] flex flex-col max-h-[92dvh] overflow-hidden"
      >
        {/* Top Accent Specular Bar */}
        <div className="h-1 w-full bg-gradient-to-r from-[var(--theme-accent)] via-[var(--theme-secondary)] to-[var(--theme-tertiary)] shrink-0" />

        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[var(--surface-border-subtle)] flex flex-col gap-3 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 squircle-badge squircle-hero shrink-0 mt-0.5">
                <RefreshCw
                  className={`w-5 h-5 ${isUpdatingAll || isCheckingAll ? 'animate-spin' : ''}`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm sm:text-base lg:text-lg font-extrabold font-display tracking-tight ink-primary break-words">
                    {isBg
                      ? 'Център за системни и AI обновления'
                      : 'System & AI Update Center'}
                  </h2>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[var(--theme-accent)]/14 text-[var(--theme-accent)] border border-[var(--theme-accent)]/30 shrink-0">
                    v0.100.0 OTA
                  </span>
                </div>
                <p className="text-xs ink-secondary mt-0.5 break-words leading-snug">
                  {isBg
                    ? 'Проверки за AI модели и хост демон с анализ на съвместимостта и версиите'
                    : 'Automated & manual update checks for AI engines and Host Daemon with version drift telemetry'}
                </p>
              </div>
            </div>

            <button
              id="close-update-modal-btn"
              type="button"
              onClick={onClose}
              className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full liquid-control-pill flex items-center justify-center ink-secondary hover:ink-primary transition cursor-pointer shrink-0"
              aria-label={isBg ? 'Затвори' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Action Buttons Row */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              id="ai-advisor-btn"
              type="button"
              onClick={handleRunAiAdvisor}
              disabled={isRunningAiAdvisor || isUpdatingAll}
              className="min-h-[38px] flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full bg-violet-500/15 hover:bg-violet-500/22 text-violet-700 dark:text-violet-300 border border-violet-500/35 font-display text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              <Sparkles
                className={`w-3.5 h-3.5 shrink-0 ${isRunningAiAdvisor ? 'animate-pulse' : ''}`}
              />
              <span className="truncate">
                {isRunningAiAdvisor
                  ? isBg
                    ? 'AI Анализ...'
                    : 'AI Analyzing...'
                  : isBg
                  ? 'AI Одит на версиите'
                  : 'AI Drift Advisor'}
              </span>
            </button>

            <button
              id="check-all-updates-btn"
              type="button"
              onClick={handleCheckAllUpdates}
              disabled={isCheckingAll || isUpdatingAll}
              className="min-h-[38px] flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full liquid-control-pill ink-primary font-display text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              <Search
                className={`w-3.5 h-3.5 text-[var(--theme-accent)] shrink-0 ${
                  isCheckingAll ? 'animate-spin' : ''
                }`}
              />
              <span className="truncate">
                {isCheckingAll
                  ? isBg
                    ? 'Проверка...'
                    : 'Checking...'
                  : isBg
                  ? 'Провери всички'
                  : 'Check All'}
              </span>
            </button>

            <motion.button
              id="update-all-btn"
              type="button"
              whileHover={availableCount > 0 ? { scale: 1.02 } : undefined}
              whileTap={availableCount > 0 ? { scale: 0.96 } : undefined}
              transition={SPRING_POP}
              onClick={handleUpdateAll}
              disabled={isUpdatingAll || isCheckingAll || availableCount === 0}
              className={`min-h-[38px] w-full sm:w-auto sm:ml-auto flex items-center justify-center gap-2 px-4 py-1.5 rounded-full font-display text-xs font-bold transition-all ${
                availableCount > 0
                  ? 'liquid-hero-btn preserve-white cursor-pointer'
                  : 'liquid-control-pill ink-muted opacity-70 cursor-not-allowed'
              }`}
            >
              {isUpdatingAll ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                  <span>{isBg ? 'Обновяване...' : 'Updating...'}</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 shrink-0" />
                  <span>
                    {availableCount > 0
                      ? isBg
                        ? `Обнови всички (${availableCount})`
                        : `Update All (${availableCount})`
                      : isBg
                      ? 'Всички са актуални'
                      : 'All Up to Date'}
                  </span>
                </>
              )}
            </motion.button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-4 bouncy-scroll">
          {/* AI Drift & Compatibility Report Banner */}
          <AnimatePresence>
            {aiAdvisory && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="p-4 rounded-3xl glass-liquid-subtle border border-violet-500/35 flex items-start justify-between gap-3"
              >
                <div className="space-y-1.5 text-xs ink-primary leading-relaxed whitespace-pre-wrap break-words min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap font-display text-xs font-bold text-violet-700 dark:text-violet-300">
                    <Brain className="w-4 h-4 shrink-0" />
                    <span>
                      {isBg ? 'Gemini AI Доклад' : 'Gemini AI Drift Report'} ({aiAdvisory.modelUsed})
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono text-[10.5px]">
                      {isBg
                        ? `Сигурност: ${aiAdvisory.securityScore}/100`
                        : `Score: ${aiAdvisory.securityScore}/100`}
                    </span>
                  </div>
                  <div className="break-words ink-secondary">{aiAdvisory.analysis}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAiAdvisory(null)}
                  className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center ink-secondary hover:ink-primary cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 3 Hero KPI Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Card 1: Compatibility */}
            <div className="p-4 rounded-3xl glass-liquid-subtle border border-[var(--surface-border-subtle)] flex flex-col justify-between gap-3 min-w-0">
              <div className="space-y-2 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 squircle-badge squircle-emerald shrink-0">
                      <GitCompare className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-display font-bold ink-primary">
                      {isBg ? 'Съвместимост' : 'Compatibility'}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border shrink-0 ${systemCompatibility.badgeColor}`}
                  >
                    {systemCompatibility.status === 'compatible'
                      ? isBg
                        ? 'СЪВМЕСТИМО'
                        : 'SYNCED'
                      : systemCompatibility.status === 'incompatible'
                      ? isBg
                        ? 'РИСК'
                        : 'DRIFT WARN'
                      : isBg
                      ? 'ОБНОВЛЕНИЯ'
                      : 'UPDATES'}
                  </span>
                </div>
                <p className="text-[11.5px] ink-secondary leading-snug break-words">
                  {systemCompatibility.summary}
                </p>
              </div>
              <div className="pt-2 border-t border-[var(--surface-border-subtle)] flex items-center justify-between gap-2 text-[10.5px] font-mono ink-muted">
                <span>{isBg ? 'Последна проверка:' : 'Last checked:'}</span>
                <span className="text-[var(--theme-accent)] font-semibold tabular-nums">
                  {lastSystemAuditTime.split(' ')[1] || lastSystemAuditTime}
                </span>
              </div>
            </div>

            {/* Card 2: AI Model Engine */}
            <div className="p-4 rounded-3xl glass-liquid-subtle border border-[var(--surface-border-subtle)] flex flex-col justify-between gap-3 min-w-0">
              <div className="space-y-2 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 squircle-badge squircle-violet shrink-0">
                      <Brain className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-display font-bold ink-primary">
                      {isBg ? 'AI Двигател' : 'AI Model Engine'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30 shrink-0">
                    Gemini + Ollama
                  </span>
                </div>
                <p className="text-[11.5px] ink-secondary leading-snug break-words">
                  {systemCompatibility.availableAiUpdates > 0
                    ? isBg
                      ? `${systemCompatibility.availableAiUpdates} модела имат налични актуализации.`
                      : `${systemCompatibility.availableAiUpdates} model(s) have available updates.`
                    : aiModelsCount > 0
                    ? isBg
                      ? `Всички ${aiModelsCount} локални AI модела са синхронизирани.`
                      : `All ${aiModelsCount} local AI model(s) are synchronized.`
                    : isBg
                    ? 'Използвайте „Провери AI“, за да инспектирате локални Ollama модели.'
                    : 'Click "Check AI" to query local Ollama models and cloud runtime status.'}
                </p>
              </div>
              <div className="pt-2 border-t border-[var(--surface-border-subtle)] flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10.5px] font-mono ink-muted">
                  {aiModelsCount > 0
                    ? isBg
                      ? `${aiModelsCount} модела`
                      : `${aiModelsCount} local model(s)`
                    : isBg
                    ? 'Облачен / Локален'
                    : 'Cloud / Local'}
                </span>
                <button
                  id="check-ai-engine-btn"
                  type="button"
                  onClick={handleCheckAiEngine}
                  disabled={isCheckingAiEngine || isUpdatingAll}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-display font-bold liquid-control-pill ink-primary transition cursor-pointer"
                >
                  <Search
                    className={`w-3 h-3 text-violet-500 ${isCheckingAiEngine ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isCheckingAiEngine
                      ? isBg
                        ? 'Проверка...'
                        : 'Checking...'
                      : isBg
                      ? 'Провери AI'
                      : 'Check AI'}
                  </span>
                </button>
              </div>
            </div>

            {/* Card 3: Host Daemon */}
            <div className="p-4 rounded-3xl glass-liquid-subtle border border-[var(--surface-border-subtle)] flex flex-col justify-between gap-3 min-w-0">
              <div className="space-y-2 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 squircle-badge squircle-sky shrink-0">
                      <Server className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-display font-bold ink-primary">
                      {isBg ? 'Хост демон' : 'Host Daemon'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/30 shrink-0">
                    {systemCompatibility.daemonVersion}
                  </span>
                </div>
                <p className="text-[11.5px] ink-secondary leading-snug break-words">
                  {systemCompatibility.availableDaemonUpdates > 0
                    ? isBg
                      ? 'Налична е актуализация за v0.100.0 хост агента.'
                      : 'Host Agent update available for v0.100.0.'
                    : isBg
                    ? 'Хост демонът е синхронизиран с протокол AI-NET/3.0.'
                    : 'Host Daemon is up to date with protocol AI-NET/3.0.'}
                </p>
              </div>
              <div className="pt-2 border-t border-[var(--surface-border-subtle)] flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10.5px] font-mono ink-muted">
                  {isBg ? 'Job Objects & AEAD' : 'Job Objects & AEAD'}
                </span>
                <button
                  id="check-host-daemon-btn"
                  type="button"
                  onClick={handleCheckHostDaemon}
                  disabled={isCheckingHostDaemon || isUpdatingAll}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-display font-bold liquid-control-pill ink-primary transition cursor-pointer"
                >
                  <Search
                    className={`w-3 h-3 text-sky-500 ${isCheckingHostDaemon ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {isCheckingHostDaemon
                      ? isBg
                        ? 'Проверка...'
                        : 'Checking...'
                      : isBg
                      ? 'Провери демон'
                      : 'Check Daemon'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Sliding Pill Category Filters */}
          <div className="p-1.5 rounded-full glass-liquid-subtle border border-[var(--surface-border-subtle)] flex items-center gap-1 overflow-x-auto scrollbar-none">
            {[
              {
                id: 'all',
                label: isBg ? `Всички (${components.length})` : `All (${components.length})`,
              },
              { id: 'ai_model', label: isBg ? 'AI Модели' : 'AI Models' },
              { id: 'core_system', label: isBg ? 'Системни демони' : 'System Daemons' },
              { id: 'security_rule', label: isBg ? 'AST & HITL' : 'AST & HITL Rules' },
              { id: 'network_engine', label: isBg ? 'Мрежови модули' : 'Network Modules' },
            ].map((cat) => {
              const active = filterCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    triggerHapticFeedback('light');
                    setFilterCategory(cat.id as any);
                  }}
                  className={`relative px-3.5 py-1.5 rounded-full transition-colors whitespace-nowrap text-xs font-display font-semibold cursor-pointer shrink-0 z-10 ${
                    active ? 'preserve-white' : 'ink-secondary hover:ink-primary'
                  }`}
                >
                  {active && (
                    <motion.div
                      layoutId="systemUpdateCategoryPill"
                      transition={SPRING_BUBBLY}
                      className="absolute inset-0 rounded-full liquid-hero-btn -z-10 transform-gpu"
                    />
                  )}
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          {/* Component Cards List with Collapsible Release Notes */}
          <div className="space-y-2.5">
            {filteredList.map((comp) => {
              const isUpToDate = comp.status === 'up_to_date' || comp.status === 'completed';
              const isUpdating = comp.status === 'updating';
              const isTargetChecking = checkingComponentId === comp.id;
              const isExpanded = expandedCompId === comp.id;
              const localizedDesc = isBg
                ? COMPONENT_BG_MAP[comp.id]?.description || comp.description
                : comp.description;
              const localizedDrift = isUpToDate
                ? isBg
                  ? 'Актуална версия'
                  : 'No version drift'
                : isBg
                ? COMPONENT_BG_MAP[comp.id]?.driftDescription || comp.driftDescription
                : comp.driftDescription;
              const localizedReq = isBg
                ? COMPONENT_BG_MAP[comp.id]?.compatibilityRequirement ||
                  comp.compatibilityRequirement
                : comp.compatibilityRequirement;

              const badgeVariant =
                comp.category === 'ai_model'
                  ? 'squircle-violet'
                  : comp.category === 'core_system'
                  ? 'squircle-sky'
                  : comp.category === 'security_rule'
                  ? 'squircle-amber'
                  : 'squircle-emerald';

              return (
                <div
                  key={comp.id}
                  id={`update-comp-${comp.id}`}
                  className={`p-3.5 sm:p-4 rounded-3xl glass-liquid-subtle border transition-all ${
                    isUpdating
                      ? 'border-[var(--theme-accent)]/60 shadow-md'
                      : 'border-[var(--surface-border-subtle)] hover:border-[var(--theme-accent)]/40'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`w-9 h-9 squircle-badge ${badgeVariant} shrink-0 mt-0.5`}>
                        {comp.category === 'ai_model' && <Brain className="w-4 h-4" />}
                        {comp.category === 'core_system' && <Cpu className="w-4 h-4" />}
                        {comp.category === 'security_rule' && <ShieldCheck className="w-4 h-4" />}
                        {comp.category === 'network_engine' && <Radio className="w-4 h-4" />}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display text-xs sm:text-sm font-bold ink-primary break-words">
                            {comp.name}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full liquid-control-pill ink-muted shrink-0">
                            {comp.size}
                          </span>

                          {isUpToDate ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shrink-0">
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                              <span>{comp.currentVersion}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shrink-0">
                              <ArrowDownCircle className="w-3 h-3 shrink-0" />
                              <span>
                                {comp.currentVersion} → {comp.latestVersion}
                              </span>
                            </span>
                          )}
                        </div>

                        <p className="text-xs ink-secondary leading-relaxed break-words">
                          {localizedDesc}
                        </p>

                        <button
                          type="button"
                          onClick={() =>
                            setExpandedCompId((prev) => (prev === comp.id ? null : comp.id))
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-display font-semibold text-[var(--theme-accent)] hover:underline cursor-pointer"
                        >
                          <span>
                            {isExpanded
                              ? isBg
                                ? 'Скрий детайли и бележки'
                                : 'Hide release notes & compatibility'
                              : isBg
                              ? 'Бележки и съвместимост'
                              : 'Release notes & compatibility'}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[var(--surface-border-subtle)]">
                      <button
                        type="button"
                        onClick={() => handleCheckSingleComponent(comp.id)}
                        disabled={isTargetChecking || isUpdating}
                        className="min-h-[34px] flex items-center gap-1.5 px-3 py-1 rounded-full liquid-control-pill font-display text-[11px] font-semibold ink-primary transition cursor-pointer"
                      >
                        <Search
                          className={`w-3 h-3 shrink-0 ${
                            isTargetChecking ? 'animate-spin text-[var(--theme-accent)]' : 'ink-muted'
                          }`}
                        />
                        <span>
                          {isTargetChecking
                            ? isBg
                              ? 'Проверка...'
                              : 'Checking...'
                            : isBg
                            ? 'Провери'
                            : 'Check'}
                        </span>
                      </button>

                      {isUpToDate ? (
                        <button
                          type="button"
                          onClick={() => handleUpdateSingle(comp.id)}
                          disabled={isUpdating || isUpdatingAll}
                          className="min-h-[34px] flex items-center gap-1.5 px-3 py-1 rounded-full liquid-control-pill font-display text-[11px] font-semibold ink-secondary hover:ink-primary transition cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className="w-3 h-3 shrink-0" />
                          <span>{isBg ? 'Преинсталирай' : 'Reinstall'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleUpdateSingle(comp.id)}
                          disabled={isUpdating || isUpdatingAll}
                          className="min-h-[34px] flex items-center gap-1.5 px-3.5 py-1 rounded-full liquid-hero-btn preserve-white font-display text-[11px] font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          {isUpdating ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                              <span>{comp.progress}%</span>
                            </>
                          ) : (
                            <>
                              <ArrowDownCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>{isBg ? 'Обнови' : 'Update'}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Collapsible Release Notes & Compatibility Metadata */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 pt-3 border-t border-[var(--surface-border-subtle)] space-y-2 text-[11px]">
                          <div className="flex flex-wrap items-center gap-1.5 font-mono">
                            <span className="px-2.5 py-0.5 rounded-full liquid-terminal-entry border border-[var(--surface-border-subtle)] ink-secondary">
                              {isBg ? 'Текуща:' : 'Current:'}{' '}
                              <strong className="ink-primary">{comp.currentVersion}</strong>
                            </span>
                            <span className="px-2.5 py-0.5 rounded-full liquid-terminal-entry border border-[var(--surface-border-subtle)] ink-secondary">
                              {isBg ? 'Нова:' : 'Latest:'}{' '}
                              <strong className="text-[var(--theme-accent)]">
                                {comp.latestVersion}
                              </strong>
                            </span>
                            <span className="px-2.5 py-0.5 rounded-full liquid-terminal-entry border border-[var(--surface-border-subtle)] ink-secondary">
                              {localizedDrift}
                            </span>
                          </div>
                          <p className="ink-secondary">{localizedReq}</p>
                          {comp.releaseNotes && (
                            <div className="p-2.5 rounded-2xl liquid-terminal-entry border border-[var(--surface-border-subtle)] ink-secondary leading-relaxed">
                              {comp.releaseNotes}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {isUpdating && (
                    <div className="mt-3 w-full bg-[var(--surface-border-subtle)] rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-[var(--theme-accent)] to-[var(--theme-secondary)] h-2 rounded-full transition-all duration-200"
                        style={{ width: `${comp.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Collapsible Orchestration Audit Log Drawer */}
          <div className="rounded-2xl glass-liquid-subtle border border-[var(--surface-border-subtle)] overflow-hidden">
            <button
              type="button"
              onClick={() => {
                triggerHapticFeedback('light');
                setShowAuditLog((v) => !v);
              }}
              className="w-full px-4 py-3 flex items-center justify-between gap-2 text-xs font-display font-bold ink-primary hover:bg-[var(--surface-pill-hover)] transition cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[var(--theme-accent)] shrink-0" />
                <span>
                  {isBg
                    ? 'Журнал на обновленията и Drift анализа'
                    : 'Update Orchestration & Drift Log'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono liquid-control-pill ink-muted tabular-nums">
                  {updateLogs.length}
                </span>
              </span>
              {showAuditLog ? (
                <ChevronUp className="w-4 h-4 ink-muted shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 ink-muted shrink-0" />
              )}
            </button>
            <AnimatePresence initial={false}>
              {showAuditLog && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t border-[var(--surface-border-subtle)]"
                >
                  <div className="p-3">
                    <div className="liquid-terminal-entry rounded-xl p-3 max-h-36 overflow-y-auto bouncy-scroll space-y-1 border border-[var(--surface-border-subtle)] ink-secondary font-mono text-[10.5px]">
                      {updateLogs.slice(-16).map((entry) => (
                        <div key={entry.id} className="leading-snug break-words">
                          {entry.text}
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  );
};
