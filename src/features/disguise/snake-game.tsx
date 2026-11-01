import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDisguise } from '@/features/disguise/disguise-provider';
import {
  Choice,
  GameButton,
  Header,
  LookProvider,
  rememberedTheme,
  useLook,
  type SkinId,
  type ThemeId,
} from '@/features/disguise/game/look';
import { Play, type GameSetup } from '@/features/disguise/game/play';
import {
  dailyChallenge,
  DEFAULT_PROFILE,
  EMPTY_LEADERBOARD,
  finishGame,
  LEADERBOARD_KEY,
  loadProgress,
  PROFILE_KEY,
  PROGRESS_KEYS,
  REPLAY_KEY,
  saveJson,
  type GameSummary,
  type Leaderboard,
  type Profile,
  type Replay,
} from '@/features/disguise/game/progress';
import { ReplayScreen } from '@/features/disguise/game/replay';
import {
  Achievements,
  Daily,
  LeaderboardScreen,
  Levels,
  Menu,
  Missions,
  Modes,
  Skins,
  Themes,
  type Screen,
} from '@/features/disguise/game/screens';
import { TIME_ATTACK_MS, type Mode } from '@/features/disguise/snake-logic';
import { useSession } from '@/hooks/use-session';
import { resetIdentity } from '@/services/security/reset-identity';

// A real, playable Snake game that Ghost hides behind. Nothing here mentions
// Ghost: Settings → Redeem code takes the master key, and anything else is
// just an invalid code. All of the game's own data (scores, XP, achievements,
// replays) is kept under its own "snake.*" storage keys, never touches Ghost's
// data, and never leaves the phone.

const SPEEDS = { slow: 180, normal: 130, fast: 85 } as const;
// Cells across the board.
const SIZES = { small: 14, medium: 18, large: 24 } as const;
type Speed = keyof typeof SPEEDS;
type Size = keyof typeof SIZES;
type Walls = 'solid' | 'wrap';
type Settings = { sound: boolean; vibration: boolean; speed: Speed; walls: Walls; size: Size };

const SETTINGS_KEY = 'snake.settings';
const DEFAULT_SETTINGS: Settings = { sound: true, vibration: true, speed: 'normal', walls: 'solid', size: 'medium' };
const MAX_NAME = 12;

async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SnakeGame() {
  const [profile, setProfile] = useState<Profile>(() => ({ ...DEFAULT_PROFILE, theme: rememberedTheme() }));
  return (
    <LookProvider theme={profile.theme} skin={profile.skin}>
      <Game profile={profile} setProfile={setProfile} />
    </LookProvider>
  );
}

