import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { NutritionAgentService } from '../src/agent/nutrition-agent.service';
import { AssistantService, splitOptions } from '../src/assistant/assistant.service';
import { MotivationService } from '../src/coach/motivation.service';
import { toEnglish } from '../src/common/i18n-errors';
import { EnergyService } from '../src/energy/energy.service';
import { MealsService } from '../src/meals/meals.service';
import { PlanService } from '../src/plan/plan.service';
import { ProfileService } from '../src/profile/profile.service';
import { MemoryRepository } from '../src/storage/memory.repository';
import { WorkoutsService } from '../src/workouts/workouts.service';
import { DAILY_LIMITS, UsageService } from '../src/auth/auth.service';

function setup(agent: NutritionAgentService) {
  const repo = new MemoryRepository();
  const profiles = new ProfileService(repo);
  const plans = new PlanService(repo, profiles);
  const workouts = new WorkoutsService(repo, profiles);
  const energy = new EnergyService(repo, profiles, plans, workouts);
  const meals = new MealsService(repo, agent, profiles, plans);
  const motivation = new MotivationService(repo, plans, profiles);
  const assistant = new AssistantService(repo, agent, profiles, plans, energy, meals, motivation);
  return { repo, profiles, plans, assistant };
}

describe('assistant (Anthropic tool loop)', () => {
  it('reads data via tools, proposes actions, saves history; confirm executes, dismiss cancels', async () => {
    const calls: any[] = [];
    const script = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'get_day', input: {} }] },
      { stop_reason: 'tool_use', content: [{ type: 'text', text: '' }, { type: 'tool_use', id: 'b', name: 'propose_log_weight', input: { kg: 81.5 } }, { type: 'tool_use', id: 'c', name: 'propose_update_plan', input: { goal: 'lose', pace: 'relaxed', bogus: 1 } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done — tap Confirm.' }] },
    ];
    const client = { messages: { create: vi.fn(async (p: any) => { calls.push(JSON.parse(JSON.stringify(p))); return script[calls.length - 1]; }) } };
    const s = setup(new NutritionAgentService(client, new ConfigService({ ANTHROPIC_API_KEY: 'x' })));
    await s.profiles.update('u', { sex: 'male', birthYear: 1990, heightCm: 178, weightKg: 85, goal: 'maintain' } as any);

    const r = await s.assistant.chat('u', { message: 'I weigh 81.5 now, switch me to slow weight loss', screen: 'plan' });
    expect(r.message.text).toBe('Done — tap Confirm.');
    expect(r.toolsUsed).toEqual(['get_day', 'propose_log_weight', 'propose_update_plan']);
    expect(calls[0].system).toContain('StrainEat');
    expect(calls[0].system).toContain('"plan" screen');
    expect(calls[0].system).toMatch(/Water: plain water/);
    expect(calls[0].system).toContain('Scope (strict)');
    expect(calls[0].system).toContain('ambulance 998');
    expect(calls[0].tools.map((t: any) => t.name)).toContain('get_history');
    // tool results are echoed back to the model
    const res = calls[1].messages.at(-1).content[0];
    expect(res.type).toBe('tool_result');
    expect(JSON.parse(res.content).balance).toBeTruthy();

    const [w, p] = r.message.actions!;
    expect(w).toMatchObject({ kind: 'log_weight', status: 'pending', args: { kg: 81.5 } });
    expect(p.args).toEqual({ goal: 'lose', pace: 'relaxed' });
    expect((await s.assistant.history('u')).messages).toHaveLength(2);

    const done = await s.assistant.confirm('u', w.id, async () => {});
    expect(done.action.status).toBe('done');
    expect((await s.plans.weights('u', 30)).entries.at(-1)?.kg).toBe(81.5);
    expect((await s.assistant.confirm('u', w.id, async () => {})).action.status).toBe('done'); // idempotent
    expect((await s.assistant.dismiss('u', p.id)).action.status).toBe('dismissed');
    expect((await s.profiles.get('u')).goal).toBe('maintain');

    await s.assistant.clear('u');
    expect((await s.assistant.history('u')).messages).toHaveLength(0);
  });

  it('update_plan confirm changes the profile; previous cards are visible to the model next turn', async () => {
    let n = 0;
    const seen: any[] = [];
    const client = { messages: { create: vi.fn(async (p: any) => { seen.push(p); n++; return n === 1
      ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'propose_update_plan', input: { goal: 'gain' } }] }
      : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; }) } };
    const s = setup(new NutritionAgentService(client, new ConfigService({ ANTHROPIC_API_KEY: 'x' })));
    const r = await s.assistant.chat('u', { message: 'I want to gain weight' });
    await s.assistant.confirm('u', r.message.actions![0].id, async () => {});
    expect((await s.profiles.get('u')).goal).toBe('gain');
    await s.assistant.chat('u', { message: 'thanks' });
    expect(JSON.stringify(seen.at(-1).messages)).toContain('update_plan');
    expect(JSON.stringify(seen.at(-1).messages)).toContain('done');
  });

  it('rejects empty messages and validates proposals', async () => {
    const client = { messages: { create: vi.fn(async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'propose_log_weight', input: { kg: 5 } }] })) } };
    const s = setup(new NutritionAgentService(client, new ConfigService({ ANTHROPIC_API_KEY: 'x' })));
    await expect(s.assistant.chat('u', { message: '  ' })).rejects.toThrow();
    const r = await s.assistant.chat('u', { message: 'log 5kg' });
    expect(r.message.actions).toBeUndefined();
  });
});

