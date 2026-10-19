import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { EchoLoaderComponent, EchoMarkComponent } from '../../components/echo-mark/echo-mark.component';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';
import { CreditsService, fmtCredits } from '../../services/credits.service';
import { IconComponent } from '../../components/icon/icon.component';
import { BuyCreditsComponent } from '../../components/buy-credits/buy-credits.component';
import { RequestWorkComponent } from '../../components/request-work/request-work.component';

type Kind = 'input' | 'output' | 'sop' | 'docs' | 'db' | 'script';
const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: 'input', label: 'List you call from', hint: '.xlsx or .csv' }, { key: 'output', label: 'Sample of the answers', hint: 'what you want back' },
  { key: 'sop', label: 'SOP', hint: 'how your team does it' }, { key: 'docs', label: 'Customer documents', hint: 'FAQs, policies, price lists' },
  { key: 'db', label: 'Database design', hint: '.sql or .json' }, { key: 'script', label: 'Call script', hint: 'or a transcript' },
];
const PACKS = [
  { key: 'supplier', label: 'Supplier follow up', icon: 'order' }, { key: 'collections', label: 'Collections', icon: 'coins' },
  { key: 'dispatch', label: 'Dispatch and delivery', icon: 'route' }, { key: 'vendor', label: 'Vendor details check', icon: 'shield' },
];
const PACK_TEXT: Record<string, string> = {
  supplier: 'Call each supplier once about all of their open purchase order lines. For each line, confirm it will arrive on the promised date, or take the new date and the reason.',
  collections: 'Call customers with overdue invoices. For each invoice, get a promise to pay with a date and amount, or note why they dispute it.',
  dispatch: 'Call transporters about today\'s shipments. Confirm the vehicle is placed, take the vehicle number and expected arrival, and ask for proof of delivery when delivered.',
  vendor: 'Call new vendors to confirm their contact, GST and bank details before the first purchase order. Never change bank details on the call.',
};
const SAMPLES = ['open_po_lines.xlsx', 'supplier_followup_sop.txt', 'erp_schema.sql', 'call_script.txt'];

/** The kind of a file from its name; the person can change it. The server reads the content to be sure. */
function guessKind(name: string): Kind {
  const n = name.toLowerCase(); const ext = n.split('.').pop() || '';
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext)) return /out|result|answer|report|response|expected|filled/.test(n) ? 'output' : 'input';
  if (['sql', 'dbml', 'prisma'].includes(ext) || /schema|database|\bdb\b|erd|tables/.test(n)) return 'db';
  if (/script|transcript|recording|call_flow|pitch/.test(n)) return 'script';
  if (/sop|process|procedure|policy|playbook|guideline|escalation|rules/.test(n)) return 'sop';
  return 'docs';
}

/**
 * Build an agent with AI. Three steps on one page: say the job and drop what you
 * have; answer the few things Echo could not work out; check the result and create.
 * Replaces the 40 field editor as the way in; the editor is still there for changes.
 */
