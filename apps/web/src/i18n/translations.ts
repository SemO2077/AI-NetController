export type Language = 'bg' | 'en';

export interface Translations {
  // Navigation
  nav_devices: string;
  nav_console: string;
  nav_gemini_ai: string;
  nav_settings: string;
  nav_connected: string;
  nav_lab: string;

  // Fleet Header & Controls
  fleet_title: string;
  fleet_subtitle: string;
  fleet_view_cards: string;
  fleet_view_topology: string;
  fleet_online: string;
  fleet_sleeping: string;
  fleet_search_placeholder: string;
  fleet_clear_search: string;
  fleet_rescan_tooltip: string;
  fleet_rescan_aria: string;
  fleet_add_host_tooltip: string;
  fleet_add_host_aria: string;
  fleet_panic_tooltip: string;
  fleet_panic_aria: string;
  fleet_spotlight_tooltip: string;
  fleet_spotlight_aria: string;

  // Filters
  filter_all: string;
  filter_online: string;
  filter_sleeping: string;
  filter_servers: string;

  // Sorting
  sort_label: string;
  sort_name: string;
  sort_status: string;
  sort_latency: string;
  sort_name_asc: string;
  sort_name_desc: string;
  sort_status_online_first: string;
  sort_status_offline_first: string;
  sort_latency_fast_first: string;
  sort_latency_slow_first: string;
  sort_title_template: string;

  // Pull to refresh
  pull_scanning: string;
  pull_release: string;
  pull_down: string;

  // Connection alert
  conn_disconnected: string;
  conn_reconnect: string;

  // Empty state
  empty_hosts_title: string;
  empty_hosts_desc: string;
  empty_hosts_btn: string;

  // Host card
  host_selected: string;
  host_quarantined: string;
  host_circuit_tripped: string;
  host_online_mdns: string;
  host_sleeping_status: string;
  host_wake_tooltip: string;
  host_terminal_tooltip: string;
  host_screen_tooltip: string;
  host_details_btn: string;
  host_hide_details_btn: string;
  host_copy_ip: string;
  host_ip_label: string;
  host_mac_label: string;
  host_port_label: string;
  host_os_label: string;
  host_disk_label: string;
  host_session_label: string;
  host_full_dialog_btn: string;
  host_screen_btn: string;
  host_terminal_btn: string;
  host_wake_btn: string;
  host_waking_seconds: string;

  // Telemetry & Latency
  latency_optimal: string;
  latency_good: string;
  latency_moderate: string;
  latency_high: string;
  latency_offline: string;
  latency_avg: string;
  latency_min_max: string;
  latency_jitter: string;
  latency_stability: string;
  latency_now: string;
  latency_offline_notice: string;
  stability_excellent: string;
  stability_stable: string;

  // Terminal
  term_agent_context: string;
  term_connected_to: string;
  term_exec_success: string;
  term_executing: string;
  term_prompt_placeholder: string;
  term_send_btn: string;
  term_view_screen: string;

  // Settings
  settings_general_title: string;
  settings_language: string;
  settings_language_desc: string;
  settings_ai_model: string;
  settings_ai_model_desc: string;
  settings_autodiscovery: string;
  settings_autodiscovery_desc: string;
  settings_hitl: string;
  settings_hitl_desc: string;
  settings_biometric: string;
  settings_biometric_desc: string;
  settings_confirmations: string;
  settings_confirmations_desc: string;
  settings_alerts: string;
  settings_alerts_desc: string;
  settings_advanced_title: string;
  settings_wol_scheduler: string;
  settings_wol_scheduler_desc: string;
  settings_ws_config: string;
  settings_ws_config_desc: string;
  settings_memory: string;
  settings_memory_desc: string;
  settings_audit_title: string;
  settings_system_logs: string;
  settings_system_logs_desc: string;
  settings_energy_calc_title: string;
  settings_active_schedules: string;
  settings_connected_hosts: string;
  settings_update_center: string;
  settings_update_center_desc: string;
  settings_code_viewer: string;
  settings_code_viewer_desc: string;

