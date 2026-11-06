import React from 'react';
import { useUIStore } from '../../store/uiStore';
import { WolModal } from './WolModal';
import { ScreenViewerModal } from './ScreenViewerModal';
import { BottomSheet } from '../ui/BottomSheet';
import { MemoryManager } from '../settings/MemoryManager';
import { CodeExportModal } from './CodeExportModal';
import { WsConfigModal } from './WsConfigModal';
import { SystemUpdateModal } from './SystemUpdateModal';
import { HostDetailsModal } from './HostDetailsModal';
import { AddHostModal } from './AddHostModal';
import { PcDaemonGuiModal } from './PcDaemonGuiModal';
import { QuickSetupModal } from './QuickSetupModal';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { OnboardingModal } from './OnboardingModal';
import { useTranslation } from '../../i18n/useTranslation';

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
  onRequestScreenRefresh: (id: string) => void;
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
}

export const ModalManager: React.FC<ModalManagerProps> = (props) => {
  const { language } = useTranslation();
  const activeModal = useUIStore((s) => s.activeModal);
  const payload = useUIStore((s) => s.modalPayload);
  const closeModal = useUIStore((s) => s.closeModal);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  const wolDevice = payload?.device || (payload && typeof payload === 'object' && 'id' in payload ? payload : null);

  // Match live host data from props.hosts if payload is a host
  const hostForDetails = payload && typeof payload === 'object' && 'id' in payload
    ? props.hosts.find((h) => h.id === payload.id) || payload
    : null;

  return (
    <>
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
          props.onSendWolPacket({ mac: h.mac, broadcastIp: '255.255.255.255' }, h.id);
        }}
        onEditHost={(h) => {
          useUIStore.getState().openModal('addHost', h);
        }}
        onDeleteHost={props.onDeleteHost}
      />
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

      <ScreenViewerModal
        isOpen={activeModal === 'screen'}
        onClose={closeModal}
        device={payload}
        isCapturing={props.isCapturingScreen}
        onRefreshFrame={() => payload && props.onRequestScreenRefresh(payload.id)}
        onSendInputOpcode={props.onSendInputOpcode}
      />

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

      <CodeExportModal isOpen={activeModal === 'code'} onClose={closeModal} />
      <SystemUpdateModal isOpen={activeModal === 'update'} onClose={closeModal} />

      <BottomSheet
        isOpen={activeModal === 'memory'}
        onClose={closeModal}
        title={language === 'bg' ? 'Системни правила и контекстна памет' : 'System Rules & Contextual Memory'}
        subtitle={language === 'bg' ? 'Постоянни правила и временна оперативна памет за всеки хост' : 'Persistent host rules & active session memory'}
      >
        <MemoryManager hosts={props.hosts} onUpdateInstructions={props.onUpdateHostInstructions} />
      </BottomSheet>

      <AddHostModal
        isOpen={activeModal === 'addHost'}
        onClose={closeModal}
        editingHost={
          activeModal === 'addHost' && payload && typeof payload === 'object' && 'id' in payload
            ? payload
            : null
        }
        onAddHost={(newHost) => {
          if (props.onAddHost) {
            props.onAddHost(newHost);
          }
        }}
        onEditHost={(updatedHost, previousId) => {
          if (props.onEditHost) {
            props.onEditHost(updatedHost, previousId);
          }
        }}
      />

      <PcDaemonGuiModal
        isOpen={activeModal === 'pcDaemonGui'}
        onClose={closeModal}
        onOpenCodeReleases={() => useUIStore.getState().openModal('code')}
      />

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
              isOnline: true,
              lastSeen: 'Just now',
              tags: ['Paired-PC', 'LAN-8765'],
            });
          }
          if (props.setWsUrl) {
            props.setWsUrl(hostData.wsUri);
          }
          if (props.onConnectWs) {
            props.onConnectWs(hostData.wsUri);
          }
        }}
      />

      <KeyboardShortcutsModal
        isOpen={activeModal === 'shortcuts'}
        onClose={closeModal}
      />

      <OnboardingModal
        isOpen={activeModal === 'onboarding'}
        onClose={closeModal}
        onOpenQuickSetup={() => useUIStore.getState().openModal('quickSetup')}
      />
    </>
  );
};
