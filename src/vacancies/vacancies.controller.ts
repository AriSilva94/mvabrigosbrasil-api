import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user';
import { Public } from '../auth/decorators/public';
import type { Claims } from '../auth/jwt/token.service';
import { RequireTeamActive } from '../common/decorators/team-active';
import { TeamActiveGuard } from '../common/guards/team-active.guard';
import { vacancyFormSchema } from './schemas/vacancy.schema';
import { VacanciesService } from './vacancies.service';

function parseVacancyForm(body: unknown) {
  const parsed = vacancyFormSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      error: parsed.error.issues[0]?.message || 'Dados inválidos.',
    });
  }
  return parsed.data;
}

@Controller('vacancies')
export class VacanciesController {
  constructor(private readonly service: VacanciesService) {}

  @Get()
  list(@CurrentUser() claims: Claims) {
    return this.service.list(claims);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequireTeamActive()
  @UseGuards(TeamActiveGuard)
  create(@CurrentUser() claims: Claims, @Body() body: unknown) {
    return this.service.create(claims, parseVacancyForm(body));
  }

  @Get(':id/my-status')
  @Public()
  getMyStatus(
    @CurrentUser() claims: Claims | undefined,
    @Param('id') id: string,
  ) {
    return this.service.getMyStatus(claims, id);
  }

  @Get(':id')
  get(@CurrentUser() claims: Claims, @Param('id') id: string) {
    return this.service.get(claims, id);
  }

  @Put(':id')
  @RequireTeamActive()
  @UseGuards(TeamActiveGuard)
  update(
    @CurrentUser() claims: Claims,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(claims, id, parseVacancyForm(body));
  }

  @Delete(':id')
  @RequireTeamActive()
  @UseGuards(TeamActiveGuard)
  remove(@CurrentUser() claims: Claims, @Param('id') id: string) {
    return this.service.remove(claims, id);
  }
}

@Controller('public/vacancies')
export class PublicVacanciesController {
  constructor(private readonly service: VacanciesService) {}

  @Get()
  @Public()
  list() {
    return this.service.listPublic();
  }

  @Get(':slug')
  @Public()
  get(@Param('slug') slug: string) {
    return this.service.getPublic(slug);
  }
}
