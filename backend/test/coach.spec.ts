import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { NutritionAgentService } from '../src/agent/nutrition-agent.service';
import { SUBMIT_TOOL_NAME } from '../src/agent/prompts';
import { CoachService } from '../src/coach/coach.service';
import { hijriMonth, isRamadan, ramadanTips, ramadanView, scoreMeal } from '../src/coach/coach-math';
import { EMPTY_NUTRIENTS } from '../src/common/types';
import { EnergyService } from '../src/energy/energy.service';
import { MealsService } from '../src/meals/meals.service';
import { PlanService } from '../src/plan/plan.service';
import { ProfileService } from '../src/profile/profile.service';
import { MemoryRepository } from '../src/storage/memory.repository';
import { WorkoutsService } from '../src/workouts/workouts.service';

const n = (o: Partial<typeof EMPTY_NUTRIENTS>) => ({ ...EMPTY_NUTRIENTS, ...o });

describe('meal score', () => {
  it('rewards protein, fibre, low sugar/sodium and fitting the budget', () => {
    const grilled = scoreMeal(n({ calories: 520, protein_g: 45, carbs_g: 40, fat_g: 18, fiber_g: 9, sugar_g: 6, sodium_mg: 700 }), { goal: 'lose', remainingBeforeKcal: 1200, dailyTargetKcal: 1800 });
    expect(grilled.score).toBe(10);
    expect(grilled.grade).toBe('excellent');
    const dessert = scoreMeal(n({ calories: 900, protein_g: 8, carbs_g: 120, fat_g: 40, fiber_g: 2, sugar_g: 80, sodium_mg: 400 }), { goal: 'lose', remainingBeforeKcal: 500, dailyTargetKcal: 1800 });
    expect(dessert.score).toBeLessThanOrEqual(2);
    expect(dessert.reasons.map((r) => r.text_ar)).toContain('سكر مرتفع');
  });
  it('for weight gain a substantial meal counts as progress', () => {
    const s = scoreMeal(n({ calories: 800, protein_g: 45, fiber_g: 6, sugar_g: 10, sodium_mg: 900 }), { goal: 'gain', remainingBeforeKcal: 2500, dailyTargetKcal: 3000 });
    expect(s.reasons.some((r) => r.text_ar === 'تقرّبك من هدف الزيادة')).toBe(true);
  });
});

describe('Ramadan', () => {
  it('detects Ramadan 1448 (Umm al-Qura) around 8 Feb – 9 Mar 2027', () => {
    expect(isRamadan(new Date('2027-02-07T12:00:00Z'), 'Asia/Dubai')).toBe(false);
    expect(isRamadan(new Date('2027-02-15T12:00:00Z'), 'Asia/Dubai')).toBe(true);
    expect(hijriMonth(new Date('2027-03-12T12:00:00Z'), 'Asia/Dubai')).toBe(10);
  });
  it('auto-activates in Ramadan, splits the target, knows fasting hours; can be turned off or used for voluntary fasting', () => {
    const noon = new Date('2027-02-15T08:00:00Z'); // 12:00 Dubai
    const v = ramadanView({ enabled: null, suhoorTime: '05:00', iftarTime: '18:10' }, noon, 'Asia/Dubai', 2000);
    expect(v).toMatchObject({ active: true, detected: true, needsChoice: true, fasting: true, minutesToIftar: 370 });
    expect(v.split).toEqual({ suhoor: 600, iftar: 900, evening: 500 });
    expect(ramadanTips(v, 0)[0].text_ar).toContain('6 ساعة 10 دقيقة');
    expect(ramadanView({ enabled: false, suhoorTime: '05:00', iftarTime: '18:10' }, noon, 'Asia/Dubai', 2000).active).toBe(false);
    expect(ramadanView({ enabled: true, suhoorTime: '05:00', iftarTime: '18:10' }, new Date('2026-11-21T08:00:00Z'), 'Asia/Dubai', 2000).active).toBe(true);
  });
});

