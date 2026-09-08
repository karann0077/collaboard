import { EVENT_TYPES } from './eventTypes';

export const COMMAND_TYPES = {
  ...EVENT_TYPES,
  UNDO: 'undo',
  REDO: 'redo'
} as const;

export type CommandType = typeof COMMAND_TYPES[keyof typeof COMMAND_TYPES];
