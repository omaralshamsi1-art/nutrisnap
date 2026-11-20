import { EMPTY_NUTRIENTS, MealItem, NUTRIENT_KEYS, Nutrients, NutritionEstimate } from './types';

const round1 = (n: number) => Math.round(n * 10) / 10;

export function sumNutrients(list: Nutrients[]): Nutrients {
  const out: Nutrients = { ...EMPTY_NUTRIENTS };
  for (const n of list) for (const k of NUTRIENT_KEYS) out[k] += Number(n[k]) || 0;
  for (const k of NUTRIENT_KEYS) out[k] = k === 'calories' || k === 'sodium_mg' ? Math.round(out[k]) : round1(out[k]);
  return out;
}

/** Atwater: 4 kcal/g protein & carbs, 9 kcal/g fat (fiber ≈ 2 kcal/g, ignored). */
export function atwaterKcal(n: Nutrients): number {
  return 4 * n.protein_g + 4 * n.carbs_g + 9 * n.fat_g;
}

/** Clamp negatives / NaN and coerce numbers coming from the model or the user. */
export function sanitizeItem(i: MealItem): MealItem {
  const clean = { ...i };
  for (const k of NUTRIENT_KEYS) {
    const v = Number(clean[k]);
    clean[k] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  clean.quantity = Number.isFinite(Number(clean.quantity)) && Number(clean.quantity) > 0 ? Number(clean.quantity) : 1;
  clean.grams = clean.grams == null || !Number.isFinite(Number(clean.grams)) ? null : Math.max(0, Number(clean.grams));
  clean.name = String(clean.name ?? '').trim() || 'Item';
  clean.name_ar = String(clean.name_ar ?? '').trim() || clean.name;
  clean.unit = String(clean.unit ?? 'serving').trim() || 'serving';
  return clean;
}

/**
 * Normalises an estimate: sanitises items, recomputes totals from the items
 * (single source of truth), and adds a warning when calories and macros disagree.
 */
export function normalizeEstimate(e: NutritionEstimate): NutritionEstimate {
  const items = (e.items ?? []).map(sanitizeItem);
  const warnings = (e.warnings ?? []).filter((w) => !w.startsWith('[check]'));
  let totals: Nutrients;
  if (items.length) {
    totals = sumNutrients(items);
  } else {
    totals = sumNutrients([e.totals ?? EMPTY_NUTRIENTS]);
  }
  const macroKcal = atwaterKcal(totals);
  if (totals.calories > 0 && macroKcal > 0) {
    const diff = Math.abs(macroKcal - totals.calories) / totals.calories;
    if (diff > 0.2) {
      warnings.push(
        `[check] Calories (${totals.calories}) differ from macros (~${Math.round(macroKcal)} kcal) by ${Math.round(diff * 100)}%`,
      );
    }
  }
  return {
    ...e,
    restaurant: e.restaurant ? String(e.restaurant).trim() : null,
    confidence: Math.min(1, Math.max(0, Number(e.confidence) || 0)),
    items,
    totals,
    sources: (e.sources ?? []).filter((s) => s && /^https?:\/\//.test(s.url)),
    assumptions: e.assumptions ?? [],
    warnings,
  };
}

/** Scale a whole estimate by a portion factor (e.g. ate half → 0.5). */
export function scaleEstimate(e: NutritionEstimate, factor: number): NutritionEstimate {
  const f = factor > 0 ? factor : 1;
  const items = e.items.map((i) => {
    const s: MealItem = { ...i, quantity: round1(i.quantity * f), grams: i.grams == null ? null : Math.round(i.grams * f) };
    for (const k of NUTRIENT_KEYS) s[k] = i[k] * f;
    return s;
  });
  return normalizeEstimate({ ...e, items });
}

export function normalizeKey(restaurant: string | null | undefined, name: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[ً-ٰٟ]/g, '') // Arabic diacritics
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return `${norm(restaurant ?? '')}|${norm(name)}`;
}
