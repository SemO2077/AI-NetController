import { HostDevice, LatencyDataPoint } from '../types';

export interface CyberHostDevice extends HostDevice {
  specStatus: 'READY' | 'SLEEPING' | 'AI_ACTIVE';
  deviceType: 'pc' | 'laptop' | 'server';
}

export function generate30sLatencyHistory(baseLatency: number, jitter: number = 1.0): LatencyDataPoint[] {
  const now = Date.now();
  const points: LatencyDataPoint[] = [];
  for (let i = 0; i <= 30; i++) {
    const timestamp = now - (30 - i) * 1000;
    const variation = Math.sin(i / 2.8) * jitter + (i % 7 === 0 ? jitter * 1.5 : 0);
    const latency = Math.max(1, Math.round(baseLatency + variation));
    points.push({ timestamp, latency });
  }
  return points;
}

export const INITIAL_HOSTS: CyberHostDevice[] = [];

/**
 * Isolated test mock hosts used strictly by verification test harnesses
 * Zero runtime pollution in production app.
 */
export const TEST_MOCK_HOSTS: CyberHostDevice[] = [
  {
    id: 'TEST-PC-1',
    name: 'TEST-PC-1',
    ip: '192.168.1.50',
    mac: '00:1A:2B:3C:4D:5E',
    os: 'windows',
    tags: ['Windows', 'Lab', 'Primary'],
    isOnline: true,
    ping: 4,
    latencyHistory: generate30sLatencyHistory(4, 1.2),
    specStatus: 'READY',
    deviceType: 'pc',
    lastSeen: 'Active (mDNS alive)',
    cpuUsage: 24,
    ramUsage: 48,
    diskUsage: '342 GB / 1000 GB (34%)',
    persistentInstructions: [
      'Default browser is Brave (C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe)',
      'Project files are located in D:\\Projects\\CST_Graduation',
      'Direct termination of the PostgreSQL service is strictly prohibited'
    ],
    sessionInstructions: [
      'Do not prompt for confirmation on minor software updates'
    ]
  },
  {
    id: 'TEST-WORKSTATION',
    name: 'TEST-WORKSTATION',
    ip: '192.168.1.75',
    mac: '00:2B:67:89:AB:CD',
    os: 'windows',
    tags: ['Windows', 'Home', 'Sleep'],
    isOnline: false,
    specStatus: 'SLEEPING',
    deviceType: 'laptop',
    batteryPercentage: 42,
    isCharging: false,
    lastSeen: 'Offline (Ready for Wake-on-LAN)',
    cpuUsage: 0,
    ramUsage: 0,
    latencyHistory: [],
    diskUsage: '180 GB / 512 GB (35%)',
    persistentInstructions: [
      'Development environment located in C:\\Dev\\Workstation'
    ],
    sessionInstructions: []
  },
  {
    id: 'TEST-LAPTOP',
    name: 'TEST-LAPTOP',
    ip: '192.168.1.115',
    mac: '00:3C:4D:5E:6F:70',
    os: 'linux',
    tags: ['Linux', 'Field', 'Mobile', 'Lab'],
    isOnline: true,
    ping: 8,
    latencyHistory: generate30sLatencyHistory(8, 1.5),
    specStatus: 'READY',
    deviceType: 'laptop',
    batteryPercentage: 86,
    isCharging: true,
    lastSeen: 'Active (mDNS alive)',
    cpuUsage: 18,
    ramUsage: 36,
    diskUsage: '142 GB / 512 GB (28%)',
    persistentInstructions: [
      'Field diagnostics laptop for remote Wi-Fi and VLAN inspection'
    ],
    sessionInstructions: []
  },
  {
    id: 'TEST-SERVER',
    name: 'TEST-SERVER',
    ip: '192.168.1.200',
    mac: '00:0C:29:8B:D1:4F',
    os: 'linux',
    tags: ['Linux', 'Servers', 'Storage', 'AI'],
    isOnline: true,
    ping: 2,
    latencyHistory: generate30sLatencyHistory(2, 0.8),
    specStatus: 'AI_ACTIVE',
    deviceType: 'server',
    lastSeen: 'Executing agent queue',
    cpuUsage: 78,
    ramUsage: 82,
    diskUsage: '3.4 TB / 8.0 TB (42%)',
    persistentInstructions: [
      'NFS storage partition mounted at /mnt/ai_backups',
      'Never stop sshd.service without explicit secondary confirmation'
    ],
    sessionInstructions: [
      'AI orchestrator active with Ollama qwen2.5-coder'
    ]
  }
];

export const DEMO_PRESET_COMMANDS = [
  {
    label: 'Check System Updates',
    labelEn: 'Check System Updates',
    labelBg: 'Провери системни обновления',
    prompt: 'Check for system package updates (winget / apt) and report pending updates',
    promptEn: 'Check for system package updates (winget / apt) and report pending updates',
    promptBg: 'Провери за системни пакетни обновления и докладвай чакащите актуализации',
    sessionInstruction: 'Do not trigger reboot automatically',
    requestScreenshot: false,
    expectedRisk: 'LOW',
    quadrant: 'top-left'
  },
  {
    label: 'Restart Workstation',
    labelEn: 'Restart Workstation',
    labelBg: 'Рестартирай работната станция',
    prompt: 'Initiate graceful operating system reboot countdown in 10 seconds',
    promptEn: 'Initiate graceful operating system reboot countdown in 10 seconds',
    promptBg: 'Стартирай безопасно рестартиране на операционната система след 10 секунди',
    sessionInstruction: 'Requires elevated root privileges',
    requestScreenshot: false,
    expectedRisk: 'HIGH',
    quadrant: 'top-right'
  },
  {
    label: 'Open Default Browser',
    labelEn: 'Open Default Browser',
    labelBg: 'Отвори браузър по подразбиране',
    prompt: 'Launch default web browser and navigate to https://www.google.com',
    promptEn: 'Launch default web browser and navigate to https://www.google.com',
    promptBg: 'Стартирай уеб браузъра по подразбиране и отвори началната страница',
    sessionInstruction: 'Use configured default browser path',
    requestScreenshot: true,
    expectedRisk: 'LOW',
    quadrant: 'bottom-left'
  },
  {
    label: 'Inspect CPU & RAM Telemetry',
    labelEn: 'Inspect CPU & RAM Telemetry',
    labelBg: 'Покажи натоварване на процесор и памет',
    prompt: 'Collect real-time hardware telemetry for CPU cores, RAM consumption, and top 5 processes',
    promptEn: 'Collect real-time hardware telemetry for CPU cores, RAM consumption, and top 5 processes',
    promptBg: 'Събери хардуерна телеметрия в реално време за процесорни ядра, памет и топ 5 процеса',
    sessionInstruction: 'Return output in structured tabular format',
    requestScreenshot: false,
    expectedRisk: 'LOW',
    quadrant: 'bottom-right'
  }
];

