import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicDataController } from './public-data.controller';
import { PublicDataService } from './public-data.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicDataController],
  providers: [PublicDataService],
})
export class PublicDataModule {}
