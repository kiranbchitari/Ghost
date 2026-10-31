import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDisguise } from '@/features/disguise/disguise-provider';
import {
  BONUS_STEPS,
  bonusPoints,
  newGame,
  step,
  turn,
  type Direction,
  type SnakeState,
} from '@/features/disguise/snake-logic';
import { useSession } from '@/hooks/use-session';
import { resetIdentity } from '@/services/security/reset-identity';

// A real, playable Snake game that Ghost hides behind. Nothing here mentions
// Ghost: Settings → Redeem code takes the master key, and anything else is
// just an invalid code.

const LCD = '#c7d9a3';
const LCD_DARK = '#b3c98c';
const INK = '#26331c';
const INK_SOFT = 'rgba(38,51,28,0.6)';
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const SPEEDS = { slow: 180, normal: 130, fast: 85 } as const;
// Pictures for the bonus critters (snake-logic picks a kind by index).
const CRITTERS = ['bug', 'ladybug', 'spider', 'butterfly', 'snail', 'bee'] as const;
// The bonus blinks for its last few moves before it vanishes.
const BONUS_BLINK_STEPS = 10;
// How far the finger travels (in points) before its direction becomes a turn.
const STEER_DISTANCE = 22;
// Cells across the board.
const SIZES = { small: 14, medium: 18, large: 24 } as const;
type Speed = keyof typeof SPEEDS;
type Size = keyof typeof SIZES;
type Walls = 'solid' | 'wrap';
type Screen = 'menu' | 'play' | 'scores' | 'settings';
type Settings = { vibration: boolean; speed: Speed; walls: Walls; size: Size };

const SCORES_KEY = 'snake.scores';
const SETTINGS_KEY = 'snake.settings';
const DEFAULT_SETTINGS: Settings = { vibration: true, speed: 'normal', walls: 'solid', size: 'medium' };

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

export function SnakeGame() {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>('menu');
  const [scores, setScores] = useState<number[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // The current game stays mounted (paused, hidden) while the menu, scores or
  // settings are open, so it can be continued. A new key starts a new game.
  const [gameKey, setGameKey] = useState<number | null>(null);
  const [isGameInProgress, setIsGameInProgress] = useState(false);

  const newGameScreen = () => {
    setGameKey((key) => (key ?? 0) + 1);
    setIsGameInProgress(true);
    setScreen('play');
  };

  useEffect(() => {
    loadJson<number[]>(SCORES_KEY, []).then(setScores);
    loadJson<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS).then((s) => setSettings({ ...DEFAULT_SETTINGS, ...s }));
  }, []);

  // Android back returns to the menu, then leaves the app as usual.
  useEffect(() => {
    if (screen === 'menu') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen('menu');
      return true;
    });
    return () => subscription.remove();
  }, [screen]);

  const updateSettings = (next: Settings) => {
    setSettings(next);
    saveJson(SETTINGS_KEY, next);
  };

  const recordScore = useCallback((score: number) => {
    setIsGameInProgress(false);
    if (score === 0) return;
    setScores((current) => {
      const next = [...current, score].sort((a, b) => b - a).slice(0, 5);
      saveJson(SCORES_KEY, next);
      return next;
    });
  }, []);

  const clearGameData = () => {
    setScores([]);
    setSettings(DEFAULT_SETTINGS);
    AsyncStorage.multiRemove([SCORES_KEY, SETTINGS_KEY]).catch(() => {});
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      {screen === 'menu' && (
        <Menu
          best={scores[0] ?? 0}
          canContinue={isGameInProgress}
          onContinue={() => setScreen('play')}
          onNewGame={newGameScreen}
          onOpen={setScreen}
        />
      )}
      {gameKey !== null && (
        <View style={screen === 'play' ? styles.fill : styles.hidden}>
          <Play
            key={gameKey}
            isActive={screen === 'play'}
            settings={settings}
            best={scores[0] ?? 0}
            onGameOver={recordScore}
            onRestart={() => setIsGameInProgress(true)}
            onMenu={() => setScreen('menu')}
          />
        </View>
      )}
      {screen === 'scores' && <Scores scores={scores} onBack={() => setScreen('menu')} />}
      {screen === 'settings' && (
        <GameSettings
          settings={settings}
          onChange={updateSettings}
          onReset={clearGameData}
          onBack={() => setScreen('menu')}
        />
      )}
    </View>
  );
}

