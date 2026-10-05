import { Pipe, PipeTransform } from '@angular/core';
import { fmtNum } from '../utils/format';

@Pipe({ name: 'fmtNum', standalone: true })
export class FmtNumPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return fmtNum(value);
  }
}
