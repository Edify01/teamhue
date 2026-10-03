import type { Adapter, ActiveThread, ThreadTarget } from './types';
import { cleanLabel } from './dom';

/**
 * Instagram Direct adapter (desktop).
 *
 * Instagram's inbox rows carry no thread id in their markup, and class names
 * are randomised. So we work from layout, in three steps:
 *
 *   1. Find the INBOX LIST: the scrolling container on the left of the window
 *      that holds the most profile pictures.
 *   2. A CONVERSATION BOX is the outermost element inside that list, around a
 *      profile picture, that is still one row tall and spans the list width.
 *      Nothing outside the list (chat header, messages, dates, sidebar) can
 *      ever qualify.
 *   3. Each box is keyed by the contact's display name as shown in the list
 *      (`ig:n:<name>`), so every teammate gets the same key.
 *
 * The paintbrush (open conversation) resolves to a box in the list using, in
 * order: Instagram's own "selected" marker, the box you clicked to open the
 * chat, and the header's profile picture matched against the list's pictures.
 * It never guesses from hover/background colours.
 */

const THREAD_PATH = /\/direct\/t\/([A-Za-z0-9._-]+)/;
// v2: earlier versions stored some wrong id→name pairs; start clean.
const MAP_KEY = 'teamhue:ig-thread-names:v2';
const MAX_ROW_HEIGHT = 130;
const MIN_ROW_HEIGHT = 36;

/* ------------------------------------------------------------------ helpers */

function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function nameKey(name: string): string {
  return `ig:n:${normalizeName(name)}`;
}

function threadIdFromPath(path: string | null | undefined): string | null {
  const id = path?.match(THREAD_PATH)?.[1];
  return id && id !== 'new' && id.length > 1 ? id : null;
}

const TIMESTAMP = /^(\d+\s*[smhdwy]|now|just now|active\b.*|·|seen\b.*|sent\b.*)$/i;

/** Distinct visible text lines inside an element, in order. */
function textLines(el: HTMLElement, limit = 6): string[] {
  const lines: string[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.replace(/\s+/g, ' ').trim();
    if (!text || text === '·') continue;
    if (lines[lines.length - 1] !== text) lines.push(text);
    if (lines.length >= limit) break;
  }
  return lines;
}

/** The contact's display name: the first text line that isn't a timestamp. */
function nameOf(row: HTMLElement): string | null {
  for (const line of textLines(row)) {
    const t = cleanLabel(line, 80);
    if (t && !TIMESTAMP.test(t)) return t;
  }
  return null;
}

/** A stable identity for a profile picture: its alt text, else its file name. */
function avatarId(img: HTMLImageElement | null): string | null {
  if (!img) return null;
  const alt = img.getAttribute('alt')?.trim().toLowerCase();
  if (alt && alt.length > 2) return `alt:${alt}`;
  try {
    const file = new URL(img.currentSrc || img.src).pathname.split('/').pop();
    return file ? `src:${file}` : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- id ↔ name map */

function loadMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MAP_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

let idToName: Record<string, string> = loadMap();

function remember(id: string, name: string) {
  if (!id || !name || idToName[id] === name) return;
  idToName[id] = name;
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(idToName));
  } catch {
    /* storage blocked — mapping just won't persist */
  }
}

function idsForName(name: string): string[] {
  const n = normalizeName(name);
  return Object.keys(idToName).filter((id) => normalizeName(idToName[id]) === n);
}

/* --------------------------------------------------------------- inbox list */

let cachedList: HTMLElement | null = null;

function isScroller(el: HTMLElement): boolean {
  const oy = getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll';
}

/**
 * The left-hand scrolling list of conversations. Chosen by voting: each
 * visible profile picture on the left half of the window votes for its
 * nearest scrolling ancestor; the container with the most votes wins.
 */
function inboxList(): HTMLElement | null {
  if (cachedList?.isConnected) {
    const r = cachedList.getBoundingClientRect();
    if (r.height > 150 && r.width > 0) return cachedList;
  }
  cachedList = null;

  const votes = new Map<HTMLElement, number>();
  const half = window.innerWidth * 0.6;

  for (const img of Array.from(document.images)) {
    const r = img.getBoundingClientRect();
    if (r.width < 20 || r.width > 120 || r.right > half) continue;

    let node = img.parentElement;
    while (node && node !== document.body) {
      if (isScroller(node)) {
        const nr = node.getBoundingClientRect();
        if (nr.height > 150 && nr.width >= 180 && nr.right <= half + 4) {
          votes.set(node, (votes.get(node) ?? 0) + 1);
        }
        break;
      }
      node = node.parentElement;
    }
  }

  let best: HTMLElement | null = null;
  let bestVotes = 1; // need at least 2 conversations to be confident
  for (const [el, n] of votes) {
    if (n > bestVotes) {
      best = el;
      bestVotes = n;
    }
  }
  cachedList = best;
  return best;
}

/**
 * From any element inside a conversation box, returns the full box: the
 * outermost ancestor (below the list) that is still one row tall and spans
 * most of the list's width. Returns null for anything outside the list.
 */
