/** Signed OAuth state payload (JWT body). */
export type GithubOauthState = {
  nonce: string;
};

export type GithubUserProfile = {
  id: number;
  login: string;
};

export type GithubUserEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};
