import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { NutritionAgentService } from '../agent/nutrition-agent.service';
import { localDate } from '../common/dates';
import { EnergyService } from '../energy/energy.service';
import { addDays, pickEnergy, PlanService } from '../plan/plan.service';
import { ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';
import { ramadanView } from './coach-math';

const SAFETY = `Safety rules (always):
- Never suggest eating below the user's daily calorie target or skipping meals to "make up" for a big day.
- No crash diets, detoxes, laxatives, fasting beyond the user's own religious fasting, or supplements.
- If avoidRestriction is true, never talk about cutting calories; focus on balanced, nourishing choices.
- If the user has a medical-supervision flag, add a short reminder to follow their clinician's advice.
- Kind, practical, culturally relevant to the UAE/Gulf (local dishes, restaurants, cafés).`;

/** Output-language rule. JSON keys ending in "_ar" are historical names: their text follows this rule. */
export const langRule = (lang: string) =>
  lang === 'ar'
    ? 'Write every text field in Arabic (Gulf-friendly Modern Standard Arabic).'
    : 'Write every text field in clear, friendly English (field names ending in "_ar" still get English text). Local dish names may stay in their usual form, e.g. "chicken shawarma", "machboos".';

const SUGGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intro_ar: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title_ar: { type: 'string' },
          where_ar: { type: 'string', description: 'home, a restaurant the user already eats at, or a common UAE chain' },
          kcal: { type: 'number' },
          protein_g: { type: 'number' },
          why_ar: { type: 'string' },
        },
        required: ['title_ar', 'where_ar', 'kcal', 'protein_g', 'why_ar'],
      },
    },
  },
  required: ['intro_ar', 'options'],
} as const;

const WEEKLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline_ar: { type: 'string' },
    wins_ar: { type: 'array', items: { type: 'string' } },
    improve_ar: { type: 'array', items: { type: 'string' } },
    next_week_goal_ar: { type: 'string' },
  },
  required: ['headline_ar', 'wins_ar', 'improve_ar', 'next_week_goal_ar'],
} as const;

const minutes = (n: number) => n * 60_000;

