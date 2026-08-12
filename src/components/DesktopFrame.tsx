/**
 * The desktop's shape: a station in the middle, an inspector beside it, a player under both.
 *
 * A layout and nothing else. The station views inside it are the same components the phone renders,
 * arranged differently — because two sets of views would drift, and the drift would be exactly the
 * kind of quiet disagreement that has already cost this codebase a server that ate collections and
 * a manifest that dropped fields.
 *
 * The player stays. A desk is somewhere people listen all day, and a manager that treats playback
 * as a diagnostic tool is a manager nobody leaves open. What changes on desktop is that the screen
 * can hold both at once instead of choosing.
 */

import type { ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useTranslation } from '../i18n';

export interface DesktopFrameProps {
  /** The station. Whatever the router picked. */
  children: ReactNode;
  /**
   * What is selected, when anything is. Absent means the pane is not offered at all rather than
   * offered empty — a permanently blank third of the window teaches people to collapse it.
   */
  inspector?: ReactNode;
  /** Shown under everything, always, because listening is not a mode here. */
  player?: ReactNode;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

export default function DesktopFrame({
  children,
  inspector,
  player,
  inspectorOpen,
  onToggleInspector,
}: DesktopFrameProps) {
  const showInspector = Boolean(inspector) && inspectorOpen;

  return (
    <div className={`dframe${showInspector ? ' dframe--inspector' : ''}`}>
      <main className="dframe-main" aria-label="Station">
        {children}
      </main>

      {inspector ? (
        <>
          <button
            type="button"
            className="dframe-inspector-toggle touch-manipulation"
            onClick={onToggleInspector}
            aria-expanded={showInspector}
            aria-controls="desktop-inspector"
          >
            {showInspector ? (
              <PanelRightClose className="w-4 h-4" aria-hidden />
            ) : (
              <PanelRightOpen className="w-4 h-4" aria-hidden />
            )}
          </button>
          {showInspector ? (
            <aside className="dframe-inspector" id="desktop-inspector">
              {inspector}
            </aside>
          ) : null}
        </>
      ) : null}

      {player ? <div className="dframe-player">{player}</div> : null}
    </div>
  );
}

export interface InspectorProps {
  title: string;
  /** Lines of fact about the selection. Empty is a state worth showing, not one to hide. */
  rows: Array<{ label: string; value: string }>;
  /** What can be done with what is selected, where the station offers anything. */
  actions?: ReactNode;
  count: number;
}

/**
 * What is selected, and what can be done with it.
 *
 * Deliberately dumb: it takes rows already worked out by whichever station owns the selection.
 * An inspector that reaches into four stores to describe four kinds of thing is a fifth place that
 * has to be updated whenever any of them changes shape.
 */
export function Inspector({ title, rows, actions, count }: InspectorProps) {
  const { t } = useTranslation();

  return (
    <section className="inspector" aria-label={title}>
      <h2 className="inspector-title">{title}</h2>
      <p className="ui-hint inspector-count">
        {count === 1 ? t('inspector.one') : t('inspector.many', { count })}
      </p>

      {rows.length > 0 ? (
        <dl className="inspector-rows">
          {rows.map((row) => (
            <div className="inspector-row" key={row.label}>
              <dt className="inspector-label">{row.label}</dt>
              {/* Values wrap rather than truncate: a path elided in the middle is a path nobody
                  can check, and checking is what an inspector is for. */}
              <dd className="inspector-value">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {actions ? <div className="inspector-actions">{actions}</div> : null}
    </section>
  );
}
