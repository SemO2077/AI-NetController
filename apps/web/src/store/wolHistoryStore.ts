import { useSyncExternalStore } from 'react';
import {
  WolPacketLogEntry,
  WolPacketLogStatus,
  WolPacketTriggerSource,
} from '../types';

export const STORAGE_KEY_WOL_HISTORY = 'ai_wol_packet_history_v1';
export const LEGACY_STORAGE_KEY_WOL_HISTORY = 'cst_wol_packet_history_v1';

export function formatWolTimestamp(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function createInitialSeedEntries(): WolPacketLogEntry[] {
  return [];
}

export function createTestSeedEntries(): WolPacketLogEntry[] {
  const now = Date.now();
  return [
    {
      id: 'wol-hist-seed-1',
      timestamp: formatWolTimestamp(new Date(now - 3 * 60 * 1000)),
      createdAt: now - 3 * 60 * 1000,
      deviceId: 'TEST-WORKSTATION',
      deviceName: 'TEST-WORKSTATION',
      mac: '00:2B:67:89:AB:CD',
      broadcastIp: '192.168.1.255',
      port: 9,
      bytesCount: 102,
      status: 'success',
      source: 'manual',
      latencyMs: 3,
      details: 'UDP 102-byte Magic Packet broadcast dispatched and NIC wake ACK verified on subnet 192.168.1.255:9.',
      detailsBg: 'Изпратен 102-байтов UDP Magic Packet и потвърдено събуждане на мрежовата карта на 192.168.1.255:9.',
    },
    {
      id: 'wol-hist-seed-2',
      timestamp: formatWolTimestamp(new Date(now - 18 * 60 * 1000)),
      createdAt: now - 18 * 60 * 1000,
      deviceId: 'LEGACY-LAB-NODE-08',
      deviceName: 'LEGACY-LAB-NODE-08',
      mac: 'D4:5D:64:A1:C9:02',
      broadcastIp: '10.20.4.255',
      port: 9,
      bytesCount: 102,
      status: 'failed',
      source: 'manual',
      latencyMs: 42,
      details: 'EHOSTUNREACH: Cross-VLAN directed broadcast blocked by gateway router on 10.20.4.255:9 (No ARP reply after 3 retries).',
      detailsBg: 'EHOSTUNREACH: Насоченото излъчване между VLAN мрежи е блокирано от шлюза на 10.20.4.255:9 (Няма ARP отговор).',
    },
    {
      id: 'wol-hist-seed-3',
      timestamp: formatWolTimestamp(new Date(now - 45 * 60 * 1000)),
      createdAt: now - 45 * 60 * 1000,
      deviceId: 'TEST-PC-1',
      deviceName: 'TEST-PC-1',
      mac: '00:1A:2B:3C:4D:5E',
      broadcastIp: '192.168.1.255',
      port: 9,
      bytesCount: 102,
      status: 'success',
      source: 'schedule',
      latencyMs: 2,
      details: 'Scheduled morning lab wake-up ("Wake Lab PCs 08:00") executed cleanly via UDP port 9.',
      detailsBg: 'Планираното сутрешно събуждане („Събуждане на залата 08:00“) е изпълнено успешно през UDP порт 9.',
    },
    {
      id: 'wol-hist-seed-4',
      timestamp: formatWolTimestamp(new Date(now - 2 * 3600 * 1000)),
      createdAt: now - 2 * 3600 * 1000,
      deviceId: 'TEST-LAPTOP',
      deviceName: 'TEST-LAPTOP',
      mac: '00:3C:4D:5E:6F:70',
      broadcastIp: '255.255.255.255',
      port: 7,
      bytesCount: 102,
      status: 'failed',
      source: 'batch',
      latencyMs: 19,
      details: 'ENETUNREACH: Wireless interface wlan0 does not support WoWLAN Magic Packet in deep S5 power-off state.',
      detailsBg: 'ENETUNREACH: Безжичният адаптер wlan0 не поддържа WoWLAN Magic Packet при пълно изключване (S5).',
    },
    {
      id: 'wol-hist-seed-5',
      timestamp: formatWolTimestamp(new Date(now - 5 * 3600 * 1000)),
      createdAt: now - 5 * 3600 * 1000,
      deviceId: 'TEST-SERVER',
      deviceName: 'TEST-SERVER',
      mac: '00:0C:29:8B:D1:4F',
      broadcastIp: '192.168.1.255',
      port: 9,
      bytesCount: 108,
      status: 'success',
      source: 'ai',
      latencyMs: 1,
      details: 'AI Fleet Commander dispatched 108-byte SecureOn Magic Packet; host transitioned to READY in 6.4s.',
      detailsBg: 'AI Fleet Commander изпрати 108-байтов SecureOn Magic Packet; хостът премина в режим READY за 6.4 сек.',
    },
  ];
}

class WolHistoryStore {
  private entries: WolPacketLogEntry[] = [];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.entries = this.loadFromStorage();
  }

  private loadFromStorage(): WolPacketLogEntry[] {
    if (typeof window === 'undefined') {
      return createInitialSeedEntries();
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY_WOL_HISTORY) || localStorage.getItem(LEGACY_STORAGE_KEY_WOL_HISTORY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [];
    } catch {
      return [];
    }
  }

  private saveToStorage(entries: WolPacketLogEntry[]): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_WOL_HISTORY, JSON.stringify(entries));
    } catch (e) {
      console.error('Failed to persist WoL packet history:', e);
    }
  }

  public getEntries = (): WolPacketLogEntry[] => this.entries;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public addEntry(params: {
    deviceId: string;
    deviceName: string;
    mac: string;
    broadcastIp?: string;
    port?: number;
    bytesCount?: number;
    status: WolPacketLogStatus;
    source?: WolPacketTriggerSource;
    latencyMs?: number;
    details?: string;
    detailsBg?: string;
  }): WolPacketLogEntry {
    const now = new Date();
    const isSuccess = params.status === 'success';
    const bcast = params.broadcastIp || '255.255.255.255';
    const port = params.port || 9;
    const bytesCount = params.bytesCount || 102;

    const entry: WolPacketLogEntry = {
      id: `wol-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: formatWolTimestamp(now),
      createdAt: now.getTime(),
      deviceId: params.deviceId || 'CUSTOM-HOST',
      deviceName: params.deviceName || params.deviceId || 'Custom Target Host',
      mac: (params.mac || '00:00:00:00:00:00').toUpperCase(),
      broadcastIp: bcast,
      port,
      bytesCount,
      status: params.status,
      source: params.source || 'manual',
      latencyMs: params.latencyMs,
      details:
        params.details ||
        (isSuccess
          ? `UDP ${bytesCount}-byte Magic Packet broadcast dispatched to ${bcast}:${port}.`
          : `Failed to deliver UDP Magic Packet to ${bcast}:${port}.`),
      detailsBg:
        params.detailsBg ||
        (isSuccess
          ? `Изпратен ${bytesCount}-байтов UDP Magic Packet към ${bcast}:${port}.`
          : `Неуспешно изпращане на UDP Magic Packet към ${bcast}:${port}.`),
    };

    this.entries = [entry, ...this.entries.slice(0, 199)];
    this.saveToStorage(this.entries);
    this.notify();
    return entry;
  }

  public removeEntry(id: string): void {
    this.entries = this.entries.filter((item) => item.id !== id);
    this.saveToStorage(this.entries);
    this.notify();
  }

  public clearHistory(): void {
    this.entries = [];
    this.saveToStorage(this.entries);
    this.notify();
  }

  public resetToDefaultHistory(): void {
    const seed = createInitialSeedEntries();
    this.entries = seed;
    this.saveToStorage(seed);
    this.notify();
  }

  public seedTestEntries(): void {
    this.entries = createTestSeedEntries();
    this.saveToStorage(this.entries);
    this.notify();
  }

  public resetToDefaults(): void {
    this.resetToDefaultHistory();
  }

  public getStats(): {
    total: number;
    successCount: number;
    failedCount: number;
    successRate: number;
  } {
    const total = this.entries.length;
    const successCount = this.entries.filter((e) => e.status === 'success').length;
    const failedCount = total - successCount;
    const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;
    return { total, successCount, failedCount, successRate };
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const wolHistoryStore = new WolHistoryStore();

export function useWolHistory(): WolPacketLogEntry[] {
  return useSyncExternalStore(wolHistoryStore.subscribe, wolHistoryStore.getEntries);
}
