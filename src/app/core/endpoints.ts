/**
 * The backend, and every URL the app knows, in one place.
 *
 * Nothing else in the app should contain a path or a hostname. Endpoints move,
 * get renamed and get versioned; when that happens this file is the only thing
 * that changes, and a mismatch between the UI and the API is one grep away
 * instead of being scattered across a dozen components.
 *
 * Paths are relative to the API root. `apiUrl()` in ApiService joins them to
 * API_BASE and adds the access token, so the constants stay readable.
 */

import { environment } from '../../environments/environment';

/**
 * Where the API lives. Absolute, so the app talks to the backend directly and a
 * failing call shows the real host in the network tab.
 *
 * Being cross-origin, the backend must allow whatever origin serves this app —
 * see CORS_ORIGINS in the backend .env.
 *
 * Sourced from src/environments/ — `ng serve` gets environment.ts (localhost),
 * `ng build` gets environment.prod.ts swapped in by angular.json's
 * fileReplacements. Change the hostname there, not here, and never by
 * commenting lines in/out.
 */
export const API_BASE = environment.apiBase;

/**
 * WebRTC/live-call routes (`/webrtc/*`, and the 'webrtc' channel of start_call) only
 * exist on voxlix-backend — voxlix-dataload never got a WebRTC module, it only ported
 * campaigns/contacts/agents/external. Kept separate from API_BASE so the two services
 * can run on different local ports without breaking Call Console.
 */
export const WEBRTC_BASE = environment.webrtcBase;

/** Route-parameter segments are encoded here so callers never have to remember. */
const seg = (value: string) => encodeURIComponent(value);

