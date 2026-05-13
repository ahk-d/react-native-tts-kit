import {
  DEFAULT_LANGUAGE,
  DEFAULT_VOICE_ID,
  SUPERTONIC_LANGUAGES,
  SUPERTONIC_VOICES,
  findVoice,
} from '../catalog';

describe('voice catalog', () => {
  it('ships exactly 10 voices (5 male, 5 female)', () => {
    expect(SUPERTONIC_VOICES).toHaveLength(10);
    const ids = SUPERTONIC_VOICES.map((v) => v.id).sort();
    expect(ids).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5']);
    expect(SUPERTONIC_VOICES.filter((v) => v.gender === 'male')).toHaveLength(5);
    expect(SUPERTONIC_VOICES.filter((v) => v.gender === 'female')).toHaveLength(5);
  });

  it('all voices use the supertonic engine', () => {
    for (const v of SUPERTONIC_VOICES) {
      expect(v.engine).toBe('supertonic');
    }
  });

  it('exports the 31 supported languages, no Mandarin', () => {
    expect(SUPERTONIC_LANGUAGES).toHaveLength(31);
    expect(SUPERTONIC_LANGUAGES).toContain('en');
    expect(SUPERTONIC_LANGUAGES).toContain('ja');
    expect(SUPERTONIC_LANGUAGES).toContain('ko');
    // Mandarin is *not* in the open-source release — guard against accidental re-add.
    expect(SUPERTONIC_LANGUAGES).not.toContain('zh');
  });

  it('default voice and language are valid catalog entries', () => {
    expect(SUPERTONIC_VOICES.find((v) => v.id === DEFAULT_VOICE_ID)).toBeDefined();
    expect(SUPERTONIC_LANGUAGES).toContain(DEFAULT_LANGUAGE);
  });

  describe('findVoice', () => {
    it('finds a known voice', () => {
      expect(findVoice('F1')?.id).toBe('F1');
    });
    it('returns undefined for unknown voice', () => {
      expect(findVoice('zz9-plural-z-alpha')).toBeUndefined();
    });
  });
});
