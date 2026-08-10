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

  return (
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

              <ul className="health-groups">
                {report.groups.map((group) => (
                  <HealthGroupCard group={group} key={group.kind} />
                ))}
              </ul>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}

function HealthGroupCard({ group }: { group: HealthGroup }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const Icon = group.severity === 'problem' ? AlertTriangle : group.severity === 'gap' ? Activity : FileQuestion;

  return (
    <li className={`health-group health-group--${group.severity}`}>
      <button
        type="button"
        className="health-group-head touch-manipulation"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon className="w-4 h-4 shrink-0" aria-hidden />
        <span className="health-group-label">{describeGroup(group)}</span>
      </button>

      {open ? (
        <>
          <ul className="health-examples">
            {group.examples.map((finding) => (
              <li className="health-example" key={`${finding.kind}-${finding.refs[0]}`}>
                <span className="health-example-label">{finding.label}</span>
                {finding.detail ? (
                  <span className="health-example-detail ui-hint">{finding.detail}</span>
                ) : null}
              </li>
            ))}
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
