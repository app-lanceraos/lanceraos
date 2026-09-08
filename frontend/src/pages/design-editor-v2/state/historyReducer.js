import { initialTemplateState } from '../data/initialState';

export const HISTORY_LIMIT = 100;

export const initialHistoryState = {
  past: [],
  present: initialTemplateState,
  future: [],
};

// Every mutating action goes through `applyAction`, which knows how to do
// and undo itself. We store the *inverse* alongside nothing extra — undo just
// pops `past` back onto `present`, redo does the mirror. This is the
// "history of full template snapshots, but coalesced per user gesture"
// approach: cheap to implement correctly, and since our documents are small
// (a single invoice template's worth of slots/shapes), snapshot size is a
// non-issue. What matters for the "one drag = one step" rule is WHEN we
// push a new history entry, not how big it is.

function pushHistory(state, nextPresent) {
  const past = [...state.past, state.present].slice(-HISTORY_LIMIT);
  return { past, present: nextPresent, future: [] };
}

export function historyReducer(state, action) {
  switch (action.type) {
    case 'COMMIT': {
      // A finished gesture (drag release, style change, toggle, delete...)
      // action.next is the fully-computed next template state.
      return pushHistory(state, action.next);
    }
    case 'UNDO': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const past = state.past.slice(0, -1);
      return { past, present: previous, future: [state.present, ...state.future] };
    }
    case 'REDO': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const future = state.future.slice(1);
      return { past: [...state.past, state.present], present: next, future };
    }
    case 'RESET': {
      return initialHistoryState;
    }
    case 'LOAD': {
      // Real-backend integration: replaces the whole document (used only
      // by version restore, mid-session — the initial real load from
      // GET /invoices/designs/{id}/ instead seeds a fresh EditorProvider's
      // lazy useReducer initializer, so it never needs this action at
      // all). Deliberately wipes past/future rather than pushing onto
      // them — the restored content isn't a further edit of what was on
      // screen, it's a wholesale replacement, so undoing "back into" the
      // pre-restore canvas would be confusing; the pre-restore state is
      // still real and recoverable as its own actual version on the
      // server if needed.
      return { past: [], present: action.template, future: [] };
    }
    default:
      return state;
  }
}
