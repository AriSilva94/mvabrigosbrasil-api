import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user';
import type { Claims } from '../auth/jwt/token.service';
import { RequireTeamActive } from '../common/decorators/team-active';
import { TeamActiveGuard } from '../common/guards/team-active.guard';
import { DynamicsService } from './dynamics.service';
import { deleteSchema, submitSchema } from './schemas/dynamics.schema';

const PRISMA_INT_MAX = 2_147_483_647;

function invalidPayload(details: unknown): BadRequestException {
  return new BadRequestException({ error: 'invalid_payload', details });
}

function parseShelterWpPostId(value?: string): number | null {
  if (value === undefined || value === '') return null;
  if (!/^\d+$/.test(value)) {
    throw invalidPayload({
      formErrors: [],
      fieldErrors: { shelter_id: ['shelter_id inválido'] },
    });
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > PRISMA_INT_MAX) {
    throw invalidPayload({
      formErrors: [],
      fieldErrors: { shelter_id: ['shelter_id inválido'] },
    });
  }
  return parsed;
}

@Controller('dynamics')
export class DynamicsController {
  constructor(private readonly dynamicsService: DynamicsService) {}

  @Get()
  getDynamics(
    @CurrentUser() claims: Claims,
    @Query('shelter_id') shelterId?: string,
  ) {
    return this.dynamicsService.getDynamics(
      claims,
      parseShelterWpPostId(shelterId),
    );
  }

  @Get('summary')
  getSummary(
    @CurrentUser() claims: Claims,
    @Query('shelter_id') shelterId?: string,
  ) {
    return this.dynamicsService.getSummary(
      claims,
      parseShelterWpPostId(shelterId),
    );
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequireTeamActive()
  @UseGuards(TeamActiveGuard)
  saveDynamics(@CurrentUser() claims: Claims, @Body() body: unknown) {
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidPayload(parsed.error.flatten((issue) => issue.message));
    }
    return this.dynamicsService.saveDynamics(claims, parsed.data);
  }

  @Delete()
  @RequireTeamActive()
  @UseGuards(TeamActiveGuard)
  deleteDynamics(@CurrentUser() claims: Claims, @Body() body: unknown) {
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidPayload(parsed.error.flatten((issue) => issue.message));
    }
    return this.dynamicsService.deleteDynamics(claims, parsed.data.id);
  }
}
