import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { adaptiveMaintenance, calorieFloor, computePlan, PlanInput, weightTrend } from '../src/plan/plan-math';
import { PlanService } from '../src/plan/plan.service';
import { ProfileService, validateProfilePatch } from '../src/profile/profile.service';
import { MemoryRepository } from '../src/storage/memory.repository';

const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  goal: 'lose', pace: 'moderate', sex: 'female', age: 26, heightCm: 165, weightKg: 80, targetWeightKg: 68,
  maintenanceKcal: 2200, maintenanceSource: 'device', bmr: 1500, screening: {}, today: new Date('2026-11-20T00:00:00Z'), ...o,
});

describe('goal engine', () => {
  it('moderate loss ≈0.5% body weight / week with ETA', () => {
    const p = computePlan(base());
    // 80 kg × 0.5% = 0.4 kg/wk → 440 kcal/day deficit
    expect(p.targetKcal).toBe(1760);
    expect(p.weeklyChangeKg).toBeCloseTo(-0.4, 1);
    expect(p.weeksToGoal).toBe(30);
    expect(p.etaDate).toBe('2027-06-18'); // 30 weeks = 210 days
    expect(p.proteinG).toBe(145); // 1.8 g/kg × 80
    expect(p.fatG * 9 + p.proteinG * 4 + p.carbsG * 4).toBeLessThanOrEqual(p.targetKcal + 20);
  });

  it('caps loss at 1 kg/week and 1000 kcal/day, and never goes under the floor', () => {
    const p = computePlan(base({ weightKg: 160, heightCm: 175, targetWeightKg: 90, pace: 'fast', maintenanceKcal: 3400, bmr: 2300 }));
    expect(p.dailyDeltaKcal).toBeGreaterThanOrEqual(-1000);
    const small = computePlan(base({ weightKg: 55, heightCm: 160, targetWeightKg: 52, pace: 'fast', maintenanceKcal: 1450, bmr: 1280 }));
    expect(small.targetKcal).toBe(calorieFloor('female', 1280)); // 1280 (BMR > 1200)
    expect(small.limitedByFloor).toBe(true);
    expect(small.notices.some((n) => n.code === 'floor')).toBe(true);
  });

  it('protein is based on a BMI-25 reference weight when BMI > 30', () => {
    const p = computePlan(base({ weightKg: 120, heightCm: 170, targetWeightKg: 85 }));
    expect(p.proteinG).toBe(130); // 25 × 1.7² = 72.25 kg × 1.8 = 130
  });

  it('lean gain uses a small surplus (≤500)', () => {
    const p = computePlan(base({ goal: 'gain', weightKg: 60, targetWeightKg: 66, maintenanceKcal: 2300 }));
    expect(p.dailyDeltaKcal).toBeGreaterThan(0);
    expect(p.dailyDeltaKcal).toBeLessThanOrEqual(500);
    expect(p.weeklyChangeKg).toBeCloseTo(0.15, 1);
  });

  it('safety: under 18, pregnancy, ED history and underweight never get a deficit', () => {
    for (const o of [{ age: 16 }, { screening: { pregnant: true } }, { screening: { edHistory: true } }, { weightKg: 48, heightCm: 165 }] as Partial<PlanInput>[]) {
      const p = computePlan(base(o));
      expect(p.effectiveGoal).toBe('maintain');
      expect(p.dailyDeltaKcal).toBe(0);
      expect(p.notices.some((n) => n.level === 'stop')).toBe(true);
    }
  });

  it('switches to maintain when the target is reached', () => {
    const p = computePlan(base({ weightKg: 67.5, targetWeightKg: 68 }));
    expect(p.effectiveGoal).toBe('maintain');
    expect(p.notices[0].code).toBe('target_reached');
  });

  it('weight trend smooths noise and adaptive maintenance learns from intake vs trend', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      kg: 80 - i * 0.07 + (i % 2 ? 0.6 : -0.6), // −0.5 kg/week + ±0.6 kg noise
    }));
    const t = weightTrend(pts);
    expect(Math.abs(t[20].trend - t[19].trend)).toBeLessThan(0.2);
    const days = pts.map((p) => ({ date: p.date, kcal: 1700 }));
    const a = adaptiveMaintenance({ baseline: 2000, loggedDays: days, trend: t });
    expect(a.adaptive).toBe(true);
    expect(a.observed).toBeGreaterThan(1700); // losing while eating 1700 → burns more than 1700
    expect(adaptiveMaintenance({ baseline: 2000, loggedDays: days.slice(0, 5), trend: t }).adaptive).toBe(false);
  });

  it('validates profile input', () => {
    expect(() => validateProfilePatch({ pace: 'turbo' as any })).toThrow();
    expect(() => validateProfilePatch({ targetWeightKg: 5 })).toThrow();
    expect(validateProfilePatch({ heightCm: '170' as any, screening: { pregnant: 1 as any, hack: true } as any })).toEqual({
      heightCm: 170, screening: { pregnant: true },
    });
  });
});

describe('PlanService', () => {
  it('weights: one per day (manual wins), sets start weight, feeds the plan; preview does not save', async () => {
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    await profiles.update('u', { sex: 'female', birthYear: 1998, heightCm: 165, goal: 'lose', targetWeightKg: 65, pace: 'moderate' });
    await repo.upsertWeight({ userId: 'u', date: '2026-11-18', kg: 79.4, source: 'whoop', updatedAt: '' });
    await plans.addWeight('u', { kg: 80, date: '2026-11-18' });
    const w = await plans.weights('u', 30);
    expect(w.entries).toHaveLength(1);
    expect(w.entries[0].source).toBe('manual');
    expect((await profiles.get('u')).startWeightKg).toBe(80);
    const p = await plans.plan('u');
    expect(p.currentWeightKg).toBe(80);
    expect(p.targetKcal).toBeLessThan(p.maintenanceKcal);
    const prev = await plans.plan('u', { goal: 'gain', targetWeightKg: 85 });
    expect(prev.targetKcal).toBeGreaterThan(prev.maintenanceKcal);
    expect((await profiles.get('u')).goal).toBe('lose');
    await expect(plans.addWeight('u', { kg: 5 })).rejects.toThrow();
  });
});
