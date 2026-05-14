import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import TTSKit, { StreamHandle, Voice, SUPERTONIC_LANGUAGES } from 'react-native-tts-kit';
import { ReaderItem, loadPrefs, savePrefs } from './storage';

const SPEEDS = [1, 1.25, 1.5, 2] as const;
type Speed = (typeof SPEEDS)[number];

type Props = {
  item: ReaderItem;
  onBack: () => void;
  onUpdateItem: (id: string, patch: Partial<ReaderItem>) => void;
};

type Phase = 'idle' | 'checking' | 'needs-model' | 'downloading' | 'ready' | 'speaking';

export default function Reader({ item, onBack, onUpdateItem }: Props) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [speed, setSpeed] = useState<Speed>(1);
  const [downloadPct, setDownloadPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [voices, setVoices] = useState<Voice[]>([]);
  // Per-item voice/language wins; fall back to last-used prefs; finally to
  // a sane default ('F1' / 'en') if neither exists. Resolved once the item
  // mounts and again whenever it changes.
  const [voiceId, setVoiceId] = useState<string>(item.voiceId ?? 'F1');
  const [language, setLanguage] = useState<string>(item.language ?? 'en');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const streamRef = useRef<StreamHandle | null>(null);

  // Resolve voice/language on mount: item-specific value > last-used prefs.
  // Also load the voice list so the settings sheet can render chips.
  useEffect(() => {
    (async () => {
      try {
        const list = await TTSKit.getVoices();
        setVoices(list);
      } catch {
        // non-fatal — settings sheet just won't render voice chips
      }
      if (!item.voiceId || !item.language) {
        const prefs = await loadPrefs();
        if (!item.voiceId && prefs.voiceId) setVoiceId(prefs.voiceId);
        if (!item.language && prefs.language) setLanguage(prefs.language);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Persist the choice both on the item (so re-opening it picks the same
  // settings) and as the global last-used prefs (so the next new item starts
  // with the same defaults).
  const pickVoice = (id: string) => {
    setVoiceId(id);
    onUpdateItem(item.id, { voiceId: id });
    savePrefs({ voiceId: id, language }).catch(() => {});
  };
  const pickLanguage = (lang: string) => {
    setLanguage(lang);
    onUpdateItem(item.id, { language: lang });
    savePrefs({ voiceId, language: lang }).catch(() => {});
  };

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

  const cancelStream = () => {
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
    setPhase('speaking');

    let handle: StreamHandle;
    try {
      handle = TTSKit.stream(item.text, { engine: 'supertonic', voice: voiceId, language });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase('ready');
      return;
    }
    streamRef.current = handle;

    handle.on('end', () => {
      setPhase('ready');
      streamRef.current = null;
    });
    handle.on('error', (e: Error) => {
      setError(e.message);
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
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
    // Engine doesn't support live speed change — applies on next play.
  };

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
        <Pressable
          onPress={() => setSettingsOpen(true)}
          hitSlop={10}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
        >
          <Text style={styles.gearText}>⚙</Text>
        </Pressable>
      </View>

      {/* Article */}
      <ScrollView
        contentContainerStyle={styles.article}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.body}>{item.text}</Text>
      </ScrollView>

      {/* Player */}
      <View style={styles.player}>
        <View style={styles.playerRow}>
          <Text style={styles.progressText}>
            {isSpeaking ? 'playing' : `${item.source}`}
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

      <SettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        voices={voices}
        voiceId={voiceId}
        language={language}
        onPickVoice={pickVoice}
        onPickLanguage={pickLanguage}
      />
    </View>
  );
}

function SettingsSheet({
  visible,
  onClose,
  voices,
  voiceId,
  language,
  onPickVoice,
  onPickLanguage,
}: {
  visible: boolean;
  onClose: () => void;
  voices: Voice[];
  voiceId: string;
  language: string;
  onPickVoice: (id: string) => void;
  onPickLanguage: (lang: string) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        {/* Inner pressable swallows taps so the sheet itself doesn't close */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Voice & language</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.sheetClose}>Done</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetLabel}>Voice</Text>
            <View style={styles.chipWrap}>
              {voices.map((v) => {
                const active = v.id === voiceId;
                return (
                  <TouchableOpacity
                    key={v.id}
                    activeOpacity={0.7}
                    onPress={() => onPickVoice(v.id)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {v.gender === 'female' ? '♀' : '♂'} {v.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.sheetLabel, { marginTop: 22 }]}>Language</Text>
            <View style={styles.chipWrap}>
              {SUPERTONIC_LANGUAGES.map((l) => {
                const active = l === language;
                return (
                  <TouchableOpacity
                    key={l}
                    activeOpacity={0.7}
                    onPress={() => onPickLanguage(l)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{l}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
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
  gearText: { color: theme.text, fontSize: 22, lineHeight: 22 },
  topTitle: { color: theme.textDim, fontSize: 14, fontWeight: '500', flex: 1, textAlign: 'center' },

  article: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 220 },
  body: {
    color: theme.text,
    fontSize: 19,
    lineHeight: 30,
    letterSpacing: -0.1,
  },

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

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.bgElev,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingBottom: 32,
    maxHeight: '75%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  sheetTitle: { color: theme.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  sheetClose: { color: theme.accent, fontSize: 15, fontWeight: '600' },
  sheetScroll: { paddingHorizontal: 22, paddingBottom: 16 },
  sheetLabel: {
    color: theme.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontWeight: '600',
    marginBottom: 8,
  },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
    marginRight: 6,
    marginBottom: 6,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.text, fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600' },
});
