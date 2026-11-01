import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SkinId, ThemeId } from '@/features/disguise/game/look';
import { MAZE_LEVELS } from '@/features/disguise/game/levels';
import {
  mazeStars,
  seedFromText,
  type GameConfig,
  type GameState,
  type Mode,
  type RecordedTurn,
} from '@/features/disguise/snake-logic';

// Everything the game remembers between plays: XP and level, lifetime stats,
// achievements, missions, the daily challenge and streak, maze stars, the
// local leaderboard and the best run's replay. It all stays on this phone in
// the game's own storage keys, and Reset game data erases every one of them.

export const PROFILE_KEY = 'snake.profile';
export const LEADERBOARD_KEY = 'snake.leaderboard';
export const REPLAY_KEY = 'snake.replay';
// Before the leaderboard, the top five scores were kept here as plain numbers.
export const OLD_SCORES_KEY = 'snake.scores';

export type Stats = {
  games: number;
  apples: number;
  cherries: number;
  goldens: number;
  powerUps: number;
  longestRunMs: number;
  longestSnake: number;
  duelGames: number;
  fastGames: number;
  survivalGames: number;
  best: Partial<Record<Mode, number>>;
};

export type Profile = {
  name: string;
  xp: number;
  skin: SkinId;
  theme: ThemeId;
  stats: Stats;
  achievements: Record<string, string>; // id → date unlocked
  mazeStars: number[]; // index = level - 1
  daily: { date: string; best: number; completed: boolean };
  streak: { count: number; lastDate: string };
  missions: { date: string; progress: number[]; done: boolean[] };
};

export const DEFAULT_PROFILE: Profile = {
  name: 'PLAYER',
  xp: 0,
  skin: 'classic',
  theme: 'lcd',
  stats: {
    games: 0,
    apples: 0,
    cherries: 0,
    goldens: 0,
    powerUps: 0,
    longestRunMs: 0,
    longestSnake: 0,
    duelGames: 0,
    fastGames: 0,
    survivalGames: 0,
    best: {},
  },
  achievements: {},
  mazeStars: [],
  daily: { date: '', best: 0, completed: false },
  streak: { count: 0, lastDate: '' },
  missions: { date: '', progress: [], done: [] },
};

export type LeaderboardMode = 'classic' | 'time' | 'survival';
export type LeaderboardEntry = { name: string; score: number; date: string };
export type Leaderboard = Record<LeaderboardMode, LeaderboardEntry[]>;
export const EMPTY_LEADERBOARD: Leaderboard = { classic: [], time: [], survival: [] };
const LEADERBOARD_SIZE = 10;

export type Replay = { config: GameConfig; turns: RecordedTurn[]; ticks: number; score: number; date: string; skin: SkinId };

// ---------- dates ----------

export function today(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function yesterday(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return today(d);
}

// ---------- levels ----------

// XP needed to reach `level` from zero: 0, 100, 300, 600, 1000, ...
export function xpForLevel(level: number) {
  return 50 * level * (level - 1);
}

export function levelFromXp(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

// ---------- achievements ----------

export type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: (p: Profile) => [number, number];
};

const clearedLevels = (p: Profile) => p.mazeStars.filter((s) => s > 0).length;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_bite', title: 'First Bite', description: 'Eat your first apple.', icon: 'trophy', progress: (p) => [p.stats.apples, 1] },
  { id: 'hungry', title: 'Hungry Snake', description: 'Eat 50 apples.', icon: 'food-apple', progress: (p) => [p.stats.apples, 50] },
  { id: 'glutton', title: 'Bottomless', description: 'Eat 500 apples.', icon: 'food-apple', progress: (p) => [p.stats.apples, 500] },
  {
    id: 'survivor',
    title: 'Survivor',
    description: 'Survive 5 minutes in one game.',
    icon: 'timer-outline',
    progress: (p) => [Math.floor(p.stats.longestRunMs / 1000), 300],
  },
  { id: 'speed_demon', title: 'Speed Demon', description: 'Play at Fast speed.', icon: 'lightning-bolt', progress: (p) => [p.stats.fastGames, 1] },
  {
    id: 'snake_master',
    title: 'Snake Master',
    description: 'Score 500 in Classic.',
    icon: 'crown',
    progress: (p) => [p.stats.best.classic ?? 0, 500],
  },
  { id: 'golden', title: 'Golden Touch', description: 'Eat a golden apple.', icon: 'star', progress: (p) => [p.stats.goldens, 1] },
  { id: 'powered', title: 'Powered Up', description: 'Collect 10 power-ups.', icon: 'flash', progress: (p) => [p.stats.powerUps, 10] },
  { id: 'long', title: 'Long Body', description: 'Grow to 30 segments.', icon: 'snake', progress: (p) => [p.stats.longestSnake, 30] },
  {
    id: 'time_lord',
    title: 'Beat the Clock',
    description: 'Score 100 in Time Attack.',
    icon: 'progress-clock',
    progress: (p) => [p.stats.best.time ?? 0, 100],
  },
  {
    id: 'maze_runner',
    title: 'Maze Runner',
    description: `Clear ${MAZE_LEVELS / 2} maze levels.`,
    icon: 'grid',
    progress: (p) => [clearedLevels(p), MAZE_LEVELS / 2],
  },
  {
    id: 'three_stars',
    title: 'Perfectionist',
    description: 'Get 3 stars on a maze level.',
    icon: 'star-outline',
    progress: (p) => [Math.max(0, ...p.mazeStars), 3],
  },
  {
    id: 'endurance',
    title: 'Last One Standing',
    description: 'Score 50 in Survival.',
    icon: 'infinity',
    progress: (p) => [p.stats.best.survival ?? 0, 50],
  },
  { id: 'duelist', title: 'Duelist', description: 'Play a two player game.', icon: 'account-multiple', progress: (p) => [p.stats.duelGames, 1] },
  { id: 'devoted', title: 'Devoted', description: 'Play 7 days in a row.', icon: 'fire', progress: (p) => [p.streak.count, 7] },
];

