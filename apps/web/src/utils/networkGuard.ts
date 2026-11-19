/**
 * SSRF Guard for Host Agent WebSocket & TCP Connections.
 *
 * Allows only direct loopback or RFC 1918 / IPv6 ULA LAN addresses so
 * operator-supplied or paired host metadata can never pivot Express requests
 * to cloud metadata endpoints (169.254.169.254), multicast, or external hosts.
 */

export type LanHostValidationResult =
  | { ok: true; host: string; wsHost: string }
  | { ok: false; error: string };

function isStrictIpv4LanOrLoopback(candidate: string): boolean {
  const parts = candidate.split('.');
  if (parts.length !== 4) return false;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    const val = Number(part);
    if (!Number.isInteger(val) || val < 0 || val > 255) return false;
    nums.push(val);
  }
  const [a, b, c, d] = nums;
  if (a === 127 && b === 0 && c === 0 && d === 1) return true; // Loopback 127.0.0.1
  if (a === 10) return true; // RFC 1918 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918 172.16.0.0/12
  if (a === 192 && b === 168) return true; // RFC 1918 192.168.0.0/16
  return false;
}

function parseIpv6Hextets(candidate: string): number[] | null {
  if (!candidate || !/^[0-9a-f:]+$/i.test(candidate)) return null;
  if (candidate.includes(':::')) return null;

  const halves = candidate.split('::');
  if (halves.length > 2) return null;

  if (halves.length === 1) {
    const groups = halves[0].split(':');
    if (groups.length !== 8) return null;
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  }

  const [leftRaw, rightRaw] = halves;
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  if (left.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  if (right.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;

  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;

  const out: number[] = [];
  for (const g of left) out.push(parseInt(g, 16));
  for (let i = 0; i < missing; i++) out.push(0);
  for (const g of right) out.push(parseInt(g, 16));
  return out;
}

function isAllowedIpv6LanOrLoopback(candidate: string): boolean {
  const hextets = parseIpv6Hextets(candidate);
  if (!hextets) return false;
  // Check ::1 loopback
  const isLoopback =
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0 &&
    hextets[6] === 0 &&
    hextets[7] === 1;
  if (isLoopback) return true;

  // Check IPv6 Unique Local Address (fc00::/7 -> top 7 bits == 1111110)
  return (hextets[0] & 0xfe00) === 0xfc00;
}

export function validateLanAgentHost(rawHost: string): LanHostValidationResult {
  const trimmed = String(rawHost ?? '').trim();
  if (!trimmed) {
    return { ok: true, host: '127.0.0.1', wsHost: '127.0.0.1' };
  }

  if (trimmed.length > 64 || /[\s@/\\?#%]/.test(trimmed) || /[^\x21-\x7e]/.test(trimmed)) {
    return { ok: false, error: 'Invalid target agent host format (SSRF protection)' };
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'localhost') {
    return { ok: true, host: '127.0.0.1', wsHost: '127.0.0.1' };
  }

  let candidate = lower;
  let hadBrackets = false;
  if (candidate.startsWith('[') || candidate.endsWith(']')) {
    if (!(candidate.startsWith('[') && candidate.endsWith(']'))) {
      return { ok: false, error: 'Malformed bracketed IPv6 host address' };
    }
    candidate = candidate.slice(1, -1);
    hadBrackets = true;
  }

  if (candidate.startsWith('::ffff:')) {
    const mappedV4 = candidate.slice(7);
    if (isStrictIpv4LanOrLoopback(mappedV4)) {
      return { ok: true, host: mappedV4, wsHost: mappedV4 };
    }
    return { ok: false, error: `Rejected non-LAN target IPv4-mapped address: ${trimmed}` };
  }

  if (!hadBrackets && isStrictIpv4LanOrLoopback(candidate)) {
    return { ok: true, host: candidate, wsHost: candidate };
  }

  if (isAllowedIpv6LanOrLoopback(candidate)) {
    return { ok: true, host: candidate, wsHost: `[${candidate}]` };
  }

  return {
    ok: false,
    error: `Target agent host "${trimmed}" is outside permitted LAN/loopback ranges`,
  };
}
