// The Snake engine. Pure and deterministic: every random choice comes from a
// seeded generator kept in the state, so a run can be replayed exactly from
// its config and the turns made (see Replay in the game).
//
// Modes: Classic (endless), Time Attack (beat the clock), Maze (levels with
// walls, cleared by eating enough), Survival (obstacles keep appearing and
// the pace keeps rising), Two Player (two snakes on one board) and the Daily
// Challenge (a fixed board, a time limit and a target score).

import { mazeWalls } from '@/features/disguise/game/levels';

export type Point = { x: number; y: number };
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Mode = 'classic' | 'time' | 'maze' | 'survival' | 'duel' | 'daily';

export type FoodKind = 'apple' | 'cherry' | 'golden' | 'poison';
export type PowerKind = 'speed' | 'shield' | 'magnet' | 'phase';
export type ItemKind = FoodKind | PowerKind;

export const POWER_KINDS: PowerKind[] = ['speed', 'shield', 'magnet', 'phase'];

export const ITEM_POINTS: Record<ItemKind, number> = {
  apple: 1,
  cherry: 3,
  golden: 10,
  poison: -5,
  speed: 0,
  shield: 0,
  magnet: 0,
  phase: 0,
};

// How long each power-up lasts once picked up.
export const POWER_MS: Record<PowerKind, number> = {
  speed: 14000,
  shield: 10000,
  magnet: 8000,
  phase: 8000,
};

// Extras (everything but the apple) vanish after this many moves, blinking at the end.
export const ITEM_STEPS = 60;
export const ITEM_BLINK_STEPS = 12;
const MAX_EXTRAS = 3;
const MAGNET_RANGE = 6;

export type Item = Point & { kind: ItemKind; stepsLeft: number | null };

export type SnakeStats = { apples: number; cherries: number; goldens: number; poisons: number; powerUps: number };

export type Snake = {
  body: Point[]; // head first
  direction: Direction;
  // Turns queued since the last step, so two quick swipes both count.
  queued: Direction[];
  alive: boolean;
  score: number;
  longest: number;
  stats: SnakeStats;
  // Milliseconds left on each active power-up.
  effects: Partial<Record<PowerKind, number>>;
};

export type GameConfig = {
  mode: Mode;
  cols: number;
  rows: number;
  wrapsWalls: boolean;
  seed: number;
  // Milliseconds per move at the chosen speed.
  baseMs: number;
  players: 1 | 2;
  level?: number; // Maze
  timeLimitMs?: number; // Time Attack, Daily
  target?: number; // Daily
};

export type Outcome = 'crash' | 'time' | 'cleared';

export type GameState = {
  config: GameConfig;
  rng: number;
  tick: number;
  elapsedMs: number;
  snakes: Snake[];
  walls: Point[];
  items: Item[];
  // Survival only: how many times the pace has gone up.
  pace: number;
  // Maze only: apples needed to clear the level.
  goal: number | null;
  isOver: boolean;
  outcome: Outcome | null;
};

export type StepEvent =
  | { type: 'eat'; player: number; kind: ItemKind }
  | { type: 'crash'; player: number }
  | { type: 'saved'; player: number };

export const TIME_ATTACK_MS = 120000;
const SURVIVAL_OBSTACLE_EVERY = 3;
const SURVIVAL_PACE_EVERY = 5;

const STEP: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const key = (p: Point) => `${p.x},${p.y}`;
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

// mulberry32: small, fast, and the same on every device.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n: number) {
      return Math.floor(this.next() * n);
    },
    get state() {
      return s;
    },
  };
}
type Rng = ReturnType<typeof makeRng>;

