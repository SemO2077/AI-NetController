export interface CommandPreset {
  id: string;
  label: string;
  labelEn?: string;
  command: string;
  commandEn?: string;
  commandLinux?: string;
  description: string;
  descriptionEn?: string;
  iconType: 'info' | 'network' | 'folder' | 'ai' | 'terminal';
  isDangerous?: boolean;
}

export const QUICK_ACTIONS: CommandPreset[] = [
  {
    id: 'sysinfo',
    label: 'Информация за системата',
    labelEn: 'System Information',
    command: 'systeminfo',
    commandLinux: 'uname -a && uptime',
    description: 'Хардуер, ОС версия и пачове',
    descriptionEn: 'Hardware specs, OS version & uptime',
    iconType: 'info'
  },
  {
    id: 'netstat',
    label: 'Мрежов статус',
    labelEn: 'Network Interfaces',
    command: 'ipconfig /all',
    commandLinux: 'ip -brief addr show',
    description: 'IP, MAC, Gateway и DNS',
    descriptionEn: 'IP, MAC, Gateway & DNS adapters',
    iconType: 'network'
  },
  {
    id: 'processes',
    label: 'Топ процеси (CPU/RAM)',
    labelEn: 'Top Processes (CPU/RAM)',
    command: 'tasklist /fo table',
    commandLinux: 'ps aux --sort=-%cpu | head -n 15',
    description: 'Активни процеси и натоварване',
    descriptionEn: 'Running processes & resource usage',
    iconType: 'terminal'
  },
  {
    id: 'diskhealth',
    label: 'Диск и памет',
    labelEn: 'Disk & Memory Status',
    command: 'wmic logicaldisk get size,freespace,caption',
    commandLinux: 'df -h && free -h',
    description: 'Свободно дисково пространство и RAM',
    descriptionEn: 'Free storage volumes & RAM overview',
    iconType: 'folder'
  },
  {
    id: 'dirtree',
    label: 'Файлова структура',
    labelEn: 'Root Directory Tree',
    command: 'dir C:\\',
    commandLinux: 'ls -la /',
    description: 'Коренова директория C:\\',
    descriptionEn: 'Inspect root directory contents',
    iconType: 'folder'
  },
  {
    id: 'ai-diag',
    label: 'AI Диагностика',
    labelEn: 'AI System Diagnostics',
    command: 'AI Диагностика: анализирай здравето на операционната система и отворените процеси',
    commandEn: 'AI Diagnostics: analyze operating system health, resource load, and running processes',
    description: 'Оценка на здравето чрез LLM',
    descriptionEn: 'LLM-powered host health & triage report',
    iconType: 'ai'
  }
];

export function getLocalizedPreset(
  preset: CommandPreset,
  language: 'bg' | 'en',
  os?: 'windows' | 'linux'
): { label: string; description: string; command: string } {
  const isBg = language === 'bg';
  const label = isBg ? preset.label : preset.labelEn || preset.label;
  const description = isBg ? preset.description : preset.descriptionEn || preset.description;
  const command =
    os === 'linux' && preset.commandLinux
      ? preset.commandLinux
      : !isBg && preset.commandEn
      ? preset.commandEn
      : preset.command;
  return { label, description, command };
}

export const DESTRUCTIVE_ACTIONS = [
  {
    id: 'reboot',
    label: 'Рестарт',
    labelEn: 'Restart Host',
    command: 'shutdown /r /t 0',
    commandLinux: 'sudo shutdown -r now',
    accentColor: '#ffb800',
    isDestructive: true
  },
  {
    id: 'sleep',
    label: 'Приспиване',
    labelEn: 'Sleep / Suspend',
    command: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
    commandLinux: 'systemctl suspend',
    accentColor: '#ffb800',
    isDestructive: true
  },
  {
    id: 'panic',
    label: 'Panic: Прекрати всички',
    labelEn: 'Panic: Terminate All',
    command: 'taskkill /f /fi "status eq running"',
    commandLinux: 'pkill -9 -u $USER',
    accentColor: '#ff2a6d',
    isDestructive: true
  }
];
