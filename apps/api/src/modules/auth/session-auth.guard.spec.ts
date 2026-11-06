
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionAuthGuard } from './guards/session-auth.guard';

type MockFunction = jest.Mock<(...args: any[]) => any>;

describe('SessionAuthGuard', () => {
  let guard: SessionAuthGuard;
  let prisma: {
    session: {
      findUnique: MockFunction;
      update: MockFunction;
      updateMany: MockFunction;
    };
  };
  let reflector: {
    getAllAndOverride: MockFunction;
  };

  const token = 'test-session-token';
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const activeSession = {
    id: 'session-1',
    userId: 'user-1',
    tokenHash,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revokedAt: null,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    user: {
      id: 'user-1',
      name: 'OPA Administrator',
      email: 'admin@oromiaphysicians.org',
      status: 'ACTIVE',
      roles: [
        {
          role: {
            name: 'ADMIN',
            permissions: [
              { permission: { key: 'dashboard.read' } },
              { permission: { key: 'users.manage' } },
            ],
          },
        },
      ],
    },
  };

  const createContext = (cookies: Record<string, string> = {}) => {
    const request: Record<string, any> = {
      cookies,
      headers: {},
    };

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    return { context, request };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      session: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    reflector = {
      getAllAndOverride: jest.fn(),
    };

    jest.mocked(reflector.getAllAndOverride).mockReturnValue(false);
    jest.mocked(prisma.session.findUnique).mockResolvedValue(activeSession);

    guard = new SessionAuthGuard(
      prisma as unknown as PrismaService,
      reflector as unknown as Reflector,
    );
  });

  it('should allow a route marked as public without checking a session', async () => {
    jest.mocked(reflector.getAllAndOverride).mockReturnValue(true);

    const { context } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('should reject a request without a session cookie', async () => {
    const { context } = createContext();

    await expect(
      guard.canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('should reject an unknown session token', async () => {
    jest.mocked(prisma.session.findUnique).mockResolvedValue(null);

    const { context } = createContext({
      opa_session: token,
    });

    await expect(
      guard.canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should look up the session using the SHA-256 token hash', async () => {
    const { context } = createContext({
      opa_session: token,
    });

    await guard.canActivate(context);

    expect(prisma.session.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tokenHash,
        },
      }),
    );
  });

  it('should reject a revoked session', async () => {
    jest.mocked(prisma.session.findUnique).mockResolvedValue({
      ...activeSession,
      revokedAt: new Date(),
    });

    const { context } = createContext({
      opa_session: token,
    });

    await expect(
      guard.canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should reject an expired session', async () => {
    jest.mocked(prisma.session.findUnique).mockResolvedValue({
      ...activeSession,
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    const { context } = createContext({
      opa_session: token,
    });

    await expect(
      guard.canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should reject a disabled user', async () => {
    jest.mocked(prisma.session.findUnique).mockResolvedValue({
      ...activeSession,
      user: {
        ...activeSession.user,
        status: 'DISABLED',
      },
    });

    const { context } = createContext({
      opa_session: token,
    });

    await expect(
      guard.canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should attach the authenticated user and permissions to the request', async () => {
    const { context, request } = createContext({
      opa_session: token,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toEqual(
      expect.objectContaining({
        id: 'user-1',
        name: 'OPA Administrator',
        email: 'admin@oromiaphysicians.org',
        roles: ['ADMIN'],
        permissions: ['dashboard.read', 'users.manage'],
        sessionId: 'session-1',
      }),
    );
  });
});
