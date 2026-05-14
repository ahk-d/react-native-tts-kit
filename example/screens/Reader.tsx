import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import TTSKit, { StreamHandle } from 'react-native-tts-kit';
import { ReaderItem, splitSentences } from './storage';

const SPEEDS = [1, 1.25, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];

// 150 wpm at 1x is the engine's natural pace. Per-sentence duration falls out
// of this — we tick the highlight forward on a timer rather than chunk events
// because chunks don't map 1:1 to sentences (verified empirically).
function estimateSentenceMs(sentence: string, speed: Speed): number {
  const words = sentence.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 200;
  return Math.max(400, Math.round((words / 150) * 60_000 / speed));
}

type Props = {
  item: ReaderItem;
  onBack: () => void;
};

type Phase = 'idle' | 'checking' | 'needs-model' | 'downloading' | 'ready' | 'speaking';

export default function Reader({ item, onBack }: Props) {
  const sentences = useMemo(() => splitSentences(item.text), [item.text]);

  const [phase, setPhase] = useState<Phase>('checking');
  const [activeIdx, setActiveIdx] = useState(0);
  const [speed, setSpeed] = useState<Speed>(1);
  const [downloadPct, setDownloadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<StreamHandle | null>(null);
  const tickRef = useRef<NodeJS.Timeout | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const sentencePositions = useRef<number[]>([]);

  // Check model availability once on mount. The phase machine decides what the
  // Play button does (start download vs. start speaking).
  useEffect(() => {
    (async () => {
      try {
        const ok = await TTSKit.isAvailable();
        setPhase(ok ? 'ready' : 'needs-model');
      } catch (e: any) {
        setError(e?.message ?? String(e));
        setPhase('needs-model');
      }
    })();
    return () => {
      cancelStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Advance highlighted sentence on a timer. Cheaper and more predictable than
  // counting chunk events. End-of-stream snaps to the last sentence — that's
  // the part that doesn't drift.
  const startHighlightTicker = (startIdx: number) => {
    clearTicker();
    let i = startIdx;
    setActiveIdx(i);
    scrollToSentence(i);
    const scheduleNext = () => {
      const current = sentences[i];
      if (!current) return;
      const ms = estimateSentenceMs(current, speed);
      tickRef.current = setTimeout(() => {
        i += 1;
        if (i >= sentences.length) return;
        setActiveIdx(i);
        scrollToSentence(i);
        scheduleNext();
      }, ms);
    };
    scheduleNext();
  };

  const clearTicker = () => {
    if (tickRef.current) {
      clearTimeout(tickRef.current);
      tickRef.current = null;
    }
  };

  const scrollToSentence = (idx: number) => {
    const y = sentencePositions.current[idx];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
  };

  const cancelStream = () => {
    clearTicker();
    if (streamRef.current) {
      streamRef.current.cancel().catch(() => {});
      streamRef.current = null;
    } else {
      TTSKit.stop().catch(() => {});
    }
  };

  const downloadModel = async () => {
    setError(null);
    setPhase('downloading');
    setDownloadPct(0);
    try {
      await TTSKit.prefetchModel((p) => setDownloadPct(p.percent));
      setPhase('ready');
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase('needs-model');
    }
  };

  const play = () => {
    if (phase !== 'ready') return;
    setError(null);
    setActiveIdx(0);
    setPhase('speaking');

    let handle: StreamHandle;
    try {
      handle = TTSKit.stream(item.text, { engine: 'supertonic' });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase('ready');
      return;
    }
    streamRef.current = handle;

    let started = false;
    handle.on('chunk', () => {
      if (!started) {
        started = true;
        startHighlightTicker(0);
      }
    });
    handle.on('end', () => {
      clearTicker();
      setActiveIdx(sentences.length - 1);
      setPhase('ready');
      streamRef.current = null;
    });
    handle.on('error', (e: Error) => {
      setError(e.message);
      clearTicker();
      setPhase('ready');
      streamRef.current = null;
    });
  };

  const stop = () => {
    cancelStream();
    setPhase('ready');
  };

  const cycleSpeed = () => {
    const i = SPEEDS.indexOf(speed);
    const next = SPEEDS[(i + 1) % SPEEDS.length];
    setSpeed(next);
    // If currently speaking, the audio engine doesn't support live speed
    // changes — we apply the new pace on the next play. Keep the ticker pace
    // in sync so the highlight doesn't drift visibly.
    if (phase === 'speaking') {
      clearTicker();
      startHighlightTicker(activeIdx);
    }
  };

  const total = sentences.length;
  const progress = total > 0 ? (activeIdx + 1) / total : 0;
  const isSpeaking = phase === 'speaking';

  return (
    <View style={styles.root}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
          <Text style={styles.iconBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {item.source === 'share' ? 'Shared' : item.source === 'paste' ? 'Pasted' : 'Saved'}
        </Text>
        <View style={styles.iconBtn} />
      </View>

      {/* Article */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.article}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.body}>
          {sentences.map((s, i) => (
            <Text
              key={i}
              onLayout={(e) => {
                sentencePositions.current[i] = e.nativeEvent.layout.y;
              }}
              style={i === activeIdx && isSpeaking ? styles.sentenceActive : styles.sentence}
            >
              {s}
              {i < sentences.length - 1 ? ' ' : ''}
            </Text>
          ))}
        </Text>
      </ScrollView>

      {/* Player */}
      <View style={styles.player}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <View style={styles.playerRow}>
          <Text style={styles.progressText}>
            {isSpeaking ? `${activeIdx + 1} / ${total}` : `${total} sentence${total === 1 ? '' : 's'}`}
          </Text>

          {phase === 'downloading' ? (
            <View style={styles.playBtn}>
              <ActivityIndicator color="#0a0a0c" />
            </View>
          ) : phase === 'needs-model' ? (
            <Pressable
              onPress={downloadModel}
              style={({ pressed }) => [styles.playBtn, styles.playBtnDownload, pressed && styles.pressed]}
            >
              <Text style={styles.playBtnText}>↓</Text>
            </Pressable>
          ) : isSpeaking ? (
            <Pressable
              onPress={stop}
              style={({ pressed }) => [styles.playBtn, styles.playBtnStop, pressed && styles.pressed]}
            >
              <Text style={styles.playBtnText}>‖</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={play}
              disabled={phase === 'checking'}
              style={({ pressed }) => [
                styles.playBtn,
                phase === 'checking' && styles.playBtnDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.playBtnText}>▶</Text>
            </Pressable>
          )}

          <Pressable
            onPress={cycleSpeed}
            style={({ pressed }) => [styles.speedPill, pressed && styles.pressed]}
          >
            <Text style={styles.speedPillText}>{speed}×</Text>
          </Pressable>
        </View>

        {phase === 'downloading' && (
          <Text style={styles.downloadHint}>downloading voice · {downloadPct.toFixed(0)}%</Text>
        )}
        {phase === 'needs-model' && !error && (
          <Text style={styles.downloadHint}>one-time download · ~210 MB · works offline after</Text>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    </View>
  );
}

const theme = {
  bg: '#0a0a0c',
  bgElev: '#101015',
  border: '#22222a',
  text: '#fafafa',
  textDim: '#9a9aa2',
  textMuted: '#5a5a60',
  bodyDim: '#7a7a82',
  accent: '#3a64ff',
  good: '#7df9a8',
  bad: '#ff6b6b',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 58,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  iconBtnText: { color: theme.text, fontSize: 32, lineHeight: 32, marginTop: -4 },
  topTitle: { color: theme.textDim, fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'center' },

  article: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 220 },
  body: {
    color: theme.bodyDim,
    fontSize: 19,
    lineHeight: 30,
    letterSpacing: -0.1,
  },
  sentence: { color: theme.bodyDim },
  sentenceActive: { color: theme.text, fontWeight: '500' },

  player: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.bgElev,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 38,
  },
  progressTrack: {
    height: 3,
    backgroundColor: theme.border,
    borderRadius: 1.5,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: { height: 3, backgroundColor: theme.accent },

  playerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressText: {
    color: theme.textDim,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 60,
  },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnStop: { backgroundColor: theme.good },
  playBtnDownload: { backgroundColor: theme.accent },
  playBtnDisabled: { opacity: 0.4 },
  playBtnText: { color: '#0a0a0c', fontSize: 24, fontWeight: '700', marginLeft: 2 },

  speedPill: {
    minWidth: 60,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
  },
  speedPillText: { color: theme.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },

  pressed: { opacity: 0.6 },

  downloadHint: {
    color: theme.textDim,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 10,
    letterSpacing: 0.3,
  },
  errorText: { color: theme.bad, fontSize: 12, textAlign: 'center', marginTop: 10 },
});
