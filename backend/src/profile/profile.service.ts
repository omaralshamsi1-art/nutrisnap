import { Inject, Injectable } from '@nestjs/common';
import { Profile } from '../common/types';
import { REPOSITORY, Repository } from '../storage/repository';

export const DEFAULT_PROFILE = (userId: string): Profile => ({
  userId,
  sex: null,
  birthYear: null,
  heightCm: null,
  weightKg: null,
  activityLevel: 'light',
  goal: 'maintain',
  goalDeltaKcal: 0,
  preferredEnergySource: null,
  timezone: 'Asia/Dubai',
  city: null,
  country: 'AE',
});

const ACTIVITY_FACTOR: Record<Profile['activityLevel'], number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

@Injectable()
export class ProfileService {
  constructor(@Inject(REPOSITORY) private readonly repo: Repository) {}

  async get(userId: string): Promise<Profile> {
    return (await this.repo.getProfile(userId)) ?? DEFAULT_PROFILE(userId);
  }

  async update(userId: string, patch: Partial<Profile>): Promise<Profile> {
    const current = await this.get(userId);
    const next: Profile = { ...current, ...stripUndefined(patch), userId };
    if (patch.goal && patch.goalDeltaKcal === undefined) {
      next.goalDeltaKcal = patch.goal === 'lose' ? -500 : patch.goal === 'gain' ? 300 : 0;
    }
    await this.repo.saveProfile(next);
    return next;
  }
}

/** Mifflin-St Jeor BMR. Returns null when the profile is incomplete. */
export function bmrKcal(p: Profile, today = new Date()): number | null {
  if (!p.weightKg || !p.heightCm || !p.birthYear || !p.sex) return null;
  const age = today.getFullYear() - p.birthYear;
  return Math.round(10 * p.weightKg + 6.25 * p.heightCm - 5 * age + (p.sex === 'male' ? 5 : -161));
}

/** Estimated total daily energy expenditure when no wearable data exists. */
export function estimatedTdee(p: Profile): number | null {
  const bmr = bmrKcal(p);
  return bmr == null ? null : Math.round(bmr * ACTIVITY_FACTOR[p.activityLevel]);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
