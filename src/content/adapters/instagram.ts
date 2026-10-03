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
 * Collects every element that identifies a conversation.
 *
 * Instagram ships several inbox variants concurrently (A/B rollouts), so we try
 * anchors first, then data attributes, and never rely on generated class names.
 */
function candidateAnchors(): Array<{ el: HTMLElement; id: string }> {
  const found: Array<{ el: HTMLElement; id: string }> = [];
  const seen = new Set<string>();

  const push = (el: HTMLElement, id: string) => {
    // One entry per thread id; the first (outermost in document order) wins.
    if (seen.has(id)) return;
    seen.add(id);
    found.push({ el, id });
  };

  document.querySelectorAll<HTMLAnchorElement>('a[href*="/direct/t/"]').forEach((a) => {
    const id = threadIdFromHref(a.getAttribute('href'));
    if (id) push(a, id);
  });

  document
    .querySelectorAll<HTMLElement>('[data-thread-id], [data-testid*="thread"]')
    .forEach((el) => {
      const id = el.getAttribute('data-thread-id');
      if (id && id.length > 1) push(el, id);
    });

  return found;
}

/**
 * True when the element is the currently-open conversation's own header link
 * rather than an inbox row.
 *
 * We deliberately do NOT exclude `[role="dialog"]`: Instagram renders the whole
 * messaging surface inside a dialog in several layouts, so that test threw away
 * every single inbox row and the left-hand list never got painted.
 */
function isOpenThreadHeader(el: HTMLElement, id: string): boolean {
  const active = location.pathname.match(THREAD_HREF)?.[1];
  if (active !== id) return false;
  // The inbox row for the open thread still lives in the list; only treat this
  // element as the header when it sits outside any list-like container.
  return !el.closest('[role="list"], [role="listbox"], [role="grid"], ul');
}

export const instagramAdapter: Adapter = {
  platform: 'instagram',

  matches() {
    return /(^|\.)instagram\.com$/.test(location.hostname);
  },

  findThreads(): ThreadTarget[] {
    const out: ThreadTarget[] = [];

    for (const { el, id } of candidateAnchors()) {
      if (isOpenThreadHeader(el, id)) continue;

      const row = expandToRow(el);
      if (!row) continue;

      // Skip genuinely invisible rows, but tolerate ones that are merely
      // scrolled out of view (height is still non-zero for those).
      const rect = row.getBoundingClientRect();
      if (rect.height === 0 || rect.width === 0) continue;

      out.push({
        element: row,
        threadKey: `ig:${id}`,
        label: labelFor(el),
      });
    }

    return dedupe(out);
  },

  observeRoots() {
    // Observe the messaging surface rather than the whole body to cut mutation
    // noise. `main` is absent in the dialog-based layout, so fall back widely.
    const root =
      document.querySelector('[role="main"]') ??
      document.querySelector('main') ??
      document.querySelector('[role="dialog"]');
    return root ? [root] : [];
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
