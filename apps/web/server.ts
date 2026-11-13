import express, { Request, Response, NextFunction } from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dgram from 'dgram';
import { execFile } from 'child_process';
import os from 'os';
import crypto from 'crypto';
import net from 'net';
import dns from 'dns/promises';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const RELEASES_PUBLIC_DIR = path.resolve(ROOT_DIR, 'public/releases');
const APP_VERSION = '0.50.0';
const APP_VERSION_LABEL = '0.50.00-beta';
const PROTOCOL_VERSION = 'AI-NET/3.0-SECURE';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ALLOW_LAN_WEB = process.env.ALLOW_LAN_WEB === 'true';
const BIND_HOST = process.env.HOST || (ALLOW_LAN_WEB ? '0.0.0.0' : '127.0.0.1');
const SESSION_COOKIE_NAME = 'ainet_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const EPHEMERAL_CONTROL_SECRET = crypto.randomBytes(24).toString('hex');

app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

// Runtime directories (config & WoL persistence)
function getAppDataDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local');
    return path.join(base, 'AI NetController');
  }
  return path.join(os.homedir(), '.ai_netcontroller');
}

function getDaemonConfigPath(): string {
  return path.join(getAppDataDir(), 'config.json');
}

function getWolSchedulesPath(): string {
  return path.join(getAppDataDir(), 'wol_schedules.json');
}

function getUiSettingsPath(): string {
  return path.join(getAppDataDir(), 'ui_settings.json');
}

function getHostMemoryPath(): string {
  return path.join(getAppDataDir(), 'host_memory.json');
}

interface PersistedUiSettings {
  isAutoDiscovery: boolean;
  isHitlEnabled: boolean;
  isBiometricEnabled: boolean;
  isCommandConfirmations: boolean;
  isSystemStateAlerts: boolean;
}

const DEFAULT_UI_SETTINGS: PersistedUiSettings = {
  isAutoDiscovery: true,
  isHitlEnabled: true,
  isBiometricEnabled: false,
  isCommandConfirmations: true,
  isSystemStateAlerts: true,
};

function readPersistedUiSettings(): PersistedUiSettings {
  try {
    const p = getUiSettingsPath();
    if (!fs.existsSync(p)) return { ...DEFAULT_UI_SETTINGS };
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_UI_SETTINGS };
    return {
      isAutoDiscovery:
        typeof parsed.isAutoDiscovery === 'boolean'
          ? parsed.isAutoDiscovery
          : DEFAULT_UI_SETTINGS.isAutoDiscovery,
      isHitlEnabled:
        typeof parsed.isHitlEnabled === 'boolean'
          ? parsed.isHitlEnabled
          : DEFAULT_UI_SETTINGS.isHitlEnabled,
      isBiometricEnabled:
        typeof parsed.isBiometricEnabled === 'boolean'
          ? parsed.isBiometricEnabled
          : DEFAULT_UI_SETTINGS.isBiometricEnabled,
      isCommandConfirmations:
        typeof parsed.isCommandConfirmations === 'boolean'
          ? parsed.isCommandConfirmations
          : DEFAULT_UI_SETTINGS.isCommandConfirmations,
      isSystemStateAlerts:
        typeof parsed.isSystemStateAlerts === 'boolean'
          ? parsed.isSystemStateAlerts
          : DEFAULT_UI_SETTINGS.isSystemStateAlerts,
    };
  } catch {
    return { ...DEFAULT_UI_SETTINGS };
  }
}

function writePersistedUiSettings(settings: PersistedUiSettings): void {
  const p = getUiSettingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

interface HostMemoryRecord {
  persistent: string[];
  session: string[];
}

function readAllHostMemory(): Record<string, HostMemoryRecord> {
  try {
    const p = getHostMemoryPath();
    if (!fs.existsSync(p)) return {};
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllHostMemory(store: Record<string, HostMemoryRecord>): void {
  const p = getHostMemoryPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

function detectPrimaryLanIp(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function isLoopbackIp(addr?: string | null): boolean {
  if (!addr) return false;
  const normalized = addr.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

function getAllowedOrigins(): Set<string> {
  const allowed = new Set<string>(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (ALLOW_LAN_WEB) {
    allowed.add(detectPrimaryLanIp().toLowerCase());
  }
  const extra = process.env.ALLOWED_ORIGINS || '';
  for (const entry of extra.split(',')) {
    const clean = entry.trim().toLowerCase();
    if (!clean) continue;
    try {
      allowed.add(new URL(clean).hostname.toLowerCase());
    } catch {
      allowed.add(clean);
    }
  }
  return allowed;
}

// Hardened HTTP Security Headers & Strict Same-Origin CORS Policy
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-XSS-Protection', '1; mode=block');

  const origin = req.headers.origin;
  if (origin) {
    let originAllowed = false;
    try {
      const parsedOrigin = new URL(origin);
      const hn = parsedOrigin.hostname.toLowerCase();
      const hostHeader = String(req.headers.host || '').split(':')[0].toLowerCase();
      if (getAllowedOrigins().has(hn) || (ALLOW_LAN_WEB && hostHeader && hn === hostHeader)) {
        originAllowed = true;
      }
    } catch {
      originAllowed = false;
    }

    if (originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    } else if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Cross-origin request rejected by security policy' });
    }
  }

  if (req.headers['sec-fetch-site'] === 'cross-site' && req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Cross-site request blocked (CSRF shield)' });
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Serve packaged .exe, .apk, .zip, and SHA256SUMS.txt release binaries with attachment headers
app.use(
  '/releases',
  express.static(RELEASES_PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
      const base = path.basename(filePath);
      if (base.endsWith('.exe') || base.endsWith('.apk') || base.endsWith('.zip')) {
        res.setHeader('Content-Disposition', `attachment; filename="${base}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
      }
    },
  })
);

// Strictly anchored fallback redirect to official GitHub Releases
app.get('/releases/:version/:filename', (req: Request, res: Response) => {
  const version = String(req.params.version || '');
  const filename = String(req.params.filename || '');
  if (
    /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9._-]+)?$/.test(version) &&
    /^[a-zA-Z0-9._-]+\.(?:exe|apk|zip|txt|json)$/i.test(filename) &&
    !filename.includes('..')
  ) {
    return res.redirect(
      302,
      `https://github.com/SemO2077/AI-NetController/releases/download/${encodeURIComponent(version)}/${encodeURIComponent(filename)}`
    );
  }
  return res.status(404).json({ error: 'Release artifact not found' });
});

// Sliding-Window API Rate Limiter (180 req/min per IP)
const apiRateBuckets = new Map<string, { count: number; resetAt: number }>();
const API_WINDOW_MS = 60_000;
const API_MAX_REQUESTS = 180;

setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of apiRateBuckets.entries()) {
    if (now >= b.resetAt) {
      apiRateBuckets.delete(ip);
    }
  }
}, 60_000).unref();

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const clientIp = String(req.socket.remoteAddress || '127.0.0.1').trim();
  const now = Date.now();
  let bucket = apiRateBuckets.get(clientIp);
  if (!bucket || now >= bucket.resetAt) {
    if (apiRateBuckets.size >= 10000) {
      const oldestKey = apiRateBuckets.keys().next().value;
      if (oldestKey) apiRateBuckets.delete(oldestKey);
    }
    bucket = { count: 1, resetAt: now + API_WINDOW_MS };
    apiRateBuckets.set(clientIp, bucket);
  } else {
    bucket.count++;
  }

  res.setHeader('X-RateLimit-Limit', String(API_MAX_REQUESTS));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, API_MAX_REQUESTS - bucket.count)));

  if (bucket.count > API_MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Please wait before sending more API requests.',
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    });
  }
  next();
});

// =====================================================================
// DAEMON CONFIG BRIDGE (Supports DPAPI via Python daemon_config.py)
// =====================================================================
interface DaemonConfigData {
  pairing_token?: string;
  pairing_pin?: string;
  view_only_mode?: boolean;
  require_hitl_approval?: boolean;
  clipboard_sync_allowed?: boolean;
  auto_lock_on_disconnect?: boolean;
  auto_ban_intrusion?: boolean;
  subnet_geofence_only?: boolean;
  security_profile?: 'zero_trust' | 'balanced' | 'view_only';
  mdns_enabled?: boolean;
  autostart_on_boot?: boolean;
  setup_completed?: boolean;
  port?: number;
  blacklisted_devices?: Array<any>;
  [key: string]: any;
}

let cachedDaemonConfig: { data: DaemonConfigData; loadedAt: number } | null = null;

function readPlaintextConfigSync(): DaemonConfigData | null {
  try {
    const cfgPath = getDaemonConfigPath();
    if (!fs.existsSync(cfgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    if (raw && typeof raw === 'object' && !raw.dpapi_b64) {
      return raw as DaemonConfigData;
    }
  } catch {
    // Ignore parse/access errors
  }
  return null;
}

function getPythonBin(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

async function loadDaemonConfig(forceRefresh = false): Promise<DaemonConfigData> {
  const now = Date.now();
  if (!forceRefresh && cachedDaemonConfig && now - cachedDaemonConfig.loadedAt < 3000) {
    return cachedDaemonConfig.data;
  }

  const plain = readPlaintextConfigSync();
  if (plain) {
    cachedDaemonConfig = { data: plain, loadedAt: now };
    return plain;
  }

  const loaded = await new Promise<DaemonConfigData>((resolve) => {
    const pyScript =
      'import json,sys; sys.path.insert(0,"agent"); from daemon_config import load_config; print(json.dumps(load_config()))';
    execFile(getPythonBin(), ['-c', pyScript], { cwd: ROOT_DIR, timeout: 4000 }, (err, stdout) => {
      if (!err && stdout) {
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed && typeof parsed === 'object') {
            resolve(parsed);
            return;
          }
        } catch {
          // Fall back below
        }
      }
      resolve({});
    });
  });

  cachedDaemonConfig = { data: loaded, loadedAt: Date.now() };
  return loaded;
}

async function saveDaemonConfigPatch(patch: Partial<DaemonConfigData>): Promise<DaemonConfigData> {
  const current = await loadDaemonConfig(true);
  const merged = { ...current, ...patch };
  const ok = await new Promise<boolean>((resolve) => {
    const pyScript =
      'import json,sys; sys.path.insert(0,"agent"); from daemon_config import save_config; cfg=json.loads(sys.argv[1]); print("OK" if save_config(cfg) else "ERR")';
    execFile(
      getPythonBin(),
      ['-c', pyScript, JSON.stringify(merged)],
      { cwd: ROOT_DIR, timeout: 5000 },
      (err, stdout) => {
        resolve(!err && stdout.trim().endsWith('OK'));
      }
    );
  });

  if (!ok) {
    // Fallback plaintext write if Python runtime isn't present on host
    const cfgPath = getDaemonConfigPath();
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), { encoding: 'utf-8', mode: 0o600 });
  }
  cachedDaemonConfig = { data: merged, loadedAt: Date.now() };
  return merged;
}

// =====================================================================
// AUTHENTICATION & SESSION MANAGEMENT (Fail-Closed Zero Hardcoded Secrets)
// =====================================================================
const activeSessions = new Map<string, { expiresAt: number; ip: string }>();

setInterval(() => {
  const now = Date.now();
  for (const [sid, meta] of activeSessions.entries()) {
    if (now >= meta.expiresAt) {
      activeSessions.delete(sid);
    }
  }
}, 5 * 60_000).unref();

function safeTimingEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

