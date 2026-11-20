/**
 * Goal engine — pure functions (no I/O) so every rule is unit-tested.
 *
 * Evidence used for the defaults:
 *  - Loss pace: ~0.5–1 kg (1–2 lb) per week is the commonly recommended sustainable rate (CDC).
 *    We express pace as % of body weight per week and cap it at 1 kg/week.
 *  - Calorie floor: AHA/ACC/TOS adult guideline prescribes 1200–1500 kcal/d (women) and
 *    1500–1800 kcal/d (men) for weight-loss diets — we never set targets below the lower bound,
 *    nor below estimated BMR.
 *  - Protein: ISSN position stand — 1.4–2.0 g/kg/day for exercising individuals.
 *  - Fibre: ~14 g per 1000 kcal (Dietary Guidelines for Americans).
 *  - Energy density of body-mass change: ~7700 kcal per kg (≈3500 kcal/lb rule of thumb).
 */

export type Goal = 'lose' | 'maintain' | 'gain';
export type Pace = 'relaxed' | 'moderate' | 'fast';
export type Sex = 'male' | 'female' | null;

export const KCAL_PER_KG = 7700;

/** Weekly change as a fraction of body weight. */
export const PACE_RATE: Record<'lose' | 'gain', Record<Pace, number>> = {
  lose: { relaxed: 0.0025, moderate: 0.005, fast: 0.0075 },
  gain: { relaxed: 0.00125, moderate: 0.0025, fast: 0.004 },
};
const MAX_LOSS_KG_WEEK = 1.0;
const MAX_GAIN_KG_WEEK = 0.5;
const MAX_DEFICIT = 1000;
const MAX_SURPLUS = 500;

export interface Screening {
  pregnant?: boolean;
  breastfeeding?: boolean;
  /** user says a clinician should guide their diet (diabetes on insulin, kidney disease, etc.) */
  medicalSupervision?: boolean;
  /** user reports a history of disordered eating */
  edHistory?: boolean;
}

export interface PlanInput {
  goal: Goal;
  pace: Pace;
  sex: Sex;
  age: number | null;
  heightCm: number | null;
  weightKg: number | null; // current (trend) weight
  targetWeightKg: number | null;
  maintenanceKcal: number; // best TDEE estimate
  maintenanceSource: 'adaptive' | 'device' | 'formula';
  bmr: number | null;
  screening: Screening;
  today?: Date;
}

export interface Plan {
  goal: Goal;
  effectiveGoal: Goal; // after safety rules
  pace: Pace;
  maintenanceKcal: number;
  maintenanceSource: PlanInput['maintenanceSource'];
  dailyDeltaKcal: number;
  targetKcal: number;
  floorKcal: number;
  limitedByFloor: boolean;
  weeklyChangeKg: number; // negative = loss
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
  bmi: number | null;
  targetBmi: number | null;
  etaDate: string | null;
  weeksToGoal: number | null;
  notices: { level: 'info' | 'warn' | 'stop'; code: string; text_ar: string }[];
}

const r = (n: number, step = 1) => Math.round(n / step) * step;

