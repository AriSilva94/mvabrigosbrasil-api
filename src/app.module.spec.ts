import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from './app.module';
import { AdminModule } from './admin/admin.module';
import { TeamModule } from './team/team.module';
import { VolunteersModule } from './volunteers/volunteers.module';
import { PublicDataModule } from './public-data/public-data.module';

describe('AppModule', () => {
  it('registers VolunteersModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as
      unknown[] | undefined;

    expect(imports).toContain(VolunteersModule);
  });

  it('registers TeamModule and AdminModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as
      unknown[] | undefined;

    expect(imports).toContain(TeamModule);
    expect(imports).toContain(AdminModule);
  });

  it('registers PublicDataModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as
      unknown[] | undefined;

    expect(imports).toContain(PublicDataModule);
  });
});
