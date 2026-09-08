"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOMAIN_EVENT_TYPES = exports.EVENT_TYPES = void 0;
exports.EVENT_TYPES = {
    STROKE_CREATED: 'stroke.created',
    SHAPE_CREATED: 'shape.created',
    TEXT_CREATED: 'text.created',
    OBJECT_UPDATED: 'object.updated',
    OBJECT_DELETED: 'object.deleted',
    BOARD_CLEARED: 'board.cleared',
    EVENT_UNDONE: 'event.undone',
    EVENT_REDONE: 'event.redone'
};
exports.DOMAIN_EVENT_TYPES = new Set([
    exports.EVENT_TYPES.STROKE_CREATED,
    exports.EVENT_TYPES.SHAPE_CREATED,
    exports.EVENT_TYPES.TEXT_CREATED,
    exports.EVENT_TYPES.OBJECT_UPDATED,
    exports.EVENT_TYPES.OBJECT_DELETED,
    exports.EVENT_TYPES.BOARD_CLEARED
]);
