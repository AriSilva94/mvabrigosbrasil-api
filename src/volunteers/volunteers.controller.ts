import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user';
import { Public } from '../auth/decorators/public';
import type { Claims } from '../auth/jwt/token.service';
import { RequireTeamActive } from '../common/decorators/team-active';
import { TeamActiveGuard } from '../common/guards/team-active.guard';
import { volunteerProfileSchema } from './schemas/volunteer-profile.schema';
import { VolunteersService } from './volunteers.service';

function parseProfile(body: unknown) {
  const parsed = volunteerProfileSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      error: parsed.error.issues[0]?.message || 'Dados inválidos.',
    });
  }
  return parsed.data;
}

@Controller('volunteers')
export class VolunteersController {
  constructor(private readonly service: VolunteersService) {}

  @Get('me')
  getMe(@CurrentUser() claims: Claims) {
    return this.service.getMe(claims);
  }

  @Post('me')
  @HttpCode(HttpStatus.OK)
  @RequireTeamActive()
  @UseGuards(TeamActiveGuard)
  saveMe(@CurrentUser() claims: Claims, @Body() body: unknown) {
    return this.service.saveMe(claims, parseProfile(body));
  }

  @Get()
  @Public()
  listPublic() {
    return this.service.listPublic();
  }

  @Get(':slug')
  @Public()
  getPublic(@Param('slug') slug: string) {
    return this.service.getPublic(slug);
  }
}
