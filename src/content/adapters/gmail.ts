import { normalizeEmail } from '@/shared/util';
import type { Adapter, ThreadTarget } from './types';

/**
 * Gmail adapter.
 *
 * Gmail's markup is obfuscated but has two reliably stable hooks that have
 * existed for well over a decade:
 *   • `tr.zA`          — a row in the message list
 *   • `span[email]`    — the sender span, carrying the raw address in an attribute
 *
 * We key on the sender's email address rather than the Gmail thread id, because
 * thread ids are *per-mailbox*: the same conversation has a different id in each
 * teammate's account. Keying on the counterparty's address means a shared
 * inbox and individual inboxes all light up consistently.
 */

function senderOf(row: HTMLElement): { key: string; label: string | null } | null {
  // The canonical hook: <span email="jane@acme.com" name="Jane">
  const span = row.querySelector<HTMLElement>('span[email]');
  if (span) {
    const email = normalizeEmail(span.getAttribute('email') ?? '');
    if (email) {
      const label =
        span.getAttribute('name')?.trim() ||
        span.getAttribute('title')?.trim() ||
        span.textContent?.trim() ||
        email;
      return { key: `gm:${email}`, label: label.slice(0, 120) };
    }
  }

  // Fallback for rows where the attribute is missing (rare, e.g. drafts).
  const titled = row.querySelector<HTMLElement>('[title*="@"]');
  const email = normalizeEmail(titled?.getAttribute('title') ?? '');
  if (email) return { key: `gm:${email}`, label: email };

  return null;
}

export const gmailAdapter: Adapter = {
  platform: 'gmail',

  matches() {
    return location.hostname === 'mail.google.com';
  },

  findThreads(): ThreadTarget[] {
    const out: ThreadTarget[] = [];

    // `tr.zA` is the message-list row. `[role="row"]` covers newer variants.
    const rows = document.querySelectorAll<HTMLElement>('tr.zA, table[role="grid"] tr[role="row"]');
    for (const row of Array.from(rows)) {
      const found = senderOf(row);
      if (!found) continue;
      out.push({ element: row, threadKey: found.key, label: found.label });
    }
    return out;
  },

  observeRoots() {
    // Gmail renders the list inside a scrollable container; observing the main
    // role region keeps us off the enormous reading-pane subtree.
    const main = document.querySelector('[role="main"]');
    return main ? [main] : [];
  },

  activeThread() {
    // When a conversation is open, the sender span lives in the message header.
    const open = document.querySelector<HTMLElement>('[role="main"] h2 + div span[email], [role="main"] span[email]');
    if (!open) return null;
    const email = normalizeEmail(open.getAttribute('email') ?? '');
    if (!email) return null;
    const label = open.getAttribute('name')?.trim() || email;
    return { threadKey: `gm:${email}`, label: label.slice(0, 120) };
  },
};

/**
 * Outlook Web adapter — same idea, different hooks.
 * Rows are `div[role="option"]` inside the message list, and the sender's
 * address is exposed on a `[title]` or in the aria-label.
 */
export const outlookAdapter: Adapter = {
  platform: 'outlook',

  matches() {
    return /^outlook\.(live|office|office365)\.com$/.test(location.hostname);
  },

  findThreads(): ThreadTarget[] {
    const out: ThreadTarget[] = [];
    const rows = document.querySelectorAll<HTMLElement>(
      'div[role="option"][data-convid], div[role="option"], div[role="listitem"]',
    );

    for (const row of Array.from(rows)) {
      if (row.querySelector('div[role="option"]')) continue;

      const aria = row.getAttribute('aria-label') ?? '';
      const titled = row.querySelector<HTMLElement>('[title*="@"]')?.getAttribute('title') ?? '';
      const email = normalizeEmail(titled) ?? normalizeEmail(aria);
      if (!email) continue;

      const nameEl = row.querySelector<HTMLElement>('[class*="senderName"], span[title]:not([title*="@"])');
      const label = nameEl?.textContent?.trim().slice(0, 120) || email;

      out.push({ element: row, threadKey: `ol:${email}`, label });
    }
    return out;
  },

  observeRoots() {
    const list = document.querySelector('[role="listbox"], [role="main"]');
    return list ? [list] : [];
  },

  activeThread() {
    const header = document.querySelector<HTMLElement>('[role="main"] [class*="senderName"], [role="main"] [title*="@"]');
    if (!header) return null;
    const email =
      normalizeEmail(header.getAttribute('title') ?? '') ?? normalizeEmail(header.textContent ?? '');
    if (!email) return null;
    return { threadKey: `ol:${email}`, label: (header.textContent?.trim() || email).slice(0, 120) };
  },
};
