const { DOMAIN_EVENT_TYPES } = require('@collaboard/shared');
const { AppError } = require('../utils/errors');

const EVENT_ID = /^evt_[A-Za-z0-9_-]{8,64}$/;
const OBJECT_ID = /^obj_[A-Za-z0-9_-]{8,64}$/;
const finite = (n) => Number.isFinite(n) && n >= 0 && n <= 32767;

function validatePoint(point) {
  return point && finite(point.x) && finite(point.y);
}

function validateCommand(command) {
  if (!command || typeof command !== 'object' || typeof command.requestId !== 'string' || !command.requestId) {
    throw new AppError('INVALID_PAYLOAD', 'requestId is required');
  }
  if (command.roomId !== undefined) {
    throw new AppError('INVALID_PAYLOAD', 'command.roomId must not be set by client');
  }
  if (!EVENT_ID.test(command.eventId || '')) {
    throw new AppError('INVALID_PAYLOAD', 'Invalid eventId');
  }
  if (!DOMAIN_EVENT_TYPES.has(command.type)) {
    throw new AppError('INVALID_PAYLOAD', 'Unsupported command type');
  }

  const payload = command.payload || {};
  if (typeof payload !== 'object' || Buffer.byteLength(JSON.stringify(payload)) > 64 * 1024) {
    throw new AppError('INVALID_PAYLOAD', 'Invalid payload size or format');
  }

  if (["stroke.created", "shape.created", "text.created", "object.updated", "object.deleted"].includes(command.type)) {
    if (!OBJECT_ID.test(payload.objectId || '')) throw new AppError('INVALID_PAYLOAD', 'Invalid objectId');
  }

  if (command.type === 'stroke.created') {
    if (!Array.isArray(payload.path) || payload.path.length < 1 || payload.path.length > 2000 || !payload.path.every(validatePoint)) {
      throw new AppError('INVALID_PAYLOAD', 'Invalid stroke path');
    }
  } else if (command.type === 'shape.created') {
    if (!['rect', 'circle', 'line', 'arrow'].includes(payload.type)) throw new AppError('INVALID_PAYLOAD', 'Invalid shape type');
    if (payload.type === 'rect' && (!finite(payload.x) || !finite(payload.y) || !finite(payload.w) || !finite(payload.h))) throw new AppError('INVALID_PAYLOAD', 'Invalid rect coordinates');
    if (payload.type === 'circle' && (!finite(payload.x) || !finite(payload.y) || !finite(payload.r))) throw new AppError('INVALID_PAYLOAD', 'Invalid circle coordinates');
    if (['line', 'arrow'].includes(payload.type) && (!finite(payload.x1) || !finite(payload.y1) || !finite(payload.x2) || !finite(payload.y2))) throw new AppError('INVALID_PAYLOAD', 'Invalid line coordinates');
  } else if (command.type === 'text.created') {
    if (typeof payload.text !== 'string' || payload.text.length > 1000) throw new AppError('INVALID_PAYLOAD', 'Invalid text');
    if (!finite(payload.x) || !finite(payload.y)) throw new AppError('INVALID_PAYLOAD', 'Invalid text coordinates');
  } else if (command.type === 'board.cleared') {
    if (Object.keys(payload).length > 0) throw new AppError('INVALID_PAYLOAD', 'board.cleared payload must be empty');
  }

  if (payload.width !== undefined && (!Number.isFinite(payload.width) || payload.width < 1 || payload.width > 50)) {
    throw new AppError('INVALID_PAYLOAD', 'Invalid width');
  }
  if (payload.style !== undefined && !['solid', 'dashed', 'dotted'].includes(payload.style)) {
    throw new AppError('INVALID_PAYLOAD', 'Invalid style');
  }

  return payload;
}

module.exports = { validateCommand };
