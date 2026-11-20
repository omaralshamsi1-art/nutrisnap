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
import { PlanService } from './plan/plan.service';
import { WorkoutInput, WorkoutsService } from './workouts/workouts.service';
import { Workout } from './common/types';
import { validateProfilePatch } from './profile/profile.service';

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
  connect(@UserId() userId: string, @Query('target') target?: string) {
    return { url: this.whoop.authorizeUrl(userId, target === 'web' ? 'web' : 'app') };
  }

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    const web = `${(this.config.get<string>('PUBLIC_BASE_URL') ?? '').replace(/\/$/, '')}/app/`;
    const app =
      this.whoop.callbackTarget(state) === 'web' ? `${web}#whoop` : (this.config.get<string>('APP_CALLBACK_URL') ?? 'nutrisnap://whoop');
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

@Controller()
export class PlanController {
  constructor(private readonly plans: PlanService) {}

  @Get('plan')
  plan(@UserId() userId: string) {
    return this.plans.plan(userId);
  }

  /** Live preview for onboarding — nothing is saved. */
  @Post('plan/preview')
  preview(@UserId() userId: string, @Body() body: Partial<Profile>) {
    return this.plans.plan(userId, validateProfilePatch(body));
  }

  @Get('weights')
  weights(@UserId() userId: string, @Query('days') days?: string) {
    return this.plans.weights(userId, Number(days) || 90);
  }

  @Post('weights')
  addWeight(@UserId() userId: string, @Body() body: { kg: number; date?: string }) {
    return this.plans.addWeight(userId, { kg: body?.kg, date: body?.date, source: 'manual' });
  }

  @Delete('weights/:date')
  deleteWeight(@UserId() userId: string, @Param('date') date: string) {
    return this.plans.deleteWeight(userId, date);
  }

  @Get('history')
  history(@UserId() userId: string, @Query('days') days?: string) {
    return this.plans.history(userId, Number(days) || 7);
  }
}

@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workouts: WorkoutsService) {}

  @Get()
  day(@UserId() userId: string, @Query('date') date: string) {
    return this.workouts.forDay(userId, date);
  }

  /** Apple Health workouts from the iOS app (HKWorkout), Health Connect, or manual entries. */
  @Post()
  ingest(@UserId() userId: string, @Body() body: { source: Workout['source']; workouts: WorkoutInput[] }) {
    return this.workouts.ingest(userId, body?.source, body?.workouts);
  }

  @Delete(':id')
  remove(@UserId() userId: string, @Param('id') id: string) {
    return this.workouts.remove(userId, id);
  }
}
