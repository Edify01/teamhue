import type { Adapter, ActiveThread, ThreadTarget } from './types';
import { cleanLabel } from './dom';

/**
 * Instagram Direct adapter.
 *
 * Instagram's current inbox renders each conversation as a plain
 * `div[role="button"]` — there is NO thread id anywhere in the row's markup.
 * The only `/direct/t/<id>` information on the page is the URL of the *open*
 * conversation. (Matching `/direct/t/` links therefore only ever hit the
 * sidebar's Messages icon, which is what got painted before.)
 *
 * So rows are found structurally:
 *   • a clickable element (role=button / listitem / thread anchor)
 *   • containing an avatar <img> and at least two text lines (name + preview)
 *   • row-sized (wide, 44–120px tall), outside the open conversation pane
 *   • aligned in the same column as its siblings (the inbox list)
 *
 * Rows are keyed by the contact's display name (`ig:n:<name>`), identical for
 * every teammate on the same account. When a conversation is opened we learn
 * its numeric/alphanumeric id from the URL and remember id ↔ name, so the
 * floating button and the list always refer to the same colour.
 */

const THREAD_PATH = /\/direct\/t\/([A-Za-z0-9._-]+)/;
const MAP_KEY = 'teamhue:ig-thread-names';

/* ------------------------------------------------------------------ id ↔ name */

function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function nameKey(name: string): string {
  return `ig:n:${normalizeName(name)}`;
}

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
    /* storage full / blocked — the mapping just won't persist */
  }
}

function idsForName(name: string): string[] {
  const n = normalizeName(name);
  return Object.keys(idToName).filter((id) => normalizeName(idToName[id]) === n);
}

function threadIdFromPath(path: string | null | undefined): string | null {
  const id = path?.match(THREAD_PATH)?.[1];
  return id && id !== 'new' && id.length > 1 ? id : null;
}

/* --------------------------------------------------------------- row parsing */

const TIMESTAMP = /^(\d+\s*[smhdwy]|now|just now|active.*|·)$/i;

/** Distinct visible text lines inside a row, in order. */
function textLines(el: HTMLElement): string[] {
  const lines: string[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.replace(/\s+/g, ' ').trim();
    if (!text || text === '·') continue;
    if (lines[lines.length - 1] !== text) lines.push(text);
    if (lines.length >= 6) break;
  }
  return lines;
}

/** The contact's display name: the first text line that isn't a timestamp. */
function nameOf(el: HTMLElement): string | null {
  const preferred = el.querySelector<HTMLElement>('span[dir="auto"]');
  const first = cleanLabel(preferred?.textContent, 80);
  if (first && !TIMESTAMP.test(first)) return first;

  for (const line of textLines(el)) {
    const t = cleanLabel(line, 80);
    if (t && !TIMESTAMP.test(t)) return t;
  }
  return null;
}

/**
 * The inbox column is always on the left part of the window; the open
 * conversation (whose message bubbles also have avatars + text) is to the right.
 */
function inInboxColumn(r: DOMRect): boolean {
  return r.left < Math.max(window.innerWidth * 0.35, 120) && r.width >= 200;
}

/**
 * Climbs from any element inside a conversation to the full contact box:
 * the OUTERMOST ancestor that is still row-sized (≤ 130px tall). The list
 * container above it is much taller, so this lands exactly on the box behind
 * the avatar, name and preview.
 */
export function rowBoxFrom(start: Element | null): HTMLElement | null {
  let node = start instanceof HTMLElement ? start : start?.parentElement ?? null;
  let best: HTMLElement | null = null;
  while (node && node !== document.body && node !== document.documentElement) {
    const r = node.getBoundingClientRect();
    if (r.height > 130) break;
    if (r.height >= 40 && r.width >= 200) best = node;
    node = node.parentElement;
  }
  if (!best) return null;
  if (best.closest('nav, [role="navigation"], [role="tablist"]')) return null;

  const r = best.getBoundingClientRect();
  if (!inInboxColumn(r)) return null;
  if (!best.querySelector('img')) return null; // every conversation has an avatar
  if (textLines(best).length < 2) return null; // name + preview
  return best;
}

/** Every conversation box currently rendered in the inbox. */
function inboxRows(): HTMLElement[] {
  const rows = new Set<HTMLElement>();
  const seeds = document.querySelectorAll<HTMLElement>('img, span[dir="auto"]');
  for (const seed of Array.from(seeds)) {
    const r = seed.getBoundingClientRect();
    if (r.width === 0 || r.left > window.innerWidth * 0.35) continue;
    const box = rowBoxFrom(seed);
    if (box) rows.add(box);
  }
  // Drop any box nested inside another detected box.
  const list = Array.from(rows);
  return list.filter((b) => !list.some((o) => o !== b && o.contains(b)));
}

