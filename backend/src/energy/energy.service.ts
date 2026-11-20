import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isIsoDate, localDate } from '../common/dates';
import { sumNutrients } from '../common/nutrition-math';
import { EnergyDay, EnergySource } from '../common/types';
import { estimatedTdee, ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';

export interface EnergySampleInput {
  date: string;
  source: EnergySource;
  activeKcal?: number | null;
  basalKcal?: number | null;
  totalKcal?: number | null;
}

/** When several devices report the same day, use one — never add them (that would double count). */
const SOURCE_PRIORITY: EnergySource[] = ['whoop', 'apple_health', 'health_connect', 'garmin', 'fitbit', 'manual'];
const VALID_SOURCES = new Set<EnergySource>([...SOURCE_PRIORITY, 'estimate']);

@Injectable()
export class EnergyService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly profiles: ProfileService,
  ) {}

  async ingest(userId: string, samples: EnergySampleInput[]) {
    if (!Array.isArray(samples) || !samples.length) throw new BadRequestException('samples[] required');
    const saved: EnergyDay[] = [];
    for (const s of samples) {
      if (!isIsoDate(s.date)) throw new BadRequestException(`Invalid date ${s.date}`);
      if (!VALID_SOURCES.has(s.source)) throw new BadRequestException(`Invalid source ${s.source}`);
      const active = num(s.activeKcal);
      const basal = num(s.basalKcal);
      const total = num(s.totalKcal) ?? (active != null || basal != null ? (active ?? 0) + (basal ?? 0) : null);
      if (total == null) throw new BadRequestException('Provide totalKcal or active/basal kcal');
      const day: EnergyDay = {
        userId,
        date: s.date,
        source: s.source,
        activeKcal: active,
        basalKcal: basal,
        totalKcal: Math.round(total),
        updatedAt: new Date().toISOString(),
      };
      await this.repo.upsertEnergy(day);
      saved.push(day);
    }
    return { saved: saved.length };
  }

  async balance(userId: string, date?: string) {
    const profile = await this.profiles.get(userId);
    const d = date ?? localDate(new Date(), profile.timezone);
    if (!isIsoDate(d)) throw new BadRequestException('date must be YYYY-MM-DD');

    const meals = await this.repo.listMeals(userId, d);
    const confirmed = meals.filter((m) => m.status === 'confirmed');
    const intake = sumNutrients(confirmed.map((m) => m.final.totals));
    const pending = sumNutrients(meals.filter((m) => m.status === 'draft').map((m) => m.final.totals));

    const days = await this.repo.listEnergy(userId, d);
    const order = profile.preferredEnergySource
      ? [profile.preferredEnergySource, ...SOURCE_PRIORITY.filter((s) => s !== profile.preferredEnergySource)]
      : SOURCE_PRIORITY;
    const chosen = order.map((s) => days.find((x) => x.source === s)).find(Boolean) ?? null;
    const tdee = estimatedTdee(profile);
    const isToday = d === localDate(new Date(), profile.timezone);

    const burn = chosen
      ? { source: chosen.source, totalKcal: chosen.totalKcal, activeKcal: chosen.activeKcal, basalKcal: chosen.basalKcal }
      : tdee != null
        ? { source: 'estimate' as EnergySource, totalKcal: tdee, activeKcal: null, basalKcal: null }
        : null;

    // For today, device totals only cover the day so far; use the larger of that and the TDEE estimate as the target base.
    const targetBase = burn ? (isToday && chosen && tdee != null ? Math.max(burn.totalKcal, tdee) : burn.totalKcal) : null;
    const target = targetBase != null ? Math.round(targetBase + profile.goalDeltaKcal) : null;

    return {
      date: d,
      intake,
      pendingDrafts: pending,
      burn,
      burnIsPartialDay: isToday && !!chosen,
      estimatedTdee: tdee,
      goal: profile.goal,
      goalDeltaKcal: profile.goalDeltaKcal,
      targetIntakeKcal: target,
      remainingKcal: target != null ? target - intake.calories : null,
      netKcal: burn ? intake.calories - burn.totalKcal : null,
      macroSplitPct: macroSplit(intake),
      meals: meals.map((m) => ({
        id: m.id,
        eatenAt: m.eatenAt,
        status: m.status,
        name: m.final.meal_name,
        name_ar: m.final.meal_name_ar,
        restaurant: m.final.restaurant,
        source: m.final.source,
        calories: m.final.totals.calories,
      })),
      availableSources: days.map((x) => x.source),
    };
  }
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v == null || !Number.isFinite(n) || n < 0 ? null : n;
}

function macroSplit(n: { protein_g: number; carbs_g: number; fat_g: number }) {
  const p = n.protein_g * 4;
  const c = n.carbs_g * 4;
  const f = n.fat_g * 9;
  const t = p + c + f;
  if (!t) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: Math.round((p / t) * 100), carbs: Math.round((c / t) * 100), fat: Math.round((f / t) * 100) };
}
