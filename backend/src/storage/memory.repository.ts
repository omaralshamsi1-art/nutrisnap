import { EnergyDay, KnownMeal, Meal, OAuthTokens, Profile } from '../common/types';
import { rankKnown, Repository } from './repository';

/** In-memory store for local development and tests. */
export class MemoryRepository implements Repository {
  private meals = new Map<string, Meal>();
  private known = new Map<string, KnownMeal>();
  private energy = new Map<string, EnergyDay>();
  private profiles = new Map<string, Profile>();
  private tokens = new Map<string, OAuthTokens>();

  async saveMeal(m: Meal) {
    this.meals.set(m.id, structuredClone(m));
  }
  async getMeal(userId: string, id: string) {
    const m = this.meals.get(id);
    return m && m.userId === userId ? structuredClone(m) : null;
  }
  async listMeals(userId: string, date: string) {
    return [...this.meals.values()]
      .filter((m) => m.userId === userId && m.date === date)
      .sort((a, b) => a.eatenAt.localeCompare(b.eatenAt))
      .map((m) => structuredClone(m));
  }
  async deleteMeal(userId: string, id: string) {
    if (this.meals.get(id)?.userId === userId) this.meals.delete(id);
  }

  async findKnownCandidates(userId: string, restaurant: string | null, name: string | null) {
    const cands = [...this.known.values()].filter((k) => k.userId === null || k.userId === userId);
    return rankKnown(cands, restaurant, name);
  }
  async upsertKnown(k: KnownMeal) {
    this.known.set(`${k.userId ?? '*'}::${k.key}`, structuredClone(k));
  }
  /** test helper */
  async getKnown(userId: string | null, key: string) {
    return this.known.get(`${userId ?? '*'}::${key}`) ?? null;
  }

  async upsertEnergy(d: EnergyDay) {
    this.energy.set(`${d.userId}|${d.date}|${d.source}`, { ...d });
  }
  async listEnergy(userId: string, date: string) {
    return [...this.energy.values()].filter((d) => d.userId === userId && d.date === date);
  }

  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }
  async saveProfile(p: Profile) {
    this.profiles.set(p.userId, { ...p });
  }

  async getTokens(userId: string, provider: 'whoop') {
    return this.tokens.get(`${userId}|${provider}`) ?? null;
  }
  async saveTokens(t: OAuthTokens) {
    this.tokens.set(`${t.userId}|${t.provider}`, { ...t });
  }
  async deleteTokens(userId: string, provider: 'whoop') {
    this.tokens.delete(`${userId}|${provider}`);
  }
}
