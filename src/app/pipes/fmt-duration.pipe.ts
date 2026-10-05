import { Pipe, PipeTransform } from '@angular/core';
import { fmtDuration } from '../utils/format';

@Pipe({ name: 'fmtDuration', standalone: true })
export class FmtDurationPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return fmtDuration(value);
  }
}
