import { instagramAdapter } from './instagram';
import { googleVoiceAdapter } from './googlevoice';
import { gmailAdapter, outlookAdapter } from './gmail';
import type { Adapter } from './types';

export const ADAPTERS: Adapter[] = [
  instagramAdapter,
  googleVoiceAdapter,
  gmailAdapter,
  outlookAdapter,
];

/** Returns the adapter for the current page, or null if TeamHue is a no-op here. */
export function activeAdapter(): Adapter | null {
  return ADAPTERS.find((a) => a.matches()) ?? null;
}

export type { Adapter, ThreadTarget } from './types';
