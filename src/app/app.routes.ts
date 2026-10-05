import { DocsComponent } from './pages/docs/docs.component';
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { LoginComponent } from './components/login/login.component';
import { ShellComponent } from './components/shell/shell.component';
import { OverviewComponent } from './pages/overview/overview.component';
import { CallConsoleComponent } from './pages/call-console/call-console.component';
import { AgentsComponent } from './pages/agents/agents.component';
import { AgentDetailComponent } from './pages/agent-detail/agent-detail.component';
import { CampaignsComponent } from './pages/campaigns/campaigns.component';
import { CampaignDetailComponent } from './pages/campaign-detail/campaign-detail.component';
import { CallAnalysisComponent } from './pages/call-analysis/call-analysis.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { TeamComponent } from './pages/team/team.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, title: 'Sign in · Echo' },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'overview', component: OverviewComponent, title: 'Overview · Echo' },
      { path: 'console', component: CallConsoleComponent, title: 'Call console · Echo' },
      { path: 'calls/:id', component: CallAnalysisComponent, title: 'Call · Echo' },
      { path: 'agents', component: AgentsComponent, title: 'Agents · Echo' },
      { path: 'agents/:key', component: AgentDetailComponent, title: 'Agent · Echo', canDeactivate: [(c: AgentDetailComponent) => c.canLeave()] },
      { path: 'campaigns', component: CampaignsComponent, title: 'Campaigns · Echo' },
      { path: 'campaigns/:id', component: CampaignDetailComponent, title: 'Campaign · Echo' },
      { path: 'campaigns/:cid/contacts/:pid', component: CallAnalysisComponent, title: 'Call · Echo' },
      { path: 'team', component: TeamComponent, title: 'Team · Echo' },
      { path: 'settings', component: SettingsComponent, title: 'Settings · Echo' },
      { path: 'docs', component: DocsComponent, title: 'Documentation · Echo' },
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'overview' },
];
