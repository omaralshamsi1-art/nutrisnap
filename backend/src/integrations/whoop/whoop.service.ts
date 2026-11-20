import { BadRequestException, Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { dayBoundsUtc, localDate } from '../../common/dates';
import { FETCH, FetchFn } from '../../common/fetch';
import { OAuthTokens } from '../../common/types';
import { EnergyService } from '../../energy/energy.service';
import { ProfileService } from '../../profile/profile.service';
import { REPOSITORY, Repository } from '../../storage/repository';

const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API_BASE = 'https://api.prod.whoop.com/developer';
const SCOPES = 'offline read:cycles read:workout read:profile read:body_measurement';
const KJ_PER_KCAL = 4.184;


interface WhoopCycle {
  id: number | string;
  start: string;
  end: string | null;
  score_state: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE';
  score?: { strain: number; kilojoule: number; average_heart_rate: number; max_heart_rate: number };
}

@Injectable()
export class WhoopService {
  private readonly log = new Logger(WhoopService.name);
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly config: ConfigService,
    @Inject(REPOSITORY) private readonly repo: Repository,
    private readonly energy: EnergyService,
    private readonly profiles: ProfileService,
    @Optional() @Inject(FETCH) fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? fetch;
  }

  // ---------- OAuth ----------
  authorizeUrl(userId: string, target: 'app' | 'web' = 'app'): string {
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: this.req('WHOOP_CLIENT_ID'),
      redirect_uri: this.req('WHOOP_REDIRECT_URI'),
      scope: SCOPES,
      state: this.signState(userId, target),
    });
    return `${AUTH_URL}?${p}`;
  }

  /** Where the browser should go after OAuth, decoded from a state value (falls back to the app). */
  callbackTarget(state: string): 'app' | 'web' {
    try {
      return JSON.parse(Buffer.from((state ?? '').split('.')[0], 'base64url').toString()).r === 'web' ? 'web' : 'app';
    } catch {
      return 'app';
    }
  }

  async handleCallback(code: string, state: string): Promise<string> {
    const userId = this.verifyState(state);
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.req('WHOOP_REDIRECT_URI'),
    });
    await this.repo.saveTokens(this.toTokens(userId, tokens));
    return userId;
  }

  async disconnect(userId: string) {
    await this.repo.deleteTokens(userId, 'whoop');
    return { connected: false };
  }

  async status(userId: string) {
    const t = await this.repo.getTokens(userId, 'whoop');
    return { connected: !!t, expiresAt: t?.expiresAt ?? null };
  }

  // ---------- Sync ----------
  /** Pulls WHOOP cycles for [from, to] (local dates) and stores daily energy (kJ → kcal). */
  async sync(userId: string, from: string, to: string) {
    const profile = await this.profiles.get(userId);
    const start = dayBoundsUtc(from, profile.timezone).start;
    const end = dayBoundsUtc(to, profile.timezone).end;
    const cycles = await this.fetchCycles(userId, start, end);

    // A WHOOP cycle runs sleep-onset → next sleep-onset; attribute it to the local date of its midpoint.
    const byDate = new Map<string, number>();
    for (const c of cycles) {
      if (c.score_state !== 'SCORED' || !c.score) continue;
      const s = new Date(c.start).getTime();
      const e = c.end ? new Date(c.end).getTime() : Date.now();
      const date = localDate(new Date((s + e) / 2), profile.timezone);
      if (date < from || date > to) continue;
      byDate.set(date, Math.max(byDate.get(date) ?? 0, c.score.kilojoule / KJ_PER_KCAL));
    }
    // Body weight from WHOOP's body measurements (kept as its own source; manual entries win).
    let weightKg: number | null = null;
    try {
      const body = await this.api(userId, '/v2/user/measurement/body');
      if (body?.weight_kilogram > 20) {
        weightKg = Math.round(body.weight_kilogram * 10) / 10;
        await this.repo.upsertWeight({
          userId,
          date: localDate(new Date(), profile.timezone),
          kg: weightKg,
          source: 'whoop',
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      this.log.warn(`WHOOP body measurement skipped: ${e?.message ?? e}`);
    }
    if (byDate.size) {
      await this.energy.ingest(
        userId,
        [...byDate].map(([date, kcal]) => ({ date, source: 'whoop' as const, totalKcal: Math.round(kcal) })),
      );
    }
    return { cycles: cycles.length, weightKg, days: Object.fromEntries([...byDate].map(([d, k]) => [d, Math.round(k)])) };
  }

  private async fetchCycles(userId: string, start: Date, end: Date): Promise<WhoopCycle[]> {
    const out: WhoopCycle[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({ start: start.toISOString(), end: end.toISOString(), limit: '25' });
      if (nextToken) q.set('nextToken', nextToken);
      const body = await this.api(userId, `/v2/cycle?${q}`);
      out.push(...(body.records ?? []));
      nextToken = body.next_token ?? undefined;
      if (!nextToken) break;
    }
    return out;
  }

  private async api(userId: string, path: string, retried = false): Promise<any> {
    const token = await this.validAccessToken(userId);
    const res = await this.fetchFn(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 && !retried) {
      await this.refresh(userId);
      return this.api(userId, path, true);
    }
    if (!res.ok) throw new BadRequestException(`WHOOP API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  private async validAccessToken(userId: string): Promise<string> {
    const t = await this.repo.getTokens(userId, 'whoop');
    if (!t) throw new UnauthorizedException('WHOOP not connected');
    if (new Date(t.expiresAt).getTime() - Date.now() < 60_000) return (await this.refresh(userId)).accessToken;
    return t.accessToken;
  }

  private async refresh(userId: string): Promise<OAuthTokens> {
    const t = await this.repo.getTokens(userId, 'whoop');
    if (!t?.refreshToken) throw new UnauthorizedException('WHOOP session expired — reconnect');
    const fresh = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken, scope: 'offline' });
    const saved = this.toTokens(userId, fresh, t.refreshToken);
    await this.repo.saveTokens(saved);
    return saved;
  }

  private async tokenRequest(params: Record<string, string>) {
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...params,
        client_id: this.req('WHOOP_CLIENT_ID'),
        client_secret: this.req('WHOOP_CLIENT_SECRET'),
      }),
    });
    if (!res.ok) throw new UnauthorizedException(`WHOOP token error ${res.status}`);
    return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  }

  private toTokens(
    userId: string,
    r: { access_token: string; refresh_token?: string; expires_in: number; scope?: string },
    prevRefresh: string | null = null,
  ): OAuthTokens {
    return {
      userId,
      provider: 'whoop',
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? prevRefresh,
      expiresAt: new Date(Date.now() + r.expires_in * 1000).toISOString(),
      scope: r.scope ?? SCOPES,
    };
  }

  // ---------- signed OAuth state (CSRF + carries user id through the browser round-trip) ----------
  private signState(userId: string, target: 'app' | 'web' = 'app'): string {
    const payload = Buffer.from(JSON.stringify({ u: userId, r: target, t: Date.now(), n: randomBytes(8).toString('hex') })).toString(
      'base64url',
    );
    return `${payload}.${this.hmac(payload)}`;
  }

  private verifyState(state: string): string {
    const [payload, sig] = (state ?? '').split('.');
    if (!payload || !sig) throw new UnauthorizedException('Bad state');
    const expected = Buffer.from(this.hmac(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new UnauthorizedException('Bad state');
    const { u, t } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() - t > 15 * 60_000) throw new UnauthorizedException('State expired');
    return u;
  }

  private hmac(s: string) {
    return createHmac('sha256', this.req('OAUTH_STATE_SECRET')).update(s).digest('base64url');
  }

  private req(key: string): string {
    const v = this.config.get<string>(key);
    if (!v) throw new BadRequestException(`${key} is not configured`);
    return v;
  }
}
