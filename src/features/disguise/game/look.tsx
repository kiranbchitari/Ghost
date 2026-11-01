import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

// The game's own look: colour themes for the screen and skins for the snake.
// These belong to the game only and never touch the rest of the app.

export type ThemeId = 'lcd' | 'amber' | 'ice' | 'neon';
export type SkinId = 'classic' | 'pixel' | 'dots' | 'neon' | 'rainbow';

export type Palette = {
  name: string;
  bg: string;
  bgDark: string;
  ink: string;
  inkSoft: string;
  overlay: string;
  danger: string;
  isDark: boolean;
};

export const THEMES: Record<ThemeId, Palette & { unlockLevel: number }> = {
  lcd: {
    name: 'LCD GREEN',
    bg: '#c7d9a3',
    bgDark: '#b3c98c',
    ink: '#26331c',
    inkSoft: 'rgba(38,51,28,0.6)',
    overlay: 'rgba(199,217,163,0.9)',
    danger: '#7a1f1f',
    isDark: false,
    unlockLevel: 1,
  },
  amber: {
    name: 'AMBER',
    bg: '#f0c45a',
    bgDark: '#dcab3c',
    ink: '#3b2705',
    inkSoft: 'rgba(59,39,5,0.6)',
    overlay: 'rgba(240,196,90,0.9)',
    danger: '#8a1c0a',
    isDark: false,
    unlockLevel: 3,
  },
  ice: {
    name: 'ICE BLUE',
    bg: '#bfe3f0',
    bgDark: '#a2cfe0',
    ink: '#0f3140',
    inkSoft: 'rgba(15,49,64,0.6)',
    overlay: 'rgba(191,227,240,0.9)',
    danger: '#8a1f2c',
    isDark: false,
    unlockLevel: 4,
  },
  neon: {
    name: 'NEON',
    bg: '#1a0f33',
    bgDark: '#2b1a52',
    ink: '#d9bfff',
    inkSoft: 'rgba(217,191,255,0.6)',
    overlay: 'rgba(26,15,51,0.9)',
    danger: '#ff6b8b',
    isDark: true,
    unlockLevel: 6,
  },
};

export const SKINS: Record<SkinId, { name: string; unlockLevel: number }> = {
  classic: { name: 'CLASSIC', unlockLevel: 1 },
  pixel: { name: 'PIXEL', unlockLevel: 2 },
  dots: { name: 'RETRO DOTS', unlockLevel: 3 },
  neon: { name: 'NEON', unlockLevel: 5 },
  rainbow: { name: 'RAINBOW', unlockLevel: 8 },
};

const NEON_COLORS = ['#00d9e8', '#ff3fd2'];

// How one snake segment looks. `outlined` marks the second player's snake.
export function segmentStyle(skin: SkinId, p: Palette, index: number, size: number, outlined = false) {
  const border = Math.max(1, Math.round(size / 8));
  if (outlined) {
    return { backgroundColor: p.bg, borderWidth: border + 1, borderColor: p.ink, borderRadius: index === 0 ? size / 2 : 2 };
  }
  switch (skin) {
    case 'pixel':
      return { backgroundColor: p.bgDark, borderWidth: border + 1, borderColor: p.ink, borderRadius: 1 };
    case 'dots':
      return { backgroundColor: p.ink, borderWidth: border, borderColor: p.bg, borderRadius: size };
    case 'neon': {
      const color = NEON_COLORS[index === 0 ? 1 : 0];
      return {
        backgroundColor: color,
        borderWidth: border,
        borderColor: p.isDark ? p.bg : p.ink,
        borderRadius: 3,
        shadowColor: color,
        shadowOpacity: 0.9,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 0 },
      };
    }
    case 'rainbow':
      return {
        backgroundColor: `hsl(${(index * 24) % 360}, 80%, ${p.isDark ? 60 : 45}%)`,
        borderWidth: border,
        borderColor: p.bg,
        borderRadius: index === 0 ? 4 : 1,
      };
    default:
      return { backgroundColor: p.ink, borderWidth: 1, borderColor: p.bg, borderRadius: index === 0 ? 3 : 0 };
  }
}

