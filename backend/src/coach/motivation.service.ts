import { Inject, Injectable } from '@nestjs/common';
import { localDate } from '../common/dates';
import { addDays, PlanService } from '../plan/plan.service';
import { ProfileService } from '../profile/profile.service';
import { REPOSITORY, Repository } from '../storage/repository';

export interface DayStat {
  date: string;
  meals: number;
  kcal: number;
  protein: number;
  fiber: number;
}

/** Consecutive days with ≥1 confirmed meal. Today without a meal yet does not break the streak. */
export function streaks(days: DayStat[], today: string, pred: (d: DayStat) => boolean = (d) => d.meals > 0) {
  const by = new Map(days.map((d) => [d.date, d]));
  let current = 0;
  let cursor = by.get(today) && pred(by.get(today)!) ? today : addDays(today, -1);
  while (by.get(cursor) && pred(by.get(cursor)!)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  let best = 0, run = 0;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let prev: string | null = null;
  for (const d of sorted) {
    if (pred(d)) {
      run = prev && addDays(prev, 1) === d.date ? run + 1 : 1;
      prev = d.date;
      best = Math.max(best, run);
    } else {
      run = 0;
      prev = null;
    }
  }
  return { current, best: Math.max(best, current), loggedToday: !!(by.get(today) && pred(by.get(today)!)) };
}

/** Monday-based week start (YYYY-MM-DD). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return addDays(date, -dow);
}

const CHALLENGES = {
  log5: { title_ar: 'سجّل وجباتك 5 أيام هذا الأسبوع', desc_ar: 'التسجيل المنتظم هو أقوى عادة للوصول لهدفك.', target: 5, unit: 'أيام' },
  protein4: { title_ar: 'حقق هدف البروتين 4 أيام', desc_ar: 'البروتين يحافظ على عضلاتك ويقلل الجوع.', target: 4, unit: 'أيام' },
  fiber4: { title_ar: 'وصّل الألياف لهدفك 4 أيام', desc_ar: 'خضار وبقوليات وفاكهة كاملة — للشبع وصحة الهضم.', target: 4, unit: 'أيام' },
  move3: { title_ar: 'تمرّن 3 مرات هذا الأسبوع', desc_ar: 'أي نشاط يُسجَّل في WHOOP أو Apple Health يُحتسب.', target: 3, unit: 'تمارين' },
  ontarget5: { title_ar: 'ابقَ ضمن هدف السعرات 5 أيام', desc_ar: 'الثبات أهم من الكمال.', target: 5, unit: 'أيام' },
} as const;
type ChallengeId = keyof typeof CHALLENGES;

@Injectable()
export class MotivationService {
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly plans: PlanService,
    private readonly profiles: ProfileService,
  ) {}

  async summary(userId: string) {
    const profile = await this.profiles.get(userId);
    const today = localDate(new Date(), profile.timezone);
    const from = addDays(today, -179);
    const [meals, plan, weights, workouts] = await Promise.all([
      this.repo.listMealsRange(userId, from, today),
      this.plans.plan(userId),
      this.plans.weights(userId, 365),
      this.repo.listWorkouts(userId, from, today),
    ]);
    const confirmed = meals.filter((m) => m.status === 'confirmed');
    const byDay = new Map<string, DayStat>();
    for (const m of confirmed) {
      const d = byDay.get(m.date) ?? { date: m.date, meals: 0, kcal: 0, protein: 0, fiber: 0 };
      d.meals++;
      d.kcal += m.final.totals.calories;
      d.protein += m.final.totals.protein_g;
      d.fiber += m.final.totals.fiber_g;
      byDay.set(m.date, d);
    }
    const days = [...byDay.values()];
    const gain = plan.effectiveGoal === 'gain';
    const onTarget = (d: DayStat) => d.meals > 0 && (gain ? d.kcal >= plan.targetKcal * 0.95 && d.kcal <= plan.targetKcal * 1.15 : d.kcal <= plan.targetKcal);
    const proteinHit = (d: DayStat) => d.protein >= plan.proteinG * 0.9;
    const fiberHit = (d: DayStat) => d.fiber >= plan.fiberG * 0.9;

    const logStreak = streaks(days, today);
    const targetStreak = streaks(days, today, onTarget);

    // ---- badges (earned + progress) ----
    const lost = plan.startWeightKg && plan.currentWeightKg ? plan.startWeightKg - plan.currentWeightKg : 0;
    const b = (id: string, title_ar: string, desc_ar: string, value: number, target: number) => ({
      id, title_ar, desc_ar, earned: value >= target, progress: Math.min(value, target), target,
    });
    const badges = [
      b('first_meal', 'البداية', 'سجّلت أول وجبة', confirmed.length, 1),
      b('streak_3', '3 أيام متتالية', 'سجّل 3 أيام متتالية', logStreak.best, 3),
      b('streak_7', 'أسبوع كامل', 'سجّل 7 أيام متتالية', logStreak.best, 7),
      b('streak_30', 'شهر من الالتزام', 'سجّل 30 يوماً متتالياً', logStreak.best, 30),
      b('meals_50', '50 وجبة', 'سجّل 50 وجبة', confirmed.length, 50),
      b('on_target_7', 'ضمن الهدف', '7 أيام ضمن هدف السعرات', days.filter(onTarget).length, 7),
      b('protein_5', 'بطل البروتين', 'حقق هدف البروتين 5 أيام', days.filter(proteinHit).length, 5),
      b('first_weight', 'أول قياس', 'سجّل وزنك لأول مرة', weights.entries.length, 1),
      gain
        ? b('gain_2', '+2 كغ', 'زيادة 2 كغ نحو هدفك', Math.max(0, -lost), 2)
        : b('lose_2', '−2 كغ', 'نزول 2 كغ من وزن البداية', Math.max(0, lost), 2),
      gain
        ? b('gain_5', '+5 كغ', 'زيادة 5 كغ نحو هدفك', Math.max(0, -lost), 5)
        : b('lose_5', '−5 كغ', 'نزول 5 كغ من وزن البداية', Math.max(0, lost), 5),
      b('workouts_10', 'نشيط', 'سجّل 10 تمارين', workouts.length, 10),
    ].map((x) => ({ ...x, progress: Math.round(x.progress * 10) / 10 }));

    // ---- weekly challenge: picked once per week from the weakest area of the last 14 days ----
    const ws = weekStart(today);
    const key = `challenge:${ws}`;
    let id = ((await this.repo.getCache(userId, key))?.payload as { id: ChallengeId } | undefined)?.id;
    if (!id) {
      const last14 = days.filter((d) => d.date >= addDays(today, -14) && d.date < today);
      const avgP = last14.length ? last14.reduce((a, d) => a + d.protein, 0) / last14.length : 0;
      const avgF = last14.length ? last14.reduce((a, d) => a + d.fiber, 0) / last14.length : 0;
      const recentWorkouts = workouts.filter((w) => w.date >= addDays(today, -14)).length;
      id =
        last14.length < 8 ? 'log5'
        : avgP < plan.proteinG * 0.8 ? 'protein4'
        : avgF < plan.fiberG * 0.7 ? 'fiber4'
        : recentWorkouts < 4 ? 'move3'
        : 'ontarget5';
      await this.repo.setCache({ userId, key, payload: { id }, createdAt: new Date().toISOString() });
    }
    const weekDays = days.filter((d) => d.date >= ws && d.date <= today);
    const progress =
      id === 'log5' ? weekDays.length
      : id === 'protein4' ? weekDays.filter(proteinHit).length
      : id === 'fiber4' ? weekDays.filter(fiberHit).length
      : id === 'move3' ? workouts.filter((w) => w.date >= ws).length
      : weekDays.filter(onTarget).length;
    const c = CHALLENGES[id];
    const challenge = {
      id, ...c, progress: Math.min(progress, c.target), done: progress >= c.target,
      weekStart: ws, daysLeft: Math.max(0, 6 - Math.round((Date.parse(today) - Date.parse(ws)) / 86400000)),
    };

    return {
      streak: logStreak,
      onTargetStreak: { current: targetStreak.current, best: targetStreak.best },
      badges,
      earnedCount: badges.filter((x) => x.earned).length,
      challenge,
    };
  }
}
