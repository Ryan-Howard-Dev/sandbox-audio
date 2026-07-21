import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileJson, Shield } from 'lucide-react';
import { subscribePlayHistory } from '../playHistory';
import {
  buildListeningReportJson,
  downloadTextFile,
  downloadWrappedCardPng,
  formatCompletionPct,
  formatMinutesHuman,
  getAvailableWrappedYears,
  getListeningStats,
  getWrappedSummary,
  type RankedItem,
  type TimeRange,
} from '../listeningAnalytics';
import { C } from './theme';

const RANGE_TABS: Array<{ id: TimeRange; label: string }> = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'lifetime', label: 'Lifetime' },
];

function maxScore(items: RankedItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.score), 0) || 1;
}

function RankList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: RankedItem[];
  emptyLabel: string;
}) {
  const peak = maxScore(items);
  return (
    <div
      className="rounded-sm border p-4"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent mb-3">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="font-mono text-xs" style={{ color: C.textDim }}>
          {emptyLabel}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item, idx) => (
            <li key={item.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold truncate" style={{ color: C.text }}>
                    <span className="text-accent mr-2">{idx + 1}.</span>
                    {item.label}
                  </p>
                  {item.subtitle ? (
                    <p className="font-mono text-[10px] truncate" style={{ color: C.textDim }}>
                      {item.subtitle}
                    </p>
                  ) : null}
                </div>
                <span className="font-mono text-[10px] shrink-0 text-right" style={{ color: C.textMid }}>
                  {item.meaningfulPlays} listen{item.meaningfulPlays === 1 ? '' : 's'}
                  <br />
                  {formatCompletionPct(item.avgCompletionPct)} avg
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 font-mono text-[9px] uppercase tracking-wider" style={{ color: C.textDim }}>
                <span>{formatMinutesHuman(item.minutes)}</span>
                {item.skips > 0 ? <span>{item.skips} skip{item.skips === 1 ? '' : 's'}</span> : null}
                {item.repeats > 0 ? <span>{item.repeats} repeat{item.repeats === 1 ? '' : 's'}</span> : null}
              </div>
              <div
                className="h-1 rounded-full overflow-hidden"
                style={{ backgroundColor: C.border }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(4, (item.score / peak) * 100)}%`,
                    backgroundColor: 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))',
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ListeningStatsViewProps {
  onBack?: () => void;
}

export default function ListeningStatsView({ onBack }: ListeningStatsViewProps) {
  const [range, setRange] = useState<TimeRange>('month');
  const [tick, setTick] = useState(0);
  const [wrappedYear, setWrappedYear] = useState(() => new Date().getFullYear());
  useEffect(() => subscribePlayHistory(() => setTick((t) => t + 1)), []);

  const stats = useMemo(() => getListeningStats(range), [range, tick]);
  const years = useMemo(() => getAvailableWrappedYears(), [tick]);
  const wrapped = useMemo(() => getWrappedSummary(wrappedYear), [wrappedYear, tick]);

  useEffect(() => {
    if (years.length && !years.includes(wrappedYear)) {
      setWrappedYear(years[0]);
    }
  }, [years, wrappedYear]);

  const exportRangeJson = useCallback(() => {
    const json = buildListeningReportJson(stats, { range });
    downloadTextFile(`listening-stats-${range}.json`, json);
  }, [stats, range]);

  const exportWrappedJson = useCallback(() => {
    const json = buildListeningReportJson(wrapped, { year: wrappedYear });
    downloadTextFile(`local-wrapped-${wrappedYear}.json`, json);
  }, [wrapped, wrappedYear]);

  const exportWrappedImage = useCallback(() => {
    void downloadWrappedCardPng(wrapped);
  }, [wrapped]);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto w-full flex flex-col gap-6 min-h-0 flex-1 overflow-y-auto">
      <header className="border-b pb-4" style={{ borderColor: C.border }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-accent mb-1">
              Local insights
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-black uppercase tracking-tight">
              Your Listening
            </h2>
            <p className="font-mono text-xs mt-2 max-w-xl" style={{ color: C.textMid }}>
              Privacy-first analytics stored only on this device. Rankings weight completion — skips under 30s or 50% do not count.
            </p>
          </div>
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="font-mono text-[10px] uppercase tracking-wider border px-3 py-2 rounded-sm touch-manipulation shrink-0"
              style={{ borderColor: C.border, color: C.textMid }}
            >
              Back
            </button>
          ) : null}
        </div>
      </header>

      <div
        className="flex items-start gap-3 p-4 rounded-sm border"
        style={{ backgroundColor: C.surface, borderColor: C.border }}
      >
        <Shield className="w-4 h-4 text-accent shrink-0 mt-0.5" strokeWidth={2} />
        <div>
          <p className="font-mono text-xs font-semibold" style={{ color: C.text }}>
            Device-local storage only
          </p>
          <p className="font-mono text-[11px] mt-1" style={{ color: C.textDim }}>
            Play events and listening sessions live in browser localStorage via prefs storage. Nothing leaves your machine unless you export.
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: C.textLabel }}>
            Time range
          </p>
          <div className="flex flex-wrap gap-1">
            {RANGE_TABS.map((tab) => {
              const active = range === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRange(tab.id)}
                  className="font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 border rounded-sm touch-manipulation"
                  style={{
                    borderColor: active ? 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))' : C.border,
                    color: active ? 'var(--accent-stroke)' : C.textMid,
                    backgroundColor: active
                      ? 'hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.1)'
                      : 'transparent',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Minutes listened" value={formatMinutesHuman(stats.minutesListened)} />
          <StatCard
            label="Meaningful plays"
            value={String(stats.meaningfulPlays)}
            hint={`${stats.totalPlays} total · ${stats.skipCount} skips`}
          />
          <StatCard
            label="Avg completion"
            value={formatCompletionPct(stats.avgCompletionPct)}
            hint={`${stats.repeatCount} repeats`}
            className="col-span-2 sm:col-span-1"
          />
        </div>

        <div
          className="rounded-sm border p-4"
          style={{ backgroundColor: C.card, borderColor: C.border }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent mb-3">
            Listening sessions
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SessionStat label="Sessions" value={String(stats.sessionStats.sessionCount)} />
            <SessionStat
              label="Total time"
              value={formatMinutesHuman(stats.sessionStats.totalSessionMinutes)}
            />
            <SessionStat
              label="Avg session"
              value={formatMinutesHuman(stats.sessionStats.avgSessionMinutes)}
            />
            <SessionStat
              label="Longest"
              value={formatMinutesHuman(stats.sessionStats.longestSessionMinutes)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportRangeJson}
            className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider border px-3 py-2 rounded-sm touch-manipulation"
            style={{ borderColor: C.border, color: C.textMid }}
          >
            <FileJson className="w-3.5 h-3.5" />
            Export JSON report
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <RankList
            title="Top artists"
            items={stats.topArtists}
            emptyLabel="Listen to build artist rankings"
          />
          <RankList
            title="Top albums"
            items={stats.topAlbums}
            emptyLabel="Album stats appear after sessions"
          />
          <RankList
            title="Top tracks"
            items={stats.topTracks}
            emptyLabel="Track stats appear after sessions"
          />
        </div>
      </section>

      <section className="space-y-4 pt-2 border-t" style={{ borderColor: C.border }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
              Local Wrapped
            </p>
            <p className="font-mono text-xs mt-1" style={{ color: C.textDim }}>
              Annual summary card — export as image or JSON.
            </p>
          </div>
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
            <span style={{ color: C.textMid }}>Year</span>
            <select
              value={wrappedYear}
              onChange={(e) => setWrappedYear(Number(e.target.value))}
              className="border rounded-sm px-2 py-1.5 bg-transparent"
              style={{ borderColor: C.border, color: C.text }}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className="rounded-sm border p-6 sm:p-8 max-w-lg"
          style={{ backgroundColor: C.bg, borderColor: 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))' }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
            Local Wrapped
          </p>
          <h3 className="font-display text-5xl font-black mt-2">{wrappedYear}</h3>
          <p className="font-mono text-[10px] uppercase tracking-wider mt-1" style={{ color: C.textDim }}>
            Privacy-first · device only
          </p>

          <div className="grid grid-cols-2 gap-4 mt-8">
            <div>
              <p className="font-mono text-[10px] uppercase" style={{ color: C.textDim }}>
                Minutes
              </p>
              <p className="font-display text-3xl font-bold mt-1">
                {formatMinutesHuman(wrapped.minutesListened)}
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase" style={{ color: C.textDim }}>
                Meaningful plays
              </p>
              <p className="font-display text-3xl font-bold mt-1">{wrapped.meaningfulPlays}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase" style={{ color: C.textDim }}>
                Avg completion
              </p>
              <p className="font-display text-3xl font-bold mt-1">
                {formatCompletionPct(wrapped.avgCompletionPct)}
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase" style={{ color: C.textDim }}>
                Skips
              </p>
              <p className="font-display text-3xl font-bold mt-1">{wrapped.skipCount}</p>
            </div>
          </div>

          <div className="mt-8 space-y-4">
            <WrappedHighlight label="Top artist" value={wrapped.topArtist?.label} />
            <WrappedHighlight label="Top album" value={wrapped.topAlbum?.label} />
            <WrappedHighlight label="Top track" value={wrapped.topTrack?.label} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportWrappedImage}
            className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider border px-3 py-2 rounded-sm touch-manipulation text-accent"
            style={{ borderColor: 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))' }}
          >
            <Download className="w-3.5 h-3.5" />
            Export card image
          </button>
          <button
            type="button"
            onClick={exportWrappedJson}
            className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider border px-3 py-2 rounded-sm touch-manipulation"
            style={{ borderColor: C.border, color: C.textMid }}
          >
            <FileJson className="w-3.5 h-3.5" />
            Export wrapped JSON
          </button>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  className = '',
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-sm border p-4 ${className}`}
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: C.textDim }}>
        {label}
      </p>
      <p className="font-display text-2xl font-bold mt-2">{value}</p>
      {hint ? (
        <p className="font-mono text-[9px] uppercase tracking-wider mt-1" style={{ color: C.textDim }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SessionStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: C.textDim }}>
        {label}
      </p>
      <p className="font-mono text-sm font-semibold mt-1" style={{ color: C.text }}>
        {value}
      </p>
    </div>
  );
}

function WrappedHighlight({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: C.textDim }}>
        {label}
      </p>
      <p className="font-mono text-sm font-semibold mt-1 truncate" style={{ color: C.text }}>
        {value?.trim() || '—'}
      </p>
    </div>
  );
}