export function bmiOf(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function calorieFloor(sex: Sex, bmr: number | null): number {
  const sexFloor = sex === 'male' ? 1500 : sex === 'female' ? 1200 : 1400;
  return Math.max(sexFloor, bmr ? r(bmr, 10) : 0);
}

export function computePlan(i: PlanInput): Plan {
  const notices: Plan['notices'] = [];
  const bmi = bmiOf(i.weightKg, i.heightCm);
  const targetBmi = bmiOf(i.targetWeightKg, i.heightCm);
  let goal: Goal = i.goal;

  // ---- safety rules: when any applies we do not prescribe a deficit or surplus ----
  const s = i.screening ?? {};
  if (i.age != null && i.age < 18) {
    notices.push({ level: 'stop', code: 'under18', text_ar: 'لمن هم دون 18 سنة نعرض أرقاماً للمتابعة فقط بدون هدف إنقاص أو زيادة. استشر طبيب الأطفال أو أخصائي تغذية.' });
    goal = 'maintain';
  }
  if (s.pregnant || s.breastfeeding) {
    notices.push({ level: 'stop', code: 'pregnancy', text_ar: 'أثناء الحمل أو الرضاعة لا يضع التطبيق عجزاً في السعرات. احتياجك يحدده طبيبك.' });
    goal = 'maintain';
  }
  if (s.edHistory) {
    notices.push({ level: 'stop', code: 'ed', text_ar: 'لسلامتك لن نضع هدفاً لإنقاص الوزن. يمكنك استخدام التطبيق للمتابعة، ونشجعك على العمل مع مختص.' });
    if (goal === 'lose') goal = 'maintain';
  }
  if (s.medicalSupervision) {
    notices.push({ level: 'warn', code: 'medical', text_ar: 'لديك حالة صحية تحتاج إشرافاً: راجع طبيبك قبل تغيير نظامك الغذائي، والأرقام هنا إرشادية.' });
  }
  if (goal === 'lose' && bmi != null && bmi < 18.5) {
    notices.push({ level: 'stop', code: 'underweight', text_ar: 'مؤشر كتلة جسمك أقل من 18.5، لذلك لا ننصح بإنقاص الوزن. حوّلنا هدفك إلى المحافظة.' });
    goal = 'maintain';
  }
  if (goal === 'lose' && targetBmi != null && targetBmi < 18.5) {
    notices.push({ level: 'warn', code: 'target_low', text_ar: 'الوزن المستهدف يجعل مؤشر كتلة الجسم أقل من 18.5. ننصح بهدف أعلى.' });
  }
  if (goal === 'lose' && i.targetWeightKg && i.weightKg && i.targetWeightKg >= i.weightKg) {
    notices.push({ level: 'info', code: 'target_reached', text_ar: 'وصلت إلى وزنك المستهدف 🎉 — حان وقت المحافظة.' });
    goal = 'maintain';
  }
  if (goal === 'gain' && i.targetWeightKg && i.weightKg && i.targetWeightKg <= i.weightKg) {
    notices.push({ level: 'info', code: 'target_reached', text_ar: 'وصلت إلى وزنك المستهدف 🎉 — حان وقت المحافظة.' });
    goal = 'maintain';
  }

  // ---- energy target ----
  const floor = calorieFloor(i.sex, i.bmr);
  let delta = 0;
  let weekly = 0;
  if (goal !== 'maintain' && i.weightKg) {
    const rate = PACE_RATE[goal][i.pace] * i.weightKg; // kg/week
    const capped = goal === 'lose' ? Math.min(rate, MAX_LOSS_KG_WEEK) : Math.min(rate, MAX_GAIN_KG_WEEK);
    delta = (capped * KCAL_PER_KG) / 7;
    delta = goal === 'lose' ? -Math.min(delta, MAX_DEFICIT, 0.25 * i.maintenanceKcal) : Math.min(delta, MAX_SURPLUS);
  } else if (goal !== 'maintain') {
    delta = goal === 'lose' ? -400 : 250; // no weight known yet: conservative default
  }
  let target = i.maintenanceKcal + delta;
  let limitedByFloor = false;
  if (target < floor) {
    target = floor;
    limitedByFloor = goal === 'lose';
    if (limitedByFloor) {
      notices.push({ level: 'info', code: 'floor', text_ar: `هدفك محدود بحد أدنى آمن (${floor} سعرة)، لذلك سيكون التقدم أبطأ قليلاً.` });
    }
  }
  target = r(target, 10);
  delta = target - i.maintenanceKcal;
  weekly = Math.round(((delta * 7) / KCAL_PER_KG) * 100) / 100;

  // ---- macros ----
  const w = i.weightKg ?? 70;
  // For higher BMI, base protein on a reference weight (BMI 25) to avoid inflated targets.
  const refW = bmi && bmi > 30 && i.heightCm ? 25 * (i.heightCm / 100) ** 2 : w;
  const proteinPerKg = goal === 'maintain' ? 1.4 : 1.8; // within ISSN 1.4–2.0 g/kg
  const proteinG = r(refW * proteinPerKg, 5);
  const fatG = Math.max(r((target * 0.28) / 9, 5), r(w * 0.6, 5));
  const carbsG = Math.max(0, r((target - proteinG * 4 - fatG * 9) / 4, 5));
  const fiberG = r((target / 1000) * 14);

  // ---- ETA ----
  let weeksToGoal: number | null = null;
  let etaDate: string | null = null;
  if (goal !== 'maintain' && i.weightKg && i.targetWeightKg && weekly !== 0) {
    const weeks = (i.targetWeightKg - i.weightKg) / weekly;
    if (weeks > 0 && Number.isFinite(weeks)) {
      weeksToGoal = Math.ceil(weeks);
      const d = new Date(i.today ?? new Date());
      d.setDate(d.getDate() + Math.round(weeks * 7));
      etaDate = d.toISOString().slice(0, 10);
    }
  }

  return {
    goal: i.goal,
    effectiveGoal: goal,
    pace: i.pace,
    maintenanceKcal: r(i.maintenanceKcal, 10),
    maintenanceSource: i.maintenanceSource,
    dailyDeltaKcal: delta,
    targetKcal: target,
    floorKcal: floor,
    limitedByFloor,
    weeklyChangeKg: weekly,
    proteinG,
    fatG,
    carbsG,
    fiberG,
    bmi,
    targetBmi,
    etaDate,
    weeksToGoal,
    notices,
  };
}

/** Exponentially-weighted trend of daily weights (smooths water/food noise). */
export function weightTrend(points: { date: string; kg: number }[], alpha = 0.1): { date: string; kg: number; trend: number }[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  let t: number | null = null;
  let prevDate: string | null = null;
  return sorted.map((p) => {
    if (t == null) t = p.kg;
    else {
      // account for gaps: apply the smoothing once per elapsed day
      const gap = prevDate ? Math.max(1, Math.round((Date.parse(p.date) - Date.parse(prevDate)) / 86400000)) : 1;
      const a = 1 - Math.pow(1 - alpha, gap);
      t = t + a * (p.kg - t);
    }
    prevDate = p.date;
    return { date: p.date, kg: p.kg, trend: Math.round(t * 100) / 100 };
  });
}

/**
 * Adaptive maintenance: what the body actually burned = average intake − stored energy change.
 * Needs ≥10 logged days and a weight trend spanning ≥10 days; blended with the baseline and clamped.
 */
export function adaptiveMaintenance(opts: {
  baseline: number;
  loggedDays: { date: string; kcal: number }[];
  trend: { date: string; trend: number }[];
}): { kcal: number; adaptive: boolean; observed: number | null } {
  const days = opts.loggedDays.filter((d) => d.kcal >= 600); // skip clearly incomplete days
  if (days.length < 10 || opts.trend.length < 2) return { kcal: opts.baseline, adaptive: false, observed: null };
  const first = opts.trend[0];
  const last = opts.trend[opts.trend.length - 1];
  const span = (Date.parse(last.date) - Date.parse(first.date)) / 86400000;
  if (span < 10) return { kcal: opts.baseline, adaptive: false, observed: null };
  const avgIntake = days.reduce((a, d) => a + d.kcal, 0) / days.length;
  const observed = avgIntake - ((last.trend - first.trend) * KCAL_PER_KG) / span;
  const clamped = Math.min(opts.baseline * 1.35, Math.max(opts.baseline * 0.7, observed));
  const w = Math.min(1, days.length / 21) * 0.7;
  return { kcal: Math.round(opts.baseline * (1 - w) + clamped * w), adaptive: true, observed: Math.round(observed) };
}
