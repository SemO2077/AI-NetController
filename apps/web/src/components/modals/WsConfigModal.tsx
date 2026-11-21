import React, { useState, useEffect, useRef } from 'react';
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
  const [authToken, setAuthToken] = useState(() => getStoredAuthToken(wsUrl));
  const [showToken, setShowToken] = useState(false);
  const [localConnecting, setLocalConnecting] = useState(false);
  const [pairingPin, setPairingPin] = useState('');
  const [isPairingPin, setIsPairingPin] = useState(false);
  const [pinStatusMsg, setPinStatusMsg] = useState<string | null>(null);
  const connectTimerRef = useRef<number | null>(null);

  const connected = isRealWsConnected ?? isConnected ?? false;
  const connecting = isConnecting || localConnecting;
  const connectFn = onConnectRealWs ?? onConnect ?? (() => {});
  const disconnectFn = onDisconnectRealWs ?? onDisconnect ?? (() => {});

  useEffect(() => {
    setInputUrl(wsUrl);
  }, [wsUrl]);

  useEffect(() => {
    if (isOpen) {
      setAuthToken(getStoredAuthToken(wsUrl));
    }
  }, [isOpen, wsUrl]);

  useEffect(() => {
    return () => {
      if (connectTimerRef.current !== null) {
        window.clearTimeout(connectTimerRef.current);
      }
    };
  }, []);

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
    const cleanUrl = inputUrl.trim();
    saveAuthToken(authToken, cleanUrl);
    saveAuthToken(authToken);
    setWsUrl(cleanUrl);
    setLocalConnecting(true);
    connectFn(cleanUrl);
    if (connectTimerRef.current !== null) {
      window.clearTimeout(connectTimerRef.current);
    }
    connectTimerRef.current = window.setTimeout(() => {
      connectTimerRef.current = null;
      setLocalConnecting(false);
    }, 1200);
  };

  const handleDisconnect = () => {
    triggerHapticFeedback('light');
    disconnectFn();
  };

  const handleSaveTokenOnly = () => {
    triggerHapticFeedback('light');
    saveAuthToken(authToken, inputUrl.trim());
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
        <div className="p-4 glass-liquid-subtle rounded-[24px] space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-display font-bold ink-primary">{t('ws_status_label')}</span>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] px-2.5 py-0.5 rounded-full liquid-control-pill text-cyan-400 font-mono font-bold">
                AI-NET/3.0
              </span>
              <span
                className={`text-xs px-3 py-1 rounded-full font-bold border ${
                  connected
                    ? 'bg-emerald-500/14 text-emerald-400 border-emerald-500/35'
                    : 'bg-cyan-500/14 text-cyan-400 border-cyan-400/35'
                }`}
              >
                {connected ? t('ws_connected_host') : t('ws_lab_mode')}
              </span>
            </div>
          </div>

          {heartbeatMetrics && (
            <div className="pt-1">
              <HeartbeatSparkline metrics={heartbeatMetrics} variant="detailed" />
            </div>
          )}

          {!heartbeatMetrics && connected && (
            <div className="mt-2 pt-2 border-t border-white/[0.08] flex items-center justify-between text-xs">
              <div className="flex items-center space-x-1.5">
                <Activity className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                <span className="ink-secondary font-medium">Heartbeat:</span>
              </div>
              <div className="flex items-center space-x-2">
                {heartbeatStatus === 'healthy' && (
                  <span className="flex items-center space-x-1 text-emerald-400 font-mono text-xs font-bold">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>{heartbeatLatencyMs ? `${heartbeatLatencyMs}ms RTT` : 'Active'}</span>
                  </span>
                )}
                {heartbeatStatus === 'warning' && (
                  <span className="flex items-center space-x-1 text-amber-400 font-mono text-xs font-bold">
                    <AlertCircle className="w-3 h-3 animate-pulse" />
                    <span>{t('spark_delay_jitter')}</span>
                  </span>
                )}
                {heartbeatStatus === 'unreachable' && (
                  <span className="flex items-center space-x-1 text-rose-400 font-mono text-xs font-bold">
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
          <div className="p-3 bg-amber-500/12 border border-amber-500/35 rounded-2xl flex items-center justify-between gap-2 text-xs text-amber-400">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{t('ws_https_warning')}</span>
            </div>
            <button
              type="button"
              onClick={handleUpgradeToWss}
              className="px-3 py-1 squircle-amber preserve-white rounded-full text-[11px] font-bold transition shrink-0 cursor-pointer"
            >
              {t('ws_upgrade_btn')}
            </button>
          </div>
        )}

        {/* Endpoint Input + Quick Preset Chips */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-xs font-display font-bold ink-primary">
              {t('ws_endpoint_label')}
            </label>
            <div className="flex items-center gap-1">
              {['ws://127.0.0.1:8765', 'wss://127.0.0.1:8765'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setInputUrl(preset)}
                  className="px-2 py-0.5 rounded-full liquid-control-pill text-[10px] font-mono ink-secondary cursor-pointer"
                >
                  {preset.startsWith('wss') ? 'Local WSS' : 'Local WS'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="ws://localhost:8765"
              className="flex-1 liquid-terminal-entry rounded-full px-4 py-2.5 text-xs sm:text-sm font-mono ink-primary focus:outline-none focus:border-cyan-400"
            />
            {connected ? (
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-4 py-2.5 squircle-rose preserve-white rounded-full text-xs font-bold transition cursor-pointer"
              >
                {t('ws_btn_disconnect')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting}
                className="px-4 py-2.5 liquid-hero-btn rounded-full text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
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
            <label className="flex items-center space-x-1.5 text-xs font-display font-bold ink-primary">
              <Key className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t('ws_psk_label')}</span>
            </label>
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="text-[11px] font-semibold text-cyan-400 hover:underline cursor-pointer"
            >
              {showToken ? t('ws_btn_hide') : t('ws_btn_show')}
            </button>
          </div>
          <input
            type={showToken ? 'text' : 'password'}
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            onBlur={handleSaveTokenOnly}
            placeholder="Paste host pairing token or use 6-digit PIN below..."
            className="w-full liquid-terminal-entry rounded-full px-4 py-2.5 text-xs sm:text-sm font-mono ink-primary focus:outline-none focus:border-cyan-400"
          />
        </div>

        {/* 6-Digit Ephemeral PIN Exchange */}
        <div className="space-y-1.5">
          <label className="block text-xs font-display font-bold ink-primary">
            {isBg ? 'Сдвояване с 6-цифрен PIN' : '6-Digit Host PIN Pairing'}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              value={pairingPin}
              onChange={(e) => setPairingPin(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder={isBg ? 'Въведете 6-цифрен PIN от HostAgent...' : 'Enter 6-digit PIN shown on HostAgent...'}
              className="flex-1 liquid-terminal-entry rounded-full px-4 py-2.5 text-xs sm:text-sm font-mono ink-primary focus:outline-none focus:border-cyan-400"
            />
            <button
              type="button"
              onClick={handlePairWithPin}
              disabled={!pairingPin.trim() || isPairingPin}
              className="px-4 py-2.5 squircle-emerald preserve-white rounded-full text-xs font-bold transition disabled:opacity-40 cursor-pointer"
            >
              {isPairingPin ? (isBg ? 'Сдвояване...' : 'Pairing...') : isBg ? 'Сдвои PIN' : 'Pair PIN'}
            </button>
          </div>
          {pinStatusMsg && (
            <p className="text-[11px] font-mono text-cyan-400 font-semibold">{pinStatusMsg}</p>
          )}
        </div>

        {/* Security & Protocol Compliance Badges */}
        <div className="grid grid-cols-2 gap-2.5 pt-1 text-[11px]">
          <div className="p-3 glass-liquid-subtle rounded-2xl flex items-center space-x-2.5">
            <div className="w-8 h-8 squircle-badge squircle-emerald flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold ink-primary truncate">{t('ws_anti_replay')}</div>
              <div className="text-[10px] ink-muted truncate">{t('ws_monotonic')}</div>
            </div>
          </div>
          <div className="p-3 glass-liquid-subtle rounded-2xl flex items-center space-x-2.5">
            <div className="w-8 h-8 squircle-badge squircle-hero flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold ink-primary truncate">{t('ws_circuit_breaker')}</div>
              <div className="text-[10px] ink-muted truncate">{t('ws_circuit_breaker_desc')}</div>
            </div>
          </div>
        </div>

        <p className="text-xs ink-muted leading-relaxed liquid-terminal-entry p-3.5 rounded-2xl">
          {t('ws_protocol_hint')}
        </p>
      </div>
    </BottomSheet>
  );
};
