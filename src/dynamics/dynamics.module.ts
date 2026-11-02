import { Module } from '@nestjs/common';
import { TeamActiveGuard } from '../common/guards/team-active.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { DynamicsController } from './dynamics.controller';
import { DynamicsService } from './dynamics.service';

@Module({
  imports: [PrismaModule],
  controllers: [DynamicsController],
  providers: [DynamicsService, TeamActiveGuard],
})
export class DynamicsModule {}
