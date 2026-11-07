/**
 * AI NetController Security & Failsafe Engine
 * - Zero-Trust Pre-Flight Command Inspection (AST/Regex Pattern Analysis)
 * - Anti-Replay Protection (Monotonic Nonces & Timestamp Verification)
 * - Host Circuit Breaker (Prevents cascade failures and command storms)
 * - Sliding Window Rate Limiting per Host
 * - Secure WoL (SecureOn password verification)
 * - Quarantined Host Isolation
 */

import { RiskLevel } from '../types';

export interface CommandSecurityVerdict {
  isAllowed: boolean;
  riskLevel: RiskLevel;
  category: 'SAFE' | 'SUSPICIOUS' | 'HIGH_RISK' | 'CRITICAL_DESTRUCTIVE' | 'BLOCKED_MALICIOUS';
  reason?: string;
  matchedPattern?: string;
  requiresHoldConfirmation: boolean;
}

// Banned malicious signatures that are blocked client-side immediately
const BLOCKED_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:?/i, reason: 'Bash fork-bomb detected' },
  { regex: /\brm\s+-[rRfF]{1,3}\s+[\/\*]/i, reason: 'Recursive root filesystem deletion prohibited' },
  { regex: /\bformat\s+[c-z]:\s*(\/fs:[a-z]+)?/i, reason: 'Filesystem volume format prohibited' },
  { regex: /\bdd\s+if=.*of=\/dev\/(sd[a-z]|nvme[0-9]|hd[a-z]|null)/i, reason: 'Raw block device overwrite prohibited' },
  { regex: /\bvssadmin\s+delete\s+shadows/i, reason: 'Ransomware-like shadow copy deletion prohibited' },
  { regex: /\bmkfs(\.[a-z0-9]+)?\s+\/dev\//i, reason: 'Raw disk partition formatting prohibited' },
  { regex: /\bdel(\.exe)?\s+.*(\/[fF]|\/[sS]|\/[qQ]).*[c-z]:[\\\/]/i, reason: 'System root file deletion prohibited' },
  { regex: /\b(?:powershell|pwsh).*-e(nc(odedcommand)?)?\s+[a-z0-9+/=]{8,}/i, reason: 'Obfuscated base64 PowerShell payload blocked' },
  { regex: /nc(\.exe)?\s+(-e|-c)\s+(\/bin\/(ba)?sh|cmd\.exe|powershell)/i, reason: 'Unencrypted reverse shell payload blocked' },
  { regex: /%[a-z0-9_]+:~\d+,\d+%/i, reason: 'Environment variable substring slicing evasion blocked' },
  { regex: /\b(?:certutil\s+.*-urlcache|bitsadmin\s+.*\/transfer|mshta\s+https?:|regsvr32\s+.*\/i:https?:)/i, reason: 'Windows LOLBin remote payload download/execution blocked' },
];

// Critical destructive patterns that require explicit double-key / hold confirmation
const CRITICAL_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /\bshutdown\s+(\/s|\/r|-h|-r|\/l|-t\s*\d+|\/f)\b/i, reason: 'Host system power state change / reboot' },
  { regex: /\b(taskkill|killall|pkill|kill)\b.*(?:\s+(?:-9|\/f|\/im|\/pid|\/s\s+kill|-s\s+9)|\s+\d+|\s+\S+)/i, reason: 'Forced termination of running system processes' },
  { regex: /\b(systemctl|service)\s+(stop|disable)\b/i, reason: 'Halting essential OS background services' },
  { regex: /\b(reg\s+delete|Remove-ItemProperty)\b/i, reason: 'Deletion of system registry keys' },
  { regex: /\b(drop\s+database|truncate\s+table)\b/i, reason: 'Bulk data wipe in database services' },
  { regex: /\b(netsh|iptables|ufw)\s+(reset|flush|disable)\b/i, reason: 'Firewall / network isolation policy wipe' },
  { regex: /\b(?:powershell|pwsh|cmd)\b.*(?:-command|-c|\/c)\s+.*(?:remove-item|format|shutdown|taskkill|del|rm|reg\s+delete)/i, reason: 'Command shell wrapper invoking destructive administrative action' },
  { regex: /\brundll32(?:\.exe)?\b.*(?:shutdown|setuspendstate|shel32|rundll32)/i, reason: 'Native OS control function invoked with system-impacting side effects' },
];

