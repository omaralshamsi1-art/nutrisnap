import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Public, UserId } from './auth/auth.guard';
import { isIsoDate } from './common/dates';
import { Profile } from './common/types';
import { EnergySampleInput, EnergyService } from './energy/energy.service';
import { WhoopService } from './integrations/whoop/whoop.service';
import { AnalyzeHints, MealPatch, MealsService } from './meals/meals.service';
import { ProfileService } from './profile/profile.service';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  ok() {
    return { ok: true };
  }
}

@Controller('meals')
export class MealsController {
  constructor(private readonly meals: MealsService) {}

  /** multipart/form-data: photo=<file>, mealName?, restaurant?, portion?, note?, eatenAt? */
  @Post('analyze')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  analyze(@UserId() userId: string, @UploadedFile() photo: Express.Multer.File, @Body() hints: AnalyzeHints) {
    if (!photo) throw new BadRequestException('photo file is required');
    return this.meals.analyzePhoto(userId, photo.buffer, photo.mimetype, hints);
  }

  @Post()
  create(@UserId() userId: string, @Body() body: any) {
    return this.meals.createManual(userId, body);
  }

  @Get()
  list(@UserId() userId: string, @Query('date') date: string) {
    if (!isIsoDate(date)) throw new BadRequestException('date=YYYY-MM-DD required');
    return this.meals.list(userId, date);
  }

  @Get(':id')
  get(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.meals.get(userId, id);
  }

  @Patch(':id')
  update(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string, @Body() patch: MealPatch) {
    return this.meals.update(userId, id, patch);
  }

  @Post(':id/confirm')
  confirm(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.meals.confirm(userId, id);
  }

  @Delete(':id')
  remove(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.meals.remove(userId, id);
  }
}

@Controller()
export class EnergyController {
  constructor(private readonly energy: EnergyService) {}

  /** Devices push daily burn here (Apple Health from iOS, Health Connect from Android, Garmin/Fitbit bridges…). */
  @Post('energy/samples')
  ingest(@UserId() userId: string, @Body() body: { samples: EnergySampleInput[] }) {
    return this.energy.ingest(userId, body?.samples);
  }

  @Get('balance')
  balance(@UserId() userId: string, @Query('date') date?: string) {
    return this.energy.balance(userId, date);
  }
}

@Controller('profile')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  get(@UserId() userId: string) {
    return this.profiles.get(userId);
  }

  @Put()
  update(@UserId() userId: string, @Body() body: Partial<Profile>) {
    return this.profiles.update(userId, body);
  }
}

@Controller('integrations/whoop')
export class WhoopController {
  constructor(
    private readonly whoop: WhoopService,
    private readonly config: ConfigService,
  ) {}

  /** App calls this, then opens the returned URL in ASWebAuthenticationSession. */
  @Get('connect')
  connect(@UserId() userId: string) {
    return { url: this.whoop.authorizeUrl(userId) };
  }

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    const app = this.config.get<string>('APP_CALLBACK_URL') ?? 'nutrisnap://whoop';
    if (error || !code) return res.redirect(`${app}?status=error&reason=${encodeURIComponent(error ?? 'no_code')}`);
    try {
      await this.whoop.handleCallback(code, state);
      return res.redirect(`${app}?status=connected`);
    } catch (e: any) {
      return res.redirect(`${app}?status=error&reason=${encodeURIComponent(e?.message ?? 'failed')}`);
    }
  }

  @Get('status')
  status(@UserId() userId: string) {
    return this.whoop.status(userId);
  }

  @Post('sync')
  sync(@UserId() userId: string, @Query('from') from: string, @Query('to') to?: string) {
    if (!isIsoDate(from) || (to && !isIsoDate(to))) throw new BadRequestException('from/to must be YYYY-MM-DD');
    return this.whoop.sync(userId, from, to ?? from);
  }

  @Delete()
  disconnect(@UserId() userId: string) {
    return this.whoop.disconnect(userId);
  }
}
