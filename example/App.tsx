import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useShareIntent } from 'expo-share-intent';
import Library from './screens/Library';
import Reader from './screens/Reader';
import { ReaderItem, loadItems, patchItem, saveItems } from './screens/storage';

export default function App() {
  const [items, setItems] = useState<ReaderItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [incomingShare, setIncomingShare] = useState<{ text: string; nonce: number } | null>(null);

  // Library lives in App so updates from Reader (voice/language picks) are
  // reflected when the user goes back to the list.
  useEffect(() => {
    (async () => {
      setItems(await loadItems());
      setLoaded(true);
    })();
  }, []);

  // Single owner of the share-intent subscription. When text arrives via the
  // iOS Share Sheet / Android ACTION_SEND, hand it to Library which will
  // persist it and immediately open the Reader on the new item.
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    resetOnBackground: true,
  });
  useEffect(() => {
    if (!hasShareIntent) return;
    const incoming = (shareIntent?.text || shareIntent?.webUrl || '').trim();
    if (!incoming) return;
    setIncomingShare({ text: incoming, nonce: Date.now() });
    resetShareIntent();
  }, [hasShareIntent, shareIntent]);

  const updateItem = useCallback((id: string, patch: Partial<ReaderItem>) => {
    setItems((prev) => {
      const next = patchItem(prev, id, patch);
      saveItems(next).catch(() => {});
      return next;
    });
  }, []);

  const openItem = openItemId ? items.find((i) => i.id === openItemId) ?? null : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {openItem ? (
        <Reader item={openItem} onBack={() => setOpenItemId(null)} onUpdateItem={updateItem} />
      ) : (
        <Library
          items={items}
          setItems={setItems}
          loaded={loaded}
          incomingShare={incomingShare}
          onOpenItem={(item) => setOpenItemId(item.id)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0c' },
});
