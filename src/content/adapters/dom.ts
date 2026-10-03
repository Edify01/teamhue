import type { ThreadTarget } from './types';

/**
 * Shared helpers for locating the *full* conversation row.
 *
 * All three sites wrap each conversation in several nested layout divs. Painting
 * the innermost one only tints a fragment (e.g. the message preview text), which
 * looks broken. These helpers climb to the element that actually spans the whole
 * list — the "contact box" the user expects to light up.
 */

/** The widest sensible container for a conversation list on this page. */
function listWidth(el: HTMLElement): number {
  const list = el.closest<HTMLElement>('[role="list"], [role="grid"], [role="listbox"], ul, table');
  if (list) return list.getBoundingClientRect().width;
  const main = document.querySelector<HTMLElement>('[role="main"], main');
  return main ? main.getBoundingClientRect().width : window.innerWidth;
}

/**
 * Climbs from `start` to the ancestor that represents the entire row.
 *
 * Strategy: prefer a semantic container (`role="listitem"`, `<li>`, `<tr>`).
 * Otherwise walk up while the element keeps getting wider, stopping as soon as
 * it covers most of the list width — that's the full contact box. We never
 * climb past a node that is clearly the scroll container (very tall).
 */
export function expandToRow(start: HTMLElement, maxHops = 8): HTMLElement {
  const semantic = start.closest<HTMLElement>('[role="listitem"], [role="row"], li, tr');
  if (semantic) return semantic;

  const target = listWidth(start) * 0.75;
  let node = start;
  let best = start;

  for (let i = 0; i < maxHops; i += 1) {
    const parent = node.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) break;

    const rect = parent.getBoundingClientRect();

    // A very tall ancestor is the scrolling list, not a row — stop before it.
    if (rect.height > 160) break;

    best = parent;
    node = parent;

    // Wide enough to be the full row: done.
    if (rect.width >= target) break;
  }

  return best;
}

/** Deduplicates targets, keeping the outermost element when rows nest. */
export function dedupe(targets: ThreadTarget[]): ThreadTarget[] {
  const out: ThreadTarget[] = [];
  const seenEls = new Set<HTMLElement>();
  const seenKeys = new Set<string>();

  for (const t of targets) {
    if (seenEls.has(t.element)) continue;

    // If an already-accepted row contains this one (or vice versa), keep the outer.
    const nestedInside = out.find((o) => o.element.contains(t.element));
    if (nestedInside) continue;

    const containsExisting = out.findIndex((o) => t.element.contains(o.element));
    if (containsExisting !== -1) {
      out.splice(containsExisting, 1, t);
      seenEls.add(t.element);
      continue;
    }

    // One row per thread key per pass — prevents a single click colouring
    // several visually distinct rows.
    if (seenKeys.has(t.threadKey)) continue;

    seenEls.add(t.element);
    seenKeys.add(t.threadKey);
    out.push(t);
  }

  return out;
}

/** Trims noisy whitespace and caps length for display labels. */
export function cleanLabel(raw: string | null | undefined, max = 120): string | null {
  if (!raw) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}
