import React, { useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
import { pairHostWithPin, saveAuthToken } from './services/securityService';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { SPRING_BUBBLY, TAB_VIEW_VARIANTS } from './utils/springPhysics';

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
  const accentColor = useUIStore((s) => s.accentColor);
  const fontFamily = useUIStore((s) => s.fontFamily);
  const glassIntensity = useUIStore((s) => s.glassIntensity);
  const ambientMode = useUIStore((s) => s.ambientMode);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    applyAppearanceToDocument({ accentColor, fontFamily, glassIntensity, ambientMode });
  }, [accentColor, fontFamily, glassIntensity, ambientMode]);

  const fleet = useFleetState();
  const agent = useWorkerEngine({
    targetId: fleet.selectedTarget,
    onTelemetry: fleet.updateHostTelemetry,
    onHostUnreachable: fleet.markHostUnreachable,
  });

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
    const id = setTimeout(() => setQolToast(null), 2400);
    return () => clearTimeout(id);
  }, [qolToast]);

  // Zero-Typing URL Auto-Pairing (QR Scan on Phone) & ?setup=1 Wizard Opener
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pairIp = params.get('pair_ip');
      const setupFlag = params.get('setup');
      const tourFlag = params.get('tour') || params.get('onboarding');

      if (pairIp) {
        const pairPort = params.get('pair_port') || '8765';
        const pairName = params.get('pair_name') || `PC-${pairIp.split('.').pop() || 'HOST'}`;
        const pairMac = params.get('pair_mac') || '';
        const pairOs = params.get('pair_os') === 'linux' ? 'linux' : 'windows';
        const pairToken = params.get('pair_token') || params.get('token');
        const pairPin = params.get('pair_pin') || params.get('pin');
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
        if (pairToken) {
          saveAuthToken(pairToken);
          agent.connect(wsUri);
        } else if (pairPin) {
          void pairHostWithPin(wsUri, pairPin).then(() => {
            agent.connect(wsUri);
          });
        } else {
          agent.connect(wsUri);
        }
        triggerHapticFeedback('heavy');
        triggerToast(
          language === 'bg'
            ? `✓ Автоматично сдвоен с ${pairName} (${pairIp})`
            : `✓ Automatically paired with ${pairName} (${pairIp})`
        );
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
    <GlobalErrorBoundary>
      <div className="h-[100dvh] w-full max-w-full bg-[#030712] text-white flex flex-col font-sans selection:bg-cyan-500/40 selection:text-cyan-100 relative overflow-hidden">
        {/* 120Hz Hardware-Accelerated Moving Fluid Background Canvas (4 Selectable Modes) */}
        {ambientMode !== 'minimal' && (
          <div
            className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none"
            style={{ contain: 'strict' }}
            aria-hidden="true"
          >
            {ambientMode === 'fluid' && (
              <>
                <div
                  className="fluid-vortex-layer absolute top-1/2 left-1/2 w-[135vmax] h-[135vmax] rounded-full opacity-55"
                  style={{
                    background:
                      'conic-gradient(from 0deg at 50% 50%, var(--aurora-orb-1) 0deg, transparent 90deg, var(--aurora-orb-2) 180deg, transparent 270deg, var(--aurora-orb-3) 360deg)',
                  }}
                />
                <div
                  className="fluid-blob-1 absolute -top-[18%] -left-[14%] w-[82vw] h-[72vh] rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle at 50% 50%, var(--aurora-orb-1) 0%, var(--aurora-orb-2) 42%, transparent 72%)',
                  }}
                />
                <div
                  className="fluid-blob-2 absolute top-[14%] -right-[16%] w-[78vw] h-[74vh] rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle at 50% 50%, var(--aurora-orb-2) 0%, var(--aurora-orb-3) 44%, transparent 72%)',
                  }}
                />
                <div
                  className="fluid-blob-3 absolute -bottom-[20%] left-[8%] w-[84vw] h-[68vh] rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle at 50% 50%, var(--aurora-orb-3) 0%, var(--aurora-orb-4) 40%, transparent 72%)',
                  }}
                />
              </>
            )}

            {ambientMode === 'aurora' && (
              <>
                <div
                  className="aurora-ribbon-1 absolute -top-[22%] -left-[18%] w-[135%] h-[62%] rounded-full"
                  style={{
                    background:
                      'radial-gradient(ellipse 85% 55% at 50% 50%, var(--aurora-orb-1) 0%, var(--aurora-orb-2) 48%, transparent 78%)',
                  }}
                />
                <div
                  className="aurora-ribbon-2 absolute -bottom-[24%] -right-[18%] w-[135%] h-[64%] rounded-full"
                  style={{
                    background:
                      'radial-gradient(ellipse 85% 55% at 50% 50%, var(--aurora-orb-3) 0%, var(--aurora-orb-1) 46%, transparent 78%)',
                  }}
                />
              </>
            )}

            {ambientMode === 'cyber' && (
              <>
                <div className="cyber-grid-pattern absolute inset-0 opacity-90" />
                <div
                  className="cyber-core-pulse absolute top-1/2 left-1/2 w-[85vw] h-[85vh] rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle at 50% 50%, var(--aurora-orb-1) 0%, var(--aurora-orb-2) 38%, transparent 70%)',
                  }}
                />
                <div
                  className="cyber-scan-beam absolute inset-x-0 h-40 opacity-35"
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
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.1 } }}
              transition={SPRING_BUBBLY}
              className="fixed top-[calc(env(safe-area-inset-top,8px)+0.5rem)] left-1/2 -translate-x-1/2 z-[88] px-4 py-2 rounded-full glass-liquid-elevated border border-cyan-400/45 text-cyan-100 text-xs font-semibold shadow-lg pointer-events-none whitespace-nowrap"
            >
              {qolToast}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {agent.unreachableAlert && (
            <motion.div
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.96, transition: { duration: 0.12 } }}
              transition={SPRING_BUBBLY}
              className="fixed top-[calc(env(safe-area-inset-top,8px)+0.5rem)] left-1/2 -translate-x-1/2 z-[90] w-[calc(100%-1.5rem)] max-w-lg glass-liquid-elevated border border-rose-500/40 rounded-2xl p-3 flex items-center justify-between gap-3 text-rose-100"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <div className="text-xs leading-snug truncate">{agent.unreachableAlert.message}</div>
              </div>
              <button
                onClick={agent.clearUnreachableAlert}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-rose-300 shrink-0"
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
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.96, transition: { duration: 0.12 } }}
              transition={SPRING_BUBBLY}
              className="fixed top-[calc(env(safe-area-inset-top,8px)+3.5rem)] left-1/2 -translate-x-1/2 z-[95] w-[calc(100%-1.5rem)] max-w-lg glass-liquid-elevated border border-amber-500/50 rounded-2xl p-3 flex items-center justify-between gap-3 text-amber-100"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-amber-100 truncate">{agent.securityAlert.title}</div>
                  <div className="text-[11px] leading-snug text-amber-200/90 mt-0.5 break-words">{agent.securityAlert.reason}</div>
                </div>
              </div>
              <button
                onClick={agent.clearSecurityAlert}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-amber-300 shrink-0"
                aria-label={language === 'bg' ? 'Затвори' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scrollable Native App Viewport */}
        <main className="relative z-10 w-full max-w-full flex-1 overflow-y-auto overflow-x-hidden bouncy-scroll">
          <div className="w-full max-w-full ultrawide-canvas mx-auto px-3 sm:px-5 lg:px-8 pt-2.5 pb-[calc(env(safe-area-inset-bottom,8px)+5rem)] landscape-compact-shell min-h-full flex flex-col">
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
                  className="flex-1 flex flex-col"
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
                      onSendInputOpcode={agent.sendInputOpcode}
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
          onViewScreen={handleViewScreen}
          onSendInputOpcode={agent.sendInputOpcode}
        />
      </div>
    </GlobalErrorBoundary>
  );
}
