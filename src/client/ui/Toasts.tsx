import { useEffect } from 'react';
import { actions, usePipeline } from '../app/hooks';
import type { Toast } from '../store/types';

const AUTO_DISMISS_MS = 6000;

export function Toasts() {
  const toasts = usePipeline((s) => s.toasts);
  return (
    <div className="toasts" aria-live="off">
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  useEffect(() => {
    if (toast.sticky) return;
    const timer = setTimeout(() => actions().dismissToast(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.createdAt, toast.sticky]);

  return (
    <div className={`toast ${toast.kind}`} data-testid={`toast-${toast.id}`}>
      <div className="tbody">
        <div className="title">{toast.title}</div>
        {toast.detail && <div className="detail">{toast.detail}</div>}
        {toast.actions && toast.actions.length > 0 && (
          <div className="tactions">
            {toast.actions.map((a) => (
              <button key={a.label} className="btn small" onClick={() => actions().runToastAction(a.run, a.arg)}>
                {a.label}
                {a.key && <kbd>{a.key}</kbd>}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="close" aria-label="Dismiss" onClick={() => actions().dismissToast(toast.id)}>
        ×
      </button>
    </div>
  );
}
