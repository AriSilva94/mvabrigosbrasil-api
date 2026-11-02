import { hasChanges } from './diff';

describe('hasChanges', () => {
  it('returns true when current is null', () => {
    expect(hasChanges(null, { name: 'Abrigo' })).toBe(true);
  });

  it('compares arrays shallowly and in order', () => {
    expect(
      hasChanges({ tags: ['dogs', 'cats'] }, { tags: ['dogs', 'cats'] }),
    ).toBe(false);
    expect(
      hasChanges({ tags: ['dogs', 'cats'] }, { tags: ['cats', 'dogs'] }),
    ).toBe(true);
  });

  it('treats null and undefined as equivalent for scalar values', () => {
    expect(hasChanges({ phone: null }, { phone: undefined })).toBe(false);
    expect(hasChanges({}, { phone: null })).toBe(false);
  });
});
