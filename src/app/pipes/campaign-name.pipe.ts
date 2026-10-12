import { Pipe, PipeTransform } from '@angular/core';

/** A campaign sent from another system carries that system's id at the end of its name. People read the name, not the id. */
@Pipe({ name: 'campaignName', standalone: true })
export class CampaignNamePipe implements PipeTransform {
  transform(name: string | null | undefined): string {
    return (name || '').replace(/_[0-9a-f]{20,}$/i, '');
  }
}
