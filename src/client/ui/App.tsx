import { useEffect } from 'react';
import { actions, usePipeline } from '../app/hooks';
import { pipeline } from '../app/instance';
import type { Layout } from '../store/types';
import { AttentionPanel } from './AttentionPanel';
import { BoardView } from './Board';
import { BulkBar } from './BulkBar';
import { ConfirmDialog } from './ConfirmDialog';
import { DealTable } from './DealTable';
import { DragOverlay } from './drag';
import { EditDialog } from './EditDialog';
import { Footer } from './Footer';
import { Header } from './Header';
import { LiveRegion } from './LiveRegion';
import { MoveMenu } from './MoveMenu';
import { ShortcutsHelp } from './ShortcutsHelp';
import { SimPanel } from './SimPanel';
import { StageStrip } from './StageStrip';
import { Toasts } from './Toasts';
import { Toolbar } from './Toolbar';
import { useKeyboard } from './useKeyboard';

export function App() {
  const status = usePipeline((s) => s.status);
  const loadError = usePipeline((s) => s.loadError);
  const panel = usePipeline((s) => s.panel);
  const confirm = usePipeline((s) => s.confirm);
  const editing = usePipeline((s) => s.editing);
  const layout = usePipeline((s) => s.layout);

  useEffect(() => {
    if (pipeline.getState().status === 'idle') void actions().load().then(restoreLayout);
  }, []);

  // Remember Table/Board per browser (a convenience, so failures to store are ignored).
  useEffect(
    () =>
      pipeline.subscribe((s, prev) => {
        if (s.layout === prev.layout) return;
        try {
          localStorage.setItem(LAYOUT_KEY, s.layout);
        } catch {
          /* storage unavailable */
        }
      }),
    [],
  );

  // Never let someone close the tab with changes that have not reached the server.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (pipeline.getState().hasUnsaved()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useKeyboard();

  if (status === 'error') {
    return (
      <div className="center" role="alert">
        <div>Couldn't load the pipeline: {loadError}</div>
        <button className="btn primary" onClick={() => void actions().load()}>
          Try again
        </button>
      </div>
    );
  }
  if (status !== 'ready') {
    return (
      <div className="center" aria-busy="true">
        <span className="spinner" />
        <div>Loading 50,000 deals…</div>
      </div>
    );
  }

  return (
    <div className={`app layout-${layout}`}>
      <Header />
      {layout === 'table' && <StageStrip />}
      <Toolbar />
      <BulkBar />
      {layout === 'table' ? <DealTable /> : <BoardView />}
      <Footer />
      {panel === 'moveMenu' && <MoveMenu />}
      {panel === 'attention' && <AttentionPanel />}
      {panel === 'help' && <ShortcutsHelp />}
      {panel === 'sim' && <SimPanel />}
      {confirm && <ConfirmDialog />}
      {editing && <EditDialog />}
      <Toasts />
      <DragOverlay />
      <LiveRegion />
    </div>
  );
}

const LAYOUT_KEY = 'pipeline.layout.v1';

/** Table by default; `?view=board` or the last choice in this browser wins. */
function restoreLayout() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LAYOUT_KEY);
  } catch {
    saved = null;
  }
  const fromUrl = new URLSearchParams(window.location.search).get('view');
  const layout = (fromUrl ?? saved) as Layout | null;
  if (layout === 'board' || layout === 'table') actions().setLayout(layout);
}
