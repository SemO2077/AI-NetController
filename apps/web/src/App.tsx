import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { FloatingPillNav } from './components/layout/FloatingPillNav';
import { FleetDashboard } from './components/fleet/FleetDashboard';
import { CommandOmnibar } from './components/terminal/CommandOmnibar';
import { ModalManager } from './components/modals/ModalManager';
import { GlobalErrorBoundary } from './components/layout/GlobalErrorBoundary';
import { HitlApprovalModal } from './components/modals/HitlApprovalModal';
import { useWorkerEngine } from './hooks/useWorkerEngine';
import { useFleetState } from './hooks/useFleetState';
import { useUIStore, applyAppearanceToDocument } from './store/uiStore';
import { triggerHapticFeedback } from './services/hapticService';
import {
  buildHostWsUri,
  getStoredAuthToken,
  pairHostWithPin,
  saveAuthToken,
} from './services/securityService';
import { AlertTriangle, KeyRound, ShieldAlert, X } from 'lucide-react';
import { SPRING_BUBBLY, SPRING_POP, TAB_VIEW_VARIANTS } from './utils/springPhysics';
import { LiquidGlassDefs } from './components/ui/LiquidGlassDefs';

const CommandTerminal = React.lazy(() =>
  import('./components/terminal/CommandTerminal').then((module) => ({
    default: module.CommandTerminal,
  }))
);
const GeminiChatbot = React.lazy(() =>
  import('./components/ai/GeminiChatbot').then((module) => ({
    default: module.GeminiChatbot,
  }))
);
const SettingsScreen = React.lazy(() =>
  import('./components/settings/SettingsScreen').then((module) => ({
    default: module.SettingsScreen,
  }))
);

const TabLoadingFallback = () => (
  <div
    className="grid min-h-[280px] flex-1 place-items-center"
    aria-busy="true"
  >
    <div
      className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent"
      aria-hidden="true"
    />
  </div>
);

