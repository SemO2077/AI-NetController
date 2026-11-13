import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { HostDevice, WolSchedule, WolPacketPayload, LatencyDataPoint, WolPacketTriggerSource } from '../types';
import { loadWolSchedules, saveWolSchedules, generateMagicPacket, resolveScheduleTargets } from '../services/wolService';
import { logStore } from '../store/logStore';
import { wolHistoryStore } from '../store/wolHistoryStore';
import { useUIStore } from '../store/uiStore';
import { triggerHapticFeedback } from '../services/hapticService';

const STORAGE_KEY = 'ai_netcontroller_hosts';
const LEGACY_STORAGE_KEY = 'cst_netcontroller_hosts';

function loadInitialHosts(): HostDevice[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        // Exclude legacy mock hosts so the user starts with a completely clean fleet
        const userHosts = parsed.filter(
          (h: any) =>
            !['CST-LAB-PC-1', 'HOME-WORKSTATION', 'CST-FIELD-LAPTOP', 'NFS-STORAGE-SERVER', 'TEST-PC-1', 'TEST-WORKSTATION', 'TEST-LAPTOP', 'TEST-SERVER'].includes(h.id)
        );
        return userHosts;
      }
    }
  } catch (e) {
    console.error('Failed to load persisted hosts:', e);
  }
  return [];
}

