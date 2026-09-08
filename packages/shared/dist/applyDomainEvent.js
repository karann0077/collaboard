"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyDomainEvent = applyDomainEvent;
exports.projectEvents = projectEvents;
const document_1 = require("./document");
const eventTypes_1 = require("./eventTypes");
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function applyDomainEvent(document, event) {
    const doc = { version: document.version, objects: document.objects.map(clone) };
    const payload = event.payload || {};
    if ([eventTypes_1.EVENT_TYPES.STROKE_CREATED, eventTypes_1.EVENT_TYPES.SHAPE_CREATED, eventTypes_1.EVENT_TYPES.TEXT_CREATED].includes(event.eventType)) {
        doc.objects.push(clone(payload));
    }
    else if (event.eventType === eventTypes_1.EVENT_TYPES.OBJECT_UPDATED) {
        const index = doc.objects.findIndex((object) => object.objectId === payload.objectId);
        if (index >= 0) {
            doc.objects[index] = { ...doc.objects[index], ...clone(payload.patch || {}) };
        }
    }
    else if (event.eventType === eventTypes_1.EVENT_TYPES.OBJECT_DELETED) {
        doc.objects = doc.objects.filter((object) => object.objectId !== payload.objectId);
    }
    else if (event.eventType === eventTypes_1.EVENT_TYPES.BOARD_CLEARED) {
        doc.objects = [];
    }
    return doc;
}
function projectEvents(events) {
    const ordered = [...events].sort((a, b) => Number(a.seq) - Number(b.seq));
    const domains = new Map();
    const controls = new Map();
    for (const event of ordered) {
        if (event.eventType === eventTypes_1.EVENT_TYPES.EVENT_UNDONE || event.eventType === eventTypes_1.EVENT_TYPES.EVENT_REDONE) {
            controls.set(event.targetEventId || event.target_event_id, event);
        }
        else if (eventTypes_1.DOMAIN_EVENT_TYPES.has(event.eventType)) {
            domains.set(event.eventId || event.event_id, event);
        }
    }
    let document = (0, document_1.createEmptyDocument)();
    for (const [eventId, event] of domains) {
        const control = controls.get(eventId);
        if (!control || control.eventType === eventTypes_1.EVENT_TYPES.EVENT_REDONE) {
            document = applyDomainEvent(document, event);
        }
    }
    document.version = ordered.length ? Number(ordered[ordered.length - 1].seq) : 0;
    return document;
}
