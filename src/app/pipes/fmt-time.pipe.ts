import { Pipe, PipeTransform } from '@angular/core';
import { fmtTime } from '../utils/format';

@Pipe({ name: 'fmtTime', standalone: true })
export class FmtTimePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return fmtTime(value);
  }
}
