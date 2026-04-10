import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type { StringValue } from 'ms';
import { URLSearchParams } from 'url';
import { AuthService } from '../auth/auth.service.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { TokenEncryptionService } from '../common/services/token-encryption.service.js';
import type {
  GithubOauthState,
  GithubUserEmail,
  GithubUserProfile,
} from './github.types.js';

@Injectable()
export class GithubService {
  private readonly apiBaseUrl: string;
  private readonly authorizeUrl: string;
  private readonly tokenUrl: string;
  private readonly callbackUrl: string;
  private readonly scopes: string;
  private readonly stateTtl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly tokenEncryptionService: TokenEncryptionService,
  ) {
    this.apiBaseUrl = this.config.getOrThrow<string>('GITHUB_API_BASE_URL');
    this.authorizeUrl = this.config.getOrThrow<string>(
      'GITHUB_OAUTH_AUTHORIZE_URL',
    );
    this.tokenUrl = this.config.getOrThrow<string>('GITHUB_OAUTH_TOKEN_URL');
    this.callbackUrl = this.config.getOrThrow<string>('GITHUB_CALLBACK_URL');
    this.scopes = this.config.getOrThrow<string>('GITHUB_OAUTH_SCOPES');
    this.stateTtl = this.config.getOrThrow<string>('GITHUB_OAUTH_STATE_TTL');
  }

  // --- OAuth ---

  getAuthorizationUrl() {
    const state = this.jwtService.sign(
      { nonce: randomUUID() } satisfies GithubOauthState,
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.stateTtl as StringValue,
      },
    );
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow<string>('GITHUB_CLIENT_ID'),
      redirect_uri: this.callbackUrl,
      scope: this.scopes,
      state,
    });

    return {
      authorizationUrl: `${this.authorizeUrl}?${params.toString()}`,
      state,
    };
  }

  async handleOAuthCallback(code: string, state?: string) {
    if (!state) {
      throw new BadRequestException('Missing OAuth state parameter');
    }

    this.verifyState(state);

    const accessToken = await this.exchangeCodeForToken(code);
    const [profile, emails] = await Promise.all([
      this.fetchGithubUser(accessToken),
      this.fetchGithubEmails(accessToken),
    ]);

    const primaryEmail = this.resolvePrimaryEmail(profile, emails);
    return this.authService.upsertGithubUser({
      githubId: String(profile.id),
      githubUsername: profile.login,
      email: primaryEmail,
      encryptedAccessToken: this.tokenEncryptionService.encrypt(accessToken),
    });
  }

  // --- REST (GitHub API v3) — authenticated per app user ---

  async getAuthenticatedGithubProfile(user: AuthenticatedUser) {
    const token = await this.getDecryptedAccessToken(user.userId);
    return this.fetchGithubUser(token);
  }

  async listRepositories(user: AuthenticatedUser, page = 1, perPage = 20) {
    return this.githubRequest(
      user.userId,
      `/user/repos?sort=updated&direction=desc&page=${page}&per_page=${perPage}`,
    );
  }

  async listPullRequests(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    state = 'open',
  ) {
    return this.githubRequest(
      user.userId,
      `/repos/${owner}/${repo}/pulls?state=${encodeURIComponent(state)}`,
    );
  }

  async getPullRequest(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    pullNumber: number,
  ) {
    return this.githubRequest(
      user.userId,
      `/repos/${owner}/${repo}/pulls/${pullNumber}`,
    );
  }

  async listPullRequestFiles(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    pullNumber: number,
  ) {
    return this.githubRequest(
      user.userId,
      `/repos/${owner}/${repo}/pulls/${pullNumber}/files`,
    );
  }

  async listCommits(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    branch?: string,
  ) {
    const search = new URLSearchParams();
    if (branch) {
      search.set('sha', branch);
    }
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return this.githubRequest(
      user.userId,
      `/repos/${owner}/${repo}/commits${suffix}`,
    );
  }

  async compareCommits(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    base: string,
    head: string,
  ) {
    return this.githubRequest(
      user.userId,
      `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    );
  }

  async getDiff(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    base: string,
    head: string,
  ) {
    return this.githubRequest(
      user.userId,
      `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      {
        accept: 'application/vnd.github.diff',
      },
      false,
    );
  }

  // --- Internals ---

  private verifyState(state: string) {
    try {
      this.jwtService.verify<GithubOauthState>(state, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
  }

  private async exchangeCodeForToken(code: string) {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.getOrThrow<string>('GITHUB_CLIENT_ID'),
        client_secret: this.config.getOrThrow<string>('GITHUB_CLIENT_SECRET'),
        code,
        redirect_uri: this.callbackUrl,
      }),
    });

    const payload = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !payload.access_token) {
      throw new UnauthorizedException(
        payload.error_description ?? payload.error ?? 'GitHub token exchange failed',
      );
    }

    return payload.access_token;
  }

  private async fetchGithubUser(accessToken: string) {
    return this.rawGithubRequest<GithubUserProfile>('/user', accessToken);
  }

  private async fetchGithubEmails(accessToken: string) {
    return this.rawGithubRequest<GithubUserEmail[]>('/user/emails', accessToken);
  }

  private resolvePrimaryEmail(
    profile: GithubUserProfile,
    emails: GithubUserEmail[],
  ) {
    const primaryVerifiedEmail = emails.find(
      (e) => e.primary && e.verified,
    );
    const fallbackVerifiedEmail = emails.find((e) => e.verified);

    return (
      primaryVerifiedEmail?.email ??
      fallbackVerifiedEmail?.email ??
      `${profile.id}+${profile.login}@users.noreply.github.com`
    );
  }

  private async getDecryptedAccessToken(userId: string) {
    const encryptedToken = await this.authService.getGithubAccessToken(userId);
    return this.tokenEncryptionService.decrypt(encryptedToken);
  }

  private async githubRequest(
    userId: string,
    path: string,
    init?: RequestInit & { accept?: string },
    parseJson = true,
  ) {
    const token = await this.getDecryptedAccessToken(userId);
    return this.rawGithubRequest(path, token, init, parseJson);
  }

  private async rawGithubRequest<T>(
    path: string,
    accessToken: string,
    init?: RequestInit & { accept?: string },
    parseJson = true,
  ): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: init?.accept ?? 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'pre-cision-backend',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(
        `GitHub API request failed with status ${response.status}: ${errorText}`,
      );
    }

    if (!parseJson) {
      return (await response.text()) as T;
    }

    return (await response.json()) as T;
  }
}
