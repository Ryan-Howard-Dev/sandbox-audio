import { describe, expect, it, vi } from 'vitest';
import type { NarrationChunk } from './documentNarration';
import {
  createNarrationReader,
  type NarrationReaderState,
  type NarrationSpeechPort,
} from './narrationReader';

function chunk(text: string, section = 'Intro', isHeading = false): NarrationChunk {
  return { text, section, isHeading };
}

/** Records calls and lets a test decide when an utterance ends, as a real engine would. */
function fakePort() {
  const spoken: string[] = [];
  let pending: {
    onEnd: () => void;
    onError: () => void;
    onRange?: (start: number, end: number) => void;
  } | null = null;
  let cancels = 0;
  let pauses = 0;
  let resumes = 0;
  const port: NarrationSpeechPort = {
    speak(text, { onEnd, onError, onRange }) {
      spoken.push(text);
      pending = { onEnd, onError, onRange };
    },
    cancel() {
      cancels += 1;
    },
    pause() {
      pauses += 1;
    },
    resume() {
      resumes += 1;
    },
  };
  return {
    port,
    spoken,
    finishCurrent: () => pending?.onEnd(),
    failCurrent: () => pending?.onError(),
    /** Stand in for the engine reporting a spoken word. */
    reportRange: (start: number, end: number) => pending?.onRange?.(start, end),
    hasRangeHandler: () => pending?.onRange !== undefined,
    /** The handler for the utterance in flight, kept so a test can fire it after moving on. */
    captureRangeHandler: () => pending?.onRange,
    counts: () => ({ cancels, pauses, resumes }),
  };
}

describe('createNarrationReader', () => {
  const chunks = [chunk('One.'), chunk('Two.'), chunk('Three.')];

  it('reads chunks in order, one at a time', () => {
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port);
    reader.play();
    expect(f.spoken).toEqual(['One.']);
    f.finishCurrent();
    expect(f.spoken).toEqual(['One.', 'Two.']);
    f.finishCurrent();
    expect(f.spoken).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('finishes after the last chunk instead of looping', () => {
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port);
    reader.play();
    f.finishCurrent();
    f.finishCurrent();
    f.finishCurrent();
    expect(reader.getState()).toBe('finished');
    expect(f.spoken).toHaveLength(3);
  });

  /*
   * A two-hour paper must not stop dead on one unpronounceable fragment — a stray equation, or a
   * language the installed voices cannot handle.
   */
  it('skips a chunk that fails to synthesise', () => {
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port);
    reader.play();
    f.failCurrent();
    expect(f.spoken).toEqual(['One.', 'Two.']);
    expect(reader.getState()).toBe('speaking');
  });

  it('resumes from a stored position', () => {
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port, { startIndex: 2 });
    reader.play();
    expect(f.spoken).toEqual(['Three.']);
    expect(reader.getIndex()).toBe(2);
  });

  it('clamps an out-of-range resume point rather than reading nothing', () => {
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port, { startIndex: 99 });
    reader.play();
    expect(f.spoken).toEqual(['Three.']);
  });

  it('reports the position so it can be persisted', () => {
    const onChunkChange = vi.fn();
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port, { onChunkChange });
    reader.play();
    f.finishCurrent();
    expect(onChunkChange).toHaveBeenNthCalledWith(1, 0, chunks[0]);
    expect(onChunkChange).toHaveBeenNthCalledWith(2, 1, chunks[1]);
    expect(reader.getIndex()).toBe(1);
  });

  it('pauses and resumes without losing its place', () => {
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port);
    reader.play();
    reader.pause();
    expect(reader.getState()).toBe('paused');
    expect(f.counts().pauses).toBe(1);
    reader.resume();
    expect(reader.getState()).toBe('speaking');
    expect(reader.getIndex()).toBe(0);
  });

  it('ignores resume when not paused and pause when not speaking', () => {
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port);
    reader.pause();
    reader.resume();
    expect(f.counts().pauses).toBe(0);
    expect(f.counts().resumes).toBe(0);
  });

  /*
   * Several engines fire onEnd when speech is cancelled. Treating that as a chunk finishing would
   * advance the document — so stopping a paper would silently start reading the next paragraph.
   */
  it('does not advance when a cancel fires onEnd', () => {
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port);
    reader.play();
    reader.stop();
    f.finishCurrent();
    expect(f.spoken).toEqual(['One.']);
    expect(reader.getState()).toBe('idle');
  });

  it('seeks to a chunk and keeps reading when it was reading', () => {
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port);
    reader.play();
    reader.seekToChunk(2);
    expect(f.spoken).toEqual(['One.', 'Three.']);
    expect(reader.getState()).toBe('speaking');
  });

  it('seeks without starting playback when it was idle', () => {
    const onChunkChange = vi.fn();
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port, { onChunkChange });
    reader.seekToChunk(1);
    expect(f.spoken).toEqual([]);
    expect(reader.getIndex()).toBe(1);
    expect(onChunkChange).toHaveBeenCalledWith(1, chunks[1]);
  });

  it('reports state transitions for the UI', () => {
    const seen: NarrationReaderState[] = [];
    const f = fakePort();
    const reader = createNarrationReader([chunk('Only.')], f.port, {
      onStateChange: (s) => seen.push(s),
    });
    reader.play();
    f.finishCurrent();
    expect(seen).toEqual(['speaking', 'finished']);
  });

  it('treats an empty document as finished rather than hanging', () => {
    const f = fakePort();
    const reader = createNarrationReader([], f.port);
    reader.play();
    expect(reader.getState()).toBe('finished');
    expect(f.spoken).toEqual([]);
  });

  it('reports spoken word ranges against the chunk being spoken', () => {
    const f = fakePort();
    const onRange = vi.fn();
    const reader = createNarrationReader(chunks, f.port, { onRange });
    reader.play();
    f.reportRange(0, 3);
    expect(onRange).toHaveBeenCalledWith(0, 0, 3);

    f.finishCurrent();
    f.reportRange(1, 4);
    // The index travels with the range, so a late one cannot mark a word in the wrong chunk.
    expect(onRange).toHaveBeenLastCalledWith(1, 1, 4);
  });

  it('carries the index the chunk had when it was spoken, not the current one', () => {
    const f = fakePort();
    const seen: number[] = [];
    const reader = createNarrationReader(chunks, f.port, {
      onRange: (index) => seen.push(index),
    });
    reader.play();
    // Hold chunk 0's handler, then move on before firing it — exactly what a slow engine event
    // does. It must still report 0, so the UI can tell it is stale and drop it.
    const stale = f.captureRangeHandler();
    f.finishCurrent();
    stale?.(0, 2);
    f.reportRange(0, 3);
    expect(seen).toEqual([0, 1]);
  });

  it('does not give the engine a range handler when nothing is listening', () => {
    const f = fakePort();
    const reader = createNarrationReader(chunks, f.port);
    reader.play();
    expect(f.hasRangeHandler()).toBe(false);
  });
});