export const ENDPOINTS = {
  /** Liveness + dependency status. The only endpoint that needs no token. */
  health: '/health',

  auth: {
    login: '/api/auth/login',
  },
  /** Who you are, and every org you're a member of — no org_id needed, this is how the app discovers which one(s) to offer. */
  me: '/api/me',

  /** Org-admin-only: managing who has access and what they can see. orgId is
   * always the current org, never client-chosen — the backend re-validates it
   * against the caller's own membership regardless of what's in the URL. */
  org: {
    users: (orgId: string) => `/api/orgs/${seg(orgId)}/users`,
    userRole: (orgId: string, userId: string) => `/api/orgs/${seg(orgId)}/users/${seg(userId)}/role`,
    removeUser: (orgId: string, userId: string) => `/api/orgs/${seg(orgId)}/users/${seg(userId)}`,
    groups: (orgId: string) => `/api/orgs/${seg(orgId)}/groups`,
    group: (orgId: string, groupId: string) => `/api/orgs/${seg(orgId)}/groups/${seg(groupId)}`,
    groupMembers: (orgId: string, groupId: string) => `/api/orgs/${seg(orgId)}/groups/${seg(groupId)}/members`,
    groupMember: (orgId: string, groupId: string, userId: string) =>
      `/api/orgs/${seg(orgId)}/groups/${seg(groupId)}/members/${seg(userId)}`,
    /** Enabled third-party platforms this org can sync agents to — empty
     * array means no third party, and the Agents page hides Sync entirely. */
    syncPlatforms: (orgId: string) => `/api/orgs/${seg(orgId)}/sync-platforms`,
    syncPlatform: (orgId: string, key: string) => `/api/orgs/${seg(orgId)}/sync-platforms/${seg(key)}`,
    settings: (orgId: string) => `/api/orgs/${seg(orgId)}/settings`,
    integrations: (orgId: string) => `/api/orgs/${seg(orgId)}/integrations`,
    integration: (orgId: string, key: string) => `/api/orgs/${seg(orgId)}/integrations/${seg(key)}`,
    integrationCheck: (orgId: string, key: string) => `/api/orgs/${seg(orgId)}/integrations/${seg(key)}/check`,
    flows: (orgId: string) => `/api/orgs/${seg(orgId)}/telephony/flows`,
    flow: (orgId: string, name: string) => `/api/orgs/${seg(orgId)}/telephony/flows/${seg(name)}`,
    fetchFlows: (orgId: string, provider: string) => `/api/orgs/${seg(orgId)}/telephony/${seg(provider)}/fetch`,
    dataPolicy: (orgId: string) => `/api/orgs/${seg(orgId)}/data-policy`,
  },

  /** Platform-admin-only, not org-scoped — grants/revokes the agent_admin flag. */
  admin: {
    setAgentAdmin: (userId: string) => `/api/admin/users/${seg(userId)}/agent-admin`,
  },

  metrics: '/api/metrics',
  calls: '/api/calls',
  /** The filtered call log as a spreadsheet — same query params as `calls`. */
  callsReport: '/api/calls/report.xlsx',
  call: (id: string) => `/api/calls/${seg(id)}`,
  /** LLM analysis (priority, resolution, summary, next steps) for one call. */
  analyzeCall: (id: string) => `/api/calls/${seg(id)}/analyze`,
  callTranscript: (id: string) => `/api/calls/${seg(id)}/transcript.txt`,
  /** The in-flight call with its transcript — how phone channels get a live view. */
  live: '/api/live',

  agents: {
    /** Tester-facing list: agents with their providers, voices and variants. */
    forTester: '/webrtc/agents',
    list: '/api/agents',
    /** Providers, voices, channels and section kinds for the editor forms. */
    meta: '/api/agents/meta',
    /** Campaign-facing shape of every agent. */
    schema: '/api/agents/schema',
    /** Re-read the agent definitions from Mongo without restarting the API. */
    refresh: '/api/agents/refresh',
    create: '/api/agents',
    detail: (key: string) => `/api/agents/${seg(key)}`,
    update: (key: string) => `/api/agents/${seg(key)}`,
    remove: (key: string) => `/api/agents/${seg(key)}`,
    sections: (key: string) => `/api/agents/${seg(key)}/sections`,
    /** Try a file against the draft Input file settings: how many calls it becomes. */
    checkFile: (key: string) => `/api/agents/${seg(key)}/check-file`,
    /** Reference files the agent can search during calls (PRD-ECHO-19 section 5). */
    references: (key: string) => `/api/agents/${seg(key)}/references`,
    reference: (key: string, id: string) => `/api/agents/${seg(key)}/references/${seg(id)}`,
    /** Current text of the generated call-details / outcome-reporting blocks. */
    generated: (key: string) => `/api/agents/${seg(key)}/generated`,
    inputs: (key: string) => `/api/agents/${seg(key)}/inputs`,
    outputs: (key: string) => `/api/agents/${seg(key)}/outputs`,
    preview: (key: string) => `/api/agents/${seg(key)}/preview`,
    template: (key: string) => `/api/agents/${seg(key)}/template.xlsx`,
    /** Arms the agent for the sync poller — permanent once it succeeds, no
     * unsync/switch action exists. */
    sync: (key: string) => `/api/agents/${seg(key)}/sync`,
  },

  campaigns: {
    list: '/api/campaigns',
    create: '/api/campaigns',
    detail: (id: string) => `/api/campaigns/${seg(id)}`,
    remove: (id: string) => `/api/campaigns/${seg(id)}`,
    contacts: (id: string) => `/api/campaigns/${seg(id)}/contacts`,
    contactDetail: (id: string, primaryId: string) =>
      `/api/campaigns/${seg(id)}/contacts/${seg(primaryId)}`,
    responses: (id: string) => `/api/campaigns/${seg(id)}/responses`,
    upload: (id: string) => `/api/campaigns/${seg(id)}/upload`,
    dial: (id: string) => `/api/campaigns/${seg(id)}/dial`,
    /** Ends a running campaign; rows not yet dialled become Cancelled. */
    stop: (id: string) => `/api/campaigns/${seg(id)}/stop`,
    template: (id: string) => `/api/campaigns/${seg(id)}/template.xlsx`,
    responsesXlsx: (id: string) => `/api/campaigns/${seg(id)}/responses.xlsx`,
    /** One row per item of a list answer (for example one per purchase order line). */
    /** Every uploaded row once, with its call's outcome and its own answers (PRD-ECHO-19). */
    resultsXlsx: (id: string) => `/api/campaigns/${seg(id)}/results.xlsx`,
    /** Every transcript and recording the campaign produced, in one archive. */
    exportZip: (id: string) => `/api/campaigns/${seg(id)}/export.zip`,
  },

  webrtc: {
    /** WebSocket. Upgraded to ws:// or wss:// by ApiService.streamUrl(). */
    stream: '/webrtc/stream',
    recording: (streamSid: string) => `/webrtc/recording/${seg(streamSid)}`,
    recordingStatus: (streamSid: string) => `/webrtc/recording/${seg(streamSid)}/status`,
  },

  ozonetel: {
    /** Campaigns defined in the Ozonetel dashboard, for mapping ours to theirs. */
    campaigns: '/ozonetel/campaigns',
  },

  /** `POST /{channel}/start_call` — channel is 'webrtc' or 'ozonetel'. */
  startCall: (channel: string) => `/${seg(channel)}/start_call`,
} as const;