@Injectable()
export class CoachService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly agent: NutritionAgentService,
    private readonly plans: PlanService,
    private readonly energy: EnergyService,
    private readonly profiles: ProfileService,
  ) {}

  private async cached<T>(userId: string, key: string, ttlMs: number, make: () => Promise<T>): Promise<T & { cached: boolean }> {
    const hit = await this.repo.getCache(userId, key);
    if (hit && Date.now() - Date.parse(hit.createdAt) < ttlMs) return { ...(hit.payload as T), cached: true };
    const fresh = await make();
    await this.repo.setCache({ userId, key, payload: fresh, createdAt: new Date().toISOString() });
    return { ...fresh, cached: false };
  }

  /** "What should I eat now?" — options that fit what is left today. */
  async suggest(userId: string, opts: { force?: boolean } = {}) {
    const profile = await this.profiles.get(userId);
    const b = await this.energy.balance(userId);
    const remaining = Math.round(b.remainingKcal);
    const proteinLeft = Math.max(0, Math.round(b.macroTargets.protein_g - b.intake.protein_g));
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: profile.timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    const ram = ramadanView(profile.ramadan, now, profile.timezone, b.targetIntakeKcal);

    // Preferences: the user's confirmed meals in the last 21 days (names + restaurants only).
    const today = localDate(now, profile.timezone);
    const recent = (await this.repo.listMealsRange(userId, addDays(today, -21), today)).filter((m) => m.status === 'confirmed');
    const favourites = [...new Map(recent.map((m) => [`${m.final.restaurant ?? ''}|${m.final.meal_name}`, m])).values()]
      .slice(-12)
      .map((m) => `${m.final.meal_name} / ${m.final.meal_name_ar}${m.final.restaurant ? ` (${m.final.restaurant})` : ''} — ${Math.round(m.final.totals.calories)} kcal, ${Math.round(m.final.totals.protein_g)} g protein`);

    const slot = ram.active
      ? ram.fasting ? 'iftar (the user is fasting now)' : hour < 4 || hour >= 22 ? 'suhoor' : 'evening meal after iftar'
      : hour < 5 || hour >= 22 ? 'light late snack' : hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 19 ? 'afternoon snack or early dinner' : 'dinner';
    const lang = profile.language ?? 'en';
    const key = `suggest:${lang}:${today}:${slot}:${Math.round(remaining / 75)}:${Math.round(proteinLeft / 10)}`;
    return this.cached(userId, key, opts.force ? 0 : minutes(45), async () => {
      const system = `You are StrainEat's nutrition coach. Suggest 3 or 4 concrete meal options for the user's next meal.\n${SAFETY}\n${langRule(lang)}\nEach option must state realistic kcal and protein. Prefer options close to the user's habits; include at least one home option and at least one from a restaurant they already use if any.`;
      const user = [
        `Meal slot: ${slot}. Local time hour: ${hour}. City: ${profile.city ?? 'UAE'}.`,
        `Goal: ${b.goal}. Calories left today: ${remaining}. Protein left today: ${proteinLeft} g. Fibre so far: ${Math.round(b.intake.fiber_g)} of ${b.macroTargets.fiber_g} g.`,
        ram.active && ram.split ? `Ramadan mode: suhoor ≈${ram.split.suhoor}, iftar ≈${ram.split.iftar}, evening ≈${ram.split.evening} kcal.` : '',
        `avoidRestriction: ${!!profile.screening?.edHistory}. medicalSupervision: ${!!profile.screening?.medicalSupervision}.`,
        favourites.length ? `Recent meals the user enjoyed:\n- ${favourites.join('\n- ')}` : 'No meal history yet.',
        b.goal === 'gain'
          ? 'For weight gain: options should be calorie- and protein-dense enough to close the gap.'
          : remaining <= 0
            ? 'The user has reached today’s target: suggest light, high-protein, high-fibre options under ~250 kcal, or simply water/tea if they are not hungry. No guilt.'
            : 'Keep every option within the calories left (or slightly under) and prioritise protein.',
      ].filter(Boolean).join('\n');
      const out = await this.agent.completeJson<{ intro_ar: string; options: any[] }>(system, user, SUGGEST_SCHEMA, 1500);
      const cap = b.goal === 'gain' ? Infinity : Math.max(250, remaining + 100);
      const options = (out.options ?? [])
        .map((o) => ({ ...o, kcal: Math.round(Number(o.kcal) || 0), protein_g: Math.round(Number(o.protein_g) || 0) }))
        .filter((o) => o.kcal > 0 && o.kcal <= cap)
        .slice(0, 4);
      return { slot, remainingKcal: remaining, proteinLeftG: proteinLeft, intro_ar: out.intro_ar ?? '', options };
    });
  }

  /** Weekly report: numbers computed here; the AI only writes the narrative. */
  async weekly(userId: string, opts: { force?: boolean } = {}) {
    const profile = await this.profiles.get(userId);
    const today = localDate(new Date(), profile.timezone);
    const end = addDays(today, -1);
    const start = addDays(end, -6);
    const [plan, meals, energy, weights, workouts] = await Promise.all([
      this.plans.plan(userId),
      this.repo.listMealsRange(userId, start, end),
      this.repo.listEnergyRange(userId, start, end),
      this.plans.weights(userId, 30),
      this.repo.listWorkouts(userId, start, end),
    ]);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const ms = meals.filter((m) => m.date === d && m.status === 'confirmed');
      const burn = pickEnergy(energy.filter((e) => e.date === d), profile.preferredEnergySource);
      days.push({
        date: d,
        logged: ms.length > 0,
        kcal: Math.round(ms.reduce((a, m) => a + m.final.totals.calories, 0)),
        protein: Math.round(ms.reduce((a, m) => a + m.final.totals.protein_g, 0)),
        fiber: Math.round(ms.reduce((a, m) => a + m.final.totals.fiber_g, 0)),
        burn: burn?.totalKcal ?? null,
      });
    }
    const logged = days.filter((d) => d.logged);
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : null);
    const onTarget = logged.filter((d) =>
      plan.effectiveGoal === 'gain' ? d.kcal >= plan.targetKcal * 0.95 && d.kcal <= plan.targetKcal * 1.15 : d.kcal <= plan.targetKcal,
    ).length;
    const wIn = weights.entries.filter((w) => w.date >= addDays(start, -1) && w.date <= end);
    const weightChange = wIn.length >= 2 ? Math.round((wIn[wIn.length - 1].trend - wIn[0].trend) * 10) / 10 : null;
    const stats = {
      from: start,
      to: end,
      loggedDays: logged.length,
      daysOnTarget: onTarget,
      avgKcal: avg(logged.map((d) => d.kcal)),
      targetKcal: plan.targetKcal,
      avgProtein: avg(logged.map((d) => d.protein)),
      proteinTarget: plan.proteinG,
      avgFiber: avg(logged.map((d) => d.fiber)),
      fiberTarget: plan.fiberG,
      avgBurn: avg(days.filter((d) => d.burn != null).map((d) => d.burn as number)),
      avgDeficit: (() => {
        const both = logged.filter((d) => d.burn != null);
        return both.length ? Math.round(both.reduce((a, d) => a + ((d.burn as number) - d.kcal), 0) / both.length) : null;
      })(),
      weightChangeKg: weightChange,
      workouts: workouts.length,
      workoutMinutes: Math.round(workouts.reduce((a, w) => a + w.durationMin, 0)),
      goal: plan.effectiveGoal,
      days,
    };
    const hash = createHash('sha1').update(JSON.stringify(stats)).digest('hex').slice(0, 10);
    const lang = profile.language ?? 'en';
    return this.cached(userId, `weekly:${lang}:${start}:${hash}`, opts.force ? 0 : minutes(60 * 12), async () => {
      if (stats.loggedDays === 0) {
        return {
          stats,
          narrative: lang === 'ar'
            ? {
                headline_ar: 'لم تُسجَّل وجبات هذا الأسبوع بعد',
                wins_ar: [],
                improve_ar: ['سجّل وجبة واحدة يومياً على الأقل ليتمكّن المدرب من تقييم أسبوعك.'],
                next_week_goal_ar: 'هدف الأسبوع القادم: تسجيل وجباتك 5 أيام من 7.',
              }
            : {
                headline_ar: 'No meals logged this week yet',
                wins_ar: [],
                improve_ar: ['Log at least one meal a day so the coach can review your week.'],
                next_week_goal_ar: "Next week's goal: log your meals 5 days out of 7.",
              },
        };
      }
      const system = `You are StrainEat's coach writing a short weekly review.\n${SAFETY}\n${langRule(lang)}\nUse ONLY the numbers given — do not invent data. 2–3 wins, 2–3 specific improvements, and one small, measurable goal for next week. Celebrate consistency. Keep each bullet under 25 words.`;
      const user = `avoidRestriction: ${!!profile.screening?.edHistory}\nWeek stats (JSON):\n${JSON.stringify({ ...stats, days: undefined, perDay: stats.days })}`;
      const narrative = await this.agent.completeJson<any>(system, user, WEEKLY_SCHEMA, 1200);
      return { stats, narrative };
    });
  }
}
