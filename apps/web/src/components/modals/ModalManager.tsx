import React, { Suspense, useEffect, useState } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useTranslation } from '../../i18n/useTranslation';
import { buildHostWsUri, pairHostWithPin, saveAuthToken } from '../../services/securityService';
import { generateMagicPacket } from '../../services/wolService';

const WolModal = React.lazy(() => import('./WolModal').then((m) => ({ default: m.WolModal })));
const ScreenViewerModal = React.lazy(() =>
  import('./ScreenViewerModal').then((m) => ({ default: m.ScreenViewerModal }))
);
const BottomSheet = React.lazy(() =>
  import('../ui/BottomSheet').then((m) => ({ default: m.BottomSheet }))
);
const MemoryManager = React.lazy(() =>
  import('../settings/MemoryManager').then((m) => ({ default: m.MemoryManager }))
);
const CodeExportModal = React.lazy(() =>
  import('./CodeExportModal').then((m) => ({ default: m.CodeExportModal }))
);
const WsConfigModal = React.lazy(() =>
  import('./WsConfigModal').then((m) => ({ default: m.WsConfigModal }))
);
const SystemUpdateModal = React.lazy(() =>
  import('./SystemUpdateModal').then((m) => ({ default: m.SystemUpdateModal }))
);
const HostDetailsModal = React.lazy(() =>
  import('./HostDetailsModal').then((m) => ({ default: m.HostDetailsModal }))
);
const AddHostModal = React.lazy(() =>
  import('./AddHostModal').then((m) => ({ default: m.AddHostModal }))
);
const PcDaemonGuiModal = React.lazy(() =>
  import('./PcDaemonGuiModal').then((m) => ({ default: m.PcDaemonGuiModal }))
);
const QuickSetupModal = React.lazy(() =>
  import('./QuickSetupModal').then((m) => ({ default: m.QuickSetupModal }))
);
const KeyboardShortcutsModal = React.lazy(() =>
  import('./KeyboardShortcutsModal').then((m) => ({ default: m.KeyboardShortcutsModal }))
);
const OnboardingModal = React.lazy(() =>
  import('./OnboardingModal').then((m) => ({ default: m.OnboardingModal }))
);

// Props passed from Root Hook state
interface ModalManagerProps {
  hosts: any[];
  wolSchedules: any[];
  onSendWolPacket: any;
  onTriggerSchedule: any;
  onUpdateSchedules: any;
  onUpdateHostInstructions: any;
  onAddHost?: (host: any) => void;
  onEditHost?: (host: any, previousId?: string) => void;
  onDeleteHost?: (hostId: string) => void;
  wsUrl: string;
  setWsUrl: any;
  isConnected: boolean;
  isConnecting?: boolean;
  onConnectWs: any;
  onDisconnectWs: any;
  isCapturingScreen: boolean;
  onRequestScreenRefresh: (id: string, dimensions?: { width: number; height: number }, silent?: boolean) => void;
  availableDisplays?: Array<{ id: number; index?: number; label?: string; name?: string; width: number; height: number; primary?: boolean }>;
  activeDisplayIndex?: number;
  lastHostClipboard?: { text: string; updatedAt: number } | null;
  isVaultEncrypted?: boolean;
  heartbeatMetrics: any;
  heartbeatStatus?: any;
  latency?: any;
  quarantinedHosts?: string[];
  onToggleQuarantine?: (id: string) => void;
  circuitTrippedHosts?: string[];
  onResetCircuit?: (id: string) => void;
  onSelectTarget?: (targetId: string) => void;
  onViewScreen?: (host: any) => void;
  onSendInputOpcode?: (opcode: number, payload: Record<string, any> | string) => boolean;
  onToast?: (msg: string) => void;
}

