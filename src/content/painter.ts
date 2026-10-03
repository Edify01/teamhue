import { initialsOf, readableTextOn, withAlpha } from '@/shared/color';
import type { AssignmentLite, Settings } from '@/shared/types';
import type { ThreadTarget } from './adapters';

/**
 * Applies and removes the visual treatment on conversation rows.
 *
 * Design goals:
 *  • Zero layout shift — we only set background/box-shadow and absolutely
 *    positioned pseudo-content, never margin/padding/width.
 *  • Idempotent — re-painting an already-correct row does nothing, so the
 *    MutationObserver loop stays cheap even on huge lists.
 *  • Fully reversible — `clearAll()` restores the page to pristine state.
 */

const PAINTED_ATTR = 'data-th-key';
const SIG_ATTR = 'data-th-sig';
const CHIP_CLASS = 'th-chip';

const painted = new Set<HTMLElement>();

function signature(a: AssignmentLite, s: Settings): string {
  return [
    a.color,
    s.intensity,
    s.showAccentBar ? 1 : 0,
    s.showInitials ? 1 : 0,
    a.memberName ?? '',
  ].join('|');
}

function removeChip(el: HTMLElement) {
  const chip = el.querySelector(`:scope > .${CHIP_CLASS}`);
  if (chip) chip.remove();
}

function ensureChip(el: HTMLElement, color: string, name: string) {
  let chip = el.querySelector<HTMLElement>(`:scope > .${CHIP_CLASS}`);
  if (!chip) {
    chip = document.createElement('span');
    chip.className = CHIP_CLASS;
    chip.setAttribute('aria-hidden', 'true');
    el.appendChild(chip);
  }
  const initials = initialsOf(name);
  if (chip.textContent !== initials) chip.textContent = initials;
  chip.style.setProperty('--th-chip-bg', color);
  chip.style.setProperty('--th-chip-fg', readableTextOn(color));
  chip.title = `TeamHue — ${name}`;
}

/** Paints one row. Returns true when a change was actually made. */
export function paint(target: ThreadTarget, assignment: AssignmentLite, settings: Settings): boolean {
  const el = target.element;
  const sig = signature(assignment, settings);

  if (el.getAttribute(SIG_ATTR) === sig && el.getAttribute(PAINTED_ATTR) === assignment.threadKey) {
    return false;
  }

  el.setAttribute(PAINTED_ATTR, assignment.threadKey);
  el.setAttribute(SIG_ATTR, sig);
  el.classList.add('th-painted');

  // The row needs a positioning context for the accent bar + chip.
  const position = getComputedStyle(el).position;
  if (position === 'static') el.classList.add('th-relative');

  el.style.setProperty('--th-color', assignment.color);
  el.style.setProperty('--th-wash', withAlpha(assignment.color, settings.intensity));
  el.style.setProperty('--th-wash-hover', withAlpha(assignment.color, Math.min(1, settings.intensity + 0.1)));
  el.style.setProperty('--th-bar-width', settings.showAccentBar ? '4px' : '0px');

  if (settings.showInitials && assignment.memberName) {
    ensureChip(el, assignment.color, assignment.memberName);
  } else {
    removeChip(el);
  }

  const who = assignment.memberName ?? 'Assigned';
  const note = assignment.note ? ` — ${assignment.note}` : '';
  el.setAttribute('data-th-tooltip', `${who}${note}`);

  painted.add(el);
  return true;
}

/** Removes TeamHue styling from a single element. */
export function unpaint(el: HTMLElement) {
  el.classList.remove('th-painted', 'th-relative');
  el.removeAttribute(PAINTED_ATTR);
  el.removeAttribute(SIG_ATTR);
  el.removeAttribute('data-th-tooltip');
  el.style.removeProperty('--th-color');
  el.style.removeProperty('--th-wash');
  el.style.removeProperty('--th-wash-hover');
  el.style.removeProperty('--th-bar-width');
  removeChip(el);
  painted.delete(el);
}

/**
 * Rows are recycled aggressively by virtualized lists. Any element we painted
 * that is no longer assigned (or no longer in the DOM) must be cleaned up,
 * otherwise a recycled node shows the previous conversation's color.
 */
export function reconcile(stillPainted: Set<HTMLElement>) {
  for (const el of Array.from(painted)) {
    if (!stillPainted.has(el) || !el.isConnected) unpaint(el);
  }
}

export function clearAll() {
  for (const el of Array.from(painted)) unpaint(el);
  painted.clear();
  // Safety net for nodes that lost their reference (e.g. after a SPA re-render).
  document.querySelectorAll<HTMLElement>(`[${PAINTED_ATTR}]`).forEach(unpaint);
}

export function paintedCount(): number {
  return painted.size;
}
