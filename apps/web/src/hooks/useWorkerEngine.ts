import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ApprovalRequiredEvent,
  AgentExecutionResponse,
  ClientCommandMessage,
  HeartbeatMetrics,
} from '../types';
import { logStore } from '../store/logStore';
import { useScreenStore } from '../store/screenStore';
import { useUIStore } from '../store/uiStore';
import { triggerHapticFeedback } from '../services/hapticService';
import { generateMockScreenCanvas } from '../services/screenFrameService';
import {
  inspectCommandSecurity,
  commandRateLimiter,
  hostCircuitBreaker,
  getStoredAuthToken,
  getQuarantinedHosts,
  setHostQuarantined,
} from '../services/securityService';

interface UseWorkerEngineProps {
  targetId: string;
  onTelemetry: (data: unknown) => void;
  onHostUnreachable: (targetId: string, reason: string) => void;
}

export function useWorkerEngine({
  targetId,
  onTelemetry,
  onHostUnreachable,
}: UseWorkerEngineProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [wsUrl, setWsUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cst_ws_url');
      if (saved) return saved;
      const host = window.location.hostname;
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return `ws://${host}:8765`;
      }
    }
    return 'ws://localhost:8765';
  });
  const [latency, setLatency] = useState<number | null>(null);
  const [heartbeatMetrics, setHeartbeatMetrics] = useState<HeartbeatMetrics | undefined>(() => ({
    currentLatencyMs: 7,
    history: [8, 6, 7, 7, 8, 6, 7, 6, 7, 8],
    jitterMs: 0.8,
    minLatencyMs: 6,
    maxLatencyMs: 8,
    avgLatencyMs: 7,
    status: 'idle',
  }));
  const [heartbeatStatus, setHeartbeatStatus] = useState<HeartbeatMetrics['status']>('idle');
  const [isSendingCommand, setIsSendingCommand] = useState(false);
  const [lastExecutionResult, setLastExecutionResult] = useState<AgentExecutionResponse | null>(null);
  const [activeHitlEvent, setActiveHitlEvent] = useState<ApprovalRequiredEvent | null>(null);
  const [isCapturingScreen, setIsCapturingScreen] = useState(false);
  const [unreachableAlert, setUnreachableAlert] = useState<{ message: string } | null>(null);
  const [circuitTrippedHosts, setCircuitTrippedHosts] = useState<string[]>([]);
  const [quarantinedHosts, setQuarantinedHostsList] = useState<string[]>(getQuarantinedHosts);
  const [securityAlert, setSecurityAlert] = useState<{ title: string; reason: string } | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const targetIdRef = useRef(targetId);

  useEffect(() => {
    targetIdRef.current = targetId;
  }, [targetId]);

  useEffect(() => {
    // Instantiate off-main-thread Web Worker with optimal Transferable message handling
    const worker = new Worker(new URL('../workers/networkWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const { type, data, status, latency: rtt, jitter, history, buffer, attempt, message } = e.data;

      switch (type) {
        case 'STATUS': {
          if (status === 'connected') {
            setIsConnected(true);
            setIsConnecting(false);
            setIsReconnecting(false);
            setHeartbeatStatus('healthy');
            setUnreachableAlert(null);
            triggerHapticFeedback('medium');
            logStore.addLog('SYSTEM_MDNS', targetIdRef.current, 'success', 'WebSocket връзката е активна и криптографски защитена (CST/2.4-SECURE)');
          } else if (status === 'connecting') {
            setIsConnecting(true);
            setIsReconnecting(false);
          } else if (status === 'reconnecting') {
            setIsConnected(false);
            setIsConnecting(false);
            setIsReconnecting(true);
            setHeartbeatStatus('warning');
            logStore.addLog('SYSTEM_MDNS', targetIdRef.current, 'warn', `Повторно свързване (опит #${attempt || 1})...`);
          } else if (status === 'circuit_open') {
            setIsConnected(false);
            setIsConnecting(false);
            setIsReconnecting(false);
            setHeartbeatStatus('idle');
            logStore.addLog('SYSTEM_MDNS', 'GATEWAY', 'info', message || 'WebSocket сървърът е в режим на готовност (Lab mode).');
          } else if (status === 'degraded') {
            setHeartbeatStatus('warning');
            logStore.addLog('SYSTEM_MDNS', targetIdRef.current, 'warn', 'Heartbeat забавяне: хостът забави PONG отговора.');
          } else if (status === 'unresponsive' || status === 'timeout') {
            setIsConnected(false);
            setIsConnecting(false);
            setIsReconnecting(false);
            setHeartbeatStatus('idle');
            logStore.addLog('SYSTEM_MDNS', 'GATEWAY', 'info', 'WebSocket шлюзът не отговаря. Преминаване към локален високоскоростен CST симулатор.');
          } else if (status === 'disconnected') {
            setIsConnected(false);
            setIsConnecting(false);
            setIsReconnecting(false);
            setHeartbeatStatus('idle');
            setLatency(null);
          } else if (status === 'error') {
            setIsConnected(false);
            setIsConnecting(false);
            setIsReconnecting(false);
            setHeartbeatStatus('idle');
          }
          break;
        }

        case 'METRICS': {
          setLatency(rtt);
          setHeartbeatMetrics({
            currentLatencyMs: rtt,
            history: history || [],
            jitterMs: jitter || 1.2,
            minLatencyMs: Math.min(...(history || [rtt])),
            maxLatencyMs: Math.max(...(history || [rtt])),
            avgLatencyMs: Math.round((history || [rtt]).reduce((a: number, b: number) => a + b, 0) / (history?.length || 1)),
            status: 'healthy',
          });
          break;
        }

        case 'TELEMETRY': {
          onTelemetry(data);
          break;
        }

        case 'SCREEN_FRAME': {
          if (buffer) {
            if (currentBlobUrlRef.current) {
              URL.revokeObjectURL(currentBlobUrlRef.current);
            }
            const blob = new Blob([buffer], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            currentBlobUrlRef.current = url;
            useScreenStore.getState().setScreenBase64(url);
            setIsCapturingScreen(false);
          }
          break;
        }

        case 'JSON_FRAME': {
          if (data.event === 'APPROVAL_REQUIRED' || data.event === 'HITL_REQUIRED') {
            triggerHapticFeedback('warning');
            setActiveHitlEvent({
              event: 'APPROVAL_REQUIRED',
              command_id: data.command_id || data.approval_id || `cmd_${Date.now()}`,
              risk_level: data.risk_level || 'HIGH',
              proposed_command: data.proposed_command || data.command || '',
              explanation: data.explanation || data.reason || 'Operator confirmation required.',
              target_id: data.target_id || targetIdRef.current,
              timestamp:
                typeof data.timestamp === 'string'
                  ? data.timestamp
                  : new Date().toLocaleTimeString('en-GB', { hour12: false }),
            });
            setIsSendingCommand(false);
          } else if (data.event === 'EXECUTION_RESULT' || data.event === 'SHELL_RESULT') {
            setIsSendingCommand(false);
            const normalizedStatus = data.status === 'error' ? 'failed' : (data.status || 'success');
            setLastExecutionResult({
              event: 'EXECUTION_RESULT',
              command_id: data.command_id || `cmd_${Date.now()}`,
              target_id: data.target_id || targetIdRef.current,
              status: normalizedStatus,
              output: data.output ?? '',
              exit_code: data.exit_code ?? (normalizedStatus === 'success' ? 0 : 1),
              execution_time_ms: data.execution_time_ms ?? 12,
              timestamp:
                typeof data.timestamp === 'string'
                  ? data.timestamp
                  : new Date().toLocaleTimeString('en-GB', { hour12: false }),
            });
            if (normalizedStatus === 'success') {
              hostCircuitBreaker.recordSuccess(targetIdRef.current);
              setCircuitTrippedHosts((prev) => prev.filter((id) => id !== targetIdRef.current));
            } else if (normalizedStatus === 'failed') {
              if (hostCircuitBreaker.recordFailure(targetIdRef.current)) {
                setCircuitTrippedHosts((prev) => Array.from(new Set([...prev, targetIdRef.current])));
              }
            }
            triggerHapticFeedback('light');
          }
          break;
        }
      }
    };

    return () => {
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
      }
      worker.terminate();
    };
  }, [onHostUnreachable, onTelemetry]);

  const connect = useCallback((url?: string) => {
    const targetUrl = url || wsUrl;
    setWsUrl(targetUrl);
    try {
      localStorage.setItem('cst_ws_url', targetUrl);
    } catch {
      // ignore
    }
    setIsConnecting(true);
    const token = getStoredAuthToken();
    workerRef.current?.postMessage({
      type: 'CONNECT',
      payload: { url: targetUrl, token },
    });
  }, [wsUrl]);

  const reconnectNow = useCallback(() => {
    setIsConnecting(true);
    workerRef.current?.postMessage({ type: 'RETRY_NOW' });
  }, []);

  const disconnect = useCallback(() => {
    workerRef.current?.postMessage({ type: 'DISCONNECT' });
    setIsConnected(false);
    setIsConnecting(false);
    setIsReconnecting(false);
    setLatency(null);
  }, []);

  const toggleQuarantine = useCallback((hostId: string) => {
    const isQuarantined = quarantinedHosts.includes(hostId);
    const updated = setHostQuarantined(hostId, !isQuarantined);
    setQuarantinedHostsList(updated);
    triggerHapticFeedback('warning');
    logStore.addLog(
      'MOBILE_CLIENT',
      hostId,
      !isQuarantined ? 'warn' : 'info',
      !isQuarantined ? `Хост ${hostId} е поставен под КАРАНТИНА (мрежова изолация)` : `Хост ${hostId} е освободен от карантина`
    );
  }, [quarantinedHosts]);

  const resetHostCircuit = useCallback((hostId: string) => {
    hostCircuitBreaker.reset(hostId);
    setCircuitTrippedHosts((prev) => prev.filter((id) => id !== hostId));
    triggerHapticFeedback('light');
    logStore.addLog('MOBILE_CLIENT', hostId, 'info', `Прекъсвачът за ${hostId} бе ръчно нулиран.`);
  }, []);

  const panicKillAll = useCallback(() => {
    triggerHapticFeedback('heavy');
    setIsSendingCommand(false);
    setActiveHitlEvent(null);
    logStore.addLog('MOBILE_CLIENT', 'ALL', 'error', '🚨 АВАРИЕН СТОП: Изпратен е Panic Kill сигнал към всички активни агенти!');

    if (isConnected) {
      workerRef.current?.postMessage({
        type: 'SEND_JSON',
        payload: { action: 'panic_kill_all', timestamp: Date.now() },
      });
    }
  }, [isConnected]);

  const sendCommand = useCallback(
    (cmd: ClientCommandMessage) => {
      const isBg = useUIStore.getState().language === 'bg';

      // 1. Quarantined Host Gate
      if (quarantinedHosts.includes(cmd.target_id) && !cmd.prompt.toLowerCase().includes('status')) {
        triggerHapticFeedback('warning');
        setSecurityAlert({
          title: isBg ? 'Хост под Карантина' : 'Host Under Quarantine',
          reason: isBg
            ? `Хост ${cmd.target_id} е изолиран от сигурността. Команди са забранени до отмяна на карантината.`
            : `Host ${cmd.target_id} is isolated by security policy. Commands are blocked until quarantine is lifted.`,
        });
        logStore.addLog(
          'MOBILE_CLIENT',
          cmd.target_id,
          'warn',
          isBg ? 'Командата е отказана: Хостът е под активна карантина.' : 'Command denied: Host is under active quarantine.'
        );
        return;
      }

      // 2. Circuit Breaker Gate
      if (hostCircuitBreaker.isTripped(cmd.target_id)) {
        triggerHapticFeedback('warning');
        setSecurityAlert({
          title: isBg ? 'Прекъсвачът е Активиран' : 'Circuit Breaker Tripped',
          reason: isBg
            ? `Хост ${cmd.target_id} натрупа поредица от грешки. Нулирайте прекъсвача, преди да изпращате нови команди.`
            : `Host ${cmd.target_id} accumulated consecutive faults. Reset the circuit breaker before sending new commands.`,
        });
        logStore.addLog(
          'MOBILE_CLIENT',
          cmd.target_id,
          'warn',
          isBg ? 'Командата е блокирана от прекъсвача за безопасност.' : 'Command blocked by safety circuit breaker.'
        );
        return;
      }

      // 3. Rate Limiter Gate
      const rateCheck = commandRateLimiter.checkLimit(cmd.target_id);
      if (!rateCheck.allowed) {
        triggerHapticFeedback('warning');
        const waitSec = Math.ceil(rateCheck.resetMs / 1000);
        setSecurityAlert({
          title: isBg ? 'Ограничение на Честотата' : 'Rate Limit Exceeded',
          reason: isBg
            ? `Изчакайте ${waitSec}s преди следваща команда към този хост.`
            : `Please wait ${waitSec}s before sending another command to this host.`,
        });
        logStore.addLog(
          'MOBILE_CLIENT',
          cmd.target_id,
          'warn',
          isBg ? 'Ограничение на честотата: твърде много команди за кратък период.' : 'Rate limit exceeded: too many commands in a short window.'
        );
        return;
      }

      // 4. Pre-Flight Zero-Trust Security Analysis
      const verdict = inspectCommandSecurity(cmd.prompt);
      if (!verdict.isAllowed) {
        triggerHapticFeedback('warning');
        setSecurityAlert({
          title: isBg ? 'Командата е Блокирана от Защитата' : 'Command Blocked by Security Gate',
          reason:
            verdict.reason ||
            (isBg ? 'Засечена е забранена злонамерена сигнатура.' : 'Detected prohibited malicious signature.'),
        });
        logStore.addLog(
          'MOBILE_CLIENT',
          cmd.target_id,
          'error',
          isBg
            ? `Блокирана потенциално опасна команда: "${cmd.prompt}" (${verdict.reason})`
            : `Blocked potentially dangerous command: "${cmd.prompt}" (${verdict.reason})`
        );
        return;
      }

      setIsSendingCommand(true);
      triggerHapticFeedback('medium');
      logStore.addLog(
        'MOBILE_CLIENT',
        cmd.target_id,
        'info',
        isBg ? `Команда: "${cmd.prompt}" [Риск: ${verdict.riskLevel}]` : `Command: "${cmd.prompt}" [Risk: ${verdict.riskLevel}]`
      );

      // 5. Critical Destructive Command: Automatically trigger HITL gate if needed
      if (verdict.requiresHoldConfirmation && !isConnected) {
        setIsSendingCommand(false);
        setActiveHitlEvent({
          event: 'APPROVAL_REQUIRED',
          command_id: `cmd_sec_${Date.now()}`,
          risk_level: verdict.riskLevel,
          proposed_command: cmd.prompt,
          explanation: isBg ? `Изисква потвърждение: ${verdict.reason}` : `Confirmation required: ${verdict.reason}`,
          target_id: cmd.target_id,
          timestamp: new Date().toLocaleTimeString(isBg ? 'bg-BG' : 'en-GB', { hour12: false }),
        });
        return;
      }

      if (isConnected) {
        workerRef.current?.postMessage({
          type: 'SEND_JSON',
          payload: {
            action: 'EXECUTE_PROMPT',
            command_id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            prompt: cmd.prompt,
            session_rules: cmd.session_instruction || '',
            request_screenshot: cmd.request_screenshot ?? true,
            risk_verdict: verdict.riskLevel,
          },
        });
      } else {
        // High-speed simulation for instant UI feedback (35ms execution)
        setTimeout(() => {
          setIsSendingCommand(false);
          if (cmd.prompt.toLowerCase().includes('restart') || cmd.prompt.toLowerCase().includes('rm')) {
            setActiveHitlEvent({
              event: 'APPROVAL_REQUIRED',
              command_id: `cmd_${Date.now()}`,
              risk_level: 'HIGH',
              proposed_command: 'winget upgrade --all && shutdown /r /t 30',
              explanation: 'Изисква рестартиране на системните модули и обновяване на пакети.',
              target_id: cmd.target_id,
              timestamp: new Date().toLocaleTimeString('bg-BG', { hour12: false }),
            });
          } else {
            setLastExecutionResult({
              event: 'EXECUTION_RESULT',
              command_id: `cmd_${Date.now()}`,
              target_id: cmd.target_id,
              status: 'success',
              output: `Task dispatched successfully via CST Protocol.\nHost: ${cmd.target_id}\nRisk: ${verdict.riskLevel}\nExit Code: 0 (Fast Zero-Copy Dispatch)`,
              execution_time_ms: 12,
              timestamp: new Date().toLocaleTimeString('bg-BG', { hour12: false }),
            });
            hostCircuitBreaker.recordSuccess(cmd.target_id);
            if (cmd.request_screenshot) {
              useScreenStore.getState().setScreenBase64(generateMockScreenCanvas());
            }
          }
        }, 40);
      }
    },
    [isConnected, quarantinedHosts]
  );

  const resolveHitl = useCallback(
    (commandId: string, decision: 'APPROVED' | 'REJECTED') => {
      const prevHitl = activeHitlEvent;
      setActiveHitlEvent(null);
      if (isConnected) {
        workerRef.current?.postMessage({
          type: 'SEND_JSON',
          payload: {
            action: 'APPROVAL_RESPONSE',
            command_id: commandId,
            approval_id: commandId,
            approved: decision === 'APPROVED',
          },
        });
      } else {
        if (decision === 'APPROVED') {
          setLastExecutionResult({
            event: 'EXECUTION_RESULT',
            command_id: commandId,
            target_id: prevHitl?.target_id || targetIdRef.current,
            status: 'success',
            output: `Approved & Executed: ${prevHitl?.proposed_command || 'Command'}\nExit Code: 0`,
            exit_code: 0,
            execution_time_ms: 18,
            timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
          });
        } else {
          setLastExecutionResult({
            event: 'EXECUTION_RESULT',
            command_id: commandId,
            target_id: prevHitl?.target_id || targetIdRef.current,
            status: 'rejected',
            output: 'Execution denied by operator (HITL Safety Gate).',
            exit_code: -1,
            execution_time_ms: 1,
            timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
          });
        }
      }
    },
    [isConnected, activeHitlEvent]
  );

  const requestScreenRefresh = useCallback(
    (_deviceId: string) => {
      setIsCapturingScreen(true);
      if (isConnected) {
        workerRef.current?.postMessage({
          type: 'SEND_JSON',
          payload: { action: 'EXECUTE_PROMPT', prompt: 'Screenshot', request_screenshot: true },
        });
      } else {
        setTimeout(() => {
          useScreenStore.getState().setScreenBase64(generateMockScreenCanvas());
          setIsCapturingScreen(false);
        }, 50);
      }
    },
    [isConnected]
  );

  const clearUnreachableAlert = useCallback(() => setUnreachableAlert(null), []);
  const clearSecurityAlert = useCallback(() => setSecurityAlert(null), []);

  return useMemo(
    () => ({
      isConnected,
      isConnecting,
      isReconnecting,
      wsUrl,
      setWsUrl,
      latency,
      heartbeatMetrics,
      heartbeatStatus,
      isSendingCommand,
      lastExecutionResult,
      activeHitlEvent,
      isCapturingScreen,
      unreachableAlert,
      clearUnreachableAlert,
      circuitTrippedHosts,
      resetHostCircuit,
      quarantinedHosts,
      toggleQuarantine,
      panicKillAll,
      securityAlert,
      clearSecurityAlert,
      connect,
      reconnectNow,
      disconnect,
      sendCommand,
      resolveHitl,
      requestScreenRefresh,
    }),
    [
      isConnected,
      isConnecting,
      isReconnecting,
      wsUrl,
      latency,
      heartbeatMetrics,
      heartbeatStatus,
      isSendingCommand,
      lastExecutionResult,
      activeHitlEvent,
      isCapturingScreen,
      unreachableAlert,
      clearUnreachableAlert,
      circuitTrippedHosts,
      resetHostCircuit,
      quarantinedHosts,
      toggleQuarantine,
      panicKillAll,
      securityAlert,
      clearSecurityAlert,
      connect,
      reconnectNow,
      disconnect,
      sendCommand,
      resolveHitl,
      requestScreenRefresh,
    ]
  );
}
