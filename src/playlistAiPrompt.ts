/**
 * Local vibe / prompt matching for smart playlists — no network required.
 * Parses natural-language prompts into metadata + sonic heuristics.
 */

import { getSonicFeaturesForTrack } from './sonicFeatures';
import type { SmartPlaylistRules, SmartTrackContext } from './smartPlaylistEngine';

const GENRE_TERMS = [
  'rock',
  'jazz',
  'hip-hop',
  'hip hop',
  'rap',
  'electronic',
  'edm',
  'house',
  'techno',
  'ambient',
  'classical',
  'folk',
  'country',
  'r&b',
  'rnb',
  'soul',
  'metal',
  'punk',
  'indie',
  'pop',
  'lofi',
  'lo-fi',
  'disco',
  'funk',
  'blues',
  'reggae',
  'latin',
  'k-pop',
  'soundtrack',
];

type MoodProfile = {
  bpmMin?: number;
  bpmMax?: number;
  energyMin?: number;
  energyMax?: number;
  terms: string[];
};

const MOOD_PROFILES: Record<string, MoodProfile> = {
  chill: { bpmMax: 105, energyMax: 0.45, terms: ['chill', 'calm', 'relax', 'mellow', 'soft', 'ambient', 'lofi', 'lo-fi'] },
  energetic: { bpmMin: 115, energyMin: 0.55, terms: ['energy', 'energetic', 'upbeat', 'workout', 'run', 'party', 'dance', 'hype'] },
  focus: { bpmMin: 70, bpmMax: 120, energyMax: 0.5, terms: ['focus', 'study', 'concentration', 'deep work'] },
  sunset: { bpmMax: 110, energyMax: 0.5, terms: ['sunset', 'golden hour', 'evening', 'dusk'] },
  morning: { bpmMin: 90, bpmMax: 130, energyMin: 0.35, terms: ['morning', 'wake up', 'sunrise'] },
  sad: { bpmMax: 100, energyMax: 0.4, terms: ['sad', 'melancholy', 'heartbreak', 'rainy'] },
  happy: { bpmMin: 100, energyMin: 0.45, terms: ['happy', 'joy', 'feel good', 'uplifting'] },
};

function tokenize(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function haystack(ctx: SmartTrackContext): string {
  return [ctx.title, ctx.artist, ctx.album, ctx.genre, ctx.year].join(' ').toLowerCase();
}

function activeMoodProfiles(tokens: string[], prompt: string): MoodProfile[] {
  const lower = prompt.toLowerCase();
  const out: MoodProfile[] = [];
  for (const profile of Object.values(MOOD_PROFILES)) {
    if (profile.terms.some((t) => lower.includes(t) || tokens.includes(t))) {
      out.push(profile);
    }
  }
  return out;
}

function genreTermsInPrompt(tokens: string[], prompt: string): string[] {
  const lower = prompt.toLowerCase();
  return GENRE_TERMS.filter(
    (g) => lower.includes(g) || tokens.some((t) => g.includes(t) || t.includes(g.replace(/\s+/g, ''))),
  );
}

export function buildSmartRulesFromAiPrompt(prompt: string): SmartPlaylistRules {
  const trimmed = prompt.trim();
  return {
    schemaVersion: 1,
    conditions: [],
    conditionLogic: 'and',
    sortBy: 'dateAdded',
    sortDirection: 'desc',
    limit: 80,
    extensions: { aiPrompt: trimmed },
  };
}

export function describeAiPromptRules(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return 'Vibe playlist';
  return `Matches "${trimmed}" via local metadata + sonic heuristics`;
}

/** Score 0–1 how well a track matches the prompt. */
export function scoreAiPromptMatch(ctx: SmartTrackContext, prompt: string): number {
  const trimmed = prompt.trim();
  if (!trimmed) return 1;

  const tokens = tokenize(trimmed);
  const text = haystack(ctx);
  let score = 0;
  let checks = 0;

  for (const token of tokens) {
    if (token.length < 3) continue;
    checks += 1;
    if (text.includes(token)) score += 1;
  }

  for (const genre of genreTermsInPrompt(tokens, trimmed)) {
    checks += 1;
    if (text.includes(genre)) score += 1.2;
  }

  const moods = activeMoodProfiles(tokens, trimmed);
  const sonic = getSonicFeaturesForTrack(ctx.lockerId);
  if (moods.length && sonic) {
    checks += moods.length;
    for (const mood of moods) {
      let moodOk = true;
      if (sonic.bpm != null) {
        if (mood.bpmMin != null && sonic.bpm < mood.bpmMin) moodOk = false;
        if (mood.bpmMax != null && sonic.bpm > mood.bpmMax) moodOk = false;
      }
      if (sonic.energy != null) {
        if (mood.energyMin != null && sonic.energy < mood.energyMin) moodOk = false;
        if (mood.energyMax != null && sonic.energy > mood.energyMax) moodOk = false;
      }
      if (moodOk) score += 1;
    }
  }

  if (checks === 0) {
    const q = trimmed.toLowerCase();
    return text.includes(q) ? 1 : 0;
  }

  return Math.min(1, score / checks);
}

export function matchesAiPrompt(ctx: SmartTrackContext, prompt: string, minScore = 0.35): boolean {
  return scoreAiPromptMatch(ctx, prompt) >= minScore;
}