export const ACHIEVEMENT_XP = 25;

// ---------- missions ----------

type MissionTemplate = {
  title: (n: number) => string;
  amounts: number[];
  // How much this game counts towards the mission.
  measure: (g: GameSummary) => number;
  // "In one game" missions take the best game; the rest add up.
  best?: boolean;
};

const MISSION_TEMPLATES: MissionTemplate[] = [
  { title: (n) => `Eat ${n} apples`, amounts: [20, 30, 40], measure: (g) => g.apples },
  { title: (n) => `Play ${n} games`, amounts: [3, 5], measure: () => 1 },
  { title: (n) => `Collect ${n} power-ups`, amounts: [3, 5], measure: (g) => g.powerUps },
  { title: (n) => `Eat ${n} cherries`, amounts: [3, 5], measure: (g) => g.cherries },
  {
    title: (n) => `Score ${n} in one Classic game`,
    amounts: [30, 50],
    measure: (g) => (g.mode === 'classic' ? g.score : 0),
    best: true,
  },
  { title: (n) => `Play Survival ${n} times`, amounts: [2, 3], measure: (g) => (g.mode === 'survival' ? 1 : 0) },
  { title: (n) => `Clear ${n} maze level${n > 1 ? 's' : ''}`, amounts: [1, 2], measure: (g) => (g.cleared ? 1 : 0) },
  {
    title: (n) => `Score ${n} in one Time Attack`,
    amounts: [25, 40],
    measure: (g) => (g.mode === 'time' ? g.score : 0),
    best: true,
  },
];

export const MISSION_XP = 50;

export type Mission = { title: string; target: number; template: MissionTemplate };

// Three missions a day, the same all day.
export function missionsFor(date: string): Mission[] {
  let seed = seedFromText(`missions:${date}`);
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pool = MISSION_TEMPLATES.slice();
  const picked: Mission[] = [];
  while (picked.length < 3 && pool.length) {
    const [template] = pool.splice(Math.floor(next() * pool.length), 1);
    const target = template.amounts[Math.floor(next() * template.amounts.length)];
    picked.push({ title: template.title(target), target, template });
  }
  return picked;
}

// Today's missions with progress, starting fresh each day.
export function currentMissions(profile: Profile, date = today()) {
  const fresh = profile.missions.date !== date;
  return missionsFor(date).map((mission, i) => ({
    ...mission,
    progress: fresh ? 0 : (profile.missions.progress[i] ?? 0),
    done: fresh ? false : !!profile.missions.done[i],
  }));
}

// ---------- daily challenge ----------

export type DailyChallenge = { date: string; seed: number; timeLimitMs: number; target: number; wrapsWalls: boolean };

const DAILY_TEMPLATES = [
  { timeLimitMs: 180000, target: 60, wrapsWalls: false },
  { timeLimitMs: 120000, target: 40, wrapsWalls: true },
  { timeLimitMs: 90000, target: 30, wrapsWalls: false },
  { timeLimitMs: 60000, target: 20, wrapsWalls: true },
  { timeLimitMs: 150000, target: 50, wrapsWalls: true },
];

export const DAILY_XP = 100;

export function dailyChallenge(date = today()): DailyChallenge {
  const seed = seedFromText(`daily:${date}`);
  return { date, seed, ...DAILY_TEMPLATES[seed % DAILY_TEMPLATES.length] };
}

