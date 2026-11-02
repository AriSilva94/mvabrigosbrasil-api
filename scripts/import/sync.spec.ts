import { parseSyncArgs } from './sync';

describe('sync CLI', () => {
  it.each([{ args: [] }, { args: ['--dry-run'] }])(
    'defaults to preview for $args',
    ({ args }) => {
      expect(parseSyncArgs(args)).toEqual({ apply: false });
    },
  );

  it('requires explicit maintenance mode to apply', () => {
    expect(() => parseSyncArgs(['--apply'])).toThrow(/maintenance/);
    expect(parseSyncArgs(['--apply', '--maintenance'])).toEqual({
      apply: true,
    });
  });

  it.each([
    { args: ['--apply', '--maintenance', '--dry-run'] },
    { args: ['--force'] },
    { args: ['--only=users'] },
  ])('rejects contradictory or unsupported options $args', ({ args }) => {
    expect(() => parseSyncArgs(args)).toThrow();
  });
});