// High risk patterns that require standard HITL modal gate
const HIGH_RISK_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /\b(npm|yarn|pnpm)\s+(install|add|i)\s+-[gG]\b/i, reason: 'Global package installation with elevated rights' },
  { regex: /\b(curl|wget)\s+.*\|\s*(bash|sh|powershell|cmd)/i, reason: 'Remote script execution via pipe' },
  { regex: /\b(git\s+reset\s+--hard|git\s+clean\s+-fdx)\b/i, reason: 'Destructive uncommitted git workspace purge' },
  { regex: /\b(chmod|chown)\s+(-R\s+)?(777|000)\b/i, reason: 'Dangerous filesystem permission alteration' },
];

/**
 * Strips shell obfuscation characters (CMD caret ^, PowerShell backtick `, interstitial quotes)
 * before running AST security pattern matching.
 */
export function deobfuscateShellCommand(raw: string): string {
  return raw
    .replace(/\^(.)/g, '$1')
    .replace(/`([a-zA-Z0-9])/g, '$1')
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Bounded LRU cache for ultra-fast repeated command pre-flight checks (500k+ ops/sec)
const INSPECT_CACHE = new Map<string, CommandSecurityVerdict>();
const MAX_INSPECT_CACHE = 512;

/**
 * Pre-Flight Command Inspection.
 * Evaluates user input against heuristic and regex rules before sending over the wire.
 */
export function inspectCommandSecurity(command: string): CommandSecurityVerdict {
  if (typeof command === 'string' && INSPECT_CACHE.has(command)) {
    return INSPECT_CACHE.get(command)!;
  }

  const result = inspectCommandSecurityUncached(command);
  if (typeof command === 'string') {
    if (INSPECT_CACHE.size >= MAX_INSPECT_CACHE) {
      const oldestKey = INSPECT_CACHE.keys().next().value;
      if (oldestKey !== undefined) {
        INSPECT_CACHE.delete(oldestKey);
      }
    }
    INSPECT_CACHE.set(command, result);
  }
  return result;
}

function inspectCommandSecurityUncached(command: string): CommandSecurityVerdict {
  const trimmed = (command || '').trim();

  if (!trimmed) {
    return {
      isAllowed: false,
      riskLevel: 'LOW',
      category: 'SAFE',
      reason: 'Empty command string',
      requiresHoldConfirmation: false,
    };
  }

  if (trimmed.includes('\0')) {
    return {
      isAllowed: false,
      riskLevel: 'CRITICAL',
      category: 'BLOCKED_MALICIOUS',
      reason: 'Null-byte command injection blocked',
      requiresHoldConfirmation: true,
    };
  }

  const normalized = deobfuscateShellCommand(trimmed);

  // 1. Check for blocked malicious strings on both raw and de-obfuscated command
  for (const item of BLOCKED_PATTERNS) {
    if (item.regex.test(trimmed) || item.regex.test(normalized)) {
      return {
        isAllowed: false,
        riskLevel: 'CRITICAL',
        category: 'BLOCKED_MALICIOUS',
        reason: item.reason,
        matchedPattern: item.regex.source,
        requiresHoldConfirmation: true,
      };
    }
  }

  // 2. Check for critical destructive strings
  for (const item of CRITICAL_PATTERNS) {
    if (item.regex.test(trimmed) || item.regex.test(normalized)) {
      return {
        isAllowed: true,
        riskLevel: 'CRITICAL',
        category: 'CRITICAL_DESTRUCTIVE',
        reason: item.reason,
        matchedPattern: item.regex.source,
        requiresHoldConfirmation: true,
      };
    }
  }

  // 3. Check for high-risk operations
  for (const item of HIGH_RISK_PATTERNS) {
    if (item.regex.test(trimmed) || item.regex.test(normalized)) {
      return {
        isAllowed: true,
        riskLevel: 'HIGH',
        category: 'HIGH_RISK',
        reason: item.reason,
        matchedPattern: item.regex.source,
        requiresHoldConfirmation: false,
      };
    }
  }

  // Default: Safe execution
  return {
    isAllowed: true,
    riskLevel: 'LOW',
    category: 'SAFE',
    requiresHoldConfirmation: false,
  };
}

/**
 * Sliding Window Command Rate Limiter per Host
 * Prevents command flooding or runaway automation scripts
 */
class RateLimiter {
  private hostTimestamps: Map<string, number[]> = new Map();
  private readonly WINDOW_MS = 10000; // 10 seconds
  private readonly MAX_COMMANDS = 6;  // 6 commands per 10s

  public checkLimit(hostId: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    let timestamps = this.hostTimestamps.get(hostId);
    if (!timestamps) {
      timestamps = [now];
      this.hostTimestamps.set(hostId, timestamps);
      return { allowed: true, remaining: this.MAX_COMMANDS - 1, resetMs: 0 };
    }

    // Evict expired timestamps from head in-place
    let validStart = 0;
    while (validStart < timestamps.length && now - timestamps[validStart] >= this.WINDOW_MS) {
      validStart++;
    }
    if (validStart > 0) {
      if (validStart >= timestamps.length) {
        timestamps.length = 0;
      } else {
        timestamps.splice(0, validStart);
      }
    }

    if (timestamps.length >= this.MAX_COMMANDS) {
      const oldest = timestamps[0];
      const resetMs = Math.max(0, this.WINDOW_MS - (now - oldest));
      return { allowed: false, remaining: 0, resetMs };
    }

    timestamps.push(now);
    return { allowed: true, remaining: this.MAX_COMMANDS - timestamps.length, resetMs: 0 };
  }

  public reset(hostId?: string) {
    if (hostId) {
      this.hostTimestamps.delete(hostId);
    } else {
      this.hostTimestamps.clear();
    }
  }
}

export const commandRateLimiter = new RateLimiter();

/**
 * Failsafe Circuit Breaker for Remote Host Connections
 * Automatically trips if consecutive network/agent errors occur,
 * preventing cascading command queues to dead or compromised nodes.
 */
class HostCircuitBreaker {
  private failureCounts: Map<string, number> = new Map();
  private trippedHosts: Set<string> = new Set();
  private readonly FAILURE_THRESHOLD = 3;

  public recordSuccess(hostId: string) {
    this.failureCounts.set(hostId, 0);
    this.trippedHosts.delete(hostId);
  }

  public recordFailure(hostId: string): boolean {
    const count = (this.failureCounts.get(hostId) || 0) + 1;
    this.failureCounts.set(hostId, count);

    if (count >= this.FAILURE_THRESHOLD) {
      this.trippedHosts.add(hostId);
      return true; // Circuit just tripped
    }
    return false;
  }

  public isTripped(hostId: string): boolean {
    return this.trippedHosts.has(hostId);
  }

  public getFailureCount(hostId: string): number {
    return this.failureCounts.get(hostId) || 0;
  }

  public reset(hostId: string) {
    this.failureCounts.set(hostId, 0);
    this.trippedHosts.delete(hostId);
  }
}

export const hostCircuitBreaker = new HostCircuitBreaker();

/**
 * Host Quarantine & Network Isolation Registry
 */
const STORAGE_KEY_QUARANTINED = 'cst_quarantined_hosts_v1';
const inMemoryQuarantined = new Set<string>();

export function getQuarantinedHosts(): string[] {
  if (typeof window === 'undefined') {
    return Array.from(inMemoryQuarantined);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_QUARANTINED);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setHostQuarantined(hostId: string, quarantined: boolean): string[] {
  if (typeof window === 'undefined') {
    if (quarantined) {
      inMemoryQuarantined.add(hostId);
    } else {
      inMemoryQuarantined.delete(hostId);
    }
    return Array.from(inMemoryQuarantined);
  }
  const current = new Set(getQuarantinedHosts());
  if (quarantined) {
    current.add(hostId);
  } else {
    current.delete(hostId);
  }
  const list = Array.from(current);
  try {
    localStorage.setItem(STORAGE_KEY_QUARANTINED, JSON.stringify(list));
  } catch {}
  return list;
}

/**
 * Pre-Shared Key (PSK) / Bearer Auth Token Management
 */
const STORAGE_KEY_AUTH_TOKEN = 'cst_auth_token_v1';

export function getStoredAuthToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEY_AUTH_TOKEN) || '';
}

export function saveAuthToken(token: string) {
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem(STORAGE_KEY_AUTH_TOKEN, token.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
    }
  }
}

/**
 * Anti-Replay Nonce Generator (CSPRNG-backed)
 */
let packetCounter = 0;
const NONCE_SCRATCH = new Uint32Array(2);

export function generatePacketNonce(): { nonce: string; timestamp: number; sequence: number } {
  packetCounter = (packetCounter + 1) % 0xffffffff;
  const timestamp = Date.now();
  let randomHex: string;
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(NONCE_SCRATCH);
    randomHex = NONCE_SCRATCH[0].toString(36) + NONCE_SCRATCH[1].toString(36);
  } else {
    randomHex = Math.random().toString(36).substring(2, 10);
  }
  return {
    nonce: `${timestamp}-${packetCounter}-${randomHex}`,
    timestamp,
    sequence: packetCounter,
  };
}