export function randomSeed() {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

// Same seed for everyone on the same day.
export function seedFromText(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function freeCell(state: Pick<GameState, 'config' | 'snakes' | 'walls' | 'items'>, rng: Rng, avoid: Point[] = []) {
  const { cols, rows } = state.config;
  const blocked = new Set<string>();
  for (const s of state.snakes) for (const p of s.body) blocked.add(key(p));
  for (const p of state.walls) blocked.add(key(p));
  for (const p of state.items) blocked.add(key(p));
  for (const p of avoid) blocked.add(key(p));
  const free: Point[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) if (!blocked.has(`${x},${y}`)) free.push({ x, y });
  }
  return free.length ? free[rng.int(free.length)] : null;
}

function makeSnake(head: Point, direction: Direction): Snake {
  const back = STEP[OPPOSITE[direction]];
  const body = [0, 1, 2].map((i) => ({ x: head.x + back.x * i, y: head.y + back.y * i }));
  return {
    body,
    direction,
    queued: [],
    alive: true,
    score: 0,
    longest: body.length,
    stats: { apples: 0, cherries: 0, goldens: 0, poisons: 0, powerUps: 0 },
    effects: {},
  };
}

export function startPositions(config: Pick<GameConfig, 'cols' | 'rows' | 'players'>): { head: Point; direction: Direction }[] {
  const { cols, rows } = config;
  if (config.players === 2) {
    return [
      { head: { x: 3, y: Math.floor((rows * 2) / 3) }, direction: 'right' },
      { head: { x: cols - 4, y: Math.floor(rows / 3) }, direction: 'left' },
    ];
  }
  return [{ head: { x: Math.floor(cols / 3), y: Math.floor(rows / 2) }, direction: 'right' }];
}

export function mazeGoal(level: number) {
  return 8 + level;
}

export function newGame(config: GameConfig): GameState {
  const rng = makeRng(config.seed);
  const snakes = startPositions(config).map(({ head, direction }) => makeSnake(head, direction));
  const walls = config.mode === 'maze' ? mazeWalls(config.cols, config.rows, config.level ?? 1) : [];
  const base = { config, snakes, walls, items: [] as Item[] };
  // Keep the first apple out of the snake's starting lane.
  const lane = snakes.flatMap((s) => Array.from({ length: 4 }, (_, i) => ({ x: s.body[0].x + STEP[s.direction].x * (i + 1), y: s.body[0].y })));
  const apple = freeCell(base, rng, lane) ?? { x: 0, y: 0 };
  return {
    ...base,
    items: [{ ...apple, kind: 'apple', stepsLeft: null }],
    rng: rng.state,
    tick: 0,
    elapsedMs: 0,
    pace: 0,
    goal: config.mode === 'maze' ? mazeGoal(config.level ?? 1) : null,
    isOver: false,
    outcome: null,
  };
}

export function turn(state: GameState, player: number, direction: Direction): GameState {
  const snake = state.snakes[player];
  if (!snake || !snake.alive || state.isOver) return state;
  const last = snake.queued.at(-1) ?? snake.direction;
  if (direction === last || direction === OPPOSITE[last] || snake.queued.length >= 2) return state;
  const snakes = state.snakes.slice();
  snakes[player] = { ...snake, queued: [...snake.queued, direction] };
  return { ...state, snakes };
}

// Milliseconds until the next move.
export function stepInterval(state: GameState) {
  let ms = state.config.baseMs;
  if (state.config.mode === 'survival') ms = Math.max(50, ms * Math.pow(0.92, state.pace));
  // Speed only exists in one-player games: one board moves at one pace.
  if (state.config.players === 1 && state.snakes[0]?.effects.speed) ms *= 0.6;
  return Math.round(ms);
}

export function timeLeftMs(state: GameState) {
  return state.config.timeLimitMs ? Math.max(0, state.config.timeLimitMs - state.elapsedMs) : null;
}

function pickExtra(state: GameState, rng: Rng): ItemKind | null {
  const roll = rng.next();
  const powers = state.config.players === 2 ? POWER_KINDS.filter((k) => k !== 'speed') : POWER_KINDS;
  if (roll < 0.25) return 'cherry';
  if (roll < 0.33) return 'golden';
  if (roll < 0.47) return 'poison';
  if (roll < 0.62) return powers[rng.int(powers.length)];
  return null;
}

// Advances every snake one cell.
export function step(state: GameState): { state: GameState; events: StepEvent[] } {
  if (state.isOver) return { state, events: [] };
  const rng = makeRng(state.rng);
  const { cols, rows } = state.config;
  const dt = stepInterval(state);
  const events: StepEvent[] = [];
  const wallSet = new Set(state.walls.map(key));
  let items = state.items.slice();

  // Where every snake wants to go, and what it would eat there.
  const moves = state.snakes.map((snake) => {
    if (!snake.alive) return null;
    const [direction = snake.direction, ...queued] = snake.queued;
    const head = snake.body[0];
    let next = { x: head.x + STEP[direction].x, y: head.y + STEP[direction].y };
    const outside = next.x < 0 || next.y < 0 || next.x >= cols || next.y >= rows;
    const shielded = !!snake.effects.shield;
    if (outside && (state.config.wrapsWalls || shielded)) {
      next = { x: (next.x + cols) % cols, y: (next.y + rows) % rows };
    }
    const item = items.find((it) => same(it, next));
    const grows = !!item && item.kind !== 'poison' && ITEM_POINTS[item.kind] > 0;
    const body = grows ? snake.body : snake.body.slice(0, -1);
    return { direction, queued, next, item, outside: outside && !state.config.wrapsWalls && !shielded, body };
  });

  const snakes = state.snakes.map((snake, i) => {
    const move = moves[i];
    if (!move) return snake;
    const { next } = move;
    const shielded = !!snake.effects.shield;
    const phased = !!snake.effects.phase;
    const hitWall = move.outside || wallSet.has(key(next));
    const hitSelf = move.body.some((p) => same(p, next));
    const hitOther = moves.some((other, j) => {
      if (j === i) return false;
      if (other) return same(other.next, next) || other.body.some((p) => same(p, next));
      return state.snakes[j].body.some((p) => same(p, next));
    });
    const crashed = (hitWall && !shielded) || ((hitSelf || hitOther) && !shielded && !phased);
    if (crashed) {
      events.push({ type: 'crash', player: i });
      return { ...snake, direction: move.direction, queued: move.queued, alive: false };
    }
    if (shielded && (hitWall || hitSelf || hitOther)) events.push({ type: 'saved', player: i });

    let body = [next, ...move.body];
    let { score } = snake;
    const stats = { ...snake.stats };
    let effects = { ...snake.effects };
    const item = move.item;
    if (item) {
      items = items.filter((it) => it !== item);
      events.push({ type: 'eat', player: i, kind: item.kind });
      const points = ITEM_POINTS[item.kind] * (effects.speed && item.kind !== 'poison' ? 2 : 1);
      score = Math.max(0, score + points);
      if (item.kind === 'apple') stats.apples++;
      else if (item.kind === 'cherry') stats.cherries++;
      else if (item.kind === 'golden') stats.goldens++;
      else if (item.kind === 'poison') {
        stats.poisons++;
        body = body.slice(0, Math.max(2, body.length - 2));
      } else {
        stats.powerUps++;
        effects[item.kind] = POWER_MS[item.kind];
      }
    }
    // Power-ups wear off.
    const worn: Partial<Record<PowerKind, number>> = {};
    for (const kind of POWER_KINDS) {
      const left = (effects[kind] ?? 0) - (item?.kind === kind ? 0 : dt);
      if (left > 0) worn[kind] = left;
    }
    effects = worn;
    return {
      ...snake,
      body,
      direction: move.direction,
      queued: move.queued,
      score,
      stats,
      effects,
      longest: Math.max(snake.longest, body.length),
    };
  });

  let next: GameState = { ...state, snakes, items, tick: state.tick + 1, elapsedMs: state.elapsedMs + dt };

  // Extras count down and vanish.
  next.items = next.items
    .map((it) => (it.stepsLeft === null ? it : { ...it, stepsLeft: it.stepsLeft - 1 }))
    .filter((it) => it.stepsLeft === null || it.stepsLeft > 0);

  const applesEaten = events.filter((e) => e.type === 'eat' && e.kind === 'apple').length;
  for (let n = 0; n < applesEaten; n++) {
    const spot = freeCell(next, rng);
    if (spot) next.items = [...next.items, { ...spot, kind: 'apple', stepsLeft: null }];
    const extras = next.items.filter((it) => it.kind !== 'apple').length;
    const kind = extras < MAX_EXTRAS ? pickExtra(next, rng) : null;
    const extraSpot = kind && freeCell(next, rng);
    if (kind && extraSpot) next.items = [...next.items, { ...extraSpot, kind, stepsLeft: ITEM_STEPS }];
  }
  // Never leave the board without an apple (e.g. one vanished under a crash).
  if (!next.items.some((it) => it.kind === 'apple')) {
    const spot = freeCell(next, rng);
    if (spot) next.items = [...next.items, { ...spot, kind: 'apple', stepsLeft: null }];
  }

  // Magnets pull nearby food one cell closer to the head.
  for (const snake of next.snakes) {
    if (!snake.alive || !snake.effects.magnet) continue;
    const head = snake.body[0];
    const taken = new Set([...next.walls, ...next.snakes.flatMap((s) => s.body), ...next.items].map(key));
    next.items = next.items.map((it) => {
      if (it.kind === 'poison' || POWER_KINDS.includes(it.kind as PowerKind)) return it;
      const dx = head.x - it.x;
      const dy = head.y - it.y;
      if (Math.abs(dx) + Math.abs(dy) > MAGNET_RANGE || (dx === 0 && dy === 0)) return it;
      const moved = Math.abs(dx) >= Math.abs(dy) ? { x: it.x + Math.sign(dx), y: it.y } : { x: it.x, y: it.y + Math.sign(dy) };
      // Moving onto the head means it's eaten next move anyway; leave it adjacent.
      if (same(moved, head) || taken.has(key(moved))) return it;
      taken.delete(key(it));
      taken.add(key(moved));
      return { ...it, ...moved };
    });
  }

  const totalApples = next.snakes.reduce((sum, s) => sum + s.stats.apples, 0);

  // Survival: new obstacles keep appearing, away from the head, and the pace climbs.
  if (state.config.mode === 'survival' && applesEaten > 0) {
    if (totalApples % SURVIVAL_OBSTACLE_EVERY === 0) {
      const head = next.snakes[0].body[0];
      const near: Point[] = [];
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) near.push({ x: head.x + dx, y: head.y + dy });
      const count = 1 + rng.int(2);
      for (let n = 0; n < count; n++) {
        const spot = freeCell(next, rng, near);
        if (spot) next.walls = [...next.walls, spot];
      }
    }
    next.pace = Math.floor(totalApples / SURVIVAL_PACE_EVERY);
  }

  if (next.snakes.some((s) => !s.alive)) {
    next = { ...next, isOver: true, outcome: 'crash' };
  } else if (next.goal !== null && totalApples >= next.goal) {
    next = { ...next, isOver: true, outcome: 'cleared' };
  } else if (next.config.timeLimitMs && next.elapsedMs >= next.config.timeLimitMs) {
    next = { ...next, isOver: true, outcome: 'time' };
  }

  next.rng = rng.state;
  return { state: next, events };
}

// Replays a recorded run: turns are applied just before the move they were made in.
export type RecordedTurn = [tick: number, player: number, direction: Direction];

export function applyRecordedTurns(state: GameState, turns: RecordedTurn[], from: number) {
  let i = from;
  let s = state;
  while (i < turns.length && turns[i][0] <= s.tick) {
    if (turns[i][0] === s.tick) s = turn(s, turns[i][1], turns[i][2]);
    i++;
  }
  return { state: s, next: i };
}

// Stars for a cleared maze level, by how many moves it took.
export function mazeStars(state: GameState) {
  if (state.outcome !== 'cleared' || state.goal === null) return 0;
  const par = state.goal * state.config.cols * 1.5;
  if (state.tick <= par) return 3;
  if (state.tick <= par * 1.75) return 2;
  return 1;
}
