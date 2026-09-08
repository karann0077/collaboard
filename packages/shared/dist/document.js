"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyDocument = createEmptyDocument;
function createEmptyDocument(version = 0) {
    return { version, objects: [] };
}
