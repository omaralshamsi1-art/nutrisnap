import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { NutritionAgentService } from '../src/agent/nutrition-agent.service';
import { SUBMIT_TOOL_NAME } from '../src/agent/prompts';
import { dayBoundsUtc, localDate } from '../src/common/dates';
import { normalizeEstimate, normalizeKey, scaleEstimate } from '../src/common/nutrition-math';
import { EMPTY_NUTRIENTS, NutritionEstimate } from '../src/common/types';
import { EnergyService } from '../src/energy/energy.service';
import { WhoopService } from '../src/integrations/whoop/whoop.service';
import { MealsService } from '../src/meals/meals.service';
import { ProfileService } from '../src/profile/profile.service';
import { MemoryRepository } from '../src/storage/memory.repository';

const config = (extra: Record<string, string> = {}) =>
  new ConfigService({ CLAUDE_MODEL: 'claude-sonnet-5-5', OAUTH_STATE_SECRET: 'x'.repeat(32), ...extra });

const item = (o: Partial<any> = {}) => ({
  name: 'Chicken shawarma wrap',
  name_ar: 'شاورما دجاج',
  quantity: 1,
  unit: 'piece',
  grams: 250,
  calories: 520,
  protein_g: 32,
  carbs_g: 48,
  fat_g: 22,
  fiber_g: 3,
  sugar_g: 4,
  sodium_mg: 1100,
  ...o,
});

const submission = (o: Partial<NutritionEstimate> = {}) => ({
  meal_name: 'Chicken shawarma wrap',
  meal_name_ar: 'ساندويتش شاورما دجاج',
  restaurant: 'Test Grill',
  source: 'restaurant_published',
  confidence: 0.92,
  serving_description: '1 regular wrap',
  items: [item()],
  sources: [{ title: 'Test Grill nutrition', url: 'https://testgrill.ae/nutrition' }],
  assumptions: ['regular size'],
  warnings: [],
  ...o,
});

