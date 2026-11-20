import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().userId;
});

/**
 * AUTH_MODE=supabase → verifies the Supabase access token (SUPABASE_JWKS_URL, or legacy SUPABASE_JWT_SECRET) and uses `sub`.
 * AUTH_MODE=dev      → trusts the X-User-Id header (local development only).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const mode = this.config.get<string>('AUTH_MODE') ?? 'dev';

    if (mode === 'dev') {
      const id = req.headers['x-user-id'];
      if (!id || typeof id !== 'string') throw new UnauthorizedException('X-User-Id header required in dev mode');
      req.userId = id;
      return true;
    }

    const auth: string | undefined = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    const jwksUrl = this.config.get<string>('SUPABASE_JWKS_URL');
    const secret = this.config.get<string>('SUPABASE_JWT_SECRET');
    if (!jwksUrl && !secret) throw new UnauthorizedException('Server auth not configured');
    try {
      // Newer Supabase projects sign with asymmetric keys (JWKS); legacy ones use the shared HS256 secret.
      const { payload } = jwksUrl
        ? await jwtVerify(auth.slice(7), (this.jwks ??= createRemoteJWKSet(new URL(jwksUrl))))
        : await jwtVerify(auth.slice(7), new TextEncoder().encode(secret!));
      if (!payload.sub) throw new Error('no sub');
      req.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
