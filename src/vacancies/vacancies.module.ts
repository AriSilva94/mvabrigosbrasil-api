import { Module } from '@nestjs/common';
import { TeamActiveGuard } from '../common/guards/team-active.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { VacancyResolver } from './vacancy-resolver';
import {
  PublicVacanciesController,
  VacanciesController,
} from './vacancies.controller';
import { VacanciesService } from './vacancies.service';

@Module({
  imports: [PrismaModule],
  controllers: [VacanciesController, PublicVacanciesController],
  providers: [VacanciesService, VacancyResolver, TeamActiveGuard],
  exports: [VacancyResolver],
})
export class VacanciesModule {}
