import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user';
import { Roles } from '../auth/decorators/roles';
import type { Claims } from '../auth/jwt/token.service';
import { RequireTeamActive } from '../common/decorators/team-active';
import { TeamActiveGuard } from '../common/guards/team-active.guard';
import { shelterProfileSchema } from './schemas/shelter-profile.schema';
import { SheltersService } from './shelters.service';

@Controller()
export class SheltersController {
  constructor(private readonly sheltersService: SheltersService) {}

  @Get('profile/validate')
  validateProfile(@CurrentUser() user: Claims) {
    return this.sheltersService.validateProfile(user.sub);
  }

  @Get('shelters/me')
  getMyShelter(@CurrentUser() user: Claims) {
    return this.sheltersService.getMyShelter(user.sub);
  }

  @Post('shelters/me')
  @RequireTeamActive()
  @UseGuards(TeamActiveGuard)
  upsertMyShelter(@CurrentUser() user: Claims, @Body() body: unknown) {
    const parsed = shelterProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message || 'Dados inválidos.',
      );
    }

    return this.sheltersService.upsertMyShelter(user.sub, parsed.data);
  }

  @Post('shelters/me/deactivate')
  @RequireTeamActive()
  @UseGuards(TeamActiveGuard)
  deactivateMyShelter(@CurrentUser() user: Claims) {
    return this.sheltersService.toggleMyShelterActive(user.sub);
  }

  @Get('shelters/me/history')
  getMyShelterHistory(
    @CurrentUser() user: Claims,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.sheltersService.getMyShelterHistory(
      user.sub,
      parseInt(limit || '50', 10),
      parseInt(offset || '0', 10),
    );
  }

  @Get('shelters/check-address')
  checkAddress(
    @CurrentUser() user: Claims,
    @Query('cep') cep?: string,
    @Query('street') street?: string,
    @Query('number') number?: string,
  ) {
    return this.sheltersService.checkAddress(user.sub, cep, street, number);
  }

  @Get('shelters')
  @Roles('admin')
  listSheltersForAdmin() {
    return this.sheltersService.listSheltersForAdmin();
  }
}
