export const EVENT_TYPES = {
  STROKE_CREATED: 'stroke.created',
  SHAPE_CREATED: 'shape.created',
  TEXT_CREATED: 'text.created',
  OBJECT_UPDATED: 'object.updated',
  OBJECT_DELETED: 'object.deleted',
  BOARD_CLEARED: 'board.cleared',
  EVENT_UNDONE: 'event.undone',
  EVENT_REDONE: 'event.redone'
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

export const DOMAIN_EVENT_TYPES = new Set<string>([
  EVENT_TYPES.STROKE_CREATED,
  EVENT_TYPES.SHAPE_CREATED,
  EVENT_TYPES.TEXT_CREATED,
  EVENT_TYPES.OBJECT_UPDATED,
  EVENT_TYPES.OBJECT_DELETED,
  EVENT_TYPES.BOARD_CLEARED
]);
