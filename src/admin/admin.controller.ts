import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user';
import { Roles } from '../auth/decorators/roles';
import type { Claims } from '../auth/jwt/token.service';
import { AdminService } from './admin.service';

type ShelterIdsBody = { shelter_ids?: unknown };

@Controller('admin/managers')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get()
  @Roles('admin')
  listManagers() {
    return this.service.listManagers();
  }

  @Get('me/shelters')
  @Roles('gerente')
  listMyShelters(@CurrentUser() claims: Claims) {
    return this.service.listMyShelters(claims.sub);
  }

  @Put(':managerId/shelters')
  @Roles('admin')
  replaceManagerShelters(
    @Param('managerId') managerId: string,
    @Body() body: ShelterIdsBody,
  ) {
    if (!Array.isArray(body.shelter_ids)) {
      throw new BadRequestException({
        error: 'shelter_ids deve ser um array',
      });
    }
    return this.service.replaceManagerShelters(
      managerId,
      body.shelter_ids as string[],
    );
  }
}
