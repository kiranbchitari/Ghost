export type ThemeName = 'light' | 'dark' | 'whatsapp' | 'ghost' | 'stealth';
export type ThemePreference = ThemeName | 'system';

export type ThemeColors = {
  background: string;
  // Behind the messages in a conversation (WhatsApp's beige, for example).
  chatBackground: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  // Tab bar tint, links.
  tint: string;
  // Primary buttons.
  accent: string;
  onAccent: string;
  danger: string;
  onDanger: string;
  bubbleMine: string;
  bubbleMineBorder: string;
  bubbleMineText: string;
  bubbleTheirs: string;
  bubbleTheirsBorder: string;
  bubbleTheirsText: string;
  metaMine: string;
  metaTheirs: string;
  tick: string;
  tickRead: string;
  codeCard: string;
  codeCardBorder: string;
  codeCardText: string;
  codeCardMuted: string;
  composer: string;
  input: string;
  placeholder: string;
  avatar: string;
  avatarText: string;
};

// Optional chat details for themes that copy a messenger's look closely.
// Themes without it keep the default bubbles.
export type ChatStyle = {
  bubbleRadius: number;
  // A small tail on the first bubble of each run from the same person, and
  // consecutive bubbles packed close together.
  tails: boolean;
  // Time and ticks tucked into the end of the last line of text when they fit.
  inlineMeta: boolean;
  // Double-check icons instead of ✓✓ text.
  tickIcons: boolean;
  // Hairline drop shadow under bubbles, chips and the composer field.
  shadow: string;
  // Original doodle pattern drawn over chatBackground.
  wallpaper: { stroke: string } | null;
  // The composer floats over the wallpaper instead of sitting on a bar.
  floatingComposer: boolean;
  // Notices ("end-to-end encrypted") and day headings as chips.
  systemChip: { background: string; text: string };
  dayChip: { background: string; text: string };
  // Bar and author colour in quotes: your messages, and theirs.
  quoteMine: string;
  quoteTheirs: string;
  quoteBackground: string;
  // Pill behind the active tab's icon, and the tab icon colours.
  tabPill: string;
  tabActive: string;
  tabInactive: string;
};

export type AppTheme = {
  name: ThemeName;
  label: string;
  description: string;
  isDark: boolean;
  colors: ThemeColors;
  // Soft glow on the Ghost code and key accents, or null for none.
  glow: string | null;
  // Stealth: mask message text until press-and-hold.
  privacy: { maskMessages: boolean; revealedText: string } | null;
  chat?: ChatStyle;
};

const light: AppTheme = {
  name: 'light',
  label: 'Light',
  description: 'Clean and bright.',
  isDark: false,
  glow: null,
  privacy: null,
  colors: {
    background: '#f2f2f2',
    chatBackground: '#f2f2f2',
    surface: '#ffffff',
    text: '#111111',
    textMuted: '#666666',
    border: '#cccccc',
    tint: '#0a7cff',
    accent: '#111111',
    onAccent: '#ffffff',
    danger: '#b91c1c',
    onDanger: '#ffffff',
    bubbleMine: '#111111',
    bubbleMineBorder: 'transparent',
    bubbleMineText: '#ffffff',
    bubbleTheirs: '#e5e5e5',
    bubbleTheirsBorder: 'transparent',
    bubbleTheirsText: '#111111',
    metaMine: '#aaaaaa',
    metaTheirs: '#666666',
    tick: '#aaaaaa',
    tickRead: '#53bdeb',
    codeCard: '#111111',
    codeCardBorder: 'transparent',
    codeCardText: '#ffffff',
    codeCardMuted: '#888888',
    composer: '#fafafa',
    input: '#ffffff',
    placeholder: '#999999',
    avatar: '#dddddd',
    avatarText: '#333333',
  },
};

const dark: AppTheme = {
  name: 'dark',
  label: 'Dark',
  description: 'Easy on the eyes at night.',
  isDark: true,
  glow: null,
  privacy: null,
  colors: {
    background: '#000000',
    chatBackground: '#000000',
    surface: '#1c1c1e',
    text: '#f2f2f7',
    textMuted: '#98989f',
    border: '#38383a',
    tint: '#0a84ff',
    accent: '#f2f2f7',
    onAccent: '#000000',
    danger: '#ff453a',
    onDanger: '#ffffff',
    bubbleMine: '#0a84ff',
    bubbleMineBorder: 'transparent',
    bubbleMineText: '#ffffff',
    bubbleTheirs: '#2c2c2e',
    bubbleTheirsBorder: 'transparent',
    bubbleTheirsText: '#f2f2f7',
    metaMine: 'rgba(255,255,255,0.7)',
    metaTheirs: '#98989f',
    tick: 'rgba(255,255,255,0.7)',
    // Blue on a blue bubble would vanish; use a pale cyan for "read".
    tickRead: '#a5f3fc',
    codeCard: '#1c1c1e',
    codeCardBorder: '#38383a',
    codeCardText: '#ffffff',
    codeCardMuted: '#8e8e93',
    composer: '#0d0d0d',
    input: '#1c1c1e',
    placeholder: '#636366',
    avatar: '#2c2c2e',
    avatarText: '#d1d1d6',
  },
};

