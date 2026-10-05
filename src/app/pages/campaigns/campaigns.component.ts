import { campaignStatus, GROUPS, groupLabel } from '../../utils/status';
import { ConfirmComponent } from '../../components/confirm/confirm.component';
import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { IconComponent } from '../../components/icon/icon.component';
import { fmtTime } from '../../utils/format';
import { NewCampaignComponent } from './new-campaign.component';

@Component({
  selector: 'app-campaigns',
  standalone: true,
  imports: [FormsModule, IconComponent, ConfirmComponent, RouterLink, NewCampaignComponent],
  templateUrl: './campaigns.component.html',
})
export class CampaignsComponent implements OnInit {
  api = inject(ApiService);
  router = inject(Router);

  COLS = 'minmax(180px, 1.4fr) minmax(140px, 1fr) minmax(170px, 1.2fr) minmax(150px, max-content) 110px 140px 104px';
  GROUPS = GROUPS;
  progressTitle(c: any): string { return GROUPS.filter((g) => c.by_group?.[g.key]).map((g) => `${groupLabel(g.key)}: ${c.by_group[g.key]}`).join(' · '); }
  runTime(s: number): string {
    if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const h = Math.floor(s / 3600);
    return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${Math.round((s % 3600) / 60)} min`;
  }
  fmtTime = fmtTime;

;
  campaigns = signal<any[]>([]);
  agents = signal<any[]>([]);
  loading = signal(true);
  error = signal('');
  storage = signal(true);

  creating = signal(false);
  busy = signal(false);
  deleting = signal('');


  ngOnInit(): void {
    this.load();
    this.api.agents().then(list => {
      this.agents.set(list);
    }).catch(e => this.error.set(`Could not load agents: ${e.message}`));
  }

  q = signal('');
  statusFilter = signal<'all' | 'open' | 'done'>('all');
  sourceFilter = signal<'all' | 'clarix' | 'internal'>('all');
  deletingAsk = signal<any>(null);
  openCount = computed(() => this.campaigns().filter((c) => !campaignStatus(c.status).final).length);
  shown = computed(() => {
    const term = this.q().trim().toLowerCase();
    return this.campaigns()
      .filter((c) => this.statusFilter() === 'all' || (this.statusFilter() === 'open') === !campaignStatus(c.status).final)
      .filter((c) => this.sourceFilter() === 'all' || (this.sourceFilter() === 'clarix' ? c.source === 'clarix' : c.source !== 'clarix'))
      .filter((c) => !term || [c.name, c.description, c.schema?.label, c.agent].some((v) => (v || '').toLowerCase().includes(term)));
  });
  label = campaignStatus;
  /** Rows that reached a person or machine. New backends send counts; older ones only responses_count. */
  async load(): Promise<void> {
    try {
      const r = await this.api.campaigns();
      this.campaigns.set(r.campaigns || []);
      this.storage.set(r.storage_connected !== false);
      this.error.set('');
    } catch (e: any) { this.error.set(e.message); }
    finally { this.loading.set(false); }
  }

  /**
   * Gemini, unless this agent has no Gemini prompt.
   *
   * The model is no longer an operator choice, but the backend still rejects a
   * campaign whose agent has no prompt for the provider it was created with —
   * so falling back to whatever the agent does support keeps that from becoming
   * an unexplained 400 on a screen with no model field to correct.
   */
  /**
   * Why "New campaign" is disabled, for its tooltip.
   *
   * The button needs an agent to run, and it is disabled on an empty agent list
   * — but "empty" has two very different causes, and a greyed-out button with no
   * explanation looks like the page failed rather than like there is nothing to
   * create a campaign from yet.
   */
  /**
   * Delete a campaign from the list it appears in.
   *
   * The confirmation names what goes with it, because it is not just the
   * campaign row: the backend deletes the uploaded contacts and every captured
   * answer under it, and a campaign that has results is usually the one nobody
   * meant to remove.
   */
  async remove(campaign: any): Promise<void> {
    const captured = campaign.responses_count ?? 0;
    const extra = captured
      ? `\n\nThis campaign has ${captured} captured result${captured === 1 ? '' : 's'}. Deleting it removes them too, and they cannot be recovered.`
      : '';
    void extra;
    this.deleting.set(campaign.campaign_id);
    this.error.set('');
    try {
      await this.api.deleteCampaign(campaign.campaign_id);
      this.deletingAsk.set(null);
      await this.load();
    } catch (e: any) { this.error.set(e.message); }
    finally { this.deleting.set(''); }
  }

}
