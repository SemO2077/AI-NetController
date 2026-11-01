export type OSType = 'windows' | 'linux';

export type RiskLevel = 'LOW' | 'HIGH' | 'CRITICAL';

export interface LatencyDataPoint {
  timestamp: number; // Unix timestamp in ms
  latency: number;   // Round-trip time (RTT) in ms
}

export interface HostDevice {
  id: string; // e.g. 'PC-WORK-01'
  name: string; // e.g. 'Workstation Admin Alpha'
  ip: string;
  mac: string;
  os: OSType;
  tags: string[]; // e.g. ['Windows', 'Admin', 'Workstations']
  isOnline: boolean;
  lastSeen: string;
  ping?: number; // Network latency in milliseconds (RTT)
  latencyHistory?: LatencyDataPoint[]; // Last 30 seconds of latency samples
  cpuUsage?: number;
  ramUsage?: number;
  cpu?: number;
  ram?: number;
  batteryPercentage?: number; // 0 - 100 percentage for laptops/portable devices
  isCharging?: boolean;
  port?: number;
  diskUsage?: string;
  specStatus?: 'READY' | 'SLEEPING' | 'AI_ACTIVE';
  deviceType?: 'pc' | 'laptop' | 'server';
  screenThumbnail?: string;
  persistentInstructions?: string[];
  sessionInstructions?: string[];
}

export interface WolPacketPayload {
  mac: string;
  broadcastIp: string;
  port: number;
  rawHex: string;
  bytesCount: number;
  timestamp: string;
}

export type WolPacketLogStatus = 'success' | 'failed';

export type WolPacketTriggerSource = 'manual' | 'schedule' | 'batch' | 'ai';

export interface WolPacketLogEntry {
  id: string;
  timestamp: string;
  createdAt: number;
  deviceId: string;
  deviceName: string;
  mac: string;
  broadcastIp: string;
  port: number;
  bytesCount: number;
  status: WolPacketLogStatus;
  source: WolPacketTriggerSource;
  latencyMs?: number;
  details: string;
  detailsBg: string;
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type WolScheduleTargetType =
  | 'all_lab'
  | 'all_offline'
  | 'all_hosts'
  | 'specific_device'
  | 'custom_mac';

export interface WolSchedule {
  id: string;
  name: string;
  targetType: WolScheduleTargetType;
  targetDeviceId?: string;
  targetMac?: string;
  targetName: string;
  time: string; // 24h format "HH:mm", e.g. "08:00"
  days: Weekday[];
  enabled: boolean;
  broadcastIp: string;
  port: number;
  lastTriggered?: string;
  createdTimestamp: number;
  notes?: string;
}

export interface ClientCommandMessage {
  target_id: string; // Unicast ID or tag selector like "[Windows]"
  command_type: 'natural_language' | 'system_command' | 'wol_packet' | 'session_update';
  prompt: string;
  session_instruction?: string;
  request_screenshot?: boolean;
}

export interface ApprovalRequiredEvent {
  event: 'APPROVAL_REQUIRED';
  command_id: string;
  risk_level: RiskLevel;
  proposed_command: string;
  explanation: string;
  target_id: string;
  timestamp: string;
}

export interface AgentExecutionResponse {
  event: 'EXECUTION_RESULT' | 'LOG_OUTPUT' | 'SCREENSHOT_READY' | 'STATUS_UPDATE';
  command_id: string;
  target_id: string;
  status: 'success' | 'failed' | 'error' | 'pending_approval' | 'rejected' | 'in_progress';
  output?: string;
  exit_code?: number;
  screenshot_base64?: string;
  execution_time_ms?: number;
  tool_invoked?: string;
  timestamp: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  sender: 'MOBILE_CLIENT' | 'HOST_AGENT' | 'SYSTEM_MDNS' | 'WOL_ENGINE';
  targetId: string;
  type: 'info' | 'warn' | 'error' | 'success' | 'packet';
  message: string;
  payload?: any;
}

export interface HeartbeatMetrics {
  currentLatencyMs: number | null;
  history: number[];
  jitterMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  avgLatencyMs: number;
  status: 'idle' | 'healthy' | 'warning' | 'unreachable';
}
