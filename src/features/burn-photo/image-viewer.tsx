import { usePreventScreenCapture } from 'expo-screen-capture';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DialogHost } from '@/components/dialog';
import { useDecryptedImage } from '@/features/messaging/attachments';
import type { DisplayMessage } from '@/features/messaging/use-messages';
import { PanicButton } from '@/features/security/panic-button';

type Props = {
  message: DisplayMessage;
  sharedKey: Uint8Array | null;
  onClose: () => void;
};

// Full-screen photo. A view-once photo blocks screen capture while open
// (screenshots come out blank, recordings show nothing) and is gone for good
// once closed.
export function ImageViewer({ message, sharedKey, onClose }: Props) {
  const { uri, error } = useDecryptedImage(message.id, message.attachment_path, message.image, sharedKey);
  const isViewOnce = message.view_once;
  // Native SafeAreaView doesn't measure reliably inside a Modal, so pad from
  // the insets directly; otherwise the buttons land under the status bar.
  const insets = useSafeAreaInsets();

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {isViewOnce && <BlockScreenCapture />}
      <View style={styles.backdrop}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator color="#fff" />
        )}
        <View style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]} pointerEvents="box-none">
          <View style={styles.topBar}>
            {isViewOnce ? <Text style={styles.label}>View once · gone when you close it</Text> : <View />}
            <Pressable onPress={onClose} style={styles.close} accessibilityRole="button">
              <Text style={styles.closeText}>{isViewOnce ? 'Close & burn' : 'Close'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
      <DialogHost />
      <PanicButton />
    </Modal>
  );
}

function BlockScreenCapture() {
  usePreventScreenCapture('view-once');
  return null;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  error: { color: '#f87171', padding: 24, textAlign: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  label: { color: '#ffb347', fontSize: 13, fontWeight: '600' },
  close: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  closeText: { color: '#fff', fontWeight: '600' },
});
