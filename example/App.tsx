import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import SpeechKit, { Voice, StreamHandle } from 'react-native-speechkit';
import { SUPERTONIC_LANGUAGES } from 'react-native-speechkit';
import Benchmark from './screens/Benchmark';

// One sample per supported language. Tap a chip to load it as the input.
const SAMPLE_TEXTS: Record<string, { lang: string; text: string }> = {
  english:    { lang: 'en', text: 'Hello from React Native SpeechKit. This runs fully on-device.' },
  paragraph:  { lang: 'en', text: 'In airplane mode, on a phone, with no cloud at all. The voice you are hearing was synthesized by a 99-million-parameter model running locally on your CPU.' },
  arabic:     { lang: 'ar', text: 'مرحباً. هذا يعمل بالكامل على هاتفك بدون إنترنت.' },
  bulgarian:  { lang: 'bg', text: 'Здравейте. Това работи изцяло на вашия телефон без интернет.' },
  czech:      { lang: 'cs', text: 'Ahoj. Tohle běží zcela na vašem telefonu, bez internetu.' },
  danish:     { lang: 'da', text: 'Hej. Det her kører helt på din telefon, uden internet.' },
  german:     { lang: 'de', text: 'Hallo. Das läuft vollständig auf deinem Gerät, ohne Internet.' },
  greek:      { lang: 'el', text: 'Γεια. Αυτό τρέχει πλήρως στο τηλέφωνό σας, χωρίς internet.' },
  spanish:    { lang: 'es', text: 'Hola desde React Native SpeechKit. Esto se ejecuta completamente en el dispositivo.' },
  estonian:   { lang: 'et', text: 'Tere. See töötab täielikult teie telefonis, ilma internetita.' },
  finnish:    { lang: 'fi', text: 'Hei. Tämä toimii kokonaan puhelimessasi, ilman internetiä.' },
  french:     { lang: 'fr', text: 'Bonjour. Ceci tourne entièrement sur votre téléphone, sans connexion Internet.' },
  hindi:      { lang: 'hi', text: 'नमस्ते। यह आपके फोन पर पूरी तरह से काम करता है, बिना इंटरनेट के।' },
  croatian:   { lang: 'hr', text: 'Bok. Ovo radi u potpunosti na vašem telefonu, bez interneta.' },
  hungarian:  { lang: 'hu', text: 'Helló. Ez teljesen a telefonodon fut, internet nélkül.' },
  indonesian: { lang: 'id', text: 'Halo. Ini berjalan sepenuhnya di ponsel Anda, tanpa internet.' },
  italian:    { lang: 'it', text: 'Ciao. Questo gira interamente sul tuo telefono, senza Internet.' },
  japanese:   { lang: 'ja', text: 'こんにちは。これはあなたのデバイスで完全に動作します。' },
  korean:     { lang: 'ko', text: '안녕하세요. 이것은 전적으로 당신의 기기에서 작동합니다.' },
  lithuanian: { lang: 'lt', text: 'Sveiki. Tai veikia visiškai jūsų telefone, be interneto.' },
  latvian:    { lang: 'lv', text: 'Sveiki. Tas darbojas pilnībā jūsu tālrunī, bez interneta.' },
  dutch:      { lang: 'nl', text: 'Hallo. Dit draait volledig op je telefoon, zonder internet.' },
  polish:     { lang: 'pl', text: 'Cześć. To działa w pełni na twoim telefonie, bez internetu.' },
  portuguese: { lang: 'pt', text: 'Olá. Isto funciona inteiramente no seu telefone, sem Internet.' },
  romanian:   { lang: 'ro', text: 'Salut. Asta rulează complet pe telefonul tău, fără internet.' },
  russian:    { lang: 'ru', text: 'Привет. Это работает полностью на вашем телефоне, без интернета.' },
  slovak:     { lang: 'sk', text: 'Ahoj. Toto beží úplne na vašom telefóne, bez internetu.' },
  slovenian:  { lang: 'sl', text: 'Pozdravljeni. To deluje v celoti na vašem telefonu, brez interneta.' },
  swedish:    { lang: 'sv', text: 'Hej. Det här körs helt på din telefon, utan internet.' },
  turkish:    { lang: 'tr', text: 'Merhaba. Bu, internet olmadan tamamen telefonunuzda çalışıyor.' },
  ukrainian:  { lang: 'uk', text: 'Привіт. Це працює повністю на вашому телефоні, без інтернету.' },
  vietnamese: { lang: 'vi', text: 'Xin chào. Cái này chạy hoàn toàn trên điện thoại của bạn, không cần internet.' },
};