@Component({
  selector: 'app-agent-builder',
  standalone: true,
  imports: [EchoLoaderComponent, EchoMarkComponent, FormsModule, RouterLink, IconComponent, BuyCreditsComponent, RequestWorkComponent],
  template: `
    <div class="page ab">
      <div class="page-head">
        <div><a class="page-link" routerLink="/agents"><app-icon name="back" [size]="13"></app-icon> Agents</a><h1 class="page-title">New agent</h1></div>
        <ol class="ab-steps" aria-label="Steps">
          @for (s of steps; track s.key; let i = $index) { <li [class.on]="step() === s.key" [class.done]="stepIndex() > i"><span class="mono">{{ i + 1 }}</span>{{ s.label }}</li> }
        </ol>
      </div>
      @if (error()) { <div class="note bad">{{ error() }} @if (short()) { <button class="link" (click)="buying.set(true)">Buy credits</button> }</div> }

      @if (busy() && (step() === 'describe' || step() === 'review')) {
        <div class="ab-busy"><app-echo-loader [label]="step() === 'describe' ? 'Reading your files and drafting the agent' : 'Building the agent'" [size]="56"></app-echo-loader></div>
      }
      <!-- 1. Say the job, drop the files -->
      @if (step() === 'describe') {
        <div class="ab-grid">
          <div class="card ab-main">
            <div class="card-body ab-body">
              <div class="ab-q">What should the agent do?</div>
              <div class="ab-packs" role="group" aria-label="Start from a Pack">
                @for (p of packs; track p.key) { <button type="button" [class]="'ab-pack' + (pack() === p.key ? ' on' : '')" (click)="pickPack(p.key)"><app-icon [name]="p.icon" [size]="14"></app-icon> {{ p.label }}</button> }
              </div>
              <textarea class="input ab-prompt" rows="4" [ngModel]="prompt()" (ngModelChange)="prompt.set($event)" aria-label="What should the agent do"
                placeholder="Brief it like a new team member: who it calls, what it asks, what it should do when the answer is not what you hoped."></textarea>

              <label [class]="'ab-drop' + (drag() ? ' drag' : '')" (dragover)="$event.preventDefault(); drag.set(true)" (dragleave)="drag.set(false)" (drop)="onDrop($event)">
                <input type="file" multiple hidden (change)="addFiles($any($event.target).files); $any($event.target).value = ''" accept=".xlsx,.xls,.csv,.txt,.md,.pdf,.docx,.doc,.sql,.json,.dbml" />
                <app-icon name="paperclip" [size]="18"></app-icon>
                <span><b>Drop anything you have</b><span class="row-sub">or click to choose. Echo reads it and sets the agent up from it.</span></span>
              </label>
              <div class="ab-kinds">@for (k of kinds; track k.key) { <span class="ab-kind" [class.have]="has(k.key)">{{ k.label }} <small>{{ k.hint }}</small></span> }</div>

              @if (files().length) {
                <div class="ab-files">
                  @for (f of files(); track f.file.name; let i = $index) {
                    <div class="ab-file">
                      <app-icon [name]="f.kind === 'input' || f.kind === 'output' ? 'table' : f.kind === 'db' ? 'database' : 'fileText'" [size]="14"></app-icon>
                      <span class="ellipsis" [title]="f.file.name">{{ f.file.name }}</span>
                      <select class="select select-sm" [ngModel]="f.kind" (ngModelChange)="setKind(i, $event)" [attr.aria-label]="'What ' + f.file.name + ' is'">
                        @for (k of kinds; track k.key) { <option [value]="k.key">{{ k.label }}</option> }
                      </select>
                      <button class="btn-icon" (click)="removeFile(i)" [attr.aria-label]="'Remove ' + f.file.name"><app-icon name="close" [size]="14"></app-icon></button>
                    </div>
                  }
                </div>
              } @else {
                <button class="link ab-sample" type="button" (click)="useSamples()" [disabled]="busy()">No files at hand? Try it with example files</button>
              }
            </div>
            <div class="ab-foot">
              <span class="row-sub">Reading is free. Building the agent costs {{ fmt(cost()) }} credits, after you check it.</span>
              <button class="btn btn-primary" (click)="analyze()" [disabled]="busy() || (!prompt().trim() && !files().length)">{{ busy() ? 'Reading…' : 'Read and draft the agent' }}</button>
            </div>
          </div>
          <aside class="ab-side">
            <div class="card card-body ab-tip">
              <b>Other ways to start</b>
              <button class="btn" (click)="blankAsk.set(true)"><app-icon name="plus" [size]="13"></app-icon> Start blank</button>
              @if (agents().length) {
                <label class="field"><span class="field-label">Copy an agent</span>
                  <select class="select" [ngModel]="''" (ngModelChange)="copy($event)" aria-label="Copy an agent"><option value="">Pick one…</option>@for (a of agents(); track a.key) { <option [value]="a.key">{{ a.label }}</option> }</select></label>
              }
              <button class="btn" (click)="requesting.set(true)"><app-icon name="wrench" [size]="13"></app-icon> Have our team build it</button>
            </div>
            <div class="card card-body ab-tip">
              <b>What Echo does with your files</b>
              <span class="row-sub">The list gives it the columns, the phone number and how rows group into calls. A sample of answers tells it what to save. The SOP gives it rules. Documents become knowledge it can search on calls. A database design suggests lookups.</span>
            </div>
          </aside>
        </div>
      }

      <!-- 2. Questions -->
      @if (step() === 'ask') {
        <div class="ab-grid">
          <div class="ab-main ab-qs">
            <div class="ab-qhead"><div><div class="ab-q">{{ questions().length }} things to check</div><span class="row-sub">Echo picked an answer for each. Change any that are wrong.</span></div>
              <button class="btn" (click)="step.set('review')">Use Echo's answers</button></div>
            @for (q of questions(); track q.id) {
              <div class="card card-body ab-qcard">
                <div><b>{{ q.q }}</b><span class="row-sub">{{ q.why }}</span></div>
                <div class="ab-opts" [attr.role]="q.multi ? 'group' : 'radiogroup'" [attr.aria-label]="q.q">
                  @for (o of q.options; track o) {
                    <button type="button" [attr.role]="q.multi ? 'checkbox' : 'radio'" [attr.aria-checked]="picked(q, o)" [class]="'ab-opt' + (picked(q, o) ? ' on' : '')" (click)="answer(q, o)">
                      @if (picked(q, o)) { <app-icon name="check" [size]="12"></app-icon> } {{ nice(o) }}
                    </button>
                  }
                </div>
              </div>
            }
            <div class="ab-foot"><button class="btn btn-ghost" (click)="step.set('describe')">Back</button><span style="flex: 1"></span><button class="btn btn-primary" (click)="step.set('review')" [disabled]="busy()">Check the agent</button></div>
          </div>
          <aside class="ab-side">
            <div class="card card-body ab-tip ab-understood">
              <b>What Echo understood</b>
              @for (n of draft()?.notes || []; track $index) { <span class="ab-note"><app-icon name="check" [size]="12"></app-icon> {{ n }}</span> }
              @if (draft()?.stats?.rows) { <div class="ab-flow"><b class="mono">{{ draft().stats.rows }}</b> rows <app-icon name="chevronRight" [size]="13"></app-icon> <b class="mono">{{ draft().stats.calls }}</b> calls</div> }
            </div>
          </aside>
        </div>
      }

      <!-- 3. Review and create -->
      @if (step() === 'review' && draft(); as d) {
        <div class="card ab-review">
          <div class="card-body ab-rev-head">
            <label class="field" style="flex: 1; min-width: 220px"><span class="field-label">Name</span><input class="input" [ngModel]="label()" (ngModelChange)="label.set($event)" aria-label="Agent name" /></label>
            <div class="ab-flow">@if (d.stats?.rows) { <b class="mono">{{ d.stats.rows }}</b> rows <app-icon name="chevronRight" [size]="13"></app-icon> <b class="mono">{{ d.stats.calls }}</b> calls }</div>
          </div>
          <div class="ab-cards">
            <section class="ab-sec"><h3><app-icon name="speak" [size]="14"></app-icon> Who calls</h3>
              <p><b>{{ d.name }}</b> for {{ d.team }} · {{ d.language }}</p><p class="ab-quote">“{{ d.opening }}”</p></section>
            <section class="ab-sec"><h3><app-icon name="table" [size]="14"></app-icon> What it reads</h3>
              <div class="ab-chips">@for (c of d.inputs; track c.key) { <span class="ab-chip" [title]="c.type + (c.sample ? ': ' + c.sample : '')">{{ c.key }} <small>{{ c.type === 'phone' ? 'calls this' : c.type }}</small></span> }</div>
              <p class="row-sub">{{ d.plan.mode === 'group' ? 'One call per ' + nice(d.plan.group_by) + ', covering all of their rows' : 'One call per row' }}</p></section>
            <section class="ab-sec"><h3><app-icon name="answers" [size]="14"></app-icon> What it finds out</h3>
              <div class="ab-chips">@for (f of answerFields(); track f.key) { <span class="ab-chip">{{ f.key }} <small>{{ f.type }}</small></span> }</div>
              <p class="row-sub">{{ d.plan.mode === 'group' ? 'Saved for each row as soon as it is answered' : 'Saved at the end of each call' }}</p></section>
            <section class="ab-sec"><h3><app-icon name="shield" [size]="14"></app-icon> Rules</h3>
              <ul class="ab-rules">@for (r of rules(); track $index) { <li>{{ r }}</li> }</ul></section>
            <section class="ab-sec"><h3><app-icon name="book" [size]="14"></app-icon> Knowledge and lookups</h3>
              @for (r of d.references; track r.name) { <p><app-icon name="fileText" [size]="12"></app-icon> {{ r.name }}</p> }
              @for (l of d.lookups; track l.name) { <p><app-icon name="database" [size]="12"></app-icon> {{ l.name }} by {{ l.send.join(', ') }} <small class="row-sub">· your team adds the address</small></p> }
              @if (!d.references.length && !d.lookups.length) { <p class="row-sub">None. Add documents or lookups later in the agent's Settings.</p> }</section>
            <section class="ab-sec"><h3><app-icon name="route" [size]="14"></app-icon> Calls and results</h3>
              <p>Calls from <b class="mono">{{ d.flow || 'no line yet' }}</b></p><p>Answers go to <b>{{ syncLabel(d.sync) }}</b></p>
              <p class="row-sub">Tries 3 times, an hour apart, in calling hours.</p></section>
          </div>
          <div class="ab-foot">
            <button class="btn btn-ghost" (click)="step.set(questions().length ? 'ask' : 'describe')">Back</button><span style="flex: 1"></span>
            <span class="row-sub">Balance {{ fmt(credits.balance()) }}</span>
            <button class="btn btn-primary" (click)="create()" [disabled]="busy() || !label().trim()">{{ busy() ? 'Building…' : 'Create agent · ' + fmt(cost()) + ' credits' }}</button>
          </div>
        </div>
      }

      <!-- Done -->
      @if (step() === 'done' && created(); as a) {
        <div class="card card-body ab-done">
          <app-echo-mark mode="intro" [size]="72"></app-echo-mark>
          <h2>{{ a.label }} is ready</h2>
          <p class="row-sub">Prompt, call data, answers, rules and calling line are set. Hear it once, then start calling.</p>
          <div class="ab-done-acts">
            <a class="btn" [routerLink]="['/console']" [queryParams]="{ agent: a.key }"><app-icon name="phone" [size]="14"></app-icon> Test call · {{ fmt(price('test_call')) }} credits a minute</a>
            @if (inputFile(); as f) { @if (a.ozonetel_campaign) { <button class="btn btn-primary" (click)="startCalling(a, f)" [disabled]="busy()"><app-icon name="phoneOut" [size]="14"></app-icon> {{ busy() ? 'Starting…' : 'Start calling with ' + f.name }}</button> } }
            <a class="btn btn-ghost" [routerLink]="['/agents', a.key]">Open the agent</a>
          </div>
        </div>
      }
    </div>

    @if (blankAsk()) {
      <div class="modal-backdrop" (click)="blankAsk.set(false)">
        <form class="modal" style="max-width: 420px; width: calc(100vw - 32px)" role="dialog" aria-label="Start blank" (click)="$event.stopPropagation()" (ngSubmit)="blank()">
          <div class="modal-head"><div class="modal-title">Start blank</div></div>
          <div class="modal-body"><label class="field"><span class="field-label">Name</span><input class="input" name="bn" [ngModel]="blankName()" (ngModelChange)="blankName.set($event)" placeholder="Payment follow up" autofocus /></label></div>
          <div class="modal-foot"><button type="button" class="btn" (click)="blankAsk.set(false)">Cancel</button><span style="flex: 1"></span><button class="btn btn-primary" [disabled]="!blankName().trim() || busy()">Create and open</button></div>
        </form>
      </div>
    }
    @if (buying()) { <app-buy-credits [need]="cost()" (closed)="buying.set(false)"></app-buy-credits> }
    @if (requesting()) { <app-request-work [initialTitle]="prompt().slice(0, 80)" (closed)="requesting.set(false)"></app-request-work> }
  `,
  styles: [`
    .ab .page-head { align-items: flex-end; flex-wrap: wrap; gap: 12px; }
    .ab-steps { display: flex; gap: 6px; list-style: none; margin: 0; padding: 0; flex-wrap: wrap; }
    .ab-steps li { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ds-text-muted); padding: 4px 10px 4px 4px; border-radius: 999px; border: 1px solid var(--ds-border); }
    .ab-steps li span { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; background: var(--ds-surface-sunken); }
    .ab-steps li.on { color: var(--ds-text); border-color: var(--ds-accent); } .ab-steps li.on span { background: var(--ds-accent); color: var(--ds-on-accent); }
    .ab-steps li.done span { background: var(--ds-accent-soft); color: var(--ds-accent-fg); }
    .ab-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    .ab-main { min-width: 0; }
    .ab-body { display: grid; gap: 14px; }
    .ab-q { font-size: 18px; font-weight: 650; letter-spacing: -0.01em; }
    .ab-packs { display: flex; gap: 6px; flex-wrap: wrap; }
    .ab-pack { display: inline-flex; gap: 6px; align-items: center; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--ds-border); background: var(--ds-surface); font: inherit; font-size: 13px; color: var(--ds-text); cursor: pointer; }
    .ab-pack.on, .ab-pack:hover { border-color: var(--ds-accent); background: var(--ds-accent-soft); }
    .ab-prompt { min-height: 96px; resize: vertical; font-size: 14px; line-height: 1.5; }
    .ab-drop { display: flex; gap: 12px; align-items: center; padding: 18px; border: 1.5px dashed var(--ds-border-strong, var(--ds-border)); border-radius: 12px; cursor: pointer; color: var(--ds-text-muted); }
    .ab-drop > span { display: grid; gap: 2px; } .ab-drop b { color: var(--ds-text); }
    .ab-drop:hover, .ab-drop.drag { border-color: var(--ds-accent); background: var(--ds-accent-soft); }
    .ab-kinds { display: flex; gap: 6px; flex-wrap: wrap; }
    .ab-kind { font-size: 12px; padding: 3px 8px; border-radius: 6px; background: var(--ds-surface-sunken); color: var(--ds-text-muted); }
    .ab-kind small { opacity: .7; } .ab-kind.have { background: var(--ds-accent-soft); color: var(--ds-accent-fg); }
    .ab-files { display: grid; gap: 6px; }
    .ab-file { display: grid; grid-template-columns: 16px minmax(0, 1fr) 200px 28px; gap: 8px; align-items: center; padding: 6px 8px 6px 12px; border: 1px solid var(--ds-border); border-radius: 10px; font-size: 13px; }
    .ab-sample { justify-self: start; }
    .ab-foot { display: flex; gap: 10px; align-items: center; justify-content: flex-end; flex-wrap: wrap; padding: 12px 16px; border-top: 1px solid var(--ds-border); }
    .ab-foot .row-sub { margin-right: auto; }
    .ab-qs .ab-foot { border: 0; padding: 4px 0; }
    .ab-side { display: grid; gap: 12px; position: sticky; top: 0; }
    .ab-tip { display: grid; gap: 8px; font-size: 13px; }
    .ab-qs { display: grid; gap: 10px; }
    .ab-qhead { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
    .ab-qcard { display: grid; gap: 10px; } .ab-qcard > div:first-child { display: grid; gap: 2px; }
    .ab-opts { display: flex; gap: 6px; flex-wrap: wrap; }
    .ab-opt { display: inline-flex; gap: 6px; align-items: center; padding: 7px 12px; border-radius: 10px; border: 1px solid var(--ds-border); background: var(--ds-surface); font: inherit; font-size: 13px; color: var(--ds-text); cursor: pointer; }
    .ab-opt.on { border-color: var(--ds-accent); background: var(--ds-accent-soft); color: var(--ds-accent-fg); }
    .ab-understood .ab-note { display: flex; gap: 6px; align-items: flex-start; color: var(--ds-text-muted); } .ab-note app-icon { color: var(--ds-accent); margin-top: 2px; }
    .ab-flow { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ds-text-muted); } .ab-flow b { font-size: 18px; color: var(--ds-text); }
    .ab-rev-head { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; border-bottom: 1px solid var(--ds-border); }
    .ab-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .ab-sec { padding: 14px 16px; border-right: 1px solid var(--ds-border); border-bottom: 1px solid var(--ds-border); display: grid; gap: 6px; align-content: start; font-size: 13px; min-width: 0; }
    .ab-sec:nth-child(3n) { border-right: 0; }
    .ab-sec h3 { margin: 0; font-size: 12px; font-family: var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--ds-text-muted); display: flex; gap: 6px; align-items: center; font-weight: 500; }
    .ab-sec p { margin: 0; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
    .ab-quote { font-style: italic; color: var(--ds-text-muted); }
    .ab-chips { display: flex; gap: 5px; flex-wrap: wrap; }
    .ab-chip { font-family: var(--mono); font-size: 12px; padding: 3px 7px; border-radius: 6px; background: var(--ds-surface-sunken); } .ab-chip small { color: var(--ds-text-muted); }
    .ab-rules { margin: 0; padding-left: 16px; display: grid; gap: 4px; }
    .ab-busy { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: color-mix(in srgb, var(--ds-bg, #fff) 72%, transparent); backdrop-filter: blur(2px); }
    .ab-done { display: grid; justify-items: center; text-align: center; gap: 8px; padding: 40px 20px; }
    .ab-done h2 { margin: 6px 0 0; font-size: 22px; letter-spacing: -0.02em; }
    .ab-ok { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--ds-success-bg); color: var(--ds-success-fg); }
    .ab-done-acts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }
    @media (max-width: 1100px) { .ab-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ab-sec:nth-child(3n) { border-right: 1px solid var(--ds-border); } .ab-sec:nth-child(2n) { border-right: 0; } }
    @media (max-width: 860px) { .ab-grid, .ab-cards { grid-template-columns: minmax(0, 1fr); } .ab-sec { border-right: 0 !important; } .ab-side { position: static; } .ab-file { grid-template-columns: 16px minmax(0, 1fr) 28px; } .ab-file select { grid-column: 2 / 3; } }
  `],
})
export class AgentBuilderComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  credits = inject(CreditsService);
  fmt = fmtCredits;
  kinds = KINDS;
  packs = PACKS;
  steps = [{ key: 'describe', label: 'Say the job' }, { key: 'ask', label: 'Check a few things' }, { key: 'review', label: 'Review and create' }];
  step = signal<'describe' | 'ask' | 'review' | 'done'>('describe');
  stepIndex = computed(() => ({ describe: 0, ask: 1, review: 2, done: 3 })[this.step()]);
  prompt = signal('');
  pack = signal('');
  files = signal<{ file: File; kind: Kind }[]>([]);
  drag = signal(false);
  busy = signal(false);
  error = signal('');
  short = signal(false);
  session = signal('');
  questions = signal<any[]>([]);
  answers = signal<Record<string, any>>({});
  draft = signal<any>(null);
  label = signal('');
  created = signal<any>(null);
  agents = signal<any[]>([]);
  syncs = signal<{ platform_key: string; label: string }[]>([]);
  blankAsk = signal(false);
  blankName = signal('');
  buying = signal(false);
  requesting = signal(false);
  cost = computed(() => this.credits.price('ai_build') || 150);
  price = (k: string) => this.credits.price(k);
  inputFile = computed(() => this.files().find((f) => f.kind === 'input')?.file || null);
  answerFields = computed(() => { const d = this.draft(); if (!d) return []; const list = d.outputs.find((o: any) => o.type === 'list'); return list ? list.fields.filter((f: any) => f.key !== 'row') : d.outputs.filter((o: any) => o.key !== 'call_result'); });
  rules = computed(() => { const d = this.draft(); return d ? ['Never guesses a date or an amount', d.decision, ...(d.rules_from_sop || [])].filter(Boolean) : []; });

  ngOnInit(): void {
    if (!this.credits.wallet()) this.credits.refresh();
    this.api.agentList(false).then((l) => this.agents.set(l.agents || [])).catch(() => undefined);
    const org = this.auth.currentOrgId(); if (org) this.api.orgSyncPlatforms(org).then((p) => this.syncs.set(p || [])).catch(() => undefined);
  }
  has(k: Kind): boolean { return this.files().some((f) => f.kind === k); }
  nice(s: string): string { return String(s).replace(/_/g, ' '); }
  syncLabel(k: string): string { return k === 'none' || !k ? 'Echo only (download any time)' : this.syncs().find((s) => s.platform_key === k)?.label || k; }
  pickPack(k: string): void {
    const was = this.pack(); this.pack.set(was === k ? '' : k);
    if (was !== k && (!this.prompt().trim() || Object.values(PACK_TEXT).includes(this.prompt()))) this.prompt.set(PACK_TEXT[k]);
  }
  onDrop(e: DragEvent): void { e.preventDefault(); this.drag.set(false); this.addFiles(e.dataTransfer?.files || null); }
  addFiles(list: FileList | File[] | null): void {
    if (!list) return;
    const add = [...(list as File[])].filter((f) => f.size <= 25 * 1024 * 1024).map((file) => ({ file, kind: guessKind(file.name) }));
    if (add.length < list.length) this.error.set('Files can be up to 25 MB each; larger ones were left out.');
    this.files.update((cur) => [...cur.filter((c) => !add.some((a) => a.file.name === c.file.name)), ...add]);
  }
  setKind(i: number, k: Kind): void { this.files.update((l) => l.map((f, n) => (n === i ? { ...f, kind: k } : f))); }
  removeFile(i: number): void { this.files.update((l) => l.filter((_, n) => n !== i)); }
  async useSamples(): Promise<void> {
    this.busy.set(true);
    try {
      const base = document.baseURI;
      const got = await Promise.all(SAMPLES.map(async (n) => new File([await (await fetch(new URL('samples/' + n, base))).blob()], n)));
      this.addFiles(got);
      if (!this.prompt().trim()) { this.pack.set('supplier'); this.prompt.set(PACK_TEXT['supplier']); }
    } catch { this.error.set('The example files could not be loaded.'); }
    finally { this.busy.set(false); }
  }

  async analyze(): Promise<void> {
    this.busy.set(true); this.error.set('');
    try {
      const r = await this.api.builderAnalyze(this.prompt().trim(), this.pack(), this.files());
      this.session.set(r.session); this.questions.set(r.questions || []); this.draft.set(r.draft); this.label.set(r.draft.label);
      this.answers.set(Object.fromEntries((r.questions || []).map((q: any) => [q.id, q.default])));
      // Files the server classed differently keep the server's reading.
      this.files.update((l) => l.map((f) => ({ ...f, kind: (r.files || []).find((x: any) => x.name === f.file.name)?.kind || f.kind })));
      this.step.set(r.questions?.length ? 'ask' : 'review');
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }
  picked(q: any, o: string): boolean { const v = this.answers()[q.id]; return q.multi ? (v || []).includes(o) : v === o; }
  private timer: any = null;
  answer(q: any, o: string): void {
    this.answers.update((a) => {
      if (!q.multi) return { ...a, [q.id]: o };
      const cur: string[] = a[q.id] || []; const next = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o];
      return { ...a, [q.id]: next.length ? next : cur };
    });
    clearTimeout(this.timer); this.timer = setTimeout(() => this.sendAnswers(), 250);
  }
  private async sendAnswers(): Promise<void> {
    try { const r = await this.api.builderAnswers(this.session(), this.answers()); this.draft.set(r.draft); }
    catch (e: any) { this.error.set(e.message); }
  }
  async create(): Promise<void> {
    this.busy.set(true); this.error.set(''); this.short.set(false);
    try {
      clearTimeout(this.timer); await this.sendAnswers();
      const r = await this.api.builderCreate(this.session(), this.label().trim());
      this.created.set(r.agent); this.step.set('done'); this.credits.refresh();
    } catch (e: any) { this.error.set(e.message); this.short.set(/credits/i.test(e.message)); }
    finally { this.busy.set(false); }
  }
  async startCalling(a: any, file: File): Promise<void> {
    this.busy.set(true); this.error.set('');
    try {
      const c = await this.api.createCampaign({ agent: a.key, provider: 'gemini', direction: 'outbound', description: `First run from ${file.name}` });
      await this.api.uploadContacts(c.campaign_id, file, { dryRun: false });
      this.router.navigate(['/campaigns', c.campaign_id]);
    } catch (e: any) { this.error.set(e.message); }
    finally { this.busy.set(false); }
  }
  async blank(): Promise<void> {
    this.busy.set(true);
    try { const out = await this.api.createAgent({ label: this.blankName().trim(), description: '', ozonetel_campaign: '', ozonetel_type: '' }); this.router.navigate(['/agents', out.agent.key]); }
    catch (e: any) { this.error.set(e.message); this.blankAsk.set(false); }
    finally { this.busy.set(false); }
  }
  async copy(key: string): Promise<void> {
    if (!key) return;
    const a = this.agents().find((x) => x.key === key);
    try { const out = await this.api.createAgent({ label: `${a?.label || key} (copy)`, description: a?.description || '', copy_from: key, ozonetel_campaign: a?.ozonetel_campaign || '', ozonetel_type: '' }); this.router.navigate(['/agents', out.agent.key]); }
    catch (e: any) { this.error.set(e.message); }
  }
}
