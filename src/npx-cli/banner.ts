import { envValue } from '../shared/legacy-env.js';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const RESET = '\x1b[0m';

function primaryColor(truecolor: boolean, brightness: number = 1.0): string {
  if (!truecolor) return '\x1b[38;5;208m';
  const r = Math.min(255, Math.round(230 * brightness));
  const g = Math.min(255, Math.round(115 * brightness));
  const b = Math.min(255, Math.round(70 * brightness));
  return `\x1b[38;2;${r};${g};${b}m`;
}

function detectTruecolor(): boolean {
  return process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit';
}

const WORDMARK: readonly string[] = [
  " _                                    _             _ ",
  "| | __  ___   ___  _ __   _ __ ___   (_) _ __    __| |",
  "| |/ / / _ \\ / _ \\| '_ \\ | '_ ` _ \\  | || '_ \\  / _` |",
  "|   < |  __/|  __/| |_) || | | | | | | || | | || (_| |",
  "|_|\\_\\ \\___| \\___|| .__/ |_| |_| |_| |_||_| |_| \\__,_|",
  "                  |_|                                 ",
] as const;
const WORDMARK_HEIGHT = WORDMARK.length;
const WORDMARK_WIDTH = WORDMARK[0].length;

const TAGLINE = 'persistent memory across sessions';
const TAGLINE_GAP = 1;
const TOTAL_ROWS = WORDMARK_HEIGHT + TAGLINE_GAP + 1;

function terminalWidth(): number {
  return Math.max(WORDMARK_WIDTH, process.stdout.columns ?? WORDMARK_WIDTH);
}

function writeWordmarkRow(rowIdx: number, colsRevealed: number, color: string): string {
  const src = WORDMARK[rowIdx];
  const W = terminalWidth();
  const visible = src.slice(0, Math.min(WORDMARK_WIDTH, colsRevealed)).padEnd(WORDMARK_WIDTH, ' ');
  const pad = Math.max(0, Math.floor((W - WORDMARK_WIDTH) / 2));
  return ' '.repeat(pad) + `\x1b[1m${color}${visible}${RESET}` + ' '.repeat(Math.max(0, W - pad - WORDMARK_WIDTH));
}

function writeTaglineRow(text: string): string {
  const W = terminalWidth();
  const pad = Math.max(0, Math.floor((W - text.length) / 2));
  return ' '.repeat(pad) + `\x1b[2;37m${text}\x1b[0m` + ' '.repeat(Math.max(0, W - pad - text.length));
}

export function isBannerEnabled(): boolean {
  if (!process.stdout.isTTY) return false;
  if (process.env.CI) return false;
  if (envValue('KEEPMIND_NO_BANNER')) return false;
  if (process.env.NO_COLOR) return false;
  const cols = process.stdout.columns ?? 0;
  return cols >= WORDMARK_WIDTH;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function playBanner(): Promise<void> {
  if (!isBannerEnabled()) return;
  const truecolor = detectTruecolor();
  let aborted = false;
  const onResize = () => { aborted = true; };
  process.stdout.on('resize', onResize);
  process.stdout.write(HIDE_CURSOR);

  process.stdout.write('\n'.repeat(TOTAL_ROWS));
  process.stdout.write(`\x1b[${TOTAL_ROWS}A`);
  process.stdout.write('\x1b[s');

  const blankRow = () => ' '.repeat(terminalWidth());

  const draw = (colsRevealed: number, tagline: string, brightness: number = 1.0) => {
    const color = primaryColor(truecolor, brightness);
    process.stdout.write('\x1b[u');
    for (let i = 0; i < WORDMARK_HEIGHT; i++) {
      process.stdout.write(writeWordmarkRow(i, colsRevealed, color));
      process.stdout.write('\n');
    }
    for (let g = 0; g < TAGLINE_GAP; g++) {
      process.stdout.write(blankRow());
      process.stdout.write('\n');
    }
    process.stdout.write(writeTaglineRow(tagline));
  };

  try {
    const REVEAL_STEPS = 14;
    for (let s = 1; s <= REVEAL_STEPS; s++) {
      if (aborted) return;
      draw(Math.ceil(WORDMARK_WIDTH * (s / REVEAL_STEPS)), '');
      await sleep(45);
    }

    for (let s = 1; s <= 6; s++) {
      if (aborted) return;
      draw(WORDMARK_WIDTH, TAGLINE.slice(0, Math.ceil(TAGLINE.length * (s / 6))));
      await sleep(33);
    }

    for (const brightness of [0.85, 0.95, 1.0]) {
      if (aborted) return;
      draw(WORDMARK_WIDTH, TAGLINE, brightness);
      await sleep(100);
    }

    await sleep(150);
  } finally {
    process.stdout.off('resize', onResize);
    process.stdout.write(RESET);
    process.stdout.write(SHOW_CURSOR);
    process.stdout.write('\n');
  }
}
