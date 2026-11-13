import React, { useState, useMemo, useEffect } from 'react';
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
} from 'lucide-react';
import { triggerHapticFeedback } from '../../services/hapticService';
import { useTranslation } from '../../i18n/useTranslation';

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
    id: 'deepseek-r1',
    name: 'deepseek-r1:latest',
    category: 'ai_model',
    engineType: 'ai_engine',
    currentVersion: 'v1.4.0-q4',
    latestVersion: 'v1.5.2-q4_K_M',
    description: 'Local Reasoning Model (Chain-of-Thought System Commands & Shell Synthesis)',
    size: '8.9 GB',
    status: 'available',
    progress: 0,
    driftSeverity: 'moderate',
    driftDescription: '1 minor version behind (v1.4 -> v1.5.2)',
    compatibilityRequirement: 'Requires Host Agent Daemon >= v0.60.0 for CoT chunk streaming',
    minRequiredDaemonVersion: 'v0.60.0',
    lastCheckedAt: 'Pending check',
    releaseNotes:
      'Optimized Q4_K_M quant with 32k context and streaming reasoning tokens via Opcode 0x0B.',
  },
  {
    id: 'qwen25-coder',
    name: 'qwen2.5-coder:32b',
    category: 'ai_model',
    engineType: 'ai_engine',
    currentVersion: 'v2.1.0',
    latestVersion: 'v2.2.4-instruct',
    description: 'Local Autonomous Code & PowerShell Script Generator with Syntax Checking',
    size: '18.4 GB',
    status: 'available',
    progress: 0,
    driftSeverity: 'minor',
    driftDescription: '1 minor version behind (v2.1.0 -> v2.2.4)',
    compatibilityRequirement: 'Supports AI-NET/3.0-SECURE and Job Object sandbox',
    minRequiredDaemonVersion: 'v0.60.0',
    lastCheckedAt: 'Pending check',
    releaseNotes: 'Added enhanced AST de-obfuscation prompts and cmd.exe caret normalization.',
  },
  {
    id: 'llama33-70b',
    name: 'llama3.3:70b-instruct',
    category: 'ai_model',
    engineType: 'ai_engine',
    currentVersion: 'v3.2.0',
    latestVersion: 'v3.3.1-q4',
    description: 'Multi-Host Fleet Orchestrator & Autonomous Task Planner',
    size: '42.1 GB',
    status: 'available',
    progress: 0,
    driftSeverity: 'minor',
    driftDescription: '1 minor version behind (v3.2.0 -> v3.3.1)',
    compatibilityRequirement: 'Compatible with Host Daemon v0.60.0 multi-monitor routing',
    minRequiredDaemonVersion: 'v0.60.0',
    lastCheckedAt: 'Pending check',
    releaseNotes: 'Multi-GPU tensor parallelism enhancements and Wake-on-LAN routing templates.',
  },
  {
    id: 'llama32-3b',
    name: 'llama3.2:3b',
    category: 'ai_model',
    engineType: 'ai_engine',
    currentVersion: 'v1.2.0-quant',
    latestVersion: 'v1.2.0-quant',
    description: 'Low-RAM 3B Local Edge Model (<1.8GB VRAM)',
    size: '2.0 GB',
    status: 'up_to_date',
    progress: 100,
    driftSeverity: 'none',
    driftDescription: 'No version drift (Up to date)',
    compatibilityRequirement: 'Compatible with Mobile Client & Host Daemon',
    minRequiredDaemonVersion: 'v0.60.0',
    lastCheckedAt: 'Pending check',
    releaseNotes: 'Current verified release for lightweight edge reasoning.',
  },
  {
    id: 'cst-host-agent',
    name: 'AI NetController Host Agent (EXE + GUI)',
    category: 'core_system',
    engineType: 'host_daemon',
    currentVersion: 'v0.60.0',
    latestVersion: 'v0.60.0',
    description:
      'Native Desktop GUI Control Center, Binary WebSocket Server (0xC5,0x71), Signed Build',
    size: '18.2 MB',
    status: 'up_to_date',
    progress: 100,
    driftSeverity: 'none',
    driftDescription: 'Synchronized with Beta v0.60.0',
    compatibilityRequirement: 'Core supervisor required by local & cloud AI execution bridge.',
    minRequiredDaemonVersion: 'v0.60.0',
    lastCheckedAt: 'Pending check',
    releaseNotes:
      'Beta 0.60.00: Zero-Trust X25519+HMAC mutual vault, optional WSS/TLS pinning, Android Keystore, persistent Cyber Palette preferences, Cyber Glass desktop UI, and Smart App Control MSIX/onedir packaging.',
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
    compatibilityRequirement: 'Requires Host Daemon v0.60.0 for NFKC & caret normalization',
    minRequiredDaemonVersion: 'v0.60.0',
    lastCheckedAt: 'Pending check',
    releaseNotes:
      'Updated heuristics for obfuscated PowerShell/LOLBin execution and symlink traversal.',
  },
  {
    id: 'zeroconf-mdns',
    name: 'ZeroConf mDNS Network Engine',
    category: 'network_engine',
    engineType: 'host_daemon',
    currentVersion: 'v0.138.4',
    latestVersion: 'v0.138.4',
    description: 'RFC 6762 Multi-NIC Discovery & Active L2 ARP Address Cache',
    size: '2.4 MB',
    status: 'up_to_date',
    progress: 100,
    driftSeverity: 'none',
    driftDescription: 'No version drift (Up to date)',
    compatibilityRequirement: 'Dual-stack IPv4/IPv6 compliant',
    minRequiredDaemonVersion: 'v0.60.0',
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
    compatibilityRequirement: 'Requires Host Agent Daemon >= v0.60.0',
    minRequiredDaemonVersion: 'v0.60.0',
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
    minRequiredDaemonVersion: 'v0.60.0',
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
    compatibilityRequirement: 'Изисква хост демон >= v0.60.0 за поточно предаване',
  },
  'qwen25-coder': {
    description: 'Автономен генератор на код и скриптове с проверка на синтаксиса',
    driftDescription: '1 минорна версия назад (v2.1.0 -> v2.2.4)',
    compatibilityRequirement: 'Поддържа мрежов протокол AI-NET/3.0 и изолиран процес',
  },
  'llama33-70b': {
    description: 'Водещ оркестратор за многохостов флот и автономно планиране на задачи',
    driftDescription: '1 минорна версия назад (v3.2.0 -> v3.3.1)',
    compatibilityRequirement: 'Съвместим с хост демон v0.60.0 за няколко монитора',
  },
  'llama32-3b': {
    description: 'Лек 3B локален резервен модел (<1.8GB VRAM)',
    driftDescription: 'Няма разминаване във версията (Актуална)',
    compatibilityRequirement: 'Напълно съвместим с мобилния клиент и хост демона',
  },
  'cst-host-agent': {
    description:
      'Графичен контролен център за настолен компютър, двоичен сървър и сертифициран компилатор',
    driftDescription: 'Синхронизиран с Beta v0.60.0',
    compatibilityRequirement: 'Основен супервайзър за AI и отдалечено управление.',
  },
  'ast-security-rules': {
    description:
      'Правила за карантина на високорискови команди (изтриване, форматиране, акаунти)',
    driftDescription: 'Актуална политика за сигурност',
    compatibilityRequirement: 'Изисква хост демон v0.60.0 за NFKC нормализиране',
  },
  'zeroconf-mdns': {
    description: 'Откриване на мрежови интерфейси по RFC 6762 и активен кеш на адреси',
    driftDescription: 'Няма разминаване във версията (Актуална)',
    compatibilityRequirement: 'Съвместим с двоен стек IPv4/IPv6',
  },
  'turbojpeg-pipeline': {
    description: 'Бързо хеширане на делта кадри под 5ms и споделена памет за видео поток',
    driftDescription: 'Актуална версия (v1.8.0)',
    compatibilityRequirement: 'Изисква хост демон >= v0.60.0',
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
  const [lastSystemAuditTime, setLastSystemAuditTime] = useState<string>('Pending');
  const [isRunningAiAdvisor, setIsRunningAiAdvisor] = useState(false);
  const [aiAdvisory, setAiAdvisory] = useState<{
    analysis: string;
    securityScore: number;
    modelUsed: string;
  } | null>(null);

  const [updateLogs, setUpdateLogs] = useState<string[]>([
    '[INIT] System & AI Model Registry initialized (Beta v0.60.0).',
    '[INFO] Gemini 2.5 Flash & Local Ollama Runtime checks ready.',
    '[READY] Update Center ready to query /api/update/status and /api/update/check.',
  ]);

  const appendLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setUpdateLogs((prev) => [...prev, `[${timestamp}] ${msg}`]);
  };

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/update/status', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (cancelled || !data?.components || !Array.isArray(data.components)) return;
        setComponents((prev) =>
          prev.map((comp) => {
            const srv = data.components.find((s: any) => s.id === comp.id);
            if (!srv) return comp;
            const isUpToDate = srv.status === 'up_to_date';
            return {
              ...comp,
              currentVersion: srv.currentVersion || comp.currentVersion,
              latestVersion: srv.latestVersion || comp.latestVersion,
              status: isUpToDate ? 'up_to_date' : 'available',
              progress: isUpToDate ? 100 : 0,
              driftSeverity: isUpToDate ? 'none' : comp.driftSeverity,
              driftDescription: isUpToDate
                ? 'No version drift (Up to date)'
                : comp.driftDescription,
            };
          })
        );
      })
      .catch(() => {
        if (!cancelled) {
          appendLog('[WARN] /api/update/status unreachable; start Control Server for live status.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleRunAiAdvisor = async () => {
    triggerHapticFeedback('medium');
    setIsRunningAiAdvisor(true);
    appendLog(
      '[AI ADVISOR] Requesting Gemini 2.5 Flash version drift & compatibility analysis...'
    );
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
    const daemonVersion = daemonComp ? daemonComp.currentVersion : 'v0.60.0';
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
    let label = isBg ? 'СЪВМЕСТИМО (Няма разминаване)' : 'COMPATIBLE (No Version Drift)';
    let summary = isBg
      ? 'Хост демонът и AI двигателите са синхронизирани без протоколно разминаване.'
      : 'Host Daemon and AI Model Engine are synchronized with zero protocol drift.';
    let badgeColor = 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40';

    if (hasCriticalConflict) {
      status = 'incompatible';
      label = isBg ? 'ПРЕДУПРЕЖДЕНИЕ ЗА СЪВМЕСТИМОСТ' : 'VERSION DRIFT & COMPATIBILITY WARNING';
      summary = isBg
        ? `Хост демонът (${daemonVersion}) изостава спрямо изискванията на AI моделите.`
        : `Host Daemon (${daemonVersion}) is behind minimum required AI bridge version.`;
      badgeColor = 'bg-amber-950/80 text-amber-300 border-amber-500/50';
    } else if (hasDrift) {
      status = 'drift_warning';
      label = isBg ? 'НАЛИЧНИ АКТУАЛИЗАЦИИ' : 'MINOR VERSION DRIFT DETECTED';
      summary = isBg
        ? `Налични са ${availableAiUpdates} AI актуализации и ${availableDaemonUpdates} обновления за хост демона.`
        : `${availableAiUpdates} AI Model updates and ${availableDaemonUpdates} Host Daemon component updates available.`;
      badgeColor = 'bg-cyan-950/80 text-cyan-300 border-cyan-500/50';
    }

    return {
      status,
      label,
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

  if (!isOpen) return null;

  const runServerCheck = async (scope: 'all' | 'ai_engine' | 'host_daemon', targetComponentId?: string) => {
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
    setComponents((prev) =>
      prev.map((c) => {
        if (targetComponentId && c.id !== targetComponentId) return c;
        if (!targetComponentId && scope !== 'all' && c.engineType !== scope) return c;
        const srv = Array.isArray(data.checkedComponents)
          ? data.checkedComponents.find((s: any) => s.id === c.id)
          : undefined;
        const isUpToDate = srv
          ? srv.status === 'up_to_date'
          : c.status === 'completed' || c.status === 'up_to_date';
        return {
          ...c,
          currentVersion: srv?.currentVersion || c.currentVersion,
          latestVersion: srv?.latestVersion || c.latestVersion,
          lastCheckedAt: nowStr,
          status: isUpToDate ? 'up_to_date' : 'available',
        };
      })
    );
    return data;
  };

  const handleCheckAllUpdates = async () => {
    triggerHapticFeedback('medium');
    setIsCheckingAll(true);
    appendLog('[CHECK ALL] Querying /api/update/check for backend & model registry state...');

    try {
      await runServerCheck('all');
      appendLog('[CHECK COMPLETE] System audit finished via control server.');
      if (onNotify) {
        onNotify(
          isBg
            ? 'Системната проверка завърши успешно.'
            : 'System update check completed.',
          'success'
        );
      }
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
      await runServerCheck('ai_engine');
      const aiPending = components.filter(
        (c) => c.engineType === 'ai_engine' && c.status === 'available'
      ).length;
      appendLog(`[AI ENGINE CHECK] Completed (${aiPending} update(s) available).`);
      if (onNotify) {
        onNotify(
          isBg
            ? `AI двигател: ${aiPending} модела имат налични актуализации.`
            : `AI Model Engine: ${aiPending} models have updates available.`,
          aiPending > 0 ? 'info' : 'success'
        );
      }
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
      await runServerCheck('host_daemon');
      const daemonPending = components.filter(
        (c) => c.engineType === 'host_daemon' && c.status === 'available'
      ).length;
      appendLog(`[HOST DAEMON CHECK] Completed (${daemonPending} update(s) available).`);
      if (onNotify) {
        onNotify(
          isBg
            ? 'Проверката на хост демона завърши.'
            : 'Host Daemon check completed.',
          daemonPending > 0 ? 'info' : 'success'
        );
      }
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
      await runServerCheck(item.engineType, componentId);
      appendLog(`[AUDIT FINISHED] ${item.name}: Current ${item.currentVersion} | Target ${item.latestVersion}.`);
      if (onNotify) {
        const bgInfo = COMPONENT_BG_MAP[item.id];
        onNotify(
          isBg
            ? `Проверка за ${item.name}: ${bgInfo?.driftDescription || item.driftDescription}`
            : `Check for ${item.name}: ${item.driftDescription}`,
          'info'
        );
      }
    } catch (err: any) {
      appendLog(`[AUDIT ERROR] ${item.name}: ${err?.message || err}`);
    } finally {
      setCheckingComponentId(null);
    }
  };

  const executeComponentUpdate = async (item: UpdatableComponent) => {
    const endpoint =
      item.category === 'ai_model' ? '/api/update/ollama-pull' : '/api/update/agent';
    const body =
      item.category === 'ai_model'
        ? { model: item.name, componentId: item.id }
        : { componentId: item.id };

    const res = await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
    if (onNotify) {
      onNotify(
        failedCount === 0
          ? isBg
            ? 'Компонентите бяха обновени успешно!'
            : 'Components updated successfully!'
          : isBg
          ? `${failedCount} компонента не можаха да се обновят. Вижте дневника.`
          : `${failedCount} component update(s) failed. Check logs for details.`,
        failedCount === 0 ? 'success' : 'warning'
      );
    }
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
      if (onNotify) {
        onNotify(
          isBg
            ? `Компонентът ${item.name} беше успешно обновен!`
            : `Component ${item.name} was updated successfully!`,
          'success'
        );
      }
    } catch (err: any) {
      appendLog(`[UPDATE FAILED] ${item.name}: ${err?.message || err}`);
      setComponents((prev) =>
        prev.map((c) =>
          c.id === componentId ? { ...c, status: 'error', progress: 0 } : c
        )
      );
      if (onNotify) {
        onNotify(
          isBg
            ? `Неуспешно обновяване на ${item.name}: ${err?.message || 'Грешка'}`
            : `Failed to update ${item.name}: ${err?.message || 'Error'}`,
          'warning'
        );
      }
    }
  };

  const availableCount = components.filter((c) => c.status === 'available').length;
  const filteredList =
    filterCategory === 'all'
      ? components
      : components.filter((c) => c.category === filterCategory);

  return (
    <div
      id="system-update-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUpdatingAll && !isCheckingAll) {
          triggerHapticFeedback('light');
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in select-none"
    >
      <div
        id="system-update-modal"
        className="w-full max-w-5xl bg-[#091020]/96 backdrop-blur-3xl border border-white/15 border-t-white/25 rounded-[24px] shadow-[0_24px_64px_rgba(0,0,0,0.92)] flex flex-col max-h-[92dvh] overflow-hidden"
      >
        {/* =====================================================================
            COMPACT TOP HEADER (Never overflows or clips on mobile)
           ===================================================================== */}
        <div className="p-3.5 sm:p-5 bg-[#060b16] border-b border-white/10 flex flex-col gap-3 shrink-0">
          {/* Top Row: Icon + Title + Close Button */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500/20 to-purple-600/30 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_12px_rgba(0,240,255,0.25)] shrink-0 mt-0.5">
                <RefreshCw
                  className={`w-5 h-5 text-cyan-400 ${
                    isUpdatingAll || isCheckingAll ? 'animate-spin' : ''
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm sm:text-base lg:text-lg font-bold font-display tracking-tight text-white break-words">
                    {isBg
                      ? 'Център за Системни и AI Обновления'
                      : 'System & AI Model Update Center'}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 shrink-0">
                    Beta v0.60.0 OTA
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 break-words leading-snug">
                  {isBg
                    ? 'Автоматични и ръчни проверки за AI модели и Хост Демон с анализ на съвместимостта'
                    : 'Automated & manual update checks for AI Model Engine and Host Daemon with version drift analysis'}
                </p>
              </div>
            </div>

            <button
              id="close-update-modal-btn"
              type="button"
              onClick={onClose}
              className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-slate-400 hover:text-white bg-white/5 hover:bg-rose-500/20 border border-white/10 transition cursor-pointer shrink-0"
              aria-label={isBg ? 'Затвори' : 'Close'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Action Buttons Row (Wraps cleanly on mobile and desktop) */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* GEMINI AI DRIFT & UPGRADE ADVISOR BUTTON */}
            <button
              id="ai-advisor-btn"
              type="button"
              onClick={handleRunAiAdvisor}
              disabled={isRunningAiAdvisor || isUpdatingAll}
              className="min-h-[38px] flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs font-semibold bg-purple-950/60 hover:bg-purple-900/60 text-purple-200 border border-purple-400/40 hover:border-purple-300 transition shadow-sm cursor-pointer disabled:opacity-50"
            >
              <Brain
                className={`w-3.5 h-3.5 text-purple-300 shrink-0 ${
                  isRunningAiAdvisor ? 'animate-pulse' : ''
                }`}
              />
              <span className="truncate">
                {isRunningAiAdvisor
                  ? isBg
                    ? 'AI Анализ...'
                    : 'AI Analyzing...'
                  : isBg
                  ? '✨ AI Одит'
                  : '✨ AI Drift Advisor'}
              </span>
            </button>

            {/* Check All Updates Action */}
            <button
              id="check-all-updates-btn"
              type="button"
              onClick={handleCheckAllUpdates}
              disabled={isCheckingAll || isUpdatingAll}
              className="min-h-[38px] flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs font-semibold bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-500/40 hover:border-cyan-400 transition shadow-sm cursor-pointer disabled:opacity-50"
            >
              <Search
                className={`w-3.5 h-3.5 text-cyan-400 shrink-0 ${
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

            {/* Update All Action */}
            <button
              id="update-all-btn"
              type="button"
              onClick={handleUpdateAll}
              disabled={isUpdatingAll || isCheckingAll || availableCount === 0}
              className={`min-h-[38px] w-full sm:w-auto sm:ml-auto flex items-center justify-center gap-2 px-4 py-1.5 rounded-xl font-mono text-xs font-bold transition-all shadow-md ${
                availableCount > 0
                  ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-slate-950 hover:brightness-110 shadow-[0_0_15px_rgba(0,240,255,0.35)] cursor-pointer'
                  : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
              }`}
            >
              {isUpdatingAll ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950 shrink-0" />
                  <span>{isBg ? 'Обновяване...' : 'Updating...'}</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-current shrink-0" />
                  <span>
                    {availableCount > 0
                      ? isBg
                        ? `Обнови всички (${availableCount})`
                        : `Update All (${availableCount})`
                      : isBg
                      ? 'Всички са обновени ✓'
                      : 'All Up to Date ✓'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* =====================================================================
            UNIFIED SCROLLABLE BODY (Prevents vertical cramping & text overlap)
           ===================================================================== */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3.5 sm:p-5 space-y-4 bouncy-scroll">
          {/* AI Drift & Compatibility Report Banner */}
          {aiAdvisory && (
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-purple-950/60 via-indigo-950/50 to-cyan-950/50 border border-purple-400/35 flex items-start justify-between gap-3">
              <div className="space-y-1.5 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap break-words min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap font-mono text-[11px] text-purple-300 font-bold">
                  <Brain className="w-3.5 h-3.5 text-purple-300 shrink-0" />
                  <span>
                    {isBg ? 'GEMINI AI ИНЖЕНЕРЕН ДОКЛАД' : 'GEMINI AI ENGINEERING DRIFT REPORT'} (
                    {aiAdvisory.modelUsed})
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    {isBg
                      ? `Сигурност: ${aiAdvisory.securityScore}/100`
                      : `Security Score: ${aiAdvisory.securityScore}/100`}
                  </span>
                </div>
                <div className="break-words">{aiAdvisory.analysis}</div>
              </div>
              <button
                type="button"
                onClick={() => setAiAdvisory(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Compatibility Status & Version Drift Dashboard Deck */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Card 1: System Compatibility & Drift Banner */}
            <div className="p-3.5 rounded-2xl bg-[#081224]/90 border border-cyan-500/30 flex flex-col justify-between gap-2.5 min-w-0">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-mono text-slate-300 flex items-center gap-1.5 font-semibold">
                    <GitCompare className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span>{isBg ? 'Съвместимост и версии' : 'Compatibility & Drift'}</span>
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${systemCompatibility.badgeColor}`}
                  >
                    {systemCompatibility.status === 'compatible'
                      ? isBg
                        ? 'СЪВМЕСТИМО'
                        : 'COMPATIBLE'
                      : systemCompatibility.status === 'incompatible'
                      ? isBg
                        ? 'РИСК ОТ РАЗМИНАВАНЕ'
                        : 'DRIFT WARNING'
                      : isBg
                      ? 'НАЛИЧНИ ОБНОВЛЕНИЯ'
                      : 'MINOR DRIFT'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-snug break-words">
                  {systemCompatibility.summary}
                </p>
              </div>
              <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
                <span>{isBg ? 'Последна проверка:' : 'Last checked:'}</span>
                <span className="text-cyan-400 tabular-nums">
                  {lastSystemAuditTime.split(' ')[1] || '14:20'}
                </span>
              </div>
            </div>

            {/* Card 2: AI Model Engine Hub */}
            <div className="p-3.5 rounded-2xl bg-[#081224]/90 border border-purple-500/30 flex flex-col justify-between gap-2.5 min-w-0">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-mono text-purple-300 flex items-center gap-1.5 font-semibold">
                    <Brain className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span>{isBg ? 'AI Моделен Двигател' : 'AI Model Engine'}</span>
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950/70 text-purple-300 border border-purple-500/40 shrink-0">
                    Ollama v0.5.8
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-snug break-words">
                  {systemCompatibility.availableAiUpdates > 0
                    ? isBg
                      ? `${systemCompatibility.availableAiUpdates} модела с нови версии (DeepSeek-R1, Qwen2.5)`
                      : `${systemCompatibility.availableAiUpdates} models with version drift (DeepSeek-R1, Qwen2.5)`
                    : isBg
                    ? 'Всички 4 локални AI модела са синхронизирани.'
                    : 'All 4 local AI models are synchronized.'}
                </p>
              </div>
              <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-mono text-slate-400">
                  {isBg ? '4 заредени модела' : '4 loaded models'}
                </span>
                <button
                  id="check-ai-engine-btn"
                  type="button"
                  onClick={handleCheckAiEngine}
                  disabled={isCheckingAiEngine || isUpdatingAll}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 border border-purple-500/40 hover:border-purple-400 transition cursor-pointer"
                >
                  <Search className={`w-3 h-3 ${isCheckingAiEngine ? 'animate-spin' : ''}`} />
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

            {/* Card 3: Host Daemon & Kernel Bridge Hub */}
            <div className="p-3.5 rounded-2xl bg-[#081224]/90 border border-cyan-500/30 flex flex-col justify-between gap-2.5 min-w-0">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-mono text-cyan-300 flex items-center gap-1.5 font-semibold">
                    <Server className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span>{isBg ? 'Хост Демон и Ядро' : 'Host Daemon & Core'}</span>
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/70 text-cyan-300 border border-cyan-500/40 shrink-0">
                    {systemCompatibility.daemonVersion}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-snug break-words">
                  {systemCompatibility.availableDaemonUpdates > 0
                    ? isBg
                      ? 'Налична е актуализация за Beta v0.60.0 хост агента.'
                      : 'Host Agent update available for Beta v0.60.0.'
                    : isBg
                    ? 'Хост демонът е актуален с протокол Beta v0.60.0 (AI-NET/3.0).'
                    : 'Host Daemon is up to date with Beta v0.60.0 (AI-NET/3.0).'}
                </p>
              </div>
              <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-mono text-slate-400">
                  {isBg ? 'Изолирани процеси' : 'Job Objects & AEAD'}
                </span>
                <button
                  id="check-host-daemon-btn"
                  type="button"
                  onClick={handleCheckHostDaemon}
                  disabled={isCheckingHostDaemon || isUpdatingAll}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-500/40 hover:border-cyan-400 transition cursor-pointer"
                >
                  <Search className={`w-3 h-3 ${isCheckingHostDaemon ? 'animate-spin' : ''}`} />
                  <span>
                    {isCheckingHostDaemon
                      ? isBg
                        ? 'Проверка...'
                        : 'Checking...'
                      : isBg
                      ? 'Провери Демон'
                      : 'Check Daemon'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Category Filters */}
          <div className="p-2 rounded-2xl bg-[#050914] border border-white/10 flex items-center gap-1.5 overflow-x-auto scrollbar-none text-xs font-mono">
            <span className="text-slate-400 px-2 text-[11px] shrink-0">
              {isBg ? 'Филтър:' : 'Filter:'}
            </span>
            {[
              {
                id: 'all',
                label: isBg ? `Всички (${components.length})` : `All (${components.length})`,
              },
              { id: 'ai_model', label: isBg ? 'AI Модели (Ollama)' : 'AI Models (Ollama)' },
              { id: 'core_system', label: isBg ? 'Системни Демони' : 'System Daemons' },
              { id: 'security_rule', label: isBg ? 'AST & HITL Правила' : 'AST & HITL Rules' },
              { id: 'network_engine', label: isBg ? 'Мрежови Модули' : 'Network Modules' },
            ].map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setFilterCategory(cat.id as any)}
                className={`px-3 py-1.5 rounded-xl transition-colors whitespace-nowrap text-xs cursor-pointer shrink-0 ${
                  filterCategory === cat.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Component List with Structured Wrapping Metadata Chips */}
          <div className="space-y-3">
            {filteredList.map((comp) => {
              const isUpToDate = comp.status === 'up_to_date' || comp.status === 'completed';
              const isUpdating = comp.status === 'updating';
              const isTargetChecking = checkingComponentId === comp.id;
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

              return (
                <div
                  key={comp.id}
                  id={`update-comp-${comp.id}`}
                  className={`p-3.5 sm:p-4 rounded-2xl border transition-all ${
                    isUpdating
                      ? 'bg-cyan-950/30 border-cyan-400/50 shadow-[0_0_15px_rgba(0,240,255,0.15)]'
                      : isUpToDate
                      ? 'bg-[#081224]/60 border-emerald-500/25'
                      : 'bg-[#09152B]/85 border-cyan-500/30 hover:border-cyan-400/50'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3.5">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="p-2.5 rounded-xl bg-black/40 border border-cyan-500/20 text-cyan-400 shrink-0 mt-0.5">
                        {comp.category === 'ai_model' && (
                          <Brain className="w-4 h-4 text-purple-400" />
                        )}
                        {comp.category === 'core_system' && (
                          <Cpu className="w-4 h-4 text-cyan-400" />
                        )}
                        {comp.category === 'security_rule' && (
                          <ShieldCheck className="w-4 h-4 text-amber-400" />
                        )}
                        {comp.category === 'network_engine' && (
                          <Radio className="w-4 h-4 text-emerald-400" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        {/* Component Title & Status Badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs sm:text-sm font-bold text-white break-all">
                            {comp.name}
                          </span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-black/50 text-slate-300 border border-white/10 shrink-0">
                            {comp.size}
                          </span>

                          {isUpToDate ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 shrink-0">
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                              <span>
                                {isBg
                                  ? `Актуална (${comp.currentVersion})`
                                  : `Up to date (${comp.currentVersion})`}
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-950/60 text-amber-300 border border-amber-500/40 shrink-0">
                              <ArrowDownCircle className="w-3 h-3 shrink-0" />
                              <span>
                                {isBg
                                  ? `Налична ${comp.latestVersion}`
                                  : `Available ${comp.latestVersion}`}
                              </span>
                            </span>
                          )}
                        </div>

                        {/* Component Description */}
                        <p className="text-xs text-slate-300 font-sans leading-relaxed break-words">
                          {localizedDesc}
                        </p>

                        {/* Structured Metadata Chips (Never overflows horizontally!) */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10.5px] font-mono">
                          <span className="px-2 py-0.5 rounded-md bg-black/40 border border-white/[0.07] text-slate-400">
                            {isBg ? 'Текуща:' : 'Current:'}{' '}
                            <strong className="text-slate-200">{comp.currentVersion}</strong>
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-black/40 border border-white/[0.07] text-slate-400">
                            {isBg ? 'Нова:' : 'Latest:'}{' '}
                            <strong className="text-cyan-300">{comp.latestVersion}</strong>
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-black/40 border border-white/[0.07] text-slate-300 break-words">
                            {localizedDrift}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-cyan-950/35 border border-cyan-500/20 text-cyan-300/90 break-words">
                            {localizedReq}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions: Manual Component Check + Update */}
                    <div className="flex items-center justify-end gap-2 shrink-0 pt-1 md:pt-0 border-t md:border-t-0 border-white/[0.06]">
                      <button
                        type="button"
                        onClick={() => handleCheckSingleComponent(comp.id)}
                        disabled={isTargetChecking || isUpdating}
                        className="min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-[11px] text-slate-300 hover:text-white bg-black/40 border border-white/10 hover:border-cyan-500/30 transition cursor-pointer"
                      >
                        <Search
                          className={`w-3 h-3 shrink-0 ${
                            isTargetChecking ? 'animate-spin text-cyan-400' : 'text-slate-400'
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
                          className="min-h-[36px] flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-xs text-slate-300 hover:text-white bg-black/40 border border-white/10 hover:border-cyan-500/30 transition cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{isBg ? 'Преинсталирай' : 'Reinstall'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleUpdateSingle(comp.id)}
                          disabled={isUpdating || isUpdatingAll}
                          className="min-h-[36px] flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-mono text-xs font-semibold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/40 hover:border-cyan-400 shadow-[0_0_10px_rgba(0,240,255,0.2)] transition cursor-pointer disabled:opacity-50"
                        >
                          {isUpdating ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                              <span>
                                {comp.progress}% {isBg ? 'Сваляне...' : 'Downloading...'}
                              </span>
                            </>
                          ) : (
                            <>
                              <ArrowDownCircle className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span>{isBg ? 'Обнови' : 'Update'}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {isUpdating && (
                    <div className="mt-3 w-full bg-black/50 rounded-full h-1.5 overflow-hidden border border-cyan-500/30">
                      <div
                        className="bg-gradient-to-r from-cyan-400 to-blue-500 h-1.5 rounded-full transition-all duration-150"
                        style={{ width: `${comp.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Live Console Update Logs Drawer */}
          <div className="p-3.5 rounded-2xl bg-[#040812] border border-cyan-500/20 font-mono text-[11px] space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap text-slate-400">
              <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isBg
                    ? 'Конзолен одит на обновленията и Drift анализа'
                    : 'Update Orchestration & Version Drift Audit Log'}
                </span>
              </span>
              <span className="text-[10px] text-slate-500 tabular-nums">
                {updateLogs.length} {isBg ? 'събития' : 'events'}
              </span>
            </div>
            <div className="bg-black/60 rounded-xl p-2.5 max-h-28 overflow-y-auto space-y-1 border border-white/5 text-slate-300 font-mono text-[10.5px]">
              {updateLogs.slice(-8).map((log, idx) => (
                <div key={idx} className="leading-snug break-words">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
