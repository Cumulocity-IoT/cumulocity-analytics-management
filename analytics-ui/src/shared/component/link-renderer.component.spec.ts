import { TestBed } from '@angular/core/testing';
import { CellRendererContext } from '@c8y/ngx-components';
import { LinkRendererComponent } from './link-renderer.component';

describe('LinkRendererComponent', () => {
  const render = (item: Record<string, string>, value = 'https://github.com/o/r/blob/main/X.mon') => {
    TestBed.configureTestingModule({
      imports: [LinkRendererComponent],
      providers: [{ provide: CellRendererContext, useValue: { value, item } }]
    });
    const fixture = TestBed.createComponent(LinkRendererComponent);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
  };

  it('links to the cell value and shows the file name', () => {
    const link = render({ type: 'file', file: 'X.mon' });
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/blob/main/X.mon');
    expect(link.textContent?.trim()).toBe('X.mon');
  });

  it('appends a slash to directories', () => {
    expect(render({ type: 'dir', file: 'sub' }).textContent?.trim()).toBe('sub/');
  });
});
