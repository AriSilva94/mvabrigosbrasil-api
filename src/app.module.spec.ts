import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from './app.module';
import { VolunteersModule } from './volunteers/volunteers.module';

describe('AppModule', () => {
  it('registers VolunteersModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as
      unknown[] | undefined;

    expect(imports).toContain(VolunteersModule);
  });
});
