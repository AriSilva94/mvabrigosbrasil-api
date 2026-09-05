import { ExecutionContext } from '@nestjs/common';
import { Claims } from '../jwt/token.service';

// createParamDecorator wraps the factory in Nest's param-decorator plumbing,
// so we exercise the underlying factory function directly, the same way
// Nest's own tests for custom param decorators do.
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user';

function getParamDecoratorFactory(decorator: () => ParameterDecorator) {
  class Test {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public test(@decorator() _value: unknown) {
      /* noop */
    }
  }

  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Test, 'test') as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => unknown }
  >;
  return Object.values(args)[0].factory;
}

describe('@CurrentUser', () => {
  it('returns req.user', () => {
    const claims: Claims = {
      sub: 'user-1',
      email: 'user@example.com',
      role: 'admin',
      isTeamOnly: false,
      teamDisabled: false,
      creatorProfileId: null,
      sid: 'session-1',
    };

    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: claims }),
      }),
    } as unknown as ExecutionContext;

    const factory = getParamDecoratorFactory(CurrentUser);
    expect(factory(undefined, ctx)).toEqual(claims);
  });

  it('returns undefined when req.user is not set', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;

    const factory = getParamDecoratorFactory(CurrentUser);
    expect(factory(undefined, ctx)).toBeUndefined();
  });
});
