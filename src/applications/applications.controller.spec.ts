import type { Claims } from '../auth/jwt/token.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

const claims = { sub: 'user-1' } as Claims;

describe('ApplicationsController', () => {
  const service = { apply: jest.fn(), list: jest.fn() };
  const controller = new ApplicationsController(
    service as unknown as ApplicationsService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('delegates apply without role checks', async () => {
    service.apply.mockResolvedValue({ success: true });
    await expect(controller.apply(claims, 'vacancy-1')).resolves.toEqual({
      success: true,
    });
    expect(service.apply).toHaveBeenCalledWith(claims, 'vacancy-1');
  });

  it('delegates owner application listing', async () => {
    service.list.mockResolvedValue({ applications: [] });
    await expect(controller.list(claims, 'vacancy-1')).resolves.toEqual({
      applications: [],
    });
    expect(service.list).toHaveBeenCalledWith(claims, 'vacancy-1');
  });
});