function boxFrom(start: Element | null, list = inboxList()): HTMLElement | null {
  if (!list || !start || !list.contains(start) || start === list) return null;

  const listWidth = list.getBoundingClientRect().width;
  let node: HTMLElement | null = start instanceof HTMLElement ? start : start.parentElement;
  let best: HTMLElement | null = null;

  while (node && node !== list) {
    const r = node.getBoundingClientRect();
    if (r.height > MAX_ROW_HEIGHT) break;
    if (r.height >= MIN_ROW_HEIGHT && r.width >= listWidth * 0.6) best = node;
    node = node.parentElement;
  }

  if (!best) return null;
  if (!best.querySelector('img')) return null; // every conversation has a picture
  if (!nameOf(best)) return null;
  return best;
}

function inboxRows(): HTMLElement[] {
  const list = inboxList();
  if (!list) return [];
  const found = new Set<HTMLElement>();
  for (const img of Array.from(list.querySelectorAll('img'))) {
    const box = boxFrom(img, list);
    if (box) found.add(box);
  }
  const rows = Array.from(found);
  return rows.filter((b) => !rows.some((o) => o !== b && o.contains(b)));
}

function toTarget(row: HTMLElement): ThreadTarget | null {
  const name = nameOf(row);
  if (!name) return null;
  return {
    element: row,
    threadKey: nameKey(name),
    label: name,
    aliases: idsForName(name).map((id) => `ig:${id}`),
  };
}

/* ------------------------------------------------ remember which box opened */

let lastClicked: { name: string; at: number } | null = null;

function noteClick(e: Event) {
  const box = boxFrom(e.target as Element);
  const name = box ? nameOf(box) : null;
  if (name) lastClicked = { name, at: Date.now() };
}

if (/(^|\.)instagram\.com$/.test(location.hostname)) {
  document.addEventListener('pointerdown', noteClick, true);
  document.addEventListener('click', noteClick, true);
}

/* --------------------------------------------------------- open chat header */

/** The profile picture at the top of the open conversation (right of the list). */
function headerAvatar(): HTMLImageElement | null {
  const list = inboxList();
  const minLeft = list ? list.getBoundingClientRect().right - 2 : window.innerWidth * 0.3;
  let best: HTMLImageElement | null = null;
  for (const img of Array.from(document.images)) {
    const r = img.getBoundingClientRect();
    if (r.width < 20 || r.width > 80 || r.left < minLeft || r.top > 160) continue;
    if (!best || r.top < best.getBoundingClientRect().top) best = img;
  }
  return best;
}

/** Short text lines near the top of the open conversation. */
function headerTexts(): string[] {
  const list = inboxList();
  const minLeft = list ? list.getBoundingClientRect().right - 2 : window.innerWidth * 0.3;
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('h1, h2, span, a'))) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.left < minLeft || r.top > 120) continue;
    const t = cleanLabel(el.textContent, 80);
    if (t && !TIMESTAMP.test(t) && !out.includes(t)) out.push(t);
    if (out.length >= 15) break;
  }
  return out;
}

/* ------------------------------------------------------------------ adapter */

export const instagramAdapter: Adapter = {
  platform: 'instagram',

  matches() {
    return /(^|\.)instagram\.com$/.test(location.hostname);
  },

  findThreads(): ThreadTarget[] {
    const out: ThreadTarget[] = [];
    const used = new Set<string>();
    for (const row of inboxRows()) {
      const t = toTarget(row);
      if (!t || used.has(t.threadKey)) continue;
      used.add(t.threadKey);
      out.push(t);
    }
    return out;
  },

  threadAt(el: Element): ThreadTarget | null {
    const box = boxFrom(el);
    return box ? toTarget(box) : null;
  },

  observeRoots() {
    return [document.body];
  },

  activeThread(): ActiveThread | null {
    const id = threadIdFromPath(location.pathname);
    if (!id) return null;

    const rows = inboxRows();
    const byName = (n: string | null | undefined) =>
      n ? rows.find((r) => normalizeName(nameOf(r) ?? '') === normalizeName(n)) ?? null : null;

    let row: HTMLElement | null = null;

    // 1. Instagram's own "selected" marker on the open conversation's box.
    row =
      rows.find(
        (r) =>
          r.matches('[aria-selected="true"], [aria-current="page"], [aria-current="true"]') ||
          !!r.querySelector('[aria-selected="true"], [aria-current="page"], [aria-current="true"]'),
      ) ?? null;

    // 2. The box you just clicked to open this chat.
    if (!row && lastClicked && Date.now() - lastClicked.at < 8000) {
      row = byName(lastClicked.name);
      if (row) remember(id, lastClicked.name);
    }

    // 3. Previously learned for this chat id.
    if (!row && idToName[id]) row = byName(idToName[id]);

    // 4. Header profile picture matched to the same picture in the list.
    if (!row) {
      const hid = avatarId(headerAvatar());
      if (hid) {
        const matches = rows.filter((r) => avatarId(r.querySelector('img')) === hid);
        if (matches.length === 1) row = matches[0];
      }
    }

    // 5. Header text that exactly equals one box's name.
    if (!row) {
      const header = new Set(headerTexts().map(normalizeName));
      const matches = rows.filter((r) => header.has(normalizeName(nameOf(r) ?? '')));
      if (matches.length === 1) row = matches[0];
    }

    if (row) {
      const name = nameOf(row)!;
      remember(id, name);
      return { threadKey: nameKey(name), label: name, aliases: [`ig:${id}`] };
    }

    // Chat open but its box is scrolled out of the list: use what we learned.
    const known = idToName[id];
    if (known) return { threadKey: nameKey(known), label: known, aliases: [`ig:${id}`] };

    return null;
  },
};

window.addEventListener('storage', (e) => {
  if (e.key === MAP_KEY) idToName = loadMap();
});
