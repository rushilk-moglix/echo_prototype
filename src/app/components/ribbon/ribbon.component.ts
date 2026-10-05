import { Component, Input, computed } from '@angular/core';

@Component({
  selector: 'app-ribbon',
  standalone: true,
  template: `
    @if (!shape) {
      <span class="ribbon-empty">no turns</span>
    } @else {
      <div class="ribbon" role="img" [attr.aria-label]="ariaLabel">
        @for (t of displayTurns(); track $index) {
          <span [class]="'ribbon-seg ' + t"></span>
        }
      </div>
    }
  `,
})
export class RibbonComponent {
  @Input() shape = '';
  @Input() max = 32;
  displayTurns = computed(() => {
    if (!this.shape) return [];
    let turns = this.shape.split('');
    if (turns.length > this.max) {
      const step = turns.length / this.max;
      turns = Array.from({ length: this.max }, (_, i) => turns[Math.floor(i * step)]);
    }
    return turns;
  });
  get ariaLabel(): string {
    if (!this.shape) return '';
    return `${this.shape.length} turns, ${(this.shape.match(/u/g) || []).length} from the caller`;
  }
}
