const test = require('node:test'); 
const assert = require('node:assert/strict');
const { projectEvents } = require('@collaboard/shared');

const event = (seq, eventId, eventType, payload = {}, targetEventId = null) => ({ seq, eventId, eventType, payload, targetEventId });

test('Latest-control-event multi-cycle undo/redo', () => {
  const a = event(1, 'a', 'stroke.created', { objectId: 'obj_a', path: [{x:1,y:1}], color:'#000', width:1 });
  assert.equal(projectEvents([a, event(2,'u','event.undone',{},'a'), event(3,'r','event.redone',{},'a')]).objects.length, 1);
  assert.equal(projectEvents([a, event(2,'u','event.undone',{},'a'), event(3,'r','event.redone',{},'a'), event(4,'u2','event.undone',{},'a')]).objects.length, 0);
});

test('Undoable clear', () => {
  const events = [event(1,'a','shape.created',{objectId:'obj_a',type:'rect'}), event(2,'clear','board.cleared'), event(3,'undo','event.undone',{},'clear')];
  assert.equal(projectEvents(events).objects.length, 1);
});

test('Independent reversibility', () => {
  // A creates obj_1, B updates obj_1. Undo A. Projection should have no objects, B is a no-op.
  const events = [
    event(1,'a','shape.created',{objectId:'obj_1',type:'rect'}),
    event(2,'b','object.updated',{objectId:'obj_1', patch:{color:'#red'}}),
    event(3,'undoA','event.undone',{},'a')
  ];
  assert.equal(projectEvents(events).objects.length, 0);
});

