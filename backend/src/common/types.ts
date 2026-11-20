export type NutritionSource =
  | 'restaurant_published' // official menu / restaurant nutrition page
  | 'known_meal' // user's own confirmed meal history
  | 'database' // generic food databases (USDA, etc.)
  | 'estimate'; // visual estimate by the agent

export interface Nutrients {
  calories: number; // kcal
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
}

export interface MealItem extends Nutrients {
  name: string;
  name_ar: string;
  quantity: number;
  unit: string; // "piece", "g", "cup", "serving"...
  grams: number | null;
}

export interface SourceRef {
  title: string;
  url: string;
}

export interface NutritionEstimate {
  meal_name: string;
  meal_name_ar: string;
  restaurant: string | null;
  source: NutritionSource;
  confidence: number; // 0..1
  serving_description: string;
  items: MealItem[];
  totals: Nutrients;
  sources: SourceRef[];
  assumptions: string[];
  warnings: string[];
}

export interface Meal {
  id: string;
  userId: string;
  eatenAt: string; // ISO
  date: string; // YYYY-MM-DD in user's tz
  status: 'draft' | 'confirmed';
  estimate: NutritionEstimate; // what the agent proposed
  final: NutritionEstimate; // after user edits (== estimate until edited)
  edited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KnownMeal {
  key: string; // normalized restaurant|name
  userId: string | null; // null = global (published values)
  restaurant: string | null;
  meal_name: string;
  meal_name_ar: string;
  source: NutritionSource;
  items: MealItem[];
  totals: Nutrients;
  sources: SourceRef[];
  timesLogged: number;
  updatedAt: string;
}

export type EnergySource =
  | 'apple_health'
  | 'whoop'
  | 'health_connect'
  | 'garmin'
  | 'fitbit'
  | 'manual'
  | 'estimate';

export interface EnergyDay {
  userId: string;
  date: string;
  source: EnergySource;
  activeKcal: number | null;
  basalKcal: number | null;
  totalKcal: number;
  updatedAt: string;
}

export interface Profile {
  userId: string;
  sex: 'male' | 'female' | null;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goal: 'lose' | 'maintain' | 'gain';
  goalDeltaKcal: number; // e.g. -500 for lose, +300 for gain
  preferredEnergySource: EnergySource | null;
  timezone: string; // IANA, e.g. Asia/Dubai
  city: string | null;
  country: string | null;
  // ---- goal engine (phase 2a) ----
  targetWeightKg: number | null;
  pace: 'relaxed' | 'moderate' | 'fast';
  startWeightKg: number | null;
  startDate: string | null;
  screening: { pregnant?: boolean; breastfeeding?: boolean; medicalSupervision?: boolean; edHistory?: boolean };
  onboarded: boolean;
  /** Set by the system when measured burn shows the declared activity level was off. */
  activityCalibration: {
    from: Profile['activityLevel'];
    to: Profile['activityLevel'];
    avgBurnKcal: number;
    days: number;
    factor: number;
    at: string; // YYYY-MM-DD
  } | null;
}

export interface WeightEntry {
  userId: string;
  date: string; // YYYY-MM-DD local
  kg: number;
  source: 'manual' | 'apple_health' | 'whoop';
  updatedAt: string;
}

export interface OAuthTokens {
  userId: string;
  provider: 'whoop';
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scope: string;
}

export const EMPTY_NUTRIENTS: Nutrients = {
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
  sugar_g: 0,
  sodium_mg: 0,
};

export const NUTRIENT_KEYS = Object.keys(EMPTY_NUTRIENTS) as (keyof Nutrients)[];