export function dailyTitle(c: DailyChallenge) {
  const minutes = c.timeLimitMs / 60000;
  const time = Number.isInteger(minutes) ? `${minutes} minute${minutes === 1 ? '' : 's'}` : `${c.timeLimitMs / 1000} seconds`;
  return `Score ${c.target}+ in ${time}`;
}

// ---------- finishing a game ----------

export type GameSummary = {
  mode: Mode;
  config: GameConfig;
  score: number;
  apples: number;
  cherries: number;
  goldens: number;
  powerUps: number;
  elapsedMs: number;
  longest: number;
  ticks: number;
  cleared: boolean;
  stars: number;
  winner: number | null; // two player
  turns: RecordedTurn[];
};

export function summarize(state: GameState, turns: RecordedTurn[]): GameSummary {
  const sum = (f: (s: GameState['snakes'][number]) => number) => state.snakes.reduce((a, s) => a + f(s), 0);
  let winner: number | null = null;
  if (state.config.players === 2) {
    const [a, b] = state.snakes;
    if (a.alive !== b.alive) winner = a.alive ? 0 : 1;
    else winner = a.score === b.score ? null : a.score > b.score ? 0 : 1;
  }
  return {
    mode: state.config.mode,
    config: state.config,
    score: state.snakes[0].score,
    apples: sum((s) => s.stats.apples),
    cherries: sum((s) => s.stats.cherries),
    goldens: sum((s) => s.stats.goldens),
    powerUps: sum((s) => s.stats.powerUps),
    elapsedMs: state.elapsedMs,
    longest: Math.max(...state.snakes.map((s) => s.longest)),
    ticks: state.tick,
    cleared: state.outcome === 'cleared',
    stars: mazeStars(state),
    winner,
    turns,
  };
}

export type Rewards = {
  xp: number;
  lines: [string, number][]; // label, XP
  levelBefore: number;
  levelAfter: number;
  isHighScore: boolean;
  previousBest: number;
  achievements: Achievement[];
  missions: string[];
  dailyCompleted: boolean;
  streak: number;
  savedReplay: boolean;
};

