import type { Adapter, ThreadTarget } from './types';
import { expandToRow, dedupe, cleanLabel } from './dom';

/**
 * Instagram Direct adapter.
 *
 * Instagram's class names are auto-generated and change constantly, so we never
 * rely on them. Instead we anchor on the one thing that is stable and semantic:
 * every conversation row in the inbox links to `/direct/t/<threadId>/`.
 *
 * Note: thread ids are NOT always numeric. Instagram serves both legacy numeric
 * ids and newer alphanumeric ids, so the pattern must accept both.
 */

const THREAD_HREF = /\/direct\/t\/([A-Za-z0-9._-]+)/;

function threadIdFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = href.match(THREAD_HREF);
  if (!m) return null;
  const id = m[1];
  // Guard against sub-routes like /direct/t/new
  if (id === 'new' || id.length < 2) return null;
  return id;
}

/** Reads the participant name from a row without touching message content. */
function labelFor(anchor: HTMLElement): string | null {
  const aria = cleanLabel(anchor.getAttribute('aria-label'));
  if (aria) return aria;

  const spans = anchor.querySelectorAll<HTMLElement>('span[dir="auto"], span');
  for (const span of Array.from(spans).slice(0, 6)) {
    const text = cleanLabel(span.textContent, 80);
    // Skip relative timestamps ("2h", "3w") and empties.
    if (text && !/^\d+\s*[smhdw]$/i.test(text)) return text;
  }
  return null;
}

/**
 * Instagram sometimes renders inbox rows as `div[role="button"]` instead of
 * anchors (newer inbox + optimistic updates). We handle both shapes so the
 * extension survives their A/B rollouts.
 */
function candidateAnchors(): Array<{ el: HTMLElement; id: string }> {
  const found: Array<{ el: HTMLElement; id: string }> = [];

  document.querySelectorAll<HTMLAnchorElement>('a[href*="/direct/t/"]').forEach((a) => {
    const id = threadIdFromHref(a.getAttribute('href'));
    if (id) found.push({ el: a, id });
  });

  if (found.length === 0) {
    document
      .querySelectorAll<HTMLElement>('[data-thread-id], [data-testid*="thread"]')
      .forEach((el) => {
        const id = el.getAttribute('data-thread-id');
        if (id && id.length > 1) found.push({ el, id });
      });
  }

  return found;
}

export const instagramAdapter: Adapter = {
  platform: 'instagram',

  matches() {
    return /(^|\.)instagram\.com$/.test(location.hostname);
  },

  findThreads(): ThreadTarget[] {
    const out: ThreadTarget[] = [];

    for (const { el, id } of candidateAnchors()) {
      // Ignore links inside the open conversation pane, which would otherwise
      // paint the message area rather than an inbox row.
      if (el.closest('[role="dialog"]')) continue;

      const row = expandToRow(el);
      if (!row || row.getBoundingClientRect().height === 0) continue;

      out.push({
        element: row,
        threadKey: `ig:${id}`,
        label: labelFor(el),
      });
    }

    return dedupe(out);
  },

  observeRoots() {
    // The inbox list lives under the main region; observing it instead of the
    // whole body dramatically reduces mutation noise from the message pane.
    const main = document.querySelector('main') ?? document.querySelector('[role="main"]');
    return main ? [main] : [];
  },

  activeThread() {
    const id = threadIdFromHref(location.pathname);
    if (!id) return null;

    let label: string | null = null;
    const header =
      document.querySelector<HTMLElement>('[role="main"] header') ??
      document.querySelector<HTMLElement>('header');
    if (header) label = cleanLabel(header.textContent);

    return { threadKey: `ig:${id}`, label };
  },
};
