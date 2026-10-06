/**
 * Shared domain types for TeamHue.
 * These mirror the Postgres schema in `supabase/schema.sql` exactly.
 */

export type Platform = 'instagram' | 'googlevoice' | 'gmail' | 'outlook';

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  googlevoice: 'Google Voice',
  gmail: 'Gmail',
  outlook: 'Outlook',
};

/** A workspace groups a team together. All data is scoped to one. */
export interface Workspace {
  id: string;
  name: string;
  /** Short human-friendly code teammates use to join, e.g. `BRIGHT-OTTER-42`. */
  join_code: string;
  created_at: string;
}

export type MemberRole = 'owner' | 'admin' | 'member';

export interface Member {
  id: string;
  workspace_id: string;
  user_id: string;
  display_name: string;
  /** Hex color used as this member's signature tint. */
  color: string;
  role: MemberRole;
  created_at: string;
}

/**
 * The core record: "this conversation is owned by this color/person".
 * `thread_key` is a platform-stable identifier produced by the adapters.
 */
export interface Assignment {
  id: string;
  workspace_id: string;
  platform: Platform;
  thread_key: string;
  /** Display-only; helps the dashboard stay readable. Never message content. */
  thread_label: string | null;
  color: string;
  note: string | null;
  member_id: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

/** The compact shape the content script actually consumes. */
export interface AssignmentLite {
  threadKey: string;
  platform: Platform;
  color: string;
  label: string | null;
  note: string | null;
  memberName: string | null;
}

export interface AuthState {
  status: 'signed-out' | 'signed-in';
  userId: string | null;
  email: string | null;
  workspace: Workspace | null;
  member: Member | null;
}

export interface Settings {
  /** Master on/off switch. */
  enabled: boolean;
  /** Per-platform toggles. */
  platforms: Record<Platform, boolean>;
  /** 0..1 — how strongly the tint washes over the row. */
  intensity: number;
  /** Show the colored accent bar on the left edge of each row. */
  showAccentBar: boolean;
  /** Show the assignee's initials chip on each row. */
  showInitials: boolean;
  /** Also tint the open conversation header. */
  tintHeader: boolean;
  /** Show the floating paintbrush button inside open conversations. */
  showFab: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  platforms: { instagram: true, googlevoice: true, gmail: true, outlook: true },
  intensity: 0.16,
  showAccentBar: true,
  showInitials: true,
  tintHeader: true,
  showFab: true,
};

/** chrome.storage.local keys. */
export const STORAGE_KEYS = {
  auth: 'th:auth',
  session: 'th:session',
  settings: 'th:settings',
  cache: 'th:cache',
  members: 'th:members',
  lastSync: 'th:lastSync',
} as const;

/** Payload mirrored into chrome.storage.local for instant content-script reads. */
export interface CachePayload {
  assignments: AssignmentLite[];
  updatedAt: number;
}
