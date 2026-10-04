import { usePipeline } from '../app/hooks';

/** Screen-reader announcements for things that happen off-focus (saves, failures, conflicts). */
export function LiveRegion() {
  const a = usePipeline((s) => s.announcement);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-polite">
        {!a.urgent && <span key={a.id}>{a.text}</span>}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {a.urgent && <span key={a.id}>{a.text}</span>}
      </div>
    </>
  );
}