// WhatsApp's light look: beige wallpaper with doodles, mint outgoing and white
// incoming bubbles with tails, time tucked into the last line, blue read
// ticks, a floating composer and green accents. The doodles are original
// artwork, not WhatsApp's wallpaper.
const whatsapp: AppTheme = {
  name: 'whatsapp',
  label: 'WhatsApp',
  description: 'Doodle wallpaper, bubble tails, green accents.',
  isDark: false,
  glow: null,
  privacy: null,
  colors: {
    background: '#ffffff',
    chatBackground: '#efeae2',
    surface: '#ffffff',
    text: '#111b21',
    textMuted: '#667781',
    border: '#e9edef',
    tint: '#1daa61',
    accent: '#1daa61',
    onAccent: '#ffffff',
    danger: '#ea0038',
    onDanger: '#ffffff',
    bubbleMine: '#d9fdd3',
    bubbleMineBorder: 'transparent',
    bubbleMineText: '#111b21',
    bubbleTheirs: '#ffffff',
    bubbleTheirsBorder: 'transparent',
    bubbleTheirsText: '#111b21',
    metaMine: '#667781',
    metaTheirs: '#667781',
    tick: '#8696a0',
    tickRead: '#53bdeb',
    codeCard: '#1daa61',
    codeCardBorder: 'transparent',
    codeCardText: '#ffffff',
    codeCardMuted: 'rgba(255,255,255,0.85)',
    composer: '#f0f2f5',
    input: '#ffffff',
    placeholder: '#8696a0',
    avatar: '#dfe5e7',
    avatarText: '#54656f',
  },
  chat: {
    bubbleRadius: 8,
    tails: true,
    inlineMeta: true,
    tickIcons: true,
    shadow: 'rgba(11,20,26,0.13)',
    wallpaper: { stroke: 'rgba(120,98,64,0.13)' },
    floatingComposer: true,
    systemChip: { background: '#ffeecd', text: '#54656f' },
    dayChip: { background: '#ffffff', text: '#54656f' },
    quoteMine: '#06cf9c',
    quoteTheirs: '#7f66ff',
    quoteBackground: 'rgba(11,20,26,0.05)',
    tabPill: '#d8fdd2',
    tabActive: '#111b21',
    tabInactive: '#54656f',
  },
};

// Spectral: near-black with lavender ectoplasm accents and see-through bubbles.
const ghost: AppTheme = {
  name: 'ghost',
  label: 'Ghost',
  description: 'Spectral and translucent. Glows in the dark.',
  isDark: true,
  glow: 'rgba(185,167,255,0.75)',
  privacy: null,
  colors: {
    background: '#07070d',
    chatBackground: '#07070d',
    surface: '#11111c',
    text: '#e4e2f5',
    textMuted: '#77749a',
    border: '#2a2840',
    tint: '#b9a7ff',
    accent: '#b9a7ff',
    onAccent: '#120f24',
    danger: '#ff7a9c',
    onDanger: '#1a0610',
    bubbleMine: 'rgba(185,167,255,0.14)',
    bubbleMineBorder: 'rgba(185,167,255,0.45)',
    bubbleMineText: '#efeaff',
    bubbleTheirs: 'rgba(255,255,255,0.04)',
    bubbleTheirsBorder: 'rgba(255,255,255,0.12)',
    bubbleTheirsText: '#d9d7ea',
    metaMine: '#9d93cc',
    metaTheirs: '#6f6c8e',
    tick: '#8f86bd',
    tickRead: '#7df9ff',
    codeCard: '#0d0c18',
    codeCardBorder: 'rgba(185,167,255,0.5)',
    codeCardText: '#efeaff',
    codeCardMuted: '#77749a',
    composer: '#0a0a12',
    input: '#11111c',
    placeholder: '#4f4c6e',
    avatar: 'rgba(185,167,255,0.12)',
    avatarText: '#b9a7ff',
  },
};

// Anti shoulder-surfing: very low contrast, so text is only legible up close,
// plus masked messages and a cover in the app switcher.
const stealth: AppTheme = {
  name: 'stealth',
  label: 'Stealth',
  description: 'Hard to read over your shoulder. Hold a message to reveal it.',
  isDark: true,
  glow: null,
  privacy: { maskMessages: true, revealedText: '#a3a3a3' },
  colors: {
    background: '#040404',
    chatBackground: '#040404',
    surface: '#0b0b0b',
    text: '#3e3e3e',
    textMuted: '#2c2c2c',
    border: '#161616',
    tint: '#4a4a4a',
    accent: '#1c1c1c',
    onAccent: '#5a5a5a',
    danger: '#2a1414',
    onDanger: '#7a4a4a',
    bubbleMine: '#0e0e0e',
    bubbleMineBorder: '#151515',
    bubbleMineText: '#444444',
    bubbleTheirs: '#090909',
    bubbleTheirsBorder: '#141414',
    bubbleTheirsText: '#444444',
    metaMine: '#2a2a2a',
    metaTheirs: '#2a2a2a',
    tick: '#2f2f2f',
    tickRead: '#2b4650',
    codeCard: '#0b0b0b',
    codeCardBorder: '#161616',
    codeCardText: '#454545',
    codeCardMuted: '#2a2a2a',
    composer: '#060606',
    input: '#0b0b0b',
    placeholder: '#262626',
    avatar: '#111111',
    avatarText: '#353535',
  },
};

export const themes: Record<ThemeName, AppTheme> = { light, dark, whatsapp, ghost, stealth };

export const themePreferences: ThemePreference[] = ['system', 'light', 'dark', 'whatsapp', 'ghost', 'stealth'];