export const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function makeStyles(p: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: p.bg },
    fill: { flex: 1 },
    hidden: { display: 'none' },
    menu: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { color: p.ink, fontFamily: MONO, fontSize: 48, fontWeight: '900', letterSpacing: 8, marginTop: 8 },
    subtitle: { color: p.inkSoft, fontFamily: MONO, fontSize: 14, marginTop: 4, letterSpacing: 2 },
    menuButtons: { alignSelf: 'stretch', gap: 10, marginTop: 28 },
    iconRow: { flexDirection: 'row', gap: 10 },
    iconButton: { flex: 1, borderWidth: 3, borderColor: p.ink, paddingVertical: 10, alignItems: 'center', gap: 2 },
    iconButtonText: { color: p.ink, fontFamily: MONO, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
    button: {
      borderWidth: 3,
      borderColor: p.ink,
      paddingVertical: 13,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
      backgroundColor: p.bg,
    },
    buttonSmall: { flex: 1, paddingVertical: 10 },
    buttonPressed: { backgroundColor: p.bgDark },
    buttonDisabled: { opacity: 0.45 },
    buttonText: { color: p.ink, fontFamily: MONO, fontSize: 17, fontWeight: '800', letterSpacing: 2 },
    dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: p.danger },
    play: { flex: 1, padding: 12, gap: 8 },
    playBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, gap: 12 },
    playBarIcons: { flexDirection: 'row', gap: 16 },
    hud: { color: p.ink, fontFamily: MONO, fontSize: 16, fontWeight: '800' },
    hudSmall: { color: p.ink, fontFamily: MONO, fontSize: 13, fontWeight: '800' },
    // Always takes its height, so the board doesn't jump when a power-up starts.
    effectsBar: {
      height: 30,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 8,
      borderWidth: 2,
      borderColor: p.ink,
      borderStyle: 'dashed',
    },
    effect: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    boardArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    board: { borderWidth: 3, borderColor: p.ink, boxSizing: 'content-box', backgroundColor: p.bg, overflow: 'hidden' },
    boardWrap: { borderStyle: 'dashed' },
    abs: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
    wall: { position: 'absolute', backgroundColor: p.bgDark, borderWidth: 2, borderColor: p.ink },
    wallCore: { flex: 1, margin: 2, backgroundColor: p.ink, opacity: 0.35 },
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 24,
      backgroundColor: p.overlay,
    },
    overlayTitle: { color: p.ink, fontFamily: MONO, fontSize: 28, fontWeight: '900', letterSpacing: 4, textAlign: 'center' },
    overlayText: { color: p.ink, fontFamily: MONO, fontSize: 14, fontWeight: '700', textAlign: 'center', lineHeight: 22 },
    page: { padding: 20, gap: 12, flexGrow: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 8 },
    headerTitle: { color: p.ink, fontFamily: MONO, fontSize: 22, fontWeight: '900', letterSpacing: 3, flexShrink: 1 },
    muted: { color: p.inkSoft, fontFamily: MONO, fontSize: 13, lineHeight: 19 },
    text: { color: p.ink, fontFamily: MONO, fontSize: 14, lineHeight: 20 },
    bold: { color: p.ink, fontFamily: MONO, fontSize: 16, fontWeight: '800' },
    card: { borderWidth: 3, borderColor: p.ink, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardOn: { backgroundColor: p.bgDark },
    cardBody: { flex: 1, gap: 2 },
    cardTitle: { color: p.ink, fontFamily: MONO, fontSize: 16, fontWeight: '800' },
    progressTrack: { height: 8, borderWidth: 2, borderColor: p.ink, marginTop: 4 },
    progressFill: { height: '100%', backgroundColor: p.ink },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    tabs: { flexDirection: 'row', borderWidth: 3, borderColor: p.ink },
    tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
    tabOn: { backgroundColor: p.ink },
    tabText: { color: p.ink, fontFamily: MONO, fontSize: 12, fontWeight: '800' },
    tabTextOn: { color: p.bg },
    badge: { backgroundColor: p.ink, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'center' },
    badgeText: { color: p.bg, fontFamily: MONO, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
    dashedBox: { borderWidth: 2, borderStyle: 'dashed', borderColor: p.ink, padding: 18, alignItems: 'center', gap: 8 },
    settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
    settingLabel: { color: p.ink, fontFamily: MONO, fontSize: 16, fontWeight: '800', letterSpacing: 1 },
    hint: { color: p.inkSoft, fontFamily: MONO, fontSize: 12, marginTop: -6 },
    sectionGap: { marginTop: 20 },
    toggle: { borderWidth: 3, borderColor: p.ink, paddingHorizontal: 14, paddingVertical: 6, minWidth: 70, alignItems: 'center' },
    toggleText: { color: p.ink, fontFamily: MONO, fontWeight: '800' },
    segmented: { flexDirection: 'row', borderWidth: 3, borderColor: p.ink },
    segmentOption: { minWidth: 40, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6 },
    segmentOptionOn: { backgroundColor: p.ink },
    segmentText: { color: p.ink, fontFamily: MONO, fontSize: 13, fontWeight: '800' },
    segmentTextOn: { color: p.bg },
    input: {
      flex: 1,
      borderWidth: 3,
      borderColor: p.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: p.ink,
      fontFamily: MONO,
      fontSize: 16,
    },
    redeemRow: { flexDirection: 'row', gap: 8 },
    redeemButton: { backgroundColor: p.ink, paddingHorizontal: 18, justifyContent: 'center', minWidth: 64, alignItems: 'center' },
    redeemText: { color: p.bg, fontFamily: MONO, fontSize: 16, fontWeight: '900' },
    codeMessage: { color: p.danger, fontFamily: MONO, fontSize: 14, fontWeight: '700' },
    confirm: { borderWidth: 3, borderColor: p.ink, padding: 14, gap: 12 },
    confirmText: { color: p.ink, fontFamily: MONO, fontSize: 15, fontWeight: '700' },
    confirmButtons: { flexDirection: 'row', gap: 10 },
    swatch: { width: 64, height: 36, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
    skinPreview: { flexDirection: 'row', gap: 2, width: 76 },
  });
}