function Game({ profile, setProfile }: { profile: Profile; setProfile: (p: Profile) => void }) {
  const insets = useSafeAreaInsets();
  const { s, p } = useLook();
  const [screen, setScreen] = useState<Screen>('menu');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [leaderboard, setLeaderboard] = useState<Leaderboard>(EMPTY_LEADERBOARD);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // The current game stays mounted (paused, hidden) while other screens are
  // open, so it can be continued. A new key starts a new game.
  const [gameKey, setGameKey] = useState<number | null>(null);
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);

  // Finishing a game reads the latest of these without waiting for a render.
  const latest = useRef({ profile, leaderboard, replay });
  latest.current = { profile, leaderboard, replay };

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSettings(), loadProgress()]).then(([loadedSettings, progress]) => {
      if (cancelled) return;
      setSettings(loadedSettings);
      setProfile(progress.profile);
      setLeaderboard(progress.leaderboard);
      setReplay(progress.replay);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [setProfile]);

  // Android back returns to the menu, then leaves the app as usual.
  useEffect(() => {
    if (screen === 'menu') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen(screen === 'levels' ? 'modes' : 'menu');
      return true;
    });
    return () => subscription.remove();
  }, [screen]);

  const updateSettings = (next: Settings) => {
    setSettings(next);
    saveJson(SETTINGS_KEY, next);
  };

  const updateProfile = (next: Profile) => {
    latest.current.profile = next;
    setProfile(next);
    saveJson(PROFILE_KEY, next);
  };

  const startGame = (mode: Mode, level?: number) => {
    if (!isLoaded) return;
    const daily = mode === 'daily' ? dailyChallenge() : null;
    let wrapsWalls = settings.walls === 'wrap';
    if (mode === 'maze' || mode === 'survival') wrapsWalls = false;
    if (daily) wrapsWalls = daily.wrapsWalls;
    setSetup({
      mode,
      cols: SIZES[settings.size],
      wrapsWalls,
      baseMs: SPEEDS[settings.speed],
      players: mode === 'duel' ? 2 : 1,
      level,
      timeLimitMs: mode === 'time' ? TIME_ATTACK_MS : (daily?.timeLimitMs ?? undefined),
      target: daily?.target,
      seed: daily?.seed,
    });
    setGameKey((key) => (key ?? 0) + 1);
    setIsGameInProgress(true);
    setScreen('play');
  };

  const onGameOver = useCallback(
    (summary: GameSummary) => {
      setIsGameInProgress(false);
      const result = finishGame(
        latest.current.profile,
        latest.current.leaderboard,
        latest.current.replay,
        summary,
        SPEEDS.fast,
      );
      latest.current = { profile: result.profile, leaderboard: result.leaderboard, replay: result.replay };
      setProfile(result.profile);
      setLeaderboard(result.leaderboard);
      setReplay(result.replay);
      saveJson(PROFILE_KEY, result.profile);
      saveJson(LEADERBOARD_KEY, result.leaderboard);
      if (result.rewards.savedReplay) saveJson(REPLAY_KEY, result.replay);
      return result.rewards;
    },
    [setProfile],
  );

  const clearGameData = () => {
    setSettings(DEFAULT_SETTINGS);
    setLeaderboard(EMPTY_LEADERBOARD);
    setReplay(null);
    setProfile(DEFAULT_PROFILE);
    latest.current = { profile: DEFAULT_PROFILE, leaderboard: EMPTY_LEADERBOARD, replay: null };
    setGameKey(null);
    setIsGameInProgress(false);
    AsyncStorage.multiRemove([SETTINGS_KEY, ...PROGRESS_KEYS]).catch(() => {});
  };

  const back = () => setScreen('menu');

  return (
    <View style={[s.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style={p.isDark ? 'light' : 'dark'} />
      {screen === 'menu' && (
        <Menu
          profile={profile}
          best={profile.stats.best.classic ?? 0}
          canContinue={isGameInProgress}
          onContinue={() => setScreen('play')}
          onOpen={setScreen}
        />
      )}
      {gameKey !== null && setup && (
        <View style={screen === 'play' ? s.fill : s.hidden}>
          <Play
            key={gameKey}
            setup={setup}
            isActive={screen === 'play'}
            sound={settings.sound}
            vibration={settings.vibration}
            best={profile.stats.best[setup.mode] ?? 0}
            onGameOver={onGameOver}
            onRestart={() => setIsGameInProgress(true)}
            onNextLevel={(level) => startGame('maze', level)}
            onMenu={back}
          />
        </View>
      )}
      {screen === 'modes' && (
        <Modes
          profile={profile}
          onPick={(mode) => (mode === 'maze' ? setScreen('levels') : startGame(mode))}
          onBack={back}
        />
      )}
      {screen === 'levels' && (
        <Levels profile={profile} onPick={(level) => startGame('maze', level)} onBack={() => setScreen('modes')} />
      )}
      {screen === 'daily' && <Daily profile={profile} onPlay={() => startGame('daily')} onBack={back} />}
      {screen === 'missions' && <Missions profile={profile} onBack={back} />}
      {screen === 'achievements' && <Achievements profile={profile} onBack={back} />}
      {screen === 'leaderboard' && <LeaderboardScreen leaderboard={leaderboard} onBack={back} />}
      {screen === 'skins' && (
        <Skins profile={profile} onPick={(skin: SkinId) => updateProfile({ ...profile, skin })} onBack={back} />
      )}
      {screen === 'themes' && (
        <Themes profile={profile} onPick={(theme: ThemeId) => updateProfile({ ...profile, theme })} onBack={back} />
      )}
      {screen === 'replay' && <ReplayScreen replay={replay} onBack={back} />}
      {screen === 'settings' && (
        <GameSettings
          settings={settings}
          onChange={updateSettings}
          playerName={profile.name}
          onPlayerName={(name) => updateProfile({ ...latest.current.profile, name })}
          onReset={clearGameData}
          onBack={back}
        />
      )}
    </View>
  );
}

function GameSettings({
  settings,
  onChange,
  playerName,
  onPlayerName,
  onReset,
  onBack,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  playerName: string;
  onPlayerName: (name: string) => void;
  onReset: () => void;
  onBack: () => void;
}) {
  const { s, p } = useLook();
  const { unlock } = useDisguise();
  const { session } = useSession();
  const [name, setName] = useState(playerName);
  const latestName = useRef(playerName);
  latestName.current = playerName;
  const [code, setCode] = useState('');
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  async function redeem() {
    const entered = code.trim();
    if (!entered || isChecking) return;
    setIsChecking(true);
    setCodeMessage(null);
    // Let the spinner draw before the (deliberately slow) key check.
    await new Promise((resolve) => setTimeout(resolve, 50));
    let ok = false;
    try {
      ok = await unlock(entered);
    } catch {
      // Treated like a wrong code; the button must never spin forever.
    } finally {
      setIsChecking(false);
      setCode('');
    }
    if (!ok) setCodeMessage('Invalid code');
  }

  // Wipes scores, settings, progress and, out of sight, the Ghost identity
  // with its keys and chats. The disguise and master key stay: the app keeps
  // opening as Snake, and Redeem code leads to a fresh, empty Ghost. Nothing on
  // screen ever hints that there was anything else.
  async function resetAll() {
    setIsConfirmingReset(false);
    onReset();
    setName(DEFAULT_PROFILE.name);
    try {
      await resetIdentity(session?.user.id);
    } catch {
      // Nothing to show: to anyone watching, the game data is simply reset.
    }
    setResetMessage('Game data reset');
  }

  const saveName = () => {
    const clean = name.trim().toUpperCase().slice(0, MAX_NAME) || DEFAULT_PROFILE.name;
    setName(clean);
    if (clean !== latestName.current) onPlayerName(clean);
  };

  return (
    <KeyboardAwareScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" bottomOffset={24}>
      <Header title="SETTINGS" onBack={onBack} />

      <View style={s.settingRow}>
        <Text style={s.settingLabel}>SOUND</Text>
        <Pressable
          onPress={() => onChange({ ...settings, sound: !settings.sound })}
          style={s.toggle}
          accessibilityRole="switch"
          accessibilityState={{ checked: settings.sound }}>
          <Text style={s.toggleText}>{settings.sound ? 'ON' : 'OFF'}</Text>
        </Pressable>
      </View>

      <View style={s.settingRow}>
        <Text style={s.settingLabel}>VIBRATION</Text>
        <Pressable
          onPress={() => onChange({ ...settings, vibration: !settings.vibration })}
          style={s.toggle}
          accessibilityRole="switch"
          accessibilityState={{ checked: settings.vibration }}>
          <Text style={s.toggleText}>{settings.vibration ? 'ON' : 'OFF'}</Text>
        </Pressable>
      </View>

      <Choice
        label="SPEED"
        options={[
          ['slow', 'SLOW'],
          ['normal', 'NORMAL'],
          ['fast', 'FAST'],
        ]}
        value={settings.speed}
        onChange={(speed) => onChange({ ...settings, speed })}
      />
      <Choice
        label="WALLS"
        options={[
          ['solid', 'SOLID'],
          ['wrap', 'PASS'],
        ]}
        value={settings.walls}
        onChange={(walls) => onChange({ ...settings, walls })}
      />
      <Text style={s.hint}>
        {settings.walls === 'solid' ? 'Hitting a wall ends the game.' : 'Go through a wall to come out the other side.'}{' '}
        Maze and Survival always have solid walls.
      </Text>
      <Choice
        label="BOARD"
        options={[
          ['small', 'S'],
          ['medium', 'M'],
          ['large', 'L'],
        ]}
        value={settings.size}
        onChange={(size) => onChange({ ...settings, size })}
      />
      <Text style={s.hint}>Speed, walls and board take effect in a new game.</Text>

      <Text style={[s.settingLabel, s.sectionGap]}>PLAYER NAME</Text>
      <TextInput
        style={[s.input, { flex: 0 }]}
        value={name}
        onChangeText={(text) => {
          const next = text.slice(0, MAX_NAME);
          setName(next);
          // Saved as it's typed, so leaving the screen mid-edit keeps it.
          const clean = next.trim().toUpperCase();
          if (clean) onPlayerName(clean);
        }}
        onBlur={saveName}
        onSubmitEditing={saveName}
        placeholder="PLAYER"
        placeholderTextColor={p.inkSoft}
        selectionColor={p.ink}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="no"
        maxLength={MAX_NAME}
        returnKeyType="done"
      />
      <Text style={s.hint}>Shown on the leaderboard.</Text>

      <Text style={[s.settingLabel, s.sectionGap]}>REDEEM CODE</Text>
      <View style={s.redeemRow}>
        <TextInput
          style={s.input}
          value={code}
          onChangeText={(text) => {
            setCode(text);
            setCodeMessage(null);
          }}
          placeholder="ENTER CODE"
          placeholderTextColor={p.inkSoft}
          selectionColor={p.ink}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          importantForAutofill="no"
          // No suggestions, and the keyboard doesn't learn what's typed.
          keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
          returnKeyType="done"
          onSubmitEditing={redeem}
        />
        <Pressable onPress={redeem} style={s.redeemButton} disabled={isChecking} accessibilityRole="button">
          {isChecking ? <ActivityIndicator color={p.bg} /> : <Text style={s.redeemText}>OK</Text>}
        </Pressable>
      </View>
      {codeMessage && <Text style={s.codeMessage}>{codeMessage}</Text>}

      <View style={s.sectionGap}>
        {isConfirmingReset ? (
          <View style={s.confirm}>
            <Text style={s.confirmText}>Erase all scores, progress and settings?</Text>
            <View style={s.confirmButtons}>
              <GameButton label="CANCEL" onPress={() => setIsConfirmingReset(false)} small />
              <GameButton label="ERASE" onPress={resetAll} small />
            </View>
          </View>
        ) : (
          <GameButton label="RESET GAME DATA" onPress={() => setIsConfirmingReset(true)} />
        )}
        {resetMessage && <Text style={s.muted}>{resetMessage}</Text>}
      </View>
    </KeyboardAwareScrollView>
  );
}
