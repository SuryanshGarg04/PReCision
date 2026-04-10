import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

@Injectable()
export class TokenEncryptionService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    this.key = Buffer.from(
      this.config.getOrThrow<string>('GITHUB_TOKEN_ENCRYPTION_KEY'),
      'hex',
    );
  }

  encrypt(value: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [iv, authTag, encrypted].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(value: string): string {
    const [ivPart, authTagPart, encryptedPart] = value.split('.');

    if (!ivPart || !authTagPart || !encryptedPart) {
      throw new Error('Encrypted token has an invalid format');
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagPart, 'base64url'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPart, 'base64url')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
