import { TestBed } from '@angular/core/testing';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { ExtensionListComponent } from './extension-list.component';

describe('ExtensionListComponent', () => {
  const render = (props: Record<string, unknown>) => {
    TestBed.configureTestingModule({ imports: [ExtensionListComponent] });
    const fixture = TestBed.createComponent(ExtensionListComponent);
    fixture.componentInstance.field = { props } as FormlyFieldConfig;
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('lists the extension names numbered from 1', () => {
    const rows = Array.from(render({ extensionNames: ['Alpha', 'Beta'] }).querySelectorAll('.extension-row'));
    expect(rows.map(r => r.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['1 Alpha', '2 Beta']);
  });

  it('shows a hint when the package contains no extensions', () => {
    for (const names of [[], undefined]) {
      TestBed.resetTestingModule();
      const el = render({ extensionNames: names });
      expect(el.querySelector('.no-extensions')?.textContent).toContain('No extensions found');
      expect(el.querySelector('.extension-table')).toBeNull();
    }
  });

  it('renders nothing when hidden', () => {
    expect(render({ hidden: true, extensionNames: ['A'] }).querySelector('.extension-list-container')).toBeNull();
  });
});
