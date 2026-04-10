import { AuthProvider } from '../../schemas/user.schema.js';

export type AuthenticatedUser = {
  userId: string;
  email: string;
  provider: AuthProvider;
  githubUsername?: string;
};
