import { TestBed } from '@angular/core/testing';
import { CellRendererContext } from '@c8y/ngx-components';
import { BooleanRendererComponent } from './boolean-renderer.component';

describe('BooleanRendererComponent', () => {
  const create = (value: unknown) => {
    TestBed.configureTestingModule({
      imports: [BooleanRendererComponent],
      providers: [{ provide: CellRendererContext, useValue: { value } }]
    });
    // The template only needs the c8yIcon directive; keep the rendering out of this logic test.
    TestBed.overrideComponent(BooleanRendererComponent, { set: { template: '', imports: [] } });
    return TestBed.createComponent(BooleanRendererComponent).componentInstance;
  };

  it('exposes the cell context to its template', () => {
    expect(create(true).context.value).toBeTrue();
  });

  it('is created for falsy values too', () => {
    expect(create(false).context.value).toBeFalse();
  });
});
