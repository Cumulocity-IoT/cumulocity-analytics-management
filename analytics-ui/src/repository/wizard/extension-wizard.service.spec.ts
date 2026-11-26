import { TestBed } from '@angular/core/testing';
import { BottomDrawerService } from '@c8y/ngx-components';
import { Subject } from 'rxjs';
import { ExtensionWizardComponent } from './extension-wizard.component';
import { ExtensionWizardService } from './extension-wizard.service';

describe('ExtensionWizardService', () => {
  let drawers: jasmine.SpyObj<BottomDrawerService>;
  let closed$: Subject<void>;
  let instance: { added: boolean };
  let service: ExtensionWizardService;

  beforeEach(() => {
    closed$ = new Subject<void>();
    instance = { added: false };
    drawers = jasmine.createSpyObj('BottomDrawerService', ['openDrawer']);
    drawers.openDrawer.and.returnValue({ onClosed$: closed$, instance } as never);
    TestBed.configureTestingModule({
      providers: [{ provide: BottomDrawerService, useValue: drawers }]
    });
    service = TestBed.inject(ExtensionWizardService);
  });

  it('opens the wizard in a drawer and passes the optional first source', () => {
    service.open('build');
    const [component, options] = drawers.openDrawer.calls.mostRecent().args as [unknown, any];
    expect(component).toBe(ExtensionWizardComponent);
    expect(options.initialState).toEqual({
      initialSource: 'build',
      initialRepositoryId: null,
      initialSelectedIds: []
    });
    expect(options.closeOnNavigation).toBeTrue();
  });

  it('starts a build with the blocks that are already ticked', () => {
    service.open({ repositoryId: 'r1', selectedIds: ['A', 'B'] });
    const [, options] = drawers.openDrawer.calls.mostRecent().args as [unknown, any];
    expect(options.initialState).toEqual({
      initialSource: null,
      initialRepositoryId: 'r1',
      initialSelectedIds: ['A', 'B']
    });
  });

  it('emits once when the drawer closes, with whether an extension was added', () => {
    const seen: boolean[] = [];
    service.open().subscribe(v => seen.push(v));
    instance.added = true;
    closed$.next();
    expect(seen).toEqual([true]);
  });

  it('reports nothing added when the drawer is dismissed', () => {
    const seen: boolean[] = [];
    service.open().subscribe(v => seen.push(v));
    closed$.next();
    expect(seen).toEqual([false]);
  });
});
