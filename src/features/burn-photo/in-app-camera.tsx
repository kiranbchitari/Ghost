import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DialogHost, showError } from '@/components/dialog';
import { photoFromCamera, type PickedImage } from '@/features/burn-photo/pick-image';
import { PanicButton } from '@/features/security/panic-button';

type Props = {
  onCapture: (image: PickedImage) => void;
  onClose: () => void;
};

type Flash = 'off' | 'on' | 'auto';
const NEXT_FLASH: Record<Flash, Flash> = { off: 'auto', auto: 'on', on: 'off' };
const FLASH_ICON: Record<Flash, 'flash-off' | 'flash' | 'flash-outline'> = {
  off: 'flash-off',
  auto: 'flash-outline',
  on: 'flash',
};

// Ghost's own camera. The photo goes straight from the camera into memory
// (pictureRef): no file is written, nothing goes to the gallery or the Files
// app, and no other camera app is involved (on some phones the system camera
// app saves its own copy to the gallery, whatever the app asks). It's a Modal,
// which keeps the app's screenshot blocking on Android.
export function InAppCamera({ onCapture, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<Flash>('off');
  const [isReady, setIsReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  async function capture() {
    if (!camera.current || !isReady || isCapturing) return;
    setIsCapturing(true);
    try {
      const picture = await camera.current.takePictureAsync({ pictureRef: true, quality: 1, exif: false });
      onCapture(await photoFromCamera(picture));
    } catch (e) {
      showError("Couldn't take the photo", e);
    } finally {
      setIsCapturing(false);
    }
  }

  let body;
  if (!permission) {
    body = <ActivityIndicator color="#fff" />;
  } else if (!permission.granted) {
    body = (
      <View style={styles.permission}>
        <Ionicons name="camera-outline" size={48} color="#fff" />
        <Text style={styles.permissionText}>Ghost needs the camera to take photos for your encrypted chats.</Text>
        <Pressable
          style={styles.permissionButton}
          onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
          accessibilityRole="button">
          <Text style={styles.permissionButtonText}>{permission.canAskAgain ? 'Allow camera' : 'Open settings'}</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing={facing}
        flash={flash}
        mode="picture"
        onCameraReady={() => setIsReady(true)}
        onMountError={(e) => showError("Couldn't start the camera", new Error(e.message))}
      />
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        {body}

        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close camera">
            <Ionicons name="close" size={30} color="#fff" />
          </Pressable>
          {permission?.granted && (
            <Pressable
              onPress={() => setFlash((f) => NEXT_FLASH[f])}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Flash ${flash}`}>
              <Ionicons name={FLASH_ICON[flash]} size={26} color="#fff" />
            </Pressable>
          )}
        </View>

        {permission?.granted && (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.sideSlot} />
            <Pressable
              onPress={capture}
              disabled={!isReady || isCapturing}
              style={({ pressed }) => [styles.shutter, (pressed || isCapturing) && styles.shutterPressed]}
              accessibilityRole="button"
              accessibilityLabel="Take photo">
              {isCapturing && <ActivityIndicator color="#000" />}
            </Pressable>
            <Pressable
              style={styles.sideSlot}
              onPress={() => {
                setIsReady(false);
                setFacing((f) => (f === 'back' ? 'front' : 'back'));
              }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Switch camera">
              <Ionicons name="camera-reverse-outline" size={30} color="#fff" />
            </Pressable>
          </View>
        )}

        {/* Modals draw above the root: give this one its own. */}
        <PanicButton />
        <DialogHost />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  sideSlot: { width: 48, alignItems: 'center' },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: { transform: [{ scale: 0.92 }], opacity: 0.85 },
  permission: { alignItems: 'center', gap: 16, paddingHorizontal: 32 },
  permissionText: { color: '#fff', fontSize: 16, textAlign: 'center' },
  permissionButton: { backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 22, paddingVertical: 11 },
  permissionButtonText: { color: '#000', fontWeight: '600', fontSize: 16 },
});
