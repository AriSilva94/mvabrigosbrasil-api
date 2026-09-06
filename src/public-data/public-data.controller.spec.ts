import { MODULE_METADATA } from '@nestjs/common/constants';
import { PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../auth/decorators/public';
import { AppModule } from '../app.module';
import { PublicDataController } from './public-data.controller';
import { PublicDataModule } from './public-data.module';
import type { PublicDataService } from './public-data.service';

function methodTarget(method: string): object {
  return Object.getOwnPropertyDescriptor(PublicDataController.prototype, method)
    ?.value as object;
}

describe('PublicDataController', () => {
  const service = {
    getMapStatistics: jest.fn().mockResolvedValue({ byState: [], byType: {} }),
    getDatabaseDataset: jest.fn().mockResolvedValue({
      shelters: [],
      movements: [],
      years: [],
      states: [],
    }),
  };
  const controller = new PublicDataController(
    service as unknown as PublicDataService,
  );

  it('delegates both routes', async () => {
    await expect(controller.getMapStatistics()).resolves.toEqual({
      byState: [],
      byType: {},
    });
    await expect(controller.getDatabaseDataset()).resolves.toMatchObject({
      shelters: [],
      movements: [],
    });
  });

  it('uses the public base route and exact handler paths', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PublicDataController)).toBe(
      'public',
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, methodTarget('getMapStatistics')),
    ).toBe('map-statistics');
    expect(
      Reflect.getMetadata(PATH_METADATA, methodTarget('getDatabaseDataset')),
    ).toBe('database-dataset');
  });

  it('marks both handlers as public', () => {
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, methodTarget('getMapStatistics')),
    ).toBe(true);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, methodTarget('getDatabaseDataset')),
    ).toBe(true);
  });
});

describe('PublicDataModule registration', () => {
  it('is imported by AppModule', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    ) as unknown[];
    expect(imports).toContain(PublicDataModule);
  });
});
