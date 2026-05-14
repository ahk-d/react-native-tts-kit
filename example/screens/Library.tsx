import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  ReaderItem,
  estimateSeconds,
  formatDuration,
  loadItems,
  newItem,
  saveItems,
  titleFor,
  upsertOnTop,
} from './storage';

type Props = {
  incomingShare: { text: string; nonce: number } | null;
  onOpenItem: (item: ReaderItem) => void;
};

export default function Library({ incomingShare, onOpenItem }: Props) {
  const [items, setItems] = useState<ReaderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pasting, setPasting] = useState(false);

  useEffect(() => {
    (async () => {
      setItems(await loadItems());
      setLoading(false);
    })();
  }, []);

  // Persist a new item, dedupe, and open the reader on it. Same flow for both
  // share-sheet and paste — the only difference is the source tag.
  const ingest = useCallback(async (raw: string, source: ReaderItem['source']) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const item = newItem(trimmed, source);
    setItems((prev) => {
      const next = upsertOnTop(prev, item);
      saveItems(next).catch(() => {});
      return next;
    });
    onOpenItem(item);
  }, [onOpenItem]);

  // Honor incoming shares: stash the latest nonce in storage isn't worth the
  // complexity; rely on App's nonce-guard pattern. Just react when the prop
  // changes.
  const [lastNonce, setLastNonce] = useState<number | null>(null);
  useEffect(() => {
    if (!incomingShare) return;
    if (lastNonce === incomingShare.nonce) return;
    setLastNonce(incomingShare.nonce);
    ingest(incomingShare.text, 'share');
  }, [incomingShare, lastNonce, ingest]);

  const paste = async () => {
    if (pasting) return;
    setPasting(true);
    try {
      const clip = await Clipboard.getStringAsync();
      if (!clip.trim()) {
        Alert.alert('Clipboard is empty', 'Copy some text first, then tap Paste.');
        return;
      }
      ingest(clip, 'paste');
    } finally {
      setPasting(false);
    }
  };

  const remove = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      saveItems(next).catch(() => {});
      return next;
    });
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.brand}>Reader</Text>
        <Text style={styles.brandSub}>{items.length > 0 ? `${items.length} saved` : 'on-device · offline'}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#8a8a92" />
        </View>
      ) : items.length === 0 ? (
        <ScrollView contentContainerStyle={styles.emptyWrap}>
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Your library is empty.</Text>
            <Text style={styles.emptyBody}>
              Share text to this app from anywhere — Notes, Safari, ChatGPT — or paste from your clipboard.
            </Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onPress={() => onOpenItem(item)}
              onLongPress={() =>
                Alert.alert('Delete?', titleFor(item.text), [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => remove(item.id) },
                ])
              }
            />
          ))}
        </ScrollView>
      )}

      <Pressable
        onPress={paste}
        disabled={pasting}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed, pasting && styles.fabDisabled]}
      >
        <Text style={styles.fabIcon}>⎘</Text>
        <Text style={styles.fabText}>Paste from clipboard</Text>
      </Pressable>
    </View>
  );
}

function ItemCard({
  item,
  onPress,
  onLongPress,
}: {
  item: ReaderItem;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const minutes = formatDuration(estimateSeconds(item.text, 1));
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} onLongPress={onLongPress} style={styles.card}>
      <Text style={styles.cardTitle} numberOfLines={2}>{titleFor(item.text)}</Text>
      <Text style={styles.cardBody} numberOfLines={3}>{item.text}</Text>
      <View style={styles.cardMeta}>
        <Text style={styles.cardMetaDot}>·</Text>
        <Text style={styles.cardMetaText}>{minutes}</Text>
        <Text style={styles.cardMetaDot}>·</Text>
        <Text style={styles.cardMetaText}>{relativeTime(item.createdAt)}</Text>
      </View>
    </TouchableOpacity>
  );
}

function relativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString();
}

const theme = {
  bg: '#0a0a0c',
  surface: '#15151a',
  surfaceElev: '#1d1d24',
  border: '#22222a',
  text: '#fafafa',
  textDim: '#9a9aa2',
  textMuted: '#5a5a60',
  accent: '#3a64ff',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },

  header: { paddingHorizontal: 22, paddingTop: 62, paddingBottom: 12 },
  brand: { color: theme.text, fontSize: 32, fontWeight: '700', letterSpacing: -0.8 },
  brandSub: { color: theme.textDim, fontSize: 13, marginTop: 2 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  list: { paddingHorizontal: 16, paddingBottom: 120 },

  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 16,
    marginTop: 10,
  },
  cardTitle: { color: theme.text, fontSize: 16, fontWeight: '600', lineHeight: 22, letterSpacing: -0.2 },
  cardBody: { color: theme.textDim, fontSize: 13, lineHeight: 19, marginTop: 6 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  cardMetaText: { color: theme.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  cardMetaDot: { color: theme.textMuted, fontSize: 11, marginHorizontal: 6 },

  emptyWrap: { flex: 1, paddingHorizontal: 22, justifyContent: 'center' },
  emptyCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: theme.border,
  },
  emptyTitle: { color: theme.text, fontSize: 17, fontWeight: '600' },
  emptyBody: { color: theme.textDim, fontSize: 14, lineHeight: 20, marginTop: 8 },

  fab: {
    position: 'absolute',
    bottom: 32,
    left: 22,
    right: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.accent,
    borderRadius: 28,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  fabPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  fabDisabled: { opacity: 0.5 },
  fabIcon: { color: '#fff', fontSize: 17, marginRight: 10, fontWeight: '700' },
  fabText: { color: '#fff', fontSize: 15, fontWeight: '600', letterSpacing: 0.2 },
});
