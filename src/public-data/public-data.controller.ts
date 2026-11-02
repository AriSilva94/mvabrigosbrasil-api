import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public';
import { PublicDataService } from './public-data.service';

@Controller('public')
export class PublicDataController {
  constructor(private readonly publicData: PublicDataService) {}

  @Public()
  @Get('map-statistics')
  getMapStatistics() {
    return this.publicData.getMapStatistics();
  }

  @Public()
  @Get('database-dataset')
  getDatabaseDataset() {
    return this.publicData.getDatabaseDataset();
  }
}
