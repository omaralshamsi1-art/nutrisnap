import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ANTHROPIC_CLIENT, anthropicFactory, NutritionAgentService } from './agent/nutrition-agent.service';
import { AuthGuard } from './auth/auth.guard';
import {
  EnergyController,
  HealthController,
  MealsController,
  PlanController,
  ProfileController,
  WhoopController,
} from './controllers';
import { EnergyService } from './energy/energy.service';
import { WhoopService } from './integrations/whoop/whoop.service';
import { MealsService } from './meals/meals.service';
import { ProfileService } from './profile/profile.service';
import { PlanService } from './plan/plan.service';
import { MemoryRepository } from './storage/memory.repository';
import { PostgresRepository } from './storage/postgres.repository';
import { REPOSITORY } from './storage/repository';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, MealsController, PlanController, EnergyController, ProfileController, WhoopController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: ANTHROPIC_CLIENT, useFactory: anthropicFactory, inject: [ConfigService] },
    {
      provide: REPOSITORY,
      useFactory: async (c: ConfigService) => {
        const url = c.get<string>('DATABASE_URL');
        return url ? PostgresRepository.fromUrl(url) : new MemoryRepository();
      },
      inject: [ConfigService],
    },
    NutritionAgentService,
    ProfileService,
    PlanService,
    MealsService,
    EnergyService,
    WhoopService,
  ],
})
export class AppModule {}
