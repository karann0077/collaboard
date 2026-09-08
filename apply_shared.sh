#!/bin/bash
set -e

cd /Users/DELL/Desktop/collab_board/packages/shared

# Initialize package
cat << 'PKG' > package.json
{
  "name": "@collaboard/shared",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
PKG

cat << 'TSCONF' > tsconfig.json
{
  "compilerOptions": {
    "target": "es2020",
    "module": "commonjs",
    "declaration": true,
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
TSCONF

mkdir -p src

cat << 'SRC' > src/eventTypes.ts
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
SRC

cat << 'SRC' > src/commandTypes.ts
import { EVENT_TYPES } from './eventTypes';

export const COMMAND_TYPES = {
  ...EVENT_TYPES,
  UNDO: 'undo',
  REDO: 'redo'
} as const;

export type CommandType = typeof COMMAND_TYPES[keyof typeof COMMAND_TYPES];
SRC

cat << 'SRC' > src/document.ts
export interface Point { x: number; y: number; }

export interface BaseObject {
  objectId: string;
  color?: string;
  width?: number;
  style?: 'solid' | 'dashed' | 'dotted';
}

export interface StrokeObject extends BaseObject {
  path: Point[];
}

export interface ShapeObject extends BaseObject {
  type: 'rect' | 'circle' | 'line' | 'arrow';
  x?: number; y?: number; w?: number; h?: number; r?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
}

export interface TextObject extends BaseObject {
  type: 'text';
  text: string;
  x: number;
  y: number;
  fontSize?: number;
}

export type DrawableObject = StrokeObject | ShapeObject | TextObject;

export interface DocumentModel {
  version: number;
  objects: DrawableObject[];
}

export function createEmptyDocument(version = 0): DocumentModel {
  return { version, objects: [] };
}
SRC

cat << 'SRC' > src/applyDomainEvent.ts
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
SRC

cat << 'SRC' > src/index.ts
export * from './eventTypes';
export * from './commandTypes';
export * from './document';
export * from './applyDomainEvent';
SRC

npm install
npm run build

# Remove old JS files
rm -f index.js browser.js
echo "Shared package successfully rebuilt as TypeScript."
