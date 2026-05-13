import type { Voice } from '../types';

/**
 * Supertonic-3 ships 10 voices (5 M, 5 F). Each voice is language-agnostic —
 * the model takes a `language` argument at call time, separate from the voice.
 * Pair any voice with any of the 31 supported languages.
 */
export const SUPERTONIC_VOICES: Voice[] = [
  { id: 'M1', name: 'M1', gender: 'male',   engine: 'supertonic' },
  { id: 'M2', name: 'M2', gender: 'male',   engine: 'supertonic' },
  { id: 'M3', name: 'M3', gender: 'male',   engine: 'supertonic' },
  { id: 'M4', name: 'M4', gender: 'male',   engine: 'supertonic' },
  { id: 'M5', name: 'M5', gender: 'male',   engine: 'supertonic' },
  { id: 'F1', name: 'F1', gender: 'female', engine: 'supertonic' },
  { id: 'F2', name: 'F2', gender: 'female', engine: 'supertonic' },
  { id: 'F3', name: 'F3', gender: 'female', engine: 'supertonic' },
  { id: 'F4', name: 'F4', gender: 'female', engine: 'supertonic' },
  { id: 'F5', name: 'F5', gender: 'female', engine: 'supertonic' },
];

export const SUPERTONIC_LANGUAGES = [
  'en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es',
  'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv',
  'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi',
];

export const DEFAULT_VOICE_ID = 'F1';
export const DEFAULT_LANGUAGE = 'en';

export function findVoice(id: string): Voice | undefined {
  return SUPERTONIC_VOICES.find((v) => v.id === id);
}
