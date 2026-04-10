import { ConfigService } from '@nestjs/config';
import type { JwtModuleOptions } from '@nestjs/jwt';
import ms, { type StringValue } from 'ms';

export const jwtConfig = (config: ConfigService): JwtModuleOptions => {
  const ttl = config.getOrThrow<string>('JWT_ACCESS_TOKEN_TTL') as StringValue;
  const ttlMs = ms(ttl);
  if (typeof ttlMs !== 'number') {
    throw new Error('JWT_ACCESS_TOKEN_TTL must be a valid ms string, e.g. 15m');
  }

  return {
    secret: config.getOrThrow<string>('JWT_SECRET'),
    signOptions: {
      expiresIn: ttlMs,
    },
  };
};