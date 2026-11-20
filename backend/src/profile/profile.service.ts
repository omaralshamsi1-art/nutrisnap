import { BadRequestException, Inject, Injectable } from '@nestjs/common';
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
  targetWeightKg: null,
  pace: 'moderate',
  startWeightKg: null,
  startDate: null,
  screening: {},
  onboarded: false,
  ramadan: { enabled: null, suhoorTime: '04:45', iftarTime: '18:00' },
  activityCalibration: null,
});

export const ACTIVITY_FACTOR: Record<Profile['activityLevel'], number> = {
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
    const stored = await this.repo.getProfile(userId);
    // merge with defaults so profiles saved before newer fields existed stay valid
    return { ...DEFAULT_PROFILE(userId), ...(stored ?? {}), userId };
  }

  async update(userId: string, patch: Partial<Profile>, opts: { system?: boolean } = {}): Promise<Profile> {
    const systemFields = opts.system && 'activityCalibration' in patch ? { activityCalibration: patch.activityCalibration } : {};
    patch = { ...validateProfilePatch(patch), ...systemFields };
    const current = await this.get(userId);
    const next: Profile = { ...current, ...stripUndefined(patch), userId };
    if (patch.goal && patch.goalDeltaKcal === undefined) {
      next.goalDeltaKcal = patch.goal === 'lose' ? -500 : patch.goal === 'gain' ? 300 : 0;
    }
    if (patch.screening) next.screening = { ...current.screening, ...patch.screening };
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

const ENUMS: Partial<Record<keyof Profile, readonly string[]>> = {
  sex: ['male', 'female'],
  activityLevel: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
  goal: ['lose', 'maintain', 'gain'],
  pace: ['relaxed', 'moderate', 'fast'],
  preferredEnergySource: ['whoop', 'apple_health', 'health_connect', 'garmin', 'fitbit', 'manual'],
};
const RANGES: Partial<Record<keyof Profile, [number, number]>> = {
  birthYear: [1900, new Date().getFullYear()],
  heightCm: [100, 250],
  weightKg: [25, 350],
  targetWeightKg: [25, 350],
  startWeightKg: [25, 350],
  goalDeltaKcal: [-1500, 1500],
};

/** Rejects out-of-range or unknown enum values; null clears a field. */
export function validateProfilePatch(patch: Partial<Profile>): Partial<Profile> {
  const out: any = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k === 'userId' || v === undefined) continue;
    const key = k as keyof Profile;
    if (ENUMS[key]) {
      if (v !== null && !ENUMS[key]!.includes(String(v))) throw new BadRequestException(`invalid ${k}`);
      out[k] = v;
    } else if (RANGES[key]) {
      if (v === null || v === '') { out[k] = null; continue; }
      const n = Number(v);
      const [lo, hi] = RANGES[key]!;
      if (!Number.isFinite(n) || n < lo || n > hi) throw new BadRequestException(`${k} must be between ${lo} and ${hi}`);
      out[k] = n;
    } else if (k === 'screening') {
      const sc = (v ?? {}) as Record<string, unknown>;
      out.screening = Object.fromEntries(
        ['pregnant', 'breastfeeding', 'medicalSupervision', 'edHistory'].filter((x) => x in sc).map((x) => [x, !!sc[x]]),
      );
    } else if (k === 'ramadan') {
      const r = (v ?? {}) as Record<string, unknown>;
      const time = (t: unknown, d: string) => {
        if (t === undefined) return d;
        if (typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new BadRequestException('ramadan times must be HH:MM');
        return t;
      };
      out.ramadan = {
        enabled: r.enabled === null || r.enabled === undefined ? null : !!r.enabled,
        suhoorTime: time(r.suhoorTime, '04:45'),
        iftarTime: time(r.iftarTime, '18:00'),
      };
    } else if (k === 'onboarded') {
      out.onboarded = !!v;
    } else if (['timezone', 'city', 'country', 'startDate'].includes(k)) {
      out[k] = v === null ? null : String(v).slice(0, 64);
    }
  }
  return out;
}
