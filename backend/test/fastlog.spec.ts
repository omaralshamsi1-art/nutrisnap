import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { NutritionAgentService } from '../src/agent/nutrition-agent.service';
import { SUBMIT_TOOL_NAME } from '../src/agent/prompts';
import { FoodsService } from '../src/foods/foods.service';
import { MealsService } from '../src/meals/meals.service';
import { PlanService } from '../src/plan/plan.service';
import { ProfileService } from '../src/profile/profile.service';
import { MemoryRepository } from '../src/storage/memory.repository';

const sub = {
  meal_name: 'Chicken shawarma + orange juice', meal_name_ar: 'شاورما دجاج وعصير برتقال', restaurant: null, source: 'estimate', confidence: 0.6, serving_description: '',
  items: [
    { name: 'Shawarma', name_ar: 'شاورما دجاج', quantity: 1, unit: 'p', grams: 250, calories: 500, protein_g: 30, carbs_g: 45, fat_g: 20, fiber_g: 3, sugar_g: 3, sodium_mg: 900 },
    { name: 'OJ', name_ar: 'عصير برتقال', quantity: 1, unit: 'cup', grams: 250, calories: 110, protein_g: 2, carbs_g: 26, fat_g: 0, fiber_g: 0, sugar_g: 21, sodium_mg: 2 },
  ],
  sources: [], assumptions: ['حجم عادي'], warnings: [], swaps: [], coach_note_ar: '',
};

function setup() {
  const calls: any[] = [];
  const client = { messages: { create: vi.fn(async (p: any) => { calls.push(p); return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: SUBMIT_TOOL_NAME, input: sub }] }; }) } };
  const repo = new MemoryRepository();
  const profiles = new ProfileService(repo);
  const plans = new PlanService(repo, profiles);
  const agent = new NutritionAgentService(client, new ConfigService({ ANTHROPIC_API_KEY: 'x' }));
  const meals = new MealsService(repo, agent, profiles, plans);
  return { calls, repo, meals };
}

describe('fast logging', () => {
  it('text/voice description → no image block, description passed, meal created with score', async () => {
    const s = setup();
    const r = await s.meals.analyzeText('u', 'اكلت شاورما دجاج وعصير برتقال', {});
    const content = s.calls[0].messages[0].content;
    expect(content.some((b: any) => b.type === 'image')).toBe(false);
    expect(content[0].text).toContain('There is NO photo');
    expect(content[0].text).toContain('اكلت شاورما دجاج وعصير برتقال');
    expect(r.meal.final.totals.calories).toBe(610);
    expect(r.meal.score.score).toBeGreaterThanOrEqual(0);
    await expect(s.meals.analyzeText('u', 'a', {})).rejects.toThrow();
  });

  it('favourites list + one-tap re-log (no AI call) with portion scaling', async () => {
    const s = setup();
    const r = await s.meals.analyzeText('u', 'شاورما وعصير', {});
    await s.meals.confirm('u', r.meal.id);
    const favs = await s.meals.favorites('u');
    expect(favs).toHaveLength(1);
    expect(favs[0]).toMatchObject({ name_ar: 'شاورما دجاج وعصير برتقال', calories: 610, timesLogged: 1 });
    const before = s.calls.length;
    const m = await s.meals.logFavorite('u', { key: favs[0].key, portionFactor: 0.5 });
    expect(s.calls.length).toBe(before);
    expect(m.status).toBe('confirmed');
    expect(m.final.totals.calories).toBe(305);
    expect((await s.meals.favorites('u'))[0].timesLogged).toBe(2);
    await expect(s.meals.logFavorite('u', { key: 'nope' })).rejects.toThrow();
  });
});

describe('barcode (Open Food Facts)', () => {
  it('maps per-100 g nutrients, converts salt→sodium, caches, and handles unknown products', async () => {
    let n = 0;
    const fetchFn: any = vi.fn(async (url: string, init: any): Promise<any> => {
      n++;
      expect(init.headers['User-Agent']).toContain('NutriSnap');
      if (url.includes('/0000000000000')) return { ok: false, status: 404, json: async () => ({}) };
      return {
        ok: true, status: 200,
        json: async () => ({ status: 1, product: { product_name: 'Laban Up', product_name_ar: 'لبن أب', brands: 'Al Rawabi, X', serving_quantity: '200', serving_size: '200 ml',
          nutriments: { 'energy-kcal_100g': 60, proteins_100g: 3.2, carbohydrates_100g: 7.1, fat_100g: 1.5, sugars_100g: 7, salt_100g: 0.25 } } }),
      };
    });
    const f = new FoodsService(new MemoryRepository(), fetchFn);
    const p = await f.byBarcode('6291003000000');
    expect(p).toMatchObject({ name_ar: 'لبن أب', brand: 'Al Rawabi', servingG: 200 });
    expect(p.per100).toMatchObject({ calories: 60, protein_g: 3.2, sodium_mg: 100 });
    await f.byBarcode('6291003000000');
    expect(n).toBe(1);
    await expect(f.byBarcode('0000000000000')).rejects.toThrow(/غير موجود/);
    await expect(f.byBarcode('12')).rejects.toThrow();
  });
});