/* ------------------------------------------------------- learn id from clicks */

// Clicking a row navigates to /direct/t/<id>. Recording which row was clicked
// lets us bind that id to the contact name the moment the URL changes.
let lastClicked: { name: string; at: number } | null = null;

if (/(^|\.)instagram\.com$/.test(location.hostname)) {
  document.addEventListener(
    'click',
    (e) => {
      const box = rowBoxFrom(e.target as Element);
      const name = box ? nameOf(box) : null;
      if (name) lastClicked = { name, at: Date.now() };
    },
    true,
  );
}

/** Open conversation pane: the column containing the message composer. */
function conversationPane(): HTMLElement | null {
  const composer = document.querySelector<HTMLElement>(
    'div[role="textbox"][contenteditable="true"], textarea',
  );
  let node = composer;
  while (node && node !== document.body) {
    const r = node.getBoundingClientRect();
    if (r.height > window.innerHeight * 0.6 && r.left > window.innerWidth * 0.2) return node;
    node = node.parentElement;
  }
  return null;
}

/** All short text lines in the open conversation's header area. */
function headerTexts(pane: HTMLElement | null): string[] {
  if (!pane) return [];
  const top = pane.getBoundingClientRect().top;
  const out: string[] = [];
  const els = pane.querySelectorAll<HTMLElement>('a[href^="/"]:not([href*="/direct/"]), h1, h2, span');
  for (const el of Array.from(els)) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.top - top > 110) continue;
    const text = cleanLabel(el.textContent, 80);
    if (text && !TIMESTAMP.test(text) && !out.includes(text)) out.push(text);
    if (out.length >= 12) break;
  }
  return out;
}

/* ------------------------------------------------------------------- adapter */

export const instagramAdapter: Adapter = {
  platform: 'instagram',

  matches() {
    return /(^|\.)instagram\.com$/.test(location.hostname);
  },

  findThreads(): ThreadTarget[] {
    const out: ThreadTarget[] = [];
    const usedKeys = new Set<string>();

    for (const row of inboxRows()) {
      const name = nameOf(row);
      if (!name) continue;

      const key = nameKey(name);
      if (usedKeys.has(key)) continue; // one box per contact
      usedKeys.add(key);

      // Learn ids from rows that still carry an anchor (older layouts).
      const anchorId = threadIdFromPath(
        row.closest('a')?.getAttribute('href') ??
          row.querySelector('a[href*="/direct/t/"]')?.getAttribute('href'),
      );
      if (anchorId) remember(anchorId, name);

      out.push({
        element: row,
        threadKey: key,
        label: name,
        // Colours saved earlier via the floating button used `ig:<id>`.
        aliases: idsForName(name).map((id) => `ig:${id}`),
      });
    }
    return out;
  },

  observeRoots() {
    // Instagram swaps whole subtrees between layouts; observing body is the
    // only root guaranteed to survive. Mutation handling is debounced upstream.
    return [document.body];
  },

  activeThread(): ActiveThread | null {
    const id = threadIdFromPath(location.pathname);
    if (!id) return null;

    // The key MUST be the display name exactly as the left-hand box shows it,
    // otherwise a colour set from the open conversation never reaches the box.
    // The header often shows the @username instead, so it is only used to pick
    // the matching left-hand box, never as the key itself.
    if (lastClicked && Date.now() - lastClicked.at < 5000) {
      remember(id, lastClicked.name);
      lastClicked = null;
    }

    let name: string | null = idToName[id] ?? null;

    if (!name) {
      const rowNames = inboxRows()
        .map((r) => nameOf(r))
        .filter((n): n is string => Boolean(n));
      const header = headerTexts(conversationPane());
      name =
        rowNames.find((n) => header.some((h) => normalizeName(h) === normalizeName(n))) ??
        rowNames.find((n) =>
          header.some((h) => normalizeName(h).includes(normalizeName(n)) && n.length > 2),
        ) ??
        null;
      if (name) remember(id, name);
    }

    if (!name) return { threadKey: `ig:${id}`, label: headerTexts(conversationPane())[0] ?? null };
    return { threadKey: nameKey(name), label: name, aliases: [`ig:${id}`] };
  },
};

// Exposed for tests / diagnostics.
export const __instagramInternals = { inboxRows, nameOf, conversationPane };

// Keep the map fresh if another tab updates it.
window.addEventListener('storage', (e) => {
  if (e.key === MAP_KEY) idToName = loadMap();
});