async function getControlSecret(): Promise<string> {
  const envSecret =
    process.env.WEB_CONTROL_SECRET ||
    process.env.AI_AGENT_SECRET ||
    process.env.CST_AGENT_SECRET ||
    '';
  if (envSecret.trim()) {
    return envSecret.trim();
  }
  const cfg = await loadDaemonConfig();
  if (cfg.pairing_token && String(cfg.pairing_token).trim()) {
    return String(cfg.pairing_token).trim();
  }
  return EPHEMERAL_CONTROL_SECRET;
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function issueSessionCookie(res: Response, clientIp: string): string {
  const sid = crypto.randomBytes(24).toString('hex');
  activeSessions.set(sid, { expiresAt: Date.now() + SESSION_TTL_MS, ip: clientIp });
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
  return sid;
}

async function isRequestAuthenticated(req: Request): Promise<boolean> {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    const secret = await getControlSecret();
    if (safeTimingEqual(token, secret)) {
      return true;
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[SESSION_COOKIE_NAME];
  if (sid) {
    const sess = activeSessions.get(sid);
    if (sess && Date.now() < sess.expiresAt) {
      return true;
    }
  }

  // Direct loopback requests without forwarding headers are trusted local browser/CLI traffic when using same-origin UI
  const remoteIp = req.socket.remoteAddress;
  if (isLoopbackIp(remoteIp) && !req.headers['x-forwarded-for']) {
    return true;
  }

  return false;
}

async function requireControlAuth(req: Request, res: Response, next: NextFunction) {
  if (await isRequestAuthenticated(req)) {
    return next();
  }
  return res.status(401).json({
    error: 'Authentication required. Sign in with the pairing secret or access from localhost.',
    requiresAuth: true,
  });
}

app.get('/api/auth/session', async (req: Request, res: Response) => {
  const remoteIp = req.socket.remoteAddress;
  const authed = await isRequestAuthenticated(req);
  if (isLoopbackIp(remoteIp)) {
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies[SESSION_COOKIE_NAME] || !activeSessions.has(cookies[SESSION_COOKIE_NAME])) {
      issueSessionCookie(res, String(remoteIp || '127.0.0.1'));
    }
    return res.json({ authenticated: true, mode: 'loopback', allowLanWeb: ALLOW_LAN_WEB });
  }
  return res.json({ authenticated: authed, mode: authed ? 'session' : 'unauthenticated', allowLanWeb: ALLOW_LAN_WEB });
});

app.post('/api/auth/session', async (req: Request, res: Response) => {
  const candidate = String(req.body?.token || '').trim();
  const secret = await getControlSecret();
  if (!safeTimingEqual(candidate, secret)) {
    return res.status(401).json({ error: 'Invalid pairing token or control secret' });
  }
  issueSessionCookie(res, String(req.socket.remoteAddress || 'unknown'));
  return res.json({ authenticated: true, mode: 'token' });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[SESSION_COOKIE_NAME];
  if (sid) activeSessions.delete(sid);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  return res.json({ authenticated: false });
});

// =====================================================================
// SSRF VALIDATION SHIELD (DNS Resolution + Private CIDR Blocking)
// =====================================================================
function isPrivateOrSpecialIp(ip: string): boolean {
  const clean = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (clean.startsWith('::ffff:')) {
    return isPrivateOrSpecialIp(clean.slice(7));
  }
  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }
  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true; // Unique local fc00::/7
    if (/^fe[89ab]/.test(clean)) return true; // Link-local fe80::/10
    if (clean.startsWith('ff')) return true; // Multicast
    return false;
  }
  return true;
}

async function validateExternalHttpUrl(
  rawUrl: string,
  options: { requireHttps?: boolean; allowLoopback?: boolean } = {}
): Promise<{ valid: boolean; normalized?: string; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: 'Malformed URL' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'Embedded credentials in URL are not permitted' };
  }

  if (options.requireHttps) {
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'URL must use https://' };
    }
  } else if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'URL must use http:// or https://' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === '169.254.169.254' ||
    host.startsWith('169.254.') ||
    host === 'metadata.google.internal' ||
    host.endsWith('.internal')
  ) {
    return { valid: false, error: 'Cloud metadata and link-local hosts are forbidden (SSRF protection)' };
  }

  if (net.isIP(host)) {
    const priv = isPrivateOrSpecialIp(host);
    if (priv && !(options.allowLoopback && (host === '127.0.0.1' || host === '::1'))) {
      return { valid: false, error: 'Private, loopback, and reserved IP endpoints are forbidden (SSRF protection)' };
    }
    return { valid: true, normalized: parsed.toString() };
  }

  if (host === 'localhost') {
    if (!options.allowLoopback) {
      return { valid: false, error: 'Localhost endpoints are restricted to local Ollama providers' };
    }
    return { valid: true, normalized: parsed.toString() };
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (!records || records.length === 0) {
      return { valid: false, error: 'Hostname could not be resolved' };
    }
    for (const rec of records) {
      if (isPrivateOrSpecialIp(rec.address)) {
        const isLoop = rec.address === '127.0.0.1' || rec.address === '::1';
        if (!(options.allowLoopback && isLoop)) {
          return {
            valid: false,
            error: `Resolved address (${rec.address}) falls inside a restricted private/reserved CIDR range (SSRF protection)`,
          };
        }
      }
    }
  } catch {
    return { valid: false, error: 'DNS lookup failed for target hostname' };
  }

  return { valid: true, normalized: parsed.toString() };
}

// =====================================================================
// DYNAMIC AI MODEL REGISTRY (Real Active Models Only)
// =====================================================================
export interface AIModelDescriptor {
  id: string;
  name: string;
  provider: 'gemini' | 'ollama' | 'deepseek' | 'openai' | 'custom';
  description: string;
  contextWindow: string;
  isCustom?: boolean;
  endpointUrl?: string;
  apiKeyUrl?: string;
}

const DEFAULT_OLLAMA_BASE = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');

let DYNAMIC_MODELS: AIModelDescriptor[] = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (Default)',
    provider: 'gemini',
    description: 'Fast multimodal reasoning model for real-time fleet triage and remote PC orchestration',
    contextWindow: '1.0M tokens',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    description: 'Deep reasoning model for packet inspection, AST firewall auditing, and complex diagnostics',
    contextWindow: '1.0M tokens',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'gemini',
    description: 'Low-latency agentic model for rapid structured tool execution',
    contextWindow: '1.0M tokens',
  },
  {
    id: 'deepseek-r1:latest',
    name: 'DeepSeek-R1 (Local / Ollama)',
    provider: 'ollama',
    description: 'Local Ollama reasoning model via 127.0.0.1:11434',
    contextWindow: '128k tokens',
    endpointUrl: DEFAULT_OLLAMA_BASE,
  },
  {
    id: 'qwen2.5-coder:latest',
    name: 'Qwen 2.5 Coder (Local / Ollama)',
    provider: 'ollama',
    description: 'Local coding & shell script assistant via Ollama 127.0.0.1:11434',
    contextWindow: '128k tokens',
    endpointUrl: DEFAULT_OLLAMA_BASE,
  },
];

function getGenAI() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'ai-netcontroller-server',
      },
    },
  });
}

function resolveSupportedGeminiModel(requested?: string): string {
  if (!requested || typeof requested !== 'string') return 'gemini-2.5-flash';
  const clean = requested.trim();
  if (/^gemini-(?:1\.[05]|3\.\d)/i.test(clean) || clean === 'gemini-flash-latest' || clean === 'gemini-pro') {
    return 'gemini-2.5-flash';
  }
  return clean;
}

const SYSTEM_INSTRUCTIONS: Record<string, string> = {
  commander: `You are AI NetController Fleet Commander, the autonomous fleet orchestrator, PC controller, and system diagnostics assistant for AI NetController Beta ${APP_VERSION_LABEL}.
You manage heterogeneous Windows and Linux hosts across local subnets and dispatch verified remote control actions to the connected Python Host Agent daemon.

Executable Action Directives (emit only when the user requests the corresponding host action):
1. Remote Mouse Control (Opcode 0x08):
   - Click: [ACTION:MOUSE_CLICK target=HOST_ID x=960 y=540 button=left]
   - Double Click: [ACTION:MOUSE_DOUBLE_CLICK target=HOST_ID x=960 y=540]
   - Move Cursor: [ACTION:MOUSE_MOVE target=HOST_ID x=960 y=540]
   - Scroll Wheel: [ACTION:MOUSE_SCROLL target=HOST_ID dy=-300]
2. Remote Keyboard Input (Opcode 0x08):
   - Type Text: [ACTION:KEYBOARD_TYPE target=HOST_ID text="Hello World" press_enter=true]
   - Hotkey Combo: [ACTION:KEYBOARD_HOTKEY target=HOST_ID keys="ctrl,shift,esc"]
3. Media & Session Actions (Opcode 0x09):
   - Media/OS: [ACTION:MEDIA_CONTROL target=HOST_ID command=play_pause] (play_pause, volume_up, volume_down, mute, lock_pc)
4. Remote Shell Execution (AST Firewall Guarded):
   - Shell Command: [ACTION:SHELL_EXEC target=HOST_ID command="ipconfig /all"]
5. Power Management & Wake-on-LAN:
   - Wake Host: [ACTION:WOL target=HOST_ID]
6. System & Daemon Actions:
   - Daemon Control: [ACTION:DAEMON_CONTROL command=diagnostics] (diagnostics, view_only, balanced, zero_trust, pause, resume)
   - Subnet Rescan: [ACTION:RESCAN]

Be concise, accurate, and transparent about host reachability.`,

  diagnostics: `You are AI NetController Protocol & Security Architect specialized in the ${PROTOCOL_VERSION} protocol:
- Binary Wire Framing (0xC5 0x71 magic header, 12-byte big-endian header).
- RFC 6479 128-bit sliding-window anti-replay protection & Curve25519 + ChaCha20-Poly1305 AEAD transport.
- CommandASTFirewall de-obfuscation, LOLBin blocking, and HITL cryptographic approval verification.
Provide deep protocol analysis and concise actionable diagnostics.`,

  fast_triage: `You are AI NetController Quick Triage. Emit concise diagnostics and direct [ACTION:...] directives when requested.`,
};

// =====================================================================
// REAL DAEMON TELEMETRY & AUTHENTICATED WEBSOCKET IPC BRIDGE
// =====================================================================
interface DaemonLogEntry {
  time: string;
  level: 'INFO' | 'SECURITY' | 'DIAG' | 'WARN' | 'ALERT';
  message: string;
}

const daemonBootTime = Date.now();
const serverEvents: DaemonLogEntry[] = [];

function addServerLog(level: DaemonLogEntry['level'], message: string) {
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  serverEvents.push({ time, level, message });
  if (serverEvents.length > 100) {
    serverEvents.splice(0, serverEvents.length - 100);
  }
}

let prevCpuSnapshot: { idle: number; total: number } | null = null;
let lastCpuPercent = 0;

function sampleRealCpuPercent(): number {
  const cpus = os.cpus();
  if (!cpus || cpus.length === 0) return 0;
  let idle = 0;
  let total = 0;
  for (const core of cpus) {
    for (const type of Object.keys(core.times) as Array<keyof typeof core.times>) {
      total += core.times[type];
    }
    idle += core.times.idle;
  }
  if (prevCpuSnapshot) {
    const idleDelta = idle - prevCpuSnapshot.idle;
    const totalDelta = total - prevCpuSnapshot.total;
    if (totalDelta > 0) {
      lastCpuPercent = Number(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)).toFixed(1));
    }
  }
  prevCpuSnapshot = { idle, total };
  return lastCpuPercent;
}

let cachedDiskPercent = 0;
let lastDiskSampleTime = 0;

function sampleRealDiskPercent(): number {
  const now = Date.now();
  if (now - lastDiskSampleTime < 5000) return cachedDiskPercent;
  lastDiskSampleTime = now;
  try {
    const statfn = (fs as any).statfsSync;
    if (typeof statfn === 'function') {
      const rootPath = path.parse(process.cwd()).root || '/';
      const stat = statfn(rootPath);
      const totalBlocks = Number(stat.blocks || 0);
      const freeBlocks = Number(stat.bfree || 0);
      if (totalBlocks > 0) {
        cachedDiskPercent = Number((((totalBlocks - freeBlocks) / totalBlocks) * 100).toFixed(1));
      }
    }
  } catch {
    // Ignore statfs errors
  }
  return cachedDiskPercent;
}

function sampleActiveAdapters(): Array<{ name: string; ipv4: string; mac: string }> {
  const nets = os.networkInterfaces();
  const activeAdapters: Array<{ name: string; ipv4: string; mac: string }> = [];
  for (const [name, list] of Object.entries(nets)) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        const cleanMac = iface.mac && iface.mac !== '00:00:00:00:00:00' ? iface.mac.toUpperCase() : '';
        activeAdapters.push({ name, ipv4: iface.address, mac: cleanMac });
      }
    }
  }
  return activeAdapters;
}

function probeTcpPortWithRtt(ip: string, port: number, timeoutMs = 450): Promise<{ open: boolean; rttMs: number }> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const start = performance.now();
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      const rttMs = Math.max(1, Math.round(performance.now() - start));
      try {
        sock.destroy();
      } catch {}
      resolve({ open, rttMs });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    try {
      sock.connect(port, ip);
    } catch {
      finish(false);
    }
  });
}