describe('coach service', () => {
  function setup(responder: (p: any) => any) {
    const calls: any[] = [];
    const client = { messages: { create: vi.fn(async (p: any) => { calls.push(p); return responder(p); }) } };
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    const workouts = new WorkoutsService(repo, profiles);
    const energy = new EnergyService(repo, profiles, plans, workouts);
    const agent = new NutritionAgentService(client, new ConfigService({ ANTHROPIC_API_KEY: 'x' }));
    const meals = new MealsService(repo, agent, profiles, plans);
    const coach = new CoachService(repo, agent, plans, energy, profiles);
    return { calls, repo, profiles, plans, meals, coach };
  }
  const respond = (input: any) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'respond', input }] });

  it('suggest: passes budget + history, drops options over the budget, caches', async () => {
    const s = setup(() => respond({ intro_ar: 'اقتراحات', options: [
      { title_ar: 'سلطة دجاج مشوي', where_ar: 'البيت', kcal: 450, protein_g: 40, why_ar: '' },
      { title_ar: 'برجر دبل', where_ar: 'مطعم', kcal: 1400, protein_g: 50, why_ar: '' },
    ] }));
    await s.profiles.update('u', { sex: 'female', birthYear: 1995, heightCm: 165, activityLevel: 'light', goal: 'lose', targetWeightKg: 65, onboarded: true });
    await s.plans.addWeight('u', { kg: 75 });
    const m = await s.meals.createManual('u', { meal_name: 'Shawarma', meal_name_ar: 'شاورما', restaurant: 'Al Mallah', items: [{ name: 'w', name_ar: 'w', quantity: 1, unit: 'p', grams: null, calories: 600, protein_g: 30, carbs_g: 50, fat_g: 25, fiber_g: 3, sugar_g: 3, sodium_mg: 900 }] });
    await s.meals.confirm('u', m.id);
    const r = await s.coach.suggest('u');
    expect(r.options.map((o) => o.title_ar)).toEqual(['سلطة دجاج مشوي']);
    expect(r.cached).toBe(false);
    const prompt = s.calls[0].messages[0].content as string;
    expect(prompt).toContain('شاورما (Al Mallah)');
    expect(prompt).toMatch(/Calories left today: \d+/);
    expect(s.calls[0].system).toContain('Never suggest eating below');
    const again = await s.coach.suggest('u');
    expect(again.cached).toBe(true);
    expect(s.calls).toHaveLength(1);
  });

  it('weekly: numbers are computed locally; AI only writes the narrative; empty weeks skip the AI', async () => {
    const s = setup(() => respond({ headline_ar: 'أسبوع جيد', wins_ar: ['a'], improve_ar: ['b'], next_week_goal_ar: 'c' }));
    await s.profiles.update('u', { sex: 'male', birthYear: 1985, heightCm: 178, goal: 'lose', targetWeightKg: 80, onboarded: true });
    const empty = await s.coach.weekly('u');
    expect(s.calls).toHaveLength(0);
    expect(empty.stats.loggedDays).toBe(0);
    const y = new Date(Date.now() - 86400000 * 2).toISOString();
    const m = await s.meals.createManual('u', { meal_name: 'x', items: [{ name: 'x', name_ar: 'x', quantity: 1, unit: 'p', grams: null, calories: 1500, protein_g: 120, carbs_g: 100, fat_g: 60, fiber_g: 20, sugar_g: 10, sodium_mg: 1000 }], eatenAt: y });
    await s.meals.confirm('u', m.id);
    const w = await s.coach.weekly('u');
    expect(w.stats.loggedDays).toBe(1);
    expect(w.stats.avgProtein).toBe(120);
    expect(w.narrative.headline_ar).toBe('أسبوع جيد');
    expect(s.calls[0].messages[0].content).toContain('"loggedDays":1');
  });

  it('meal analysis carries coaching context and returns a score + swaps', async () => {
    const sub = {
      meal_name: 'Big Mac meal', meal_name_ar: 'وجبة بيج ماك', restaurant: "McDonald's", source: 'restaurant_published', confidence: 0.9, serving_description: 'medium',
      items: [{ name: 'Big Mac', name_ar: 'بيج ماك', quantity: 1, unit: 'p', grams: 219, calories: 550, protein_g: 25, carbs_g: 45, fat_g: 30, fiber_g: 3, sugar_g: 9, sodium_mg: 1010 }],
      sources: [], assumptions: [], warnings: [],
      swaps: [{ instead_of_ar: 'بطاطس وسط', choose_ar: 'سلطة جانبية', delta_kcal: -300, delta_protein_g: 0, why_ar: 'نفس الشبع بسعرات أقل' }],
      coach_note_ar: 'اختيار مقبول',
    };
    const s = setup((p) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: SUBMIT_TOOL_NAME, input: sub }] }));
    await s.profiles.update('u', { goal: 'lose', screening: { edHistory: true }, onboarded: true });
    const r = await s.meals.analyzePhoto('u', Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg', {});
    const text = s.calls[0].messages[0].content[1].text as string;
    expect(text).toContain('Coaching context: goal=maintenance'); // ED history → engine switches lose → maintain
    expect(text).toContain('avoid calorie-restriction advice');
    expect(r.meal.score.score).toBeGreaterThanOrEqual(0);
    expect(r.meal.final.swaps?.[0].choose_ar).toBe('سلطة جانبية');
  });
});

