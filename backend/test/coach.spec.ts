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
