import { parseProsody, stripProsody } from '../prosody';

describe('parseProsody', () => {
  it('returns a single tagless segment for plain text', () => {
    expect(parseProsody('hello world')).toEqual([{ text: 'hello world', tags: [] }]);
  });

  it('returns one empty segment shape for empty input', () => {
    // The tag regex matches nothing, so input is returned as-is.
    expect(parseProsody('')).toEqual([{ text: '', tags: [] }]);
  });

  it('parses a single tag', () => {
    expect(parseProsody('[excited] hello')).toEqual([
      { text: 'hello', tags: ['excited'] },
    ]);
  });

  it('switches tags mid-string', () => {
    const out = parseProsody('hello [whisper] there [excited] world');
    expect(out).toEqual([
      { text: 'hello', tags: [] },
      { text: 'there', tags: ['whisper'] },
      { text: 'world', tags: ['excited'] },
    ]);
  });

  it('combines two tags inside one bracket group', () => {
    const out = parseProsody('[fast excited] go');
    expect(out).toEqual([{ text: 'go', tags: ['fast', 'excited'] }]);
  });

  it('drops unknown tags silently rather than throwing', () => {
    const out = parseProsody('[totallybogustag] hi');
    expect(out).toEqual([{ text: 'hi', tags: [] }]);
  });
});

describe('stripProsody', () => {
  it('passes plain text through unchanged', () => {
    expect(stripProsody('hello world')).toBe('hello world');
  });

  it('removes a single tag', () => {
    expect(stripProsody('[excited] go')).toBe('go');
  });

  it('removes multiple tags and collapses whitespace', () => {
    expect(stripProsody('[whisper]  hello   [excited]  world')).toBe('hello world');
  });

  it('handles tag-only input', () => {
    expect(stripProsody('[whisper]')).toBe('');
  });

  it('joins text directly adjacent to a tag (no whitespace inserted)', () => {
    // The current implementation simply removes the tag and collapses
    // whitespace. It does NOT insert a separator, so adjacent text fuses.
    // Documented behavior — callers should put a space before the tag if they
    // want word boundaries preserved.
    expect(stripProsody('a[whisper]b')).toBe('ab');
  });
});
