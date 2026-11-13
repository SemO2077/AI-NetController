import { HostDevice, Weekday, WolPacketPayload, WolSchedule } from '../types';

export const STORAGE_KEY_WOL_SCHEDULES = 'ai_netcontroller_wol_schedules_v1';
export const LEGACY_STORAGE_KEY_WOL_SCHEDULES = 'cst_wol_schedules_config_v1';

export const DEFAULT_WOL_SCHEDULES: WolSchedule[] = [];

export const WEEKDAYS_MAP: {
  id: Weekday;
  label: string;
  labelEn: string;
  short: string;
  shortBg: string;
  letterEn: string;
  letterBg: string;
  dayIndex: number;
}[] = [
  { id: 'mon', label: 'Понеделник', labelEn: 'Monday', short: 'Mon', shortBg: 'Пон', letterEn: 'M', letterBg: 'П', dayIndex: 1 },
  { id: 'tue', label: 'Вторник', labelEn: 'Tuesday', short: 'Tue', shortBg: 'Вто', letterEn: 'T', letterBg: 'В', dayIndex: 2 },
  { id: 'wed', label: 'Сряда', labelEn: 'Wednesday', short: 'Wed', shortBg: 'Сря', letterEn: 'W', letterBg: 'С', dayIndex: 3 },
  { id: 'thu', label: 'Четвъртък', labelEn: 'Thursday', short: 'Thu', shortBg: 'Чет', letterEn: 'T', letterBg: 'Ч', dayIndex: 4 },
  { id: 'fri', label: 'Петък', labelEn: 'Friday', short: 'Fri', shortBg: 'Пет', letterEn: 'F', letterBg: 'П', dayIndex: 5 },
  { id: 'sat', label: 'Събота', labelEn: 'Saturday', short: 'Sat', shortBg: 'Съб', letterEn: 'S', letterBg: 'С', dayIndex: 6 },
  { id: 'sun', label: 'Неделя', labelEn: 'Sunday', short: 'Sun', shortBg: 'Нед', letterEn: 'S', letterBg: 'Н', dayIndex: 0 }
];

const SCHEDULE_TRANSLATIONS: Record<
  string,
  { nameEn: string; nameBg: string; notesEn: string; notesBg: string }
> = {
  'sched-lab-morning-01': {
    nameEn: 'Wake Lab PCs (Morning Schedule)',
    nameBg: 'Събуждане на залата (Сутрешен график)',
    notesEn: 'Automated recurring wake-up for lab workstations prior to morning sessions',
    notesBg: 'Автоматично сутрешно събуждане на работните станции преди учебните занятия',
  },
  'sched-home-sync-02': {
    nameEn: 'Home Workstation Daily Warm-Up',
    nameBg: 'Ежедневно събуждане на домашната станция',
    notesEn: 'Wake host for remote backup sync and agent heartbeats',
    notesBg: 'Събуждане на хоста за архивиране и синхронизация на демона',
  },
  'sched-fleet-night-03': {
    nameEn: 'Weekend Fleet Security Audit Wake',
    nameBg: 'Събуждане за седмичен одит на сигурността',
    notesEn: 'Wakes all sleeping nodes for weekly unattended security updates',
    notesBg: 'Събужда всички спящи компютри за седмични обновления за сигурност',
  },
};

export function localizeWolSchedule(
  schedule: WolSchedule,
  lang: 'bg' | 'en' = 'en'
): { name: string; notes: string; targetLabel: string } {
  const isBg = lang === 'bg';
  const preset = SCHEDULE_TRANSLATIONS[schedule.id];

  let name = schedule.name;
  let notes = schedule.notes || '';

  if (preset) {
    name = isBg ? preset.nameBg : preset.nameEn;
    notes = isBg ? preset.notesBg : preset.notesEn;
  } else {
    // Also translate common default names if user created one with default form value
    if (
      (name === 'Wake Lab PCs (08:00 AM)' || name === 'Wake Lab PCs (Morning Schedule)') &&
      isBg
    ) {
      name = 'Събуждане на залата (08:00)';
    } else if (name === 'Събуждане на залата (08:00)' && !isBg) {
      name = 'Wake Lab PCs (08:00)';
    }
    if (notes === 'Automated recurring wake-up for university lab sessions' && isBg) {
      notes = 'Автоматично събуждане за лабораторни занятия';
    } else if (notes === 'Автоматично събуждане за лабораторни занятия' && !isBg) {
      notes = 'Automated recurring wake-up for university lab sessions';
    }
  }

  let targetLabel = '';
  if (schedule.targetType === 'all_lab') {
    targetLabel = isBg ? 'Лабораторни компютри' : 'Lab Workstations';
  } else if (schedule.targetType === 'all_offline') {
    targetLabel = isBg ? 'Всички спящи хостове' : 'All Sleeping Hosts';
  } else if (schedule.targetType === 'all_hosts') {
    targetLabel = isBg ? 'Всички компютри във флота' : 'All Fleet Hosts';
  } else if (schedule.targetType === 'specific_device') {
    targetLabel = schedule.targetDeviceId || (isBg ? 'Избран хост' : 'Specific Host');
  } else {
    targetLabel = schedule.targetMac || 'MAC';
  }

  return {
    name,
    notes:
      notes ||
      (isBg
        ? 'Автоматично изпращане на пакет за събуждане по мрежата.'
        : 'Automated network wake packet broadcast.'),
    targetLabel,
  };
}

