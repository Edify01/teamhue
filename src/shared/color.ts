/**
 * Color utilities — all pure, no DOM access, safe to use anywhere.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A curated, accessible palette. Hand-tuned to stay readable on light and dark UIs. */
export const PALETTE: { name: string; hex: string }[] = [
  { name: 'Coral', hex: '#FF6B6B' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Citron', hex: '#C3D600' },
  { name: 'Mint', hex: '#10B981' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Sky', hex: '#0EA5E9' },
  { name: 'Indigo', hex: '#6366F1' },
  { name: 'Violet', hex: '#8B5CF6' },
  { name: 'Fuchsia', hex: '#D946EF' },
  { name: 'Rose', hex: '#F43F5E' },
  { name: 'Slate', hex: '#64748B' },
  { name: 'Bronze', hex: '#A16207' },
];

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

/** Normalizes `fff`, `#fff`, `FFFFFF` → `#ffffff`. Returns null when invalid. */
export function normalizeHex(value: string): string | null {
  const raw = value.trim().replace(/^#/, '');
  if (!HEX_RE.test(raw)) return null;
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return `#${full.toLowerCase()}`;
}

export function hexToRgb(hex: string): Rgb {
  const norm = normalizeHex(hex) ?? '#000000';
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Relative luminance per WCAG 2.1. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Picks black or white text for maximum legibility on `bg`.
 * Used for the initials chips so they are always readable.
 */
export function readableTextOn(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111') ? '#ffffff' : '#111111';
}

/** Produces `rgba(r, g, b, alpha)` — used for the soft row wash. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
}

/** Deterministically derives a pleasant color from any string (for auto-assign). */
export function colorFromString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length].hex;
}

/** `Angel Rodriguez` → `AR`; `support@acme.com` → `SU`. Always 1–2 chars. */
export function initialsOf(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
