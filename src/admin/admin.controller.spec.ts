import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles';
import type { Claims } from '../auth/jwt/token.service';
import { AdminController } from './admin.controller';
import type { AdminService } from './admin.service';

function methodTarget(method: string): object {
  return Object.getOwnPropertyDescriptor(AdminController.prototype, method)
    ?.value as object;
}

describe('AdminController', () => {
  const service = {
    listManagers: jest.fn(),
    replaceManagerShelters: jest.fn(),
    listMyShelters: jest.fn(),
  };
  const controller = new AdminController(service as unknown as AdminService);

  beforeEach(() => jest.clearAllMocks());

  it('applies admin and gerente role metadata to the correct handlers', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, methodTarget('listManagers')),
    ).toEqual(['admin']);
    expect(
      Reflect.getMetadata(ROLES_KEY, methodTarget('replaceManagerShelters')),
    ).toEqual(['admin']);
    expect(
      Reflect.getMetadata(ROLES_KEY, methodTarget('listMyShelters')),
    ).toEqual(['gerente']);
  });

  it('rejects a non-array shelter_ids payload with the literal error', () => {
    let thrown: unknown;
    try {
      void controller.replaceManagerShelters('manager-id', {
        shelter_ids: 'bad',
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toEqual({
      error: 'shelter_ids deve ser um array',
    });
  });

  it('delegates manager shelter replacement', async () => {
    service.replaceManagerShelters.mockResolvedValue({ success: true });
    await expect(
      controller.replaceManagerShelters('manager-id', {
        shelter_ids: ['shelter-id'],
      }),
    ).resolves.toEqual({ success: true });
    expect(service.replaceManagerShelters).toHaveBeenCalledWith('manager-id', [
      'shelter-id',
    ]);
  });

  it('delegates manager self lookup with claims.sub', async () => {
    service.listMyShelters.mockResolvedValue({ shelters: [] });
    await expect(
      controller.listMyShelters({ sub: 'manager-id' } as Claims),
    ).resolves.toEqual({ shelters: [] });
    expect(service.listMyShelters).toHaveBeenCalledWith('manager-id');
  });
});
