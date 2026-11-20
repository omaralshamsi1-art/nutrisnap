import { KnownMeal } from '../common/types';

export const SUBMIT_TOOL_NAME = 'submit_nutrition';

export function buildSystemPrompt(opts: { country: string; city: string | null; today: string; webSearch?: boolean; jsonOnly?: boolean }): string {
  const base = `You are NutriSnap, an expert nutrition analyst for meals photographed by users, with deep knowledge of Gulf/UAE, Middle Eastern, South Asian and international restaurant food.

GOAL: return the most accurate calories and macronutrients for the meal in the photo, then call the tool "${SUBMIT_TOOL_NAME}" exactly once with the result.

User context: country=${opts.country}${opts.city ? `, city=${opts.city}` : ''}, today=${opts.today}.

PRIORITY OF SOURCES (use the highest one available):
1. KNOWN MEALS supplied below (the user's own confirmed history or values previously verified from the restaurant). If the photo/name clearly matches one, reuse its numbers, scale only if the portion visibly differs, and set source="known_meal".
2. PUBLISHED RESTAURANT NUTRITION. When a restaurant or brand is named or visible (logo, packaging, receipt, cup), search the web for its official nutrition/calorie information for THIS item — official site, official app/delivery listing (Talabat, Deliveroo, Careem, Noon Food often show calories in the UAE), or nutrition PDF. Many UAE outlets display calories by regulation, so published values usually exist for chains. Prefer the UAE/GCC menu over other countries because recipes and portion sizes differ. Match the exact variant (size, bread, sauce, combo/side, drink). Set source="restaurant_published" and include the URLs in "sources".
3. FOOD DATABASES (USDA FoodData Central, national food composition tables) for generic items. Set source="database".
4. VISUAL ESTIMATE. If nothing reliable is found, estimate from the photo: identify each component, estimate grams using visual cues (plate ≈ 26–28 cm, fork, hand, cup sizes, packaging), apply typical recipes (oil/ghee/butter used in cooking is the most common hidden source of calories — include it explicitly as an item or in assumptions). Set source="estimate".

RULES:
- Break the meal into items (each with grams when known). Item nutrients must be for the quantity shown, not per 100 g.
- Calories should roughly agree with macros (4/4/9 kcal per g of protein/carbs/fat).
- confidence: 0.9–1.0 exact published match; 0.7–0.9 published but variant/portion uncertain; 0.4–0.7 database or good visual; <0.4 unclear photo.
- If the user gave a meal name, restaurant, portion or note, trust it over what you see unless the photo clearly contradicts it (then mention it in "warnings").
- If the image is not food, call the tool with empty items, confidence 0 and a warning.
- Give English names AND natural Arabic names (name_ar / meal_name_ar).
- List every assumption the user may want to correct (e.g. "assumed regular size", "assumed full-fat laban") so they can edit it.
- Never invent URLs. Only cite pages you actually found.
- Keep web searches focused (a few targeted queries are enough). Do not write a long prose answer — the tool call is the answer.`;
  if (opts.webSearch !== false && !opts.jsonOnly) return base;
  // Providers without web search / tool calling (e.g. Gemini free tier): answer from knowledge + photo, output JSON.
  let out = base;
  if (opts.webSearch === false) {
    out += `

WEB SEARCH IS NOT AVAILABLE in this deployment. Use KNOWN MEALS first; otherwise use well-known published values you are confident about for major chains (set source="restaurant_published" only if you are confident, and leave "sources" empty), else database or visual estimate. Lower confidence accordingly.`;
  }
  if (opts.jsonOnly) {
    out = out.replace(/call the tool "submit_nutrition" exactly once with the result/, 'return the result as a single JSON object matching the response schema');
    out += `

Respond ONLY with the JSON object. Never invent URLs.`;
  }
  return out;
}

export function buildUserText(opts: {
  mealName?: string | null;
  restaurant?: string | null;
  portion?: string | null;
  note?: string | null;
  known: KnownMeal[];
}): string {
  const lines: string[] = ['Analyse the meal in this photo.'];
  if (opts.mealName) lines.push(`Meal name (from user): ${opts.mealName}`);
  if (opts.restaurant) lines.push(`Restaurant (from user): ${opts.restaurant}`);
  if (opts.portion) lines.push(`Portion eaten (from user): ${opts.portion}`);
  if (opts.note) lines.push(`User note: ${opts.note}`);
  if (opts.known.length) {
    lines.push('', 'KNOWN MEALS (verified earlier; reuse when they match):');
    for (const k of opts.known) {
      lines.push(
        `- ${k.restaurant ?? 'home/unknown'} — ${k.meal_name} / ${k.meal_name_ar} [${k.source}, logged ${k.timesLogged}x]: ` +
          `${k.totals.calories} kcal, P ${k.totals.protein_g} g, C ${k.totals.carbs_g} g, F ${k.totals.fat_g} g; ` +
          `items: ${k.items.map((i) => `${i.quantity} ${i.unit} ${i.name}${i.grams ? ` (${i.grams} g)` : ''}`).join(', ')}`,
      );
    }
  }
  return lines.join('\n');
}

const nutrientProps = {
  calories: { type: 'number', description: 'kcal' },
  protein_g: { type: 'number' },
  carbs_g: { type: 'number' },
  fat_g: { type: 'number' },
  fiber_g: { type: 'number' },
  sugar_g: { type: 'number' },
  sodium_mg: { type: 'number' },
} as const;
const nutrientKeys = Object.keys(nutrientProps);

export const SUBMIT_TOOL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    meal_name: { type: 'string' },
    meal_name_ar: { type: 'string' },
    restaurant: { type: ['string', 'null'] },
    source: { type: 'string', enum: ['restaurant_published', 'known_meal', 'database', 'estimate'] },
    confidence: { type: 'number', description: '0..1' },
    serving_description: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          name_ar: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          grams: { type: ['number', 'null'] },
          ...nutrientProps,
        },
        required: ['name', 'name_ar', 'quantity', 'unit', 'grams', ...nutrientKeys],
      },
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { title: { type: 'string' }, url: { type: 'string' } },
        required: ['title', 'url'],
      },
    },
    assumptions: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'meal_name',
    'meal_name_ar',
    'restaurant',
    'source',
    'confidence',
    'serving_description',
    'items',
    'sources',
    'assumptions',
    'warnings',
  ],
} as const;