function Menu({
  best,
  canContinue,
  onContinue,
  onNewGame,
  onOpen,
}: {
  best: number;
  canContinue: boolean;
  onContinue: () => void;
  onNewGame: () => void;
  onOpen: (screen: Screen) => void;
}) {
  return (
    <View style={styles.menu}>
      <MaterialCommunityIcons name="snake" size={72} color={INK} />
      <Text style={styles.title}>SNAKE</Text>
      <Text style={styles.subtitle}>HI-SCORE {String(best).padStart(3, '0')}</Text>
      <View style={styles.menuButtons}>
        {canContinue && <GameButton label="CONTINUE" onPress={onContinue} />}
        <GameButton label={canContinue ? 'NEW GAME' : 'PLAY'} onPress={onNewGame} />
        <GameButton label="HIGH SCORES" onPress={() => onOpen('scores')} />
        <GameButton label="SETTINGS" onPress={() => onOpen('settings')} />
      </View>
    </View>
  );
}

function Play({
  isActive,
  settings,
  best,
  onGameOver,
  onRestart,
  onMenu,
}: {
  // False while the menu or settings cover it: the game waits, paused.
  isActive: boolean;
  settings: Settings;
  best: number;
  onGameOver: (score: number) => void;
  onRestart: () => void;
  onMenu: () => void;
}) {
  const [game, setGame] = useState<SnakeState | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [cell, setCell] = useState(0);
  const reported = useRef(false);

  // The board fills the space it's given in whole cells.
  const onBoardLayout = (e: LayoutChangeEvent) => {
    if (game) return;
    const { width, height } = e.nativeEvent.layout;
    const cols = SIZES[settings.size];
    const size = Math.floor(width / cols);
    setCell(size);
    setGame(newGame(cols, Math.max(10, Math.floor(height / size)), settings.walls === 'wrap'));
  };

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setGame((current) => {
        if (!current) return current;
        const { state, event } = step(current);
        if (settings.vibration && event === 'food') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } else if (settings.vibration && event === 'bonus') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        return state;
      });
    }, SPEEDS[settings.speed]);
    return () => clearInterval(interval);
  }, [isRunning, settings]);

  useEffect(() => {
    if (!game?.isOver || reported.current) return;
    reported.current = true;
    setIsRunning(false);
    if (settings.vibration) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    onGameOver(game.score);
  }, [game, onGameOver, settings.vibration]);

  useEffect(() => {
    if (!isActive) setIsRunning(false);
  }, [isActive]);

  // Walls can be switched mid-game; board size applies to the next game.
  useEffect(() => {
    setGame((current) => current && { ...current, wrapsWalls: settings.walls === 'wrap' });
  }, [settings.walls]);

  // Pause when the app leaves the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setIsRunning(false);
    });
    return () => subscription.remove();
  }, []);

  const gameRef = useRef(game);
  gameRef.current = game;
  const steer = (direction: Direction) => {
    setGame((current) => (current && !current.isOver ? turn(current, direction) : current));
    if (gameRef.current && !gameRef.current.isOver) setIsRunning(true);
  };

  const restart = () => {
    reported.current = false;
    setGame((current) => current && newGame(current.cols, current.rows, current.wrapsWalls));
    setIsRunning(false);
    onRestart();
  };

  // Steering follows the finger without lifting it: every STEER_DISTANCE it
  // travels, its main direction becomes the next turn, measured afresh from
  // there. So dragging right then down in one stroke turns twice.
  const anchor = useRef({ x: 0, y: 0 });
  const lastSteer = useRef<Direction | null>(null);
  const swipe = usePanGesture({
    disableReanimated: true,
    minDistance: 8,
    onBegin: () => {
      anchor.current = { x: 0, y: 0 };
      lastSteer.current = null;
    },
    onUpdate: (event) => {
      const dx = event.translationX - anchor.current.x;
      const dy = event.translationY - anchor.current.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < STEER_DISTANCE) return;
      anchor.current = { x: event.translationX, y: event.translationY };
      const direction: Direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      if (direction !== lastSteer.current) {
        lastSteer.current = direction;
        steer(direction);
      }
    },
  });

  // The whole screen takes swipes, not just the board.
  return (
    <GestureDetector gesture={swipe}>
      <View style={styles.play}>
        <View style={styles.playBar}>
          <Text style={styles.hud}>SCORE {String(game?.score ?? 0).padStart(3, '0')}</Text>
          <Text style={styles.hud}>HI {String(Math.max(best, game?.score ?? 0)).padStart(3, '0')}</Text>
          <Pressable onPress={onMenu} hitSlop={10} accessibilityRole="button" accessibilityLabel="Menu">
            <MaterialCommunityIcons name="menu" size={26} color={INK} />
          </Pressable>
        </View>

        {/* Bonus countdown: the bar shrinks as the critter's time (and worth) runs out. */}
        <View style={styles.bonusBar}>
          {game?.bonus && (
            <>
              <MaterialCommunityIcons name={CRITTERS[game.bonus.kind % CRITTERS.length]} size={18} color={INK} />
              <View style={styles.bonusTrack}>
                <View style={[styles.bonusFill, { width: `${(game.bonus.stepsLeft / BONUS_STEPS) * 100}%` }]} />
              </View>
              <Text style={styles.bonusPoints}>+{bonusPoints(game.bonus)}</Text>
            </>
          )}
        </View>

        <View style={styles.boardArea} onLayout={onBoardLayout}>
          {game && cell > 0 && (
            <View
              style={[
                styles.board,
                // Dashed walls let the snake through.
                game.wrapsWalls && styles.boardWrap,
                { width: game.cols * cell, height: game.rows * cell },
              ]}>
              <View
                style={[styles.food, { left: game.food.x * cell, top: game.food.y * cell, width: cell, height: cell }]}
              />
              {game.bonus &&
                (game.bonus.stepsLeft > BONUS_BLINK_STEPS || game.bonus.stepsLeft % 2 === 0) && (
                  <View
                    style={[
                      styles.critter,
                      { left: game.bonus.x * cell, top: game.bonus.y * cell, width: cell * 2, height: cell * 2 },
                    ]}>
                    <MaterialCommunityIcons
                      name={CRITTERS[game.bonus.kind % CRITTERS.length]}
                      size={cell * 2}
                      color={INK}
                    />
                  </View>
                )}
              {game.snake.map((p, i) => (
                <View
                  key={i}
                  style={[
                    styles.segment,
                    i === 0 && styles.head,
                    { left: p.x * cell, top: p.y * cell, width: cell, height: cell },
                  ]}
                />
              ))}
              {(!isRunning || game.isOver) && (
                <View style={styles.overlay}>
                  {game.isOver ? (
                    <>
                      <Text style={styles.overlayTitle}>GAME OVER</Text>
                      <Text style={styles.overlayText}>SCORE {game.score}</Text>
                      <GameButton label="PLAY AGAIN" onPress={restart} />
                    </>
                  ) : (
                    <Text style={styles.overlayText}>
                      {game.score > 0 ? 'PAUSED\n' : ''}SWIPE TO MOVE{'\n'}KEEP YOUR FINGER DOWN TO STEER
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </GestureDetector>
  );
}

function Scores({ scores, onBack }: { scores: number[]; onBack: () => void }) {
  return (
    <View style={styles.page}>
      <Header title="HIGH SCORES" onBack={onBack} />
      {scores.length === 0 ? (
        <Text style={styles.muted}>No scores yet. Go play!</Text>
      ) : (
        scores.map((score, i) => (
          <View key={i} style={styles.scoreRow}>
            <Text style={styles.scoreRank}>{i + 1}.</Text>
            <Text style={styles.scoreValue}>{String(score).padStart(3, '0')}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function GameSettings({
  settings,
  onChange,
  onReset,
  onBack,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onReset: () => void;
  onBack: () => void;
}) {
  const { unlock } = useDisguise();
  const { session } = useSession();
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

  // Wipes scores, settings and, out of sight, the Ghost identity with its keys
  // and chats. The disguise and master key stay: the app keeps opening as
  // Snake, and Redeem code leads to a fresh, empty Ghost. Nothing on screen
  // ever hints that there was anything else.
  async function resetAll() {
    setIsConfirmingReset(false);
    onReset();
    try {
      await resetIdentity(session?.user.id);
    } catch {
      // Nothing to show: to anyone watching, the game data is simply reset.
    }
    setResetMessage('Game data reset');
  }

  return (
    <KeyboardAwareScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" bottomOffset={24}>
      <Header title="SETTINGS" onBack={onBack} />

      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>VIBRATION</Text>
        <Pressable
          onPress={() => onChange({ ...settings, vibration: !settings.vibration })}
          style={styles.toggle}
          accessibilityRole="switch"
          accessibilityState={{ checked: settings.vibration }}>
          <Text style={styles.toggleText}>{settings.vibration ? 'ON' : 'OFF'}</Text>
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
      <Text style={styles.hint}>
        {settings.walls === 'solid' ? 'Hitting a wall ends the game.' : 'Go through a wall to come out the other side.'}
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
      <Text style={styles.hint}>Takes effect in a new game.</Text>

      <Text style={[styles.settingLabel, styles.sectionGap]}>REDEEM CODE</Text>
      <View style={styles.redeemRow}>
        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(text) => {
            setCode(text);
            setCodeMessage(null);
          }}
          placeholder="ENTER CODE"
          placeholderTextColor={INK_SOFT}
          selectionColor={INK}
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
        <Pressable onPress={redeem} style={styles.redeemButton} disabled={isChecking} accessibilityRole="button">
          {isChecking ? <ActivityIndicator color={LCD} /> : <Text style={styles.redeemText}>OK</Text>}
        </Pressable>
      </View>
      {codeMessage && <Text style={styles.codeMessage}>{codeMessage}</Text>}

      <View style={styles.sectionGap}>
        {isConfirmingReset ? (
          <View style={styles.confirm}>
            <Text style={styles.confirmText}>Erase all scores and settings?</Text>
            <View style={styles.confirmButtons}>
              <GameButton label="CANCEL" onPress={() => setIsConfirmingReset(false)} small />
              <GameButton label="ERASE" onPress={resetAll} small />
            </View>
          </View>
        ) : (
          <GameButton label="RESET GAME DATA" onPress={() => setIsConfirmingReset(true)} />
        )}
        {resetMessage && <Text style={styles.muted}>{resetMessage}</Text>}
      </View>
    </KeyboardAwareScrollView>
  );
}

// A setting with a few fixed options, shown as joined boxes.
function Choice<T extends string>({
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
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.segmented}>
        {options.map(([option, text]) => (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={[styles.segmentOption, value === option && styles.segmentOptionOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === option }}>
            <Text style={[styles.segmentText, value === option && styles.segmentTextOn]}>{text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
        <MaterialCommunityIcons name="arrow-left" size={26} color={INK} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

function GameButton({ label, onPress, small }: { label: string; onPress: () => void; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, small && styles.buttonSmall, pressed && styles.buttonPressed]}
      accessibilityRole="button">
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: LCD },
  fill: { flex: 1 },
  hidden: { display: 'none' },
  menu: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: INK, fontFamily: MONO, fontSize: 48, fontWeight: '900', letterSpacing: 8, marginTop: 8 },
  subtitle: { color: INK_SOFT, fontFamily: MONO, fontSize: 14, marginTop: 4, letterSpacing: 2 },
  menuButtons: { alignSelf: 'stretch', gap: 12, marginTop: 40 },
  button: {
    borderWidth: 3,
    borderColor: INK,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: LCD,
  },
  buttonSmall: { flex: 1, paddingVertical: 10 },
  buttonPressed: { backgroundColor: LCD_DARK },
  buttonText: { color: INK, fontFamily: MONO, fontSize: 18, fontWeight: '800', letterSpacing: 2 },
  play: { flex: 1, padding: 12, gap: 10 },
  playBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  hud: { color: INK, fontFamily: MONO, fontSize: 16, fontWeight: '800' },
  boardArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  board: { borderWidth: 3, borderColor: INK, boxSizing: 'content-box', backgroundColor: LCD },
  boardWrap: { borderStyle: 'dashed' },
  segment: { position: 'absolute', backgroundColor: INK, borderWidth: 1, borderColor: LCD },
  head: { borderRadius: 3 },
  food: { position: 'absolute', backgroundColor: INK, borderRadius: 100, transform: [{ scale: 0.7 }] },
  critter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  // Always takes its height, so the board doesn't jump when a bonus appears.
  bonusBar: { height: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  bonusTrack: { flex: 1, height: 8, borderWidth: 2, borderColor: INK },
  bonusFill: { height: '100%', backgroundColor: INK },
  bonusPoints: { color: INK, fontFamily: MONO, fontSize: 14, fontWeight: '800', minWidth: 28, textAlign: 'right' },
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
    backgroundColor: 'rgba(199,217,163,0.85)',
  },
  overlayTitle: { color: INK, fontFamily: MONO, fontSize: 28, fontWeight: '900', letterSpacing: 4 },
  overlayText: { color: INK, fontFamily: MONO, fontSize: 15, fontWeight: '700', textAlign: 'center', lineHeight: 24 },
  page: { padding: 20, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 12 },
  headerTitle: { color: INK, fontFamily: MONO, fontSize: 22, fontWeight: '900', letterSpacing: 3 },
  muted: { color: INK_SOFT, fontFamily: MONO, fontSize: 14, marginTop: 8 },
  scoreRow: { flexDirection: 'row', gap: 16, paddingVertical: 6 },
  scoreRank: { color: INK_SOFT, fontFamily: MONO, fontSize: 20, width: 32 },
  scoreValue: { color: INK, fontFamily: MONO, fontSize: 20, fontWeight: '800' },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  settingLabel: { color: INK, fontFamily: MONO, fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  hint: { color: INK_SOFT, fontFamily: MONO, fontSize: 12, marginTop: -6 },
  sectionGap: { marginTop: 20 },
  toggle: { borderWidth: 3, borderColor: INK, paddingHorizontal: 14, paddingVertical: 6, minWidth: 70, alignItems: 'center' },
  toggleText: { color: INK, fontFamily: MONO, fontWeight: '800' },
  segmented: { flexDirection: 'row', borderWidth: 3, borderColor: INK },
  segmentOption: { minWidth: 40, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6 },
  segmentOptionOn: { backgroundColor: INK },
  segmentText: { color: INK, fontFamily: MONO, fontSize: 13, fontWeight: '800' },
  segmentTextOn: { color: LCD },
  redeemRow: { flexDirection: 'row', gap: 8 },
  codeInput: {
    flex: 1,
    borderWidth: 3,
    borderColor: INK,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: INK,
    fontFamily: MONO,
    fontSize: 16,
  },
  redeemButton: { backgroundColor: INK, paddingHorizontal: 18, justifyContent: 'center', minWidth: 64, alignItems: 'center' },
  redeemText: { color: LCD, fontFamily: MONO, fontSize: 16, fontWeight: '900' },
  codeMessage: { color: '#7a1f1f', fontFamily: MONO, fontSize: 14, fontWeight: '700' },
  confirm: { borderWidth: 3, borderColor: INK, padding: 14, gap: 12 },
  confirmText: { color: INK, fontFamily: MONO, fontSize: 15, fontWeight: '700' },
  confirmButtons: { flexDirection: 'row', gap: 10 },
});
