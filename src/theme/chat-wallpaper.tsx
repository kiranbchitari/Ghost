import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { DOODLE_CELL, DOODLES, layoutDoodles } from '@/theme/doodles';

// Size of a doodle on screen (they're drawn in a 24-unit box).
const DOODLE_SIZE = 26;

let parsed: (SkPath | null)[] | null = null;
function doodlePaths() {
  parsed ??= DOODLES.map((d) => Skia.Path.MakeFromSVGString(d));
  return parsed;
}

// A full-screen doodle wallpaper behind a chat, like WhatsApp's. Drawn once as
// a single stroked path; it only redraws when the window size changes.
export const ChatWallpaper = memo(function ChatWallpaper({ stroke }: { stroke: string }) {
  const { width, height } = useWindowDimensions();

  const path = useMemo(() => {
    const sources = doodlePaths();
    const builder = Skia.PathBuilder.Make();
    for (const doodle of layoutDoodles(width, height)) {
      const source = sources[doodle.path];
      if (!source) continue;
      const matrix = Skia.Matrix()
        .translate(doodle.x + DOODLE_CELL / 2, doodle.y + DOODLE_CELL / 2)
        .rotate((doodle.rotate * Math.PI) / 180)
        .scale((doodle.scale * DOODLE_SIZE) / 24)
        .translate(-12, -12);
      builder.addPath(source, matrix);
    }
    return builder.build();
  }, [width, height]);

  return (
    <Canvas style={styles.canvas} pointerEvents="none">
      <Path path={path} style="stroke" strokeWidth={1.5} strokeCap="round" strokeJoin="round" color={stroke} />
    </Canvas>
  );
});

const styles = StyleSheet.create({
  canvas: { ...StyleSheet.absoluteFill },
});
