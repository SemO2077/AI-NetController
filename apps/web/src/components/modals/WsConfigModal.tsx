import React, { useState, useEffect, useRef } from 'react';
import { Link, Activity, AlertCircle, CheckCircle2, ShieldCheck, Key, Lock, Copy, Check } from 'lucide-react';
import { HeartbeatMetrics } from '../../types';
import { HeartbeatSparkline } from '../telemetry/HeartbeatSparkline';
import { BottomSheet } from '../ui/BottomSheet';
import { triggerHapticFeedback } from '../../services/hapticService';
import { getStoredAuthToken, saveAuthToken, pairHostWithPin } from '../../services/securityService';
import { copyToClipboard } from '../../utils/clipboard';
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
  const [pinStatusMsg, setPinStatusMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [tokenSavedBadge, setTokenSavedBadge] = useState(false);
  const connectTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const connected = isRealWsConnected ?? isConnected ?? false;
  const connecting = isConnecting || localConnecting;
  const connectFn = onConnectRealWs ?? onConnect ?? (() => {});
  const disconnectFn = onDisconnectRealWs ?? onDisconnect ?? (() => {});

  const isValidWsUrl = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (!/^wss?:\/\/[^\s/]+/i.test(trimmed)) return false;
    try {
      const parsed = new URL(trimmed);
      return (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && Boolean(parsed.hostname);
    } catch {
      return false;
    }
  };

  useEffect(() => {
    setInputUrl(wsUrl);
    setUrlError(null);
  }, [wsUrl]);

  useEffect(() => {
    if (isOpen) {
      setAuthToken(getStoredAuthToken(wsUrl));
      setUrlError(null);
      setPinStatusMsg(null);
    }
  }, [isOpen, wsUrl]);

  useEffect(() => {
    return () => {
      if (connectTimerRef.current !== null) {
        window.clearTimeout(connectTimerRef.current);
      }
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  const isMixedContentRisk = isHttps && inputUrl.trim().startsWith('ws://');

  const handleUpgradeToWss = () => {
    triggerHapticFeedback('light');
    const upgraded = inputUrl.replace(/^ws:\/\//i, 'wss://');
    setInputUrl(upgraded);
    setUrlError(null);
  };

  const handleCopyEndpoint = () => {
    const cleanUrl = inputUrl.trim();
    if (!cleanUrl) return;
    triggerHapticFeedback('light');
    copyToClipboard(cleanUrl);
    setCopiedUrl(true);
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      setCopiedUrl(false);
    }, 1600);
  };

  const handlePairWithPin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanPin = pairingPin.trim();
    const cleanUrl = inputUrl.trim();
    if (!cleanPin || isPairingPin) return;
    if (!isValidWsUrl(cleanUrl)) {
      setUrlError(
        isBg
          ? 'Въведете валиден WebSocket адрес (напр. ws://192.168.1.100:8765).'
          : 'Enter a valid WebSocket URI (e.g. ws://192.168.1.100:8765).'
      );
      return;
    }
    if (!/^\d{6}$/.test(cleanPin)) {
      setPinStatusMsg({
        text: isBg ? 'PIN кодът трябва да съдържа точно 6 цифри.' : 'Pairing PIN must be exactly 6 digits.',
        tone: 'error',
      });
      return;
    }
    setIsPairingPin(true);
    setPinStatusMsg(null);
    triggerHapticFeedback('medium');
    try {
      const token = await pairHostWithPin(cleanUrl, cleanPin, 'AI-NetController-Web');
      if (token) {
        setAuthToken(token);
        saveAuthToken(token, cleanUrl);
        saveAuthToken(token);
        setWsUrl(cleanUrl);
        setPairingPin('');
        setPinStatusMsg({
          text: isBg ? '✓ PIN сдвояването е успешно. Свързване...' : '✓ PIN paired successfully. Connecting...',
          tone: 'success',
        });
        connectFn(cleanUrl);
      } else {
        setPinStatusMsg({
          text: isBg ? 'Невалиден или изтекъл PIN.' : 'Invalid or expired PIN.',
          tone: 'error',
        });
      }
    } catch {
      setPinStatusMsg({
        text: isBg ? 'Грешка при сдвояване с хоста.' : 'Failed to exchange pairing PIN.',
        tone: 'error',
      });
    } finally {
      setIsPairingPin(false);
    }
  };

  const handleConnect = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanUrl = inputUrl.trim();
    if (!isValidWsUrl(cleanUrl)) {
      triggerHapticFeedback('warning');
      setUrlError(
        isBg
          ? 'Невалиден WebSocket адрес — използвайте ws:// или wss:// (напр. ws://127.0.0.1:8765).'
          : 'Invalid WebSocket URI — must start with ws:// or wss:// (e.g. ws://127.0.0.1:8765).'
      );
      return;
    }
    setUrlError(null);
    triggerHapticFeedback('medium');
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
    setTokenSavedBadge(true);
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      setTokenSavedBadge(false);
    }, 1800);
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
        <form onSubmit={handleConnect} className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="text-xs font-display font-bold ink-primary">
              {t('ws_endpoint_label')}
            </label>
            <div className="flex items-center gap-1">
              {['ws://127.0.0.1:8765', 'wss://127.0.0.1:8765'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setInputUrl(preset);
                    setUrlError(null);
                  }}
                  className="px-2 py-0.5 rounded-full liquid-control-pill text-[10px] font-mono ink-secondary hover:ink-primary cursor-pointer"
                >
                  {preset.startsWith('wss') ? 'Local WSS' : 'Local WS'}
                </button>
              ))}
              <button
                type="button"
                onClick={handleCopyEndpoint}
                className="px-2 py-0.5 rounded-full liquid-control-pill text-[10px] font-mono ink-secondary hover:ink-primary flex items-center gap-1 cursor-pointer"
                title={isBg ? 'Копирай адреса' : 'Copy endpoint URI'}
              >
                {copiedUrl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-cyan-400" />}
                <span>{copiedUrl ? (isBg ? 'Копирано' : 'Copied') : isBg ? 'Копирай' : 'Copy'}</span>
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => {
                setInputUrl(e.target.value);
                if (urlError) setUrlError(null);
              }}
              placeholder="ws://localhost:8765"
              className={`flex-1 min-w-0 liquid-terminal-entry rounded-full px-4 py-2.5 text-xs sm:text-sm font-mono ink-primary focus:outline-none transition ${
                urlError ? 'border-rose-500/70' : 'focus:border-cyan-400'
              }`}
            />
            {connected ? (
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-4 py-2.5 squircle-rose preserve-white rounded-full text-xs font-bold transition cursor-pointer shrink-0"
              >
                {t('ws_btn_disconnect')}
              </button>
            ) : (
              <button
                type="submit"
                disabled={connecting}
                className="px-4 py-2.5 liquid-hero-btn rounded-full text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 shrink-0"
              >
                <Link className="w-3.5 h-3.5" />
                <span>{connecting ? t('ws_btn_connecting') : t('ws_btn_connect')}</span>
              </button>
            )}
          </div>
          {urlError && (
            <p className="text-[11px] text-rose-400 font-medium flex items-center gap-1.5 px-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{urlError}</span>
            </p>
          )}
        </form>

        {/* Pre-Shared Key / Auth Token */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center space-x-1.5 text-xs font-display font-bold ink-primary">
              <Key className="w-3.5 h-3.5 text-cyan-400" />
              <span>{t('ws_psk_label')}</span>
              {tokenSavedBadge && (
                <span className="text-[10px] font-mono text-emerald-400 font-semibold flex items-center gap-0.5">
                  <Check className="w-3 h-3" />
                  {isBg ? 'Запазено' : 'Saved'}
                </span>
              )}
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
            placeholder={
              isBg
                ? 'Поставете токена за сдвояване или ползвайте 6-цифрен PIN...'
                : 'Paste host pairing token or use 6-digit PIN below...'
            }
            className="w-full liquid-terminal-entry rounded-full px-4 py-2.5 text-xs sm:text-sm font-mono ink-primary focus:outline-none focus:border-cyan-400"
          />
        </div>

        {/* 6-Digit Ephemeral PIN Exchange */}
        <form onSubmit={handlePairWithPin} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-display font-bold ink-primary">
              {isBg ? 'Сдвояване с 6-цифрен PIN' : '6-Digit Host PIN Pairing'}
            </label>
            {pairingPin.length > 0 && (
              <span
                className={`text-[10px] font-mono font-bold tabular-nums ${
                  pairingPin.length === 6 ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {pairingPin.length}/6
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={pairingPin}
              onChange={(e) => {
                setPairingPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 6));
                if (pinStatusMsg) setPinStatusMsg(null);
              }}
              placeholder={isBg ? 'Въведете 6-цифрен PIN от HostAgent...' : 'Enter 6-digit PIN shown on HostAgent...'}
              className="flex-1 min-w-0 liquid-terminal-entry rounded-full px-4 py-2.5 text-xs sm:text-sm font-mono tracking-widest ink-primary focus:outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={pairingPin.length !== 6 || isPairingPin}
              className="px-4 py-2.5 squircle-emerald preserve-white rounded-full text-xs font-bold transition disabled:opacity-40 cursor-pointer shrink-0"
            >
              {isPairingPin ? (isBg ? 'Сдвояване...' : 'Pairing...') : isBg ? 'Сдвои PIN' : 'Pair PIN'}
            </button>
          </div>
          {pinStatusMsg && (
            <p
              className={`text-[11px] font-mono font-semibold flex items-center gap-1.5 px-1 ${
                pinStatusMsg.tone === 'success' ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {pinStatusMsg.tone === 'error' && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
              <span>{pinStatusMsg.text}</span>
            </p>
          )}
        </form>

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
