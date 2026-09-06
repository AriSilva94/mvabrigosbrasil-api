import { Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user';
import type { Claims } from '../auth/jwt/token.service';
import { ApplicationsService } from './applications.service';

@Controller('vacancies/:id')
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}

  @Post('apply')
  apply(@CurrentUser() claims: Claims, @Param('id') id: string) {
    return this.service.apply(claims, id);
  }

  @Get('applications')
  list(@CurrentUser() claims: Claims, @Param('id') id: string) {
    return this.service.list(claims, id);
  }
}
