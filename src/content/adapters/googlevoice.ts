import { normalizePhone } from '@/shared/util';
import type { Adapter, ThreadTarget } from './types';

/**
 * Google Voice adapter.
 *
 * Google Voice is the friendliest of the three: it is an Angular app with
 * stable custom element names (`gv-thread-item`, `gv-conversation-list`) and it
 * exposes phone numbers directly. We key threads on the normalized E.164 number
 * so `(661) 555-0134` and `+16615550134` resolve to the same color for everyone.
 */

const PHONE_TEXT = /(\+?\d[\d\s().-]{6,}\d)/;

function keyFromPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const phone = normalizePhone(raw);
  return phone ? `gv:${phone}` : null;
}

/** Extracts the best identifier from a thread row. */
function identify(row: HTMLElement): { key: string; label: string | null } | null {
  // 1. Angular routerLink / href often contains the conversation id.
  const anchor = row.querySelector<HTMLAnchorElement>('a[href*="/messages/"], a[href*="/calls/"]');
  const href = anchor?.getAttribute('href') ?? '';

  // 2. aria-label on the row usually reads "Conversation with Jane Doe".
  const aria =
    row.getAttribute('aria-label') ??
    row.querySelector('[aria-label]')?.getAttribute('aria-label') ??
    '';

  const text = row.textContent ?? '';

  // Prefer an explicit phone number anywhere in the row.
  const phoneMatch = (aria + ' ' + text).match(PHONE_TEXT);
  const phoneKey = keyFromPhone(phoneMatch?.[1]);

  // Derive a readable label: the contact name if present, else the number.
  let label: string | null = null;
  const nameEl = row.querySelector<HTMLElement>(
    '.gv-thread-item-name, [class*="thread-item-name"], [class*="contact-name"]',
  );
  if (nameEl?.textContent?.trim()) {
    label = nameEl.textContent.trim().slice(0, 120);
  } else if (aria) {
    label = aria.replace(/^conversation with\s*/i, '').trim().slice(0, 120) || null;
  } else if (phoneMatch) {
    label = phoneMatch[1].trim();
  }

  if (phoneKey) return { key: phoneKey, label };

  // Fallback: a conversation id embedded in the link.
  const idMatch = href.match(/\/(?:messages|calls)\/([A-Za-z0-9_@.%-]+)/);
  if (idMatch) return { key: `gv:id:${decodeURIComponent(idMatch[1])}`, label };

  // Last resort: a group thread keyed on its stable label.
  if (label) return { key: `gv:name:${label.toLowerCase()}`, label };

  return null;
}

const ROW_SELECTOR = [
  'gv-thread-item',
  'gv-annotation',
  '[gv-id="thread-item"]',
  'div[role="listitem"]',
  'li[role="listitem"]',
].join(',');

export const googleVoiceAdapter: Adapter = {
  platform: 'googlevoice',

  matches() {
    return location.hostname === 'voice.google.com';
  },

  findThreads(): ThreadTarget[] {
    const out: ThreadTarget[] = [];
    const seen = new Set<HTMLElement>();

    const rows = document.querySelectorAll<HTMLElement>(ROW_SELECTOR);
    for (const row of Array.from(rows)) {
      if (seen.has(row)) continue;
      // Skip containers that merely wrap other rows.
      if (row.querySelector(ROW_SELECTOR)) continue;

      const found = identify(row);
      if (!found) continue;

      seen.add(row);
      out.push({ element: row, threadKey: found.key, label: found.label });
    }
    return out;
  },

  observeRoots() {
    const list = document.querySelector('gv-conversation-list, gv-thread-list, [role="list"]');
    return list ? [list] : [];
  },

  activeThread() {
    // The open conversation's recipient appears in the message header.
    const header = document.querySelector<HTMLElement>(
      'gv-message-list-header, [class*="conversation-header"], header',
    );
    if (!header) return null;

    const text = header.textContent ?? '';
    const aria = header.getAttribute('aria-label') ?? '';
    const phoneMatch = (aria + ' ' + text).match(PHONE_TEXT);
    const key = keyFromPhone(phoneMatch?.[1]);

    const nameEl = header.querySelector<HTMLElement>('[class*="recipient"], [class*="name"]');
    const label =
      nameEl?.textContent?.trim().slice(0, 120) ??
      (phoneMatch ? phoneMatch[1].trim() : null);

    if (key) return { threadKey: key, label };
    if (label) return { threadKey: `gv:name:${label.toLowerCase()}`, label };
    return null;
  },
};
