import { Injectable, signal, computed } from '@angular/core';

const ACCESS_TOKEN_KEY = 'va2.access_token';
const ORG_ID_KEY = 'va2.org_id';

export type OrgRole = 'org_admin' | 'campaign_manager' | 'user';

export interface Membership {
  org_id: string;
  org_name: string;
  role: OrgRole;
}

export interface Me {
  user_id: string;
  email: string;
  platform_admin: boolean;
  /** Independent of platform_admin and of org role — see AgentAdminGuard
   * (voxlix-dataload). Grants access to the Agents page, nothing else. */
  agent_admin: boolean;
  memberships: Membership[];
}

export interface OrgUser {
  user_id: string;
  email: string;
  role: OrgRole;
  /** Both global, not org-scoped — see AgentAdminGuard/PlatformAdminGuard
   * (voxlix-dataload). platform_admin is read-only here — there's no toggle
   * for it, it's shown only so the UI can hide the agent_admin checkbox for
   * someone who already has full access regardless of that flag. */
  agent_admin: boolean;
  platform_admin: boolean;
}

export interface Group {
  group_id: string;
  org_id: string;
  name: string;
  created_by: string;
  member_ids: string[];
}

/**
 * The one login credential for both backends — voxlix-backend verifies the
 * same JWT voxlix-dataload issues, so there's nothing console-specific to
 * hold here (there used to be a second, separate console token, back when
 * voxlix-backend only understood the shared WEB_TEST_TOKEN).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly accessToken = signal(localStorage.getItem(ACCESS_TOKEN_KEY) || '');
  readonly currentOrgId = signal(localStorage.getItem(ORG_ID_KEY) || '');
  readonly me = signal<Me | null>(null);

  readonly isAuthenticated = computed(() => this.accessToken().length > 0);
  readonly currentMembership = computed(
    () => this.me()?.memberships.find((m) => m.org_id === this.currentOrgId()) || null,
  );

  setAccessToken(value: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, value || '');
    this.accessToken.set(value || '');
  }

  setCurrentOrg(orgId: string): void {
    localStorage.setItem(ORG_ID_KEY, orgId || '');
    this.currentOrgId.set(orgId || '');
  }

  setMe(me: Me | null): void {
    this.me.set(me);
    // A workspace remembered from someone else's session on this browser, or one
    // this user has lost access to, falls back to their first workspace.
    const ids = me?.memberships.map((m) => m.org_id) || [];
    if (ids.length && !ids.includes(this.currentOrgId())) this.setCurrentOrg(ids[0]);
  }

  signOut(): void {
    this.setAccessToken('');
    this.setCurrentOrg('');
    this.setMe(null);
  }
}