/**
 * Loads recurring WoL schedules from persistent localStorage.
 * Automatically seeds defaults if no configuration exists.
 */
export function loadWolSchedules(): WolSchedule[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY_WOL_SCHEDULES) ||
      localStorage.getItem(LEGACY_STORAGE_KEY_WOL_SCHEDULES);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (e) {
    console.error('Failed to parse persistent WoL schedules from localStorage:', e);
    return [];
  }
}

/**
 * Persists recurring WoL schedules to localStorage.
 */
export function saveWolSchedules(schedules: WolSchedule[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_WOL_SCHEDULES, JSON.stringify(schedules));
  } catch (e) {
    console.error('Failed to persist WoL schedules to localStorage:', e);
  }
}

/**
 * Resolves target devices matching a schedule's targeting policy.
 */
export function resolveScheduleTargets(
  schedule: WolSchedule,
  hosts: HostDevice[] = []
): { id: string; name: string; mac: string; ip: string }[] {
  const safeHosts = Array.isArray(hosts) ? hosts : [];

  switch (schedule.targetType) {
    case 'all_lab': {
      const labHosts = safeHosts.filter(
        h =>
          h.tags?.some(t => t?.toLowerCase() === 'lab') ||
          h.name?.toLowerCase().includes('lab') ||
          h.id?.toLowerCase().includes('lab')
      );
      return labHosts.map(h => ({ id: h.id, name: h.name, mac: h.mac, ip: h.ip }));
    }

    case 'all_offline': {
      const offline = safeHosts.filter(h => !h.isOnline);
      return offline.map(h => ({ id: h.id, name: h.name, mac: h.mac, ip: h.ip }));
    }

    case 'all_hosts': {
      return safeHosts.map(h => ({ id: h.id, name: h.name, mac: h.mac, ip: h.ip }));
    }

    case 'specific_device': {
      const target = safeHosts.find(
        h => h.id === schedule.targetDeviceId || (schedule.targetMac && h.mac === schedule.targetMac)
      );
      if (target) {
        return [{ id: target.id, name: target.name, mac: target.mac, ip: target.ip }];
      }
      if (schedule.targetMac) {
        return [{
          id: schedule.targetDeviceId || 'CUSTOM-TARGET',
          name: schedule.targetName || 'Specific Target Host',
          mac: schedule.targetMac,
          ip: schedule.broadcastIp || '255.255.255.255'
        }];
      }
      return [];
    }

    case 'custom_mac': {
      if (!schedule.targetMac || !schedule.targetMac.trim()) {
        return [];
      }
      return [{
        id: 'CUSTOM-MAC',
        name: schedule.targetName || 'Custom NIC Target',
        mac: schedule.targetMac.trim(),
        ip: schedule.broadcastIp || '255.255.255.255'
      }];
    }

    default:
      return [];
  }
}

/**
 * Calculates human-readable summary of recurring days in BG or EN.
 */
export function formatDaysSummary(days: Weekday[], lang: 'bg' | 'en' = 'en'): string {
  const isBg = lang === 'bg';
  if (!days || days.length === 0) return isBg ? 'Няма избрани дни' : 'No days selected';
  if (days.length === 7) return isBg ? 'Всеки ден (Пон – Нед)' : 'Every day (Mon – Sun)';
  const weekdays: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const weekends: Weekday[] = ['sat', 'sun'];

  const isWeekdays = weekdays.every(d => days.includes(d)) && days.length === 5;
  if (isWeekdays) return isBg ? 'Делнични дни (Пон – Пет)' : 'Weekdays (Mon – Fri)';

  const isWeekends = weekends.every(d => days.includes(d)) && days.length === 2;
  if (isWeekends) return isBg ? 'Уикенд (Съб – Нед)' : 'Weekends (Sat – Sun)';

  return WEEKDAYS_MAP.filter(d => days.includes(d.id))
    .map(d => (isBg ? d.shortBg : d.short))
    .join(', ');
}

/**
 * Formats "08:00" to clean 24h time string.
 */
