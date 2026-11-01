import { useState, useCallback, useEffect, useMemo } from 'react';
import { HostDevice, WolSchedule, WolPacketPayload, LatencyDataPoint, WolPacketTriggerSource } from '../types';
import { loadWolSchedules, saveWolSchedules, generateMagicPacket, resolveScheduleTargets } from '../services/wolService';
import { logStore } from '../store/logStore';
import { wolHistoryStore } from '../store/wolHistoryStore';
import { triggerHapticFeedback } from '../services/hapticService';

const STORAGE_KEY = 'cst_netcontroller_hosts';

function loadInitialHosts(): HostDevice[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
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
    setHosts((prev) =>
      prev.map((h) => {
        if (h.id === data.hostname || h.ip === data.ip || (data.targetId && h.id === data.targetId)) {
          const newPing = typeof data.ping === 'number' ? data.ping : (h.ping ?? 4);
          const prevHistory = (h.latencyHistory || []).filter((p) => p.timestamp >= cutoff);
          const updatedHistory: LatencyDataPoint[] = [
            ...prevHistory.slice(-19),
            { timestamp: now, latency: newPing },
          ];

          return {
            ...h,
            isOnline: true,
            cpuUsage: data.cpu_percent ?? h.cpuUsage,
            ramUsage: data.ram_percent ?? h.ramUsage,
            ping: newPing,
            latencyHistory: updatedHistory,
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
    logStore.addLog('SYSTEM_MDNS', targetId, 'error', `Хостът е недостъпен: ${reason}`);
  }, []);

  const scanMdns = useCallback(async () => {
    triggerHapticFeedback('light');
    setIsScanning(true);
    logStore.addLog('SYSTEM_MDNS', 'NETWORK', 'info', 'Сканиране за mDNS услуги и локални LAN устройства...');

    try {
      const res = await fetch('/api/hosts/scan', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.hosts && Array.isArray(data.hosts) && data.hosts.length > 0) {
          setHosts((prev) => {
            const existingIps = new Set(prev.map((h) => h.ip));
            const existingMacs = new Set(prev.map((h) => h.mac.toUpperCase()));
            const newDiscovered: HostDevice[] = [];

            data.hosts.forEach((dh: any) => {
              if (!existingIps.has(dh.ip) && !existingMacs.has(dh.mac.toUpperCase())) {
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

            if (newDiscovered.length > 0) {
              logStore.addLog('SYSTEM_MDNS', 'NETWORK', 'success', `Открити ${newDiscovered.length} нови устройства на подмрежата!`);
              return [...prev, ...newDiscovered];
            }
            return prev;
          });
        }
        logStore.addLog('SYSTEM_MDNS', 'NETWORK', 'success', `Сканирането завърши успешно.`);
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
      customDeviceName?: string
    ) => {
      triggerHapticFeedback('heavy');
      const matchedHost = hosts.find((h) => h.id === deviceId || h.mac?.toUpperCase() === payload.mac?.toUpperCase());
      const resolvedDeviceName =
        customDeviceName ||
        matchedHost?.name ||
        (deviceId && deviceId !== 'CUSTOM' && deviceId !== 'CUSTOM-MAC'
          ? deviceId
          : `Custom NIC (${payload.mac})`);
      const bcast = payload.broadcastIp || '255.255.255.255';
      const port = payload.port || 9;
      const bytesCount = payload.bytesCount || 102;
      const cleanMac = String(payload.mac || '').replace(/[^a-fA-F0-9]/g, '');

      logStore.addLog(
        'WOL_ENGINE',
        deviceId,
        'packet',
        `Изпратен Magic Packet (${bytesCount} байта) към ${resolvedDeviceName} (${payload.mac})`
      );

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
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mac: payload.mac,
                broadcastIp: bcast,
                port,
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
    setHosts((prev) => {
      const next = prev.filter((h) => h.id !== hostId);
      setSelectedTarget((prevTarget) =>
        prevTarget === hostId ? (next[0]?.id || '') : prevTarget
      );
      return next;
    });
    logStore.addLog('SYSTEM_MDNS', hostId, 'warn', `Хост ${hostId} беше премахнат от флота.`);
  }, []);

  const updateSchedules = useCallback((s: WolSchedule[]) => {
    setWolSchedules(s);
    saveWolSchedules(s);
  }, []);

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
