import type { Platform } from '@/shared/types';

/**
 * A single conversation row discovered in the page.
 */
export interface ThreadTarget {
  /** The element that receives the tint (usually the whole clickable row). */
  element: HTMLElement;
  /** Stable, non-sensitive identifier. Must be identical for every teammate. */
  threadKey: string;
  /** Best-effort human label (name / handle / phone). Never message content. */
  label: string | null;
  /** True when this is the open conversation's header rather than a list row. */
  isHeader?: boolean;
}

export interface Adapter {
  platform: Platform;
  /** Does this adapter apply to the current page? */
  matches(): boolean;
  /** Find every conversation row currently in the DOM. */
  findThreads(): ThreadTarget[];
  /** Root node(s) to observe for mutations. Falls back to document.body. */
  observeRoots?(): Element[];
  /**
   * Where to anchor the floating "paint" button for the *open* conversation.
   * Returning null simply hides the inline button on that page.
   */
  activeThread?(): { threadKey: string; label: string | null } | null;
}