export function useFleetState() {
  const [hosts, setHosts] = useState<HostDevice[]>(() => loadInitialHosts());
  const [selectedTarget, setSelectedTarget] = useState<string>(hosts[0]?.id || '');

  // Keep selected target in sync when hosts change
  useEffect(() => {
    if (hosts.length > 0 && (!selectedTarget || !hosts.some((h) => h.id === selectedTarget))) {
      setSelectedTarget(hosts[0].id);
    } else if (hosts.length === 0 && selectedTarget !== '') {
      setSelectedTarget('');
    }
  }, [hosts, selectedTarget]);
  const [isScanning, setIsScanning] = useState(false);
  const [wolSchedules, setWolSchedules] = useState<WolSchedule[]>(() => loadWolSchedules());

  // Hydrate WoL schedules from backend scheduler if running behind web control server
  useEffect(() => {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    let cancelled = false;
    fetch('/api/wol/schedules', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.schedules) && data.schedules.length > 0) {
          setWolSchedules(data.schedules);
          saveWolSchedules(data.schedules);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Automatically persist hosts state whenever changed
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hosts));
    } catch (e) {
      console.error('Failed to persist hosts state:', e);
    }
  }, [hosts]);

  const updateHostTelemetry = useCallback((data: any) => {
    if (!data) return;
    const now = Date.now();
    const cutoff = now - 30000;
    const nowLabel = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const reportedIp = typeof data.ip === 'string' ? data.ip : undefined;
    const localIp = typeof data.local_ip === 'string' ? data.local_ip : undefined;
    const reportedOs = typeof data.os === 'string' ? data.os.toLowerCase() : '';
    const normalizedOs = reportedOs.includes('windows')
      ? 'windows'
      : reportedOs.includes('linux')
        ? 'linux'
        : undefined;
    const reportedMac = typeof data.mac === 'string' ? data.mac.toUpperCase() : '';
    const hasRealMac = Boolean(reportedMac && reportedMac !== '00:00:00:00:00:00');
    const reportedDisk =
      typeof data.disk_percent === 'number' && Number.isFinite(data.disk_percent)
        ? `${Math.round(data.disk_percent)}%`
        : typeof data.diskUsage === 'string'
          ? data.diskUsage
          : undefined;

    setHosts((prev) =>
      prev.map((h) => {
        const matchesPort = !data.port || !h.port || Number(h.port) === Number(data.port);
        const matchesWsIp = Boolean(reportedIp && h.ip === reportedIp && matchesPort);
        const matchesLocalIp = Boolean(localIp && h.ip === localIp && matchesPort);
        const matchesHostname = Boolean(data.hostname && h.id === data.hostname && matchesPort);
        const matchesTarget = Boolean(
          data.targetId &&
            h.id === data.targetId &&
            (!reportedIp || h.ip === reportedIp || !localIp || h.ip === localIp)
        );
        if (matchesTarget || matchesWsIp || matchesLocalIp || matchesHostname) {
          const newPing = typeof data.ping === 'number' && Number.isFinite(data.ping) ? data.ping : h.ping;
          const prevHistory = (h.latencyHistory || []).filter((p) => p.timestamp >= cutoff);
          const updatedHistory: LatencyDataPoint[] =
            typeof newPing === 'number'
              ? [...prevHistory.slice(-19), { timestamp: now, latency: newPing }]
              : prevHistory;
          const hasPlaceholderName =
            !h.name ||
            h.name === h.id ||
            h.name.startsWith('PC-') ||
            h.name.startsWith('Host PC') ||
            h.name.startsWith('AI-AGENT-');
          const resolvedName =
            hasPlaceholderName && typeof data.hostname === 'string' && data.hostname.trim()
              ? data.hostname.trim()
              : h.name;
          const resolvedMac =
            hasRealMac && (!h.mac || h.mac === '00:00:00:00:00:00' || h.mac === '00:00:00:00:00')
              ? reportedMac
              : h.mac;

          return {
            ...h,
            name: resolvedName,
            mac: resolvedMac,
            os: normalizedOs ?? h.os,
            isOnline: true,
            lastSeen: nowLabel,
            cpuUsage: data.cpu_percent ?? h.cpuUsage,
            ramUsage: data.ram_percent ?? h.ramUsage,
            diskUsage: reportedDisk ?? h.diskUsage,
            ping: newPing,
            latencyHistory: updatedHistory,
            specStatus: data.cpu_percent !== undefined ? 'READY' : h.specStatus,
          };
        }
        return h;
      })
    );
  }, []);

  const markHostUnreachable = useCallback((targetId: string, reason: string) => {
    setHosts((prev) =>
      prev.map((h) => (h.id === targetId ? { ...h, isOnline: false } : h))
    );
    if (useUIStore.getState().isSystemStateAlerts) {
      logStore.addLog('SYSTEM_MDNS', targetId, 'error', `Хостът е недостъпен: ${reason}`);
    }
  }, []);

  const scanMdns = useCallback(async () => {
    triggerHapticFeedback('light');
    setIsScanning(true);
    logStore.addLog('SYSTEM_MDNS', 'NETWORK', 'info', 'Сканиране за mDNS услуги и локални LAN устройства...');

    try {
      const res = await fetch('/api/hosts/scan', { method: 'POST', credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.hosts && Array.isArray(data.hosts) && data.hosts.length > 0) {
          setHosts((prev) => {
            const isValidUniqueMac = (mac: string) => {
              const upper = mac.trim().toUpperCase();
              return Boolean(upper) && upper !== '00:00:00:00:00:00' && upper !== 'FF:FF:FF:FF:FF:FF';
            };
            const discoveredByIp = new Map<string, any>();
            const discoveredByMac = new Map<string, any>();
            data.hosts.forEach((dh: any) => {
              if (dh.ip) discoveredByIp.set(dh.ip, dh);
              if (dh.mac && isValidUniqueMac(String(dh.mac))) {
                discoveredByMac.set(String(dh.mac).toUpperCase(), dh);
              }
            });

            const existingIps = new Set(prev.map((h) => h.ip));
            const existingMacs = new Set(
              prev.map((h) => (h.mac || '').toUpperCase()).filter(isValidUniqueMac)
            );
            const updatedPrev = prev.map((h) => {
              const hMacUpper = (h.mac || '').toUpperCase();
              const match =
                discoveredByIp.get(h.ip) ||
                (isValidUniqueMac(hMacUpper) ? discoveredByMac.get(hMacUpper) : undefined);
              if (!match) return h;
              const measuredPing = typeof match.ping === 'number' ? match.ping : h.ping;
              const nextMac = isValidUniqueMac(String(match.mac || '')) ? match.mac : h.mac;
              return {
                ...h,
                isOnline: true,
                name: h.name || match.name,
                mac: nextMac,
                ping: measuredPing,
                lastSeen: 'Active (LAN scan)',
              };
            });

            const newDiscovered: HostDevice[] = [];
            data.hosts.forEach((dh: any) => {
              const macUpper = String(dh.mac || '').toUpperCase();
              const validMac = isValidUniqueMac(macUpper);
              if (!existingIps.has(dh.ip) && (!validMac || !existingMacs.has(macUpper))) {
                newDiscovered.push({
                  id: dh.id,
                  name: dh.name,
                  ip: dh.ip,
                  mac: dh.mac,
                  os: dh.os || 'windows',
                  tags: ['LAN', 'Discovered'],
                  isOnline: true,
                  ping: typeof dh.ping === 'number' ? dh.ping : undefined,
                  latencyHistory: [],
                  lastSeen: 'Discovered on LAN',
                  cpuUsage: 0,
                  ramUsage: 0,
                  persistentInstructions: [],
                  sessionInstructions: [],
                });
              }
            });

            if (newDiscovered.length > 0 && useUIStore.getState().isSystemStateAlerts) {
              logStore.addLog('SYSTEM_MDNS', 'NETWORK', 'success', `Открити ${newDiscovered.length} нови устройства на подмрежата!`);
            }
            return [...updatedPrev, ...newDiscovered];
          });
        }
        if (useUIStore.getState().isSystemStateAlerts) {
          logStore.addLog('SYSTEM_MDNS', 'NETWORK', 'success', `Сканирането завърши успешно.`);
        }
      } else {
        logStore.addLog('SYSTEM_MDNS', 'NETWORK', 'warn', `Сканирането на мрежата върна статус HTTP ${res.status}.`);
      }
    } catch (err) {
      console.warn('Network scan API error, fallback to mDNS discovery', err);
      logStore.addLog('SYSTEM_MDNS', 'NETWORK', 'warn', 'Грешка при сканиране на локалната подмрежа.');
    } finally {
      setIsScanning(false);
      triggerHapticFeedback('medium');
    }
  }, []);

  const sendWolPacket = useCallback(
    async (
      payload: WolPacketPayload,
      deviceId: string,
      source: WolPacketTriggerSource = 'manual',
      customDeviceName?: string,
      skipConfirm: boolean = false
    ): Promise<boolean> => {
      const matchedHost = hosts.find(
        (h) => h.id === deviceId || h.mac?.toUpperCase() === payload.mac?.toUpperCase()
      );
      const resolvedDeviceName =
        customDeviceName ||
        matchedHost?.name ||
        (deviceId && deviceId !== 'CUSTOM' && deviceId !== 'CUSTOM-MAC'
          ? deviceId
          : `Custom NIC (${payload.mac})`);

      if (
        source === 'manual' &&
        !skipConfirm &&
        useUIStore.getState().isCommandConfirmations &&
        typeof window !== 'undefined' &&
        typeof window.confirm === 'function'
      ) {
        const lang = useUIStore.getState().language;
        const confirmed = window.confirm(
          lang === 'bg'
            ? `Потвърдете изпращане на Wake-on-LAN (Magic Packet) към ${resolvedDeviceName} (${payload.mac})?`
            : `Confirm sending Wake-on-LAN (Magic Packet) to ${resolvedDeviceName} (${payload.mac})?`
        );
        if (!confirmed) {
          return false;
        }
      }

      triggerHapticFeedback('heavy');
      const bcast = payload.broadcastIp || '255.255.255.255';
      const port = payload.port || 9;
      const bytesCount = payload.bytesCount || 102;
      const cleanMac = String(payload.mac || '').replace(/[^a-fA-F0-9]/g, '');

      const startTime = Date.now();
      let dispatchSucceeded = true;
      let failureMessage = '';

      if (cleanMac.length !== 12) {
        dispatchSucceeded = false;
        failureMessage = 'Invalid MAC address (expected 12 hex characters)';
      } else {
        try {
          if (typeof window !== 'undefined' && (window as any).AndroidBridge?.sendWolUdp) {
            const ok = (window as any).AndroidBridge.sendWolUdp(payload.mac, bcast, port);
            if (!ok) {
              dispatchSucceeded = false;
              failureMessage = 'Android native UDP socket broadcast failed';
            }
          } else {
            const res = await fetch('/api/wol', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mac: payload.mac,
                broadcastIp: bcast,
                port,
                ...(payload.secureOn ? { secureOn: payload.secureOn } : {}),
              }),
            });
            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              dispatchSucceeded = false;
              failureMessage = errData.error || `HTTP ${res.status} UDP socket rejection`;
            }
          }
        } catch (err: any) {
          console.error('Real WoL dispatch error:', err);
          dispatchSucceeded = false;
          failureMessage = err?.message || 'UDP broadcast socket unreachable';
        }
      }

      if (dispatchSucceeded) {
        logStore.addLog(
          'WOL_ENGINE',
          deviceId,
          'packet',
          `Изпратен Magic Packet (${bytesCount} байта) към ${resolvedDeviceName} (${payload.mac})`
        );
      }

      const latencyMs = Math.max(1, Date.now() - startTime);

      if (dispatchSucceeded) {
        wolHistoryStore.addEntry({
          deviceId: matchedHost?.id || deviceId || 'CUSTOM-MAC',
          deviceName: resolvedDeviceName,
          mac: payload.mac,
          broadcastIp: bcast,
          port,
          bytesCount,
          status: 'success',
          source,
          latencyMs,
          details: `UDP ${bytesCount}-byte Magic Packet broadcast delivered to ${bcast}:${port} (${latencyMs}ms).`,
          detailsBg: `Изпратен ${bytesCount}-байтов UDP Magic Packet към ${bcast}:${port} (${latencyMs}ms).`,
        });

        // Mark host as waking until telemetry confirms online state
        setHosts((prev) =>
          prev.map((h) =>
            h.id === deviceId || h.mac?.toUpperCase() === payload.mac?.toUpperCase()
              ? {
                  ...h,
                  lastSeen: 'Magic Packet sent (Waking...)',
                }
              : h
          )
        );
      } else {
        wolHistoryStore.addEntry({
          deviceId: matchedHost?.id || deviceId || 'CUSTOM-MAC',
          deviceName: resolvedDeviceName,
          mac: payload.mac,
          broadcastIp: bcast,
          port,
          bytesCount,
          status: 'failed',
          source,
          latencyMs,
          details: `Dispatch failed on ${bcast}:${port} — ${failureMessage}`,
          detailsBg: `Неуспешно изпращане към ${bcast}:${port} — ${failureMessage}`,
        });
        logStore.addLog(
          'WOL_ENGINE',
          deviceId,
          'error',
          `Грешка при изпращане на Magic Packet към ${resolvedDeviceName}: ${failureMessage}`
        );
      }

      return dispatchSucceeded;
    },
    [hosts]
  );

  const triggerSchedule = useCallback(
    (scheduleId: string) => {
      const sched = wolSchedules.find((s) => s.id === scheduleId);
      if (!sched) return;
      const targets = resolveScheduleTargets(sched, hosts);
      targets.forEach((t) => {
        try {
          const p = generateMagicPacket(t.mac, sched.broadcastIp, sched.port);
          sendWolPacket(p, t.id, 'schedule', t.name);
        } catch (err: any) {
          wolHistoryStore.addEntry({
            deviceId: t.id,
            deviceName: t.name,
            mac: t.mac,
            broadcastIp: sched.broadcastIp,
            port: sched.port,
            bytesCount: 102,
            status: 'failed',
            source: 'schedule',
            details: `Schedule "${sched.name}" failed: ${err?.message || 'Invalid target MAC address'}`,
            detailsBg: `Графикът „${sched.name}“ се провали: ${err?.message || 'Невалиден MAC адрес'}`,
          });
        }
      });
    },
    [hosts, sendWolPacket, wolSchedules]
  );

  const updateHostInstructions = useCallback((hostId: string, type: 'persistent' | 'session', instructions: string[]) => {
    setHosts((prev) =>
      prev.map((h) =>
        h.id === hostId
          ? {
              ...h,
              [type === 'persistent' ? 'persistentInstructions' : 'sessionInstructions']: instructions,
            }
          : h
      )
    );
  }, []);

  const addCustomHost = useCallback((newHost: HostDevice) => {
    setHosts((prev) => {
      const existsIdx = prev.findIndex((h) => h.id === newHost.id);
      if (existsIdx !== -1) {
        const copy = [...prev];
        copy[existsIdx] = { ...prev[existsIdx], ...newHost };
        return copy;
      }
      return [newHost, ...prev];
    });
    setSelectedTarget(newHost.id);
    logStore.addLog('SYSTEM_MDNS', newHost.id, 'success', `Добавен нов хост към флота: ${newHost.name} (${newHost.ip})`);
  }, []);

  const editHost = useCallback((updatedHost: HostDevice, previousId?: string) => {
    const matchId = previousId || updatedHost.id;
    setHosts((prev) =>
      prev.map((h) => (h.id === matchId ? { ...h, ...updatedHost } : h))
    );
    setSelectedTarget((prevTarget) => (prevTarget === matchId ? updatedHost.id : prevTarget));
    logStore.addLog('SYSTEM_MDNS', updatedHost.id, 'info', `Обновена конфигурация на хост: ${updatedHost.name} (${updatedHost.ip})`);
  }, []);

  const deleteHost = useCallback((hostId: string) => {
    setHosts((prev) => prev.filter((h) => h.id !== hostId));
    logStore.addLog('SYSTEM_MDNS', hostId, 'warn', `Хост ${hostId} беше премахнат от флота.`);
  }, []);

  const lastTriggeredScheduleRef = useRef<Map<string, string>>(new Map());

  const updateSchedules = useCallback(
    (s: WolSchedule[]) => {
      setWolSchedules(s);
      saveWolSchedules(s);
      if (typeof window !== 'undefined' && typeof fetch === 'function') {
        const enriched = s.map((sched) => {
          const targets = resolveScheduleTargets(sched, hosts);
          return {
            ...sched,
            targetMacs: targets.map((t) => ({ id: t.id, name: t.name, mac: t.mac })),
          };
        });
        fetch('/api/wol/schedules', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ schedules: enriched }),
        }).catch(() => {});
      }
    },
    [hosts]
  );

  useEffect(() => {
    const checkSchedules = () => {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
      const dayToken = dayNames[now.getDay()];
      const dateKey = `${now.toDateString()}-${hhmm}`;

      for (const sched of wolSchedules) {
        if (!sched.enabled) continue;
        if (sched.time !== hhmm) continue;
        const days = sched.days || [];
        const matchesDay = days.length === 0 || days.includes(dayToken);
        if (!matchesDay) continue;
        if (lastTriggeredScheduleRef.current.get(sched.id) === dateKey) continue;
        lastTriggeredScheduleRef.current.set(sched.id, dateKey);
        triggerSchedule(sched.id);
      }
    };
    const timer = setInterval(checkSchedules, 20000);
    return () => clearInterval(timer);
  }, [wolSchedules, triggerSchedule]);

  const activeWolSchedulesCount = useMemo(
    () => wolSchedules.filter((s) => s.enabled).length,
    [wolSchedules]
  );

  return useMemo(
    () => ({
      hosts,
      selectedTarget,
      setSelectedTarget,
      isScanning,
      wolSchedules,
      activeWolSchedulesCount,
      updateHostTelemetry,
      markHostUnreachable,
      scanMdns,
      sendWolPacket,
      triggerSchedule,
      updateSchedules,
      updateHostInstructions,
      addCustomHost,
      editHost,
      deleteHost,
    }),
    [
      hosts,
      selectedTarget,
      isScanning,
      wolSchedules,
      activeWolSchedulesCount,
      updateHostTelemetry,
      markHostUnreachable,
      scanMdns,
      sendWolPacket,
      triggerSchedule,
      updateSchedules,
      updateHostInstructions,
      addCustomHost,
      editHost,
      deleteHost,
    ]
  );
}
