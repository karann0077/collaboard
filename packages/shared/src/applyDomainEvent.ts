import { DocumentModel, DrawableObject, createEmptyDocument } from './document';
import { EVENT_TYPES, DOMAIN_EVENT_TYPES } from './eventTypes';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function applyDomainEvent(document: DocumentModel, event: any): DocumentModel {
  const doc: DocumentModel = { version: document.version, objects: document.objects.map(clone) };
  const payload = event.payload || {};

  if ([EVENT_TYPES.STROKE_CREATED, EVENT_TYPES.SHAPE_CREATED, EVENT_TYPES.TEXT_CREATED].includes(event.eventType)) {
    doc.objects.push(clone(payload) as DrawableObject);
  } else if (event.eventType === EVENT_TYPES.OBJECT_UPDATED) {
    const index = doc.objects.findIndex((object) => object.objectId === payload.objectId);
    if (index >= 0) {
      doc.objects[index] = { ...doc.objects[index], ...clone(payload.patch || {}) };
    }
  } else if (event.eventType === EVENT_TYPES.OBJECT_DELETED) {
    doc.objects = doc.objects.filter((object) => object.objectId !== payload.objectId);
  } else if (event.eventType === EVENT_TYPES.BOARD_CLEARED) {
    doc.objects = [];
  }
  return doc;
}

export function projectEvents(events: any[]): DocumentModel {
  const ordered = [...events].sort((a, b) => Number(a.seq) - Number(b.seq));
  const domains = new Map<string, any>();
  const controls = new Map<string, any>();

  for (const event of ordered) {
    if (event.eventType === EVENT_TYPES.EVENT_UNDONE || event.eventType === EVENT_TYPES.EVENT_REDONE) {
      controls.set(event.targetEventId || event.target_event_id, event);
    } else if (DOMAIN_EVENT_TYPES.has(event.eventType)) {
      domains.set(event.eventId || event.event_id, event);
    }
  }

  let document = createEmptyDocument();
  for (const [eventId, event] of domains) {
    const control = controls.get(eventId);
    if (!control || control.eventType === EVENT_TYPES.EVENT_REDONE) {
      document = applyDomainEvent(document, event);
    }
  }
  document.version = ordered.length ? Number(ordered[ordered.length - 1].seq) : 0;
  return document;
}
