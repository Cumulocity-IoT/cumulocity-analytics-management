import { TestBed } from '@angular/core/testing';
import { CellRendererContext } from '@c8y/ngx-components';
import { LabelRendererComponent } from './label-renderer.component';

describe('LabelRendererComponent', () => {
  const render = (value: unknown) => {
    TestBed.configureTestingModule({
      imports: [LabelRendererComponent],
      providers: [{ provide: CellRendererContext, useValue: { value } }]
    });
    const fixture = TestBed.createComponent(LabelRendererComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('renders the cell value as a label', () => {
    const label = render('Input').querySelector('span.label');
    expect(label?.textContent?.trim()).toBe('Input');
    expect(label?.classList).toContain('label-primary');
  });

  it('renders an empty label for an empty value', () => {
    expect(render('').querySelector('span.label')?.textContent?.trim()).toBe('');
  });
});
