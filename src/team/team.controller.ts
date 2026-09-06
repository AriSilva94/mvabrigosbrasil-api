import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user';
import type { Claims } from '../auth/jwt/token.service';
import { TeamService } from './team.service';

type ToggleBody = {
  userId?: unknown;
  disable?: unknown;
};

@Controller('team/users')
export class TeamController {
  constructor(private readonly service: TeamService) {}

  @Get()
  listUsers(@CurrentUser() claims: Claims) {
    return this.service.listUsers(claims.sub);
  }

  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  toggleUser(@CurrentUser() claims: Claims, @Body() body: ToggleBody) {
    if (typeof body.userId !== 'string' || !body.userId) {
      throw new BadRequestException({
        error: 'ID do usuário é obrigatório.',
      });
    }
    return this.service.toggleUser(
      claims.sub,
      body.userId,
      Boolean(body.disable),
    );
  }
}
