import React from 'react';
import { useTranslation } from '../../i18n';
import type { NarrationVoice } from '../../narrationVoices';

export interface NarrationVoicePickerProps {
  /** Already ordered by the caller — offline voices first. */
  voices: NarrationVoice[];
  voiceId: string;
  onChange: (id: string) => void;
}

/**
 * Voice chooser for the shelves that read aloud.
 *
 * Renders nothing with one voice or none: a select holding a single option asks a question that has
 * no second answer, and it would sit above every empty shelf implying a choice was needed first.
 *
 * Shared by Documents and Ebooks so the two cannot label the same list differently.
 */
export default function NarrationVoicePicker({
  voices,
  voiceId,
  onChange,
}: NarrationVoicePickerProps) {
  const { t } = useTranslation();
  if (voices.length <= 1) return null;
  return (
    <label className="audiobook-doc-voice">
      <span className="audiobook-doc-voice-label">{t('audiobooks.voiceLabel')}</span>
      <select
        className="audiobook-doc-voice-select"
        value={voiceId}
        onChange={(e) => onChange(e.target.value)}
      >
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {/* Network voices are marked because they are the ones that fail on a train. */}
            {v.networkRequired ? `${v.label} · ${t('audiobooks.voiceOnline')}` : v.label}
          </option>
        ))}
      </select>
    </label>
  );
}
