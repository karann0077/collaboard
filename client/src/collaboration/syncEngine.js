import { applyDomainEvent, createEmptyDocument } from '../../../packages/shared/src/index.ts';

export function createSyncEngine({ onChange, requestSync }) {
  let document = createEmptyDocument(); let lastAppliedSeq = 0; let syncing = true; let buffered = [];
  const publish = () => onChange({ document, lastAppliedSeq, syncing });
  function apply(event) {
    if (event.seq <= lastAppliedSeq) return;
    if (event.seq > lastAppliedSeq + 1) { syncing = true; buffered.push(event); requestSync(lastAppliedSeq); publish(); return; }
    document = applyDomainEvent(document, event); document.version = event.seq; lastAppliedSeq = event.seq; publish();
  }
  return {
    receive(event) { if (syncing) buffered.push(event); else apply(event); },
    install(documentState, version) { if (version < lastAppliedSeq) return false; document = documentState; document.version = version; lastAppliedSeq = version; syncing = false; const pending = buffered.sort((a, b) => a.seq - b.seq); buffered = []; pending.forEach(apply); publish(); return true; },
    reset() { document = createEmptyDocument(); lastAppliedSeq = 0; syncing = true; buffered = []; publish(); },
    state() { return { document, lastAppliedSeq, syncing }; }
  };
}