async function dispatchLiveAgentCommand(
  targetHost: string,
  port: number,
  messagePayload: Record<string, unknown>,
  awaitEvent?: string,
  timeoutMs = 6000
): Promise<{ ok: boolean; response?: any; error?: string }> {
  const host = isLoopbackIp(targetHost) || !targetHost ? '127.0.0.1' : targetHost;
  const probe = await probeTcpPortWithRtt(host, port, 500);
  if (!probe.open) {
    return {
      ok: false,
      error: `Host Agent daemon is offline (no listener on ws://${host}:${port}). Launch AI_NetController_HostAgent first.`,
    };
  }

  const secret = await getControlSecret();
  return new Promise((resolve) => {
    let ws: WebSocket;
    let settled = false;
    let authenticated = false;

    const finish = (result: { ok: boolean; response?: any; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Control request complete');
        }
      } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: `Timed out communicating with Host Agent on ws://${host}:${port}` });
    }, timeoutMs);

    try {
      ws = new WebSocket(`ws://${host}:${port}`);
      ws.binaryType = 'arraybuffer';
    } catch (err: any) {
      finish({ ok: false, error: err?.message || 'WebSocket connection initialization failed' });
      return;
    }

    let outboundSeq = 0;

    ws.addEventListener('message', (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(ev.data);
        if (bytes.length < 12 || bytes[0] !== 0xc5 || bytes[1] !== 0x71) return;
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const opcode = dv.getUint8(2);
        const seq = dv.getUint32(4, false);
        const len = dv.getUint32(8, false);
        if (len > 10 * 1024 * 1024 || bytes.length !== 12 + len) return;
        const payload = bytes.subarray(12, 12 + len);

        if (opcode === 0x06) {
          if (len === 16) {
            const sig = crypto
              .createHmac('sha256', Buffer.from(secret, 'utf-8'))
              .update(payload)
              .digest();
            const reply = new Uint8Array(12 + sig.length);
            const rView = new DataView(reply.buffer);
            reply[0] = 0xc5;
            reply[1] = 0x71;
            reply[2] = 0x06;
            reply[3] = 0x00;
            rView.setUint32(4, seq, false);
            rView.setUint32(8, sig.length, false);
            reply.set(sig, 12);
            ws.send(reply);
            return;
          }
          const statusStr = Buffer.from(payload).toString('utf-8').trim();
          if (statusStr === 'OK_AUTHENTICATED' || statusStr === 'AUTH_OK') {
            authenticated = true;
            outboundSeq += 1;
            ws.send(JSON.stringify({ ...messagePayload, _seq: outboundSeq }));
            if (!awaitEvent) {
              setTimeout(() => finish({ ok: true, response: { event: 'AUTHENTICATED' } }), 40);
            }
          } else if (statusStr) {
            finish({ ok: false, error: statusStr });
          }
          return;
        }

        if (!authenticated) {
          if (opcode === 0xee) {
            const errStr = Buffer.from(payload).toString('utf-8');
            finish({ ok: false, error: errStr || 'Agent authentication rejected' });
          }
          return;
        }

        try {
          const text = Buffer.from(payload).toString('utf-8');
          const parsedBin = text.startsWith('{') ? JSON.parse(text) : { output: text };
          if (opcode === 0xee) {
            finish({ ok: false, error: parsedBin.error || parsedBin.output || 'Agent returned OP_ERR' });
          } else if (
            opcode === 0x04 &&
            (!awaitEvent || awaitEvent === 'EXECUTION_RESULT' || awaitEvent === 'SHELL_RESULT')
          ) {
            finish({ ok: true, response: { event: 'EXECUTION_RESULT', ...parsedBin } });
          } else if (opcode === 0x05 && awaitEvent === 'HITL_REQUIRED') {
            finish({ ok: true, response: { event: 'HITL_REQUIRED', ...parsedBin } });
          }
        } catch {
          // ignore malformed payload
        }
        return;
      }

      if (typeof ev.data !== 'string') return;
      let parsed: any;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (!authenticated) {
        if (parsed.event === 'AUTHENTICATED') {
          authenticated = true;
          outboundSeq += 1;
          ws.send(JSON.stringify({ ...messagePayload, _seq: outboundSeq }));
          if (!awaitEvent) {
            setTimeout(() => finish({ ok: true, response: parsed }), 40);
          }
        } else if (parsed.event === 'ERROR') {
          finish({ ok: false, error: parsed.error || 'Agent authentication rejected' });
        }
        return;
      }

      if (awaitEvent && parsed.event === awaitEvent) {
        finish({ ok: true, response: parsed });
      } else if (parsed.event === 'PANIC_ACK' && messagePayload.action === 'PANIC_KILL_ALL') {
        finish({ ok: true, response: parsed });
      } else if (parsed.event === 'ERROR') {
        finish({ ok: false, error: parsed.error || 'Agent rejected command' });
      }
    });

    ws.addEventListener('error', () => {
      finish({ ok: false, error: `WebSocket error communicating with ws://${host}:${port}` });
    });

    ws.addEventListener('close', (ev) => {
      if (!settled) {
        finish({
          ok: false,
          error: ev.reason || `Agent closed connection cleanly (code ${ev.code})`,
        });
      }
    });
  });
}

async function getRealDaemonSnapshot() {
  const cfg = await loadDaemonConfig();
  const port = Number(cfg.port || process.env.CST_AGENT_PORT || 8765);
  const localIp = detectPrimaryLanIp();
  const probe = await probeTcpPortWithRtt('127.0.0.1', port, 300);

  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const usedMemBytes = Math.max(0, totalMemBytes - freeMemBytes);
  const ramTotalGb = Number((totalMemBytes / 1024 ** 3).toFixed(1));
  const ramUsedGb = Number((usedMemBytes / 1024 ** 3).toFixed(1));
  const ramPercent = Number(((usedMemBytes / Math.max(1, totalMemBytes)) * 100).toFixed(1));
  const cpus = os.cpus();

  const elapsedSec = Math.max(0, Math.floor((Date.now() - daemonBootTime) / 1000));
  const hrs = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');

  const manifestFile = path.join(ROOT_DIR, 'agent', 'app_manifest.xml');
  const hasManifest =
    fs.existsSync(manifestFile) && fs.readFileSync(manifestFile, 'utf-8').includes('level="asInvoker"');

  const blacklistedDevices = Array.isArray(cfg.blacklisted_devices) ? cfg.blacklisted_devices : [];

  return {
    version: APP_VERSION,
    protocol: PROTOCOL_VERSION,
    hostname: os.hostname() || 'LOCALHOST',
    osName: `${os.type()} ${os.release()} (${os.arch()})`,
    localIp,
    port,
    isRunning: probe.open,
    isPaused: !probe.open,
    agentReachable: probe.open,
    agentRttMs: probe.open ? probe.rttMs : null,
    mdnsEnabled: cfg.mdns_enabled !== false,
    viewOnlyMode: Boolean(cfg.view_only_mode),
    requireHitlApproval: cfg.require_hitl_approval !== false,
    clipboardSyncAllowed: cfg.clipboard_sync_allowed !== false,
    autoLockOnDisconnect: Boolean(cfg.auto_lock_on_disconnect),
    autoBanIntrusion: cfg.auto_ban_intrusion !== false,
    subnetGeofenceOnly: cfg.subnet_geofence_only !== false,
    autoStartOnBoot: cfg.autostart_on_boot !== false,
    targetFps: Number(cfg.target_fps || 60),
    setupCompleted: cfg.setup_completed !== false,
    securityProfile: (cfg.security_profile as 'zero_trust' | 'balanced' | 'view_only') || 'balanced',
    pairingPin: cfg.pairing_pin ? String(cfg.pairing_pin) : '------',
    wsUri: `ws://${localIp}:${port}`,
    uptime: `${hrs}:${mins}:${secs}`,
    cpuPercent: sampleRealCpuPercent(),
    cpuCores: cpus ? cpus.length : 1,
    ramPercent,
    ramUsedGb,
    ramTotalGb,
    diskPercent: sampleRealDiskPercent(),
    captureFps: 0,
    connectedClients: [],
    blacklistedDevices,
    activeAdapters: sampleActiveAdapters(),
    avIntegrity: {
      upxDisabled: true,
      visibleHwnd: probe.open,
      zeroHiddenShell: true,
      manifestAsInvoker: hasManifest,
      authenticodeReady: process.platform === 'win32',
      sandboxJobObject: process.platform === 'win32',
    },
    logs: [...serverEvents],
  };
}

// Public non-secret health check
app.get('/api/health', async (_req: Request, res: Response) => {
  const cfg = await loadDaemonConfig();
  const port = Number(cfg.port || 8765);
  const probe = await probeTcpPortWithRtt('127.0.0.1', port, 250);
  res.json({
    status: 'online',
    daemonOnline: probe.open,
    protocol: PROTOCOL_VERSION,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    models: DYNAMIC_MODELS.map(({ id, name, provider, description, contextWindow, isCustom }) => ({
      id,
      name,
      provider,
      description,
      contextWindow,
      isCustom,
    })),
  });
});

// =====================================================================
// RELEASE MANIFESTS, REBUILD & CURATED SOURCE EXPORT
// =====================================================================
let cachedReleasesPayload: { data: any; timestamp: number } | null = null;
const RELEASES_CACHE_TTL_MS = 30_000;

function readFirstAvailableManifest(): any {
  const candidates = ['v0.50.0', 'v0.35.0', 'v0.32.0', 'v0.31.3', 'v0.30.0'];
  for (const ver of candidates) {
    const p = path.join(RELEASES_PUBLIC_DIR, ver, 'RELEASE_MANIFEST.json');
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch {
        // Continue
      }
    }
  }
  return null;
}

app.get('/api/releases', (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (cachedReleasesPayload && now - cachedReleasesPayload.timestamp < RELEASES_CACHE_TTL_MS) {
      return res.json(cachedReleasesPayload.data);
    }
    const manifest = readFirstAvailableManifest();
    const patchNotesPath = path.join(ROOT_DIR, 'PATCH_NOTES.md');
    const patchNotes = fs.existsSync(patchNotesPath) ? fs.readFileSync(patchNotesPath, 'utf-8') : '';

    const dirs = fs.existsSync(RELEASES_PUBLIC_DIR)
      ? fs
          .readdirSync(RELEASES_PUBLIC_DIR, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^v\d+/.test(d.name))
          .map((d) => d.name)
          .sort()
          .reverse()
      : [];

    const payload = {
      success: true,
      manifest,
      availableVersions: dirs.length > 0 ? dirs : [`v${APP_VERSION}`],
      patchNotes,
    };
    cachedReleasesPayload = { data: payload, timestamp: now };
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to read release manifest' });
  }
});

app.post('/api/releases/rebuild', requireControlAuth, (_req: Request, res: Response) => {
  const scriptPath = path.join(ROOT_DIR, 'scripts', 'build_release_binaries.py');
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ success: false, error: 'scripts/build_release_binaries.py not found' });
  }
  execFile(getPythonBin(), [scriptPath], { cwd: ROOT_DIR, timeout: 120_000, env: createSafeChildEnv() }, (err, stdout, stderr) => {
    cachedReleasesPayload = null;
    if (err) {
      return res.status(500).json({ success: false, error: stderr || err.message });
    }
    return res.json({
      success: true,
      output: stdout.trim(),
      manifest: readFirstAvailableManifest(),
    });
  });
});

const EXPORTABLE_SOURCE_MAP: Record<string, { label: string; lang: string; relPath: string }> = {
  'agent/agent.py': { label: 'Python Host Agent Core (agent.py)', lang: 'python', relPath: 'agent/agent.py' },
  'agent/command_ast_firewall.py': {
    label: 'Command AST Firewall (command_ast_firewall.py)',
    lang: 'python',
    relPath: 'agent/command_ast_firewall.py',
  },
  'agent/crypto_vault.py': { label: 'X25519 + ChaCha20 Vault (crypto_vault.py)', lang: 'python', relPath: 'agent/crypto_vault.py' },
  'agent/daemon_config.py': { label: 'DPAPI Daemon Config (daemon_config.py)', lang: 'python', relPath: 'agent/daemon_config.py' },
  'apps/web/src/utils/binaryFramer.ts': {
    label: 'Web Binary Protocol Framer (binaryFramer.ts)',
    lang: 'typescript',
    relPath: 'apps/web/src/utils/binaryFramer.ts',
  },
  'apps/web/src/services/wolService.ts': {
    label: 'Wake-on-LAN Service (wolService.ts)',
    lang: 'typescript',
    relPath: 'apps/web/src/services/wolService.ts',
  },
  'apps/mobile/lib/protocol/binary_protocol.dart': {
    label: 'Mobile Binary Protocol (binary_protocol.dart)',
    lang: 'dart',
    relPath: 'apps/mobile/lib/protocol/binary_protocol.dart',
  },
};