describe('assistant read tools', () => {
  it('every read tool returns data without errors', async () => {
    const reads = ['get_day', 'get_history', 'get_meals_range', 'get_plan', 'get_weights', 'get_motivation', 'get_favorites'];
    const results: any[] = [];
    let n = 0;
    const client = { messages: { create: vi.fn(async (p: any) => {
      if (n > 0) results.push(...p.messages.at(-1).content);
      n++;
      return n === 1
        ? { stop_reason: 'tool_use', content: reads.map((name, i) => ({ type: 'tool_use', id: `t${i}`, name, input: name === 'get_history' ? { days: 7 } : name === 'get_meals_range' ? { from: '2020-01-01', to: '2099-01-01' } : {} })) }
        : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
    }) } };
    const s = setup(new NutritionAgentService(client, new ConfigService({ ANTHROPIC_API_KEY: 'x' })));
    await s.profiles.update('u', { sex: 'female', birthYear: 1998, heightCm: 165, weightKg: 80, goal: 'lose', targetWeightKg: 70 } as any);
    await s.plans.addWeight('u', { kg: 80 });
    await s.assistant.chat('u', { message: 'analyse everything' });
    expect(results).toHaveLength(reads.length);
    for (const r of results) expect(JSON.parse(r.content).error, r.content).toBeUndefined();
    expect(JSON.parse(results[3].content).plan.targetKcal).toBeGreaterThan(1000);
  });
});

describe('assistant (Gemini function calling)', () => {
  it('declares functions, echoes model parts with thought signatures, returns final text in Arabic profile', async () => {
    const bodies: any[] = [];
    const fetchFn: any = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      const parts = bodies.length === 1
        ? [{ functionCall: { name: 'get_history', args: { days: 7 } }, thoughtSignature: 'sig' }]
        : [{ text: 'متوسطك هذا الأسبوع جيد.' }];
      return { ok: true, json: async () => ({ candidates: [{ content: { role: 'model', parts } }] }) };
    });
    const s = setup(new NutritionAgentService(null, new ConfigService({ GEMINI_API_KEY: 'g' }), fetchFn));
    await s.profiles.update('u', { language: 'ar' } as any);
    const r = await s.assistant.chat('u', { message: 'كيف أسبوعي؟' });
    expect(r.message.text).toBe('متوسطك هذا الأسبوع جيد.');
    expect(bodies[0].tools[0].functionDeclarations.some((d: any) => d.name === 'get_history' && d.parametersJsonSchema)).toBe(true);
    expect(bodies[0].systemInstruction.parts[0].text).toContain('Arabic');
    expect(bodies[1].contents[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'get_history', args: { days: 7 } }, thoughtSignature: 'sig' }] });
    expect(bodies[1].contents[2].parts[0].functionResponse.response.result.days).toHaveLength(7);
  });
});

