import {
  Blur,
  BlurMask,
  Canvas,
  Group,
  ImageShader,
  makeImageFromView,
  Path,
  Rect,
  Shader,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import type React from 'react';
import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

type Props = PropsWithChildren<{ onDone: () => void; style?: StyleProp<ViewStyle> }>;

const DURATION = 2000;
// Gives Skia time to prepare the shader and draw its first frame before the
// original is hidden, so there's no blank flash.
const START_DELAY = 120;
// Room around the bubble for flames, embers and smoke to spill into.
const PAD_X = 28;
const PAD_TOP = 90;
const PAD_BOTTOM = 16;

// Each shader burn owns a GPU canvas. Too many at once (erasing a whole chat)
// or one taller than the GPU's texture limit crashes Metal, so cap both and
// fall back to a lightweight burn beyond that.
const MAX_SHADER_BURNS = 3;
const MAX_CANVAS_POINTS = 1200;
const LITE_DURATION = 900;
let activeShaderBurns = 0;

// Burns the snapshot of its children: a noisy front spreads from a random
// ignition point, with a white-hot rim, orange flame, charred margin and
// nothing left behind.
const BURN_SHADER = Skia.RuntimeEffect.Make(`
uniform shader image;
uniform float progress;
uniform float4 box;
uniform float2 origin;
uniform float seed;
uniform float glowOnly;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7)) + seed) * 43758.5453);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x),
             mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

half4 main(float2 xy) {
  float2 local = xy - box.xy;
  float2 uv = local / box.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return half4(0.0);
  }

  half4 c = image.eval(xy);

  // Distance from the ignition point, roughened by noise in pixel space so
  // the front looks the same on short and tall bubbles.
  float d = length((uv - origin) * box.zw) / length(box.zw);
  float field = d * 0.65 + fbm(local / 22.0) * 0.45;
  float front = mix(-0.1, 1.15, progress);
  float edge = field - front;

  if (edge < 0.0) {
    return half4(0.0);
  }

  float flicker = 0.75 + 0.25 * fbm(local / 9.0 + float2(0.0, progress * 9.0));
  float ember = 1.0 - smoothstep(0.0, 0.035, edge);
  float scorch = 1.0 - smoothstep(0.035, 0.17, edge);

  float3 hot = mix(float3(1.0, 0.42, 0.05), float3(1.0, 0.93, 0.72), ember * ember) * flicker;

  if (glowOnly > 0.5) {
    float g = (ember + scorch * 0.25) * c.a;
    return half4(half3(hot * g), half(g));
  }

  float3 base = c.a > 0.0 ? c.rgb / c.a : float3(0.0);
  float3 charred = mix(base, float3(0.11, 0.055, 0.03), scorch * 0.92);
  // Heat glow just behind the charring.
  charred += float3(0.55, 0.18, 0.0) * scorch * (1.0 - scorch) * 0.8;
  float3 color = mix(charred, hot, ember);
  return half4(half3(color * c.a), c.a);
}
`)!;

type Particle = { x: number; y: number; start: number; life: number; rise: number; drift: number; size: number; phase: number };

// Rough progress at which the burn front reaches a point, matching the
// shader's field without its noise term.
function arrival(u: number, v: number, origin: { x: number; y: number }, w: number, h: number) {
  const d = Math.hypot((u - origin.x) * w, (v - origin.y) * h) / Math.hypot(w, h);
  return Math.min(0.95, Math.max(0, (d * 0.65 + 0.2 + 0.1) / 1.25));
}

function makeParticles(
  count: number,
  w: number,
  h: number,
  origin: { x: number; y: number },
  shape: { life: [number, number]; rise: [number, number]; drift: number; size: [number, number] },
): Particle[] {
  const between = ([min, max]: [number, number]) => min + Math.random() * (max - min);
  return Array.from({ length: count }, () => {
    const u = Math.random();
    const v = Math.random();
    return {
      x: PAD_X + u * w,
      y: PAD_TOP + v * h,
      start: arrival(u, v, origin, w, h) + (Math.random() - 0.5) * 0.08,
      life: between(shape.life),
      rise: between(shape.rise),
      drift: (Math.random() - 0.5) * shape.drift,
      size: between(shape.size),
      phase: Math.random() * Math.PI * 2,
    };
  });
}

export function BurnEffect({ children, onDone, style }: Props) {
  // makeImageFromView is typed for class components; the native view works.
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [image, setImage] = useState<SkImage | null>(null);
  const [mode, setMode] = useState<'pending' | 'shader' | 'lite'>('pending');
  const holdsSlot = useRef(false);
  const progress = useSharedValue(0);

  useEffect(
    () => () => {
      if (holdsSlot.current) activeShaderBurns -= 1;
    },
    [],
  );

  // Ignition point somewhere along the bottom or a side, like a dropped match.
  const origin = useMemo(
    () => (Math.random() < 0.6 ? { x: Math.random(), y: 1 } : { x: Math.random() < 0.5 ? 0 : 1, y: 0.4 + Math.random() * 0.6 }),
    [],
  );
  const seed = useMemo(() => Math.random() * 100, []);

  const particles = useMemo(() => {
    if (!size) return null;
    const { width: w, height: h } = size;
    const area = Math.max(1, (w * h) / 6000);
    return {
      embers: makeParticles(Math.min(70, Math.round(18 + area * 6)), w, h, origin, {
        life: [0.18, 0.4],
        rise: [40, 120],
        drift: 50,
        size: [1, 2.6],
      }),
      smoke: makeParticles(Math.min(14, Math.round(5 + area)), w, h, origin, {
        life: [0.45, 0.7],
        rise: [60, 120],
        drift: 50,
        size: [10, 16],
      }),
    };
  }, [size, origin]);

  function capture(event: LayoutChangeEvent) {
    if (mode !== 'pending') return;
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });

    const tooBig = width + PAD_X * 2 > MAX_CANVAS_POINTS || height + PAD_TOP + PAD_BOTTOM > MAX_CANVAS_POINTS;
    if (tooBig || activeShaderBurns >= MAX_SHADER_BURNS) {
      setMode('lite');
      return;
    }
    activeShaderBurns += 1;
    holdsSlot.current = true;
    setMode('shader');

    // Wait a frame so the bubble is drawn before snapshotting it.
    requestAnimationFrame(() => {
      makeImageFromView(ref as unknown as React.RefObject<React.Component<unknown, unknown>>)
        .then((snapshot) => (snapshot ? setImage(snapshot) : onDone()))
        .catch(() => onDone());
    });
  }

  useEffect(() => {
    if (mode !== 'lite') return;
    progress.value = withTiming(1, { duration: LITE_DURATION, easing: Easing.in(Easing.quad) }, (finished) => {
      if (finished) scheduleOnRN(onDone);
    });
  }, [mode, progress, onDone]);

  useEffect(() => {
    if (!image) return;
    progress.value = withDelay(
      START_DELAY,
      withTiming(1, { duration: DURATION, easing: Easing.inOut(Easing.quad) }, (finished) => {
        if (finished) scheduleOnRN(onDone);
      }),
    );

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const timers = [450, 900, 1300].map((delay) =>
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [image, progress, onDone]);

  const box = size ? [PAD_X, PAD_TOP, size.width, size.height] : [0, 0, 1, 1];
  const burnUniforms = useDerivedValue(() => ({
    progress: progress.value,
    box,
    origin: [origin.x, origin.y],
    seed,
    glowOnly: 0,
  }));
  const glowUniforms = useDerivedValue(() => ({ ...burnUniforms.value, glowOnly: 1 }));

  const embers = useDerivedValue(() => {
    const path = Skia.PathBuilder.Make();
    if (!particles) return path.detach();
    const p = progress.value;
    for (const e of particles.embers) {
      const t = (p - e.start) / e.life;
      if (t <= 0 || t >= 1) continue;
      const lift = t * (2 - t);
      path.addCircle(
        e.x + e.drift * t + Math.sin(t * 7 + e.phase) * 3,
        e.y - e.rise * lift,
        e.size * (1 - t * 0.6),
      );
    }
    return path.detach();
  });

  const smoke = useDerivedValue(() => {
    const path = Skia.PathBuilder.Make();
    if (!particles) return path.detach();
    const p = progress.value;
    for (const s of particles.smoke) {
      const t = (p - s.start) / s.life;
      if (t <= 0 || t >= 1) continue;
      path.addCircle(
        s.x + s.drift * t + Math.sin(t * 4 + s.phase) * 6,
        s.y - s.rise * t,
        s.size * (0.5 + t * 1.8),
      );
    }
    return path.detach();
  });

  // Smoke fades as the fire dies down.
  const smokeOpacity = useDerivedValue(() => 0.18 * Math.min(1, (1 - progress.value) * 2.5));

  const isLite = mode === 'lite';
  // Shader: the canvas draws an identical copy on top, so hide the original
  // once burning. Lite: the original itself flares, shrinks and fades.
  const originalStyle = useAnimatedStyle(() =>
    isLite
      ? {
          opacity: 1 - progress.value,
          transform: [{ scale: 1 - progress.value * 0.12 }, { translateY: -progress.value * 8 }],
        }
      : { opacity: progress.value > 0 ? 0 : 1 },
  );
  const liteFlameStyle = useAnimatedStyle(() => ({
    opacity: isLite ? Math.sin(Math.min(1, progress.value * 1.4) * Math.PI) * 0.85 : 0,
  }));

  const canvasSize = size && {
    width: size.width + PAD_X * 2,
    height: size.height + PAD_TOP + PAD_BOTTOM,
  };
  const imageRect = size && { x: PAD_X, y: PAD_TOP, width: size.width, height: size.height };

  return (
    <View style={style}>
      {/* Snapshotted, then hidden while the canvas burns a copy of it. */}
      <View ref={ref} collapsable={false} onLayout={capture}>
        <Animated.View style={originalStyle}>
          {children}
          {isLite && (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.liteFlame, liteFlameStyle]} />
          )}
        </Animated.View>
      </View>
      {image && canvasSize && imageRect && (
        <Canvas pointerEvents="none" style={[styles.canvas, canvasSize]}>
          <Rect x={0} y={0} width={canvasSize.width} height={canvasSize.height}>
            <Shader source={BURN_SHADER} uniforms={burnUniforms}>
              <ImageShader image={image} fit="fill" rect={imageRect} />
            </Shader>
          </Rect>
          <Group blendMode="plus">
            <Rect x={0} y={0} width={canvasSize.width} height={canvasSize.height}>
              <Shader source={BURN_SHADER} uniforms={glowUniforms}>
                <ImageShader image={image} fit="fill" rect={imageRect} />
              </Shader>
              <Blur blur={9} />
            </Rect>
          </Group>
          <Group opacity={smokeOpacity}>
            <Path path={smoke} color="#6f6a66">
              <BlurMask blur={16} style="normal" />
            </Path>
          </Group>
          <Path path={embers} color="#ff7a1a">
            <BlurMask blur={4} style="normal" />
          </Path>
          <Path path={embers} color="#ffe4a8" />
        </Canvas>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: -PAD_X, top: -PAD_TOP },
  liteFlame: { backgroundColor: '#ff6a1a', borderRadius: 16 },
});