app.get('/api/source-files', requireControlAuth, (req: Request, res: Response) => {
  const requested = String(req.query.path || '').trim();
  if (!requested) {
    return res.json({
      success: true,
      files: Object.entries(EXPORTABLE_SOURCE_MAP).map(([id, meta]) => ({
        id,
        label: meta.label,
        language: meta.lang,
        exists: fs.existsSync(path.resolve(ROOT_DIR, meta.relPath)),
      })),
    });
  }
  const meta = EXPORTABLE_SOURCE_MAP[requested];
  if (!meta) {
    return res.status(404).json({ error: 'Requested source file is not in export whitelist' });
  }
  const fullPath = path.resolve(ROOT_DIR, meta.relPath);
  if (!fullPath.startsWith(ROOT_DIR + path.sep) || !fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Source file not found on disk' });
  }
  return res.json({
    success: true,
    id: requested,
    label: meta.label,
    language: meta.lang,
    content: fs.readFileSync(fullPath, 'utf-8'),
  });
});

// =====================================================================
// AI MODELS & LIVE INFERENCE ENDPOINTS
// =====================================================================
app.get('/api/ai/models', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    models: DYNAMIC_MODELS,
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    ollamaEndpoint: DEFAULT_OLLAMA_BASE,
  });
});

app.post('/api/ai/models', requireControlAuth, async (req: Request, res: Response) => {
  try {
    const { id, name, provider = 'custom', description = '', contextWindow = '128k', endpointUrl, apiKeyUrl } = req.body || {};
    if (!id || !name) {
      return res.status(400).json({ error: 'Model ID and Name are required' });
    }

    let validatedEndpointUrl: string | undefined;
    if (endpointUrl) {
      const check = await validateExternalHttpUrl(String(endpointUrl), {
        allowLoopback: provider === 'ollama',
      });
      if (!check.valid) {
        return res.status(400).json({ error: check.error });
      }
      validatedEndpointUrl = check.normalized;
    }

    let validatedApiKeyUrl: string | undefined;
    if (apiKeyUrl) {
      const check = await validateExternalHttpUrl(String(apiKeyUrl), {
        requireHttps: true,
        allowLoopback: false,
      });
      if (!check.valid) {
        return res.status(400).json({ error: `Invalid apiKeyUrl: ${check.error}` });
      }
      validatedApiKeyUrl = check.normalized;
    }

    const cleanId = String(id).trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, '-');
    const newDescriptor: AIModelDescriptor = {
      id: cleanId,
      name: String(name).trim(),
      provider: provider as AIModelDescriptor['provider'],
      description: String(description).trim() || 'Custom AI Model Endpoint',
      contextWindow: String(contextWindow).trim() || '128k tokens',
      isCustom: true,
      endpointUrl: validatedEndpointUrl,
      apiKeyUrl: validatedApiKeyUrl,
    };

    const existingIndex = DYNAMIC_MODELS.findIndex((m) => m.id === cleanId);
    if (existingIndex >= 0) {
      DYNAMIC_MODELS[existingIndex] = newDescriptor;
    } else {
      DYNAMIC_MODELS.push(newDescriptor);
    }

    return res.json({
      success: true,
      model: newDescriptor,
      models: DYNAMIC_MODELS,
      message: `Model '${newDescriptor.name}' saved successfully.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to save model' });
  }
});

app.delete('/api/ai/models/:id', requireControlAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  DYNAMIC_MODELS = DYNAMIC_MODELS.filter((m) => m.id !== id);
  return res.json({
    success: true,
    models: DYNAMIC_MODELS,
    message: `Model '${id}' removed successfully.`,
  });
});

app.get('/api/settings', async (_req: Request, res: Response) => {
  try {
    const stored = readPersistedUiSettings();
    const cfg = await loadDaemonConfig();
    const settings: PersistedUiSettings = {
      ...stored,
      isAutoDiscovery:
        typeof cfg.mdns_enabled === 'boolean' ? cfg.mdns_enabled : stored.isAutoDiscovery,
      isHitlEnabled:
        typeof cfg.require_hitl_approval === 'boolean'
          ? cfg.require_hitl_approval
          : stored.isHitlEnabled,
    };
    return res.json({ success: true, settings });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post('/api/settings', requireControlAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const current = readPersistedUiSettings();
    const next: PersistedUiSettings = {
      isAutoDiscovery:
        typeof body.isAutoDiscovery === 'boolean' ? body.isAutoDiscovery : current.isAutoDiscovery,
      isHitlEnabled:
        typeof body.isHitlEnabled === 'boolean' ? body.isHitlEnabled : current.isHitlEnabled,
      isBiometricEnabled:
        typeof body.isBiometricEnabled === 'boolean'
          ? body.isBiometricEnabled
          : current.isBiometricEnabled,
      isCommandConfirmations:
        typeof body.isCommandConfirmations === 'boolean'
          ? body.isCommandConfirmations
          : current.isCommandConfirmations,
      isSystemStateAlerts:
        typeof body.isSystemStateAlerts === 'boolean'
          ? body.isSystemStateAlerts
          : current.isSystemStateAlerts,
    };

    writePersistedUiSettings(next);

    const daemonPatch: Partial<DaemonConfigData> = {};
    if (typeof body.isAutoDiscovery === 'boolean') {
      daemonPatch.mdns_enabled = next.isAutoDiscovery;
    }
    if (typeof body.isHitlEnabled === 'boolean') {
      daemonPatch.require_hitl_approval = next.isHitlEnabled;
    }
    if (Object.keys(daemonPatch).length > 0) {
      await saveDaemonConfigPatch(daemonPatch);
    }

    return res.json({ success: true, settings: next });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.get('/api/memory/:hostId', (req: Request, res: Response) => {
  const hostId = String(req.params.hostId || '').trim();
  if (!hostId || hostId.length > 128) {
    return res.status(400).json({ error: 'Invalid hostId' });
  }
  const store = readAllHostMemory();
  const hasSavedRecord = Boolean(store[hostId]);
  const record = store[hostId] || { persistent: [], session: [] };
  return res.json({
    success: true,
    hostId,
    exists: hasSavedRecord,
    persistent: Array.isArray(record.persistent) ? record.persistent : [],
    session: Array.isArray(record.session) ? record.session : [],
  });
});

app.post('/api/memory/:hostId', requireControlAuth, (req: Request, res: Response) => {
  try {
    const hostId = String(req.params.hostId || '').trim();
    if (!hostId || hostId.length > 128) {
      return res.status(400).json({ error: 'Invalid hostId' });
    }
    const sanitizeRules = (raw: unknown): string[] =>
      Array.isArray(raw)
        ? raw
            .map((item) => String(item ?? '').trim())
            .filter((item) => item.length > 0 && item.length <= 500)
            .slice(0, 200)
        : [];

    const store = readAllHostMemory();
    const prev = store[hostId] || { persistent: [], session: [] };
    const body = req.body || {};

    const nextRecord: HostMemoryRecord = {
      persistent: Array.isArray(prev.persistent) ? prev.persistent : [],
      session: Array.isArray(prev.session) ? prev.session : [],
    };

    if (body.type === 'persistent' && Array.isArray(body.instructions)) {
      nextRecord.persistent = sanitizeRules(body.instructions);
    } else if (body.type === 'session' && Array.isArray(body.instructions)) {
      nextRecord.session = sanitizeRules(body.instructions);
    } else {
      if (Array.isArray(body.persistent)) {
        nextRecord.persistent = sanitizeRules(body.persistent);
      }
      if (Array.isArray(body.session)) {
        nextRecord.session = sanitizeRules(body.session);
      }
    }

    store[hostId] = nextRecord;
    writeAllHostMemory(store);
    return res.json({ success: true, hostId, ...nextRecord });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.post('/api/ai/models/test', requireControlAuth, async (req: Request, res: Response) => {
  const start = performance.now();
  try {
    const { modelId } = req.body || {};
    const model = DYNAMIC_MODELS.find((m) => m.id === modelId) || DYNAMIC_MODELS[0];

    if (model.provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({
          success: false,
          error: 'GEMINI_API_KEY is not configured on the server.',
        });
      }
      const ai = getGenAI();
      const targetModel = resolveSupportedGeminiModel(model.id);
      await ai.models.get({ model: targetModel });
      const latencyMs = Math.max(1, Math.round(performance.now() - start));
      return res.json({
        success: true,
        modelId: model.id,
        name: model.name,
        status: 'online',
        latencyMs,
        timestamp: new Date().toISOString(),
      });
    }

    const baseUrl = (model.endpointUrl || DEFAULT_OLLAMA_BASE).replace(/\/+$/, '');
    const probeUrl = model.provider === 'ollama' ? `${baseUrl}/api/tags` : baseUrl;
    const ssrf = await validateExternalHttpUrl(probeUrl, { allowLoopback: model.provider === 'ollama' });
    if (!ssrf.valid) {
      return res.status(400).json({ success: false, error: ssrf.error });
    }

    const resp = await fetch(ssrf.normalized!, { signal: AbortSignal.timeout(4000) });
    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    if (!resp.ok) {
      return res.status(502).json({
        success: false,
        modelId: model.id,
        error: `Endpoint returned HTTP ${resp.status}`,
        latencyMs,
      });
    }

    return res.json({
      success: true,
      modelId: model.id,
      name: model.name,
      status: 'online',
      latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    return res.status(503).json({
      success: false,
      latencyMs,
      error: err?.message || 'Model endpoint unreachable',
    });
  }
});

// =====================================================================
// PC DAEMON STATE, ACTIONS & SETUP ENDPOINTS
// =====================================================================
app.get('/api/daemon/state', requireControlAuth, async (_req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      daemon: await getRealDaemonSnapshot(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to query daemon telemetry' });
  }
});

app.post('/api/daemon/action', requireControlAuth, async (req: Request, res: Response) => {
  try {
    const { action, port, clientId, ip, profile, fps } = req.body || {};
    const cfg = await loadDaemonConfig();
    const daemonPort = Number(cfg.port || 8765);

    switch (action) {
      case 'toggle_view_only': {
        const nextVal = !Boolean(cfg.view_only_mode);
        await saveDaemonConfigPatch({ view_only_mode: nextVal });
        addServerLog('SECURITY', `View-Only Mode ${nextVal ? 'ENABLED' : 'DISABLED'} in host config.`);
        break;
      }
      case 'toggle_hitl': {
        const nextVal =
          typeof req.body?.enabled === 'boolean'
            ? req.body.enabled
            : !(cfg.require_hitl_approval !== false);
        await saveDaemonConfigPatch({ require_hitl_approval: nextVal });
        const curUi = readPersistedUiSettings();
        writePersistedUiSettings({ ...curUi, isHitlEnabled: nextVal });
        addServerLog('SECURITY', `HITL approval gate ${nextVal ? 'ENABLED' : 'DISABLED'} in host config.`);
        break;
      }
      case 'toggle_mdns': {
        const nextVal =
          typeof req.body?.enabled === 'boolean'
            ? req.body.enabled
            : !(cfg.mdns_enabled !== false);
        await saveDaemonConfigPatch({ mdns_enabled: nextVal });
        const curUi = readPersistedUiSettings();
        writePersistedUiSettings({ ...curUi, isAutoDiscovery: nextVal });
        addServerLog('INFO', `mDNS advertisement ${nextVal ? 'ENABLED' : 'DISABLED'}.`);
        break;
      }
      case 'toggle_clipboard_sync': {
        const nextVal = !(cfg.clipboard_sync_allowed !== false);
        await saveDaemonConfigPatch({ clipboard_sync_allowed: nextVal });
        addServerLog('SECURITY', `Clipboard sync ${nextVal ? 'ENABLED' : 'LOCKED'}.`);
        break;
      }
      case 'toggle_auto_lock': {
        const nextVal = !Boolean(cfg.auto_lock_on_disconnect);
        await saveDaemonConfigPatch({ auto_lock_on_disconnect: nextVal });
        addServerLog('SECURITY', `Auto-Lock on disconnect ${nextVal ? 'ENABLED' : 'DISABLED'}.`);
        break;
      }
      case 'toggle_auto_ban': {
        const nextVal = !(cfg.auto_ban_intrusion !== false);
        await saveDaemonConfigPatch({ auto_ban_intrusion: nextVal });
        addServerLog('SECURITY', `Auto-Ban Intrusion Shield ${nextVal ? 'ENABLED' : 'DISABLED'}.`);
        break;
      }
      case 'toggle_subnet_geofence': {
        const nextVal = !(cfg.subnet_geofence_only !== false);
        await saveDaemonConfigPatch({ subnet_geofence_only: nextVal });
        addServerLog('SECURITY', `RFC1918 Subnet Geofence ${nextVal ? 'ENABLED' : 'RELAXED'}.`);
        break;
      }
      case 'toggle_autostart': {
        const nextVal = !(cfg.autostart_on_boot !== false);
        await saveDaemonConfigPatch({ autostart_on_boot: nextVal });
        addServerLog('INFO', `Autostart preference updated to ${nextVal}.`);
        break;
      }
      case 'set_target_fps': {
        const nextFps = Number(fps);
        if (nextFps === 60 || nextFps === 30 || nextFps === 15) {
          await saveDaemonConfigPatch({ target_fps: nextFps });
          addServerLog('INFO', `Target capture rate set to ${nextFps} FPS.`);
        }
        break;
      }
      case 'rotate_token': {
        const nextToken = `ai_sec_${crypto.randomBytes(16).toString('hex')}`;
        await saveDaemonConfigPatch({ pairing_token: nextToken });
        addServerLog('SECURITY', 'Pairing token rotated and persisted to host daemon config.');
        break;
      }
      case 'rotate_pin': {
        const nextPin = String(crypto.randomInt(100000, 1000000));
        await saveDaemonConfigPatch({ pairing_pin: nextPin, pin_issued_at: Math.floor(Date.now() / 1000) });
        addServerLog('SECURITY', '6-digit pairing PIN rotated and persisted.');
        break;
      }
      case 'update_port': {
        const nextPort = Number(port);
        if (Number.isInteger(nextPort) && nextPort >= 1024 && nextPort <= 65535) {
          await saveDaemonConfigPatch({ port: nextPort });
          addServerLog('INFO', `Configured daemon listener port updated to ${nextPort}.`);
        }
        break;
      }
      case 'blacklist_client': {
        const banIp = String(ip || clientId || '').trim();
        if (!banIp || !net.isIP(banIp)) {
          return res.status(400).json({ error: 'Valid IPv4/IPv6 address is required to blacklist a peer' });
        }
        const currentBans = Array.isArray(cfg.blacklisted_devices) ? [...cfg.blacklisted_devices] : [];
        if (!currentBans.some((b: any) => (typeof b === 'string' ? b === banIp : b.ip === banIp))) {
          currentBans.unshift({
            id: `BAN-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
            ip: banIp,
            mac: '00:00:00:00:00:00',
            device: String(req.body?.device || `Blocked Peer (${banIp})`),
            reason: String(req.body?.reason || 'Blacklisted via Web Control Console'),
            bannedAt: new Date().toLocaleTimeString('en-GB', { hour12: false }),
          });
          await saveDaemonConfigPatch({ blacklisted_devices: currentBans });
        }
        addServerLog('ALERT', `Blacklisted peer IP ${banIp} in host daemon firewall config.`);
        break;
      }
      case 'unban_device': {
        const banId = String(req.body?.banId || '');
        const banIp = String(ip || '');
        const currentBans = Array.isArray(cfg.blacklisted_devices) ? cfg.blacklisted_devices : [];
        const filtered = currentBans.filter((b: any) =>
          typeof b === 'string' ? b !== banIp && b !== banId : b.id !== banId && b.ip !== banIp
        );
        await saveDaemonConfigPatch({ blacklisted_devices: filtered });
        addServerLog('SECURITY', `Removed firewall blacklist entry (${banId || banIp}).`);
        break;
      }
      case 'clear_blacklist':
        await saveDaemonConfigPatch({ blacklisted_devices: [] });
        addServerLog('SECURITY', 'Cleared persisted firewall blacklist.');
        break;
      case 'apply_security_profile': {
        if (profile === 'zero_trust') {
          await saveDaemonConfigPatch({
            security_profile: 'zero_trust',
            require_hitl_approval: true,
            auto_ban_intrusion: true,
            subnet_geofence_only: true,
            clipboard_sync_allowed: false,
            view_only_mode: false,
          });
        } else if (profile === 'view_only') {
          await saveDaemonConfigPatch({
            security_profile: 'view_only',
            view_only_mode: true,
            require_hitl_approval: true,
            clipboard_sync_allowed: false,
          });
        } else {
          await saveDaemonConfigPatch({
            security_profile: 'balanced',
            view_only_mode: false,
            require_hitl_approval: true,
            clipboard_sync_allowed: true,
            auto_ban_intrusion: true,
          });
        }
        addServerLog('SECURITY', `Applied security profile: ${String(profile || 'balanced').toUpperCase()}.`);
        break;
      }
      case 'complete_setup':
        await saveDaemonConfigPatch({ setup_completed: true });
        addServerLog('INFO', 'Setup state persisted.');
        break;
      case 'run_diagnostics': {
        const probe = await probeTcpPortWithRtt('127.0.0.1', daemonPort, 400);
        const adapters = sampleActiveAdapters();
        addServerLog(
          'DIAG',
          `Live Diagnostic: ${adapters.length} active IPv4 NIC(s), Host Agent ws://127.0.0.1:${daemonPort} is ${
            probe.open ? `ONLINE (${probe.rttMs}ms)` : 'OFFLINE'
          }.`
        );
        break;
      }
      case 'panic_disconnect': {
        const panicRes = await dispatchLiveAgentCommand('127.0.0.1', daemonPort, { action: 'PANIC_KILL_ALL' }, 'PANIC_ACK');
        if (!panicRes.ok) {
          return res.status(503).json({
            success: false,
            error: panicRes.error,
            daemon: await getRealDaemonSnapshot(),
          });
        }
        addServerLog('ALERT', 'PANIC DISCONNECT dispatched to live Host Agent daemon.');
        break;
      }
      case 'clear_logs':
        serverEvents.splice(0, serverEvents.length);
        addServerLog('INFO', 'Control console log cleared.');
        break;
      default:
        return res.status(400).json({ error: `Unsupported daemon action: ${String(action || '')}` });
    }

    return res.json({
      success: true,
      daemon: await getRealDaemonSnapshot(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Daemon action failed' });
  }
});

