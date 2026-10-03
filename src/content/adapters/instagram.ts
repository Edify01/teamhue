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
 * Right edge of the inbox list. Everything right of this (the open
 * conversation: header, message bubbles, dates) must never be treated as a
 * conversation box.
 */
function inboxRightEdge(): number {
  const pane = conversationPane();
  if (pane) return pane.getBoundingClientRect().left + 2;
  // Inbox with no conversation open: the list still sits on the left.
  return window.innerWidth * 0.45;
}

/** True when `el` lives inside a vertically scrollable list (the inbox). */
function inScrollableList(el: HTMLElement): boolean {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight + 4 &&
      node.getBoundingClientRect().height > 200
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Climbs from any element inside a conversation to the full contact box:
 * the OUTERMOST ancestor that is still row-sized (≤ 130px tall). The list
 * container above it is much taller, so this lands exactly on the box behind
 * the avatar, name and preview. Only boxes in the left-hand inbox qualify.
 */
export function rowBoxFrom(start: Element | null, edge = inboxRightEdge()): HTMLElement | null {
  let node = start instanceof HTMLElement ? start : start?.parentElement ?? null;
  let best: HTMLElement | null = null;
  while (node && node !== document.body && node !== document.documentElement) {
    const r = node.getBoundingClientRect();
    if (r.height > 130) break;
    if (r.height >= 40 && r.width >= 150) best = node;
    node = node.parentElement;
  }
  if (!best) return null;
  if (best.closest('nav, [role="navigation"], [role="tablist"]')) return null;

  const r = best.getBoundingClientRect();
  if (r.right > edge) return null; // inside the open conversation
  if (!best.querySelector('img')) return null; // every conversation has an avatar
  if (textLines(best).length < 2) return null; // name + preview
  return best;
}

/** Every conversation box currently rendered in the left-hand inbox list. */
function inboxRows(): HTMLElement[] {
  const edge = inboxRightEdge();
  const found = new Set<HTMLElement>();
  for (const img of Array.from(document.querySelectorAll<HTMLElement>('img'))) {
    const r = img.getBoundingClientRect();
    if (r.width === 0 || r.right > edge) continue;
    const box = rowBoxFrom(img, edge);
    if (box) found.add(box);
  }

  let rows = Array.from(found);
  rows = rows.filter((b) => !rows.some((o) => o !== b && o.contains(b)));
  rows = rows.filter(inScrollableList);

  // Real inbox rows share one column (same left edge and width). Keep the
  // largest such group; strays (profile cards, banners) are dropped.
  const groups = new Map<string, HTMLElement[]>();
  for (const el of rows) {
    const r = el.getBoundingClientRect();
    const k = `${Math.round(r.left / 6)}:${Math.round(r.width / 6)}`;
    groups.set(k, [...(groups.get(k) ?? []), el]);
  }
  let best: HTMLElement[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best;
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

    // The paintbrush must colour the conversation's box in the LEFT list,
    // never the open chat's header. Resolve the name from the left list only.
    if (lastClicked && Date.now() - lastClicked.at < 5000) {
      remember(id, lastClicked.name);
      lastClicked = null;
    }

    const rows = inboxRows();

    // 1. Instagram marks the open conversation's row as selected/current.
    const selected = rows.find(
      (r) =>
        r.matches('[aria-selected="true"], [aria-current="page"], [aria-current="true"]') ||
        r.querySelector('[aria-selected="true"], [aria-current="page"], [aria-current="true"]'),
    );
    let name: string | null = selected ? nameOf(selected) : null;

    // 2. Otherwise, the row Instagram shades as active (different background).
    if (!name) {
      const shaded = rows.filter((r) => {
        const bg = getComputedStyle(r).backgroundColor;
        return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && !r.classList.contains('th-painted');
      });
      if (shaded.length === 1) name = nameOf(shaded[0]);
    }

    // 3. Otherwise, what we learned when the row was clicked.
    if (!name) name = idToName[id] ?? null;

    // 4. Last resort: a left-list name that appears in the chat header.
    if (!name) {
      const header = headerTexts(conversationPane()).map(normalizeName);
      name =
        rows
          .map((r) => nameOf(r))
          .find((n): n is string => Boolean(n) && header.includes(normalizeName(n!))) ?? null;
    }

    if (!name) return null; // no left-hand box to colour → hide the button
    remember(id, name);
    return { threadKey: nameKey(name), label: name, aliases: [`ig:${id}`] };
  },
};

// Exposed for tests / diagnostics.
export const __instagramInternals = { inboxRows, nameOf, conversationPane };

// Keep the map fresh if another tab updates it.
window.addEventListener('storage', (e) => {
  if (e.key === MAP_KEY) idToName = loadMap();
});
