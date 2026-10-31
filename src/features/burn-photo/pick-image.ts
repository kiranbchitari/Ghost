import type { PictureRef } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export type PickedImage = { base64: string; width: number; height: number };

// Longest side after resizing. Keeps uploads small and encryption fast.
const MAX_DIMENSION = 1600;

// Where the photo libraries write temporary files, inside the app's private
// cache (never the gallery or the Files app).
const TEMPORARY_PHOTO_FOLDERS = ['ImagePicker', 'ImageManipulator', 'Camera'];

// Picks a photo from the library, resizes it and returns it as base64 in
// memory. The picker and resizer each leave a temporary file in the app's
// private cache; both are deleted before this returns.
//
// Photos taken in Ghost don't come through here: they're taken with Ghost's
// own camera (InAppCamera) and handed over by photoFromCamera, so they never
// pass through the phone's camera app, which on some phones also saves a copy
// to the gallery.
export async function pickImage(): Promise<PickedImage | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  if (result.canceled) return null;

  const asset = result.assets[0];
  try {
    return await resizeToBase64(asset.uri, asset.width, asset.height);
  } finally {
    deleteTemporaryFile(asset.uri);
  }
}

// A photo from Ghost's camera, still only in memory (never written to a
// file), resized and returned as base64. The in-memory image is released.
export async function photoFromCamera(picture: PictureRef): Promise<PickedImage> {
  try {
    return await resizeToBase64(picture, picture.width, picture.height);
  } finally {
    picture.release();
  }
}

async function resizeToBase64(source: string | PictureRef, width: number, height: number): Promise<PickedImage> {
  const context = ImageManipulator.manipulate(source);
  try {
    if (Math.max(width, height) > MAX_DIMENSION) {
      context.resize(width >= height ? { width: MAX_DIMENSION, height: null } : { width: null, height: MAX_DIMENSION });
    }
    const rendered = await context.renderAsync();
    // The resizer can only hand back base64 by saving a file: it exists in
    // the private cache for an instant and is deleted straight away.
    const saved = await rendered.saveAsync({ base64: true, compress: 0.7, format: SaveFormat.JPEG });
    deleteTemporaryFile(saved.uri);
    rendered.release();

    if (!saved.base64) throw new Error("Couldn't read the photo.");
    return { base64: saved.base64, width: saved.width, height: saved.height };
  } finally {
    context.release();
  }
}

function deleteTemporaryFile(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (e) {
    console.warn('Deleting temporary photo failed:', (e as Error).message);
  }
}

// Deletes any temporary photo files left behind, e.g. if the app was closed
// or crashed half-way through attaching a photo. Run on launch and on lock,
// when no photo is being attached.
export function sweepTemporaryPhotos() {
  for (const name of TEMPORARY_PHOTO_FOLDERS) {
    try {
      const folder = new Directory(Paths.cache, name);
      if (folder.exists) folder.delete();
    } catch (e) {
      console.warn(`Clearing temporary ${name} files failed:`, (e as Error).message);
    }
  }
}
