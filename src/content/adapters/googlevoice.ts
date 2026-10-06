import { normalizePhone } from '@/shared/util';
import type { Adapter, ActiveThread, ThreadTarget } from './types';
import { cleanLabel } from './dom';

/**
 * Google Voice adapter.
 *
 * A conversation is identified by WHO it is with — never by message content.
 *
 *   • List boxes live in the left-hand scrolling conversation list. Message
 *     bubbles, call logs and dates in the open conversation are outside that
 *     list and can never be coloured.
 *   • Key = the contact line at the top of the box (first text line):
 *       phone number → `gv:+16615550134` (E.164, so every format matches)
 *       saved name   → `gv:name:jane doe`
 *     The message preview below it is ignored entirely.
 *   • The open conversation's id comes from the URL (`itemId=t.+1661…`).
 *     When you open a conversation we remember which box it belongs to, so the
 *     paintbrush and the list always share one colour.
 */

const MAP_KEY = 'teamhue:gv-thread-keys:v2';
const MAX_ROW_HEIGHT = 140;
const MIN_ROW_HEIGHT = 36;

/** Elements that belong to the OPEN conversation, never to the list. */
const CONVERSATION_PANE =
  'gv-message-list, gv-text-message-item, gv-message-item, gv-call-item, gv-voicemail-item, ' +
  'gv-message-entry, gv-conversation-header, [gv-test-id="message-list"]';

/** Elements that mark a conversation row in known GV markup versions. */
const ROW_SEEDS =
  'gv-thread-item, gv-thread-item-list-item, [gv-thread-id], [data-thread-id], ' +
  'a[href*="itemId="], [role="listitem"], [role="option"], [role="row"]';

const TIME_OR_META =
  /^(\d{1,2}:\d{2}\s*(am|pm)?|\d+\s*(s|sec|m|min|mins|h|hr|hrs|d|w)( ago)?|now|just now|yesterday|today|mon|tue|wed|thu|fri|sat|sun|[a-z]{3}\s\d{1,2}(,\s*\d{4})?|\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d+)$/i;

/**
 * Transient status text Google Voice shows while/after sending. These appear
 * in the row temporarily and must never be mistaken for the contact.
 */
const STATUS_TEXT =
  /^(sending|sent|delivered|read|seen|failed|not delivered|message not sent|tap to retry|retry|typing|draft|new|unread|missed call|incoming call|outgoing call|voicemail|you|me|mms|photo|image|video|attachment|sticker|gif)\b[.…!]*$/i;

const PHONE_TEXT_EARLY = /^\+?[\d\s().-]{7,}$/;

/* ------------------------------------------------------------------ helpers */

function textLines(el: HTMLElement, limit = 6): string[] {
  const lines: string[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      (n.parentElement?.closest('[aria-hidden="true"], .cdk-visually-hidden, style, script') ?? null)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.replace(/\s+/g, ' ').trim();
    if (!text || text === '·' || text === ',') continue;
    if (lines[lines.length - 1] !== text) lines.push(text);
    if (lines.length >= limit) break;
  }
  return lines;
}

/**
 * The contact line of a box: its first meaningful text line.
 * GV lays a row out as: [contact name or number] [time] / [preview]. The
 * preview is always after the contact line, so it is never used.
 */
function contactOf(row: HTMLElement): string | null {
  // 1. Explicit name elements in known GV versions take priority.
  const explicit = row.querySelector<HTMLElement>(
    '[gv-test-id="conversation-title"], [gv-id="contact-name"], [class*="participants"], [class*="contact-name"], [class*="thread-item-name"]',
  );
  const fromExplicit = cleanLabel(explicit?.textContent, 100);
  if (fromExplicit && !STATUS_TEXT.test(fromExplicit)) return fromExplicit;

  // 2. A phone number line is the strongest identity.
  for (const line of textLines(row, 4)) {
    const t = line.trim();
    if (t.length <= 24 && PHONE_TEXT_EARLY.test(t) && normalizePhone(t)) return t;
  }

  // 3. First meaningful line. The preview always comes after it; transient
  //    status/time text that GV injects while sending is skipped.
  for (const line of textLines(row, 8)) {
    const t = cleanLabel(line, 100);
    if (!t || TIME_OR_META.test(t) || STATUS_TEXT.test(t)) continue;
    if (/^(you|me):/i.test(t)) continue;
    return t;
  }
  return null;
}

