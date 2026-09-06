import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VacanciesModule } from '../vacancies/vacancies.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [PrismaModule, VacanciesModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
