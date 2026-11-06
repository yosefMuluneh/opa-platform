
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