  // Energy Calculator
  calc_title: string;
  calc_collapse: string;
  calc_expand: string;
  calc_baseline_vs_wol: string;
  calc_annual_savings: string;
  calc_monthly_savings: string;
  calc_presets: string;
  calc_sync_schedules: string;
  calc_reset: string;
  calc_hosts_managed: string;
  calc_active_hours_day: string;
  calc_wake_days_week: string;
  calc_active_power: string;
  calc_standby_power: string;
  calc_electricity_rate: string;
  calc_co2_saved: string;
  calc_trees_equivalent: string;

  // Gemini Chatbot
  chat_welcome: string;
  chat_fleet_role: string;
  chat_security_role: string;
  chat_shell_role: string;
  chat_placeholder_fleet: string;
  chat_placeholder_security: string;
  chat_placeholder_shell: string;
  chat_clear_confirm: string;
  chat_stop_gen: string;
  chat_reasoning: string;

  // System Update Modal
  update_title: string;
  update_subtitle: string;
  update_check_all: string;
  update_apply_all: string;
  update_drift_title: string;
  update_last_check: string;
  update_ai_engine: string;
  update_host_daemon: string;
  update_audit_logs: string;

  // Omnibar
  omni_placeholder: string;
  omni_quick_actions: string;
  omni_devices: string;
  omni_switch_lang: string;
  omni_actions: string;
  omni_hosts: string;
  omni_ai: string;
  omni_action_rescan: string;
  omni_action_ws: string;
  omni_action_wol: string;
  omni_action_memory: string;
  omni_send_to_host: string;
  omni_console: string;
  omni_clear: string;

  // WebSocket Modal
  ws_modal_title: string;
  ws_modal_subtitle: string;
  ws_status_label: string;
  ws_connected_host: string;
  ws_lab_mode: string;
  ws_endpoint_label: string;
  ws_btn_connect: string;
  ws_btn_connecting: string;
  ws_btn_disconnect: string;
  ws_psk_label: string;
  ws_btn_show: string;
  ws_btn_hide: string;
  ws_https_warning: string;
  ws_upgrade_btn: string;
  ws_anti_replay: string;
  ws_monotonic: string;
  ws_circuit_breaker: string;
  ws_circuit_breaker_desc: string;
  ws_protocol_hint: string;

  // Latency & Sparkline Stats
  spark_avg_30s: string;
  spark_min_max: string;
  spark_jitter: string;
  spark_stability: string;
  spark_excellent: string;
  spark_stable: string;
  spark_sleeping_host: string;
  spark_now: string;
  spark_high_stability: string;
  spark_normal_variation: string;
  spark_delay_jitter: string;
  spark_unreachable: string;
  spark_rtt_now: string;
  spark_samples: string;
}

