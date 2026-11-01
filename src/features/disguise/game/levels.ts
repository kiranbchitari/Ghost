// Maze levels. Each is drawn relative to the board, so it fits whatever size
// the board is. Walls never touch the board's edge in a way that seals off an
// area, and the snake's starting lane is always kept clear.

import type { Point } from '@/features/disguise/snake-logic';

export const MAZE_LEVELS = 12;

type Draw = (cols: number, rows: number, add: (x: number, y: number) => void) => void;

const hLine = (add: (x: number, y: number) => void, y: number, x1: number, x2: number) => {
  for (let x = x1; x <= x2; x++) add(x, y);
};
const vLine = (add: (x: number, y: number) => void, x: number, y1: number, y2: number) => {
  for (let y = y1; y <= y2; y++) add(x, y);
};

// A rectangle outline with a gap in the middle of each side.
function ring(add: (x: number, y: number) => void, x1: number, y1: number, x2: number, y2: number) {
  const mx = Math.floor((x1 + x2) / 2);
  const my = Math.floor((y1 + y2) / 2);
  for (let x = x1; x <= x2; x++) {
    if (Math.abs(x - mx) > 1) {
      add(x, y1);
      add(x, y2);
    }
  }
  for (let y = y1; y <= y2; y++) {
    if (Math.abs(y - my) > 1) {
      add(x1, y);
      add(x2, y);
    }
  }
}

const LEVELS: Draw[] = [
  // 1. Corner brackets.
  (c, r, add) => {
    const w = Math.max(2, Math.floor(c / 5));
    const h = Math.max(2, Math.floor(r / 6));
    for (const [x, y, dx, dy] of [
      [2, 2, 1, 1],
      [c - 3, 2, -1, 1],
      [2, r - 3, 1, -1],
      [c - 3, r - 3, -1, -1],
    ]) {
      for (let i = 0; i < w; i++) add(x + dx * i, y);
      for (let i = 0; i < h; i++) add(x, y + dy * i);
    }
  },
  // 2. Two long bars.
  (c, r, add) => {
    hLine(add, Math.floor(r / 4), 3, c - 4);
    hLine(add, Math.floor((r * 3) / 4), 3, c - 4);
  },
  // 3. Two pillars.
  (c, r, add) => {
    vLine(add, Math.floor(c / 4), 3, r - 4);
    vLine(add, Math.floor((c * 3) / 4), 3, r - 4);
  },
  // 4. A ring in the middle.
  (c, r, add) => ring(add, Math.floor(c / 4), Math.floor(r / 4), Math.ceil((c * 3) / 4), Math.ceil((r * 3) / 4)),
  // 5. Teeth from the top.
  (c, r, add) => {
    for (let x = 3; x < c - 2; x += 4) vLine(add, x, 0, Math.floor(r / 3));
  },
  // 6. Teeth from top and bottom, staggered.
  (c, r, add) => {
    for (let x = 3, i = 0; x < c - 2; x += 3, i++) {
      if (i % 2 === 0) vLine(add, x, 0, Math.floor(r / 3));
      else vLine(add, x, r - 1 - Math.floor(r / 3), r - 1);
    }
  },
  // 7. Plus sign with gaps.
  (c, r, add) => {
    const mx = Math.floor(c / 2);
    const my = Math.floor(r / 2);
    for (let x = 2; x < c - 2; x++) if (Math.abs(x - mx) > 2) add(x, my - 3);
    for (let y = 2; y < r - 2; y++) if (Math.abs(y - my) > 2) add(mx, y);
  },
  // 8. Pillars in a grid.
  (c, r, add) => {
    for (let y = 3; y < r - 2; y += 4) for (let x = 3; x < c - 2; x += 4) add(x, y);
  },
  // 9. Two rings.
  (c, r, add) => {
    ring(add, 2, 2, c - 3, r - 3);
    ring(add, Math.floor(c / 3), Math.floor(r / 3), Math.ceil((c * 2) / 3), Math.ceil((r * 2) / 3));
  },
  // 10. Zigzag shelves.
  (c, r, add) => {
    for (let y = 3, i = 0; y < r - 2; y += 4, i++) {
      if (i % 2 === 0) hLine(add, y, 0, c - 5);
      else hLine(add, y, 4, c - 1);
    }
  },
  // 11. H blocks.
  (c, r, add) => {
    const cell = (x0: number, y0: number, w: number, h: number) => {
      vLine(add, x0, y0, y0 + h);
      vLine(add, x0 + w, y0, y0 + h);
      hLine(add, y0 + Math.floor(h / 2), x0, x0 + w);
    };
    const w = Math.max(3, Math.floor(c / 4));
    const h = Math.max(4, Math.floor(r / 4));
    cell(2, 2, w, h);
    cell(c - 3 - w, 2, w, h);
    cell(2, r - 3 - h, w, h);
    cell(c - 3 - w, r - 3 - h, w, h);
  },
  // 12. Everything: shelves, pillars and a ring.
  (c, r, add) => {
    ring(add, Math.floor(c / 4), Math.floor(r / 4), Math.ceil((c * 3) / 4), Math.ceil((r * 3) / 4));
    for (let x = 2; x < c - 2; x += 4) {
      add(x, 1);
      add(x, r - 2);
    }
    vLine(add, 1, Math.floor(r / 3), Math.floor((r * 2) / 3));
    vLine(add, c - 2, Math.floor(r / 3), Math.floor((r * 2) / 3));
  },
];

export function mazeWalls(cols: number, rows: number, level: number): Point[] {
  const cells = new Map<string, Point>();
  const add = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < cols && y < rows) cells.set(`${x},${y}`, { x, y });
  };
  LEVELS[(Math.max(1, level) - 1) % LEVELS.length](cols, rows, add);
  // Keep the starting lane (and the row either side of it) clear.
  const startY = Math.floor(rows / 2);
  const startX = Math.floor(cols / 3);
  for (let y = startY - 1; y <= startY + 1; y++) {
    for (let x = 0; x <= startX + 6; x++) cells.delete(`${x},${y}`);
  }
  // On unusual board shapes a level can seal off a pocket. Fill any cell the
  // snake can't reach, so food never appears where it can't be eaten.
  const reached = new Set([`${startX},${startY}`]);
  const queue: Point[] = [{ x: startX, y: startY }];
  while (queue.length) {
    const p = queue.pop()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = p.x + dx;
      const y = p.y + dy;
      const k = `${x},${y}`;
      if (x < 0 || y < 0 || x >= cols || y >= rows || cells.has(k) || reached.has(k)) continue;
      reached.add(k);
      queue.push({ x, y });
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) if (!reached.has(`${x},${y}`)) add(x, y);
  }
  return [...cells.values()];
}