type EngineToggle = 'supertonic' | 'system';

export default function App() {
  const [tab, setTab] = useState<'demo' | 'benchmark'>('demo');
  if (tab === 'benchmark') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar style="light" />
        <Benchmark />
        <TouchableOpacity onPress={() => setTab('demo')} style={tabStyles.switch}>
          <Text style={tabStyles.switchText}>← Back to demo</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return <DemoScreen onOpenBenchmark={() => setTab('benchmark')} />;
}

type Phase = 'idle' | 'needs-prefetch' | 'downloading' | 'ready' | 'synthesizing' | 'speaking';

function DemoScreen({ onOpenBenchmark }: { onOpenBenchmark: () => void }) {
  const [text, setText] = useState(SAMPLE_TEXTS.english.text);
  const [language, setLanguage] = useState('en');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string>('F1');
  const [engine, setEngine] = useState<EngineToggle>('supertonic');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [ttfaMs, setTtfaMs] = useState<number | null>(null);
  const [chunkCount, setChunkCount] = useState<number>(0);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const streamRef = useRef<StreamHandle | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const v = await SpeechKit.getVoices();
        setVoices(v);
        const ok = await SpeechKit.isAvailable();
        setPhase(ok ? 'ready' : 'needs-prefetch');
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();
  }, []);

  // Fast-path: dispatch the native call BEFORE updating React state. This
  // keeps the JS thread out of the critical path between tap and synthesis.
  const speak = () => {
    if (busy) return;
    const startedAt = Date.now();
    const promise = SpeechKit.speak(text, {
      voice: voiceId,
      language,
      engine,
      onStart: () => {
        setTtfaMs(Date.now() - startedAt);
        setPhase('speaking');
      },
      onDone: () => setPhase('ready'),
    });
    setBusy(true);
    setError(null);
    setTtfaMs(null);
    setChunkCount(0);
    setPhase('synthesizing');
    promise
      .catch((e: any) => {
        setError(e?.message ?? String(e));
        setPhase('ready');
      })
      .finally(() => setBusy(false));
  };

  // Streaming: native side plays each chunk as it's produced; JS just observes
  // for TTFA + chunk-count UI. The first-chunk callback is the meaningful
  // signal — that's when audio actually starts.
  const stream = () => {
    console.log('[stream] tapped', { busy, engine, voiceId, language, textLen: text.length });
    if (busy) {
      console.log('[stream] aborted: busy');
      return;
    }
    if (engine !== 'supertonic') {
      console.log('[stream] aborted: wrong engine', engine);
      setError('Streaming requires the Supertonic engine. Tap the Engine toggle.');
      return;
    }
    const startedAt = Date.now();
    setError(null);
    setTtfaMs(null);
    setChunkCount(0);
    setBusy(true);
    setPhase('synthesizing');

    let handle: StreamHandle;
    try {
      console.log('[stream] calling SpeechKit.stream()');
      handle = SpeechKit.stream(text, { voice: voiceId, language, engine });
      console.log('[stream] handle returned', { id: handle.id });
    } catch (e: any) {
      console.log('[stream] threw at call site:', e?.message ?? String(e));
      setError(e?.message ?? String(e));
      setPhase('ready');
      setBusy(false);
      return;
    }
    streamRef.current = handle;
    let firstChunkSeen = false;
    handle.on('chunk', (pcm) => {
      const ms = Date.now() - startedAt;
      if (!firstChunkSeen) {
        firstChunkSeen = true;
        console.log('[stream] FIRST CHUNK at', ms, 'ms · bytes=', pcm?.byteLength ?? 'n/a');
        setTtfaMs(ms);
        setPhase('speaking');
      } else {
        console.log('[stream] chunk at', ms, 'ms · bytes=', pcm?.byteLength ?? 'n/a');
      }
      setChunkCount((n) => n + 1);
    });
    handle.on('end', () => {
      console.log('[stream] END at', Date.now() - startedAt, 'ms');
      setPhase('ready');
      setBusy(false);
      streamRef.current = null;
    });
    handle.on('error', (e: Error) => {
      console.log('[stream] ERROR:', e.message);
      setError(e.message);
      setPhase('ready');
      setBusy(false);
      streamRef.current = null;
    });
    console.log('[stream] handlers attached, awaiting events');
  };

  const prefetch = async () => {
    setBusy(true);
    setError(null);
    setPhase('downloading');
    setDownloadPct(0);
    try {
      await SpeechKit.prefetchModel((p) => setDownloadPct(p.percent));
      setPhase('ready');
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase('needs-prefetch');
    } finally {
      setBusy(false);
      setDownloadPct(null);
    }
  };

  const stop = async () => {
    if (streamRef.current) {
      await streamRef.current.cancel();
      streamRef.current = null;
    } else {
      await SpeechKit.stop();
    }
    setPhase('ready');
    setBusy(false);
  };

  const clearCache = async () => {
    setBusy(true);
    setError(null);
    try {
      await SpeechKit.clearCache();
      setPhase('needs-prefetch');
      setTtfaMs(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const sampleEntries = useMemo(() => Object.entries(SAMPLE_TEXTS), []);

  const needsPrefetch = phase === 'needs-prefetch';
  const downloading = phase === 'downloading';
  const speaking = phase === 'speaking' || phase === 'synthesizing';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Brand */}
        <View style={styles.brand}>
          <Text style={styles.brandLabel}>react-native-speechkit</Text>
          <Text style={styles.brandTagline}>Neural TTS · on-device · 31 languages</Text>
        </View>

        {/* Hero card — the screenshot */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.phaseRow}>
              <View style={[styles.phaseDot, { backgroundColor: dotColor(phase) }]} />
              <Text style={styles.phaseText}>{phaseLabel(phase)}</Text>
            </View>
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineBadgeText}>✈︎ works offline</Text>
            </View>
          </View>

          <View style={styles.heroMetrics}>
            {ttfaMs != null ? (
              <>
                <Text style={styles.heroMetricValue}>
                  {ttfaMs}<Text style={styles.heroMetricUnit}>ms</Text>
                </Text>
                <Text style={styles.heroMetricLabel}>time to first audio</Text>
              </>
            ) : downloading ? (
              <>
                <Text style={styles.heroMetricValue}>
                  {downloadPct?.toFixed(0) ?? 0}<Text style={styles.heroMetricUnit}>%</Text>
                </Text>
                <Text style={styles.heroMetricLabel}>downloading model · ~210 MB</Text>
              </>
            ) : (
              <>
                <Text style={styles.heroMetricPlaceholder}>—</Text>
                <Text style={styles.heroMetricLabel}>{phaseLabel(phase)}</Text>
              </>
            )}
          </View>

          {/* Primary action */}
          {needsPrefetch ? (
            <Pressable
              onPress={prefetch}
              disabled={busy}
              style={({ pressed }) => [styles.primaryCta, pressed && styles.primaryCtaPressed]}
            >
              <Text style={styles.primaryCtaText}>Download model</Text>
            </Pressable>
          ) : (
            <View style={styles.ctaRow}>
              {speaking ? (
                <Pressable
                  onPress={stop}
                  style={({ pressed }) => [
                    styles.primaryCta,
                    styles.ctaPrimaryFlex,
                    styles.primaryCtaSpeaking,
                    pressed && styles.primaryCtaPressed,
                  ]}
                >
                  <Text style={styles.primaryCtaText}>■ Stop</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    onPress={speak}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.primaryCta,
                      styles.ctaPrimaryFlex,
                      pressed && styles.primaryCtaPressed,
                    ]}
                  >
                    <Text style={styles.primaryCtaText}>▶ Speak</Text>
                  </Pressable>
                  <Pressable
                    onPress={stream}
                    disabled={busy || engine !== 'supertonic'}
                    style={({ pressed }) => [
                      styles.primaryCta,
                      styles.ctaPrimaryFlex,
                      styles.primaryCtaStream,
                      (busy || engine !== 'supertonic') && styles.primaryCtaDisabled,
                      pressed && styles.primaryCtaPressed,
                    ]}
                  >
                    <Text style={styles.primaryCtaText}>
                      {engine === 'supertonic' ? '≋ Stream' : '≋ Stream (supertonic only)'}
                    </Text>
                  </Pressable>
                </>
              )}
              {engine === 'supertonic' && !speaking && (
                <Pressable
                  onPress={clearCache}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.secondaryCta,
                    pressed && styles.secondaryCtaPressed,
                  ]}
                >
                  <Text style={styles.secondaryCtaText}>Reset</Text>
                </Pressable>
              )}
            </View>
          )}

          {chunkCount > 0 && (
            <Text style={styles.chunkLine}>
              chunks: {chunkCount}{streamRef.current ? ' · streaming' : ''}
            </Text>
          )}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>

        {/* Engine toggle — A/B compare */}
        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Engine</Text>
            <Text style={styles.toggleHint}>
              {engine === 'supertonic' ? 'Supertonic-3 · 99M params · on-device' : 'expo-speech · system voice'}
            </Text>
          </View>
          <View style={styles.segmented}>
            <TouchableOpacity
              onPress={() => setEngine('system')}
              style={[styles.segment, engine === 'system' && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, engine === 'system' && styles.segmentTextActive]}>System</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setEngine('supertonic')}
              style={[styles.segment, engine === 'supertonic' && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, engine === 'supertonic' && styles.segmentTextActive]}>Supertonic</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Text input */}
        <Text style={styles.sectionLabel}>text</Text>
        <TextInput
          style={styles.input}
          multiline
          value={text}
          onChangeText={setText}
          placeholder="Type something to speak…"
          placeholderTextColor="#5a5a60"
        />

        {/* Sample shortcuts — chip stays highlighted while its text is the current input.
            If you edit the text manually the highlight drops, which is the right cue. */}
        <Text style={styles.sectionLabel}>try a sample ({sampleEntries.length})</Text>
        <View style={styles.row}>
          {sampleEntries.map(([k, v]) => {
            const isActive = text === v.text;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => { setText(v.text); setLanguage(v.lang); }}
                style={[styles.chip, isActive && styles.chipActive]}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{k}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Voice picker */}
        <Text style={styles.sectionLabel}>voice</Text>
        <View style={styles.row}>
          {voices.map((v) => (
            <TouchableOpacity
              key={v.id}
              onPress={() => setVoiceId(v.id)}
              style={[styles.chip, voiceId === v.id && styles.chipActive]}
            >
              <Text style={[styles.chipText, voiceId === v.id && styles.chipTextActive]}>
                {v.gender === 'female' ? '♀' : '♂'} {v.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Advanced — collapsed by default */}
        <Pressable onPress={() => setShowAdvanced((s) => !s)} style={styles.advancedToggle}>
          <Text style={styles.advancedToggleText}>
            {showAdvanced ? '▾' : '▸'} advanced — language ({SUPERTONIC_LANGUAGES.length}), benchmarks
          </Text>
        </Pressable>

        {showAdvanced && (
          <>
            <Text style={styles.sectionLabel}>language</Text>
            <View style={styles.row}>
              {SUPERTONIC_LANGUAGES.map((l) => (
                <TouchableOpacity
                  key={l}
                  onPress={() => setLanguage(l)}
                  style={[styles.chip, language === l && styles.chipActive]}
                >
                  <Text style={[styles.chipText, language === l && styles.chipTextActive]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ marginTop: 16 }}>
              <Pressable onPress={onOpenBenchmark} style={styles.advancedAction}>
                <Text style={styles.advancedActionText}>Open benchmark suite →</Text>
              </Pressable>
            </View>
          </>
        )}

        <View style={styles.airplane}>
          <Text style={styles.airplaneIcon}>✈︎</Text>
          <Text style={styles.airplaneText}>
            <Text style={styles.airplaneStrong}>Toggle airplane mode</Text> and tap Speak — synthesis runs entirely on your CPU.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ────────────────────────────────────────────────────────────
// Helpers — pure functions, no extra component layers

function phaseLabel(p: Phase): string {
  switch (p) {
    case 'idle': return 'initializing';
    case 'needs-prefetch': return 'tap "Download model" to begin';
    case 'downloading': return 'one-time download — works offline forever after';
    case 'ready': return 'ready';
    case 'synthesizing': return 'synthesizing';
    case 'speaking': return 'speaking';
  }
}

function dotColor(p: Phase): string {
  switch (p) {
    case 'speaking': return '#7df9a8';
    case 'synthesizing': return '#ffd166';
    case 'downloading': return '#ffd166';
    case 'ready': return '#7df9a8';
    case 'needs-prefetch': return '#ff6b6b';
    case 'idle': return '#5a5a60';
  }
}

// ────────────────────────────────────────────────────────────
// Theme & styles

const theme = {
  bg: '#0a0a0c',
  surface: '#15151a',
  surfaceElev: '#1d1d24',
  border: '#2a2a30',
  text: '#fff',
  textDim: '#8a8a92',
  textMuted: '#5a5a60',
  accent: '#3a64ff',
  accentDim: '#2a4ccc',
  good: '#7df9a8',
  warn: '#ffd166',
  bad: '#ff6b6b',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  scroll: { padding: 20, paddingBottom: 80 },

  brand: { marginTop: 50, marginBottom: 20 },
  brandLabel: { color: theme.text, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' },
  brandTagline: { color: theme.textDim, fontSize: 12, marginTop: 2 },

  hero: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 16,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroMetrics: { marginTop: 22, marginBottom: 22, alignItems: 'flex-start' },
  heroMetricValue: { color: theme.text, fontSize: 56, fontWeight: '700', letterSpacing: -2, lineHeight: 60 },
  heroMetricUnit: { color: theme.textDim, fontSize: 22, fontWeight: '500' },
  heroMetricPlaceholder: { color: theme.textMuted, fontSize: 56, fontWeight: '700', lineHeight: 60 },
  heroMetricLabel: { color: theme.textDim, fontSize: 13, marginTop: 4, textTransform: 'lowercase' },

  primaryCta: {
    backgroundColor: theme.accent,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryCtaPressed: { backgroundColor: theme.accentDim, transform: [{ scale: 0.98 }] },
  primaryCtaSpeaking: { backgroundColor: theme.good },
  primaryCtaStream: { backgroundColor: theme.warn },
  primaryCtaDisabled: { opacity: 0.4 },
  primaryCtaText: { color: '#0a0a0c', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },

  chunkLine: { color: theme.textDim, fontSize: 12, marginTop: 12, fontFamily: 'Menlo' },

  ctaRow: { flexDirection: 'row', gap: 8 },
  ctaPrimaryFlex: { flex: 1 },
  secondaryCta: {
    paddingVertical: 18,
    paddingHorizontal: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  secondaryCtaPressed: { backgroundColor: 'rgba(255,255,255,0.06)', transform: [{ scale: 0.98 }] },
  secondaryCtaText: { color: theme.textDim, fontSize: 14, fontWeight: '600' },

  errorText: { color: theme.bad, fontSize: 12, marginTop: 12 },

  phaseRow: { flexDirection: 'row', alignItems: 'center' },
  phaseDot: { width: 8, height: 8, borderRadius: 4 },
  phaseText: { color: theme.textDim, fontSize: 12, marginLeft: 8 },

  offlineBadge: {
    backgroundColor: 'rgba(125, 249, 168, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  offlineBadgeText: { color: theme.good, fontSize: 11, fontWeight: '600' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
    marginBottom: 18,
  },
  toggleLabel: { color: theme.text, fontSize: 13, fontWeight: '600' },
  toggleHint: { color: theme.textDim, fontSize: 11, marginTop: 2 },

  segmented: { flexDirection: 'row', backgroundColor: theme.bg, borderRadius: 10, padding: 2, marginLeft: 12 },
  segment: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  segmentActive: { backgroundColor: theme.surfaceElev },
  segmentText: { color: theme.textDim, fontSize: 12, fontWeight: '600' },
  segmentTextActive: { color: theme.text },

  sectionLabel: {
    color: theme.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2,
    marginTop: 18, marginBottom: 8, fontWeight: '600',
  },
  input: {
    backgroundColor: theme.surface, color: theme.text, padding: 14, borderRadius: 12,
    minHeight: 80, textAlignVertical: 'top', fontSize: 15,
    borderWidth: 1, borderColor: theme.border,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },

  chip: {
    backgroundColor: theme.surface, paddingHorizontal: 11, paddingVertical: 7,
    borderRadius: 16, borderWidth: 1, borderColor: theme.border,
    marginRight: 6, marginBottom: 6,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.text, fontSize: 12 },
  chipTextActive: { color: theme.text, fontWeight: '600' },

  advancedToggle: { marginTop: 20, paddingVertical: 4 },
  advancedToggleText: { color: theme.textDim, fontSize: 12 },

  advancedAction: {
    backgroundColor: theme.surface, padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: theme.border, alignItems: 'center',
  },
  advancedActionText: { color: theme.text, fontSize: 13 },

  airplane: {
    flexDirection: 'row', alignItems: 'center', marginTop: 30, padding: 14,
    backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border,
  },
  airplaneIcon: { fontSize: 22, color: theme.good, marginRight: 12 },
  airplaneText: { color: theme.textDim, fontSize: 12, flex: 1, lineHeight: 18 },
  airplaneStrong: { color: theme.text, fontWeight: '600' },
});

const tabStyles = StyleSheet.create({
  switch: {
    position: 'absolute', bottom: 24, alignSelf: 'center',
    paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 20, backgroundColor: theme.surface,
    borderWidth: 1, borderColor: theme.border,
  },
  switchText: { color: theme.text, fontSize: 13 },
});
