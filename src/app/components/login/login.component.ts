import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../icon/icon.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="gate">
      <form class="gate-card" (ngSubmit)="submit()">
        <div class="sb-brand" style="--sb-ink: var(--ds-text); --sb-mute: var(--ds-text-muted)">
          <span class="sb-mark"><app-icon name="echo" [size]="18"></app-icon></span>
          <span class="sb-txt" style="opacity: 1"><b>Echo</b><small>by Cognilix</small></span>
        </div>
        @if (demo) { <div class="note" style="margin-top: 12px">Demo with sample data. Sign in with any email and password.</div> }
        <div class="field" style="margin-top: 10px">
          <label class="field-label" for="email">Email</label>
          <input
            id="email"
            class="input"
            type="email"
            autofocus
            [(ngModel)]="email"
            name="email"
            placeholder="you@company.com"
          />
        </div>
        <div class="field" style="margin-top: 10px">
          <label class="field-label" for="password">Password</label>
          <input
            id="password"
            class="input"
            type="password"
            [(ngModel)]="password"
            name="password"
            placeholder="••••••••"
          />
        </div>
        @if (error()) { <div class="note bad" style="margin-top: 12px">{{ error() }}</div> }
        <button
          type="submit"
          class="btn btn-primary"
          style="width: 100%; margin-top: 16px"
          [disabled]="!email.trim() || !password || busy()"
        >
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  `,
})
export class LoginComponent {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);
  readonly demo = environment.demo;
  email = '';
  password = '';
  error = signal('');
  busy = signal(false);

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const { access_token } = await this.api.login(this.email.trim(), this.password);
      this.auth.setAccessToken(access_token);
      const me = await this.api.me();
      this.auth.setMe(me);
      if (me.memberships.length) {
        // First membership, not necessarily Moglix — with only one org today
        // this is unambiguous; Settings has the switcher for when it isn't.
        this.auth.setCurrentOrg(me.memberships[0].org_id);
      } else if (!me.platform_admin) {
        throw new Error('Your account has no organization access yet — ask an admin to add you.');
      }
      this.router.navigate(['/overview']);
    } catch (e: any) {
      this.auth.signOut();
      this.error.set(e.message || 'Login failed');
    } finally {
      this.busy.set(false);
    }
  }
}