export function formatTimeDisplay(timeStr: string): string {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return timeStr || '--:--';
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  if (isNaN(h) || h < 0 || h > 23) return timeStr;
  const m = (mStr || '00').padStart(2, '0').slice(0, 2);
  return `${h.toString().padStart(2, '0')}:${m}`;
}

/**
 * Calculates next upcoming run time for a recurring schedule in BG or EN.
 */
export function calculateNextRun(
  schedule: WolSchedule,
  referenceDate: Date = new Date(),
  lang: 'bg' | 'en' = 'en'
): { nextDate: Date; relativeText: string; timeUntilFormatted: string } | null {
  if (!schedule || !schedule.days || schedule.days.length === 0 || !schedule.time || !schedule.time.includes(':')) {
    return null;
  }

  const isBg = lang === 'bg';
  const [targetH, targetM] = schedule.time.split(':').map(Number);
  if (isNaN(targetH) || isNaN(targetM) || targetH < 0 || targetH > 23 || targetM < 0 || targetM > 59) {
    return null;
  }

  const dayIndexMap: Record<Weekday, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6
  };

  const allowedDayIndices = new Set(schedule.days.map(d => dayIndexMap[d]));

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(referenceDate);
    candidate.setDate(referenceDate.getDate() + offset);
    candidate.setHours(targetH, targetM, 0, 0);

    const dayIndex = candidate.getDay();
    if (allowedDayIndices.has(dayIndex)) {
      if (candidate.getTime() > referenceDate.getTime()) {
        const diffMs = candidate.getTime() - referenceDate.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMins / 60);
        const remMins = diffMins % 60;

        let timeUntil = '';
        if (diffHours > 0) {
          timeUntil = isBg ? `${diffHours}ч ${remMins}м` : `${diffHours}h ${remMins}m`;
        } else if (diffMins === 0 && diffMs > 0) {
          timeUntil = isBg ? '< 1м' : '< 1m';
        } else {
          timeUntil = isBg ? `${diffMins}м` : `${diffMins}m`;
        }

        let dayLabel = '';
        if (offset === 0) {
          dayLabel = isBg ? 'Днес' : 'Today';
        } else if (offset === 1) {
          dayLabel = isBg ? 'Утре' : 'Tomorrow';
        } else {
          const dayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const dayNamesBg = ['Неделя', 'Понеделник', 'Вторник', 'Сряда', 'Четвъртък', 'Петък', 'Събота'];
          dayLabel = isBg ? dayNamesBg[dayIndex] : dayNamesEn[dayIndex];
        }

        return {
          nextDate: candidate,
          relativeText: isBg ? `${dayLabel} в ${schedule.time}` : `${dayLabel} at ${schedule.time}`,
          timeUntilFormatted: timeUntil
        };
      }
    }
  }

  return null;
}

// Pre-computed 256-entry hexadecimal lookup table for O(1) byte-to-hex serialization
const HEX_LUT: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0').toUpperCase()
);

// Fast ASCII character code to hex nibble value (-1 if not hex)
function hexCharToNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48; // '0'-'9'
  if (code >= 65 && code <= 70) return code - 55; // 'A'-'F'
  if (code >= 97 && code <= 102) return code - 87; // 'a'-'f'
  return -1;
}

// Fast 6-byte (12 hex char) parser into Uint8Array without regex allocations
const SCRATCH_MAC_BYTES = new Uint8Array(6);
const SCRATCH_PWD_BYTES = new Uint8Array(6);

function parseSixHexBytes(input: string, out: Uint8Array): boolean {
  let nibbleCount = 0;
  let highNibble = 0;
  const len = input.length;
  for (let i = 0; i < len; i++) {
    const ch = input.charCodeAt(i);
    const nib = hexCharToNibble(ch);
    if (nib === -1) {
      // Allow standard MAC/SecureOn delimiters (':', '-', '.') and space; reject arbitrary non-hex characters
      if (ch === 58 || ch === 45 || ch === 46 || ch === 32) continue;
      return false;
    }
    if (nibbleCount >= 12) return false;
    if ((nibbleCount & 1) === 0) {
      highNibble = nib;
    } else {
      const byteIdx = nibbleCount >> 1;
      out[byteIdx] = (highNibble << 4) | nib;
    }
    nibbleCount++;
  }
  return nibbleCount === 12;
}

function formatCurrentTimeHHMMSS(): string {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const s = now.getSeconds();
  const hStr = h < 10 ? `0${h}` : `${h}`;
  const mStr = m < 10 ? `0${m}` : `${m}`;
  const sStr = s < 10 ? `0${s}` : `${s}`;
  return `${hStr}:${mStr}:${sStr}`;
}

