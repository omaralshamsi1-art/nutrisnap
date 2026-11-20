import { Nutrients } from '../common/types';

export interface MealScore {
  score: number; // 0–10
  grade: 'excellent' | 'good' | 'ok' | 'poor';
  label_ar: string;
  reasons: { good: boolean; text_ar: string }[];
}

/**
 * Transparent, rule-based meal score (no AI) so the same meal always gets the same score.
 *  protein density 0–3, fibre 0–2, added-sugar share 0–2, sodium 0–1, fit in today's budget 0–2.
 * For weight gain the budget rule rewards meals that move the user toward the target.
 */
export function scoreMeal(n: Nutrients, ctx: { goal: 'lose' | 'maintain' | 'gain'; remainingBeforeKcal: number; dailyTargetKcal: number }): MealScore {
  const reasons: MealScore['reasons'] = [];
  const kcal = Math.max(1, n.calories);
  let s = 0;

  const pShare = (n.protein_g * 4) / kcal;
  if (pShare >= 0.25) { s += 3; reasons.push({ good: true, text_ar: 'غنية بالبروتين' }); }
  else if (pShare >= 0.15) { s += 2; reasons.push({ good: true, text_ar: 'بروتين جيد' }); }
  else if (pShare >= 0.1) { s += 1; reasons.push({ good: false, text_ar: 'بروتين متوسط' }); }
  else reasons.push({ good: false, text_ar: 'بروتين قليل' });

  const fiberPer1000 = (n.fiber_g / kcal) * 1000;
  if (fiberPer1000 >= 14) { s += 2; reasons.push({ good: true, text_ar: 'ألياف ممتازة' }); }
  else if (fiberPer1000 >= 7) { s += 1; }
  else reasons.push({ good: false, text_ar: 'ألياف قليلة' });

  const sugarShare = (n.sugar_g * 4) / kcal;
  if (sugarShare <= 0.1) s += 2;
  else if (sugarShare <= 0.2) { s += 1; reasons.push({ good: false, text_ar: 'سكر متوسط' }); }
  else reasons.push({ good: false, text_ar: 'سكر مرتفع' });

  if (n.sodium_mg <= 800) s += 1;
  else if (n.sodium_mg > 1500) reasons.push({ good: false, text_ar: 'ملح مرتفع' });

  if (ctx.goal === 'gain') {
    // reward meaningful, not excessive, contributions toward a surplus
    const share = n.calories / Math.max(1, ctx.dailyTargetKcal);
    if (share >= 0.2 && n.calories <= ctx.remainingBeforeKcal + 300) { s += 2; reasons.push({ good: true, text_ar: 'تقرّبك من هدف الزيادة' }); }
    else if (share >= 0.12) s += 1;
    else reasons.push({ good: false, text_ar: 'كمية صغيرة لهدف الزيادة' });
  } else {
    if (n.calories <= ctx.remainingBeforeKcal) { s += 2; reasons.push({ good: true, text_ar: 'ضمن ميزانية اليوم' }); }
    else if (n.calories <= ctx.remainingBeforeKcal + 200) { s += 1; reasons.push({ good: false, text_ar: 'تتجاوز ميزانية اليوم قليلاً' }); }
    else reasons.push({ good: false, text_ar: 'تتجاوز ميزانية اليوم' });
  }

  const score = Math.max(0, Math.min(10, s));
  const grade = score >= 8 ? 'excellent' : score >= 6 ? 'good' : score >= 4 ? 'ok' : 'poor';
  const label_ar = { excellent: 'اختيار ممتاز', good: 'اختيار جيد', ok: 'مقبول', poor: 'يحتاج تحسين' }[grade];
  return { score, grade, label_ar, reasons: reasons.slice(0, 4) };
}

// ---------------------------------------------------------------- Ramadan

/** Hijri month (Umm al-Qura calendar) of a date in a timezone; 9 = Ramadan. */
export function hijriMonth(at: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone, month: 'numeric' })
    .formatToParts(at)
    .find((p) => p.type === 'month');
  return Number(part?.value ?? 0);
}

export function isRamadan(at: Date, timeZone: string): boolean {
  return hijriMonth(at, timeZone) === 9;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export interface RamadanView {
  active: boolean; // Ramadan (unless turned off) or turned on manually for voluntary fasting
  detected: boolean; // calendar says Ramadan
  needsChoice: boolean; // Ramadan detected and the user has not decided yet
  fasting: boolean; // between suhoor and iftar right now
  suhoorTime: string;
  iftarTime: string;
  split: { suhoor: number; iftar: number; evening: number } | null; // kcal
  minutesToIftar: number | null;
}

/** Suhoor ≈30%, iftar ≈45%, evening snack/second meal ≈25% of the daily target. */
export function ramadanView(
  setting: { enabled: boolean | null; suhoorTime: string; iftarTime: string } | undefined,
  now: Date,
  timeZone: string,
  targetKcal: number,
): RamadanView {
  const st = setting ?? { enabled: null, suhoorTime: '04:45', iftarTime: '18:00' };
  const detected = isRamadan(now, timeZone);
  // On automatically during Ramadan unless the user turned it off; the user may also turn it on for voluntary fasting days.
  const active = st.enabled === true || (detected && st.enabled !== false);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const nowMin = toMin(hm);
  const s = toMin(st.suhoorTime), i = toMin(st.iftarTime);
  const fasting = active && nowMin >= s && nowMin < i;
  const r = (x: number) => Math.round(x / 10) * 10;
  return {
    active,
    detected,
    needsChoice: detected && st.enabled === null,
    fasting,
    suhoorTime: st.suhoorTime,
    iftarTime: st.iftarTime,
    split: active ? { suhoor: r(targetKcal * 0.3), iftar: r(targetKcal * 0.45), evening: r(targetKcal * 0.25) } : null,
    minutesToIftar: fasting ? i - nowMin : null,
  };
}

/** Ramadan-specific nudges (shown instead of regular timing-based tips). */
export function ramadanTips(v: RamadanView, intakeKcal: number): { kind: string; text_ar: string }[] {
  if (!v.active) return [];
  if (v.fasting) {
    const h = Math.floor((v.minutesToIftar ?? 0) / 60), m = (v.minutesToIftar ?? 0) % 60;
    return [{
      kind: 'ramadan',
      text_ar: `صياماً مقبولاً 🌙 — باقي على الإفطار ${h ? `${h} ساعة ` : ''}${m} دقيقة. ابدأ الإفطار بالتمر والماء، ثم شوربة أو سلطة قبل الطبق الرئيسي.`,
    }];
  }
  const tips = [{ kind: 'ramadan', text_ar: 'وزّع 8 أكواب ماء تقريباً بين الإفطار والسحور، وقلّل المقليات والحلويات الثقيلة.' }];
  if (intakeKcal > 0 && v.split && intakeKcal < v.split.iftar + v.split.evening) {
    tips.push({ kind: 'suhoor', text_ar: `لا تنسَ السحور (حوالي ${v.split.suhoor} سعرة): بروتين بطيء الهضم كالبيض أو اللبن مع الشوفان أو الخبز الأسمر.` });
  }
  return tips;
}
