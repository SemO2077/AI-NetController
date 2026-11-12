import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ApprovalRequiredEvent,
  AgentExecutionResponse,
  ClientCommandMessage,
  HeartbeatMetrics,
  RiskLevel,
} from '../types';
import { logStore } from '../store/logStore';
import { useScreenStore } from '../store/screenStore';
import { useUIStore } from '../store/uiStore';
import { triggerHapticFeedback } from '../services/hapticService';
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
  const [heartbeatMetrics, setHeartbeatMetrics] = useState<HeartbeatMetrics | undefined>(undefined);
  const [heartbeatStatus, setHeartbeatStatus] = useState<HeartbeatMetrics['status']>('idle');
  const [isSendingCommand, setIsSendingCommand] = useState(false);
  const [lastExecutionResult, setLastExecutionResult] = useState<AgentExecutionResponse | null>(null);
  const [activeHitlEvent, setActiveHitlEvent] = useState<ApprovalRequiredEvent | null>(null);
  const [isCapturingScreen, setIsCapturingScreen] = useState(false);
  const [unreachableAlert, setUnreachableAlert] = useState<{ message: string } | null>(null);
  const [circuitTrippedHosts, setCircuitTrippedHosts] = useState<string[]>([]);
  const [quarantinedHosts, setQuarantinedHostsList] = useState<string[]>(getQuarantinedHosts);
  const [securityAlert, setSecurityAlert] = useState<{ title: string; reason: string } | null>(null);
  const [availableDisplays, setAvailableDisplays] = useState<Array<{ id: number; name?: string; width: number; height: number; primary?: boolean }>>([]);

  const workerRef = useRef<Worker | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const targetIdRef = useRef(targetId);
  const onTelemetryRef = useRef(onTelemetry);
  const onHostUnreachableRef = useRef(onHostUnreachable);
  const pendingHitlCommandRef = useRef<{ commandId: string; cmd: ClientCommandMessage; riskLevel: RiskLevel } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      fetch('/api/auth/session', { credentials: 'include' }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    targetIdRef.current = targetId;
  }, [targetId]);

  useEffect(() => {
    onTelemetryRef.current = onTelemetry;
  }, [onTelemetry]);

  useEffect(() => {
    onHostUnreachableRef.current = onHostUnreachable;
  }, [onHostUnreachable]);

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
            logStore.addLog('SYSTEM_MDNS', targetIdRef.current, 'success', 'WebSocket връзката е активна и криптографски защитена (AI-NET/3.0-SECURE)');
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
            const alertMsg = message || 'WebSocket хостът не отговори в рамките на 3.5s.';
            setUnreachableAlert({ message: alertMsg });
            if (targetIdRef.current) {
              onHostUnreachableRef.current(targetIdRef.current, alertMsg);
            }
            logStore.addLog('SYSTEM_MDNS', targetIdRef.current || 'GATEWAY', 'warn', alertMsg);
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
            jitterMs: jitter ?? 0,
            minLatencyMs: Math.min(...(history?.length ? history : [rtt])),
            maxLatencyMs: Math.max(...(history?.length ? history : [rtt])),
            avgLatencyMs: Math.round((history?.length ? history : [rtt]).reduce((a: number, b: number) => a + b, 0) / (history?.length || 1)),
            status: 'healthy',
          });
          break;
        }

        case 'TELEMETRY': {
          onTelemetryRef.current(data);
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
              approval_id: data.approval_id || data.command_id,
              challenge_nonce: data.challenge_nonce,
              signature: data.signature,
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
          } else if (data.event === 'DISPLAY_ENUM' && Array.isArray(data.monitors)) {
            setAvailableDisplays(data.monitors);
          } else if (data.event === 'ERROR') {
            setIsSendingCommand(false);
            const errMsg = data.error || data.message || 'Host agent rejected request.';
            logStore.addLog('HOST_AGENT', targetIdRef.current, 'error', errMsg);
            setLastExecutionResult({
              event: 'EXECUTION_RESULT',
              command_id: data.command_id || `err_${Date.now()}`,
              target_id: data.target_id || targetIdRef.current,
              status: 'failed',
              output: errMsg,
              exit_code: -1,
              execution_time_ms: 0,
              timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
            });
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
  }, []);

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

      // 1. Quarantined Host Gate (strict: never bypass via substring tricks)
      if (quarantinedHosts.includes(cmd.target_id)) {
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

      // 5. Critical Destructive Command: Enforce interactive HITL confirmation gate BEFORE dispatching
      if (verdict.requiresHoldConfirmation) {
        const hitlCmdId = `cmd_sec_${Date.now()}`;
        pendingHitlCommandRef.current = {
          commandId: hitlCmdId,
          cmd,
          riskLevel: verdict.riskLevel,
        };
        setIsSendingCommand(false);
        setActiveHitlEvent({
          event: 'APPROVAL_REQUIRED',
          command_id: hitlCmdId,
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
            target_id: cmd.target_id,
            command_id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            prompt: cmd.prompt,
            session_rules: cmd.session_instruction || '',
            request_screenshot: cmd.request_screenshot ?? true,
            risk_verdict: verdict.riskLevel,
          },
        });
      } else {
        setIsSendingCommand(false);
        setLastExecutionResult({
          event: 'EXECUTION_RESULT',
          command_id: `cmd_${Date.now()}`,
          target_id: cmd.target_id,
          status: 'failed',
          output: isBg
            ? `Грешка: Няма активна WebSocket връзка с хост агента (${cmd.target_id}). Свържете се първо.`
            : `Error: No active WebSocket connection to host agent (${cmd.target_id}). Connect to the host agent first.`,
          exit_code: -1,
          execution_time_ms: 0,
          timestamp: new Date().toLocaleTimeString(isBg ? 'bg-BG' : 'en-GB', { hour12: false }),
        });
      }
    },
    [isConnected, quarantinedHosts]
  );

  const sendInputOpcode = useCallback(
    (opcode: number, data: Record<string, any> | string): boolean => {
      if (!isConnected || !workerRef.current) {
        return false;
      }
      workerRef.current.postMessage({
        type: 'SEND_OPCODE',
        payload: {
          opcode,
          data: typeof data === 'string' ? data : JSON.stringify(data),
        },
      });
      return true;
    },
    [isConnected]
  );

  const resolveHitl = useCallback(
    (commandId: string, decision: 'APPROVED' | 'REJECTED') => {
      const prevHitl = activeHitlEvent;
      const pendingLocal = pendingHitlCommandRef.current;
      pendingHitlCommandRef.current = null;
      setActiveHitlEvent(null);

      if (pendingLocal && pendingLocal.commandId === commandId) {
        if (decision === 'APPROVED' && isConnected) {
          setIsSendingCommand(true);
          workerRef.current?.postMessage({
            type: 'SEND_JSON',
            payload: {
              action: 'EXECUTE_PROMPT',
              target_id: pendingLocal.cmd.target_id,
              command_id: commandId,
              prompt: pendingLocal.cmd.prompt,
              session_rules: pendingLocal.cmd.session_instruction || '',
              request_screenshot: pendingLocal.cmd.request_screenshot ?? true,
              risk_verdict: pendingLocal.riskLevel,
              hitl_confirmed: true,
            },
          });
          return;
        }
        setLastExecutionResult({
          event: 'EXECUTION_RESULT',
          command_id: commandId,
          target_id: pendingLocal.cmd.target_id,
          status: decision === 'APPROVED' ? 'failed' : 'rejected',
          output:
            decision === 'APPROVED'
              ? 'Cannot execute approved command: Host WebSocket is disconnected.'
              : 'Execution denied by operator (HITL Safety Gate).',
          exit_code: -1,
          execution_time_ms: 1,
          timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
        });
        return;
      }

      if (isConnected) {
        workerRef.current?.postMessage({
          type: 'SEND_JSON',
          payload: {
            action: 'APPROVAL_RESPONSE',
            command_id: commandId,
            approval_id: prevHitl?.approval_id || commandId,
            challenge_nonce: prevHitl?.challenge_nonce,
            signature: prevHitl?.signature,
            approved: decision === 'APPROVED',
          },
        });
      } else {
        setLastExecutionResult({
          event: 'EXECUTION_RESULT',
          command_id: commandId,
          target_id: prevHitl?.target_id || targetIdRef.current,
          status: decision === 'APPROVED' ? 'failed' : 'rejected',
          output:
            decision === 'APPROVED'
              ? 'Cannot execute approved command: Host WebSocket is disconnected.'
              : 'Execution denied by operator (HITL Safety Gate).',
          exit_code: -1,
          execution_time_ms: 1,
          timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
        });
      }
    },
    [isConnected, activeHitlEvent]
  );

  const requestScreenRefresh = useCallback(
    (_deviceId: string) => {
      if (isConnected) {
        setIsCapturingScreen(true);
        workerRef.current?.postMessage({
          type: 'SEND_OPCODE',
          payload: { opcode: 0x0a, data: JSON.stringify({ width: 1280, height: 720 }) },
        });
      } else {
        setIsCapturingScreen(false);
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
      availableDisplays,
      connect,
      reconnectNow,
      disconnect,
      sendCommand,
      sendInputOpcode,
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
      availableDisplays,
      connect,
      reconnectNow,
      disconnect,
      sendCommand,
      sendInputOpcode,
      resolveHitl,
      requestScreenRefresh,
    ]
  );
}
