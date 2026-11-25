import { RepositoryItem } from '../../shared';
import { evaluateContent, isSection, toBuildInput } from './extension-wizard.logic';

const item = (over: Partial<RepositoryItem>): RepositoryItem =>
  ({
    id: over.name ?? 'x',
    name: 'x',
    url: '',
    downloadUrl: '',
    type: 'file',
    file: 'x.mon',
    repositoryName: 'R',
    repositoryId: 'r',
    ...over
  }) as RepositoryItem;

describe('extension wizard content rules', () => {
  const yaml = item({ name: 'extensions.yaml', file: 'extensions.yaml' });
  const sectionA = item({ name: 'Python', extensionsYamlItem: yaml, sectionFiles: ['Python.mon'] });
  const sectionB = item({ name: 'Other', extensionsYamlItem: yaml, sectionFiles: ['Python.mon'] });
  const none = new Set<string>();

  it('marks installed items and non-monitor files as not selectable', () => {
    const state = evaluateContent(
      [
        item({ name: 'A', installed: true }),
        item({ name: 'B', file: 'B.py' }),
        item({ name: 'C' })
      ],
      none,
      true
    );
    expect(state.get('A')).toEqual({ disabled: true, reason: 'Already installed' });
    expect(state.get('B')?.reason).toBe('Not a monitor file');
    expect(state.get('C')?.disabled).toBeFalse();
  });

  it('keeps directories selectable', () => {
    const state = evaluateContent([item({ name: 'D', type: 'dir', file: 'D' })], none, true);
    expect(state.get('D')?.disabled).toBeFalse();
  });

  it('blocks sections without the backend', () => {
    const state = evaluateContent([sectionA], none, false);
    expect(state.get('Python')?.reason).toBe('Needs the backend service');
  });

  it('does not allow mixing sections and individual files, in either order', () => {
    const file = item({ name: 'F' });
    expect(evaluateContent([sectionA, file], new Set(['Python']), true).get('F')?.reason).toBe(
      'Cannot be combined with extensions.yaml sections'
    );
    expect(evaluateContent([sectionA, file], new Set(['F']), true).get('Python')?.reason).toBe(
      'Cannot be combined with individual files'
    );
  });

  it('blocks a second item that defines the same block and names the first', () => {
    const a = item({ name: 'A', blockIds: ['com.x.Block'] });
    const b = item({ name: 'B', blockIds: ['com.x.Block'] });
    const state = evaluateContent([a, b], new Set(['A']), true);
    expect(state.get('B')).toEqual({
      disabled: true,
      reason: 'Defines the same block as "{{blockName}}"',
      conflictsWith: 'A'
    });
    expect(state.get('A')?.disabled).toBeFalse();
  });

  it('compares sections by their monitor files', () => {
    const state = evaluateContent([sectionA, sectionB], new Set(['Python']), true);
    expect(state.get('Other')?.conflictsWith).toBe('Python');
  });

  it('builds the create input for sections and for files', () => {
    expect(toBuildInput([sectionA, item({ name: 'F' })], new Set(['Python']))).toEqual({
      sections: ['Python'],
      monitors: [yaml]
    });
    const f = item({ name: 'F' });
    expect(toBuildInput([f], new Set(['F']))).toEqual({ sections: [], monitors: [f] });
    expect(isSection(sectionA)).toBeTrue();
  });
});