export type GameStyles = ReturnType<typeof makeStyles>;

const LookContext = createContext<{ p: Palette; s: GameStyles; skin: SkinId } | null>(null);

// The last theme used, so a fresh copy of the game (e.g. the app-switcher
// cover) starts in the same colours instead of flashing the default.
let lastTheme: ThemeId = 'lcd';
export function rememberedTheme() {
  return lastTheme;
}

export function LookProvider({ theme, skin, children }: PropsWithChildren<{ theme: ThemeId; skin: SkinId }>) {
  lastTheme = theme;
  const value = useMemo(() => {
    const p = THEMES[theme] ?? THEMES.lcd;
    return { p, s: makeStyles(p), skin };
  }, [theme, skin]);
  return <LookContext.Provider value={value}>{children}</LookContext.Provider>;
}

export function useLook() {
  const value = useContext(LookContext);
  if (!value) throw new Error('useLook must be used inside LookProvider');
  return value;
}

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const { p } = useLook();
  return <MaterialCommunityIcons name={name} size={size} color={color ?? p.ink} />;
}

export function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { s } = useLook();
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
        <Icon name="arrow-left" size={26} />
      </Pressable>
      <Text style={s.headerTitle}>{title}</Text>
    </View>
  );
}

export function GameButton({
  label,
  onPress,
  small,
  icon,
  disabled,
  dot,
}: {
  label: string;
  onPress: () => void;
  small?: boolean;
  icon?: IconName;
  disabled?: boolean;
  dot?: boolean;
}) {
  const { s } = useLook();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.button, small && s.buttonSmall, pressed && s.buttonPressed, disabled && s.buttonDisabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}>
      {icon && <Icon name={icon} size={20} />}
      <Text style={s.buttonText}>{label}</Text>
      {dot && <View style={s.dot} />}
    </Pressable>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const { s } = useLook();
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View style={s.progressTrack}>
      <View style={[s.progressFill, { width: `${ratio * 100}%` }]} />
    </View>
  );
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  const { s } = useLook();
  return (
    <View style={s.tabs}>
      {options.map(([option, label]) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[s.tab, value === option && s.tabOn]}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === option }}>
          <Text style={[s.tabText, value === option && s.tabTextOn]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// A setting with a few fixed options, shown as joined boxes.
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  const { s } = useLook();
  return (
    <View style={s.settingRow}>
      <Text style={s.settingLabel}>{label}</Text>
      <View style={s.segmented}>
        {options.map(([option, text]) => (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={[s.segmentOption, value === option && s.segmentOptionOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === option }}>
            <Text style={[s.segmentText, value === option && s.segmentTextOn]}>{text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function pad(n: number, width = 3) {
  return String(Math.max(0, Math.floor(n))).padStart(width, '0');
}

export function clock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
