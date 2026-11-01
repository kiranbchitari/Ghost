import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Share, Text, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';

import { Board, ITEM_ICONS } from '@/features/disguise/game/board';
import { MAZE_LEVELS } from '@/features/disguise/game/levels';
import { clock, GameButton, Icon, pad, useLook } from '@/features/disguise/game/look';
import { dailyChallenge, dailyTitle, summarize, type GameSummary, type Rewards } from '@/features/disguise/game/progress';
import {
  newGame,
  POWER_KINDS,
  randomSeed,
  step,
  stepInterval,
  timeLeftMs,
  turn,
  type Direction,
  type GameConfig,
  type GameState,
  type RecordedTurn,
  type Snake,
} from '@/features/disguise/snake-logic';

// How far the finger travels (in points) before its direction becomes a turn.
const STEER_DISTANCE = 22;

// Everything about a game except the board's rows, which come from the space on screen.
export type GameSetup = Omit<GameConfig, 'rows' | 'seed'> & { seed?: number };

export function Play({
  setup,
  isActive,
  vibration,
  best,
  onGameOver,
  onRestart,
  onNextLevel,
  onMenu,
}: {
  setup: GameSetup;
  // False while another screen covers it: the game waits, paused.
  isActive: boolean;
  vibration: boolean;
  best: number;
  onGameOver: (summary: GameSummary) => Rewards;
  onRestart: () => void;
  onNextLevel: (level: number) => void;
  onMenu: () => void;
}) {
  const { s } = useLook();
  // The game lives in a ref (the loop and gestures read it directly) and a
  // counter re-renders the board after each change.
  const gameRef = useRef<GameState | null>(null);
  const [, setFrame] = useState(0);
  const game = gameRef.current;
  const [isRunning, setIsRunning] = useState(false);
  const [cell, setCell] = useState(0);
  const [rewards, setRewards] = useState<{ summary: GameSummary; rewards: Rewards } | null>(null);
  const turns = useRef<RecordedTurn[]>([]);
  const playHeight = useRef(0);

  const apply = (next: GameState) => {
    gameRef.current = next;
    setFrame((f) => f + 1);
  };

  const start = (cols: number, rows: number) => {
    turns.current = [];
    setRewards(null);
    apply(newGame({ ...setup, cols, rows, seed: setup.seed ?? randomSeed() }));
  };

  // The board fills the space it's given in whole cells.
  const onBoardLayout = (e: LayoutChangeEvent) => {
    if (gameRef.current) return;
    const { width, height } = e.nativeEvent.layout;
    const size = Math.floor(width / setup.cols);
    if (size <= 0) return;
    setCell(size);
    start(setup.cols, Math.max(12, Math.floor(height / size)));
  };

  const vibrate = (style: 'light' | 'success' | 'error' | 'warning') => {
    if (!vibration) return;
    const done = () => {};
    if (style === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(done);
    else
      Haptics.notificationAsync(
        style === 'success'
          ? Haptics.NotificationFeedbackType.Success
          : style === 'warning'
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Error,
      ).catch(done);
  };

  const finish = (state: GameState) => {
    setIsRunning(false);
    vibrate(state.outcome === 'cleared' ? 'success' : 'error');
    const summary = summarize(state, turns.current);
    setRewards({ summary, rewards: onGameOver(summary) });
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const vibrateRef = useRef(vibrate);
  vibrateRef.current = vibrate;

  // The loop: each move schedules the next, since power-ups and Survival change the pace.
  useEffect(() => {
    if (!isRunning) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = gameRef.current;
      if (!current || current.isOver) return;
      const { state, events } = step(current);
      apply(state);
      for (const e of events) {
        if (e.type === 'eat') vibrateRef.current(e.kind === 'apple' ? 'light' : e.kind === 'poison' ? 'warning' : 'success');
        else if (e.type === 'saved') vibrateRef.current('warning');
      }
      if (state.isOver) {
        finishRef.current(state);
        return;
      }
      timer = setTimeout(tick, stepInterval(state));
    };
    timer = setTimeout(tick, gameRef.current ? stepInterval(gameRef.current) : 100);
    return () => clearTimeout(timer);
  }, [isRunning]);

  useEffect(() => {
    if (!isActive) setIsRunning(false);
  }, [isActive]);

  // Pause when the app leaves the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setIsRunning(false);
    });
    return () => subscription.remove();
  }, []);

  const steer = (player: number, direction: Direction) => {
    const current = gameRef.current;
    if (!current || current.isOver) return;
    const next = turn(current, player, direction);
    if (next !== current) {
      turns.current.push([current.tick, player, direction]);
      apply(next);
    }
    setIsRunning(true);
  };

  const restart = () => {
    const current = gameRef.current;
    if (!current) return;
    setIsRunning(false);
    start(current.config.cols, current.config.rows);
    onRestart();
  };

  // Steering follows the finger without lifting it: every STEER_DISTANCE it
  // travels, its main direction becomes the next turn, measured afresh from
  // there. In two player games, the bottom half steers player 1 and the top
  // half player 2.
  const anchor = useRef({ x: 0, y: 0 });
  const lastSteer = useRef<Direction | null>(null);
  const strokePlayer = useRef(0);
  const swipe = usePanGesture({
    disableReanimated: true,
    minDistance: 8,
    onBegin: (event) => {
      anchor.current = { x: 0, y: 0 };
      lastSteer.current = null;
      strokePlayer.current = setup.players === 2 && event.y < playHeight.current / 2 ? 1 : 0;
    },
    onUpdate: (event) => {
      const dx = event.translationX - anchor.current.x;
      const dy = event.translationY - anchor.current.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < STEER_DISTANCE) return;
      anchor.current = { x: event.translationX, y: event.translationY };
      const direction: Direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      if (direction !== lastSteer.current) {
        lastSteer.current = direction;
        steer(strokePlayer.current, direction);
      }
    },
  });

  const isDuel = setup.players === 2;
  const score = game?.snakes[0].score ?? 0;

  if (rewards && game) {
    return (
      <GameOver
        game={game}
        summary={rewards.summary}
        rewards={rewards.rewards}
        onPlayAgain={restart}
        onNextLevel={() => onNextLevel((game.config.level ?? 1) + 1)}
        onHome={onMenu}
      />
    );
  }

  // The whole screen takes swipes, not just the board.
  return (
    <GestureDetector gesture={swipe}>
      <View style={s.play} onLayout={(e) => (playHeight.current = e.nativeEvent.layout.height)}>
        <View style={s.playBar}>
          {isDuel ? (
            <>
              <Text style={s.hud}>P1 {pad(score)}</Text>
              <Text style={s.hud}>P2 {pad(game?.snakes[1]?.score ?? 0)}</Text>
            </>
          ) : (
            <>
              <Text style={s.hud}>SCORE {pad(score)}</Text>
              <Text style={s.hud}>HI {pad(Math.max(best, score))}</Text>
            </>
          )}
          <View style={s.playBarIcons}>
            <Pressable
              onPress={() => game && !game.isOver && setIsRunning((r) => !r)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={isRunning ? 'Pause' : 'Resume'}>
              <Icon name={isRunning ? 'pause' : 'play'} size={26} />
            </Pressable>
            <Pressable onPress={onMenu} hitSlop={10} accessibilityRole="button" accessibilityLabel="Menu">
              <Icon name="menu" size={26} />
            </Pressable>
          </View>
        </View>

        <EffectsBar game={game} />

        <View style={s.boardArea} onLayout={onBoardLayout}>
          {game && cell > 0 && (
            <View>
              <Board game={game} cell={cell} />
              {!isRunning && !game.isOver && (
                <View style={s.overlay}>
                  {game.tick > 0 ? (
                    <>
                      <Text style={s.overlayTitle}>PAUSED</Text>
                      <GameButton label="RESUME" icon="play" onPress={() => setIsRunning(true)} />
                      <Text style={s.overlayText}>OR SWIPE TO CARRY ON</Text>
                    </>
                  ) : (
                    <>
                      <Text style={s.overlayTitle}>{MODE_TITLES[setup.mode]}</Text>
                      <Text style={s.overlayText}>{introText(setup)}</Text>
                      <Text style={s.overlayText}>
                        {isDuel
                          ? 'P1: SWIPE ON THE BOTTOM HALF\nP2: SWIPE ON THE TOP HALF'
                          : 'SWIPE TO MOVE\nKEEP YOUR FINGER DOWN TO STEER'}
                      </Text>
                    </>
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

export const MODE_TITLES: Record<GameConfig['mode'], string> = {
  classic: 'CLASSIC',
  time: 'TIME ATTACK',
  maze: 'MAZE',
  survival: 'SURVIVAL',
  duel: 'TWO PLAYER',
  daily: 'DAILY',
};

function introText(setup: GameSetup) {
  switch (setup.mode) {
    case 'time':
      return `SCORE AS MUCH AS YOU CAN\nIN ${Math.round((setup.timeLimitMs ?? 0) / 1000)} SECONDS`;
    case 'maze':
      return `LEVEL ${setup.level}\nEAT ENOUGH APPLES TO CLEAR IT`;
    case 'survival':
      return 'OBSTACLES APPEAR\nAND THE PACE KEEPS RISING';
    case 'duel':
      return 'LAST SNAKE MOVING WINS';
    case 'daily':
      return dailyTitle(dailyChallenge()).toUpperCase();
    default:
      return 'EAT, GROW, DON’T CRASH';
  }
}

function EffectsBar({ game }: { game: GameState | null }) {
  const { s } = useLook();
  if (!game) return <View style={s.effectsBar} />;
  const left = timeLeftMs(game);
  const effects = (snake: Snake, label?: string) =>
    POWER_KINDS.filter((k) => snake.effects[k]).map((k) => (
      <View key={`${label ?? ''}${k}`} style={s.effect}>
        {label && <Text style={s.hudSmall}>{label}</Text>}
        <Icon name={ITEM_ICONS[k]} size={16} />
        <Text style={s.hudSmall}>{Math.ceil((snake.effects[k] ?? 0) / 1000)}s</Text>
      </View>
    ));
  return (
    <View style={s.effectsBar}>
      {left !== null && (
        <View style={s.effect}>
          <Icon name="timer-outline" size={16} />
          <Text style={s.hudSmall}>{clock(left)}</Text>
        </View>
      )}
      {game.goal !== null && (
        <View style={s.effect}>
          <Icon name="flag-checkered" size={16} />
          <Text style={s.hudSmall}>
            LV{game.config.level} {game.snakes[0].stats.apples}/{game.goal}
          </Text>
        </View>
      )}
      {game.config.mode === 'survival' && (
        <View style={s.effect}>
          <Icon name="speedometer" size={16} />
          <Text style={s.hudSmall}>x{game.pace + 1}</Text>
        </View>
      )}
      {effects(game.snakes[0], game.config.players === 2 ? '1' : undefined)}
      {game.snakes[1] && effects(game.snakes[1], '2')}
    </View>
  );
}

function shareText(summary: GameSummary) {
  if (summary.mode === 'daily') {
    const challenge = dailyChallenge();
    return `Snake daily challenge (${challenge.date}): ${dailyTitle(challenge)}. I scored ${summary.score}. Can you beat it?`;
  }
  if (summary.mode === 'maze') {
    return summary.cleared
      ? `I cleared Snake maze level ${summary.config.level} with ${summary.stars} star${summary.stars === 1 ? '' : 's'}. Can you beat it?`
      : `I'm stuck on Snake maze level ${summary.config.level}. Can you clear it?`;
  }
  return `I scored ${summary.score} in Snake (${MODE_TITLES[summary.mode].toLowerCase()}). Can you beat it?`;
}

function GameOver({
  game,
  summary,
  rewards,
  onPlayAgain,
  onNextLevel,
  onHome,
}: {
  game: GameState;
  summary: GameSummary;
  rewards: Rewards;
  onPlayAgain: () => void;
  onNextLevel: () => void;
  onHome: () => void;
}) {
  const { s } = useLook();
  const isDuel = summary.mode === 'duel';
  let title = 'GAME OVER';
  if (summary.cleared) title = 'LEVEL CLEARED';
  else if (isDuel) title = summary.winner === null ? 'DRAW' : `PLAYER ${summary.winner + 1} WINS`;
  else if (game.outcome === 'time') title = "TIME'S UP";
  const daily = summary.mode === 'daily' ? dailyChallenge() : null;

  const share = () => {
    Share.share({ message: shareText(summary) }).catch(() => {});
  };

  return (
    <ScrollView contentContainerStyle={[s.page, { alignItems: 'stretch' }]}>
      <View style={{ alignItems: 'center', gap: 6, marginTop: 12 }}>
        <Icon name={summary.cleared ? 'flag-checkered' : isDuel ? 'trophy' : 'snake'} size={56} />
        <Text style={s.overlayTitle}>{title}</Text>
        {isDuel ? (
          <Text style={s.bold}>
            P1 {game.snakes[0].score} — P2 {game.snakes[1]?.score ?? 0}
          </Text>
        ) : (
          <Text style={[s.bold, { fontSize: 22 }]}>SCORE {summary.score}</Text>
        )}
        {rewards.isHighScore && (
          <View style={s.badge}>
            <Text style={s.badgeText}>NEW HIGH SCORE!</Text>
          </View>
        )}
        {summary.mode === 'maze' && summary.cleared && (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {[1, 2, 3].map((n) => (
              <Icon key={n} name={n <= summary.stars ? 'star' : 'star-outline'} size={32} />
            ))}
          </View>
        )}
        {daily && (
          <Text style={s.text}>
            {summary.score >= daily.target ? 'CHALLENGE COMPLETE' : `TARGET ${daily.target} — ${daily.target - summary.score} SHORT`}
          </Text>
        )}
      </View>

      <View style={{ marginTop: 8 }}>
        <StatRow icon="food-apple" label="Apples eaten" value={String(summary.apples)} />
        <StatRow icon="timer-outline" label="Time survived" value={clock(summary.elapsedMs)} />
        <StatRow icon="swap-horizontal" label="Longest snake" value={String(summary.longest)} />
      </View>

      <View style={[s.dashedBox, { alignItems: 'stretch' }]}>
        {rewards.lines.map(([label, xp], i) => (
          <View key={i} style={s.row}>
            <Text style={[s.text, { flex: 1 }]} numberOfLines={2}>
              {label}
            </Text>
            <Text style={s.bold}>+{xp}</Text>
          </View>
        ))}
        <View style={s.row}>
          <Text style={s.bold}>XP</Text>
          <Text style={s.bold}>+{rewards.xp}</Text>
        </View>
        {rewards.levelAfter > rewards.levelBefore && (
          <View style={s.badge}>
            <Text style={s.badgeText}>LEVEL UP! LV {rewards.levelAfter}</Text>
          </View>
        )}
        {rewards.achievements.map((a) => (
          <View key={a.id} style={s.effect}>
            <Icon name="trophy" size={16} />
            <Text style={s.text}>{a.title}</Text>
          </View>
        ))}
        {rewards.savedReplay && <Text style={s.muted}>Saved as your best run. Watch it from the menu.</Text>}
      </View>

      <View style={{ gap: 10 }}>
        {summary.cleared && (game.config.level ?? 1) < MAZE_LEVELS && (
          <GameButton label="NEXT LEVEL" icon="chevron-right" onPress={onNextLevel} />
        )}
        <GameButton label="PLAY AGAIN" icon="replay" onPress={onPlayAgain} />
        {!isDuel && <GameButton label="SHARE SCORE" icon="share-variant" onPress={share} />}
        <GameButton label="HOME" onPress={onHome} />
      </View>
    </ScrollView>
  );
}

function StatRow({ icon, label, value }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; value: string }) {
  const { s } = useLook();
  return (
    <View style={s.row}>
      <View style={s.effect}>
        <Icon name={icon} size={18} />
        <Text style={s.text}> {label}</Text>
      </View>
      <Text style={s.bold}>{value}</Text>
    </View>
  );
}
