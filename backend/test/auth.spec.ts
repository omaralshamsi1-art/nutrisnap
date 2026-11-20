import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthGuard } from '../src/auth/auth.guard';
import { AuthService, DAILY_LIMITS, hashPassword, UsageService, verifyPassword } from '../src/auth/auth.service';
import { ProfileService } from '../src/profile/profile.service';
import { MemoryRepository } from '../src/storage/memory.repository';

const cfg = new ConfigService({ AUTH_MODE: 'hybrid', API_KEY: 'k'.repeat(40), AUTH_JWT_SECRET: 's'.repeat(48) });
function setup() {
  const repo = new MemoryRepository();
  const profiles = new ProfileService(repo);
  const auth = new AuthService(repo, cfg, profiles);
  const guard = new AuthGuard(cfg, new Reflector(), auth);
  return { repo, auth, guard, usage: new UsageService(repo) };
}
const ctx = (headers: Record<string, string>) => {
  const req: any = { headers };
  return { req, c: { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => () => {}, getClass: () => class {} } as any };
};

describe('accounts', () => {
  it('scrypt hashes verify and reject wrong passwords', () => {
    const h = hashPassword('correct horse');
    expect(h.startsWith('scrypt$16384$')).toBe(true);
    expect(verifyPassword('correct horse', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });

  it('owner invites → user registers once with the code → logs in → token resolves to the user', async () => {
    const s = setup();
    const inv = await s.auth.createInvite('meera', 'owner');
    expect(inv.code).toMatch(/^[A-Z2-9]{8}$/);
    await expect(s.auth.createInvite('x', 'user')).rejects.toThrow();
    const r = await s.auth.register({ email: 'Sara@Example.com', password: 'longpassword', name: 'سارة', inviteCode: inv.code.toLowerCase() }, {});
    expect(r.user).toMatchObject({ email: 'sara@example.com', role: 'user', name: 'سارة' });
    await expect(s.auth.register({ email: 'b@example.com', password: 'longpassword', inviteCode: inv.code }, {})).rejects.toThrow(/الدعوة/);
    await expect(s.auth.register({ email: 'sara@example.com', password: 'longpassword', inviteCode: 'X' }, {})).rejects.toThrow();
    await expect(s.auth.login({ email: 'sara@example.com', password: 'nope-nope' })).rejects.toThrow();
    const l = await s.auth.login({ email: 'SARA@example.com', password: 'longpassword' });
    const { req, c } = ctx({ authorization: `Bearer ${l.token}` });
    expect(await s.guard.canActivate(c)).toBe(true);
    expect(req).toMatchObject({ userId: r.user.id, role: 'user' });
    expect((await s.auth.listInvites('meera', 'owner'))[0].usedByName).toBe('سارة');
  });

  it('owner with the API key can attach an email login to existing data ("meera")', async () => {
    const s = setup();
    await expect(s.auth.register({ email: 'm@x.ae', password: 'longpassword', claimUserId: 'meera' }, { viaApiKey: false })).rejects.toThrow();
    const r = await s.auth.register({ email: 'm@x.ae', password: 'longpassword', name: 'ميرا', claimUserId: 'meera' }, { viaApiKey: true });
    expect(r.user).toMatchObject({ id: 'meera', role: 'owner' });
    const { req, c } = ctx({ authorization: `Bearer ${r.token}` });
    await s.guard.canActivate(c);
    expect(req).toMatchObject({ userId: 'meera', role: 'owner' });
  });

  it('hybrid guard: API key → owner; bad token / nothing → 401', async () => {
    const s = setup();
    const a = ctx({ 'x-api-key': 'k'.repeat(40), 'x-user-id': 'meera' });
    expect(await s.guard.canActivate(a.c)).toBe(true);
    expect(a.req).toMatchObject({ userId: 'meera', role: 'owner', viaApiKey: true });
    await expect(s.guard.canActivate(ctx({ authorization: 'Bearer bad' }).c)).rejects.toThrow();
    await expect(s.guard.canActivate(ctx({}).c)).rejects.toThrow();
    await expect(s.guard.canActivate(ctx({ 'x-api-key': 'wrong' }).c)).rejects.toThrow();
  });

  it('login is throttled after 10 failures', async () => {
    const s = setup();
    for (let i = 0; i < 10; i++) await expect(s.auth.login({ email: 'z@z.com', password: 'xxxxxxxx' })).rejects.toThrow();
    await expect(s.auth.login({ email: 'z@z.com', password: 'xxxxxxxx' })).rejects.toThrow(/محاولات كثيرة/);
  });

  it('daily AI limits apply to invited users only', async () => {
    const s = setup();
    for (let i = 0; i < DAILY_LIMITS.coach; i++) await s.usage.consume('u', 'user', 'coach');
    await expect(s.usage.consume('u', 'user', 'coach')).rejects.toThrow(/للحد اليومي/);
    for (let i = 0; i < 50; i++) await s.usage.consume('meera', 'owner', 'coach');
  });
});
