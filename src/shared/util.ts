/**
 * Tiny helpers shared across all surfaces.
 */

/** Trailing-edge debounce. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => timer && clearTimeout(timer);
  return wrapped;
}

/** Coalesces bursty calls into one run per animation frame. */
export function rafThrottle(fn: () => void) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

/** Exponential backoff with jitter — used for network retries. */
export function backoffDelay(attempt: number, base = 500, cap = 30_000): number {
  const exp = Math.min(cap, base * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Normalizes a phone number to E.164-ish digits so `(661) 555-1234` === `+16615551234`. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  const bare = digits.replace(/\D/g, '');
  if (bare.length < 7) return null;
  if (digits.startsWith('+')) return `+${bare}`;
  if (bare.length === 10) return `+1${bare}`;
  if (bare.length === 11 && bare.startsWith('1')) return `+${bare}`;
  return `+${bare}`;
}

export function normalizeEmail(raw: string): string | null {
  const match = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return match ? match[0].toLowerCase() : null;
}

/** Human-readable "3 minutes ago". */
export function timeAgo(ts: number | string | null): string {
  if (!ts) return 'never';
  const then = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(then)) return 'never';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Generates a readable join code like `BRIGHT-OTTER-42`. */
const ADJ = ['BRIGHT', 'SWIFT', 'CALM', 'BOLD', 'CLEAR', 'WARM', 'KEEN', 'LUCID'];
const NOUN = ['OTTER', 'FALCON', 'CEDAR', 'RIVER', 'EMBER', 'ORBIT', 'MAPLE', 'DELTA'];

export function generateJoinCode(): string {
  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  const num = Math.floor(Math.random() * 90 + 10);
  return `${pick(ADJ)}-${pick(NOUN)}-${num}`;
}

/** Turns unknown thrown values into a safe display string. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unexpected error';
  }
}
