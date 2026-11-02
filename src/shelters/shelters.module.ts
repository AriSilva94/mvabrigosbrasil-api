import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { TeamActiveGuard } from '../common/guards/team-active.guard';
import { SheltersController } from './shelters.controller';
import { SheltersService } from './shelters.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [SheltersController],
  providers: [SheltersService, TeamActiveGuard],
})
export class SheltersModule {}
