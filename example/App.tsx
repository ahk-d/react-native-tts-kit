import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useShareIntent } from 'expo-share-intent';
import Library from './screens/Library';
import Reader from './screens/Reader';
import type { ReaderItem } from './screens/storage';

export default function App() {
  const [openItem, setOpenItem] = useState<ReaderItem | null>(null);
  const [incomingShare, setIncomingShare] = useState<{ text: string; nonce: number } | null>(null);

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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {openItem ? (
        <Reader item={openItem} onBack={() => setOpenItem(null)} />
      ) : (
        <Library incomingShare={incomingShare} onOpenItem={setOpenItem} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0c' },
});