/** Conversation id carried by the row itself (stable across new messages). */
function rowConversationId(row: HTMLElement): string | null {
  for (const el of [row, ...Array.from(row.querySelectorAll<HTMLElement>('[gv-thread-id], [data-thread-id], a[href*="itemId="]'))]) {
    const attr = el.getAttribute('gv-thread-id') ?? el.getAttribute('data-thread-id');
    if (attr) return attr;
    const fromHref = itemIdFrom(el.getAttribute('href'));
    if (fromHref) return fromHref;
  }
  return null;
}

/** Turns a contact line into a stable key: phone → E.164, else lowercased name. */
function keyForContact(contact: string): string {
  const looksLikePhone = /^[+()\d\s.-]{7,}$/.test(contact);
  const phone = looksLikePhone ? normalizePhone(contact) : null;
  if (phone) return `gv:${phone}`;
  return `gv:name:${contact.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

/** Conversation id from a URL/href: `itemId=t.%2B16615550134` → `t.+16615550134`. */
function itemIdFrom(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?&#]itemId=([^&#]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** If the conversation id embeds a single phone number, its E.164 key. */
function keyFromItemId(itemId: string): string | null {
  const m = itemId.match(/^t\.(\+?\d{7,15})$/);
  const phone = m ? normalizePhone(m[1]) : null;
  return phone ? `gv:${phone}` : null;
}

/* ------------------------------------------------------- id → row key map */

function loadMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MAP_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
let idToKey: Record<string, string> = loadMap();

function remember(itemId: string, key: string) {
  if (!itemId || !key || idToKey[itemId] === key) return;
  idToKey[itemId] = key;
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(idToKey));
  } catch {
    /* storage blocked */
  }
}

function aliasesFor(key: string): string[] {
  return Object.keys(idToKey)
    .filter((id) => idToKey[id] === key)
    .map((id) => `gv:id:${id}`);
}

/* ------------------------------------------------------------ the list */

let cachedList: HTMLElement | null = null;

function isScroller(el: HTMLElement): boolean {
  const oy = getComputedStyle(el).overflowY;
  return (oy === 'auto' || oy === 'scroll') && el.getBoundingClientRect().height > 150;
}

/** The left-hand conversation list: the scroll container holding the most row seeds. */
function threadList(): HTMLElement | null {
  if (cachedList?.isConnected && cachedList.getBoundingClientRect().height > 150) return cachedList;
  cachedList = null;

  const named = document.querySelector<HTMLElement>('gv-thread-list, gv-conversation-list');
  const votes = new Map<HTMLElement, number>();
  const maxRight = window.innerWidth * 0.65;

  for (const seed of Array.from(document.querySelectorAll<HTMLElement>(ROW_SEEDS))) {
    if (seed.closest(CONVERSATION_PANE)) continue;
    const r = seed.getBoundingClientRect();
    if (r.height === 0 || r.right > maxRight + 4) continue;
    let node = seed.parentElement;
    while (node && node !== document.body) {
      if (isScroller(node)) {
        votes.set(node, (votes.get(node) ?? 0) + 1);
        break;
      }
      node = node.parentElement;
    }
  }

  let best: HTMLElement | null = null;
  let bestVotes = 0;
  for (const [el, n] of votes) {
    const bonus = named && (el.contains(named) || named.contains(el)) ? 1000 : 0;
    if (n + bonus > bestVotes) {
      best = el;
      bestVotes = n + bonus;
    }
  }
  if (!best && named) best = named;
  cachedList = best;
  return best;
}

/** From any element inside a list box, the full box (or null if not in the list). */
function boxFrom(start: Element | null, list = threadList()): HTMLElement | null {
  if (!list || !start || start === list || !list.contains(start)) return null;
  if (start.closest(CONVERSATION_PANE)) return null;

  // Known row element wins outright.
  const known = start.closest<HTMLElement>('gv-thread-item, gv-thread-item-list-item');
  let best: HTMLElement | null = known && list.contains(known) ? known : null;

  if (!best) {
    const listWidth = list.getBoundingClientRect().width;
    let node: HTMLElement | null = start instanceof HTMLElement ? start : start.parentElement;
    while (node && node !== list) {
      const r = node.getBoundingClientRect();
      if (r.height > MAX_ROW_HEIGHT) break;
      if (r.height >= MIN_ROW_HEIGHT && r.width >= listWidth * 0.6) best = node;
      node = node.parentElement;
    }
  }

  if (!best || best.getBoundingClientRect().height === 0) return null;
  return contactOf(best) || rowConversationId(best) ? best : null;
}

function listRows(): HTMLElement[] {
  const found = new Set<HTMLElement>();
  const list = threadList();
  if (list) {
    for (const seed of Array.from(list.querySelectorAll<HTMLElement>(ROW_SEEDS))) {
      const box = boxFrom(seed, list);
      if (box) found.add(box);
    }
  }
  // Safety net: any conversation link in the left part of the page.
  const maxRight = window.innerWidth * 0.65;
  for (const a of Array.from(
    document.querySelectorAll<HTMLElement>('a[href*="itemId="], [gv-thread-id], gv-thread-item'),
  )) {
    if (a.closest(CONVERSATION_PANE)) continue;
    const r = a.getBoundingClientRect();
    if (r.height === 0 || r.right > maxRight + 4) continue;
    const box = boxFrom(a, list && list.contains(a) ? list : looseList(a));
    if (box) found.add(box);
  }
  // Final safety net: any box on the left that shows a phone number.
  for (const r of phoneRows()) {
    if (Array.from(found).some((f) => f.contains(r) || r.contains(f))) continue;
    found.add(r);
  }
  const rows = Array.from(found);
  return rows.filter((b) => !rows.some((o) => o !== b && o.contains(b)));
}

/**
 * Direct scan: every phone number / contact text on the left side of the page
 * becomes a row, independent of how GV structures its list. This guarantees
 * the box showing a number gets the colour assigned to that number.
 */
const PHONE_TEXT = /^\+?[\d\s().-]{7,}$/;
function phoneRows(): HTMLElement[] {
  const out: HTMLElement[] = [];
  const maxRight = window.innerWidth * 0.65;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n.textContent?.trim();
    if (!t || t.length > 24 || !PHONE_TEXT.test(t) || !normalizePhone(t)) continue;
    const el = n.parentElement;
    if (!el || el.closest(CONVERSATION_PANE + ', header, [role="banner"], input, textarea')) continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.right > maxRight + 4) continue;
    // Outermost ancestor that is still row-sized.
    let best: HTMLElement | null = null;
    let node: HTMLElement | null = el;
    while (node && node !== document.body) {
      const nr = node.getBoundingClientRect();
      if (nr.height > MAX_ROW_HEIGHT || nr.right > maxRight + 40) break;
      if (nr.height >= MIN_ROW_HEIGHT && nr.width >= 180) best = node;
      node = node.parentElement;
    }
    if (best) out.push(best);
  }
  return out;
}

/** Nearest reasonably wide ancestor to act as the list when voting failed. */
function looseList(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body) {
    if (node.getBoundingClientRect().height > MAX_ROW_HEIGHT * 2) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * The row's key. Priority:
 *   1. A conversation id on the row → the key learned for it (never changes
 *      when new messages arrive).
 *   2. The contact line (phone → E.164, else name).
 * The id → key binding is remembered, so if GV later shows transient text
 * where the name was, the id still resolves to the original key.
 */
function rowKey(row: HTMLElement): { key: string; label: string } | null {
  const id = rowConversationId(row);
  const contact = contactOf(row);

  // Contact line first: it is identical for every teammate, so colours sync.
  if (contact) {
    const key = keyForContact(contact);
    if (id) remember(id, key);
    return { key, label: contact };
  }
  // Contact unreadable (e.g. transient status text) → fall back to the id.
  const fromId = id ? (idToKey[id] ?? keyFromItemId(id)) : null;
  return fromId ? { key: fromId, label: fromId.replace(/^gv:(name:)?/, '') } : null;
}

function toTarget(row: HTMLElement): ThreadTarget | null {
  const k = rowKey(row);
  if (!k) return null;
  const aliases = new Set(aliasesFor(k.key));
  const id = rowConversationId(row);
  if (id) {
    aliases.add(`gv:id:${id}`);
    const phoneKey = keyFromItemId(id);
    if (phoneKey) aliases.add(phoneKey);
    if (idToKey[id]) aliases.add(idToKey[id]);
  }
  aliases.delete(k.key);
  return { element: row, threadKey: k.key, label: k.label, aliases: Array.from(aliases) };
}

/* ----------------------------------------------- remember which box opened */

let lastClicked: { key: string; at: number } | null = null;

function noteClick(e: Event) {
  const box = boxFrom(e.target as Element);
  const k = box ? rowKey(box) : null;
  if (k) lastClicked = { key: k.key, at: Date.now() };
}

if (location.hostname === 'voice.google.com') {
  document.addEventListener('pointerdown', noteClick, true);
  document.addEventListener('click', noteClick, true);
}

function isSelected(row: HTMLElement): boolean {
  const sel = '[aria-selected="true"], [aria-current="page"], [aria-current="true"], .selected, .is-selected';
  return row.matches(sel) || !!row.querySelector(sel) || !!row.closest(sel);
}

/* ------------------------------------------------------------------ adapter */

export const googleVoiceAdapter: Adapter = {
  platform: 'googlevoice',

  matches() {
    return location.hostname === 'voice.google.com';
  },

  findThreads(): ThreadTarget[] {
    const out: ThreadTarget[] = [];
    const used = new Set<string>();
    for (const row of listRows()) {
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
    const itemId = itemIdFrom(location.href);
    if (!itemId) return null;

    const rows = listRows();
    const byKey = (key: string) => rows.find((r) => rowKey(r)?.key === key) ?? null;

    // 0. The box whose own link points at this conversation.
    let row = rows.find((r) => rowConversationId(r) === itemId) ?? null;
    // 1. The box GV marks as selected.
    if (!row) row = rows.find(isSelected) ?? null;
    // 2. The box you just clicked to open this conversation.
    if (!row && lastClicked && Date.now() - lastClicked.at < 8000) row = byKey(lastClicked.key);
    // 3. Previously learned for this conversation id.
    if (!row && idToKey[itemId]) row = byKey(idToKey[itemId]);
    // 4. The id itself is a phone number shown in the list.
    const phoneKey = keyFromItemId(itemId);
    if (!row && phoneKey) row = byKey(phoneKey);

    let key: string | null = null;
    let label: string | null = null;
    if (row) {
      const k = rowKey(row);
      if (k) ({ key, label } = k);
    }
    if (!key && idToKey[itemId]) key = idToKey[itemId];
    if (!key && phoneKey) key = phoneKey;
    if (!key) return null; // can't tie to a list box → hide the paintbrush

    remember(itemId, key);
    const aliases = [`gv:id:${itemId}`];
    if (phoneKey && phoneKey !== key) aliases.push(phoneKey);
    return { threadKey: key, label: label ?? key.replace(/^gv:(name:)?/, ''), aliases };
  },
};

window.addEventListener('storage', (e) => {
  if (e.key === MAP_KEY) idToKey = loadMap();
});
