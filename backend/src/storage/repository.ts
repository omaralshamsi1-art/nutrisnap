import { EnergyDay, KnownMeal, Meal, OAuthTokens, Profile } from '../common/types';
import { normalizeKey } from '../common/nutrition-math';

export const REPOSITORY = Symbol('REPOSITORY');

export interface Repository {
  saveMeal(meal: Meal): Promise<void>;
  getMeal(userId: string, id: string): Promise<Meal | null>;
  listMeals(userId: string, date: string): Promise<Meal[]>;
  deleteMeal(userId: string, id: string): Promise<void>;

  /** Candidates for the agent's "experience": user's own + global published meals. */
  findKnownCandidates(userId: string, restaurant: string | null, name: string | null): Promise<KnownMeal[]>;
  upsertKnown(meal: KnownMeal): Promise<void>;

  upsertEnergy(day: EnergyDay): Promise<void>;
  listEnergy(userId: string, date: string): Promise<EnergyDay[]>;

  getProfile(userId: string): Promise<Profile | null>;
  saveProfile(p: Profile): Promise<void>;

  getTokens(userId: string, provider: 'whoop'): Promise<OAuthTokens | null>;
  saveTokens(t: OAuthTokens): Promise<void>;
  deleteTokens(userId: string, provider: 'whoop'): Promise<void>;
}

/** Ranks known meals by token overlap with the requested restaurant + name. */
export function rankKnown(cands: KnownMeal[], restaurant: string | null, name: string | null, limit = 5): KnownMeal[] {
  const [qr, qn] = normalizeKey(restaurant, name ?? '').split('|');
  const toks = (s: string) => new Set(s.split(' ').filter(Boolean));
  const qrT = toks(qr);
  const qnT = toks(qn);
  const overlap = (a: Set<string>, b: Set<string>) => {
    if (!a.size || !b.size) return 0;
    let n = 0;
    for (const t of a) if (b.has(t)) n++;
    return n / Math.max(a.size, b.size);
  };
  return cands
    .map((k) => {
      const [kr, kn] = k.key.split('|');
      const score =
        (qrT.size ? overlap(qrT, toks(kr)) * 2 : 0) +
        (qnT.size ? overlap(qnT, toks(kn)) * 3 : 0) +
        Math.min(k.timesLogged, 10) * 0.02 +
        (k.userId ? 0.1 : 0); // prefer the user's own corrections
      return { k, score };
    })
    .filter((x) => x.score >= 0.5 || (!qrT.size && !qnT.size && x.k.userId))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.k);
}
