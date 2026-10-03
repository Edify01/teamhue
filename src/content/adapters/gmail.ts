import { normalizeEmail } from '@/shared/util';
import type { Adapter, ThreadTarget } from './types';
import { dedupe, cleanLabel } from './dom';

/**
 * Gmail adapter.
 *
 * Gmail's markup is obfuscated but has stable hooks that have existed for years:
 *   • `tr.zA`                     — a row in the message list
 *   • `[data-legacy-thread-id]`   — the immutable conversation id
 *   • `span[email]`               — the sender span, raw address in an attribute
 *
 * We key on the **thread id**, not the sender. Keying on the sender meant every
 * message from the same person shared one colour, so colouring one row coloured
 * them all. Gmail's `data-legacy-thread-id` is the RFC-level conversation id and
 * is identical across mailboxes that received the same conversation, so shared
 * inboxes still stay in sync.
 */

/** Pulls Gmail's conversation id off a row, trying every known attribute. */
function threadIdOf(row: HTMLElement): string | null {
  const direct =
    row.getAttribute('data-legacy-thread-id') ??
    row.getAttribute('data-thread-id') ??
    row.getAttribute('data-legacy-last-message-id');
  if (direct) return direct.replace(/^#?(thread-f:|msg-f:)?/, '');

  const nested = row.querySelector<HTMLElement>(
    '[data-legacy-thread-id], [data-thread-id], span[data-thread-id]',
  );
  const value =
    nested?.getAttribute('data-legacy-thread-id') ?? nested?.getAttribute('data-thread-id');
  if (value) return value.replace(/^#?(thread-f:|msg-f:)?/, '');

  // Older Gmail puts the id on the row element itself as `id="..."`.
  const rowId = row.getAttribute('id');
  if (rowId && /^[:\w]+$/.test(rowId) && rowId.length > 1) return rowId;

  return null;
}

/** Human-readable sender name for the picker UI. Never message content. */
function labelOf(row: HTMLElement): string | null {
  const span = row.querySelector<HTMLElement>('span[email]');
  if (span) {
    return (
      cleanLabel(span.getAttribute('name')) ??
      cleanLabel(span.getAttribute('title')) ??
      cleanLabel(span.textContent) ??
      cleanLabel(span.getAttribute('email'))
    );
  }
  const subject = row.querySelector<HTMLElement>('.bog, [data-thread-id] span');
  return cleanLabel(subject?.textContent);
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
      const id = threadIdOf(row);
      if (!id) continue;
      out.push({ element: row, threadKey: `gm:${id}`, label: labelOf(row) });
    }

    return dedupe(out);
  },

  observeRoots() {
    // Gmail renders the list inside a scrollable container; observing the main
    // role region keeps us off the enormous reading-pane subtree.
    const main = document.querySelector('[role="main"]');
    return main ? [main] : [];
  },

  activeThread() {
    // When a conversation is open its id is on the outer conversation container.
    const open = document.querySelector<HTMLElement>(
      '[role="main"] [data-legacy-thread-id], [role="main"] [data-thread-perm-id]',
    );
    if (!open) return null;

    const id = (
      open.getAttribute('data-legacy-thread-id') ?? open.getAttribute('data-thread-perm-id')
    )?.replace(/^#?(thread-f:|msg-f:)?/, '');
    if (!id) return null;

    const subject = cleanLabel(document.querySelector<HTMLElement>('[role="main"] h2')?.textContent);
    const sender = cleanLabel(
      document.querySelector<HTMLElement>('[role="main"] span[email]')?.getAttribute('name'),
    );

    return { threadKey: `gm:${id}`, label: sender ?? subject };
  },
};


/**
 * Outlook Web adapter — same idea, different hooks.
 * Rows are `div[role="option"]` and expose the conversation id as `data-convid`.
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
      // Skip wrappers that contain other rows.
      if (row.querySelector('div[role="option"]')) continue;

      const id =
        row.getAttribute('data-convid') ??
        row.getAttribute('data-item-id') ??
        row.getAttribute('id');
      if (!id || id.length < 2) continue;

      const nameEl = row.querySelector<HTMLElement>(
        '[class*="senderName"], span[title]:not([title*="@"])',
      );
      const label =
        cleanLabel(nameEl?.textContent) ??
        cleanLabel(row.getAttribute('aria-label')) ??
        normalizeEmail(row.querySelector<HTMLElement>('[title*="@"]')?.getAttribute('title') ?? '');

      out.push({ element: row, threadKey: `ol:${id}`, label });
    }

    return dedupe(out);
  },

  observeRoots() {
    const list = document.querySelector('[role="listbox"], [role="main"]');
    return list ? [list] : [];
  },

  activeThread() {
    const open = document.querySelector<HTMLElement>('[role="main"] [data-convid]');
    const id = open?.getAttribute('data-convid');
    if (!id) return null;

    const label = cleanLabel(
      document.querySelector<HTMLElement>('[role="main"] [class*="senderName"]')?.textContent,
    );
    return { threadKey: `ol:${id}`, label };
  },
};
