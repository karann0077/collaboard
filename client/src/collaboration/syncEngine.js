import { applyDomainEvent, projectEvents } from '../../../packages/shared/src/applyDomainEvent.ts';
import { createEmptyDocument } from '../../../packages/shared/src/document.ts';

/**
 * createSyncEngine — manages the client-side document replica.
 *
 * State machine:
 *   syncing=true  → buffering live events; waiting for a full sync to be installed
 *   syncing=false → applying live events in order
 *
 * Bug #3 fix: added applySyncedEvents() — the proper handler for sync-response events.
 * Previously the hook called receive() for each recovered event, which pushed them
 * back into the buffer and never set syncing=false.
 */
export function createSyncEngine({ onChange, requestSync }) {
  let document = createEmptyDocument();
  let lastAppliedSeq = 0;
  let syncing = true;       // starts true until first install() from initial-state
  let buffered = [];

  const publish = () => onChange({ document, lastAppliedSeq, syncing });

  /** Apply a single domain event to local state (internal). */
  function applyOne(event) {
    if (event.seq <= lastAppliedSeq) return;        // already have it
    if (event.seq > lastAppliedSeq + 1) {           // gap — enter sync mode
      syncing = true;
      buffered.push(event);
      requestSync(lastAppliedSeq);
      publish();
      return;
    }
    document = applyDomainEvent(document, event);
    document.version = event.seq;
    lastAppliedSeq = event.seq;
    publish();
  }

  /** Drain the buffer in order, applying events sequentially. */
  function drainBuffer() {
    const pending = buffered.sort((a, b) => a.seq - b.seq);
    buffered = [];
    for (const event of pending) {
      applyOne(event);
    }
  }

  return {
    /**
     * receive(event) — called for every live 'event-committed' socket event.
     * While syncing, events are buffered. Once syncing=false, they are applied immediately.
     */
    receive(event) {
      if (syncing) {
        buffered.push(event);
      } else {
        applyOne(event);
      }
    },

    /**
     * install(documentState, version) — installs the authoritative state from the server
     * (initial-state on join, or snapshot during sync recovery).
     * After installing, drains any buffered events that arrived after this version.
     */
    install(documentState, version) {
      if (version < lastAppliedSeq) return false;   // stale install — ignore
      document = documentState;
      document.version = version;
      lastAppliedSeq = version;
      syncing = false;
      drainBuffer();
      publish();
      return true;
    },

    /**
     * applySyncedEvents(events, currentSeq) — Bug #3 fix.
     * Called when the server returns missing events in a sync-response.
     * Applies events in order from lastAppliedSeq+1, then drains buffered live events.
     * Sets syncing=false once complete.
     *
     * @param {Array}  events     - The recovered events from sync-response
     * @param {number} currentSeq - The server's current sequence number
     */
    applySyncedEvents(events, currentSeq) {
      const ordered = [...events].sort((a, b) => a.seq - b.seq);
      for (const event of ordered) {
        if (event.seq <= lastAppliedSeq) continue;   // already applied
        document = applyDomainEvent(document, event);
        document.version = event.seq;
        lastAppliedSeq = event.seq;
      }
      // Mark sync complete (even if we didn't fill every gap — server is authoritative)
      if (lastAppliedSeq >= currentSeq) {
        syncing = false;
      }
      drainBuffer();
      publish();
    },

    reset() {
      document = createEmptyDocument();
      lastAppliedSeq = 0;
      syncing = true;
      buffered = [];
      publish();
    },

    state() {
      return { document, lastAppliedSeq, syncing };
    }
  };
}
