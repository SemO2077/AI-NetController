export interface CommandPreset {
  id: string;
  label: string;
  command: string;
  description: string;
  iconType: 'info' | 'network' | 'folder' | 'ai' | 'terminal';
  isDangerous?: boolean;
}

export const QUICK_ACTIONS: CommandPreset[] = [
  {
    id: 'sysinfo',
    label: 'Информация за системата',
    command: 'systeminfo',
    description: 'Хардуер, ОС версия и пачове',
    iconType: 'info'
  },
  {
    id: 'netstat',
    label: 'Мрежов статус',
    command: 'ipconfig /all',
    description: 'IP, MAC, Gateway и DNS',
    iconType: 'network'
  },
  {
    id: 'dirtree',
    label: 'Файлова структура',
    command: 'dir C:\\',
    description: 'Коренова директория C:\\',
    iconType: 'folder'
  },
  {
    id: 'ai-diag',
    label: 'AI Диагностика',
    command: 'AI Диагностика: анализирай здравето на операционната система и отворените процеси',
    description: 'Оценка на здравето чрез LLM',
    iconType: 'ai'
  }
];

export const DESTRUCTIVE_ACTIONS = [
  {
    id: 'reboot',
    label: 'Рестарт',
    command: 'shutdown /r /t 0',
    accentColor: '#ffb800',
    isDestructive: true
  },
  {
    id: 'sleep',
    label: 'Приспиване',
    command: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
    accentColor: '#ffb800',
    isDestructive: true
  },
  {
    id: 'panic',
    label: 'Panic: Прекрати всички',
    command: 'taskkill /f /fi "status eq running"',
    accentColor: '#ff2a6d',
    isDestructive: true
  }
];