describe('assistant Gemini overload', () => {
  it('retries a 503 and falls back to the lighter model', async () => {
    const urls: string[] = [];
    const fetchFn: any = vi.fn(async (url: string) => {
      urls.push(url);
      if (!url.includes('flash-lite')) return { ok: false, status: 503, text: async () => '{"error":{"status":"UNAVAILABLE"}}' };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] } }] }) };
    });
    const s = setup(new NutritionAgentService(null, new ConfigService({ GEMINI_API_KEY: 'g' }), fetchFn));
    const r = await s.assistant.chat('u', { message: 'hello' });
    expect(r.message.text).toBe('hi');
    expect(urls).toHaveLength(3);
    expect(urls[2]).toContain('gemini-3.5-flash-lite');
    expect(toEnglish('خدمة الذكاء الاصطناعي مزدحمة الآن، جرّب بعد دقيقة')).toContain('busy');
  });
});

describe('assistant daily free quota', () => {
  it('switches to the fallback model when the daily free quota is used up', async () => {
    const urls: string[] = [];
    const fetchFn: any = vi.fn(async (url: string) => {
      urls.push(url);
      if (!url.includes('flash-lite')) return { ok: false, status: 429, text: async () => '{"error":{"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 20"}}' };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] }) };
    });
    const s = setup(new NutritionAgentService(null, new ConfigService({ GEMINI_API_KEY: 'g' }), fetchFn));
    expect((await s.assistant.chat('u', { message: 'hi' })).message.text).toBe('ok');
    expect(urls).toHaveLength(2);
  });
});

describe('assistant quota', () => {
  it('has a daily chat limit with an English translation', async () => {
    expect(DAILY_LIMITS.chat).toBe(30);
    const u = new UsageService(new MemoryRepository());
    for (let i = 0; i < 30; i++) await u.consume('x', 'user', 'chat');
    const err: any = await u.consume('x', 'user', 'chat').catch((e) => e);
    expect(err.getStatus()).toBe(429);
    expect(toEnglish(err.message)).toBe('Daily assistant message limit reached (30). Try again tomorrow.');
    expect(toEnglish('اكتب رسالتك')).toBe('Type your message');
  });
});

describe('assistant tap-to-send options', () => {
  it('parses the OPTIONS block into chips and strips it from the text', () => {
    expect(splitOptions('Which goal?\n\nOPTIONS:\n> Lose weight\n> Maintain\n- Gain muscle')).toEqual({ text: 'Which goal?', options: ['Lose weight', 'Maintain', 'Gain muscle'] });
    expect(splitOptions('أي وجبة؟\n**OPTIONS:**\n> الفطور\n> الغداء')).toEqual({ text: 'أي وجبة؟', options: ['الفطور', 'الغداء'] });
    expect(splitOptions('No options here')).toEqual({ text: 'No options here', options: [] });
  });
  it('stores options on the reply', async () => {
    const client = { messages: { create: vi.fn(async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Pick one:\nOPTIONS:\n> Show my week\n> Protein ideas' }] })) } };
    const s = setup(new NutritionAgentService(client, new ConfigService({ ANTHROPIC_API_KEY: 'x' })));
    const r = await s.assistant.chat('u', { message: 'help' });
    expect(r.message).toMatchObject({ text: 'Pick one:', options: ['Show my week', 'Protein ideas'] });
  });
});