export const translations: Record<Language, Translations> = {
  bg: {
    // Navigation
    nav_devices: 'Устройства',
    nav_console: 'Конзола',
    nav_gemini_ai: 'Gemini AI',
    nav_settings: 'Настройки',
    nav_connected: 'Свързан',
    nav_lab: 'Лаборатория',

    // Fleet Header & Controls
    fleet_title: 'Мрежов флот',
    fleet_subtitle: 'Централизирано управление и отдалечено събуждане',
    fleet_view_cards: 'Карти',
    fleet_view_topology: 'Топология',
    fleet_online: 'Онлайн',
    fleet_sleeping: 'Спящи',
    fleet_search_placeholder: 'Търсене по име, IP или MAC адрес (⌘K за палитра)...',
    fleet_clear_search: 'Изчисти търсенето',
    fleet_rescan_tooltip: 'Пресканиране на локалната мрежа (mDNS)',
    fleet_rescan_aria: 'Пресканирай мрежата',
    fleet_add_host_tooltip: 'Добавяне на ново устройство',
    fleet_add_host_aria: 'Добави устройство',
    fleet_panic_tooltip: 'Авариен стоп / Прекратяване на процеси',
    fleet_panic_aria: 'Авариен стоп',
    fleet_spotlight_tooltip: 'Командна палитра (⌘K)',
    fleet_spotlight_aria: 'Командна палитра',

    // Filters
    filter_all: 'Всички',
    filter_online: 'Онлайн',
    filter_sleeping: 'Спящи',
    filter_servers: 'Сървъри',

    // Sorting
    sort_label: 'Сортиране:',
    sort_name: 'Име',
    sort_status: 'Статус',
    sort_latency: 'Латентност',
    sort_name_asc: 'А→Я',
    sort_name_desc: 'Я→А',
    sort_status_online_first: 'Онлайн',
    sort_status_offline_first: 'Спящи',
    sort_latency_fast_first: 'Бързи',
    sort_latency_slow_first: 'Бавни',
    sort_title_template: 'Сортиране по {mode}: {badge}. Натиснете за обръщане на реда.',

    // Pull to refresh
    pull_scanning: 'Сканиране на мрежата...',
    pull_release: 'Пуснете за обновяване',
    pull_down: 'Издърпайте надолу за обновяване',

    // Connection alert
    conn_disconnected: 'Връзката със сървъра е прекъсната. Повторен опит след 3 сек...',
    conn_reconnect: 'Свържи веднага',

    // Empty state
    empty_hosts_title: 'Няма намерени устройства',
    empty_hosts_desc: 'Няма активни или спящи машини, отговарящи на зададените критерии за филтриране.',
    empty_hosts_btn: 'Добави ново устройство',

    // Host card
    host_selected: 'Избрано',
    host_quarantined: 'Изолирано',
    host_circuit_tripped: 'Прекъсвач',
    host_online_mdns: 'Онлайн (mDNS)',
    host_sleeping_status: 'В спящ режим',
    host_wake_tooltip: 'Събуждане чрез магически пакет по мрежата',
    host_terminal_tooltip: 'Отваряне на отдалечен терминал',
    host_screen_tooltip: 'Преглед на отдалечения екран в реално време',
    host_details_btn: 'Детайли',
    host_hide_details_btn: 'Скрий',
    host_copy_ip: 'Копирай IP адрес',
    host_ip_label: 'IP АДРЕС',
    host_mac_label: 'MAC АДРЕС',
    host_port_label: 'AI NETCONTROLLER АГЕНТ ПОРТ',
    host_os_label: 'ОПЕРАЦИОННА СИСТЕМА',
    host_disk_label: 'ДИСКОВО ПРОСТРАНСТВО',
    host_session_label: 'СТАТУС НА СЕСИЯТА',
    host_full_dialog_btn: 'Пълен диалогов прозорец',
    host_screen_btn: 'Екран',
    host_terminal_btn: 'Терминал',
    host_wake_btn: 'Събуди през WoL',
    host_waking_seconds: 'Събуждане...',

    // Telemetry & Latency
    latency_optimal: 'Отлично закъснение (<20ms)',
    latency_good: 'Добро закъснение (20-60ms)',
    latency_moderate: 'Умерено закъснение (60-120ms)',
    latency_high: 'Високо закъснение (>120ms)',
    latency_offline: 'Спящ режим (Няма данни)',
    latency_avg: 'Средно (30с)',
    latency_min_max: 'Мин / Макс',
    latency_jitter: 'Трептене',
    latency_stability: 'Стабилност',
    latency_now: 'Сега (0с)',
    latency_offline_notice: 'Устройството е в спящ режим — няма активна телеметрия',
    stability_excellent: 'Отлична',
    stability_stable: 'Стабилна',

    // Terminal
    term_agent_context: 'Команден контекст на отдалечения агент',
    term_connected_to: 'Свързан към {name} ({os}). В готовност за изпълнение на команди.',
    term_exec_success: 'Успешно изпълнение ({time}ms)',
    term_executing: 'AI агентът изпълнява заявката...',
    term_prompt_placeholder: 'Въведете команда на естествен език или шел инструкция...',
    term_send_btn: 'Изпрати команда',
    term_view_screen: 'Екран',

    // Settings
    settings_general_title: 'ОБЩИ НАСТРОЙКИ',
    settings_language: 'ЕЗИК НА ИНТЕРФЕЙСА',
    settings_language_desc: 'Превключване между български и английски език',
    settings_ai_model: 'МОДЕЛ ЗА ОРКЕСТРАЦИЯ',
    settings_ai_model_desc: 'Модел за обработка на команди на естествен език',
    settings_autodiscovery: 'АВТОМАТИЧНО ОТКРИВАНЕ',
    settings_autodiscovery_desc: 'Непрекъснато сканиране на локалната мрежа за активни агенти',
    settings_hitl: 'ПОТВЪРЖДЕНИЕ НА КРИТИЧНИ ДЕЙСТВИЯ',
    settings_hitl_desc: 'Изискване на ръчно одобрение за операции с висок риск',
    settings_biometric: 'БИОМЕТРИЧНО ПОТВЪРЖДЕНИЕ',
    settings_biometric_desc: 'Допълнителна защита с лицево разпознаване или пръстов отпечатък',
    settings_confirmations: 'ДИАЛОЗИ ЗА ПОТВЪРЖДЕНИЕ',
    settings_confirmations_desc: 'Показване на запитване преди изпращане на пакети за събуждане',
    settings_alerts: 'СИСТЕМНИ СЪОБЩЕНИЯ',
    settings_alerts_desc: 'Известия при промяна в състоянието на мрежовите възли',
    settings_advanced_title: 'РАЗШИРЕНА КОНФИГУРАЦИЯ',
    settings_wol_scheduler: 'ГРАФИЦИ ЗА СЪБУЖДАНЕ И ЕНЕРГИЯ',
    settings_wol_scheduler_desc: 'Автоматизирани графици за събуждане и енергийна оптимизация',
    settings_ws_config: 'МРЕЖОВ ШЛЮЗ И СЪРВЪР',
    settings_ws_config_desc: 'Настройки за отдалечена телеметрия и комуникационен канал',
    settings_memory: 'СИСТЕМНИ ПРАВИЛА И ПАМЕТ',
    settings_memory_desc: 'Постоянни системни инструкции и контекстна памет за всеки хост',
    settings_audit_title: 'ОДИТ И ДНЕВНИЦИ',
    settings_system_logs: 'СИСТЕМЕН ДНЕВНИК ЗА ОДИТ',
    settings_system_logs_desc: 'Преглед на събитията от мрежовата телеметрия',
    settings_energy_calc_title: 'ЕНЕРГИЙНА ЕФЕКТИВНОСТ И СЪБУЖДАНЕ',
    settings_active_schedules: 'активни графици',
    settings_connected_hosts: 'наблюдавани устройства',
    settings_update_center: 'ЦЕНТЪР ЗА ОБНОВЯВАНИЯ',
    settings_update_center_desc: 'Проверка за нови версии и актуализации на компонентите',
    settings_code_viewer: 'ЕКСПОРТ НА КОД И ИНТЕГРАЦИИ',
    settings_code_viewer_desc: 'Генериране на системни скриптове и изпълними файлове',

    // Energy Calculator
    calc_title: 'КАЛКУЛАТОР ЗА ЕНЕРГИЙНИ СПЕСТЯВАНИЯ',
    calc_collapse: 'Свий калкулатора',
    calc_expand: 'Разгъни калкулатора',
    calc_baseline_vs_wol: 'Сравнение: денонощен режим спрямо автоматично събуждане по график',
    calc_annual_savings: 'ГОДИШНО СПЕСТЯВАНЕ',
    calc_monthly_savings: 'МЕСЕЧНО СПЕСТЯВАНЕ',
    calc_presets: 'БЪРЗИ СЦЕНАРИИ',
    calc_sync_schedules: 'Синхронизирай с графиците',
    calc_reset: 'Нулирай',
    calc_hosts_managed: 'Брой управлявани компютри:',
    calc_active_hours_day: 'Активни часове на ден:',
    calc_wake_days_week: 'Честота на събуждане (дни/седмица):',
    calc_active_power: 'Консумация в активен режим (W):',
    calc_standby_power: 'Консумация в режим на готовност (W):',
    calc_electricity_rate: 'Тарифа електроенергия (цена за kWh):',
    calc_co2_saved: 'Спестен въглероден еквивалент',
    calc_trees_equivalent: 'еквивалент засадени дървета',

    // Gemini Chatbot
    chat_welcome: 'Здравейте. Аз съм Вашият AI NetController асистент с Gemini AI. Мога да управлявам флот от работни станции, да изпращам Wake-on-LAN пакети и да анализирам телеметрия.',
    chat_fleet_role: 'Флот',
    chat_security_role: 'Сигурност',
    chat_shell_role: 'Shell',
    chat_placeholder_fleet: 'Попитайте Флот Командира...',
    chat_placeholder_security: 'Анализ на AI-NET/3.0 протокол...',
    chat_placeholder_shell: 'Бърза shell команда...',
    chat_clear_confirm: 'Разговорът е изчистен. С какво мога да съдействам?',
    chat_stop_gen: 'Спри генерирането',
    chat_reasoning: 'Gemini анализира...',

    // System Update Modal
    update_title: 'ЦЕНТЪР ЗА ОБНОВЯВАНИЯ И МОДЕЛИ',
    update_subtitle: 'Автоматична и ръчна проверка за нови версии на модели и хост демон',
    update_check_all: 'Провери всички',
    update_apply_all: 'Обнови всички',
    update_drift_title: 'Съвместимост и версии',
    update_last_check: 'Последна проверка:',
    update_ai_engine: 'Моделен двигател',
    update_host_daemon: 'Хост демон и ядро',
    update_audit_logs: 'Системен дневник на обновленията',

    // Omnibar
    omni_placeholder: 'Въведете команда, име на хост (@) или действие (>)...',
    omni_quick_actions: 'Бързи системни действия',
    omni_devices: 'Мрежови устройства',
    omni_switch_lang: 'Превключи езика на английски',
    omni_actions: '> Действия',
    omni_hosts: '@ Хостове',
    omni_ai: '/ Команди',
    omni_action_rescan: 'Пресканирай локалната мрежа',
    omni_action_ws: 'Отвори мрежова конфигурация',
    omni_action_wol: 'Събуди спящи машини (Графици)',
    omni_action_memory: 'Системни правила и памет',
    omni_send_to_host: 'Изпрати към хост {target}',
    omni_console: 'Конзола',
    omni_clear: 'Изчисти',

    // WebSocket Modal
    ws_modal_title: 'Мрежов режим и връзка',
    ws_modal_subtitle: 'Защитен протокол със защита срещу повторно предаване',
    ws_status_label: 'Статус на връзката:',
    ws_connected_host: 'Свързан с хост агент',
    ws_lab_mode: 'Симулационна лаборатория',
    ws_endpoint_label: 'Адрес на сървъра',
    ws_btn_connect: 'Свържи',
    ws_btn_connecting: 'Свързване...',
    ws_btn_disconnect: 'Прекъсни',
    ws_psk_label: 'Споделен ключ за достъп / Токен',
    ws_btn_show: 'Покажи',
    ws_btn_hide: 'Скрий',
    ws_https_warning: 'В защитена среда е препоръчително използване на криптирана връзка.',
    ws_upgrade_btn: 'Към криптирана връзка',
    ws_anti_replay: 'Защита от повторение',
    ws_monotonic: 'Монотонни броячи',
    ws_circuit_breaker: 'Авто-предпазител',
    ws_circuit_breaker_desc: 'Автоматична защита (3 опита)',
    ws_protocol_hint: 'Стандартът комбинира нулева алокация на памет за двоични кадри с взаимна токен-автентикация, криптиране и защита от преповтаряне на пакети.',

    // Latency & Sparkline Stats
    spark_avg_30s: 'Средно (30с)',
    spark_min_max: 'Мин / Макс',
    spark_jitter: 'Трептене',
    spark_stability: 'Стабилност',
    spark_excellent: 'Отлична',
    spark_stable: 'Стабилна',
    spark_sleeping_host: 'Хостът е приспан — няма активна телеметрия',
    spark_now: 'Сега (0с)',
    spark_high_stability: 'Висока стабилност',
    spark_normal_variation: 'Нормална вариация',
    spark_delay_jitter: 'Забавяне / Високо трептене',
    spark_unreachable: 'Недостъпен',
    spark_rtt_now: 'Закъснение (Сега)',
    spark_samples: 'Проби',
  },
  en: {
    // Navigation
    nav_devices: 'Devices',
    nav_console: 'Console',
    nav_gemini_ai: 'Gemini AI',
    nav_settings: 'Settings',
    nav_connected: 'Live',
    nav_lab: 'Lab',

    // Fleet Header & Controls
    fleet_title: 'Network Fleet',
    fleet_subtitle: 'Centralized management & Wake-on-LAN control',
    fleet_view_cards: 'Cards',
    fleet_view_topology: 'Topology (D3)',
    fleet_online: 'Online',
    fleet_sleeping: 'Sleeping',
    fleet_search_placeholder: 'Search by name, IP or MAC address (⌘K for palette)...',
    fleet_clear_search: 'Clear search',
    fleet_rescan_tooltip: 'Rescan local network (mDNS)',
    fleet_rescan_aria: 'Rescan network',
    fleet_add_host_tooltip: 'Add new device to fleet',
    fleet_add_host_aria: 'Add device',
    fleet_panic_tooltip: 'Emergency Stop / Kill All Processes',
    fleet_panic_aria: 'Emergency Stop',
    fleet_spotlight_tooltip: 'Command Palette (⌘K)',
    fleet_spotlight_aria: 'Command Palette',

    // Filters
    filter_all: 'All',
    filter_online: 'Online',
    filter_sleeping: 'Sleeping',
    filter_servers: 'Servers',

    // Sorting
    sort_label: 'Sort by:',
    sort_name: 'Name',
    sort_status: 'Status',
    sort_latency: 'Latency',
    sort_name_asc: 'A→Z',
    sort_name_desc: 'Z→A',
    sort_status_online_first: 'Online',
    sort_status_offline_first: 'Sleeping',
    sort_latency_fast_first: 'Fastest',
    sort_latency_slow_first: 'Slowest',
    sort_title_template: 'Sort by {mode}: {badge}. Click again to toggle order.',

    // Pull to refresh
    pull_scanning: 'Scanning network...',
    pull_release: 'Release to refresh',
    pull_down: 'Pull down to refresh',

    // Connection alert
    conn_disconnected: 'Connection lost. Retrying in 3s...',
    conn_reconnect: 'Reconnect now',

    // Empty state
    empty_hosts_title: 'No devices found',
    empty_hosts_desc: 'No active or sleeping devices match the selected filters.',
    empty_hosts_btn: 'Add new device',

    // Host card
    host_selected: 'Selected',
    host_quarantined: 'Quarantined',
    host_circuit_tripped: 'Breaker',
    host_online_mdns: 'Online (mDNS)',
    host_sleeping_status: 'Sleeping',
    host_wake_tooltip: 'Wake up device via Magic Packet',
    host_terminal_tooltip: 'Open remote shell terminal',
    host_screen_tooltip: 'Live real-time screen stream',
    host_details_btn: 'Details',
    host_hide_details_btn: 'Hide',
    host_copy_ip: 'Copy IP address',
    host_ip_label: 'IP ADDRESS',
    host_mac_label: 'MAC ADDRESS',
    host_port_label: 'AI NETCONTROLLER AGENT PORT',
    host_os_label: 'OPERATING SYSTEM',
    host_disk_label: 'STORAGE DRIVE',
    host_session_label: 'SESSION STATUS',
    host_full_dialog_btn: 'Full Dialog Window',
    host_screen_btn: 'Screen',
    host_terminal_btn: 'Terminal',
    host_wake_btn: 'Wake via WoL',
    host_waking_seconds: 'Waking...',

    // Telemetry & Latency
    latency_optimal: 'Optimal latency (<20ms)',
    latency_good: 'Good latency (20-60ms)',
    latency_moderate: 'Moderate latency (60-120ms)',
    latency_high: 'High latency (>120ms)',
    latency_offline: 'Sleeping (N/A)',
    latency_avg: 'Avg (30s)',
    latency_min_max: 'Min / Max',
    latency_jitter: 'Jitter',
    latency_stability: 'Stability',
    latency_now: 'Now (0s)',
    latency_offline_notice: 'Host is currently sleeping — no active RTT telemetry',
    stability_excellent: 'Excellent',
    stability_stable: 'Stable',

    // Terminal
    term_agent_context: 'Remote Agent Shell Context',
    term_connected_to: 'Connected to {name} ({os}). Ready for commands.',
    term_exec_success: 'Execution succeeded ({time}ms)',
    term_executing: 'AI agent is executing command...',
    term_prompt_placeholder: 'Enter natural language command or shell instruction...',
    term_send_btn: 'Send command',
    term_view_screen: 'Screen',

    // Settings
    settings_general_title: 'GENERAL SETTINGS',
    settings_language: 'INTERFACE LANGUAGE',
    settings_language_desc: 'Switch between English and Bulgarian interface language',
    settings_ai_model: 'AI ORCHESTRATION MODEL',
    settings_ai_model_desc: 'Model for understanding natural language shell requests',
    settings_autodiscovery: 'AUTO-DISCOVERY (mDNS)',
    settings_autodiscovery_desc: 'Continuously scan subnet for available agent instances',
    settings_hitl: 'HUMAN-IN-THE-LOOP (HITL)',
    settings_hitl_desc: 'Require manual authorization for high-risk operations',
    settings_biometric: 'BIOMETRIC CONFIRMATION (WEBAUTHN)',
    settings_biometric_desc: 'Hardware authentication via TouchID, FaceID or passkey',
    settings_confirmations: 'ACTION CONFIRMATIONS',
    settings_confirmations_desc: 'Show confirmation prompt before sending Wake-on-LAN packets',
    settings_alerts: 'SYSTEM STATE ALERTS',
    settings_alerts_desc: 'Push notifications upon node state transitions',
    settings_advanced_title: 'ADVANCED CONFIGURATION',
    settings_wol_scheduler: 'WAKE-ON-LAN SCHEDULES & ENERGY',
    settings_wol_scheduler_desc: 'Automated waking schedules and green energy calculator',
    settings_ws_config: 'WEBSOCKET GATEWAY & ENDPOINT',
    settings_ws_config_desc: 'Configure telemetry relay servers and WebSocket parameters',
    settings_memory: 'SYSTEM RULES & PERSISTENT MEMORY',
    settings_memory_desc: 'Global rules and behavioral constraints for the AI agent',
    settings_audit_title: 'AUDIT & LOGS',
    settings_system_logs: 'SYSTEM AUDIT LOGS',
    settings_system_logs_desc: 'Review raw WebSocket and mDNS telemetry stream entries',
    settings_energy_calc_title: 'ENERGY EFFICIENCY & WAKE-ON-LAN',
    settings_active_schedules: 'active schedules',
    settings_connected_hosts: 'monitored devices',
    settings_update_center: 'UPDATE CENTER (OTA)',
    settings_update_center_desc: 'Check for software releases and firmware patches',
    settings_code_viewer: 'CODE EXPORT & INTEGRATIONS',
    settings_code_viewer_desc: 'Generate ready-to-run Bash, Python and PowerShell code',

    // Energy Calculator
    calc_title: 'ENERGY EFFICIENCY (WOL CALCULATOR)',
    calc_collapse: 'Collapse calculator',
    calc_expand: 'Expand calculator',
    calc_baseline_vs_wol: 'Comparison: 24/7 continuous operation vs scheduled automatic wake-up',
    calc_annual_savings: 'ANNUAL SAVINGS',
    calc_monthly_savings: 'MONTHLY SAVINGS',
    calc_presets: 'QUICK PRESET SCENARIOS:',
    calc_sync_schedules: 'Sync with WoL Schedules',
    calc_reset: 'Reset',
    calc_hosts_managed: 'Number of managed PCs:',
    calc_active_hours_day: 'Active hours per day:',
    calc_wake_days_week: 'Wake frequency (days/week):',
    calc_active_power: 'Active mode power consumption (W):',
    calc_standby_power: 'Standby mode power consumption (W):',
    calc_electricity_rate: 'Electricity rate (price per kWh):',
    calc_co2_saved: 'Estimated CO₂ Saved',
    calc_trees_equivalent: 'equivalent mature trees planted',

    // Gemini Chatbot
    chat_welcome: 'Hello. I am your AI NetController fleet copilot powered by Gemini AI. I can orchestrate workstations, dispatch Wake-on-LAN packets, and inspect telemetry.',
    chat_fleet_role: 'Fleet',
    chat_security_role: 'Security',
    chat_shell_role: 'Shell',
    chat_placeholder_fleet: 'Ask Fleet Copilot...',
    chat_placeholder_security: 'Analyze AI-NET/3.0 security...',
    chat_placeholder_shell: 'Fast shell command...',
    chat_clear_confirm: 'Conversation cleared. How can I help with the fleet?',
    chat_stop_gen: 'Stop generation',
    chat_reasoning: 'Gemini reasoning...',

    // System Update Modal
    update_title: 'UPDATE CENTER & AI MODELS',
    update_subtitle: 'Automated and manual update checks for AI models and Host Daemon',
    update_check_all: 'Check All',
    update_apply_all: 'Update All',
    update_drift_title: 'Compatibility & Drift',
    update_last_check: 'Last checked:',
    update_ai_engine: 'AI Model Engine',
    update_host_daemon: 'Host Daemon & Core',
    update_audit_logs: 'System Update Audit Log',

    // Omnibar
    omni_placeholder: 'Type a command, host (@) or action (>)...',
    omni_quick_actions: 'Quick System Actions',
    omni_devices: 'Fleet Devices',
    omni_switch_lang: 'Switch interface language to Bulgarian',
    omni_actions: '> Actions',
    omni_hosts: '@ Hosts',
    omni_ai: '/ AI Prompts',
    omni_action_rescan: 'Rescan mDNS network',
    omni_action_ws: 'Open WebSocket configuration',
    omni_action_wol: 'Wake sleeping hosts (Schedules)',
    omni_action_memory: 'Context rules and memory',
    omni_send_to_host: 'Send to host {target}',
    omni_console: 'Console',
    omni_clear: 'Clear',

    // WebSocket Modal
    ws_modal_title: 'Network Mode & WebSocket',
    ws_modal_subtitle: 'AI-NET/3.0-SECURE Protocol with Anti-Replay Guard',
    ws_status_label: 'Connection Status:',
    ws_connected_host: 'Connected to Host Agent',
    ws_lab_mode: 'Standby (Host Agent Offline)',
    ws_endpoint_label: 'WebSocket Endpoint',
    ws_btn_connect: 'Connect',
    ws_btn_connecting: 'Connecting...',
    ws_btn_disconnect: 'Disconnect',
    ws_psk_label: 'Pre-Shared Key / Handshake Token',
    ws_btn_show: 'Show',
    ws_btn_hide: 'Hide',
    ws_https_warning: 'In HTTPS environments, encrypted WSS is recommended.',
    ws_upgrade_btn: 'Switch to WSS',
    ws_anti_replay: 'Anti-Replay',
    ws_monotonic: 'Monotonic Sequence',
    ws_circuit_breaker: 'Circuit Breaker',
    ws_circuit_breaker_desc: 'Auto-trip protection (3 attempts)',
    ws_protocol_hint: 'The AI-NET/3.0-SECURE standard combines zero-copy binary memory framing with mutual token authentication, TLS 1.3 and anti-replay guards.',

    // Latency & Sparkline Stats
    spark_avg_30s: 'Avg (30s)',
    spark_min_max: 'Min / Max',
    spark_jitter: 'Jitter',
    spark_stability: 'Stability',
    spark_excellent: 'Excellent',
    spark_stable: 'Stable',
    spark_sleeping_host: 'Host is sleeping — no active telemetry',
    spark_now: 'Now (0s)',
    spark_high_stability: 'High Stability',
    spark_normal_variation: 'Normal Variation',
    spark_delay_jitter: 'Latency / High Jitter',
    spark_unreachable: 'Unreachable',
    spark_rtt_now: 'RTT (Now)',
    spark_samples: 'Samples',
  },
};