export default function App() {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const activeModal = useUIStore((s) => s.activeModal);
  const openModal = useUIStore((s) => s.openModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const isOmnibarOpen = useUIStore((s) => s.isOmnibarOpen);
  const setOmnibarOpen = useUIStore((s) => s.setOmnibarOpen);
  const language = useUIStore((s) => s.language);
  const themeMode = useUIStore((s) => s.themeMode);
  const accentColor = useUIStore((s) => s.accentColor);
  const fontFamily = useUIStore((s) => s.fontFamily);
  const glassIntensity = useUIStore((s) => s.glassIntensity);
  const ambientMode = useUIStore((s) => s.ambientMode);
  const [lanAuthRequired, setLanAuthRequired] = React.useState(false);
  const [lanAuthInput, setLanAuthInput] = React.useState('');
  const [lanAuthError, setLanAuthError] = React.useState<string | null>(null);
  const [isSubmittingLanAuth, setIsSubmittingLanAuth] = React.useState(false);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    applyAppearanceToDocument({ themeMode, accentColor, fontFamily, glassIntensity, ambientMode });
  }, [themeMode, accentColor, fontFamily, glassIntensity, ambientMode]);

  // Pause ambient GPU backdrop animations when the browser tab is backgrounded
  useEffect(() => {
    const syncVisibility = () => {
      if (document.hidden) {
        document.documentElement.setAttribute('data-page-hidden', 'true');
      } else {
        document.documentElement.removeAttribute('data-page-hidden');
      }
    };
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      document.documentElement.removeAttribute('data-page-hidden');
    };
  }, []);

  // Allow Escape key to dismiss the LAN Session Sign-In modal
  useEffect(() => {
    if (!lanAuthRequired) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLanAuthRequired(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lanAuthRequired]);

  const fleet = useFleetState();
  const agent = useWorkerEngine({
    targetId: fleet.selectedTarget,
    onTelemetry: fleet.updateHostTelemetry,
    onHostUnreachable: fleet.markHostUnreachable,
  });

  // Stable refs prevent 2.5s heartbeat ticks from invalidating callbacks passed to memoized views
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;
  const agentRef = useRef(agent);
  agentRef.current = agent;

  // Native Android Hardware Back Button & Gesture Navigation Handler
  useEffect(() => {
    const handleBackNavigation = (): boolean => {
      if (isOmnibarOpen) {
        setOmnibarOpen(false);
        return true;
      }
      if (activeModal && activeModal !== 'none') {
        closeModal();
        return true;
      }
      if (activeTab !== 'fleet') {
        setActiveTab('fleet');
        return true;
      }
      return false;
    };

    (window as unknown as { __handleAndroidBack?: () => boolean }).__handleAndroidBack =
      handleBackNavigation;

    return () => {
      delete (window as unknown as { __handleAndroidBack?: () => boolean }).__handleAndroidBack;
    };
  }, [isOmnibarOpen, setOmnibarOpen, activeModal, closeModal, activeTab, setActiveTab]);

  const syncAgentWithHost = useCallback((hostIdOrDev: string | any) => {
    const currentFleet = fleetRef.current;
    const currentAgent = agentRef.current;
    const targetHost =
      typeof hostIdOrDev === 'string'
        ? currentFleet.hosts.find((h) => h.id === hostIdOrDev)
        : hostIdOrDev;
    if (targetHost && targetHost.ip && targetHost.ip !== '0.0.0.0') {
      const expectedWs = buildHostWsUri(targetHost.ip, targetHost.port || 8765);
      if (currentAgent.wsUrl !== expectedWs) {
        currentAgent.setWsUrl(expectedWs);
        if (currentAgent.isConnected || currentAgent.isReconnecting) {
          currentAgent.connect(expectedWs);
        }
      }
    }
  }, []);

  const handleSelectHostTerminal = useCallback(
    (hostId: string) => {
      fleetRef.current.setSelectedTarget(hostId);
      syncAgentWithHost(hostId);
      setActiveTab('terminal');
    },
    [setActiveTab, syncAgentWithHost]
  );

  const handleSelectHost = useCallback(
    (hostId: string) => {
      fleetRef.current.setSelectedTarget(hostId);
      syncAgentWithHost(hostId);
    },
    [syncAgentWithHost]
  );

  const handleInspectWol = useCallback(
    (dev: any) => openModal('wol', { device: dev, tab: 'direct' }),
    [openModal]
  );

  const handleViewScreen = useCallback(
    (dev: any) => {
      const currentAgent = agentRef.current;
      syncAgentWithHost(dev);
      if (dev?.ip && dev.ip !== '0.0.0.0') {
        const expectedWs = buildHostWsUri(dev.ip, dev.port || 8765);
        if (!currentAgent.isConnected && !currentAgent.isConnecting && getStoredAuthToken(expectedWs)) {
          currentAgent.connect(expectedWs);
        }
      }
      openModal('screen', dev);
      currentAgent.requestScreenRefresh(dev.id, undefined, true);
    },
    [openModal, syncAgentWithHost]
  );

  const handleQuickSystemCommand = useCallback((cmd: string, targetOverride?: string) => {
    agentRef.current.sendCommand({
      target_id: targetOverride || fleetRef.current.selectedTarget,
      command_type: 'system_command',
      prompt: cmd,
    });
  }, []);

  const handleAddHost = useCallback(
    (newHost: any) => {
      fleetRef.current.addCustomHost(newHost);
      syncAgentWithHost(newHost);
    },
    [syncAgentWithHost]
  );

  const handleOpenMemory = useCallback(() => openModal('memory'), [openModal]);
  const handleOpenCode = useCallback(() => openModal('code'), [openModal]);
  const handleOpenWs = useCallback(() => openModal('wsConfig'), [openModal]);
  const handleOpenTerminal = useCallback(() => setActiveTab('terminal'), [setActiveTab]);
  const handleOpenUpdate = useCallback(() => openModal('update'), [openModal]);
  const handleOpenDaemonGui = useCallback(() => openModal('pcDaemonGui'), [openModal]);
  const handleOpenWolScheduler = useCallback(() => openModal('wol', { tab: 'schedules' }), [openModal]);

  const settingsExecutionLogs = useMemo(
    () =>
      agent.lastExecutionResult
        ? [
            {
              id: agent.lastExecutionResult.command_id || 'latest-exec',
              timestamp: agent.lastExecutionResult.timestamp,
              target_id: agent.lastExecutionResult.target_id,
              status: agent.lastExecutionResult.status,
              output: agent.lastExecutionResult.output,
              exitCode: agent.lastExecutionResult.exit_code,
              execution_time_ms: agent.lastExecutionResult.execution_time_ms,
            },
          ]
        : [],
    [agent.lastExecutionResult]
  );

  const [qolToast, setQolToast] = React.useState<string | null>(null);
  const triggerToast = useCallback((msg: string) => {
    setQolToast(msg);
  }, []);

  useEffect(() => {
    if (!qolToast) return;
    const id = setTimeout(() => setQolToast(null), 2400);
    return () => clearTimeout(id);
  }, [qolToast]);

  // Zero-Typing URL Auto-Pairing (QR Scan on Phone, reading secrets from URL # fragment first)
  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
      const hashParams = new URLSearchParams(rawHash);
      const getParam = (key: string) => hashParams.get(key) || searchParams.get(key);

      const pairIp = getParam('pair_ip');
      const setupFlag = getParam('setup');
      const tourFlag = getParam('tour') || getParam('onboarding');

      if (pairIp) {
        const parsedPort = Number(getParam('pair_port') || '8765');
        const pairPort = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 8765;
        const pairName = getParam('pair_name') || `PC-${pairIp.split('.').pop() || 'HOST'}`;
        const pairMac = getParam('pair_mac') || '';
        const pairOs = getParam('pair_os') === 'linux' ? 'linux' : 'windows';
        const pairToken = getParam('pair_token') || getParam('token');
        const pairPin = getParam('pair_pin') || getParam('pin');
        const wsUri = buildHostWsUri(pairIp, pairPort);

        fleet.addCustomHost({
          id: pairName.toUpperCase().replace(/[^A-Z0-9-]/g, '-'),
          name: pairName,
          ip: pairIp,
          mac: pairMac,
          port: pairPort,
          os: pairOs,
          deviceType: 'pc',
          isOnline: false,
          lastSeen: 'Pairing...',
          tags: ['QR-Paired', `Port-${pairPort}`],
        });
        agent.setWsUrl(wsUri);
        if (pairToken) {
          saveAuthToken(pairToken, wsUri);
          saveAuthToken(pairToken);
          agent.connect(wsUri);
          fetch('/api/auth/session', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: pairToken }),
          })
            .then((r) => {
              if (r.ok) setLanAuthRequired(false);
            })
            .catch(() => {});
          triggerHapticFeedback('heavy');
          triggerToast(
            language === 'bg'
              ? `✓ Свързване с ${pairName} (${pairIp})`
              : `✓ Connecting to ${pairName} (${pairIp})`
          );
        } else if (pairPin) {
          fetch('/api/auth/session', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: pairPin }),
          })
            .then((r) => {
              if (r.ok) setLanAuthRequired(false);
            })
            .catch(() => {});
          void pairHostWithPin(wsUri, pairPin).then((tok) => {
            if (tok) {
              agent.connect(wsUri);
              triggerHapticFeedback('heavy');
              triggerToast(
                language === 'bg'
                  ? `✓ Автоматично сдвоен с ${pairName} (${pairIp})`
                  : `✓ Automatically paired with ${pairName} (${pairIp})`
              );
            } else {
              triggerToast(
                language === 'bg'
                  ? `Неуспешно сдвояване с ${pairName} — проверете PIN кода или хост агента.`
                  : `PIN pairing failed for ${pairName} — check PIN or host agent.`
              );
            }
          });
        } else {
          agent.connect(wsUri);
          triggerHapticFeedback('heavy');
          triggerToast(
            language === 'bg'
              ? `Свързване с ${pairName} (${pairIp})...`
              : `Connecting to ${pairName} (${pairIp})...`
          );
        }
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (setupFlag === '1' || setupFlag === 'true') {
        openModal('quickSetup');
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (tourFlag === '1' || tourFlag === 'true') {
        openModal('onboarding');
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch {
      // Ignore URL parsing errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrateAfterAuth = useCallback(
    (signal?: AbortSignal) => {
      fetch('/api/settings', { credentials: 'include', signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (signal?.aborted) return;
          if (data?.settings) {
            useUIStore.getState().hydrateSecuritySettings(data.settings);
          }
          const autoDiscovery =
            typeof data?.settings?.isAutoDiscovery === 'boolean'
              ? data.settings.isAutoDiscovery
              : useUIStore.getState().isAutoDiscovery;
          if (autoDiscovery) {
            void fleet.scanMdns();
          }
        })
        .catch(() => {
          if (!signal?.aborted && useUIStore.getState().isAutoDiscovery) {
            void fleet.scanMdns();
          }
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Verify Control Server session & hydrate persisted security/automation settings on startup
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', { credentials: 'include', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((sessionData) => {
        if (controller.signal.aborted) return;
        if (sessionData && sessionData.authenticated === false) {
          setLanAuthRequired(true);
          return;
        }
        setLanAuthRequired(false);
        hydrateAfterAuth(controller.signal);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          hydrateAfterAuth(controller.signal);
        }
      });
    return () => controller.abort();
  }, [hydrateAfterAuth]);

  const handleSubmitLanAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = lanAuthInput.trim();
    if (!raw || isSubmittingLanAuth) return;
    setIsSubmittingLanAuth(true);
    setLanAuthError(null);
    const isSixDigitPin = /^\d{6}$/.test(raw);
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isSixDigitPin ? { pin: raw } : { token: raw }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.authenticated) {
        setLanAuthRequired(false);
        setLanAuthInput('');
        triggerHapticFeedback('medium');
        triggerToast(
          language === 'bg' ? '✓ Сесията е удостоверена' : '✓ Session authenticated'
        );
        hydrateAfterAuth();
      } else {
        setLanAuthError(
          data?.error ||
            (language === 'bg'
              ? 'Невалиден 6-цифрен PIN или ключ за достъп.'
              : 'Invalid 6-digit PIN or control secret.')
        );
      }
    } catch {
      setLanAuthError(
        language === 'bg'
          ? 'Няма връзка с контролния сървър.'
          : 'Unable to reach control server.'
      );
    } finally {
      setIsSubmittingLanAuth(false);
    }
  };

  // Global QoL Keyboard Shortcuts (1-4 Tabs, R Rescan, / Omnibar)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isEditable || e.metaKey || e.ctrlKey) return;

      if (e.key === '1') {
        e.preventDefault();
        setActiveTab('fleet');
      } else if (e.key === '2') {
        e.preventDefault();
        setActiveTab('terminal');
      } else if (e.key === '3') {
        e.preventDefault();
        setActiveTab('chat');
      } else if (e.key === '4') {
        e.preventDefault();
        setActiveTab('settings');
      } else if (e.key.toLowerCase() === 'r' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        triggerHapticFeedback('medium');
        fleet.scanMdns();
        triggerToast(language === 'bg' ? 'Сканиране на локалната мрежа...' : 'Scanning local network...');
      } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        triggerHapticFeedback('light');
        useUIStore.getState().openModal('shortcuts');
      } else if (e.key === '/' && !isOmnibarOpen && !e.shiftKey) {
        e.preventDefault();
        triggerHapticFeedback('light');
        setOmnibarOpen(true);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [setActiveTab, fleet, isOmnibarOpen, setOmnibarOpen, language, triggerToast]);

  return (
    <MotionConfig reducedMotion="user">
    <GlobalErrorBoundary>
      <LiquidGlassDefs />
      <div
        className="h-[100dvh] w-full max-w-full ink-primary flex flex-col font-sans selection:bg-cyan-500/30 relative overflow-hidden"
        style={{ background: 'var(--canvas-gradient)' }}
      >
        {/* 120Hz Hardware-Accelerated Energetic Shifting Aurora & Liquid Backdrop Canvas */}
        {ambientMode !== 'minimal' && (
          <div
            className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none"
            style={{ contain: 'strict' }}
            aria-hidden="true"
          >
            {ambientMode === 'fluid' && (
              <>
                <div
                  className="fluid-vortex-layer absolute top-1/2 left-1/2 w-[150vmax] h-[150vmax] rounded-full opacity-55"
                  style={{
                    background:
                      'conic-gradient(from 0deg at 50% 50%, var(--aurora-orb-1) 0deg, transparent 85deg, var(--aurora-orb-2) 170deg, transparent 255deg, var(--aurora-orb-3) 340deg, var(--aurora-orb-1) 360deg)',
                  }}
                />
                <div
                  className="fluid-blob-1 absolute -top-[22%] -left-[18%] w-[92vw] h-[86vh] rounded-full"
                  style={{
                    background:
                      'radial-gradient(ellipse closest-side at 50% 50%, var(--aurora-orb-1) 0%, var(--aurora-orb-2) 48%, transparent 100%)',
                  }}
                />
                <div
                  className="fluid-blob-2 absolute top-[8%] -right-[20%] w-[90vw] h-[88vh] rounded-full"
                  style={{
                    background:
                      'radial-gradient(ellipse closest-side at 50% 50%, var(--aurora-orb-2) 0%, var(--aurora-orb-3) 48%, transparent 100%)',
                  }}
                />
                <div
                  className="fluid-blob-3 absolute -bottom-[24%] left-[4%] w-[96vw] h-[84vh] rounded-full"
                  style={{
                    background:
                      'radial-gradient(ellipse closest-side at 50% 50%, var(--aurora-orb-3) 0%, var(--aurora-orb-4) 46%, transparent 100%)',
                  }}
                />
              </>
            )}

            {ambientMode === 'aurora' && (
              <>
                <div
                  className="aurora-ribbon-1 absolute -top-[24%] -left-[20%] w-[144%] h-[78%] rounded-full"
                  style={{
                    background:
                      'radial-gradient(ellipse closest-side at 50% 50%, var(--aurora-orb-1) 0%, var(--aurora-orb-2) 50%, transparent 100%)',
                  }}
                />
                <div
                  className="aurora-ribbon-2 absolute -bottom-[26%] -right-[20%] w-[144%] h-[80%] rounded-full"
                  style={{
                    background:
                      'radial-gradient(ellipse closest-side at 50% 50%, var(--aurora-orb-3) 0%, var(--aurora-orb-1) 48%, transparent 100%)',
                  }}
                />
                <div
                  className="aurora-ribbon-3 absolute top-[14%] left-[10%] w-[84vw] h-[76vh] rounded-full"
                  style={{
                    background:
                      'radial-gradient(ellipse closest-side at 50% 50%, var(--aurora-orb-4) 0%, var(--aurora-orb-2) 45%, transparent 100%)',
                  }}
                />
              </>
            )}

            {ambientMode === 'cyber' && (
              <>
                <div className="cyber-grid-pattern absolute inset-0 opacity-90" />
                <div
                  className="cyber-core-pulse absolute top-1/2 left-1/2 w-[96vw] h-[96vh] rounded-full"
                  style={{
                    background:
                      'radial-gradient(ellipse closest-side at 50% 50%, var(--aurora-orb-1) 0%, var(--aurora-orb-2) 44%, transparent 100%)',
                  }}
                />
                <div
                  className="cyber-scan-beam absolute inset-x-0 h-44 opacity-40"
                  style={{
                    background:
                      'linear-gradient(to bottom, transparent 0%, var(--theme-accent-glow) 50%, transparent 100%)',
                  }}
                />
              </>
            )}
          </div>
        )}

        {/* Floating Toast Feedback */}
        <AnimatePresence>
          {qolToast && (
            <motion.div
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: -16, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.94, transition: { duration: 0.12 } }}
              transition={SPRING_POP}
              className="fixed top-[calc(env(safe-area-inset-top,8px)+0.6rem)] left-1/2 -translate-x-1/2 z-[96] max-w-[calc(100vw-2rem)] px-4 py-2 rounded-full glass-liquid-elevated border border-cyan-400/45 ink-primary text-xs font-bold shadow-lg pointer-events-none truncate"
            >
              {qolToast}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {agent.unreachableAlert && (
            <motion.div
              initial={{ opacity: 0, y: -16, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.96, transition: { duration: 0.12 } }}
              transition={SPRING_BUBBLY}
              className="fixed top-[calc(env(safe-area-inset-top,8px)+0.6rem)] left-1/2 -translate-x-1/2 z-[90] w-[calc(100%-1.5rem)] max-w-lg glass-liquid-elevated border border-rose-500/45 rounded-3xl p-3 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-xl squircle-rose flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5" />
                </div>
                <div className="text-xs font-medium leading-snug truncate ink-primary">{agent.unreachableAlert.message}</div>
              </div>
              <button
                onClick={agent.clearUnreachableAlert}
                className="w-8 h-8 flex items-center justify-center rounded-full liquid-control-pill shrink-0"
                aria-label={language === 'bg' ? 'Затвори' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {agent.securityAlert && (
            <motion.div
              initial={{ opacity: 0, y: -16, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.96, transition: { duration: 0.12 } }}
              transition={SPRING_BUBBLY}
              className="fixed top-[calc(env(safe-area-inset-top,8px)+3.8rem)] left-1/2 -translate-x-1/2 z-[95] w-[calc(100%-1.5rem)] max-w-lg glass-liquid-elevated border border-amber-500/50 rounded-3xl p-3 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-xl squircle-amber flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold ink-primary truncate">{agent.securityAlert.title}</div>
                  <div className="text-[11px] leading-snug ink-secondary mt-0.5 break-words">{agent.securityAlert.reason}</div>
                </div>
              </div>
              <button
                onClick={agent.clearSecurityAlert}
                className="w-8 h-8 flex items-center justify-center rounded-full liquid-control-pill shrink-0"
                aria-label={language === 'bg' ? 'Затвори' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scrollable Native App Viewport */}
        <main className="relative z-10 w-full max-w-full flex-1 overflow-y-auto overflow-x-hidden bouncy-scroll">
          <div className="w-full max-w-full ultrawide-canvas mx-auto px-3.5 sm:px-6 lg:px-8 pt-3.5 pb-[calc(env(safe-area-inset-bottom,8px)+5.8rem)] landscape-compact-shell min-h-full flex flex-col">
            <AnimatePresence mode="wait" initial={false}>
              {activeTab === 'fleet' && (
                <motion.div
                  key="fleet"
                  variants={TAB_VIEW_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex-1 flex flex-col"
                >
                  <FleetDashboard
                    hosts={fleet.hosts}
                    selectedTarget={fleet.selectedTarget}
                    onSelectHost={handleSelectHost}
                    quarantinedHosts={agent.quarantinedHosts}
                    circuitTrippedHosts={agent.circuitTrippedHosts}
                    onPanicKill={agent.panicKillAll}
                    onSelectHostForCommand={handleSelectHostTerminal}
                    onInspectWolPacket={handleInspectWol}
                    onWakeHost={fleet.sendWolPacket}
                    onSendCommand={handleQuickSystemCommand}
                    onSendInputOpcode={agent.sendInputOpcode}
                    onViewScreen={handleViewScreen}
                    onRescan={fleet.scanMdns}
                    isScanning={fleet.isScanning}
                    isNetworkDisconnected={agent.isReconnecting}
                    onReconnectNetwork={agent.reconnectNow}
                    onToast={triggerToast}
                  />
                </motion.div>
              )}

              {activeTab === 'terminal' && (
                <motion.div
                  key="terminal"
                  variants={TAB_VIEW_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex-1 flex flex-col"
                >
                  <React.Suspense fallback={<TabLoadingFallback />}>
                    <CommandTerminal
                      hosts={fleet.hosts}
                      selectedTarget={fleet.selectedTarget}
                      onSelectTarget={fleet.setSelectedTarget}
                      onSendCommand={agent.sendCommand}
                      isExecuting={agent.isSendingCommand}
                      lastExecutionResult={agent.lastExecutionResult}
                      onViewScreen={handleViewScreen}
                      onRefreshScreen={agent.requestScreenRefresh}
                      isCapturingScreen={agent.isCapturingScreen}
                    />
                  </React.Suspense>
                </motion.div>
              )}

              {activeTab === 'chat' && (
                <motion.div
                  key="chat"
                  variants={TAB_VIEW_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex-1 flex flex-col"
                >
                  <React.Suspense fallback={<TabLoadingFallback />}>
                    <GeminiChatbot
                      hosts={fleet.hosts}
                      selectedTarget={fleet.selectedTarget}
                      onSendWol={handleInspectWol}
                      onSelectHost={handleSelectHostTerminal}
                      onTriggerRescan={fleet.scanMdns}
                      onToggleLabMode={handleOpenWs}
                      onSendCommand={handleQuickSystemCommand}
                      onViewScreen={handleViewScreen}
                      onSendInputOpcode={agent.sendInputOpcode}
                      onOpenUpdateCenter={handleOpenUpdate}
                      onOpenDaemonGui={handleOpenDaemonGui}
                      isRealWsConnected={agent.isConnected}
                      latency={agent.latency}
                      wolSchedules={fleet.wolSchedules}
                    />
                  </React.Suspense>
                </motion.div>
              )}

              {activeTab === 'settings' && (
                <motion.div
                  key="settings"
                  variants={TAB_VIEW_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex-1 flex flex-col"
                >
                  <React.Suspense fallback={<TabLoadingFallback />}>
                    <SettingsScreen
                      onOpenPersistentInstructions={handleOpenMemory}
                      onOpenCodeViewer={handleOpenCode}
                      onOpenWsConfig={handleOpenWs}
                      onOpenTerminalLogs={handleOpenTerminal}
                      onOpenUpdateCenter={handleOpenUpdate}
                      onOpenWolScheduler={handleOpenWolScheduler}
                      activeWolSchedulesCount={fleet.activeWolSchedulesCount}
                      wolSchedules={fleet.wolSchedules}
                      hostsCount={fleet.hosts.length}
                      hosts={fleet.hosts}
                      onSendWolPacket={fleet.sendWolPacket}
                      executionLogs={settingsExecutionLogs}
                    />
                  </React.Suspense>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>

        {/* Native Android Bottom Navigation Bar */}
        <FloatingPillNav
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          isConnected={agent.isConnected}
          isReconnecting={agent.isReconnecting}
          latency={agent.latency}
          onOpenNetworkConfig={handleOpenWs}
        />

        {/* Spotlight Command Palette */}
        <CommandOmnibar
          hosts={fleet.hosts}
          selectedTarget={fleet.selectedTarget}
          onSelectHost={handleSelectHostTerminal}
          onSendCommand={agent.sendCommand}
          onSendWolDirect={handleInspectWol}
          onRescanMdns={fleet.scanMdns}
        />

        <AnimatePresence>
          {lanAuthRequired && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ backgroundColor: 'var(--backdrop-scrim)' }}
              className="fixed inset-0 z-[105] flex items-center justify-center p-4 backdrop-blur-md modal-backdrop-scrim"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 12 }}
                transition={SPRING_BUBBLY}
                className="w-full max-w-md rounded-[2rem] glass-liquid-modal p-6 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 squircle-badge squircle-hero flex items-center justify-center shrink-0">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="font-display text-base font-bold ink-primary">
                        {language === 'bg' ? 'Удостоверяване в LAN' : 'LAN Session Sign-In'}
                      </h2>
                      <p className="text-xs ink-muted">
                        {language === 'bg'
                          ? 'Въведете 6-цифрения PIN от PC агента или секретния ключ'
                          : 'Enter the 6-digit PIN from the PC Agent or your control secret'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLanAuthRequired(false)}
                    className="w-8 h-8 rounded-full liquid-control-pill flex items-center justify-center cursor-pointer"
                    aria-label={language === 'bg' ? 'Затвори' : 'Close'}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleSubmitLanAuth} className="space-y-3">
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    value={lanAuthInput}
                    onChange={(e) => setLanAuthInput(e.target.value)}
                    placeholder={language === 'bg' ? '6-цифрен PIN (напр. 482910) или ключ' : '6-digit PIN (e.g. 482910) or token'}
                    className="w-full px-4 py-3 rounded-2xl glass-liquid-subtle focus:border-cyan-400 text-sm font-mono ink-primary outline-none"
                  />
                  {lanAuthError && (
                    <div className="text-xs text-rose-300 bg-rose-500/15 border border-rose-500/30 rounded-2xl px-3.5 py-2">
                      {lanAuthError}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setLanAuthRequired(false)}
                      className="min-h-[42px] px-4 py-2 rounded-full liquid-control-pill text-xs font-semibold cursor-pointer"
                    >
                      {language === 'bg' ? 'По-късно' : 'Later'}
                    </button>
                    <button
                      type="submit"
                      disabled={!lanAuthInput.trim() || isSubmittingLanAuth}
                      className="min-h-[42px] px-5 py-2 rounded-full liquid-hero-btn disabled:opacity-45 text-xs font-bold cursor-pointer"
                    >
                      {isSubmittingLanAuth
                        ? language === 'bg'
                          ? 'Проверка...'
                          : 'Verifying...'
                        : language === 'bg'
                        ? 'Влез'
                        : 'Unlock Console'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <HitlApprovalModal
          event={agent.activeHitlEvent}
          isOpen={!!agent.activeHitlEvent}
          onDecision={agent.resolveHitl}
        />

        <ModalManager
          hosts={fleet.hosts}
          wolSchedules={fleet.wolSchedules}
          onSendWolPacket={fleet.sendWolPacket}
          onTriggerSchedule={fleet.triggerSchedule}
          onUpdateSchedules={fleet.updateSchedules}
          onUpdateHostInstructions={fleet.updateHostInstructions}
          onAddHost={handleAddHost}
          onEditHost={fleet.editHost}
          onDeleteHost={fleet.deleteHost}
          isCapturingScreen={agent.isCapturingScreen}
          onRequestScreenRefresh={agent.requestScreenRefresh}
          availableDisplays={agent.availableDisplays}
          activeDisplayIndex={agent.activeDisplayIndex}
          lastHostClipboard={agent.lastHostClipboard}
          isVaultEncrypted={agent.isVaultEncrypted}
          wsUrl={agent.wsUrl}
          setWsUrl={agent.setWsUrl}
          isConnected={agent.isConnected}
          isConnecting={agent.isConnecting}
          heartbeatStatus={agent.heartbeatStatus}
          latency={agent.latency}
          heartbeatMetrics={agent.heartbeatMetrics}
          quarantinedHosts={agent.quarantinedHosts}
          onToggleQuarantine={agent.toggleQuarantine}
          circuitTrippedHosts={agent.circuitTrippedHosts}
          onResetCircuit={agent.resetHostCircuit}
          onConnectWs={agent.connect}
          onDisconnectWs={agent.disconnect}
          onSelectTarget={handleSelectHostTerminal}
          onViewScreen={handleViewScreen}
          onSendInputOpcode={agent.sendInputOpcode}
          onToast={triggerToast}
        />
      </div>
    </GlobalErrorBoundary>
    </MotionConfig>
  );
}
