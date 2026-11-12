import React, { useState } from 'react';
import { Link, Activity, AlertCircle, CheckCircle2, ShieldCheck, Key, Lock } from 'lucide-react';
import { HeartbeatMetrics } from '../../types';
import { HeartbeatSparkline } from '../telemetry/HeartbeatSparkline';
import { BottomSheet } from '../ui/BottomSheet';
import { triggerHapticFeedback } from '../../services/hapticService';
import { getStoredAuthToken, saveAuthToken, pairHostWithPin } from '../../services/securityService';
import { useTranslation } from '../../i18n/useTranslation';

export interface WsConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  wsUrl: string;
  setWsUrl: (url: string) => void;
  isRealWsConnected?: boolean;
  isConnected?: boolean;
  isConnecting?: boolean;
  onConnectRealWs?: (url: string) => void;
  onConnect?: (url: string) => void;
  onDisconnectRealWs?: () => void;
  onDisconnect?: () => void;
  heartbeatLatencyMs?: number | null;
  heartbeatStatus?: 'idle' | 'healthy' | 'warning' | 'unreachable';
  heartbeatMetrics?: HeartbeatMetrics;
}

export const WsConfigModal: React.FC<WsConfigModalProps> = ({
  isOpen,
  onClose,
  wsUrl,
  setWsUrl,
  isRealWsConnected,
  isConnected,
  isConnecting = false,
  onConnectRealWs,
  onConnect,
  onDisconnectRealWs,
  onDisconnect,
  heartbeatLatencyMs,
  heartbeatStatus = 'idle',
  heartbeatMetrics,
}) => {
  const { t, language } = useTranslation();
  const isBg = language === 'bg';
  const [inputUrl, setInputUrl] = useState(wsUrl);
  const [authToken, setAuthToken] = useState(getStoredAuthToken);
  const [showToken, setShowToken] = useState(false);
  const [localConnecting, setLocalConnecting] = useState(false);
  const [pairingPin, setPairingPin] = useState('');
  const [isPairingPin, setIsPairingPin] = useState(false);
  const [pinStatusMsg, setPinStatusMsg] = useState<string | null>(null);

  const connected = isRealWsConnected ?? isConnected ?? false;
  const connecting = isConnecting || localConnecting;
  const connectFn = onConnectRealWs ?? onConnect ?? (() => {});
  const disconnectFn = onDisconnectRealWs ?? onDisconnect ?? (() => {});

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isMixedContentRisk = isHttps && inputUrl.trim().startsWith('ws://');

  const handleUpgradeToWss = () => {
    triggerHapticFeedback('light');
    const upgraded = inputUrl.replace(/^ws:\/\//i, 'wss://');
    setInputUrl(upgraded);
  };

  const handlePairWithPin = async () => {
    const cleanPin = pairingPin.trim();
    if (!cleanPin || isPairingPin) return;
    setIsPairingPin(true);
    setPinStatusMsg(null);
    triggerHapticFeedback('medium');
    try {
      const token = await pairHostWithPin(inputUrl.trim(), cleanPin, 'AI-NetController-Web');
      if (token) {
        setAuthToken(token);
        saveAuthToken(token);
        setWsUrl(inputUrl.trim());
        setPairingPin('');
        setPinStatusMsg(isBg ? 'PIN сдвояването е успешно. Свързване...' : 'PIN paired successfully. Connecting...');
        connectFn(inputUrl.trim());
      } else {
        setPinStatusMsg(isBg ? 'Невалиден или изтекъл PIN.' : 'Invalid or expired PIN.');
      }
    } catch {
      setPinStatusMsg(isBg ? 'Грешка при сдвояване с хоста.' : 'Failed to exchange pairing PIN.');
    } finally {
      setIsPairingPin(false);
    }
  };

  const handleConnect = () => {
    triggerHapticFeedback('medium');
    saveAuthToken(authToken);
    setWsUrl(inputUrl);
    setLocalConnecting(true);
    connectFn(inputUrl);
    setTimeout(() => {
      setLocalConnecting(false);
    }, 1200);
  };

  const handleDisconnect = () => {
    triggerHapticFeedback('light');
    disconnectFn();
  };

  const handleSaveTokenOnly = () => {
    triggerHapticFeedback('light');
    saveAuthToken(authToken);
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={t('ws_modal_title')}
      subtitle={t('ws_modal_subtitle')}
    >
      <div className="space-y-4">
        {/* Status Card */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">{t('ws_status_label')}</span>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/10 text-cyan-300 font-mono">
                AI-NET/3.0-SECURE
              </span>
              <span
                className={`text-xs px-3 py-1 rounded-full font-bold ${
                  connected
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                }`}
              >
                {connected ? t('ws_connected_host') : t('ws_lab_mode')}
              </span>
            </div>
          </div>

          {/* Heartbeat Sparkline */}
          {heartbeatMetrics && (
            <div className="pt-2">
              <HeartbeatSparkline
                metrics={heartbeatMetrics}
                variant="detailed"
                isSimulated={!connected}
              />
            </div>
          )}

          {/* Simple status fallback */}
          {!heartbeatMetrics && connected && (
            <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-1.5">
                <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                <span className="text-slate-300">Heartbeat:</span>
              </div>
              <div className="flex items-center space-x-2">
                {heartbeatStatus === 'healthy' && (
                  <span className="flex items-center space-x-1 text-emerald-400 font-mono text-xs">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{heartbeatLatencyMs ? `${heartbeatLatencyMs}ms RTT` : 'Active'}</span>
                  </span>
                )}
                {heartbeatStatus === 'warning' && (
                  <span className="flex items-center space-x-1 text-amber-400 font-mono text-xs">
                    <AlertCircle className="w-3 h-3 animate-pulse" />
                    <span>{t('spark_delay_jitter')}</span>
                  </span>
                )}
                {heartbeatStatus === 'unreachable' && (
                  <span className="flex items-center space-x-1 text-rose-400 font-mono text-xs">
                    <AlertCircle className="w-3 h-3" />
                    <span>{t('spark_unreachable')}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mixed Content Warning */}
        {isMixedContentRisk && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-xs text-amber-200">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{t('ws_https_warning')}</span>
            </div>
            <button
              type="button"
              onClick={handleUpgradeToWss}
              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 rounded-lg text-[11px] font-bold text-amber-100 transition shrink-0"
            >
              {t('ws_upgrade_btn')}
            </button>
          </div>
        )}

        {/* Endpoint Input */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
            {t('ws_endpoint_label')}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="ws://localhost:8765"
              className="flex-1 bg-white/5 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-mono text-white focus:outline-none focus:border-cyan-400"
            />
            {connected ? (
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-4 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                {t('ws_btn_disconnect')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting}
                className="px-4 py-2.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                <Link className="w-3.5 h-3.5" />
                <span>{connecting ? t('ws_btn_connecting') : t('ws_btn_connect')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Pre-Shared Key / Auth Token */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="flex items-center space-x-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
              <Key className="w-3 h-3 text-cyan-400" />
              <span>{t('ws_psk_label')}</span>
            </label>
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
            >
              {showToken ? t('ws_btn_hide') : t('ws_btn_show')}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type={showToken ? 'text' : 'password'}
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              onBlur={handleSaveTokenOnly}
              placeholder="Paste host pairing token or use 6-digit PIN below..."
              className="flex-1 bg-white/5 border border-white/15 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-mono text-white focus:outline-none focus:border-cyan-400"
            />
          </div>
        </div>

        {/* 6-Digit Ephemeral PIN Exchange */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
            {isBg ? 'Сдвояване с 6-цифрен PIN (без пренос на токен)' : '6-Digit Host PIN Pairing'}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              value={pairingPin}
              onChange={(e) => setPairingPin(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder={isBg ? 'Въведете 6-цифрен PIN от HostAgent...' : 'Enter 6-digit PIN shown on HostAgent...'}
              className="flex-1 bg-white/5 border border-white/15 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-mono text-white focus:outline-none focus:border-cyan-400"
            />
            <button
              type="button"
              onClick={handlePairWithPin}
              disabled={!pairingPin.trim() || isPairingPin}
              className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-semibold transition disabled:opacity-40 cursor-pointer"
            >
              {isPairingPin ? (isBg ? 'Сдвояване...' : 'Pairing...') : isBg ? 'Сдвои PIN' : 'Pair PIN'}
            </button>
          </div>
          {pinStatusMsg && (
            <p className="text-[11px] font-mono text-cyan-300">{pinStatusMsg}</p>
          )}
        </div>

        {/* Security & Protocol Compliance Badges */}
        <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-300">
          <div className="p-2.5 bg-white/[0.03] border border-white/10 rounded-xl flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <div className="font-semibold text-white">{t('ws_anti_replay')}</div>
              <div className="text-[10px] text-slate-400">{t('ws_monotonic')}</div>
            </div>
          </div>
          <div className="p-2.5 bg-white/[0.03] border border-white/10 rounded-xl flex items-center space-x-2">
            <Lock className="w-4 h-4 text-cyan-400 shrink-0" />
            <div>
              <div className="font-semibold text-white">{t('ws_circuit_breaker')}</div>
              <div className="text-[10px] text-slate-400">{t('ws_circuit_breaker_desc')}</div>
            </div>
          </div>
        </div>

        {/* Hint Box */}
        <p className="text-xs text-slate-400 leading-relaxed bg-white/[0.02] border border-white/5 p-3 rounded-xl">
          {t('ws_protocol_hint')}
        </p>
      </div>
    </BottomSheet>
  );
};
