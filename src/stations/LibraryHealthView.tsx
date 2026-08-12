/**
 * What needs fixing, across every station, before anything is allowed to fix it.
 *
 * This is deliberately the first manager surface. It reads and reports and changes nothing, so it
 * can be pointed at a real library on the first day, and what it finds is what tells us the editing
 * and organising surfaces are worth building at all.
 *
 * Nothing here decides what counts as a problem. That is libraryHealth, which is pure and tested;
 * this gathers the four stations' storage, hands it over, and draws the answer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  FileQuestion,
  FolderSearch,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  analyseLibraryHealth,
  describeGroup,
  SEVERITY_BY_KIND,
  type HealthGroup,
  type HealthItem,
  type HealthReport,
  type ScannedFile,
} from '../libraryHealth';
import {
  attributeFilesToStations,
  documentItems,
  lockerItems,
  podcastItems,
} from '../libraryHealthSources';
import { isLibraryFsAvailable, listLibraryRoots, scanLibrary } from '../libraryFs';
import { getLockerEntries } from '../lockerStorage';
import { loadOfflinePodcastEpisodes } from '../podcastOfflineEpisodes';
import { listDocuments } from '../documentLibrary';
import { loadPhysicalCopies } from '../physicalCollectionStore';
import { useSelection } from '../hooks/useSelection';
import DesktopFrame, { Inspector } from '../components/DesktopFrame';
import type { PhysicalCopy } from '../physicalCollection';

type LoadState = 'idle' | 'working' | 'done' | 'failed';

export default function LibraryHealthView() {
  const { t } = useTranslation();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [scannedCount, setScannedCount] = useState(0);

  const run = useCallback(async () => {
    setState('working');
    setError(null);
    try {
      const items: HealthItem[] = [];
      const copies: PhysicalCopy[] = loadPhysicalCopies();

      items.push(...lockerItems(await getLockerEntries()));
      items.push(...podcastItems(loadOfflinePodcastEpisodes()));
      items.push(...documentItems(await listDocuments()));

      /*
       * The scan is desktop-only and stays optional.
       *
       * Without it the report simply has no file-level findings and says so, rather than guessing.
       * A missing scan must never be read as "every file is missing", which is what would happen if
       * an empty array were passed instead of nothing.
       */
      let files: ScannedFile[] | undefined;
      if (isLibraryFsAvailable()) {
        const roots = await listLibraryRoots();
        if (roots.length > 0) {
          const scan = await scanLibrary();
          files = attributeFilesToStations(scan.entries, roots);
          setScannedCount(scan.entries.length);
        }
      }

      setReport(analyseLibraryHealth({ items, files, copies }));
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('failed');
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  /*
   * One selection across every group, not one per card.
   *
   * "Fix these" rarely means one kind of problem: the same forty files are usually missing artwork
   * and missing tags, and a selection that resets when a different group is expanded cannot express
   * that. Keyed by kind and ref because the same item legitimately appears under two findings.
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visibleFindingIds = useMemo(() => {
    if (!report) return [] as string[];
    return report.groups
      .filter((group) => expanded.has(group.kind))
      .flatMap((group) => group.examples.map((f) => `${f.kind}:${f.refs[0]}`));
  }, [report, expanded]);

  const selection = useSelection(visibleFindingIds);

  /*
   * What the selection is, in the terms this station thinks in.
   *
   * Files describes a selection by size and format because that is what a file is. A finding is
   * not a file — it is a problem — so this counts problems and where they are, which is what
   * decides whether a batch fix is worth running.
   */
  const inspectorRows = useMemo(() => {
    if (!report || selection.count === 0) return [];
    const chosenIds = new Set(selection.selected);
    const chosen = report.groups
      .flatMap((group) => group.examples)
      .filter((f) => chosenIds.has(`${f.kind}:${f.refs[0]}`));
    if (chosen.length === 0) return [];

    const kinds = [...new Set(chosen.map((f) => f.kind))];
    const stations = [...new Set(chosen.map((f) => f.station))];
    const rows = [
      {
        label: t('health.inspectorProblems'),
        value: kinds
          .map((kind) => {
            const count = chosen.filter((f) => f.kind === kind).length;
            return describeGroup({
              kind,
              severity: SEVERITY_BY_KIND[kind],
              count,
              examples: [],
            });
          })
          .join(', '),
      },
      { label: t('health.inspectorWhere'), value: stations.join(', ') },
    ];
    /*
     * One finding names the thing it is about. A batch does not: forty labels is the list again,
     * and the useful fact about forty is how many and of what.
     */
    if (chosen.length === 1) {
      rows.push({ label: t('health.inspectorItem'), value: chosen[0].detail ?? chosen[0].label });
    }
    return rows;
  }, [report, selection, t]);

  const [inspectorOpen, setInspectorOpen] = useState(true);

  const stationRows = useMemo(() => {
    if (!report) return [];
    return (
      [
        ['music', t('health.stationMusic')],
        ['podcast', t('health.stationPodcasts')],
        ['audiobook', t('health.stationAudiobooks')],
        ['document', t('health.stationDocuments')],
        ['collection', t('health.stationCollection')],
      ] as const
    )
      .map(([key, label]) => ({ key, label, count: report.byStation[key] }))
      .filter((row) => row.count > 0);
  }, [report, t]);

  const body = (
    <section className="health-view" aria-label={t('health.title')}>
      <header className="health-head">
        <h1 className="health-title">{t('health.title')}</h1>
        <p className="ui-hint">{t('health.lead')}</p>
      </header>

      <div className="health-actions">
        <button
          type="button"
          className="btn-accent touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-2"
          onClick={() => void run()}
          disabled={state === 'working'}
        >
          {state === 'working' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" aria-hidden />
          )}
          {t('health.recheck')}
        </button>
      </div>

      {state === 'failed' ? (
        <p className="health-notice font-mono text-[10px]" role="status">
          {error}
        </p>
      ) : null}

      {state === 'working' && !report ? (
        <p className="ui-hint">{t('health.checking')}</p>
      ) : null}

      {report ? (
        <>
          {/* Said plainly rather than hidden, because a report missing a whole class of finding
              looks identical to a clean library. */}
          {report.scanMissing ? (
            <p className="health-scan-note ui-hint" role="note">
              <FolderSearch className="w-3.5 h-3.5 inline mr-1.5" aria-hidden />
              {t('health.noScan')}
            </p>
          ) : (
            <p className="health-scan-note ui-hint">
              {t('health.scanned', { count: scannedCount })}
            </p>
          )}

          {report.totalFindings === 0 ? (
            <p className="ui-hint health-empty">{t('health.allClear')}</p>
          ) : (
            <>
              {stationRows.length > 0 ? (
                <dl className="health-summary">
                  {stationRows.map((row) => (
                    <div className="health-stat" key={row.key}>
                      <dt className="health-stat-label">{row.label}</dt>
                      <dd className="health-stat-value">{row.count}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {selection.count > 0 ? (
                <div className="health-selectbar">
                  <span className="ui-hint">
                    {t('health.selectedCount', { count: selection.count })}
                  </span>
                  <button
                    type="button"
                    className="files-clearsel touch-manipulation"
                    onClick={selection.clear}
                  >
                    {t('files.clearSelection')}
                  </button>
                </div>
              ) : null}

              <ul className="health-groups">
                {report.groups.map((group) => (
                  <HealthGroupCard
                    group={group}
                    key={group.kind}
                    open={expanded.has(group.kind)}
                    onToggle={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(group.kind)) next.delete(group.kind);
                        else next.add(group.kind);
                        return next;
                      })
                    }
                    selection={selection}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      ) : null}
    </section>
  );

  return (
    <DesktopFrame
      inspectorOpen={inspectorOpen}
      onToggleInspector={() => setInspectorOpen((v) => !v)}
      inspector={
        selection.count > 0 ? (
          <Inspector
            title={t('health.inspectorTitle')}
            count={selection.count}
            rows={inspectorRows}
          />
        ) : undefined
      }
    >
      {body}
    </DesktopFrame>
  );
}

function HealthGroupCard({
  group,
  open,
  onToggle,
  selection,
}: {
  group: HealthGroup;
  open: boolean;
  onToggle: () => void;
  selection: ReturnType<typeof useSelection>;
}) {
  const { t } = useTranslation();
  const Icon = group.severity === 'problem' ? AlertTriangle : group.severity === 'gap' ? Activity : FileQuestion;

  return (
    <li className={`health-group health-group--${group.severity}`}>
      <button
        type="button"
        className="health-group-head touch-manipulation"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Icon className="w-4 h-4 shrink-0" aria-hidden />
        <span className="health-group-label">{describeGroup(group)}</span>
      </button>

      {open ? (
        <>
          <ul
            className="health-examples"
            role="listbox"
            aria-multiselectable
            tabIndex={0}
            onKeyDown={selection.onKeyDown}
          >
            {group.examples.map((finding) => {
              const id = `${finding.kind}:${finding.refs[0]}`;
              const chosen = selection.isSelected(id);
              return (
                <li
                  className={`health-example${chosen ? ' health-example--on' : ''}`}
                  key={id}
                  role="option"
                  aria-selected={chosen}
                  onClick={(e) => selection.onRowClick(id, e)}
                >
                  <span className="health-example-label">{finding.label}</span>
                  {finding.detail ? (
                    <span className="health-example-detail ui-hint">{finding.detail}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {/* The count is exact and the list is not, so a group with more than fits says how many
              it is not showing rather than quietly appearing complete. */}
          {group.count > group.examples.length ? (
            <p className="ui-hint health-more">
              {t('health.andMore', { count: group.count - group.examples.length })}
            </p>
          ) : null}
        </>
      ) : null}
    </li>
  );
}
