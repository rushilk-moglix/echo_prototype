import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, Group, Me, OrgRole, OrgUser } from './auth.service';
import { API_BASE, ENDPOINTS, WEBRTC_BASE } from '../core/endpoints';

/**
 * The only thing in the app that talks to the backend.
 *
 * URLs and the host both come from core/endpoints.ts, so neither a path nor a
 * hostname appears anywhere else. Every call carries the same access token —
 * both backends verify it the same way — plus the current org id, which
 * voxlix-backend simply ignores since it has no tenant concept of its own.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private auth = inject(AuthService);
  private router = inject(Router);
  /** Set once the session-expiry redirect has fired, so a burst of requests that
   * all 401 together (e.g. every widget on a page refetching at once) triggers
   * exactly one sign-out and one navigation instead of one per request. */
  private loggingOut = false;

  /**
   * A 401 mid-session means the token expired or was revoked — every page just
   * showed that as a raw "HTTP 401" banner and left the stale token in place
   * (see auth.service.ts's signOut()). Login's own 401 (wrong password) must
   * NOT trigger this: isAuthenticated() is false at that point since there is
   * no token yet, so it falls through to the normal error banner on the login
   * form instead.
   */
  private checkUnauthorized(res: Response): void {
    if (res.status !== 401 || !this.auth.isAuthenticated() || this.loggingOut) return;
    this.loggingOut = true;
    this.auth.signOut();
    this.router.navigate(['/login']);
  }

  /** Absolute base URL of the API. See API_BASE in core/endpoints.ts. */
  readonly apiBase = API_BASE;
  /** Absolute base URL for /webrtc/* routes. See WEBRTC_BASE in core/endpoints.ts. */
  readonly webrtcBase = WEBRTC_BASE;

  /** Absolute URL for an endpoint path, with the access token and any query params. */
  private apiUrl(path: string, params: Record<string, string> = {}, base: string = this.apiBase): string {
    const url = new URL(base + path, base || window.location.origin);
    url.searchParams.set('token', this.auth.accessToken());
    if (this.auth.currentOrgId()) url.searchParams.set('org_id', this.auth.currentOrgId());
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
    return url.toString();
  }

  private async getJSON<T = any>(
    path: string,
    params: Record<string, string> = {},
    base?: string,
  ): Promise<T> {
    const res = await fetch(this.apiUrl(path, params, base));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.checkUnauthorized(res);
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return body;
  }

  private async sendJSON<T = any>(
    path: string,
    method: string,
    payload?: any,
    params: Record<string, string> = {},
  ): Promise<T> {
    const res = await fetch(this.apiUrl(path, params), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.checkUnauthorized(res);
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return body;
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  login(email: string, password: string): Promise<{ access_token: string; user_id: string }> {
    return this.sendJSON(ENDPOINTS.auth.login, 'POST', { email, password });
  }

  /** Every org the signed-in user belongs to — how the app discovers which one(s) to offer. */
  me(): Promise<Me> {
    return this.getJSON(ENDPOINTS.me);
  }

  // ── Org admin: users & groups ────────────────────────────────────────────────
  // org_admin-only server-side; orgId here is always the current org, sent for
  // routing only — the backend re-checks it against the caller's own membership.

  orgUsers(orgId: string): Promise<OrgUser[]> {
    return this.getJSON(ENDPOINTS.org.users(orgId));
  }
  inviteOrgUser(orgId: string, email: string, password: string, role: OrgRole): Promise<OrgUser> {
    return this.sendJSON(ENDPOINTS.org.users(orgId), 'POST', { email, password, role });
  }
  updateOrgUserRole(orgId: string, userId: string, role: OrgRole): Promise<OrgUser> {
    return this.sendJSON(ENDPOINTS.org.userRole(orgId, userId), 'PATCH', { role });
  }
  removeOrgUser(orgId: string, userId: string): Promise<void> {
    return this.sendJSON(ENDPOINTS.org.removeUser(orgId, userId), 'DELETE');
  }

  /** Platform-admin-only, not org-scoped — see admin-users.controller.ts. */
  setUserAgentAdmin(userId: string, agentAdmin: boolean): Promise<OrgUser> {
    return this.sendJSON(ENDPOINTS.admin.setAgentAdmin(userId), 'PATCH', { agent_admin: agentAdmin });
  }

  orgGroups(orgId: string): Promise<Group[]> {
    return this.getJSON(ENDPOINTS.org.groups(orgId));
  }
  createOrgGroup(orgId: string, name: string): Promise<Group> {
    return this.sendJSON(ENDPOINTS.org.groups(orgId), 'POST', { name });
  }
  renameOrgGroup(orgId: string, groupId: string, name: string): Promise<Group> {
    return this.sendJSON(ENDPOINTS.org.group(orgId, groupId), 'PATCH', { name });
  }
  deleteOrgGroup(orgId: string, groupId: string): Promise<void> {
    return this.sendJSON(ENDPOINTS.org.group(orgId, groupId), 'DELETE');
  }
  addGroupMember(orgId: string, groupId: string, userId: string): Promise<Group> {
    return this.sendJSON(ENDPOINTS.org.groupMembers(orgId, groupId), 'POST', { userId });
  }
  removeGroupMember(orgId: string, groupId: string, userId: string): Promise<Group> {
    return this.sendJSON(ENDPOINTS.org.groupMember(orgId, groupId, userId), 'DELETE');
  }

  // ── Health & call history ──────────────────────────────────────────────────

  /** No token: this is what the shell polls to show the API as up or down. */
  health(): Promise<any> {
    return fetch(this.apiBase + ENDPOINTS.health).then((r) => r.json());
  }
  /** Backend's own /health — the `telephony` block (Ozonetel-credentials status) only
   *  exists there, not on dataload's /health, so Call Console reads this instead. */
  webrtcHealth(): Promise<any> {
    return fetch(this.webrtcBase + ENDPOINTS.health).then((r) => r.json());
  }
  metrics(days = 30, agent = ''): Promise<any> {
    return this.getJSON(ENDPOINTS.metrics, { days: String(days), agent });
  }
  // ── Reports and follow ups ─────────────────────────────────

  /** The Overview numbers split by campaign, agent, day or a column of the uploaded files. */
  reportSummary(params: Record<string, string> = {}): Promise<any> {
    return this.getJSON(ENDPOINTS.reports.summary, params);
  }
  /** The same report as a spreadsheet with five tabs. */
  reportExportUrl(params: Record<string, string> = {}): string {
    return this.apiUrl(ENDPOINTS.reports.exportXlsx, params);
  }
  reportSchedules(): Promise<any> {
    return this.getJSON(ENDPOINTS.reports.schedules);
  }
  createReportSchedule(body: any): Promise<any> {
    return this.sendJSON(ENDPOINTS.reports.schedules, 'POST', body);
  }
  updateReportSchedule(id: string, body: any): Promise<any> {
    return this.sendJSON(ENDPOINTS.reports.schedule(id), 'PATCH', body);
  }
  deleteReportSchedule(id: string): Promise<any> {
    return this.sendJSON(ENDPOINTS.reports.schedule(id), 'DELETE');
  }
  sendReportNow(id: string): Promise<any> {
    return this.sendJSON(ENDPOINTS.reports.sendNow(id), 'POST', {});
  }
  followUps(state: 'open' | 'done' = 'open'): Promise<any> {
    return this.getJSON(ENDPOINTS.followUps.list, { state });
  }
  updateFollowUp(campaignId: string, contactId: string, body: any): Promise<any> {
    return this.sendJSON(ENDPOINTS.followUps.one(campaignId, contactId), 'PATCH', body);
  }
  followUpCallAgain(campaignId: string, contactId: string, body: any = {}): Promise<any> {
    return this.sendJSON(ENDPOINTS.followUps.callAgain(campaignId, contactId), 'POST', body);
  }

  calls(params: Record<string, string> = {}): Promise<any> {
    return this.getJSON(ENDPOINTS.calls, params);
  }
  call(id: string): Promise<any> {
    return this.getJSON(ENDPOINTS.call(id));
  }
  /** Runs (or re-runs) LLM analysis for one call and returns the saved result. */
  analyzeCall(id: string): Promise<any> {
    return this.sendJSON(ENDPOINTS.analyzeCall(id), 'POST');
  }
  /** Newest in-flight call, transcript attached. Polled by the console on phone channels.
   *  Backend-only — it's tracking a call backend itself is driving, regardless of which
   *  service placed the outbound dial. See webrtcBase. */
  liveCall(source?: string): Promise<any> {
    return this.getJSON(ENDPOINTS.live, source ? { source } : {}, this.webrtcBase);
  }

  // ── Agents ─────────────────────────────────────────────────────────────────

  agents(): Promise<any> {
    return this.getJSON(ENDPOINTS.agents.forTester, {}, this.webrtcBase);
  }
  agentList(): Promise<any> {
    return this.getJSON(ENDPOINTS.agents.list);
  }
  agentMeta(): Promise<any> {
    return this.getJSON(ENDPOINTS.agents.meta);
  }
  agentDetail(key: string): Promise<any> {
    return this.getJSON(ENDPOINTS.agents.detail(key));
  }
  createAgent(body: any): Promise<any> {
    return this.sendJSON(ENDPOINTS.agents.create, 'POST', body);
  }
  updateAgent(key: string, body: any): Promise<any> {
    return this.sendJSON(ENDPOINTS.agents.update(key), 'PUT', body);
  }
  deleteAgent(key: string): Promise<any> {
    return this.sendJSON(ENDPOINTS.agents.remove(key), 'DELETE');
  }
  refreshAgents(): Promise<any> {
    return this.sendJSON(ENDPOINTS.agents.refresh, 'POST');
  }
  /** Prompt only. Voice is its own field on the agent — see updateAgent. */
  saveAgentSections(key: string, sections: any[]): Promise<any> {
    return this.sendJSON(ENDPOINTS.agents.sections(key), 'PUT', { sections });
  }
  agentGenerated(key: string): Promise<any> {
    return this.getJSON(ENDPOINTS.agents.generated(key));
  }
  saveAgentInputs(key: string, variables: any[]): Promise<any> {
    return this.sendJSON(ENDPOINTS.agents.inputs(key), 'PUT', { variables });
  }
  saveAgentOutputs(key: string, variables: any[]): Promise<any> {
    return this.sendJSON(ENDPOINTS.agents.outputs(key), 'PUT', { variables });
  }
  previewAgentPrompt(key: string, body: any): Promise<any> {
    return this.sendJSON(ENDPOINTS.agents.preview(key), 'POST', body);
  }
  /** Permanent once it succeeds — 409 if the agent is already synced. */
  syncAgent(key: string, platformKey: string): Promise<any> {
    return this.sendJSON(ENDPOINTS.agents.sync(key), 'POST', { platform_key: platformKey });
  }
  /** Enabled sync platforms for this org — empty means no third party, hide Sync entirely. */
  orgSyncPlatforms(orgId: string): Promise<{ platform_key: string; label: string }[]> {
    return this.getJSON(ENDPOINTS.org.syncPlatforms(orgId));
  }

  setSyncPlatform(orgId: string, key: string, body: { connected: boolean; url?: string }): Promise<any> {
    return this.sendJSON(ENDPOINTS.org.syncPlatform(orgId, key), 'PUT', body);
  }
  /** Workspace, telephony, calling defaults and data settings. */
  orgSettings(orgId: string): Promise<any> { return this.getJSON(ENDPOINTS.org.settings(orgId)); }
  saveOrgSettings(orgId: string, body: any): Promise<any> { return this.sendJSON(ENDPOINTS.org.settings(orgId), 'PUT', body); }
  /** Telephony providers and result destinations, each with its setup fields and checks. */
  integrations(orgId: string): Promise<any[]> { return this.getJSON(ENDPOINTS.org.integrations(orgId)); }
  /** Runs the integration's checks against the real service; a passing run returns a token that saving needs. */
  checkIntegration(orgId: string, key: string, config: Record<string, string>): Promise<any> { return this.sendJSON(ENDPOINTS.org.integrationCheck(orgId, key), 'POST', { config }); }
  saveIntegration(orgId: string, key: string, token: string): Promise<any> { return this.sendJSON(ENDPOINTS.org.integration(orgId, key), 'PUT', { token }); }
  setIntegrationEnabled(orgId: string, key: string, enabled: boolean): Promise<any> { return this.sendJSON(ENDPOINTS.org.integration(orgId, key), 'PATCH', { enabled }); }
  removeIntegration(orgId: string, key: string): Promise<any> { return this.sendJSON(ENDPOINTS.org.integration(orgId, key), 'DELETE'); }
  /** Every calling flow fetched from the workspace's telephony providers; only enabled ones reach agents. */
  telephonyFlows(orgId: string): Promise<any> { return this.getJSON(ENDPOINTS.org.flows(orgId)); }
  fetchFlows(orgId: string, provider: string): Promise<any> { return this.sendJSON(ENDPOINTS.org.fetchFlows(orgId, provider), 'POST', {}); }
  setFlowEnabled(orgId: string, name: string, enabled: boolean): Promise<any> { return this.sendJSON(ENDPOINTS.org.flow(orgId, name), 'PUT', { enabled }); }
  /** What is kept, where, and the outside rules (storage lock, lifecycle, provider copy) that limit it. */
  dataPolicy(orgId: string): Promise<any[]> { return this.getJSON(ENDPOINTS.org.dataPolicy(orgId)); }

  // ── Campaigns ──────────────────────────────────────────────────────────────

  campaigns(): Promise<any> {
    return this.getJSON(ENDPOINTS.campaigns.list);
  }
  campaign(id: string): Promise<any> {
    return this.getJSON(ENDPOINTS.campaigns.detail(id));
  }
  createCampaign(body: any): Promise<any> {
    return this.sendJSON(ENDPOINTS.campaigns.create, 'POST', body);
  }
  deleteCampaign(id: string): Promise<any> {
    return this.sendJSON(ENDPOINTS.campaigns.remove(id), 'DELETE');
  }
  campaignContacts(id: string): Promise<any> {
    return this.getJSON(ENDPOINTS.campaigns.contacts(id));
  }
  campaignResponses(id: string): Promise<any> {
    return this.getJSON(ENDPOINTS.campaigns.responses(id));
  }
  /** One contact's outputs, transcript and audio availability. */
  campaignContactDetail(id: string, primaryId: string): Promise<any> {
    return this.getJSON(ENDPOINTS.campaigns.contactDetail(id, primaryId));
  }
  dialCampaign(id: string): Promise<any> {
    return this.sendJSON(ENDPOINTS.campaigns.dial(id), 'POST');
  }
  stopCampaign(id: string): Promise<any> {
    return this.sendJSON(ENDPOINTS.campaigns.stop(id), 'POST');
  }

  /**
   * A real upload always dials — the backend has no store-only path.
   *
   * `mapping` is column name -> sheet column index, as confirmed by the operator
   * on the mapping screen. Omitted, the backend re-derives its own proposal.
   */
  /** Upload a file to an agent endpoint (check-file, references) with extra form fields. */
  async postFile(path: string, file: File, fields: Record<string, string> = {}): Promise<any> {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(this.apiUrl(path), { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { this.checkUnauthorized(res); throw new Error(body.error || `HTTP ${res.status}`); }
    return body;
  }
  /** Without a plan the agent's saved Input file settings are used. */
  checkAgentFile(key: string, file: File, plan?: any): Promise<any> {
    return this.postFile(ENDPOINTS.agents.checkFile(key), file, plan ? { plan: JSON.stringify(plan) } : {});
  }
  addAgentReference(key: string, file: File, scope: string): Promise<any> {
    return this.postFile(ENDPOINTS.agents.references(key), file, { scope });
  }
  removeAgentReference(key: string, id: string): Promise<any> {
    return this.sendJSON(ENDPOINTS.agents.reference(key, id), 'DELETE');
  }

  async uploadContacts(
    id: string,
    file: File,
    opts: { dryRun?: boolean; mapping?: Record<string, number | null> } = {},
  ): Promise<any> {
    const form = new FormData();
    form.append('file', file);
    if (opts.mapping) form.append('mapping', JSON.stringify(opts.mapping));
    const res = await fetch(
      this.apiUrl(ENDPOINTS.campaigns.upload(id), {
        dry_run: opts.dryRun ? 'true' : 'false',
      }),
      { method: 'POST', body: form },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.checkUnauthorized(res);
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return body;
  }

  // ── Telephony ──────────────────────────────────────────────────────────────

  ozonetelCampaigns(outboundOnly = true): Promise<any> {
    return this.getJSON(ENDPOINTS.ozonetel.campaigns, {
      outbound_only: outboundOnly ? 'true' : 'false',
    });
  }

  /** Place a call. Success is both HTTP 2xx and `status: "success"` in the body.
   *  'webrtc' is only ever backend-hosted — see webrtcBase. */
  async startCall(channel: string, body: any): Promise<any> {
    const base = channel === 'webrtc' ? this.webrtcBase : this.apiBase;
    const res = await fetch(this.apiUrl(ENDPOINTS.startCall(channel), {}, base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.status !== 'success') {
      this.checkUnauthorized(res);
      const detail = out.detail ? ` — ${JSON.stringify(out.detail)}` : '';
      throw new Error((out.error || `HTTP ${res.status}`) + detail);
    }
    return out;
  }

  // ── WebSocket & file URLs ──────────────────────────────────────────────────

  /**
   * The audio stream's WebSocket URL.
   *
   * Derived from webrtcBase so the socket follows the WebRTC host rather than the
   * page host — with an absolute webrtcBase those are different origins. WebSocket
   * upgrades are exempt from CORS, so no extra backend allowance is needed.
   */
  streamUrl(opts: {
    agent: string;
    provider: string;
    voice?: string;
    context?: Record<string, string>;
    /** Console-only override, native bridge only — omitted uses whatever the
     *  agent is configured for (today's exact behaviour). See webrtc.py's
     *  /stream `model` param; raw passthrough, no translation on either end. */
    model?: string;
    /** Silero VAD on/off for this call. Defaults true (today's behaviour);
     *  only sent when off, since "on" is the backend's own default too. */
    silero?: boolean;
  }): string {
    const url = new URL(ENDPOINTS.webrtc.stream, this.webrtcBase || window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', this.auth.accessToken());
    url.searchParams.set('agent', opts.agent);
    url.searchParams.set('provider', opts.provider);
    if (opts.voice) url.searchParams.set('voice', opts.voice);
    // Per-call input values as JSON. Omitted when empty so the backend falls back
    // to the agent's samples rather than being handed an empty context.
    if (opts.context && Object.keys(opts.context).length) {
      url.searchParams.set('context', JSON.stringify(opts.context));
    }
    if (opts.model) url.searchParams.set('model', opts.model);
    if (opts.silero === false) url.searchParams.set('vad', 'off');
    return url.toString();
  }

  recordingUrls(streamSid: string) {
    return {
      audio: this.apiUrl(ENDPOINTS.webrtc.recording(streamSid), {}, this.webrtcBase),
      download: this.apiUrl(
        ENDPOINTS.webrtc.recording(streamSid),
        { download: '1' },
        this.webrtcBase,
      ),
      status: this.apiUrl(ENDPOINTS.webrtc.recordingStatus(streamSid), {}, this.webrtcBase),
    };
  }

  /**
   * The call log as a spreadsheet, under whatever filters are on screen.
   *
   * Takes the same params object the `calls()` list does, so the download and
   * the table are driven by one value and cannot disagree about what was asked
   * for.
   */
  callsReportUrl(params: Record<string, string> = {}): string {
    return this.apiUrl(ENDPOINTS.callsReport, params);
  }

  /** A campaign's transcripts and recordings as one zip. */
  campaignExportUrl(id: string, include = 'transcripts,audio'): string {
    return this.apiUrl(ENDPOINTS.campaigns.exportZip(id), { include });
  }

  campaignTemplateUrl(id: string): string {
    return this.apiUrl(ENDPOINTS.campaigns.template(id));
  }
  campaignResultsUrl(id: string): string {
    return this.apiUrl(ENDPOINTS.campaigns.resultsXlsx(id));
  }
  /** Plain text transcript of one call, as a file. */
  callTranscriptUrl(id: string): string {
    return this.apiUrl(ENDPOINTS.callTranscript(id));
  }
  campaignResponsesUrl(id: string): string {
    return this.apiUrl(ENDPOINTS.campaigns.responsesXlsx(id));
  }
  agentTemplateUrl(key: string): string {
    return this.apiUrl(ENDPOINTS.agents.template(key));
  }
}
