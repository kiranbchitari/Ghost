import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DialogHost } from '@/components/dialog';
import type { PickedImage } from '@/features/burn-photo/pick-image';
import { PanicButton } from '@/features/security/panic-button';
import { useAppTheme } from '@/theme/theme-provider';

type Props = {
  image: PickedImage;
  onCancel: () => void;
  onSend: (viewOnce: boolean) => Promise<void>;
};

// Preview before sending: choose whether the photo can be viewed only once.
export function PhotoComposer({ image, onCancel, onSend }: Props) {
  const { theme } = useAppTheme();
  const [viewOnce, setViewOnce] = useState(false);
  const [isSending, setIsSending] = useState(false);
  // Native SafeAreaView doesn't measure reliably inside a Modal.
  const insets = useSafeAreaInsets();

  async function send() {
    setIsSending(true);
    try {
      await onSend(viewOnce);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.topBar}>
          <Pressable onPress={onCancel} disabled={isSending} accessibilityRole="button">
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>Encrypted photo</Text>
          <View style={styles.spacer} />
        </View>

        <Image
          // Shown straight from memory; the photo isn't on disk.
          source={{ uri: `data:image/jpeg;base64,${image.base64}` }}
          style={styles.preview}
          resizeMode="contain"
        />

        <View style={styles.options}>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>View once</Text>
            <Text style={styles.optionHint}>
              They can open it one time, with screen capture blocked. Then it burns.
            </Text>
          </View>
          <Switch
            value={viewOnce}
            onValueChange={setViewOnce}
            trackColor={{ true: theme.colors.tint }}
            disabled={isSending}
          />
        </View>

        <Pressable
          style={[styles.send, { backgroundColor: theme.colors.tint }, isSending && styles.sending]}
          onPress={send}
          disabled={isSending}
          accessibilityRole="button">
          {isSending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.sendText}>{viewOnce ? 'Send · view once' : 'Send'}</Text>
          )}
        </Pressable>
      </View>
      <DialogHost />
      <PanicButton />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancel: { color: '#fff', fontSize: 16 },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  spacer: { width: 52 },
  preview: { flex: 1, width: '100%' },
  options: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
  },
  optionText: { flex: 1 },
  optionTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  optionHint: { color: '#9a9a9a', fontSize: 13, marginTop: 2 },
  send: { marginHorizontal: 16, marginBottom: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  sending: { opacity: 0.6 },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
