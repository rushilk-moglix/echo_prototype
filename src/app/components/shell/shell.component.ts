import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { HealthService } from '../../services/health.service';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { fmtNum, fmtSecs } from '../../utils/format';
import { setNoReplyUnder } from '../../utils/status';
import { installDialogKeys } from '../../core/a11y/dialog-keys';

const NAV = [
  { to: '/overview', icon: 'overview', label: 'Overview' },
  { to: '/console', icon: 'mic', label: 'Call console' },
  // platform_admin OR agent_admin server-side (AgentAdminGuard); hidden here
  // for everyone else purely so the link isn't a dead end — see
  // ShellComponent.nav. Org Admin/Campaign Manager still pick an agent when
  // creating a campaign, via voxlix-backend's /webrtc/agents — a separate,
  // unrestricted listing endpoint, untouched by this.
  { to: '/agents', icon: 'bot', label: 'Agents', agentAdminOnly: true },
  { to: '/campaigns', icon: 'megaphone', label: 'Campaigns' },
  // org_admin-only server-side (RolesGuard); hidden here for everyone else
  // purely so the link isn't a dead end — see ShellComponent.nav.
  { to: '/team', icon: 'user', label: 'Team', orgAdminOnly: true },
  { to: '/settings', icon: 'settings', label: 'Settings' },
];

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent],
  template: `
    <div class="shell" [class.sb-pinned]="pinned()">
      <!-- Phones: a slim top bar; the menu button opens the same side bar as a drawer. -->
      <header class="topbar">
        <button class="btn-icon" (click)="drawer.set(!drawer())" [attr.aria-expanded]="drawer()" aria-label="Menu"><app-icon [name]="drawer() ? 'close' : 'menu'" [size]="18"></app-icon></button>
        <div class="tb-brand"><span class="sb-mark"><app-icon name="echo" [size]="16"></app-icon></span><b>Echo</b></div>
        <span style="flex: 1"></span>
        <span class="tb-org mono">{{ currentOrgName() }}</span>
      </header>
      @if (drawer()) { <div class="sb-scrim" (click)="drawer.set(false)"></div> }

      <!-- Side bar: icons only when closed; opens on hover or focus; the handle in the middle pins or closes it. -->
      <aside class="sb" [class.open]="isOpen()" [class.drawer]="drawer()" (mouseenter)="hoverIn()" (mouseleave)="hoverOut()" (focusin)="hoverIn()" (focusout)="onFocusOut($event)" (click)="closeOnLink($event)" aria-label="Main">
        <div class="sb-top">
          <a routerLink="/overview" class="sb-brand" aria-label="Echo home">
            <span class="sb-mark"><app-icon name="echo" [size]="18"></app-icon></span>
            <span class="sb-txt"><b>Echo</b><small>by Cognilix</small></span>
          </a>
        </div>

        <nav class="sb-nav">
          @for (g of groups(); track g.label) {
            <div class="sb-group"><span class="sb-txt">{{ g.label }}</span></div>
            @for (n of g.items; track n.to) {
              <a [routerLink]="n.to" routerLinkActive="active" ariaCurrentWhenActive="page" class="sb-link" [attr.title]="isOpen() ? null : n.label">
                <span class="sb-ico"><app-icon [name]="n.icon" [size]="18"></app-icon></span>
                <span class="sb-txt">{{ n.label }}</span>
                @if (n.to === '/console' && activeCalls() > 0) { <span class="sb-live" title="Live calls"></span> }
              </a>
            }
          }
        </nav>

        <div class="sb-today sb-txt">
          <span class="sb-k">Today</span>
          <span class="sb-row"><span>Calls</span><b class="mono">{{ fmtNum(today()?.total_calls ?? 0) }}</b></span>
          <span class="sb-row"><span>Talk time</span><b class="mono">{{ fmtSecs(today()?.funnel?.talk_seconds ?? 0) }}</b></span>
        </div>

        <div class="sb-foot">
          @if ((auth.me()?.memberships?.length || 0) > 1) {
            <label class="sb-org sb-txt">
              <span class="sb-k">Workspace</span>
              <select (change)="switchOrg($any($event.target).value)" aria-label="Workspace">
                @for (m of auth.me()!.memberships; track m.org_id) { <option [value]="m.org_id" [selected]="m.org_id === auth.currentOrgId()">{{ m.org_name }}</option> }
              </select>
            </label>
          }
          <div class="sb-me">
            <span class="sb-avatar" [title]="auth.me()?.email || ''">{{ initials() }}</span>
            <span class="sb-txt sb-who"><b>{{ currentOrgName() || 'Echo' }}</b><small [title]="auth.me()?.email || ''">{{ auth.me()?.email || '' }}</small></span>
            <button class="sb-theme sb-txt" (click)="cycleTheme()" [title]="'Theme: ' + themeLabel()" [attr.aria-label]="'Theme: ' + themeLabel()"><app-icon [name]="themeIcon()" [size]="16"></app-icon></button>
            <button class="sb-out sb-txt" (click)="signOut()" title="Sign out" aria-label="Sign out"><app-icon name="signout" [size]="16"></app-icon></button>
          </div>
        </div>

        <!-- Quick open and close, halfway down the edge. -->
        <button class="sb-handle" (click)="toggle($event)" [attr.aria-label]="isOpen() ? 'Close side bar' : 'Keep side bar open'" [title]="isOpen() ? 'Close' : 'Keep open'">
          <app-icon [name]="isOpen() ? 'chevronLeft' : 'chevronRight'" [size]="14" [strokeWidth]="2"></app-icon>
        </button>
      </aside>

      <div class="main">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
})
export class ShellComponent implements OnInit {
  private healthService = inject(HealthService);
  private api = inject(ApiService);
  auth = inject(AuthService);
  private router = inject(Router);
  nav = NAV;
  fmtNum = fmtNum;
  fmtSecs = fmtSecs;
  healthData = this.healthService.health;
  today = this.healthService.todayMetrics;
  activeCalls = computed(() => this.today()?.active_calls || 0);
  currentOrgName = computed(() => this.auth.currentMembership()?.org_name || '');
  isOrgAdmin = computed(
    () => this.auth.me()?.platform_admin || this.auth.currentMembership()?.role === 'org_admin',
  );
  isPlatformAdmin = computed(() => !!this.auth.me()?.platform_admin);
  isAgentAdmin = computed(() => !!this.auth.me()?.platform_admin || !!this.auth.me()?.agent_admin);
  visibleNav = computed(() =>
    this.nav.filter(
      (n) => (!n.orgAdminOnly || this.isOrgAdmin()) && (!n.agentAdminOnly || this.isAgentAdmin()),
    ),
  );

  /** Pages grouped for the side bar; order is unchanged. */
  groups = computed(() => {
    const v = this.visibleNav();
    const work = v.filter((n) => !['/team', '/settings'].includes(n.to));
    const ws = v.filter((n) => ['/team', '/settings'].includes(n.to));
    // Documentation is for everyone, at the end of the list.
    const help = [{ to: '/docs', icon: 'book', label: 'Documentation' }];
    return [{ label: 'Work', items: work }, ...(ws.length ? [{ label: 'Workspace', items: ws }] : []), { label: 'Help', items: help }];
  });
  initials = computed(() => (this.auth.me()?.email || '?').slice(0, 2).toUpperCase());

  // Side bar: closed shows icons; hover or keyboard focus opens it over the page;
  // the handle pins it open (pushes the page) or closes it at once.
  pinned = signal(this.readPin());
  hovered = signal(false);
  drawer = signal(false);
  private suppress = false;
  private hoverTimer: any = null;
  isOpen = computed(() => this.pinned() || this.hovered() || this.drawer());
  hoverIn(): void {
    if (this.suppress || this.pinned()) return;
    clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(() => this.hovered.set(true), 90);
  }
  hoverOut(): void { clearTimeout(this.hoverTimer); this.hovered.set(false); this.suppress = false; }
  onFocusOut(e: FocusEvent): void { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) this.hoverOut(); }
  toggle(e: Event): void {
    e.stopPropagation();
    if (this.drawer()) { this.drawer.set(false); return; }
    if (this.isOpen()) { this.setPin(false); this.hovered.set(false); this.suppress = true; } else { this.setPin(true); }
  }
  private setPin(v: boolean): void { this.pinned.set(v); try { localStorage.setItem('echo.sidebar.pinned', v ? '1' : '0'); } catch { /* private mode */ } }
  private readPin(): boolean { try { return localStorage.getItem('echo.sidebar.pinned') === '1'; } catch { return false; } }
  // Theme: follows the system until the user picks light or dark (remembered per browser).
  theme = signal<'system' | 'light' | 'dark'>(this.readTheme());
  themeIcon = computed(() => ({ system: 'monitor', light: 'sun', dark: 'moon' })[this.theme()]);
  themeLabel = computed(() => ({ system: 'same as system', light: 'light', dark: 'dark' })[this.theme()]);
  private media = window.matchMedia('(prefers-color-scheme: dark)');
  cycleTheme(): void {
    const next = ({ system: 'light', light: 'dark', dark: 'system' } as const)[this.theme()];
    this.theme.set(next);
    try { localStorage.setItem('echo.theme', next); } catch { /* private mode */ }
    this.applyTheme();
  }
  private readTheme(): 'system' | 'light' | 'dark' { try { return (localStorage.getItem('echo.theme') as any) || 'system'; } catch { return 'system'; } }
  private applyTheme = (): void => {
    const dark = this.theme() === 'dark' || (this.theme() === 'system' && this.media.matches);
    document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
  };
  /** On phones the drawer closes once a page is picked. */
  closeOnLink(e: Event): void { if ((e.target as HTMLElement).closest('a')) { this.drawer.set(false); this.hovered.set(false); } }

  ngOnInit(): void {
    // Every dialog: focus moves in and stays, Esc closes, focus returns.
    installDialogKeys('.modal, [role="dialog"]', '.modal-backdrop');
    this.applyTheme();
    this.media.addEventListener('change', this.applyTheme);
    // A page refresh restores accessToken/currentOrgId from localStorage but
    // not `me` (never persisted — it's re-fetched, not stored, so a role
    // change server-side is picked up on the next load rather than cached).
    if (this.auth.isAuthenticated() && !this.auth.me()) {
      this.api
        .me()
        .then((me) => {
          this.auth.setMe(me);
          if (!this.auth.currentOrgId() && me.memberships.length) {
            this.auth.setCurrentOrg(me.memberships[0].org_id);
          }
        })
        .catch(() => undefined);
    }
    // The No reply cut-off is a workspace setting; status hovers quote it.
    const org = this.auth.currentOrgId();
    if (org) this.api.orgSettings(org).then((st) => setNoReplyUnder(st?.telephony?.no_reply_under_seconds)).catch(() => undefined);
  }

  /** Each workspace has its own agents, campaigns, telephony routes and team; reload so every page refetches. */
  switchOrg(orgId: string): void {
    if (!orgId || orgId === this.auth.currentOrgId()) return;
    this.auth.setCurrentOrg(orgId);
    this.router.navigateByUrl('/overview').then(() => window.location.reload());
  }

  signOut(): void {
    this.auth.signOut();
    this.router.navigate(['/login']);
  }
}