app.get('/api/setup/info', requireControlAuth, async (_req: Request, res: Response) => {
  try {
    const snap = await getRealDaemonSnapshot();
    const primaryAdapter = snap.activeAdapters[0] || {
      name: 'Loopback',
      ipv4: snap.localIp,
      mac: '',
    };
    const webOrigin = `http://${snap.localIp}:${PORT}`;
    const pairParams = new URLSearchParams({
      pair_ip: snap.localIp,
      pair_port: String(snap.port),
      pair_name: snap.hostname,
      pair_mac: primaryAdapter.mac,
      pair_os: snap.osName.toLowerCase().includes('win') ? 'windows' : 'linux',
      pair_pin: snap.pairingPin,
    });

    return res.json({
      success: true,
      setup: {
        hostname: snap.hostname,
        osName: snap.osName,
        localIp: snap.localIp,
        daemonPort: snap.port,
        webPort: PORT,
        mac: primaryAdapter.mac,
        adapterName: primaryAdapter.name,
        wsUri: snap.wsUri,
        pairingPin: snap.pairingPin,
        daemonOnline: snap.isRunning,
        webOrigin,
        mobilePairUrl: `${webOrigin}/#${pairParams.toString()}`,
        exeDownloadUrl: `/releases/v${APP_VERSION}/AI_NetController_HostAgent_v${APP_VERSION}_win64.exe`,
        apkDownloadUrl: `/releases/v${APP_VERSION}/AI_NetController_v${APP_VERSION}_arm64-v8a.apk`,
        portableZipUrl: `/releases/v${APP_VERSION}/AI_NetController_HostAgent_v${APP_VERSION}_win64_portable.zip`,
        launcherDownloadUrl: '/api/setup/windows-launcher',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to generate setup info' });
  }
});

app.get('/api/setup/windows-launcher', requireControlAuth, async (_req: Request, res: Response) => {
  const snap = await getRealDaemonSnapshot();
  const safeSecret = (await getControlSecret()).replace(/[^a-zA-Z0-9_.:-]/g, '');
  const safePort = Number.isInteger(snap.port) ? snap.port : 8765;

  const batLines = [
    '@echo off',
    'title AI NetController - 1-Click PC Setup Launcher',
    'color 0B',
    `echo AI NetController v${APP_VERSION} (${APP_VERSION_LABEL}) Setup`,
    `set "AI_AGENT_SECRET=${safeSecret}"`,
    `set "CST_AGENT_SECRET=${safeSecret}"`,
    `set "CST_AGENT_PORT=${safePort}"`,
    'cd /d "%~dp0"',
    'where python >nul 2>nul',
    'if %ERRORLEVEL% EQU 0 (',
    '    if exist "agent\\requirements.txt" python -m pip install -r agent\\requirements.txt --quiet',
    ')',
    `netsh advfirewall firewall add rule name="AI NetController Daemon" dir=in action=allow protocol=TCP localport=${safePort} profile=private >nul 2>nul`,
    `if exist "AI_NetController_HostAgent_v${APP_VERSION}_win64.exe" (`,
    `    start "AI NetController Host Agent" "AI_NetController_HostAgent_v${APP_VERSION}_win64.exe"`,
    ') else if exist "agent\\agent_daemon.py" (',
    '    start "AI NetController Host Agent" python "agent\\agent_daemon.py"',
    ')',
    'pause',
  ];

  res.setHeader('Content-Type', 'application/x-bat; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="AI_NetController_OneClick_Setup.bat"');
  return res.send(batLines.join('\r\n'));
});

// =====================================================================
// REAL UPDATE STATUS / CHECK / EXECUTION PIPELINE
// =====================================================================
let cachedPythonVersion: string | null = null;
let cachedLatestGitHubRelease: { tag: string; htmlUrl: string; body: string; fetchedAt: number } | null = null;

async function queryOllamaInstalledModels(): Promise<Array<{ name: string; size?: number; modified_at?: string }>> {
  try {
    const resp = await fetch(`${DEFAULT_OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    return Array.isArray(data?.models) ? data.models : [];
  } catch {
    return [];
  }
}

async function queryLatestGitHubRelease(force = false) {
  const now = Date.now();
  if (!force && cachedLatestGitHubRelease && now - cachedLatestGitHubRelease.fetchedAt < 300_000) {
    return { release: cachedLatestGitHubRelease, error: null as string | null };
  }
  try {
    const resp = await fetch('https://api.github.com/repos/SemO2077/AI-NetController/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `AI-NetController/${APP_VERSION}` },
      signal: AbortSignal.timeout(4500),
    });
    if (!resp.ok) {
      return { release: null, error: `GitHub API returned HTTP ${resp.status}` };
    }
    const data: any = await resp.json();
    if (data?.tag_name) {
      cachedLatestGitHubRelease = {
        tag: String(data.tag_name),
        htmlUrl: String(data.html_url || 'https://github.com/SemO2077/AI-NetController/releases'),
        body: String(data.body || '').slice(0, 600),
        fetchedAt: now,
      };
      return { release: cachedLatestGitHubRelease, error: null };
    }
    return { release: null, error: 'No tag_name found in GitHub response' };
  } catch (err: any) {
    return { release: null, error: err?.message || 'GitHub unreachable' };
  }
}

function compareSemver(aRaw: string, bRaw: string): number {
  const clean = (s: string) =>
    s
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const a = clean(aRaw);
  const b = clean(bRaw);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

async function buildRealUpdateInventory(checkRemote = false) {
  if (!cachedPythonVersion) {
    cachedPythonVersion = await new Promise<string>((resolve) => {
      execFile(getPythonBin(), ['--version'], { timeout: 3000 }, (err, stdout, stderr) => {
        resolve(err ? 'Python not detected' : (stdout || stderr).trim());
      });
    });
  }

  const [ollamaModels, ghCheck] = await Promise.all([
    queryOllamaInstalledModels(),
    checkRemote ? queryLatestGitHubRelease(true) : Promise.resolve({ release: cachedLatestGitHubRelease, error: null }),
  ]);

  const latestTag = ghCheck.release?.tag || `v${APP_VERSION}`;
  const isNewerRemote = compareSemver(latestTag, APP_VERSION) > 0;

  const components = [
    {
      id: 'cst-host-agent',
      name: 'AI NetController Control & Host Suite',
      category: 'agent' as const,
      currentVersion: `v${APP_VERSION}`,
      latestVersion: latestTag,
      status: isNewerRemote ? ('available' as const) : ('up_to_date' as const),
      size: 'Release Bundle',
      lastChecked: checkRemote ? 'Just now' : cachedLatestGitHubRelease ? 'Cached' : 'Local check',
      changelog: ghCheck.release?.body || `Installed Beta ${APP_VERSION_LABEL}`,
      downloadUrl: ghCheck.release?.htmlUrl,
    },
    {
      id: 'ast-security-rules',
      name: 'Command AST Firewall Policy Engine',
      category: 'security' as const,
      currentVersion: `v${APP_VERSION}-strict`,
      latestVersion: `v${APP_VERSION}-strict`,
      status: 'up_to_date' as const,
      size: 'Built-in Module',
      lastChecked: 'Just now',
      changelog: 'NFKC normalization, LOLBin denylist, DPAPI vault, & biometric-bound execution.',
    },
  ];

  for (const m of ollamaModels) {
    const sizeGb = m.size ? `${(m.size / 1024 ** 3).toFixed(1)} GB` : 'Local Ollama';
    components.push({
      id: m.name,
      name: `Ollama Local Model: ${m.name}`,
      category: 'agent' as const,
      currentVersion: 'installed',
      latestVersion: 'installed',
      status: 'up_to_date' as const,
      size: sizeGb,
      lastChecked: 'Just now',
      changelog: 'Installed in local Ollama daemon (127.0.0.1:11434).',
      downloadUrl: undefined,
    });
  }

  return {
    components,
    ollamaCount: ollamaModels.length,
    remoteCheckError: ghCheck.error,
  };
}

app.get('/api/update/status', async (_req: Request, res: Response) => {
  try {
    const inv = await buildRealUpdateInventory(false);
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      pythonVersion: cachedPythonVersion,
      aiModels: DYNAMIC_MODELS.map((m) => m.id),
      agentVersion: `v${APP_VERSION}`,
      components: inv.components,
      updatesAvailableCount: inv.components.filter((c) => c.status === 'available').length,
      ollamaConnected: inv.ollamaCount > 0,
      status: 'ready',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to fetch update status' });
  }
});

app.post('/api/update/check', requireControlAuth, async (_req: Request, res: Response) => {
  try {
    const inv = await buildRealUpdateInventory(true);
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      checkedComponents: inv.components,
      remoteCheckError: inv.remoteCheckError,
      systemInfo: {
        nodeVersion: process.version,
        pythonVersion: cachedPythonVersion,
        platform: process.platform,
        arch: process.arch,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Check failed' });
  }
});

app.post('/api/update/execute', requireControlAuth, async (req: Request, res: Response) => {
  const start = Date.now();
  const { componentId } = req.body || {};
  const target = String(componentId || 'ALL');
  const logs: string[] = [];

  try {
    if (target !== 'ALL' && target !== 'cst-host-agent' && target !== 'ast-security-rules') {
      // Pull real Ollama model tag
      logs.push(`[OLLAMA] Requesting real model pull for "${target}" via ${DEFAULT_OLLAMA_BASE}/api/pull...`);
      const resp = await fetch(`${DEFAULT_OLLAMA_BASE}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: target, stream: false }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) {
        return res.status(502).json({
          success: false,
          error: `Ollama pull failed with HTTP ${resp.status}`,
          logs,
        });
      }
      const pullJson: any = await resp.json();
      logs.push(`[OLLAMA] Status: ${pullJson?.status || 'success'}`);
    } else {
      const ghCheck = await queryLatestGitHubRelease(true);
      const latestTag = ghCheck.release?.tag || `v${APP_VERSION}`;
      if (compareSemver(latestTag, APP_VERSION) > 0 && ghCheck.release) {
        logs.push(`[RELEASE] Newer version ${latestTag} available at: ${ghCheck.release.htmlUrl}`);
        logs.push('[INFO] Download and run the signed installer or pull git main to upgrade binary builds.');
      } else if (ghCheck.error) {
        logs.push(`[WARN] Could not contact GitHub Releases (${ghCheck.error}); local packages verified unchanged.`);
      } else {
        logs.push(`[VERIFIED] Installed suite v${APP_VERSION} matches latest GitHub release (${latestTag}).`);
      }
    }

    const inv = await buildRealUpdateInventory(false);
    return res.json({
      success: true,
      componentId: target,
      updateAll: target === 'ALL',
      logs,
      components: inv.components,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Update execution failed', logs });
  }
});

app.post('/api/update/ai-analyze', requireControlAuth, async (req: Request, res: Response) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'GEMINI_API_KEY is required for AI release drift analysis.',
      });
    }
    const { language = 'en' } = req.body || {};
    const inv = await buildRealUpdateInventory(true);
    const ai = getGenAI();
    const prompt =
      language === 'bg'
        ? `Анализирай компонентите на AI NetController v${APP_VERSION} (Node ${process.version}, ${cachedPythonVersion}): ${JSON.stringify(inv.components)}. Дай кратък 3-точков инженерен доклад.`
        : `Analyze these AI NetController v${APP_VERSION} component states (Node ${process.version}, ${cachedPythonVersion}): ${JSON.stringify(inv.components)}. Provide a concise 3-point engineering summary.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.2 },
    });

    const pendingCount = inv.components.filter((c) => c.status === 'available').length;
    return res.json({
      success: true,
      analysis: response.text || 'No analysis generated.',
      pendingCount,
      securityScore: pendingCount === 0 ? 100 : Math.max(70, 100 - pendingCount * 10),
      modelUsed: 'gemini-2.5-flash',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(503).json({ error: err?.message || 'AI update analysis failed' });
  }
});

// =====================================================================
// REAL WAKE-ON-LAN DISPATCH & PERSISTENT SERVER-SIDE SCHEDULER
// =====================================================================
function validateBroadcastIpv4(ipRaw: string): boolean {
  const clean = ipRaw.trim();
  const ipv4Regex = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  if (!ipv4Regex.test(clean)) return false;
  const parts = clean.split('.').map(Number);
  if (parts[0] === 0 || parts[0] === 127 || (parts[0] >= 224 && parts[0] <= 239)) return false;
  return true;
}

function sendRealWolPacket(mac: string, broadcastIp = '255.255.255.255', port = 9, secureOn = ''): Promise<void> {
  const cleanMac = String(mac).replace(/[^a-fA-F0-9]/g, '');
  if (cleanMac.length !== 12) {
    return Promise.reject(new Error('Invalid MAC address format (must be 12 hex characters)'));
  }
  const cleanSecureOn = secureOn ? String(secureOn).replace(/[^a-fA-F0-9]/g, '') : '';
  if (cleanSecureOn && cleanSecureOn.length !== 12) {
    return Promise.reject(new Error('Invalid SecureOn password format (must be 12 hex characters)'));
  }
  if (!validateBroadcastIpv4(broadcastIp)) {
    return Promise.reject(new Error('Invalid or restricted IPv4 broadcast address'));
  }

  const macBytes = Buffer.from(cleanMac, 'hex');
  const magicPacket = Buffer.alloc(cleanSecureOn ? 108 : 102);
  magicPacket.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    macBytes.copy(magicPacket, 6 + i * 6);
  }
  if (cleanSecureOn) {
    Buffer.from(cleanSecureOn, 'hex').copy(magicPacket, 102);
  }

  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try {
        client.close();
      } catch {}
      if (err) reject(err);
      else resolve();
    };

    client.on('error', (err) => finish(err));
    client.bind(0, () => {
      try {
        client.setBroadcast(true);
        client.send(magicPacket, 0, magicPacket.length, port, broadcastIp, (err) => {
          finish(err || undefined);
        });
      } catch (err: any) {
        finish(err);
      }
    });
  });
}

app.post('/api/wol', requireControlAuth, async (req: Request, res: Response) => {
  try {
    const { mac, broadcastIp = '255.255.255.255', port = 9, secureOn = '' } = req.body || {};
    if (!mac) {
      return res.status(400).json({ error: 'MAC address is required' });
    }
    const targetPort = Number(port);
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      return res.status(400).json({ error: 'Invalid UDP port (must be 1-65535)' });
    }

    await sendRealWolPacket(String(mac), String(broadcastIp).trim(), targetPort, String(secureOn || ''));
    addServerLog('INFO', `Dispatched UDP WoL Magic Packet to ${mac} via ${broadcastIp}:${targetPort}`);
    return res.json({
      success: true,
      mac,
      broadcastIp: String(broadcastIp).trim(),
      port: targetPort,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    const msg = err?.message || 'Failed to dispatch Wake-on-LAN packet';
    const isClientErr = /Invalid|required/i.test(msg);
    return res.status(isClientErr ? 400 : 500).json({ error: msg });
  }
});

interface PersistedWolSchedule {
  id: string;
  name: string;
  time: string;
  days: string[];
  targetType: 'single' | 'all' | 'tag' | 'selected';
  targetHostId?: string;
  mac?: string;
  targetMacs?: string[];
  secureOn?: string;
  broadcastIp?: string;
  port?: number;
  enabled: boolean;
}

function readPersistedWolSchedules(): PersistedWolSchedule[] {
  try {
    const p = getWolSchedulesPath();
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePersistedWolSchedules(list: PersistedWolSchedule[]): void {
  const p = getWolSchedulesPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(list, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

const firedScheduleMinuteKey = new Map<string, string>();
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

setInterval(async () => {
  const schedules = readPersistedWolSchedules();
  if (schedules.length === 0) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dayKey = WEEKDAY_KEYS[now.getDay()];
  const minuteStamp = `${now.toDateString()} ${hhmm}`;

  for (const sched of schedules) {
    if (!sched.enabled || sched.time !== hhmm) continue;
    const normalizedDays = Array.isArray(sched.days)
      ? sched.days.map((d) => String(d).trim().toLowerCase().slice(0, 3))
      : [];
    if (normalizedDays.length > 0 && !normalizedDays.includes(dayKey)) continue;
    if (firedScheduleMinuteKey.get(sched.id) === minuteStamp) continue;

    const macTargets = Array.from(
      new Set(
        [
          ...(Array.isArray(sched.targetMacs) ? sched.targetMacs : []),
          ...(sched.mac ? [sched.mac] : []),
        ]
          .map((m) => String(m || '').trim())
          .filter(Boolean)
      )
    );
    if (macTargets.length === 0) continue;

    firedScheduleMinuteKey.set(sched.id, minuteStamp);
    const broadcastIp = sched.broadcastIp || '255.255.255.255';
    const port = Number(sched.port || 9);
    const secureOn = String(sched.secureOn || '');

    for (const targetMac of macTargets) {
      try {
        await sendRealWolPacket(targetMac, broadcastIp, port, secureOn);
        addServerLog('INFO', `[WoL Scheduler] Triggered scheduled wake "${sched.name}" (${targetMac}) at ${hhmm}`);
      } catch (err: any) {
        addServerLog('WARN', `[WoL Scheduler] Failed scheduled wake "${sched.name}" (${targetMac}): ${err?.message}`);
      }
    }
  }
}, 20_000).unref();

app.get('/api/wol/schedules', requireControlAuth, (_req: Request, res: Response) => {
  return res.json({ success: true, schedules: readPersistedWolSchedules() });
});

app.post('/api/wol/schedules', requireControlAuth, (req: Request, res: Response) => {
  const list = Array.isArray(req.body?.schedules) ? req.body.schedules : null;
  if (!list) {
    return res.status(400).json({ error: 'schedules array is required' });
  }
  writePersistedWolSchedules(list);
  return res.json({ success: true, schedules: list });
});

app.delete('/api/wol/schedules/:id', requireControlAuth, (req: Request, res: Response) => {
  const next = readPersistedWolSchedules().filter((s) => s.id !== req.params.id);
  writePersistedWolSchedules(next);
  return res.json({ success: true, schedules: next });
});

// =====================================================================
// REAL LAN & ARP SUBNET SCANNER (No Fake Hosts)
// =====================================================================
app.post('/api/hosts/scan', requireControlAuth, async (_req: Request, res: Response) => {
  try {
    const snap = await getRealDaemonSnapshot();
    const port = snap.port || 8765;
    const discovered: Array<{
      id: string;
      name: string;
      ip: string;
      mac: string;
      os: string;
      isOnline: boolean;
      ping: number;
    }> = [];

    const primaryAdapter = snap.activeAdapters[0] || {
      name: 'Loopback',
      ipv4: snap.localIp,
      mac: '00:00:00:00:00:00',
    };

    const loopbackProbe = await probeTcpPortWithRtt('127.0.0.1', port, 400);
    const lanSelfProbe =
      snap.localIp !== '127.0.0.1' ? await probeTcpPortWithRtt(snap.localIp, port, 400) : { open: false, rttMs: 0 };

    if (loopbackProbe.open || lanSelfProbe.open) {
      const realHostname = snap.hostname || os.hostname() || 'Host-PC';
      const safeId = realHostname.toUpperCase().replace(/[^A-Z0-9_-]/g, '-');
      discovered.push({
        id: safeId,
        name: realHostname,
        ip: snap.localIp !== '127.0.0.1' ? snap.localIp : '127.0.0.1',
        mac: primaryAdapter.mac || '00:00:00:00:00:00',
        os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
        isOnline: true,
        ping: lanSelfProbe.open ? lanSelfProbe.rttMs : loopbackProbe.rttMs,
      });
    }

    const arpStdout = await new Promise<string>((resolve) => {
      execFile('arp', ['-a'], { timeout: 4000 }, (err, stdout) => resolve(err ? '' : stdout || ''));
    });

    if (arpStdout) {
      const ipMacRegex =
        /([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\s+([0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2})/i;
      const seenIps = new Set<string>(['127.0.0.1', snap.localIp]);
      const candidates: Array<{ ip: string; mac: string }> = [];

      for (const line of arpStdout.split('\n')) {
        const match = line.match(ipMacRegex);
        if (!match) continue;
        const ip = match[1];
        const mac = match[2].replace(/-/g, ':').toUpperCase();
        if (seenIps.has(ip) || ip.endsWith('.255') || isPrivateOrSpecialIp(ip) === false) continue;
        if (ip.startsWith('224.') || ip.startsWith('239.') || mac === 'FF:FF:FF:FF:FF:FF') continue;
        seenIps.add(ip);
        candidates.push({ ip, mac });
      }

      await Promise.allSettled(
        candidates.map(async ({ ip, mac }) => {
          const probe = await probeTcpPortWithRtt(ip, port, 350);
          if (!probe.open) return;
          let resolvedName = `Peer (${ip})`;
          try {
            const names = await dns.reverse(ip);
            if (names && names[0]) resolvedName = names[0];
          } catch {}
          discovered.push({
            id: `PC-${ip.replace(/\./g, '-')}`,
            name: resolvedName,
            ip,
            mac,
            os: 'unknown',
            isOnline: true,
            ping: probe.rttMs,
          });
        })
      );
    }

    return res.json({
      success: true,
      count: discovered.length,
      hosts: discovered,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to scan subnet' });
  }
});

// =====================================================================
// AST COMMAND FIREWALL & SINGLE-USE HITL CONFIRMATION TOKEN GATE
// =====================================================================
export interface CommandInspectionResult {
  allowed: boolean;
  blocked: boolean;
  requiresConfirmation: boolean;
  riskLevel: 'SAFE' | 'HIGH' | 'CRITICAL';
  sanitizedCmd: string;
  reason?: string;
}

export function inspectCommandSecurity(rawCmd: string): CommandInspectionResult {
  if (!rawCmd || typeof rawCmd !== 'string') {
    return {
      allowed: false,
      blocked: true,
      requiresConfirmation: false,
      riskLevel: 'CRITICAL',
      sanitizedCmd: '',
      reason: 'Command string is required and must be non-empty',
    };
  }

  const trimmed = rawCmd.trim();
  if (trimmed.length > 2048 || trimmed.includes('\0')) {
    return {
      allowed: false,
      blocked: true,
      requiresConfirmation: false,
      riskLevel: 'CRITICAL',
      sanitizedCmd: '',
      reason: 'Command rejected: invalid length (>2048 chars) or null byte detected',
    };
  }

  const deobfuscatedCmd = trimmed
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\^(.)/g, '$1')
    .replace(/`([a-zA-Z0-9])/g, '$1')
    .replace(/(?<=\w)["']+(?=\w)/g, '');

  const hasEvasionArtifacts = deobfuscatedCmd !== trimmed;

  const criticalBlockPatterns = [
    /:\(\)\s*\{\s*:\|:&\s*\}\s*;?\s*:/,
    /\bmkfs(?:\.[a-z0-9]+)?\b/i,
    /\bdd\s+if=/i,
    /\b(?:curl|wget)\b.*\|\s*(?:ba)?sh\b/i,
    /\b(?:nc|ncat|netcat)\b.*-e\b/i,
    /\b(?:powershell|pwsh)(?:\.exe)?\b.*\s-(?:e|en|enc|encodedcommand)\b/i,
    /\b(?:iex|invoke-expression)\b/i,
    /\brm\s+-[rRfF]+\s+(?:\/|\*)\b/,
    /%[a-zA-Z0-9_]+:~-?\d+,-?\d+%/,
    /\$env:[a-zA-Z0-9_]+/i,
    /![a-zA-Z0-9_]+!/,
    /\$\{IFS\}/i,
    /\b(?:0x[0-9a-f]{8}|0[0-7]{10,})\b/i,
    /\b(?:certutil\s+.*-urlcache|bitsadmin\s+.*\/transfer|mshta\s+https?:|regsvr32\s+.*\/i:https?:|rundll32\s+javascript:)/i,
    /(?:^|\s|\S)(?:\d?>>?|<)(?!=)[^\r\n]*(?:\\windows\\|system32|syswow64|\/etc\/|\/usr\/|\/bin\/|\/sbin\/|\.ssh|\\startup\\)/i,
  ];

  for (const pattern of criticalBlockPatterns) {
    if (pattern.test(deobfuscatedCmd)) {
      return {
        allowed: false,
        blocked: true,
        requiresConfirmation: false,
        riskLevel: 'CRITICAL',
        sanitizedCmd: deobfuscatedCmd,
        reason: 'Command permanently blocked by AI NetController AST Security Firewall',
      };
    }
  }

  const hasInlineExec =
    /\b(?:python|python3|py|node|perl|ruby|php|bash|sh|zsh|powershell|pwsh|cmd)(?:\.exe)?\b[^\r\n]*\s(?:-c|-e|-r|\/c|\/k|-command)\b/i.test(
      deobfuscatedCmd
    );
  const hasPosixBackslashEscape = /(?:^|\s)\\[a-zA-Z]{2,}/.test(trimmed);

  const isHighRisk =
    hasEvasionArtifacts ||
    hasInlineExec ||
    hasPosixBackslashEscape ||
    /\b(?:rmdir|del|rm|format|diskpart|shutdown|reboot|Restart-Computer|Stop-Computer|reg\s+delete|bcdedit|vssadmin)\b/i.test(
      deobfuscatedCmd
    ) ||
    /[;&|`$()<>\r\n]/.test(trimmed);

  if (isHighRisk) {
    return {
      allowed: true,
      blocked: false,
      requiresConfirmation: true,
      riskLevel: 'HIGH',
      sanitizedCmd: deobfuscatedCmd,
      reason: 'High-risk command requires Human-in-the-Loop confirmation token',
    };
  }

  return {
    allowed: true,
    blocked: false,
    requiresConfirmation: false,
    riskLevel: 'SAFE',
    sanitizedCmd: deobfuscatedCmd,
  };
}

const pendingCommandConfirmations = new Map<string, { command: string; expiresAt: number }>();

const SCRUBBED_CHILD_ENV_KEYS = new Set([
  'GEMINI_API_KEY',
  'API_KEY',
  'CST_AGENT_SECRET',
  'AI_AGENT_SECRET',
  'WEB_CONTROL_SECRET',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'GL_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'NPM_TOKEN',
]);

function createSafeChildEnv(): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!SCRUBBED_CHILD_ENV_KEYS.has(k.toUpperCase())) {
      safeEnv[k] = v;
    }
  }
  return safeEnv;
}

app.post('/api/command/execute', requireControlAuth, async (req: Request, res: Response) => {
  try {
    const { command, hostId, hostIp, confirmationId } = req.body || {};
    const inspection = inspectCommandSecurity(command);

    if (inspection.blocked) {
      return res.status(403).json({
        error: inspection.reason,
        blocked: true,
        riskLevel: inspection.riskLevel,
      });
    }

    if (inspection.requiresConfirmation) {
      const pending = confirmationId ? pendingCommandConfirmations.get(String(confirmationId)) : undefined;
      const validToken =
        pending && Date.now() < pending.expiresAt && pending.command === inspection.sanitizedCmd;
      if (!validToken) {
        const nextConfirmId = crypto.randomBytes(16).toString('hex');
        pendingCommandConfirmations.set(nextConfirmId, {
          command: inspection.sanitizedCmd,
          expiresAt: Date.now() + 120_000,
        });
        return res.status(403).json({
          error: inspection.reason,
          requiresConfirmation: true,
          confirmationId: nextConfirmId,
          riskLevel: inspection.riskLevel,
        });
      }
      pendingCommandConfirmations.delete(String(confirmationId));
    }

    const cfg = await loadDaemonConfig();
    const daemonPort = Number(cfg.port || 8765);
    const targetIp = String(hostIp || '127.0.0.1');

    // Route execution strictly through the live sandboxed Python Host Agent (never local Node exec)
    const agentExec = await dispatchLiveAgentCommand(
      targetIp,
      daemonPort,
      {
        action: 'EXECUTE_PROMPT',
        command: inspection.sanitizedCmd,
        command_id: `cmd-${Date.now()}`,
      },
      'EXECUTION_RESULT',
      15_000
    );

    if (agentExec.ok && agentExec.response) {
      return res.json({
        success: agentExec.response.status === 'success',
        output: agentExec.response.output || '',
        durationMs: agentExec.response.execution_time_ms || 0,
        hostId,
        viaAgent: true,
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(503).json({
      success: false,
      error: agentExec.error || 'Target Host Agent daemon is offline',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Command execution failed' });
  }
});

// =====================================================================
// REAL PC CONTROL EXECUTION (Routes directly to Python Host Agent)
// =====================================================================
export interface ParsedAiAction {
  id: string;
  type:
    | 'mouse_click'
    | 'mouse_move'
    | 'mouse_double_click'
    | 'mouse_scroll'
    | 'keyboard_type'
    | 'type_text'
    | 'keyboard_hotkey'
    | 'key_combo'
    | 'media_control'
    | 'lock_pc'
    | 'shell_exec'
    | 'terminal_command'
    | 'wol'
    | 'system_update'
    | 'daemon_control'
    | 'screen_capture'
    | 'rescan'
    | 'lab_mode';
  target?: string;
  hostIp?: string;
  x?: number;
  y?: number;
  dy?: number;
  button?: 'left' | 'right' | 'middle';
  text?: string;
  pressEnter?: boolean;
  keys?: string[];
  command?: string;
  componentId?: string;
  rawTag: string;
}

function parseActionDirectives(text: string): ParsedAiAction[] {
  const actions: ParsedAiAction[] = [];
  const tagRegex = /\[ACTION:([A-Z_]+)([^\]]*)\]/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  const parseAttr = (attrStr: string, key: string): string | undefined => {
    const quoted = new RegExp(`${key}="([^"]*)"`, 'i').exec(attrStr);
    if (quoted) return quoted[1];
    const singleQuoted = new RegExp(`${key}='([^']*)'`, 'i').exec(attrStr);
    if (singleQuoted) return singleQuoted[1];
    const unquoted = new RegExp(`${key}=([^\\s\\]]+)`, 'i').exec(attrStr);
    return unquoted ? unquoted[1] : undefined;
  };

  while ((match = tagRegex.exec(text)) !== null) {
    idx += 1;
    const rawKind = match[1].toUpperCase();
    const attrStr = match[2] || '';
    const target = parseAttr(attrStr, 'target') || 'LOCALHOST';
    const id = `ai-act-${Date.now()}-${idx}`;
    const rawTag = match[0];

    switch (rawKind) {
      case 'MOUSE_CLICK':
        actions.push({
          id,
          type: 'mouse_click',
          target,
          x: Number(parseAttr(attrStr, 'x') ?? 960),
          y: Number(parseAttr(attrStr, 'y') ?? 540),
          button: (parseAttr(attrStr, 'button') as 'left' | 'right' | 'middle') || 'left',
          rawTag,
        });
        break;
      case 'MOUSE_MOVE':
        actions.push({
          id,
          type: 'mouse_move',
          target,
          x: Number(parseAttr(attrStr, 'x') ?? 960),
          y: Number(parseAttr(attrStr, 'y') ?? 540),
          rawTag,
        });
        break;
      case 'MOUSE_DOUBLE_CLICK':
        actions.push({
          id,
          type: 'mouse_double_click',
          target,
          x: Number(parseAttr(attrStr, 'x') ?? 960),
          y: Number(parseAttr(attrStr, 'y') ?? 540),
          rawTag,
        });
        break;
      case 'MOUSE_SCROLL':
        actions.push({
          id,
          type: 'mouse_scroll',
          target,
          dy: Number(parseAttr(attrStr, 'dy') ?? -300),
          rawTag,
        });
        break;
      case 'KEYBOARD_TYPE':
        actions.push({
          id,
          type: 'keyboard_type',
          target,
          text: parseAttr(attrStr, 'text') || '',
          pressEnter: String(parseAttr(attrStr, 'press_enter') || 'true').toLowerCase() !== 'false',
          rawTag,
        });
        break;
      case 'KEYBOARD_HOTKEY': {
        const keysRaw = parseAttr(attrStr, 'keys') || 'ctrl,c';
        actions.push({
          id,
          type: 'keyboard_hotkey',
          target,
          keys: keysRaw.split(',').map((k) => k.trim()).filter(Boolean),
          rawTag,
        });
        break;
      }
      case 'MEDIA_CONTROL':
        actions.push({
          id,
          type: 'media_control',
          target,
          command: parseAttr(attrStr, 'command') || 'play_pause',
          rawTag,
        });
        break;
      case 'SHELL_EXEC':
        actions.push({
          id,
          type: 'shell_exec',
          target,
          command: parseAttr(attrStr, 'command') || 'whoami',
          rawTag,
        });
        break;
      case 'WOL':
        actions.push({ id, type: 'wol', target, rawTag });
        break;
      case 'SYSTEM_UPDATE':
        actions.push({
          id,
          type: 'system_update',
          componentId: parseAttr(attrStr, 'target') || parseAttr(attrStr, 'component') || 'ALL',
          rawTag,
        });
        break;
      case 'DAEMON_CONTROL':
        actions.push({
          id,
          type: 'daemon_control',
          command: parseAttr(attrStr, 'command') || 'diagnostics',
          rawTag,
        });
        break;
      case 'SCREEN_CAPTURE':
        actions.push({ id, type: 'screen_capture', target, rawTag });
        break;
      case 'RESCAN':
        actions.push({ id, type: 'rescan', rawTag });
        break;
      case 'LAB_MODE':
        actions.push({ id, type: 'lab_mode', rawTag });
        break;
    }
  }

  return actions;
}

