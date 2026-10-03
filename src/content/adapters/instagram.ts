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

/** The open conversation pane (everything right of the inbox), if any. */
function conversationPane(): HTMLElement | null {
  const composer = document.querySelector<HTMLElement>(
    'div[role="textbox"][contenteditable="true"], textarea[placeholder]',
  );
  if (!composer) return null;

  let node: HTMLElement | null = composer;
  while (node && node !== document.body) {
    const r = node.getBoundingClientRect();
    if (r.height > window.innerHeight * 0.6) return node;
    node = node.parentElement;
  }
  return null;
}

function looksLikeRow(el: HTMLElement, pane: HTMLElement | null): boolean {
  if (pane && pane.contains(el)) return false;
  if (el.closest('nav, [role="navigation"]')) return false;

  const r = el.getBoundingClientRect();
  if (r.width < 200 || r.height < 44 || r.height > 120) return false;

  // Avatar present (profile pictures are <img>, sometimes inside <canvas> wrappers).
  if (!el.querySelector('img')) return false;

  // Name + preview — single-line items are headers, tabs, or nav entries.
  return textLines(el).length >= 2;
}

/**
 * Picks the inbox rows from all candidates.
 *
 * Message bubbles and random UI can occasionally pass `looksLikeRow`; inbox
 * rows, however, are stacked in one column with identical left edge and width.
 * We keep the largest such column.
 */
function inboxRows(): HTMLElement[] {
  const pane = conversationPane();
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="button"], [role="listitem"], a[href*="/direct/t/"]',
    ),
  ).filter((el) => looksLikeRow(el, pane));

  // Keep the outermost qualifying element: that's the full row box.
  const outer = candidates.filter(
    (el) => !candidates.some((other) => other !== el && other.contains(el)),
  );

  const columns = new Map<string, HTMLElement[]>();
  for (const el of outer) {
    const r = el.getBoundingClientRect();
    const col = `${Math.round(r.left / 4)}:${Math.round(r.width / 4)}`;
    const list = columns.get(col) ?? [];
    list.push(el);
    columns.set(col, list);
  }

  let best: HTMLElement[] = [];
  for (const list of columns.values()) {
    if (
      list.length > best.length ||
      (list.length === best.length &&
        list.length > 0 &&
        list[0].getBoundingClientRect().left < best[0].getBoundingClientRect().left)
    ) {
      best = list;
    }
  }
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
      const path = e.composedPath();
      const row = inboxRows().find((r) => path.includes(r));
      const name = row ? nameOf(row) : null;
      if (name) lastClicked = { name, at: Date.now() };
    },
    true,
  );
}

/** Name shown in the open conversation's header (fallback when no click seen). */
function headerName(pane: HTMLElement | null): string | null {
  if (!pane) return null;
  const top = pane.getBoundingClientRect().top;
  const links = pane.querySelectorAll<HTMLElement>('a[href^="/"]:not([href*="/direct/"]), h1, h2, span[dir="auto"]');
  for (const el of Array.from(links)) {
    const r = el.getBoundingClientRect();
    if (r.top - top > 110) continue;
    const text = cleanLabel(el.textContent, 80);
    if (text && !TIMESTAMP.test(text)) return text;
  }
  return null;
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

    if (lastClicked && Date.now() - lastClicked.at < 5000) {
      remember(id, lastClicked.name);
      lastClicked = null;
    }

    const name = idToName[id] ?? headerName(conversationPane());
    if (name && !idToName[id]) remember(id, name);

    if (!name) return { threadKey: `ig:${id}`, label: null };
    return { threadKey: nameKey(name), label: name, aliases: [`ig:${id}`] };
  },
};

// Exposed for tests / diagnostics.
export const __instagramInternals = { inboxRows, nameOf, conversationPane };

// Keep the map fresh if another tab updates it.
window.addEventListener('storage', (e) => {
  if (e.key === MAP_KEY) idToName = loadMap();
});
