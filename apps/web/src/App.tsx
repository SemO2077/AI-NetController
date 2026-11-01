import React, { useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FloatingPillNav } from './components/FloatingPillNav';
import { FleetDashboard } from './components/FleetDashboard';
import { CommandOmnibar } from './components/CommandOmnibar';
import { ModalManager } from './components/ModalManager';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { HitlApprovalModal } from './components/HitlApprovalModal';
import { useWorkerEngine } from './hooks/useWorkerEngine';
import { useFleetState } from './hooks/useFleetState';
import { useUIStore } from './store/uiStore';
import { triggerHapticFeedback } from './services/hapticService';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { SPRING_BUBBLY, TAB_VIEW_VARIANTS } from './utils/springPhysics';

const CommandTerminal = React.lazy(() =>
  import('./components/CommandTerminal').then((module) => ({
    default: module.CommandTerminal,
  }))
);
const GeminiChatbot = React.lazy(() =>
  import('./components/GeminiChatbot').then((module) => ({
    default: module.GeminiChatbot,
  }))
);
const SettingsScreen = React.lazy(() =>
  import('./components/SettingsScreen').then((module) => ({
    default: module.SettingsScreen,
  }))
);

const TabLoadingFallback = () => (
  <div
    className="grid min-h-[320px] flex-1 place-items-center"
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
  const openModal = useUIStore((s) => s.openModal);
  const isOmnibarOpen = useUIStore((s) => s.isOmnibarOpen);
  const setOmnibarOpen = useUIStore((s) => s.setOmnibarOpen);
  const language = useUIStore((s) => s.language);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const fleet = useFleetState();
  const agent = useWorkerEngine({
    targetId: fleet.selectedTarget,
    onTelemetry: fleet.updateHostTelemetry,
    onHostUnreachable: fleet.markHostUnreachable,
  });

  // Global Pull-Down Gesture for Spotlight-style Omnibar search
  useEffect(() => {
    let startY = 0;
    let startX = 0;
    let isTracking = false;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1 && window.scrollY <= 5 && e.touches[0].clientY < 250) {
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        isTracking = true;
      } else {
        isTracking = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isTracking || isOmnibarOpen) return;
      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = currentY - startY;
      const deltaX = Math.abs(currentX - startX);

      if (deltaY > 60 && deltaY > deltaX * 1.3) {
        isTracking = false;
        triggerHapticFeedback('medium');
        setOmnibarOpen(true);
      }
    };

    const handleTouchEnd = () => {
      isTracking = false;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isOmnibarOpen, setOmnibarOpen]);

  const syncAgentWithHost = useCallback(
    (hostIdOrDev: string | any) => {
      const targetHost =
        typeof hostIdOrDev === 'string'
          ? fleet.hosts.find((h) => h.id === hostIdOrDev)
          : hostIdOrDev;
      if (targetHost && targetHost.ip && targetHost.ip !== '0.0.0.0') {
        const expectedWs = `ws://${targetHost.ip}:${targetHost.port || 8765}`;
        if (agent.wsUrl !== expectedWs) {
          agent.setWsUrl(expectedWs);
        }
      }
    },
    [fleet.hosts, agent]
  );

  const handleSelectHostTerminal = useCallback(
    (hostId: string) => {
      fleet.setSelectedTarget(hostId);
      syncAgentWithHost(hostId);
      setActiveTab('terminal');
    },
    [fleet, setActiveTab, syncAgentWithHost]
  );

  const handleSelectHost = useCallback(
    (hostId: string) => {
      fleet.setSelectedTarget(hostId);
      syncAgentWithHost(hostId);
    },
    [fleet, syncAgentWithHost]
  );

  const handleInspectWol = useCallback(
    (dev: any) => openModal('wol', { device: dev, tab: 'direct' }),
    [openModal]
  );

  const handleViewScreen = useCallback(
    (dev: any) => {
      syncAgentWithHost(dev);
      openModal('screen', dev);
      agent.requestScreenRefresh(dev.id);
    },
    [openModal, agent.requestScreenRefresh, syncAgentWithHost]
  );

  const handleOpenMemory = useCallback(() => openModal('memory'), [openModal]);
  const handleOpenCode = useCallback(() => openModal('code'), [openModal]);
  const handleOpenWs = useCallback(() => openModal('wsConfig'), [openModal]);
  const handleOpenTerminal = useCallback(() => setActiveTab('terminal'), [setActiveTab]);
  const handleOpenUpdate = useCallback(() => openModal('update'), [openModal]);
  const handleOpenWolScheduler = useCallback(() => openModal('wol', { tab: 'schedules' }), [openModal]);

  const [qolToast, setQolToast] = React.useState<string | null>(null);
  const triggerToast = useCallback((msg: string) => {
    setQolToast(msg);
  }, []);

  useEffect(() => {
    if (!qolToast) return;
    const id = setTimeout(() => setQolToast(null), 2600);
    return () => clearTimeout(id);
  }, [qolToast]);

  // Zero-Typing URL Auto-Pairing (QR Scan on Phone) & ?setup=1 Wizard Opener
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pairIp = params.get('pair_ip');
      const setupFlag = params.get('setup');

      if (pairIp) {
        const pairPort = params.get('pair_port') || '8765';
        const pairName = params.get('pair_name') || `PC-${pairIp.split('.').pop() || 'HOST'}`;
        const pairMac = params.get('pair_mac') || '00:2B:67:89:AB:CD';
        const pairOs = params.get('pair_os') === 'linux' ? 'linux' : 'windows';
        const wsUri = `ws://${pairIp}:${pairPort}`;

        fleet.addCustomHost({
          id: pairName.toUpperCase().replace(/[^A-Z0-9-]/g, '-'),
          name: pairName,
          ip: pairIp,
          mac: pairMac,
          os: pairOs,
          deviceType: 'pc',
          isOnline: true,
          lastSeen: 'Just now',
          tags: ['QR-Paired', `Port-${pairPort}`],
        });
        agent.setWsUrl(wsUri);
        agent.connect(wsUri);
        triggerHapticFeedback('heavy');
        triggerToast(
          language === 'bg'
            ? `✓ Автоматично сдвоен с ${pairName} (${pairIp})!`
            : `✓ Automatically paired with ${pairName} (${pairIp})!`
        );
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (setupFlag === '1' || setupFlag === 'true') {
        openModal('quickSetup');
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        const tourFlag = params.get('tour') || params.get('onboarding');
        if (tourFlag === '1' || tourFlag === 'true') {
          openModal('onboarding');
          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          // Auto-prompt first-time users with interactive onboarding walkthrough
          const hasCompletedOnboarding = localStorage.getItem('cst_onboarding_completed');
          if (!hasCompletedOnboarding) {
            const timer = setTimeout(() => {
              openModal('onboarding');
            }, 600);
            return () => clearTimeout(timer);
          }
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        triggerHapticFeedback('selection');
        setActiveTab('fleet');
      } else if (e.key === '2') {
        e.preventDefault();
        triggerHapticFeedback('selection');
        setActiveTab('terminal');
      } else if (e.key === '3') {
        e.preventDefault();
        triggerHapticFeedback('selection');
        setActiveTab('chat');
      } else if (e.key === '4') {
        e.preventDefault();
        triggerHapticFeedback('selection');
        setActiveTab('settings');
      } else if (e.key.toLowerCase() === 'r' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        triggerHapticFeedback('medium');
        fleet.scanMdns();
        triggerToast(language === 'bg' ? 'mDNS сканирането на флота стартира...' : 'mDNS fleet scan triggered...');
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
    <GlobalErrorBoundary>
      <div className="min-h-[100dvh] w-full max-w-full bg-[#030712] text-white flex flex-col font-sans selection:bg-cyan-500/40 selection:text-cyan-100 relative overflow-x-hidden">
        {/* 144Hz Poppy & Vibrant Ambient Refraction Field (Rich saturated cyber aurora, zero runtime filter blur) */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
          {/* Electric Cyan Beam */}
          <div
            className="liquid-aurora-orb absolute -top-[16%] -right-[8%] w-[620px] h-[620px] rounded-full pointer-events-none opacity-95"
            style={{
              background:
                'radial-gradient(circle, rgba(0,240,255,0.26) 0%, rgba(14,165,233,0.15) 32%, rgba(14,165,233,0.03) 60%, transparent 76%)',
            }}
          />
          {/* Deep Electric Violet Beam */}
          <div
            className="liquid-aurora-orb absolute top-[22%] -left-[12%] w-[580px] h-[580px] rounded-full pointer-events-none opacity-90"
            style={{
              background:
                'radial-gradient(circle, rgba(139,92,246,0.24) 0%, rgba(99,102,241,0.14) 34%, rgba(99,102,241,0.02) 60%, transparent 78%)',
              animationDelay: '-7s',
            }}
          />
          {/* Luminous Neon Emerald Pulse */}
          <div
            className="liquid-aurora-orb absolute -bottom-[12%] right-[8%] w-[540px] h-[540px] rounded-full pointer-events-none opacity-85"
            style={{
              background:
                'radial-gradient(circle, rgba(16,185,129,0.22) 0%, rgba(6,182,212,0.12) 35%, rgba(6,182,212,0.02) 62%, transparent 78%)',
              animationDelay: '-14s',
            }}
          />
          {/* Cyber Sunset Magenta/Amber Accent */}
          <div
            className="liquid-aurora-orb absolute top-[52%] -right-[10%] w-[480px] h-[480px] rounded-full pointer-events-none opacity-80"
            style={{
              background:
                'radial-gradient(circle, rgba(244,63,94,0.18) 0%, rgba(245,158,11,0.08) 35%, transparent 72%)',
              animationDelay: '-19s',
            }}
          />
        </div>

        {/* QoL Floating Toast Feedback */}
        <AnimatePresence>
          {qolToast && (
            <motion.div
              initial={{ opacity: 0, y: -18, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.94, transition: { duration: 0.12 } }}
              transition={SPRING_BUBBLY}
              className="fixed top-[calc(env(safe-area-inset-top,12px)+0.5rem)] left-1/2 -translate-x-1/2 z-[88] px-4 py-2 rounded-full bg-[#070c18]/92 backdrop-blur-3xl border border-cyan-400/40 text-cyan-200 text-xs font-semibold shadow-[0_12px_32px_rgba(0,0,0,0.7)] pointer-events-none whitespace-nowrap transform-gpu"
            >
              {qolToast}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {agent.unreachableAlert && (
            <motion.div
              initial={{ opacity: 0, y: -22, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -14, scale: 0.95, transition: { duration: 0.13 } }}
              transition={SPRING_BUBBLY}
              className="fixed top-[env(safe-area-inset-top,12px)] left-1/2 -translate-x-1/2 z-[90] w-11/12 max-w-lg glass-liquid-elevated border border-rose-500/40 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-rose-100"
            >
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                <div className="text-xs leading-snug">{agent.unreachableAlert.message}</div>
              </div>
              <button
                onClick={agent.clearUnreachableAlert}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center p-1 rounded-full hover:bg-white/10 text-rose-300 cursor-pointer bubble-tap"
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
              initial={{ opacity: 0, y: -22, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -14, scale: 0.95, transition: { duration: 0.13 } }}
              transition={SPRING_BUBBLY}
              className="fixed top-[calc(env(safe-area-inset-top,12px)+60px)] left-1/2 -translate-x-1/2 z-[95] w-11/12 max-w-lg glass-liquid-elevated border border-amber-500/50 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-amber-100"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-amber-100">{agent.securityAlert.title}</div>
                  <div className="text-[11px] leading-snug text-amber-200/90 mt-0.5 break-words">{agent.securityAlert.reason}</div>
                </div>
              </div>
              <button
                onClick={agent.clearSecurityAlert}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center p-1 rounded-full hover:bg-white/10 text-amber-300 shrink-0 hover:text-white cursor-pointer bubble-tap"
                aria-label={language === 'bg' ? 'Затвори' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <main className="relative z-10 w-full max-w-full ultrawide-canvas mx-auto px-2.5 sm:px-5 lg:px-8 pt-3.5 pb-[calc(env(safe-area-inset-bottom,12px)+5.5rem)] landscape-compact-shell flex-1 flex flex-col overflow-x-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {activeTab === 'fleet' && (
              <motion.div
                key="fleet"
                variants={TAB_VIEW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex-1 flex flex-col transform-gpu"
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
                  onSendCommand={(cmd, targetOverride) =>
                    agent.sendCommand({
                      target_id: targetOverride || fleet.selectedTarget,
                      command_type: 'system_command',
                      prompt: cmd,
                    })
                  }
                  onViewScreen={handleViewScreen}
                  onRescan={fleet.scanMdns}
                  isScanning={fleet.isScanning}
                  isNetworkDisconnected={agent.isReconnecting}
                  onReconnectNetwork={agent.reconnectNow}
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
                className="flex-1 flex flex-col transform-gpu"
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
                    screenBase64={null}
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
                className="flex-1 flex flex-col transform-gpu"
              >
                <React.Suspense fallback={<TabLoadingFallback />}>
                  <GeminiChatbot
                    hosts={fleet.hosts}
                    selectedTarget={fleet.selectedTarget}
                    onSendWol={(dev) => openModal('wol', { device: dev, tab: 'direct' })}
                    onSelectHost={handleSelectHostTerminal}
                    onTriggerRescan={fleet.scanMdns}
                    onToggleLabMode={() => openModal('wsConfig')}
                    onSendCommand={(cmd, targetOverride) =>
                      agent.sendCommand({
                        target_id: targetOverride || fleet.selectedTarget,
                        command_type: 'system_command',
                        prompt: cmd,
                      })
                    }
                    onViewScreen={handleViewScreen}
                    onOpenUpdateCenter={handleOpenUpdate}
                    onOpenDaemonGui={() => openModal('pcDaemonGui')}
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
                className="flex-1 flex flex-col transform-gpu"
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
                  />
                </React.Suspense>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Global Detached Floating Pill Nav */}
        <FloatingPillNav
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          isConnected={agent.isConnected}
          latency={agent.latency}
          onOpenNetworkConfig={handleOpenWs}
        />

        {/* Spotlight Command Palette */}
        <CommandOmnibar
          hosts={fleet.hosts}
          selectedTarget={fleet.selectedTarget}
          onSelectHost={handleSelectHostTerminal}
          onSendCommand={agent.sendCommand}
          onSendWolDirect={(dev) => openModal('wol', { device: dev, tab: 'direct' })}
          onRescanMdns={fleet.scanMdns}
        />

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
          onAddHost={(newHost) => {
            fleet.addCustomHost(newHost);
            syncAgentWithHost(newHost);
          }}
          onEditHost={fleet.editHost}
          onDeleteHost={fleet.deleteHost}
          isCapturingScreen={agent.isCapturingScreen}
          onRequestScreenRefresh={agent.requestScreenRefresh}
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
          onViewScreen={(h) => openModal('screen', h)}
        />
      </div>
    </GlobalErrorBoundary>
  );
}
