export type ProsodyTag = 'excited' | 'whisper' | 'calm' | 'sad' | 'angry' | 'fast' | 'slow';

export interface ProsodySegment {
  text: string;
  tags: ProsodyTag[];
}

const TAG_RE = /\[([a-z_ ]+)\]/gi;

export function parseProsody(input: string): ProsodySegment[] {
  const segments: ProsodySegment[] = [];
  let lastIndex = 0;
  let activeTags: ProsodyTag[] = [];
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(input)) !== null) {
    if (match.index > lastIndex) {
      const text = input.slice(lastIndex, match.index).trim();
      if (text) segments.push({ text, tags: [...activeTags] });
    }
    const tags = match[1]
      .toLowerCase()
      .split(/\s+/)
      .filter((t): t is ProsodyTag =>
        ['excited', 'whisper', 'calm', 'sad', 'angry', 'fast', 'slow'].includes(t)
      );
    activeTags = tags;
    lastIndex = TAG_RE.lastIndex;
  }

  const tail = input.slice(lastIndex).trim();
  if (tail) segments.push({ text: tail, tags: [...activeTags] });

  return segments.length ? segments : [{ text: input, tags: [] }];
}

export function stripProsody(input: string): string {
  return input.replace(TAG_RE, '').replace(/\s+/g, ' ').trim();
}
