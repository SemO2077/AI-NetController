export type SimulatedWindowType = 'default' | 'task_manager' | 'file_explorer' | 'browser' | 'desktop' | 'locked';

export interface ScreenSimulationState {
  activeWindow?: SimulatedWindowType;
  lastCommandLine?: string;
  lastTypedText?: string;
  browserUrl?: string;
}
