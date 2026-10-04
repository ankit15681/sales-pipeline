import { useEffect } from 'react';
import { pipeline } from '../app/instance';
import { STAGES } from '../../shared/domain';
import type { Pipeline } from '../store/types';
import { boardNeighbor, columnEdge } from './boardModel';
import { focusMain } from './dealStatus';
import { SEARCH_INPUT_ID } from './Toolbar';

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

const pageSize = () => Number(document.getElementById('deal-grid')?.dataset.pageSize ?? 10);

/**
 * One global key map. Keys act on the selection, or the focused row when
 * nothing is selected. Dialogs/drawers mark themselves data-keyscope="local"
 * and handle their own keys.
 */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-keyscope="local"]')) return;
      const s = pipeline.getState();
      if (s.confirm || s.editing) return; // dialogs own the keyboard

      if (isTyping(target)) {
        if (e.key === 'Escape') {
          (target as HTMLElement).blur();
          focusMain();
        }
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      // Let focused buttons/checkboxes behave natively.
      if ((key === ' ' || key === 'Enter') && target && target.tagName === 'BUTTON') return;
      const handled = () => e.preventDefault();

      if (mod) {
        if (key.toLowerCase() === 'a') {
          handled();
          s.selectAll();
        } else if (key.toLowerCase() === 'z' && !e.shiftKey) {
          handled();
          s.undo();
        }
        return; // leave other browser shortcuts alone
      }
      if (e.altKey) return;

      if (s.layout === 'board' && boardKey(s, e)) {
        handled();
        return;
      }

      switch (key) {
        case 'v':
        case 'V':
          handled();
          s.setLayout(s.layout === 'table' ? 'board' : 'table');
          focusMain();
          return;
        case 'f':
          handled();
          s.setTab(s.view.query.tab === 'focus' ? 'open' : 'focus');
          return;
        case 'ArrowDown':
        case 'j':
        case 'J':
          handled();
          s.moveFocus(1, e.shiftKey);
          return;
        case 'ArrowUp':
        case 'k':
        case 'K':
          handled();
          s.moveFocus(-1, e.shiftKey);
          return;
        case 'PageDown':
          handled();
          s.moveFocus(pageSize(), e.shiftKey);
          return;
        case 'PageUp':
          handled();
          s.moveFocus(-pageSize(), e.shiftKey);
          return;
        case 'Home':
          handled();
          s.focusEdge('first');
          return;
        case 'End':
          handled();
          s.focusEdge('last');
          return;
        case 'ArrowRight':
        case 'l':
          handled();
          s.cycleTab(1);
          return;
        case 'ArrowLeft':
        case 'h':
          handled();
          s.cycleTab(-1);
          return;
        case 'x':
        case ' ':
          handled();
          s.toggleSelect();
          return;
        case 'Escape':
          if (s.panel) s.openPanel(null);
          else s.clearSelection();
          return;
        case ']':
          handled();
          s.requestAdjacentMove(1);
          return;
        case '[':
          handled();
          s.requestAdjacentMove(-1);
          return;
        case 'm':
          handled();
          s.openPanel('moveMenu');
          return;
        case 'e':
          handled();
          s.openEdit();
          return;
        case '/':
          handled();
          (document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null)?.select();
          return;
        case 'u':
          handled();
          s.refreshView();
          return;
        case 'z':
          handled();
          s.undo();
          return;
        case 'R':
          handled();
          s.retryAllFailed();
          return;
        case 'a':
          handled();
          s.togglePanel('attention');
          return;
        case '?':
          handled();
          s.togglePanel('help');
          return;
        case 'S':
          handled();
          s.togglePanel('sim');
          return;
      }
      const stage = STAGES.find((st) => st.key === key);
      if (stage) {
        handled();
        s.requestMove(stage.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * Board navigation is two-dimensional: ↑/↓ within a column, ←/→ across columns,
 * and ⇧←/⇧→ carries the focused card (or the selection) to the previous/next stage.
 * Everything else (1–7, [ ], M, X, Z, …) is shared with the table.
 */
function boardKey(s: Pipeline, e: KeyboardEvent): boolean {
  const go = (id: string | null, extend = false) => {
    if (!id) return;
    if (extend) {
      const sel = new Set(s.selection);
      if (s.focusId) sel.add(s.focusId);
      sel.add(id);
      s.setSelection(sel);
    }
    s.setFocus(id);
  };
  switch (e.key) {
    case 'ArrowDown':
    case 'j':
    case 'J':
      go(boardNeighbor(s, 'down'), e.shiftKey);
      return true;
    case 'ArrowUp':
    case 'k':
    case 'K':
      go(boardNeighbor(s, 'up'), e.shiftKey);
      return true;
    case 'PageDown':
      go(boardNeighbor(s, 'down', 6));
      return true;
    case 'PageUp':
      go(boardNeighbor(s, 'up', 6));
      return true;
    case 'Home':
      go(columnEdge(s, 'first'));
      return true;
    case 'End':
      go(columnEdge(s, 'last'));
      return true;
    case 'ArrowRight':
    case 'l':
    case 'L':
      if (e.shiftKey) s.requestAdjacentMove(1);
      else go(boardNeighbor(s, 'right'));
      return true;
    case 'ArrowLeft':
    case 'h':
    case 'H':
      if (e.shiftKey) s.requestAdjacentMove(-1);
      else go(boardNeighbor(s, 'left'));
      return true;
  }
  return false;
}
