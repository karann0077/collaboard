"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMAND_TYPES = void 0;
const eventTypes_1 = require("./eventTypes");
exports.COMMAND_TYPES = {
    ...eventTypes_1.EVENT_TYPES,
    UNDO: 'undo',
    REDO: 'redo'
};
