import { useSyncExternalStore } from 'react';
import { LogEntry } from '../types';

class LogStore {
  private logs: LogEntry[] = [];

  private listeners: Set<() => void> = new Set();

  public getLogs = (): LogEntry[] => this.logs;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public addLog(
    sender: LogEntry['sender'],
    targetId: string,
    type: LogEntry['type'],
    message: string,
    payload?: unknown
  ) {
    const langLocale =
      typeof localStorage !== 'undefined' && localStorage.getItem('wakeflow_language') === 'bg'
        ? 'bg-BG'
        : 'en-GB';
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString(langLocale, { hour12: false }),
      sender,
      targetId,
      type,
      message,
      payload,
    };
    // Maintain maximum 300 logs in memory ring
    this.logs = [entry, ...this.logs.slice(0, 299)];
    this.notify();
  }

  public clearLogs() {
    this.logs = [];
    this.notify();
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}

export const logStore = new LogStore();

export function useLogs(): LogEntry[] {
  return useSyncExternalStore(logStore.subscribe, logStore.getLogs);
}