/** Fake Claude: turn 1 searches + pauses, turn 2 submits. Records requests. */
function fakeClaude(sub = submission()) {
  const calls: any[] = [];
  return {
    calls,
    messages: {
      create: vi.fn(async (p: any) => {
        calls.push(JSON.parse(JSON.stringify(p)));
        if (calls.length === 1) {
          return {
            stop_reason: 'pause_turn',
            usage: { input_tokens: 1000, output_tokens: 50 },
            content: [
              { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Test Grill shawarma calories' } },
              {
                type: 'web_search_tool_result',
                tool_use_id: 's1',
                content: [{ type: 'web_search_result', url: 'https://testgrill.ae/nutrition', title: 'Nutrition' }],
              },
            ],
          };
        }
        return {
          stop_reason: 'tool_use',
          usage: { input_tokens: 1200, output_tokens: 300 },
          content: [{ type: 'tool_use', id: 't1', name: SUBMIT_TOOL_NAME, input: sub }],
        };
      }),
    },
  };
}

function setup(claude = fakeClaude()) {
  const repo = new MemoryRepository();
  const cfg = config();
  const profiles = new ProfileService(repo);
  const agent = new NutritionAgentService(claude, cfg);
  const meals = new MealsService(repo, agent, profiles);
  const energy = new EnergyService(repo, profiles);
  return { repo, cfg, profiles, agent, meals, energy, claude };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('nutrition math', () => {
  it('recomputes totals from items and flags macro mismatch', () => {
    const e = normalizeEstimate({
      ...(submission() as any),
      items: [item(), item({ calories: 900 })],
      totals: { ...EMPTY_NUTRIENTS, calories: 1 },
    });
    expect(e.totals.calories).toBe(1420);
    expect(e.totals.protein_g).toBe(64);
    expect(e.warnings.some((w) => w.startsWith('[check]'))).toBe(true);
  });

  it('scales portions', () => {
    const e = scaleEstimate(normalizeEstimate({ ...(submission() as any), totals: EMPTY_NUTRIENTS }), 0.5);
    expect(e.totals.calories).toBe(260);
    expect(e.items[0].grams).toBe(125);
  });

  it('normalizes Arabic/English keys', () => {
    expect(normalizeKey('مطعم الأمير', 'شاورما  دجاج')).toBe(normalizeKey('مطعم الامير', 'شاورما دجاج'));
    expect(normalizeKey('McDonald’s', 'Big Mac')).toBe('mcdonald s|big mac');
  });

  it('computes Dubai day bounds', () => {
    const b = dayBoundsUtc('2026-11-20', 'Asia/Dubai');
    expect(b.start.toISOString()).toBe('2026-11-19T20:00:00.000Z');
    expect(localDate(new Date('2026-11-19T21:00:00Z'), 'Asia/Dubai')).toBe('2026-11-20');
  });
});

describe('agent', () => {
  it('handles pause_turn, sends image + tools, keeps only verified sources', async () => {
    const claude = fakeClaude(
      submission({ sources: [{ title: 'ok', url: 'https://testgrill.ae/nutrition' }, { title: 'made up', url: 'https://fake.example/x' }] }),
    );
    const { agent } = setup(claude);
    const r = await agent.analyze({ image: JPEG, mediaType: 'image/jpeg', restaurant: 'Test Grill', known: [] });
    expect(claude.calls).toHaveLength(2);
    const first = claude.calls[0];
    expect(first.model).toBe('claude-sonnet-5-5');
    expect(first.messages[0].content[0].type).toBe('image');
    expect(first.tools.map((t: any) => t.type ?? t.name)).toEqual(['web_search_20260318', 'web_fetch_20260318', SUBMIT_TOOL_NAME]);
    expect(first.tools[0].user_location.country).toBe('AE');
    expect(claude.calls[1].messages).toHaveLength(2); // assistant pause content appended
    expect(r.searchesUsed).toBe(1);
    expect(r.estimate.sources).toEqual([{ title: 'ok', url: 'https://testgrill.ae/nutrition' }]);
    expect(r.estimate.totals.calories).toBe(520);
  });

  it('forces submit when the model ends without calling the tool', async () => {
    const calls: any[] = [];
    const client = {
      messages: {
        create: vi.fn(async (p: any) => {
          calls.push(p);
          if (calls.length === 1) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Looks like kabsa' }] };
          return {
            stop_reason: 'tool_use',
            content: [
              {
                type: 'tool_use',
                id: 't',
                name: SUBMIT_TOOL_NAME,
                input: submission({ source: 'estimate', restaurant: null, sources: [], confidence: 0.5 }),
              },
            ],
          };
        }),
      },
    };
    const agent = new NutritionAgentService(client, config());
    const r = await agent.analyze({ image: JPEG, mediaType: 'image/jpeg', known: [] });
    expect(calls[1].tool_choice).toEqual({ type: 'tool', name: SUBMIT_TOOL_NAME });
    expect(r.estimate.source).toBe('estimate');
  });

  it('downgrades unverifiable "published" claims', async () => {
    const claude = fakeClaude(submission({ sources: [] }));
    const r = await setup(claude).agent.analyze({ image: JPEG, mediaType: 'image/jpeg', known: [] });
    expect(r.estimate.confidence).toBeLessThanOrEqual(0.6);
    expect(r.estimate.warnings.join(' ')).toMatch(/could not be verified/);
  });
});

describe('meals flow + learning', () => {
  it('analyze → edit → confirm teaches the agent; next analysis receives known meal', async () => {
    const s = setup();
    const { meal } = await s.meals.analyzePhoto('u1', JPEG, 'image/jpeg', { restaurant: 'Test Grill', mealName: 'shawarma' });
    expect(meal.status).toBe('draft');

    const edited = await s.meals.update('u1', meal.id, { items: [item({ calories: 600, fat_g: 30 })] });
    expect(edited.final.totals.calories).toBe(600);
    expect(edited.estimate.totals.calories).toBe(520); // original kept
    await s.meals.confirm('u1', meal.id);

    const known = await s.repo.findKnownCandidates('u1', 'Test Grill', 'Chicken shawarma wrap');
    expect(known[0].totals.calories).toBe(600);
    expect(known[0].source).toBe('known_meal');
    // edited → not promoted to global
    expect(await s.repo.getKnown(null, normalizeKey('Test Grill', 'Chicken shawarma wrap'))).toBeNull();

    s.claude.calls.length = 0;
    await s.meals.analyzePhoto('u1', JPEG, 'image/jpeg', { restaurant: 'test grill', mealName: 'chicken shawarma' });
    const userText = s.claude.calls[0].messages[0].content[1].text;
    expect(userText).toContain('KNOWN MEALS');
    expect(userText).toContain('600 kcal');
  });

  it('unedited verified published meals become global knowledge', async () => {
    const s = setup();
    const { meal } = await s.meals.analyzePhoto('u1', JPEG, 'image/jpeg', {});
    await s.meals.confirm('u1', meal.id);
    const g = await s.repo.getKnown(null, normalizeKey('Test Grill', 'Chicken shawarma wrap'));
    expect(g?.source).toBe('restaurant_published');
    // another user benefits
    const forU2 = await s.repo.findKnownCandidates('u2', 'Test Grill', 'shawarma wrap');
    expect(forU2).toHaveLength(1);
  });

  it('rejects non-images and isolates users', async () => {
    const s = setup();
    await expect(s.meals.analyzePhoto('u1', JPEG, 'application/pdf', {})).rejects.toThrow();
    const { meal } = await s.meals.analyzePhoto('u1', JPEG, 'image/jpeg', {});
    await expect(s.meals.get('u2', meal.id)).rejects.toThrow();
  });
});

describe('energy balance', () => {
  it('uses one source per day (no double counting) and computes remaining', async () => {
    const s = setup();
    await s.profiles.update('u1', { goal: 'lose' }); // → -500
    const date = '2026-11-15';
    await s.energy.ingest('u1', [
      { date, source: 'apple_health', activeKcal: 600, basalKcal: 1600 },
      { date, source: 'whoop', totalKcal: 2400 },
    ]);
    const m = await s.meals.createManual('u1', { meal_name: 'Lunch', items: [item()], eatenAt: '2026-11-15T09:00:00Z' });
    await s.meals.confirm('u1', m.id);
    const b = await s.energy.balance('u1', date);
    expect(b.burn?.source).toBe('whoop');
    expect(b.burn?.totalKcal).toBe(2400);
    expect(b.intake.calories).toBe(520);
    expect(b.targetIntakeKcal).toBe(1900);
    expect(b.remainingKcal).toBe(1380);

    await s.profiles.update('u1', { preferredEnergySource: 'apple_health' });
    expect((await s.energy.balance('u1', date)).burn?.totalKcal).toBe(2200);
  });

  it('falls back to Mifflin-St Jeor TDEE without devices', async () => {
    const s = setup();
    await s.profiles.update('u1', { sex: 'female', birthYear: 2000, heightCm: 165, weightKg: 60, activityLevel: 'light' });
    const b = await s.energy.balance('u1', '2026-11-01');
    // BMR = 600 + 1031.25 - 130 - 161 = 1340 → ×1.375 = 1843
    expect(b.burn?.source).toBe('estimate');
    expect(b.burn?.totalKcal).toBe(1843);
  });
});

describe('WHOOP', () => {
  it('OAuth state round-trip, sync converts kJ → kcal per local day, refreshes on 401', async () => {
    const s = setup();
    const cfg = config({
      WHOOP_CLIENT_ID: 'cid',
      WHOOP_CLIENT_SECRET: 'sec',
      WHOOP_REDIRECT_URI: 'https://api.test/integrations/whoop/callback',
    });
    let cycleCalls = 0;
    const fetchFn: any = vi.fn(async (url: string, init?: any): Promise<any> => {
      if (url.includes('/oauth2/token')) {
        const body = new URLSearchParams(init.body);
        return json({ access_token: body.get('grant_type') === 'refresh_token' ? 'A2' : 'A1', refresh_token: 'R1', expires_in: 3600 });
      }
      if (url.includes('/v2/cycle')) {
        cycleCalls++;
        if (init.headers.Authorization === 'Bearer A1') return { ok: false, status: 401, text: async () => 'expired' };
        return json({
          records: [
            // Dubai: sleep 23:00 Nov 14 → 23:30 Nov 15 ⇒ Nov 15
            { id: 1, start: '2026-11-14T19:00:00Z', end: '2026-11-15T19:30:00Z', score_state: 'SCORED', score: { kilojoule: 10460, strain: 10 } },
            { id: 2, start: '2026-11-15T19:30:00Z', end: null, score_state: 'PENDING_SCORE' },
          ],
        });
      }
      throw new Error('unexpected ' + url);
    });
    const whoop = new WhoopService(cfg, s.repo, s.energy, s.profiles, fetchFn);
    const url = new URL(whoop.authorizeUrl('u1'));
    expect(url.searchParams.get('scope')).toContain('read:cycles');
    expect(await whoop.handleCallback('code', url.searchParams.get('state')!)).toBe('u1');
    await expect(whoop.handleCallback('code', 'tampered.sig')).rejects.toThrow();

    const r = await whoop.sync('u1', '2026-11-15', '2026-11-15');
    expect(cycleCalls).toBe(2); // 401 then retry with refreshed token
    expect(r.days).toEqual({ '2026-11-15': 2500 });
    const b = await s.energy.balance('u1', '2026-11-15');
    expect(b.burn).toMatchObject({ source: 'whoop', totalKcal: 2500 });
  });
});

function json(o: any): any {
  return { ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) };
}
