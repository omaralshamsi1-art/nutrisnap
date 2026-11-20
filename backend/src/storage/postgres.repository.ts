import { Pool } from 'pg';
import { EnergyDay, KnownMeal, Meal, OAuthTokens, Profile } from '../common/types';
import { normalizeKey } from '../common/nutrition-math';
import { rankKnown, Repository } from './repository';

/** Postgres / Supabase implementation. Schema: supabase/migrations/001_init.sql */
export class PostgresRepository implements Repository {
  constructor(private readonly pool: Pool) {}

  static fromUrl(url: string) {
    return new PostgresRepository(new Pool({ connectionString: url, max: 10 }));
  }

  async saveMeal(m: Meal) {
    await this.pool.query(
      `insert into meals (id, user_id, eaten_at, date, status, estimate, final, edited, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do update set eaten_at=$3, date=$4, status=$5, final=$7, edited=$8, updated_at=$10`,
      [m.id, m.userId, m.eatenAt, m.date, m.status, m.estimate, m.final, m.edited, m.createdAt, m.updatedAt],
    );
  }
  async getMeal(userId: string, id: string) {
    const r = await this.pool.query(`select * from meals where id=$1 and user_id=$2`, [id, userId]);
    return r.rows[0] ? rowToMeal(r.rows[0]) : null;
  }
  async listMeals(userId: string, date: string) {
    const r = await this.pool.query(`select * from meals where user_id=$1 and date=$2 order by eaten_at`, [userId, date]);
    return r.rows.map(rowToMeal);
  }
  async deleteMeal(userId: string, id: string) {
    await this.pool.query(`delete from meals where id=$1 and user_id=$2`, [id, userId]);
  }

  async findKnownCandidates(userId: string, restaurant: string | null, name: string | null) {
    const [r, n] = normalizeKey(restaurant, name ?? '').split('|');
    // Trigram similarity narrows the candidate set; rankKnown does the final ordering.
    const res = await this.pool.query(
      `select * from known_meals
        where (user_id = $1 or user_id is null)
          and ( ($2 <> '' and similarity(split_part(key,'|',1), $2) > 0.3)
             or ($3 <> '' and similarity(split_part(key,'|',2), $3) > 0.3) )
        order by times_logged desc limit 40`,
      [userId, r, n],
    );
    return rankKnown(res.rows.map(rowToKnown), restaurant, name);
  }
  async upsertKnown(k: KnownMeal) {
    await this.pool.query(
      `insert into known_meals (key, user_id, restaurant, meal_name, meal_name_ar, source, items, totals, sources, times_logged, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (coalesce(user_id, '*'), key) do update set
         restaurant=$3, meal_name=$4, meal_name_ar=$5, source=$6, items=$7, totals=$8, sources=$9,
         times_logged=$10, updated_at=$11`,
      [
        k.key, k.userId, k.restaurant, k.meal_name, k.meal_name_ar, k.source,
        JSON.stringify(k.items), k.totals, JSON.stringify(k.sources), k.timesLogged, k.updatedAt,
      ],
    );
  }

  async upsertEnergy(d: EnergyDay) {
    await this.pool.query(
      `insert into energy_days (user_id, date, source, active_kcal, basal_kcal, total_kcal, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (user_id, date, source) do update set active_kcal=$4, basal_kcal=$5, total_kcal=$6, updated_at=$7`,
      [d.userId, d.date, d.source, d.activeKcal, d.basalKcal, d.totalKcal, d.updatedAt],
    );
  }
  async listEnergy(userId: string, date: string) {
    const r = await this.pool.query(`select * from energy_days where user_id=$1 and date=$2`, [userId, date]);
    return r.rows.map((x) => ({
      userId: x.user_id,
      date: fmtDate(x.date),
      source: x.source,
      activeKcal: x.active_kcal == null ? null : Number(x.active_kcal),
      basalKcal: x.basal_kcal == null ? null : Number(x.basal_kcal),
      totalKcal: Number(x.total_kcal),
      updatedAt: new Date(x.updated_at).toISOString(),
    }));
  }

  async getProfile(userId: string) {
    const r = await this.pool.query(`select data from profiles where user_id=$1`, [userId]);
    return r.rows[0] ? ({ ...r.rows[0].data, userId } as Profile) : null;
  }
  async saveProfile(p: Profile) {
    await this.pool.query(
      `insert into profiles (user_id, data, updated_at) values ($1,$2,now())
       on conflict (user_id) do update set data=$2, updated_at=now()`,
      [p.userId, p],
    );
  }

  async getTokens(userId: string, provider: 'whoop') {
    const r = await this.pool.query(`select * from oauth_tokens where user_id=$1 and provider=$2`, [userId, provider]);
    const x = r.rows[0];
    return x
      ? {
          userId,
          provider,
          accessToken: x.access_token,
          refreshToken: x.refresh_token,
          expiresAt: new Date(x.expires_at).toISOString(),
          scope: x.scope,
        }
      : null;
  }
  async saveTokens(t: OAuthTokens) {
    await this.pool.query(
      `insert into oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id, provider) do update set access_token=$3, refresh_token=$4, expires_at=$5, scope=$6`,
      [t.userId, t.provider, t.accessToken, t.refreshToken, t.expiresAt, t.scope],
    );
  }
  async deleteTokens(userId: string, provider: 'whoop') {
    await this.pool.query(`delete from oauth_tokens where user_id=$1 and provider=$2`, [userId, provider]);
  }
}

const fmtDate = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

function rowToMeal(x: any): Meal {
  return {
    id: x.id,
    userId: x.user_id,
    eatenAt: new Date(x.eaten_at).toISOString(),
    date: fmtDate(x.date),
    status: x.status,
    estimate: x.estimate,
    final: x.final,
    edited: x.edited,
    createdAt: new Date(x.created_at).toISOString(),
    updatedAt: new Date(x.updated_at).toISOString(),
  };
}
function rowToKnown(x: any): KnownMeal {
  return {
    key: x.key,
    userId: x.user_id,
    restaurant: x.restaurant,
    meal_name: x.meal_name,
    meal_name_ar: x.meal_name_ar,
    source: x.source,
    items: x.items,
    totals: x.totals,
    sources: x.sources,
    timesLogged: x.times_logged,
    updatedAt: new Date(x.updated_at).toISOString(),
  };
}
