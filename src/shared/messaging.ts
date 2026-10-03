import type { AssignmentLite, AuthState, Member, Platform, Settings, Workspace } from './types';

/**
 * Strongly-typed message bus between content scripts / popup / options and the
 * background service worker. Every request has exactly one response shape.
 */

export type Request =
  | { type: 'GET_STATE' }
  | { type: 'SIGN_IN'; email: string; password: string }
  | { type: 'SIGN_UP'; email: string; password: string; displayName: string }
  | { type: 'SIGN_OUT' }
  | { type: 'CREATE_WORKSPACE'; name: string; displayName: string }
  | { type: 'JOIN_WORKSPACE'; joinCode: string; displayName: string }
  | { type: 'LEAVE_WORKSPACE' }
  | { type: 'LIST_MEMBERS' }
  | { type: 'UPDATE_MEMBER'; memberId: string; displayName?: string; color?: string }
  | { type: 'REMOVE_MEMBER'; memberId: string }
  | { type: 'LIST_ASSIGNMENTS' }
  | {
      type: 'SET_ASSIGNMENT';
      platform: Platform;
      threadKey: string;
      threadLabel: string | null;
      color: string | null;
      memberId: string | null;
      note: string | null;
    }
  | { type: 'CLEAR_ASSIGNMENT'; platform: Platform; threadKey: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; settings: Partial<Settings> }
  | { type: 'FORCE_SYNC' }
  | { type: 'OPEN_OPTIONS' };

export interface StatePayload {
  auth: AuthState;
  settings: Settings;
  members: Member[];
  assignments: AssignmentLite[];
  configured: boolean;
  lastSync: number | null;
}

export type Response<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Broadcast sent to every tab whenever data changes. */
export interface BroadcastMessage {
  type: 'TH_UPDATE';
  assignments: AssignmentLite[];
  settings: Settings;
  members: Member[];
  signedIn: boolean;
}

export async function send<T = unknown>(req: Request): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as Response<T> | undefined;
  if (!res) throw new Error('No response from TeamHue background service.');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export type { AuthState, Member, Workspace, Settings, AssignmentLite, Platform };
