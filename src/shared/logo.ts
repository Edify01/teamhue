/**
 * TeamHue logo — single source of truth.
 *
 * Concept: three teammates (circles) orbiting one shared inbox (the blue tile).
 * Where their colours overlap they blend toward white — many people, one clear
 * picture. Geometry is mirrored in scripts/make-icons.mjs for the PNG icons.
 */

export const LOGO_COLORS = {
  tileFrom: '#2563eb',
  tileTo: '#1e3a8a',
  orbs: ['#22d3ee', '#a78bfa', '#fb7185'],
} as const;

/** Orb centres on a 64×64 canvas: triangle around the middle, radius 8. */
export const LOGO_ORBS = [
  { cx: 32, cy: 23.5, color: LOGO_COLORS.orbs[0] },
  { cx: 39.4, cy: 36.3, color: LOGO_COLORS.orbs[1] },
  { cx: 24.6, cy: 36.3, color: LOGO_COLORS.orbs[2] },
] as const;
export const LOGO_ORB_RADIUS = 13;

let uid = 0;

/** Inline SVG markup for the logo. `size` is in CSS pixels. */
export function logoSvg(size = 32, className = 'th-logo'): string {
  const id = `thl${(uid += 1)}`;
  const orbs = LOGO_ORBS.map(
    (o) =>
      `<circle cx="${o.cx}" cy="${o.cy}" r="${LOGO_ORB_RADIUS}" fill="${o.color}" fill-opacity=".92" style="mix-blend-mode:screen"/>`,
  ).join('');
  return (
    `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="TeamHue" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${LOGO_COLORS.tileFrom}"/><stop offset="1" stop-color="${LOGO_COLORS.tileTo}"/>` +
    `</linearGradient></defs>` +
    `<rect width="64" height="64" rx="16" fill="url(#${id})"/>` +
    `<g class="th-logo-orbs" style="isolation:isolate">${orbs}</g>` +
    `</svg>`
  );
}