// Works out everything a finished game earns. Pure: returns the new profile,
// leaderboard and (if this was the best Classic run) replay.
export function finishGame(
  profile: Profile,
  leaderboard: Leaderboard,
  replay: Replay | null,
  game: GameSummary,
  fastMs: number,
  now = new Date(),
): { profile: Profile; leaderboard: Leaderboard; replay: Replay | null; rewards: Rewards } {
  const date = today(now);
  const lines: [string, number][] = [];
  const isDuel = game.mode === 'duel';
  const previousBest = profile.stats.best[game.mode] ?? 0;
  const isHighScore = !isDuel && game.score > 0 && game.score > previousBest;

  const stats: Stats = {
    ...profile.stats,
    games: profile.stats.games + 1,
    apples: profile.stats.apples + game.apples,
    cherries: profile.stats.cherries + game.cherries,
    goldens: profile.stats.goldens + game.goldens,
    powerUps: profile.stats.powerUps + game.powerUps,
    longestRunMs: Math.max(profile.stats.longestRunMs, game.elapsedMs),
    longestSnake: Math.max(profile.stats.longestSnake, game.longest),
    duelGames: profile.stats.duelGames + (isDuel ? 1 : 0),
    fastGames: profile.stats.fastGames + (game.config.baseMs <= fastMs ? 1 : 0),
    survivalGames: profile.stats.survivalGames + (game.mode === 'survival' ? 1 : 0),
    best: isDuel ? profile.stats.best : { ...profile.stats.best, [game.mode]: Math.max(previousBest, game.score) },
  };

  // Score is XP; two-player games give a flat amount (the score is shared).
  const scoreXp = isDuel ? 20 : Math.max(0, game.score);
  if (scoreXp > 0) lines.push([isDuel ? 'Match played' : 'Score', scoreXp]);

  // Streak: the first game of each day keeps it going (or starts it again).
  let streak = profile.streak;
  if (streak.lastDate !== date) {
    const count = streak.lastDate === yesterday(now) ? streak.count + 1 : 1;
    streak = { count, lastDate: date };
    lines.push([`Day ${count} streak`, 10 * Math.min(count, 7)]);
  }

  // Maze stars: keep the best per level.
  const mazeStarsList = profile.mazeStars.slice();
  if (game.mode === 'maze' && game.config.level) {
    const i = game.config.level - 1;
    mazeStarsList[i] = Math.max(mazeStarsList[i] ?? 0, game.stars);
    for (let j = 0; j < i; j++) mazeStarsList[j] ??= 0;
    if (game.cleared) lines.push([`Level ${game.config.level} cleared`, 15 * game.stars]);
  }

  // Daily challenge.
  let daily = profile.daily.date === date ? profile.daily : { date, best: 0, completed: false };
  let dailyCompleted = false;
  if (game.mode === 'daily') {
    const challenge = dailyChallenge(date);
    const success = game.score >= challenge.target;
    if (success && !daily.completed) {
      dailyCompleted = true;
      lines.push(['Daily challenge', DAILY_XP]);
    }
    daily = { date, best: Math.max(daily.best, game.score), completed: daily.completed || success };
  }

  // Missions.
  const missions = currentMissions(profile, date);
  const finishedMissions: string[] = [];
  const progress = missions.map((m) => {
    const value = m.template.measure(game);
    return m.template.best ? Math.max(m.progress, value) : m.progress + value;
  });
  const done = missions.map((m, i) => {
    if (!m.done && progress[i] >= m.target) {
      finishedMissions.push(m.title);
      lines.push([`Mission: ${m.title}`, MISSION_XP]);
      return true;
    }
    return m.done;
  });

  let next: Profile = {
    ...profile,
    stats,
    streak,
    daily,
    mazeStars: mazeStarsList,
    missions: { date, progress: progress.map((v, i) => Math.min(v, missions[i].target)), done },
  };

  // Achievements unlocked by this game.
  const unlocked = ACHIEVEMENTS.filter((a) => {
    if (next.achievements[a.id]) return false;
    const [value, target] = a.progress(next);
    return value >= target;
  });
  if (unlocked.length) {
    next = { ...next, achievements: { ...next.achievements, ...Object.fromEntries(unlocked.map((a) => [a.id, date])) } };
    lines.push([`Achievement${unlocked.length > 1 ? 's' : ''}`, ACHIEVEMENT_XP * unlocked.length]);
  }

  const xp = lines.reduce((sum, [, v]) => sum + v, 0);
  next = { ...next, xp: profile.xp + xp };

  // Leaderboard.
  let board = leaderboard;
  const boardMode = game.mode as LeaderboardMode;
  if (game.score > 0 && (boardMode === 'classic' || boardMode === 'time' || boardMode === 'survival')) {
    const entries = [...leaderboard[boardMode], { name: profile.name, score: game.score, date }]
      .sort((a, b) => b.score - a.score)
      .slice(0, LEADERBOARD_SIZE);
    board = { ...leaderboard, [boardMode]: entries };
  }

  // Replay of the best Classic run.
  let nextReplay = replay;
  let savedReplay = false;
  if (game.mode === 'classic' && game.score > 0 && game.score > (replay?.score ?? 0)) {
    nextReplay = { config: game.config, turns: game.turns, ticks: game.ticks, score: game.score, date, skin: profile.skin };
    savedReplay = true;
  }

  return {
    profile: next,
    leaderboard: board,
    replay: nextReplay,
    rewards: {
      xp,
      lines,
      levelBefore: levelFromXp(profile.xp),
      levelAfter: levelFromXp(next.xp),
      isHighScore,
      previousBest,
      achievements: unlocked,
      missions: finishedMissions,
      dailyCompleted,
      streak: streak.count,
      savedReplay,
    },
  };
}

// ---------- storage ----------

async function loadJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown) {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

export async function loadProgress() {
  const [profile, leaderboard, replay, oldScores] = await Promise.all([
    loadJson<Partial<Profile>>(PROFILE_KEY),
    loadJson<Partial<Leaderboard>>(LEADERBOARD_KEY),
    loadJson<Replay>(REPLAY_KEY),
    loadJson<number[]>(OLD_SCORES_KEY),
  ]);
  const p: Profile = {
    ...DEFAULT_PROFILE,
    ...profile,
    stats: { ...DEFAULT_PROFILE.stats, ...profile?.stats, best: { ...profile?.stats?.best } },
  };
  let board: Leaderboard = { ...EMPTY_LEADERBOARD, ...leaderboard };
  // Bring scores from before the leaderboard across, once.
  if (!leaderboard && Array.isArray(oldScores) && oldScores.length) {
    board = {
      ...board,
      classic: oldScores
        .filter((n) => typeof n === 'number' && n > 0)
        .map((score) => ({ name: p.name, score, date: '' })),
    };
    p.stats.best.classic = Math.max(p.stats.best.classic ?? 0, ...oldScores);
    saveJson(LEADERBOARD_KEY, board);
    saveJson(PROFILE_KEY, p);
    AsyncStorage.removeItem(OLD_SCORES_KEY).catch(() => {});
  }
  return { profile: p, leaderboard: board, replay };
}

export const PROGRESS_KEYS = [PROFILE_KEY, LEADERBOARD_KEY, REPLAY_KEY, OLD_SCORES_KEY];