describe('motivation', () => {
  it('streaks: today without a meal does not break it; best streak tracked', async () => {
    const { streaks } = await import('../src/coach/motivation.service');
    const d = (date: string, meals = 1) => ({ date, meals, kcal: 1500, protein: 100, fiber: 20 });
    const days = [d('2026-11-10'), d('2026-11-11'), d('2026-11-12'), d('2026-11-14'), d('2026-11-15'), d('2026-11-16')];
    expect(streaks(days, '2026-11-17')).toEqual({ current: 3, best: 3, loggedToday: false });
    expect(streaks([...days, d('2026-11-17')], '2026-11-17')).toEqual({ current: 4, best: 4, loggedToday: true });
    expect(streaks(days, '2026-11-18').current).toBe(0);
  });

  it('weekStart is Monday', async () => {
    const { weekStart } = await import('../src/coach/motivation.service');
    expect(weekStart('2026-11-21')).toBe('2026-11-16'); // Saturday → Monday
    expect(weekStart('2026-11-16')).toBe('2026-11-16');
  });

  it('summary: badges, stable weekly challenge', async () => {
    const { MotivationService } = await import('../src/coach/motivation.service');
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const plans = new PlanService(repo, profiles);
    const agent = new NutritionAgentService(null, new ConfigService({}));
    const meals = new MealsService(repo, agent, profiles, plans);
    await profiles.update('u', { sex: 'female', birthYear: 1995, heightCm: 165, goal: 'lose', targetWeightKg: 60, onboarded: true });
    await plans.addWeight('u', { kg: 70 });
    for (let i = 3; i >= 1; i--) {
      const m = await meals.createManual('u', { meal_name: 'x', items: [{ name: 'x', name_ar: 'x', quantity: 1, unit: 'p', grams: null, calories: 1200, protein_g: 40, carbs_g: 120, fat_g: 40, fiber_g: 5, sugar_g: 10, sodium_mg: 500 }], eatenAt: new Date(Date.now() - i * 86400000).toISOString() });
      await meals.confirm('u', m.id);
    }
    const mot = new MotivationService(repo, plans, profiles);
    const s = await mot.summary('u');
    expect(s.streak.current).toBe(3);
    expect(s.badges.find((b) => b.id === 'streak_3')?.earned).toBe(true);
    expect(s.badges.find((b) => b.id === 'first_weight')?.earned).toBe(true);
    expect(s.badges.find((b) => b.id === 'streak_7')).toMatchObject({ earned: false, progress: 3, target: 7 });
    expect(s.challenge.id).toBe('log5'); // < 8 logged days in the last 2 weeks
    const again = await mot.summary('u');
    expect(again.challenge.id).toBe(s.challenge.id);
  });
});

describe('reminders', () => {
  it('usual meal times need ≥4 days; due windows, quiet hours, fasting and prefs respected', async () => {
    const { usualMealTimes, dueReminders } = await import('../src/coach/reminders.service');
    const meal = (date: string, hhmmUtc: string) => ({ id: date + hhmmUtc, userId: 'u', date, eatenAt: `${date}T${hhmmUtc}:00Z`, status: 'confirmed' } as any);
    // Dubai = UTC+4 → 09:30 UTC = 13:30 local (lunch)
    const meals = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'].map((d) => meal(d, '09:30'));
    const usual = usualMealTimes([...meals, meal('2026-11-12', '04:00')], 'Asia/Dubai');
    expect(usual).toEqual({ lunch: 13 * 60 + 30 });
    const base = { usual, loggedSlotsToday: new Set<any>(), daysSinceWeight: 0, fasting: false, prefs: { meals: true, weight: true } };
    expect(dueReminders({ ...base, nowMin: 14 * 60 + 30 })[0].key).toBe('meal:lunch');
    expect(dueReminders({ ...base, nowMin: 14 * 60 })).toHaveLength(0); // too early
    expect(dueReminders({ ...base, nowMin: 14 * 60 + 30, loggedSlotsToday: new Set(['lunch']) })).toHaveLength(0);
    expect(dueReminders({ ...base, nowMin: 14 * 60 + 30, fasting: true })).toHaveLength(0);
    expect(dueReminders({ ...base, nowMin: 14 * 60 + 30, prefs: { meals: false, weight: true } })).toHaveLength(0);
    expect(dueReminders({ ...base, nowMin: 8 * 60, daysSinceWeight: 3 })[0].key).toBe('weight');
    expect(dueReminders({ ...base, nowMin: 6 * 60, daysSinceWeight: 3 })).toHaveLength(0); // quiet hours
  });

  it('tick sends each reminder once per day and drops expired subscriptions', async () => {
    const { RemindersService } = await import('../src/coach/reminders.service');
    const repo = new MemoryRepository();
    const profiles = new ProfileService(repo);
    const sent: string[] = [];
    const sender = vi.fn(async (sub: any, payload: string) => {
      if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push(JSON.parse(payload).title);
    });
    const svc = new RemindersService(repo, profiles, new ConfigService({ NODE_ENV: 'test' }), sender);
    await svc.subscribe('u', { endpoint: 'https://push.example/ok', keys: { p256dh: 'a', auth: 'b' } });
    await svc.subscribe('u', { endpoint: 'https://push.example/gone', keys: { p256dh: 'a', auth: 'b' } });
    await expect(svc.subscribe('u', { endpoint: 'http://insecure' })).rejects.toThrow();
    const at = new Date('2026-11-21T04:15:00Z'); // 08:15 Dubai → weight reminder
    const r1 = await svc.tick(at);
    expect(r1.sent).toBe(1);
    expect(sent).toEqual(['Morning weigh-in ⚖️']);
    expect((await repo.listPushSubs('u')).map((s) => s.endpoint)).toEqual(['https://push.example/ok']);
    const r2 = await svc.tick(new Date('2026-11-21T04:30:00Z'));
    expect(r2.sent).toBe(0);
  });
});
