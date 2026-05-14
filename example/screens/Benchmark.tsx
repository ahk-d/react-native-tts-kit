import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import TTSKit from 'react-native-tts-kit';

const PROMPTS = {
  short: 'Hello world.',
  sentence: 'In airplane mode, on a phone, with no cloud at all.',
  paragraph:
    'The voice you are hearing was synthesized by a small neural network running entirely on your CPU. ' +
    'There is no API key, no network round-trip, and no telemetry. This is the new shape of mobile speech AI.',
};

type Row = {
  prompt: keyof typeof PROMPTS;
  engine: 'supertonic' | 'system';
  ttfaMs: number | null;
  totalMs: number | null;
  audioMs: number | null;
  rtf: number | null;
};

const SAMPLE_RATE = 24_000;

export default function Benchmark() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  async function runOne(prompt: keyof typeof PROMPTS, engine: 'supertonic' | 'system'): Promise<Row> {
    const text = PROMPTS[prompt];
    const startedAt = Date.now();
    let firstAudioAt: number | null = null;
    let firstAudioBytes = 0;
    let totalSamples = 0;

    if (engine === 'supertonic') {
      await new Promise<void>((resolve, reject) => {
        const stream = TTSKit.stream(text, { engine, voice: 'F1', language: 'en' });
        stream.on('chunk', (pcm) => {
          if (firstAudioAt == null) {
            firstAudioAt = Date.now();
            firstAudioBytes = pcm.length;
          }
          totalSamples += pcm.length / 2; // PCM16
        });
        stream.on('end', () => resolve());
        stream.on('error', (e) => reject(e));
      });
    } else {
      await TTSKit.speak(text, {
        engine,
        language: 'en',
        onStart: () => { firstAudioAt = Date.now(); },
      });
    }

    const finishedAt = Date.now();
    const totalMs = finishedAt - startedAt;
    const ttfaMs = firstAudioAt != null ? firstAudioAt - startedAt : null;
    const audioMs = totalSamples > 0 ? (totalSamples / SAMPLE_RATE) * 1000 : null;
    const rtf = audioMs && audioMs > 0 ? totalMs / audioMs : null;

    return { prompt, engine, ttfaMs, totalMs, audioMs, rtf };
  }

  async function runAll() {
    setRunning(true);
    setRows([]);
    const out: Row[] = [];
    const matrix: Array<[keyof typeof PROMPTS, 'supertonic' | 'system']> = [
      ['short', 'supertonic'],
      ['short', 'system'],
      ['sentence', 'supertonic'],
      ['sentence', 'system'],
      ['paragraph', 'supertonic'],
    ];
    for (const [p, e] of matrix) {
      try {
        const row = await runOne(p, e);
        out.push(row);
        setRows([...out]);
      } catch {
        out.push({ prompt: p, engine: e, ttfaMs: null, totalMs: null, audioMs: null, rtf: null });
        setRows([...out]);
      }
    }
    setRunning(false);
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Benchmark</Text>
      <Text style={styles.subtitle}>3 prompts × 2 engines. TTFA is the metric that matters.</Text>

      <TouchableOpacity style={styles.cta} onPress={runAll} disabled={running}>
        <Text style={styles.ctaText}>{running ? 'Running…' : 'Run benchmarks'}</Text>
      </TouchableOpacity>

      <View style={styles.tableHeader}>
        <Text style={[styles.cell, styles.headerCell, { flex: 1.3 }]}>prompt</Text>
        <Text style={[styles.cell, styles.headerCell]}>engine</Text>
        <Text style={[styles.cell, styles.headerCell]}>TTFA</Text>
        <Text style={[styles.cell, styles.headerCell]}>total</Text>
        <Text style={[styles.cell, styles.headerCell]}>RTF</Text>
      </View>

      {rows.map((r, i) => (
        <View key={i} style={styles.row}>
          <Text style={[styles.cell, { flex: 1.3 }]}>{r.prompt}</Text>
          <Text style={styles.cell}>{r.engine}</Text>
          <Text style={[styles.cell, ttfaColor(r.ttfaMs)]}>{r.ttfaMs ?? '—'}{r.ttfaMs != null && 'ms'}</Text>
          <Text style={styles.cell}>{r.totalMs ?? '—'}{r.totalMs != null && 'ms'}</Text>
          <Text style={[styles.cell, rtfColor(r.rtf)]}>{r.rtf?.toFixed(2) ?? '—'}</Text>
        </View>
      ))}

      {rows.length > 0 && (
        <Text style={styles.footer}>
          Targets: TTFA &lt;300ms, RTF &lt;1.0.{'\n'}
          Copy-paste these numbers into the launch tweet.
        </Text>
      )}
    </ScrollView>
  );
}

function ttfaColor(ms: number | null) {
  if (ms == null) return styles.cellMuted;
  if (ms < 300) return styles.cellGood;
  if (ms < 800) return styles.cellWarn;
  return styles.cellBad;
}
function rtfColor(rtf: number | null) {
  if (rtf == null) return styles.cellMuted;
  if (rtf < 0.5) return styles.cellGood;
  if (rtf < 1.0) return styles.cellWarn;
  return styles.cellBad;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f0f10' },
  content: { padding: 20, paddingBottom: 60 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', marginTop: 40 },
  subtitle: { color: '#9aa0a6', fontSize: 14, marginTop: 4, marginBottom: 20 },
  cta: { backgroundColor: '#3a64ff', padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 20 },
  ctaText: { color: '#fff', fontWeight: '600' },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#2a2a2c', paddingBottom: 6 },
  row: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1c' },
  cell: { color: '#ddd', fontSize: 13, flex: 1 },
  headerCell: { color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  cellGood: { color: '#7df9a8' },
  cellWarn: { color: '#ffd166' },
  cellBad: { color: '#ff6b6b' },
  cellMuted: { color: '#555' },
  footer: { color: '#666', marginTop: 24, fontSize: 12, lineHeight: 18 },
});
