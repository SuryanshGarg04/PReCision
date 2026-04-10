import { IsOptional, IsString } from 'class-validator';

export class GithubOauthCallbackDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  state?: string;
}