export const ModalManager: React.FC<ModalManagerProps> = (props) => {
  const { language } = useTranslation();
  const activeModal = useUIStore((s) => s.activeModal);
  const payload = useUIStore((s) => s.modalPayload);
  const closeModal = useUIStore((s) => s.closeModal);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  // Track opened modals so lazy chunks are only loaded on demand while keeping AnimatePresence exit animations smooth
  const [mountedModals, setMountedModals] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (activeModal !== 'none') {
      setMountedModals((prev) => (prev[activeModal] ? prev : { ...prev, [activeModal]: true }));
    }
  }, [activeModal]);

  const rawWolDevice =
    payload?.device || (payload && typeof payload === 'object' && 'id' in payload ? payload : null);
  const wolDevice = rawWolDevice
    ? props.hosts.find((h) => h.id === rawWolDevice.id) || rawWolDevice
    : null;

  // Match live host data from props.hosts if payload is a host
  const hostForDetails =
    payload && typeof payload === 'object' && 'id' in payload
      ? props.hosts.find((h) => h.id === payload.id) || payload
      : null;
  const liveScreenDevice = activeModal === 'screen' ? hostForDetails : null;

  const isMounted = (key: string) => activeModal === key || Boolean(mountedModals[key]);

  return (
    <Suspense fallback={null}>
      {isMounted('hostDetails') && (
        <HostDetailsModal
          isOpen={activeModal === 'hostDetails'}
          onClose={closeModal}
          host={hostForDetails}
          isQuarantined={hostForDetails ? props.quarantinedHosts?.includes(hostForDetails.id) : false}
          onToggleQuarantine={props.onToggleQuarantine}
          isCircuitTripped={hostForDetails ? props.circuitTrippedHosts?.includes(hostForDetails.id) : false}
          onResetCircuit={props.onResetCircuit}
          onSelectForTerminal={(targetId) => {
            props.onSelectTarget?.(targetId);
            setActiveTab('terminal');
          }}
          onViewScreen={(h) => {
            if (props.onViewScreen) {
              props.onViewScreen(h);
            } else {
              useUIStore.getState().openModal('screen', h);
            }
          }}
          onSendWol={(h) => {
            try {
              const packet = generateMagicPacket(h.mac, '255.255.255.255', 9);
              props.onSendWolPacket(packet, h.id);
            } catch {
              useUIStore.getState().openModal('wol', h);
            }
          }}
          onEditHost={(h) => {
            useUIStore.getState().openModal('addHost', h);
          }}
          onDeleteHost={props.onDeleteHost}
        />
      )}

      {isMounted('wol') && (
        <WolModal
          isOpen={activeModal === 'wol'}
          onClose={closeModal}
          device={wolDevice}
          hosts={props.hosts}
          onSendPacket={props.onSendWolPacket}
          onTriggerSchedule={(s) => props.onTriggerSchedule(s.id)}
          schedules={props.wolSchedules}
          onUpdateSchedules={props.onUpdateSchedules}
          initialTab={payload?.tab || (wolDevice ? 'direct' : 'schedules')}
        />
      )}

      {isMounted('screen') && (
        <ScreenViewerModal
          isOpen={activeModal === 'screen'}
          onClose={closeModal}
          device={liveScreenDevice}
          isCapturing={props.isCapturingScreen}
          isConnected={props.isConnected}
          wsUrl={props.wsUrl}
          availableDisplays={props.availableDisplays}
          activeDisplayIndex={props.activeDisplayIndex}
          lastHostClipboard={props.lastHostClipboard}
          isVaultEncrypted={props.isVaultEncrypted}
          onConnectWs={props.onConnectWs}
          onOpenConnection={() => useUIStore.getState().openModal('wsConfig')}
          onRefreshFrame={(dims, silent) => liveScreenDevice && props.onRequestScreenRefresh(liveScreenDevice.id, dims, silent)}
          onSendInputOpcode={props.onSendInputOpcode}
        />
      )}

      {isMounted('wsConfig') && (
        <WsConfigModal
          isOpen={activeModal === 'wsConfig'}
          onClose={closeModal}
          wsUrl={props.wsUrl}
          setWsUrl={props.setWsUrl}
          isConnected={props.isConnected}
          isConnecting={props.isConnecting}
          onConnect={props.onConnectWs}
          onDisconnect={props.onDisconnectWs}
          heartbeatMetrics={props.heartbeatMetrics}
          heartbeatStatus={props.heartbeatStatus}
          heartbeatLatencyMs={props.latency}
        />
      )}

      {isMounted('code') && (
        <CodeExportModal isOpen={activeModal === 'code'} onClose={closeModal} />
      )}
      {isMounted('update') && (
        <SystemUpdateModal isOpen={activeModal === 'update'} onClose={closeModal} />
      )}

      {isMounted('memory') && (
        <BottomSheet
          isOpen={activeModal === 'memory'}
          onClose={closeModal}
          title={language === 'bg' ? 'Системни правила и контекстна памет' : 'System Rules & Contextual Memory'}
          subtitle={language === 'bg' ? 'Постоянни правила и временна оперативна памет за всеки хост' : 'Persistent host rules & active session memory'}
        >
          <MemoryManager hosts={props.hosts} onUpdateInstructions={props.onUpdateHostInstructions} />
        </BottomSheet>
      )}

      {isMounted('addHost') && (
        <AddHostModal
          isOpen={activeModal === 'addHost'}
          onClose={closeModal}
          editingHost={
            activeModal === 'addHost' && payload && typeof payload === 'object' && 'id' in payload
              ? payload
              : null
          }
          onAddHost={(newHost, pairingPin) => {
            if (props.onAddHost) {
              props.onAddHost(newHost);
            }
            if (pairingPin && newHost?.ip) {
              const targetWs = buildHostWsUri(newHost.ip, newHost.port || 8765);
              props.setWsUrl?.(targetWs);
              void pairHostWithPin(targetWs, pairingPin).then((tok) => {
                if (tok) {
                  props.onConnectWs?.(targetWs);
                  props.onToast?.(
                    language === 'bg'
                      ? `✓ Сдвоен и свързан с ${newHost.name}`
                      : `✓ Paired and connected to ${newHost.name}`
                  );
                } else {
                  props.onToast?.(
                    language === 'bg'
                      ? `Хостът е добавен, но PIN сдвояването се провали.`
                      : `Host added, but PIN pairing failed — verify the 6-digit PIN.`
                  );
                }
              });
            }
          }}
          onEditHost={(updatedHost, previousId) => {
            if (props.onEditHost) {
              props.onEditHost(updatedHost, previousId);
            }
          }}
        />
      )}

      {isMounted('pcDaemonGui') && (
        <PcDaemonGuiModal
          isOpen={activeModal === 'pcDaemonGui'}
          onClose={closeModal}
          onOpenCodeReleases={() => useUIStore.getState().openModal('code')}
        />
      )}

      {isMounted('quickSetup') && (
        <QuickSetupModal
          isOpen={activeModal === 'quickSetup'}
          onClose={closeModal}
          isConnected={props.isConnected}
          onAutoPairHost={(hostData) => {
            if (props.onAddHost) {
              props.onAddHost({
                id: hostData.id,
                name: hostData.name,
                ip: hostData.ip,
                mac: hostData.mac,
                os: hostData.os,
                deviceType: 'pc',
                isOnline: false,
                lastSeen: 'Paired (awaiting handshake)',
                tags: ['Paired-PC', 'LAN-8765'],
              });
            }
            if (props.setWsUrl) {
              props.setWsUrl(hostData.wsUri);
            }
            if (hostData.pairingToken) {
              saveAuthToken(hostData.pairingToken, hostData.wsUri);
              saveAuthToken(hostData.pairingToken);
              if (props.onConnectWs) {
                props.onConnectWs(hostData.wsUri);
              }
            } else if (hostData.pairingPin) {
              void pairHostWithPin(hostData.wsUri, hostData.pairingPin).then((tok) => {
                if (tok) {
                  props.onConnectWs?.(hostData.wsUri);
                  props.onToast?.(
                    language === 'bg'
                      ? `✓ Сдвоен и свързан с ${hostData.name}`
                      : `✓ Paired & connected to ${hostData.name}`
                  );
                } else {
                  props.onToast?.(
                    language === 'bg'
                      ? `Неуспешно PIN сдвояване с ${hostData.name}. Уверете се, че PC агентът работи.`
                      : `PIN pairing failed for ${hostData.name}. Check that the PC Host Agent is running.`
                  );
                }
              });
            } else if (props.onConnectWs) {
              props.onConnectWs(hostData.wsUri);
            }
          }}
        />
      )}

      {isMounted('shortcuts') && (
        <KeyboardShortcutsModal
          isOpen={activeModal === 'shortcuts'}
          onClose={closeModal}
        />
      )}

      {isMounted('onboarding') && (
        <OnboardingModal
          isOpen={activeModal === 'onboarding'}
          onClose={closeModal}
          onOpenQuickSetup={() => useUIStore.getState().openModal('quickSetup')}
        />
      )}
    </Suspense>
  );
};
