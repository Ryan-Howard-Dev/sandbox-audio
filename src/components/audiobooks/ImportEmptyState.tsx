import React from 'react';
import { FolderOpen, Loader2, Plus } from 'lucide-react';

export interface ImportEmptyStateProps {
  /** Rendered above the copy — the shelf's own icon, so the two tabs stay distinguishable. */
  icon: React.ReactNode;
  title: string;
  lead: string;
  /** Short format labels, derived from the picker's accept list by the caller. */
  formatsLine: string;
  /** Caveats worth saying out loud: what a link is not, what DRM stops, what is not built yet. */
  hints?: Array<string | null | undefined>;
  actionLabel: string;
  onAction: () => void;
  /**
   * A second way in, when the shelf has one. Both are omitted together — a labelled button with no
   * handler is a control that does nothing, which is worse than an absent one.
   */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  busy?: boolean;
  disabled?: boolean;
}

/**
 * The whole-tab call to action a shelf shows while it holds nothing.
 *
 * The import control used to be a section-head button sized like a section-head button, and the
 * complaint that produced this component was simply "I do not see where to upload" — a shelf with
 * no rows offered a dim one-line hint and a small Import next to a heading, so the tab looked like
 * a feature that was missing rather than one that was empty. An empty shelf has nothing else to
 * spend its space on, so it spends it saying what the tab is for, what it accepts, and what
 * happens after.
 *
 * Shared by Documents and Ebooks because they differ only in copy; two hand-built versions of this
 * layout would drift apart the first time either was touched.
 */
export default function ImportEmptyState({
  icon,
  title,
  lead,
  formatsLine,
  hints,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  busy,
  disabled,
}: ImportEmptyStateProps) {
  return (
    <div className="podcasts-empty-state podcasts-empty-state--compact">
      <div className="flex justify-center mb-3" aria-hidden>
        {icon}
      </div>
      <p className="font-mono text-xs text-[var(--text-mid)] mb-2">{title}</p>
      <p className="font-mono text-[10px] text-[var(--text-dim)] mb-4 max-w-sm mx-auto leading-relaxed">
        {lead}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className="btn-accent touch-manipulation h-11 px-4 rounded-lg font-mono text-xs uppercase tracking-wider inline-flex items-center gap-2"
          onClick={onAction}
          disabled={busy || disabled}
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="w-4 h-4" aria-hidden />
          )}
          {actionLabel}
        </button>
        {/* Quieter than the primary: it is the bulk route, not the one most people want first. */}
        {secondaryActionLabel && onSecondaryAction ? (
          <button
            type="button"
            className="audiobook-doc-import touch-manipulation h-11 px-4"
            onClick={onSecondaryAction}
            disabled={busy || disabled}
          >
            <FolderOpen className="w-4 h-4" aria-hidden />
            {secondaryActionLabel}
          </button>
        ) : null}
      </div>
      {/* Directly under the button, where it answers the question the button just raised. */}
      <p className="font-mono text-[10px] text-[var(--text-dim)] mt-3">{formatsLine}</p>
      {(hints ?? []).map((hint) =>
        hint ? (
          <p
            key={hint}
            className="font-mono text-[10px] text-[var(--text-dim)] mt-2 max-w-sm mx-auto leading-relaxed"
          >
            {hint}
          </p>
        ) : null,
      )}
    </div>
  );
}
