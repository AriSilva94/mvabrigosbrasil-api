import { Module } from '@nestjs/common';
import { TeamActiveGuard } from '../common/guards/team-active.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { VolunteersController } from './volunteers.controller';
import { VolunteersService } from './volunteers.service';

@Module({
  imports: [PrismaModule],
  controllers: [VolunteersController],
  providers: [VolunteersService, TeamActiveGuard],
})
export class VolunteersModule {}
