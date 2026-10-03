import type { Adapter, ThreadTarget } from './types';

/**
 * Instagram Direct adapter.
 *
 * Instagram's class names are auto-generated and change constantly, so we never
 * rely on them. Instead we anchor on the one thing that is stable and semantic:
 * every conversation row in the inbox is an anchor whose href matches
 * `/direct/t/<threadId>/`. That numeric thread id is identical for every
 * teammate, which is exactly what we need for shared color coding.
 */

const THREAD_HREF = /\/direct\/t\/(\d+)/;

function threadIdFromHref(href: string | null): string | null {
  if (!href) return null;
  const m = href.match(THREAD_HREF);
  return m ? m[1] : null;
}

/**
 * Walks up from the anchor to the element that visually represents the row.
 * Instagram wraps each row in a few layout divs; we stop at the list item
 * (role="listitem" / role="row") or the nearest reasonably sized ancestor.
 */
function rowFor(anchor: HTMLElement): HTMLElement {
  const semantic = anchor.closest<HTMLElement>('[role="listitem"], [role="row"], li');
  if (semantic) return semantic;

  let node: HTMLElement = anchor;
  for (let i = 0; i < 4; i += 1) {
    const parent = node.parentElement;
    if (!parent || parent === document.body) break;
    // Stop climbing once the ancestor spans the full list width — that's the row.
    if (parent.getBoundingClientRect().height > 100) break;
    node = parent;
  }
  return node;
}

function labelFor(anchor: HTMLElement): string | null {
  // The row's accessible name is the participant name — ideal and stable-ish.
  const aria = anchor.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim().slice(0, 120);

  // Otherwise the first meaningful span is the display name.
  const spans = anchor.querySelectorAll<HTMLElement>('span[dir="auto"], span');
  for (const span of Array.from(spans).slice(0, 6)) {
    const text = span.textContent?.trim();
    if (text && text.length > 0 && text.length < 80 && !/^\d+[smhdw]$/.test(text)) {
      return text.slice(0, 120);
    }
  }
  return null;
}

export const instagramAdapter: Adapter = {
  platform: 'instagram',

  matches() {
    return /(^|\.)instagram\.com$/.test(location.hostname);
  },

  findThreads(): ThreadTarget[] {
    const out: ThreadTarget[] = [];
    const seen = new Set<HTMLElement>();

    const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href*="/direct/t/"]');
    for (const anchor of Array.from(anchors)) {
      const id = threadIdFromHref(anchor.getAttribute('href'));
      if (!id) continue;

      const row = rowFor(anchor);
      if (seen.has(row)) continue;
      seen.add(row);

      out.push({
        element: row,
        threadKey: `ig:${id}`,
        label: labelFor(anchor),
      });
    }
    return out;
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

    // Header name of the currently open thread.
    let label: string | null = null;
    const header =
      document.querySelector<HTMLElement>('[role="main"] header') ??
      document.querySelector<HTMLElement>('header');
    if (header) {
      const text = header.textContent?.trim();
      if (text) label = text.slice(0, 120);
    }
    return { threadKey: `ig:${id}`, label };
  },
};
