import { BadRequestException, HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { Claims } from '../auth/jwt/token.service';
import { TeamController } from './team.controller';
import type { TeamService } from './team.service';

const claims = { sub: 'creator-id' } as Claims;

function methodTarget(method: string): object {
  return Object.getOwnPropertyDescriptor(TeamController.prototype, method)
    ?.value as object;
}

describe('TeamController', () => {
  const service = {
    listUsers: jest.fn(),
    toggleUser: jest.fn(),
  };
  const controller = new TeamController(service as unknown as TeamService);

  beforeEach(() => jest.clearAllMocks());

  it('delegates listing with the authenticated subject', async () => {
    service.listUsers.mockResolvedValue({ users: [] });
    await expect(controller.listUsers(claims)).resolves.toEqual({ users: [] });
    expect(service.listUsers).toHaveBeenCalledWith('creator-id');
  });

  it('rejects a toggle without userId using the literal contract error', () => {
    let thrown: unknown;
    try {
      void controller.toggleUser(claims, { disable: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toEqual({
      error: 'ID do usuário é obrigatório.',
    });
    expect(service.toggleUser).not.toHaveBeenCalled();
  });

  it('coerces disable to boolean and delegates the toggle', async () => {
    service.toggleUser.mockResolvedValue({ ok: true });
    await expect(
      controller.toggleUser(claims, { userId: 'member-id', disable: 1 }),
    ).resolves.toEqual({ ok: true });
    expect(service.toggleUser).toHaveBeenCalledWith(
      'creator-id',
      'member-id',
      true,
    );
  });

  it('keeps POST /team/users/toggle on status 200', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, methodTarget('toggleUser')),
    ).toBe(HttpStatus.OK);
  });
});