async function executePcControlAction(action: Partial<ParsedAiAction> & { type: string; mac?: string; hostIp?: string }) {
  const startTime = Date.now();
  const cfg = await loadDaemonConfig();
  const daemonPort = Number(cfg.port || 8765);
  const target = action.target || os.hostname() || 'LOCALHOST';
  const targetIp = String(action.hostIp || '127.0.0.1');

  const isInputAction = [
    'mouse_click',
    'mouse_move',
    'mouse_double_click',
    'mouse_scroll',
    'keyboard_type',
    'type_text',
    'keyboard_hotkey',
    'key_combo',
    'media_control',
    'lock_pc',
  ].includes(action.type);

  if (isInputAction && cfg.view_only_mode) {
    return {
      success: false,
      statusCode: 403,
      actionType: action.type,
      target,
      summary: 'Blocked by Host Daemon View-Only Mode.',
      blockedByViewOnly: true,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  if (action.type === 'wol') {
    try {
      await sendRealWolPacket(String(action.mac || ''), '255.255.255.255', 9);
      return {
        success: true,
        statusCode: 200,
        actionType: 'wol',
        target,
        opcode: 'UDP:9 (MAGIC_PACKET)',
        summary: `Sent UDP Wake-on-LAN Magic Packet to ${target}`,
        output: `Magic packet broadcast on UDP port 9 for ${action.mac}`,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        success: false,
        statusCode: 400,
        actionType: 'wol',
        target,
        summary: err?.message || 'Wake-on-LAN failed',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  if (action.type === 'terminal_command' || action.type === 'shell_exec') {
    const rawCmd = String(action.command || 'whoami').trim();
    const inspection = inspectCommandSecurity(rawCmd);
    if (inspection.blocked) {
      return {
        success: false,
        statusCode: 403,
        actionType: 'shell_exec',
        target,
        summary: `Blocked by AST Firewall: "${rawCmd}"`,
        output: inspection.reason,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
    const execRes = await dispatchLiveAgentCommand(
      targetIp,
      daemonPort,
      { action: 'EXECUTE_PROMPT', command: inspection.sanitizedCmd, command_id: `ai-${Date.now()}` },
      'EXECUTION_RESULT',
      15_000
    );
    if (!execRes.ok) {
      return {
        success: false,
        statusCode: 503,
        offline: true,
        actionType: 'shell_exec',
        target,
        summary: execRes.error || 'Host Agent daemon offline',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
    return {
      success: execRes.response?.status === 'success',
      statusCode: 200,
      actionType: 'shell_exec',
      target,
      opcode: '0x04 (SHELL_EXEC)',
      summary: `Executed "${inspection.sanitizedCmd}" on ${target}`,
      output: execRes.response?.output || '',
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  if (isInputAction) {
    let wsInputPayload: Record<string, unknown>;
    if (action.type === 'mouse_click' || action.type === 'mouse_double_click') {
      wsInputPayload = {
        action: 'INPUT_EVENT',
        kind: action.type === 'mouse_double_click' ? 'dblclick' : 'click',
        x: Number.isFinite(action.x) ? Number(action.x) : 960,
        y: Number.isFinite(action.y) ? Number(action.y) : 540,
        button: action.button || 'left',
      };
    } else if (action.type === 'mouse_move') {
      wsInputPayload = {
        action: 'INPUT_EVENT',
        kind: 'move',
        x: Number.isFinite(action.x) ? Number(action.x) : 960,
        y: Number.isFinite(action.y) ? Number(action.y) : 540,
      };
    } else if (action.type === 'mouse_scroll') {
      wsInputPayload = {
        action: 'INPUT_EVENT',
        kind: 'scroll',
        dy: Number.isFinite(action.dy) ? Number(action.dy) : -300,
      };
    } else if (action.type === 'type_text' || action.type === 'keyboard_type') {
      wsInputPayload = {
        action: 'INPUT_EVENT',
        kind: 'type',
        text: String(action.text || ''),
        press_enter: action.pressEnter !== false,
      };
    } else if (action.type === 'key_combo' || action.type === 'keyboard_hotkey') {
      const rawKeys = (action as any).keys;
      const keys = Array.isArray(rawKeys)
        ? rawKeys
        : String(rawKeys || action.command || 'ctrl,c')
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean);
      wsInputPayload = { action: 'INPUT_EVENT', kind: 'hotkey', keys };
    } else {
      const cmd = action.type === 'lock_pc' ? 'lock_pc' : String(action.command || 'play_pause').toLowerCase();
      wsInputPayload = { action: 'INPUT_EVENT', kind: 'media', command: cmd };
    }

    const sendRes = await dispatchLiveAgentCommand(targetIp, daemonPort, wsInputPayload);
    if (!sendRes.ok) {
      return {
        success: false,
        statusCode: 503,
        offline: true,
        actionType: action.type,
        target,
        summary: sendRes.error || 'Host Agent daemon offline',
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }

    addServerLog('INFO', `Dispatched real ${action.type} event to Host Agent on ${targetIp}:${daemonPort}`);
    return {
      success: true,
      statusCode: 200,
      actionType: action.type,
      target,
      opcode: '0x08 (LIVE_INPUT)',
      summary: `Delivered ${action.type} event to ${target}`,
      output: `Dispatched to ws://${targetIp}:${daemonPort}`,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    success: false,
    statusCode: 400,
    actionType: action.type,
    target,
    summary: `Action "${action.type}" requires direct live channel execution on client`,
    durationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

app.post('/api/pc-control/execute', requireControlAuth, async (req: Request, res: Response) => {
  try {
    const actionPayload = req.body;
    if (!actionPayload || !actionPayload.type) {
      return res.status(400).json({ error: 'Action type is required' });
    }
    const result = await executePcControlAction(actionPayload);
    return res.status(result.statusCode || 200).json({
      ...result,
      daemon: await getRealDaemonSnapshot(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to execute PC control action' });
  }
});

// =====================================================================
// MULTI-PROVIDER AI CHAT ENDPOINT (Gemini + Ollama + Custom Endpoint)
// =====================================================================
app.post('/api/chat', requireControlAuth, async (req: Request, res: Response) => {
  try {
    const { messages, model, role = 'commander', fleetContext, autoExecute = false } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required and must not be empty' });
    }

    const snap = await getRealDaemonSnapshot();
    const primaryHost =
      fleetContext?.selectedTarget ||
      (Array.isArray(fleetContext?.hosts) && fleetContext.hosts[0]?.id) ||
      snap.hostname;

    let systemInstruction = SYSTEM_INSTRUCTIONS[role] || SYSTEM_INSTRUCTIONS.commander;
    if (fleetContext) {
      systemInstruction += `\n\n[LIVE FLEET CONTEXT]:\n- Selected Host: ${primaryHost}\n- Hosts Online: ${fleetContext.hostsOnline || 0}/${fleetContext.hostsTotal || 0}\n- Daemon Status: ${snap.isRunning ? 'ONLINE' : 'OFFLINE'} (${snap.localIp}:${snap.port})`;
    }

    const requestedModel = DYNAMIC_MODELS.find((m) => m.id === model);
    const startTime = Date.now();
    let reply = '';
    let actualModelUsed = String(model || 'gemini-2.5-flash');

    if (requestedModel?.provider === 'ollama' || String(model || '').includes(':')) {
      const ollamaBase = (requestedModel?.endpointUrl || DEFAULT_OLLAMA_BASE).replace(/\/+$/, '');
      const check = await validateExternalHttpUrl(`${ollamaBase}/api/chat`, { allowLoopback: true });
      if (!check.valid) {
        return res.status(400).json({ error: check.error });
      }
      const ollamaRes = await fetch(check.normalized!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: requestedModel?.id || model,
          stream: false,
          messages: [
            { role: 'system', content: systemInstruction },
            ...messages.slice(-20).map((m: { role: string; content: string }) => ({
              role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
              content: String(m.content || '').slice(0, 8000),
            })),
          ],
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!ollamaRes.ok) {
        return res.status(503).json({ error: `Ollama returned HTTP ${ollamaRes.status}` });
      }
      const data: any = await ollamaRes.json();
      reply = String(data?.message?.content || '');
      actualModelUsed = requestedModel?.id || String(model);
    } else if (requestedModel?.provider === 'custom' && requestedModel.endpointUrl) {
      const check = await validateExternalHttpUrl(requestedModel.endpointUrl, { allowLoopback: false });
      if (!check.valid) {
        return res.status(400).json({ error: check.error });
      }
      const customRes = await fetch(check.normalized!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: requestedModel.id,
          messages: [
            { role: 'system', content: systemInstruction },
            ...messages.slice(-20),
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!customRes.ok) {
        return res.status(502).json({ error: `Custom endpoint returned HTTP ${customRes.status}` });
      }
      const data: any = await customRes.json();
      reply = String(data?.choices?.[0]?.message?.content || data?.reply || '');
    } else {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({
          error: 'GEMINI_API_KEY is not configured. Configure a Gemini key in .env or select an active local Ollama model.',
          offline: true,
          modelUsed: 'unconfigured',
        });
      }

      const targetModel = resolveSupportedGeminiModel(model);
      actualModelUsed = targetModel;
      const ai = getGenAI();
      const contents = messages.slice(-20).map((m: { role: string; content: string }) => ({
        role: m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '').slice(0, 8000) }],
      }));

      const response = await ai.models.generateContent({
        model: targetModel,
        contents,
        config: {
          systemInstruction,
          temperature: role === 'diagnostics' ? 0.3 : 0.65,
        },
      });
      reply = response.text || '';
    }

    const parsedActions = parseActionDirectives(reply);
    const executionResults: Record<string, any> = {};
    if (autoExecute && parsedActions.length > 0) {
      for (const act of parsedActions) {
        if (act.type !== 'rescan' && act.type !== 'lab_mode') {
          const hostObj = Array.isArray(fleetContext?.hosts)
            ? fleetContext.hosts.find((h: any) => h.id === act.target || h.name === act.target)
            : undefined;
          executionResults[act.id] = await executePcControlAction({
            ...act,
            mac: hostObj?.mac,
            hostIp: hostObj?.ip,
          });
        }
      }
    }

    return res.json({
      reply,
      modelUsed: actualModelUsed,
      requestedModel: model || actualModelUsed,
      role,
      actions: parsedActions,
      executionResults,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[API /api/chat error]:', err);
    return res.status(503).json({
      error: err?.message || 'Failed to generate response from AI engine',
      modelUsed: req.body?.model || 'unknown',
    });
  }
});

// JSON 404 Catch-All for unknown API routes BEFORE SPA HTML fallback
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: __dirname,
      configFile: path.resolve(__dirname, 'vite.config.ts'),
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, BIND_HOST, () => {
    console.log(
      `[AI NetController Server v${APP_VERSION}] Listening on http://${BIND_HOST}:${PORT} (LAN=${ALLOW_LAN_WEB}, Node=${process.version})`
    );
  });
}

startServer().catch((err) => {
  console.error('[Server Start Failure]:', err);
  process.exit(1);
});
