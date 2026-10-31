// Classic Snake on a grid: your own tail ends the game, and so do the walls
// unless they're set to pass through (the snake comes out the other side).
// Like Nokia's Snake II, every few foods a big bonus critter appears for a
// short while; the sooner it's caught, the more it's worth.

export type Point = { x: number; y: number };
export type Direction = 'up' | 'down' | 'left' | 'right';

// A 2x2 critter whose top-left cell is (x, y).
export type Bonus = Point & {
  stepsLeft: number;
  // Which critter to draw; the game picks the picture.
  kind: number;
};

export type SnakeState = {
  cols: number;
  rows: number;
  snake: Point[]; // head first
  direction: Direction;
  // Turns queued since the last step, so two quick swipes both count.
  queued: Direction[];
  food: Point;
  bonus: Bonus | null;
  // Foods eaten so far; every BONUS_EVERY-th brings a bonus.
  eaten: number;
  score: number;
  isOver: boolean;
  wrapsWalls: boolean;
};

export type StepEvent = 'food' | 'bonus' | null;

export const BONUS_EVERY = 5;
// How many moves a bonus stays before vanishing.
export const BONUS_STEPS = 40;
export const BONUS_KINDS = 6;
const FOOD_POINTS = 1;
const BONUS_MAX_POINTS = 9;

const STEP: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const key = (p: Point) => `${p.x},${p.y}`;

function bonusCells(bonus: Point): Point[] {
  return [
    bonus,
    { x: bonus.x + 1, y: bonus.y },
    { x: bonus.x, y: bonus.y + 1 },
    { x: bonus.x + 1, y: bonus.y + 1 },
  ];
}

function placeFood(cols: number, rows: number, taken: Point[]): Point {
  const blocked = new Set(taken.map(key));
  const free: Point[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) if (!blocked.has(key({ x, y }))) free.push({ x, y });
  }
  return free[Math.floor(Math.random() * free.length)] ?? { x: 0, y: 0 };
}

// A free 2x2 spot, or null if there's none.
function placeBonus(state: SnakeState, snake: Point[], food: Point): Bonus | null {
  const blocked = new Set([...snake, food].map(key));
  const spots: Point[] = [];
  for (let y = 0; y < state.rows - 1; y++) {
    for (let x = 0; x < state.cols - 1; x++) {
      if (bonusCells({ x, y }).every((cell) => !blocked.has(key(cell)))) spots.push({ x, y });
    }
  }
  const spot = spots[Math.floor(Math.random() * spots.length)];
  return spot ? { ...spot, stepsLeft: BONUS_STEPS, kind: Math.floor(Math.random() * BONUS_KINDS) } : null;
}

// From BONUS_MAX_POINTS when it appears down to 2 just before it vanishes.
export function bonusPoints(bonus: Bonus) {
  return 1 + Math.ceil(((BONUS_MAX_POINTS - 1) * bonus.stepsLeft) / BONUS_STEPS);
}

export function newGame(cols: number, rows: number, wrapsWalls = false): SnakeState {
  const y = Math.floor(rows / 2);
  const x = Math.floor(cols / 3);
  const snake = [
    { x, y },
    { x: x - 1, y },
    { x: x - 2, y },
  ];
  return {
    cols,
    rows,
    snake,
    direction: 'right',
    queued: [],
    food: placeFood(cols, rows, snake),
    bonus: null,
    eaten: 0,
    score: 0,
    isOver: false,
    wrapsWalls,
  };
}

export function turn(state: SnakeState, direction: Direction): SnakeState {
  const last = state.queued.at(-1) ?? state.direction;
  if (direction === last || direction === OPPOSITE[last] || state.queued.length >= 2) return state;
  return { ...state, queued: [...state.queued, direction] };
}

// Advances one cell. `event` tells the caller what was eaten, if anything.
export function step(state: SnakeState): { state: SnakeState; event: StepEvent } {
  if (state.isOver) return { state, event: null };
  const [direction = state.direction, ...queued] = state.queued;
  const head = state.snake[0];
  let next = { x: head.x + STEP[direction].x, y: head.y + STEP[direction].y };
  if (state.wrapsWalls) {
    next = { x: (next.x + state.cols) % state.cols, y: (next.y + state.rows) % state.rows };
  }
  const ateFood = next.x === state.food.x && next.y === state.food.y;
  // The tail moves out of the way unless the snake is growing.
  const body = ateFood ? state.snake : state.snake.slice(0, -1);

  const hitWall = next.x < 0 || next.y < 0 || next.x >= state.cols || next.y >= state.rows;
  const hitSelf = body.some((p) => p.x === next.x && p.y === next.y);
  if (hitWall || hitSelf) return { state: { ...state, direction, queued, isOver: true }, event: null };

  const snake = [next, ...body];
  // Defaults cover a game paused before bonuses existed.
  let { bonus = null, score, eaten = 0, food } = state;

  // A bonus is caught by moving into any of its four cells; it doesn't grow the snake.
  const ateBonus = !!bonus && bonusCells(bonus).some((cell) => cell.x === next.x && cell.y === next.y);
  if (ateBonus && bonus) {
    score += bonusPoints(bonus);
    bonus = null;
  } else if (bonus) {
    bonus = bonus.stepsLeft > 1 ? { ...bonus, stepsLeft: bonus.stepsLeft - 1 } : null;
  }

  if (ateFood) {
    score += FOOD_POINTS;
    eaten += 1;
    food = placeFood(state.cols, state.rows, bonus ? [...snake, ...bonusCells(bonus)] : snake);
    if (!bonus && eaten % BONUS_EVERY === 0) bonus = placeBonus(state, snake, food);
  }

  return {
    state: { ...state, snake, direction, queued, food, bonus, eaten, score },
    event: ateBonus ? 'bonus' : ateFood ? 'food' : null,
  };
}
