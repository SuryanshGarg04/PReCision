import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { GithubOauthCallbackDto } from './dto/github-oauth-callback.dto.js';
import { GithubService } from './github.service.js';

/**
 * GitHub OAuth + REST proxy routes (GitHub API v3 only; no GraphQL).
 * Base path: /api/v1/github
 */
@Controller('/api/v1/github')
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  // --- OAuth (typically unauthenticated or callback from GitHub) ---

  @Get('/oauth/url')
  getAuthorizationUrl() {
    return this.githubService.getAuthorizationUrl();
  }

  @Get('/oauth/callback')
  handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    return this.githubService.handleOAuthCallback(code, state);
  }

  // --- Authenticated GitHub REST ---

  @UseGuards(JwtAuthGuard)
  @Get('/profile')
  getProfile(@Request() req: { user: AuthenticatedUser }) {
    return this.githubService.getAuthenticatedGithubProfile(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories')
  listRepositories(
    @Request() req: { user: AuthenticatedUser },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(20), ParseIntPipe) perPage: number,
  ) {
    return this.githubService.listRepositories(req.user, page, perPage);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/pulls')
  listPullRequests(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('state') state?: string,
  ) {
    return this.githubService.listPullRequests(req.user, owner, repo, state);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/pulls/:pullNumber')
  getPullRequest(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('pullNumber', ParseIntPipe) pullNumber: number,
  ) {
    return this.githubService.getPullRequest(req.user, owner, repo, pullNumber);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/pulls/:pullNumber/files')
  listPullRequestFiles(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('pullNumber', ParseIntPipe) pullNumber: number,
  ) {
    return this.githubService.listPullRequestFiles(
      req.user,
      owner,
      repo,
      pullNumber,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/file')
  getRepositoryFile(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('path') path: string,
    @Query('ref') ref?: string,
  ) {
    if (!path?.trim()) {
      throw new BadRequestException('Query parameter "path" is required');
    }
    return this.githubService.getRepositoryFile(
      req.user,
      owner,
      repo,
      path,
      ref,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/contents')
  listRepositoryContents(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('path') path?: string,
    @Query('ref') ref?: string,
  ) {
    return this.githubService.listRepositoryContents(
      req.user,
      owner,
      repo,
      path,
      ref,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/commits')
  listCommits(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('branch') branch?: string,
  ) {
    return this.githubService.listCommits(req.user, owner, repo, branch);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/compare')
  compareCommits(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('base') base: string,
    @Query('head') head: string,
  ) {
    return this.githubService.compareCommits(req.user, owner, repo, base, head);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/diff')
  getDiff(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('base') base: string,
    @Query('head') head: string,
  ) {
    return this.githubService.getDiff(req.user, owner, repo, base, head);
  }
}
