import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type PickedImage = { base64: string; width: number; height: number };

// Longest side after resizing. Keeps uploads small and encryption fast.
const MAX_DIMENSION = 1600;

// Takes or picks a photo, resizes it and returns it as base64 in memory.
// The picker and resizer each leave a temporary file in the app's cache;
// both are deleted before this returns, so the photo never stays on disk.
// Camera photos are never saved to the photo library.
export async function pickImage(source: 'camera' | 'library'): Promise<PickedImage | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Camera access is needed to take a photo.');
  }

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;

  const asset = result.assets[0];
  try {
    return await resizeToBase64(asset.uri, asset.width, asset.height);
  } finally {
    deleteTemporaryFile(asset.uri);
  }
}

async function resizeToBase64(uri: string, width: number, height: number): Promise<PickedImage> {
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > MAX_DIMENSION) {
    context.resize(width >= height ? { width: MAX_DIMENSION, height: null } : { width: null, height: MAX_DIMENSION });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ base64: true, compress: 0.7, format: SaveFormat.JPEG });
  deleteTemporaryFile(saved.uri);

  if (!saved.base64) throw new Error("Couldn't read the photo.");
  return { base64: saved.base64, width: saved.width, height: saved.height };
}

function deleteTemporaryFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('Deleting temporary photo failed:', (e as Error).message);
  }
}
