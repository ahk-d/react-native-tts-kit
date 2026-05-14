import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@ttskit/reader/items/v1';

export type ItemSource = 'paste' | 'share' | 'manual';

export type ReaderItem = {
  id: string;
  text: string;
  createdAt: number;
  source: ItemSource;
};

export async function loadItems(): Promise<ReaderItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveItems(items: ReaderItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function newItem(text: string, source: ItemSource): ReaderItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: text.trim(),
    createdAt: Date.now(),
    source,
  };
}

// Insert `item`, dedupe any pre-existing entry with identical text by removing
// it first, then put the new one on top. Returns the new ordered list.
export function upsertOnTop(items: ReaderItem[], item: ReaderItem): ReaderItem[] {
  const filtered = items.filter((i) => i.text !== item.text);
  return [item, ...filtered];
}

// Reading-time helpers. Average TTS speed at 1x ≈ 150 wpm — coarse but stable.
export function estimateSeconds(text: string, speed: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return Math.round((words / 150) * 60 / speed);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m}:${s.toString().padStart(2, '0')}`;
}

// Title is the first sentence (or first ~60 chars). Lets cards feel like real
// articles instead of opaque blobs.
const TITLE_MAX = 60;
export function titleFor(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const firstSentence = t.match(/^[^.!?\n]+[.!?]?/)?.[0] ?? t;
  if (firstSentence.length <= TITLE_MAX) return firstSentence;
  return firstSentence.slice(0, TITLE_MAX - 1).trim() + '…';
}

// Splits text into sentence-ish chunks for highlighting + duration mapping.
// Mirrors the regex the native side uses (.!? + Asian punctuation) so the JS
// progression roughly tracks the audio chunks the engine emits.
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/(?<=[.!?。！？])\s+/g).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [trimmed];
}