export function normalizeMac(mac: string): string | null {
  if (!mac || typeof mac !== 'string') return null;
  if (!parseSixHexBytes(mac, SCRATCH_MAC_BYTES)) return null;
  return `${HEX_LUT[SCRATCH_MAC_BYTES[0]]}:${HEX_LUT[SCRATCH_MAC_BYTES[1]]}:${HEX_LUT[SCRATCH_MAC_BYTES[2]]}:${HEX_LUT[SCRATCH_MAC_BYTES[3]]}:${HEX_LUT[SCRATCH_MAC_BYTES[4]]}:${HEX_LUT[SCRATCH_MAC_BYTES[5]]}`;
}

/**
 * Generates an Ethernet Magic Packet (102 bytes standard, or 108 bytes with SecureOn password):
 * - 6 bytes of 0xFF
 * - 16 repetitions of the 6-byte target MAC address
 * - Optional 6-byte SecureOn password (AMD WoL security standard)
 *
 * Optimized with a 256-byte HEX_LUT and fast nibble parser (0 regex allocations, 0 Intl instantiations).
 */
export function generateMagicPacket(
  mac: string,
  broadcastIp: string = '255.255.255.255',
  port: number = 9,
  secureOnPassword?: string
): WolPacketPayload {
  if (!mac || typeof mac !== 'string' || !parseSixHexBytes(mac, SCRATCH_MAC_BYTES)) {
    throw new Error('Invalid MAC address. Must contain exactly 12 hexadecimal characters.');
  }

  const m0 = SCRATCH_MAC_BYTES[0];
  const m1 = SCRATCH_MAC_BYTES[1];
  const m2 = SCRATCH_MAC_BYTES[2];
  const m3 = SCRATCH_MAC_BYTES[3];
  const m4 = SCRATCH_MAC_BYTES[4];
  const m5 = SCRATCH_MAC_BYTES[5];

  const safePort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 9;
  const safeIp =
    broadcastIp && typeof broadcastIp === 'string' && broadcastIp.trim()
      ? broadcastIp.trim()
      : '255.255.255.255';

  let hasSecureOn = false;
  if (secureOnPassword !== undefined && secureOnPassword !== null && secureOnPassword !== '') {
    if (typeof secureOnPassword !== 'string' || !parseSixHexBytes(secureOnPassword, SCRATCH_PWD_BYTES)) {
      throw new Error('SecureOn password must contain exactly 12 hexadecimal characters.');
    }
    hasSecureOn = true;
  }

  const totalLength = hasSecureOn ? 108 : 102;
  const h0 = HEX_LUT[m0];
  const h1 = HEX_LUT[m1];
  const h2 = HEX_LUT[m2];
  const h3 = HEX_LUT[m3];
  const h4 = HEX_LUT[m4];
  const h5 = HEX_LUT[m5];

  const normalizedMac = `${h0}:${h1}:${h2}:${h3}:${h4}:${h5}`;
  const macHexSpaced = `${h0} ${h1} ${h2} ${h3} ${h4} ${h5}`;

  // Construct 16 repetitions of MAC hex string in O(1) string concatenations
  const mac2 = `${macHexSpaced} ${macHexSpaced}`;
  const mac4 = `${mac2} ${mac2}`;
  const mac8 = `${mac4} ${mac4}`;
  const mac16 = `${mac8} ${mac8}`;

  let rawHex = `FF FF FF FF FF FF ${mac16}`;
  let normalizedSecureOn: string | undefined;
  if (hasSecureOn) {
    const p0 = HEX_LUT[SCRATCH_PWD_BYTES[0]];
    const p1 = HEX_LUT[SCRATCH_PWD_BYTES[1]];
    const p2 = HEX_LUT[SCRATCH_PWD_BYTES[2]];
    const p3 = HEX_LUT[SCRATCH_PWD_BYTES[3]];
    const p4 = HEX_LUT[SCRATCH_PWD_BYTES[4]];
    const p5 = HEX_LUT[SCRATCH_PWD_BYTES[5]];
    rawHex = `${rawHex} ${p0} ${p1} ${p2} ${p3} ${p4} ${p5}`;
    normalizedSecureOn = `${p0}:${p1}:${p2}:${p3}:${p4}:${p5}`;
  }

  return {
    mac: normalizedMac,
    broadcastIp: safeIp,
    port: safePort,
    ...(normalizedSecureOn ? { secureOn: normalizedSecureOn } : {}),
    rawHex,
    bytesCount: totalLength,
    timestamp: formatCurrentTimeHHMMSS(),
  };
}

export function formatHexDump(hexString: string): string[] {
  const bytes = hexString.split(' ');
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, i + 16);
    const offsetHex = i.toString(16).padStart(4, '0').toUpperCase();
    const hexGroup = chunk.join(' ');
    lines.push(`${offsetHex}  ${hexGroup}`);
  }
  return lines;
}
