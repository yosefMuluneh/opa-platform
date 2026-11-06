
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import argon2 from 'argon2';

import { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';

jest.mock('argon2', () => ({
  __esModule: true,
  default: {
    verify: jest.fn(),
    hash: jest.fn(),
  },
}));

type ActiveUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  roles: {
    role: {
      name: string;
      permissions: {
        permission: {
          key: string;
        };
      }[];
    };
  }[];
};

describe('AuthService', () => {
  let service: AuthService;

  type MockFunction = jest.Mock<(...args: any[]) => any>;

  let prisma: {
    user: {
      findUnique: MockFunction;
      update: MockFunction;
    };
    $transaction: MockFunction;
  };

  let transactionClient: {
    session: {
      create: MockFunction;
      updateMany: MockFunction;
    };
    user: {
      update: MockFunction;
    };
  };

  let audit: {
    record: MockFunction;
  };

  let activeUser: ActiveUser;

  beforeEach(() => {
    jest.clearAllMocks();

    audit = {
      record: jest.fn(),
    };

    activeUser = {
      id: 'user-1',
      name: 'OPA Administrator',
      email: 'admin@oromiaphysicians.org',
      passwordHash: 'argon2-hashed-password',
      status: UserStatus.ACTIVE,
      roles: [
        {
          role: {
            name: 'ADMIN',
            permissions: [
              {
                permission: {
                  key: 'dashboard.read',
                },
              },
              {
                permission: {
                  key: 'membership.applications.read',
                },
              },
            ],
          },
        },
      ],
    };

    transactionClient = {
      session: {
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      user: {
        update: jest.fn(),
      },
    };

    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    jest.mocked(prisma.user.findUnique).mockResolvedValue(
      activeUser as never,
    );

    jest.mocked(prisma.user.update).mockResolvedValue({} as never);

    jest.mocked(transactionClient.session.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    jest.mocked(transactionClient.session.create).mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      tokenHash: 'test-token-hash',
      expiresAt: new Date(),
      revokedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    } as never);

    jest.mocked(transactionClient.user.update).mockResolvedValue(
      {} as never,
    );

    jest.mocked(prisma.$transaction).mockImplementation(
      async (callback: unknown) => {
        if (typeof callback === 'function') {
          return callback(
            transactionClient as unknown as Prisma.TransactionClient,
          );
        }

        return Promise.resolve({});
      },
    );

    jest.mocked(argon2.verify).mockResolvedValue(true);
  });

  describe('login', () => {
    it('should authenticate an active user with valid credentials', async () => {
      const result = await service.login(
        'admin@oromiaphysicians.org',
        'ValidPassword123!',
        '127.0.0.1',
        'Jest Test Agent',
      );

      expect(result).toBeDefined();

      expect(result.user).toEqual({
        id: activeUser.id,
        name: activeUser.name,
        email: activeUser.email,
        roles: ['ADMIN'],
        permissions: [
          'dashboard.read',
          'membership.applications.read',
        ],
      });

      expect(result.token).toBeDefined();
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should normalize the email address before looking up the user', async () => {
      await service.login(
        '  ADMIN@OROMIAPHYSICIANS.ORG  ',
        'ValidPassword123!',
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            email: 'admin@oromiaphysicians.org',
          },
        }),
      );
    });

    it('should verify the supplied password using Argon2', async () => {
      await service.login(
        'admin@oromiaphysicians.org',
        'ValidPassword123!',
      );

      expect(argon2.verify).toHaveBeenCalledWith(
        activeUser.passwordHash,
        'ValidPassword123!',
      );
    });

    it('should store a SHA-256 hash of the session token instead of the raw token', async () => {
      const result = await service.login(
        'admin@oromiaphysicians.org',
        'ValidPassword123!',
      );

      const createCall = jest.mocked(transactionClient.session.create)
        .mock.calls[0]?.[0] as {
          data: {
            tokenHash: string;
          };
        };

      const storedHash = createCall.data.tokenHash;

      const expectedHash = createHash('sha256')
        .update(result.token)
        .digest('hex');

      expect(storedHash).toBe(expectedHash);
      expect(storedHash).not.toBe(result.token);
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('should store the client IP address and user agent when provided', async () => {
      await service.login(
        'admin@oromiaphysicians.org',
        'ValidPassword123!',
        '127.0.0.1',
        'Jest Test Agent',
      );

      const createCall = jest.mocked(transactionClient.session.create)
        .mock.calls[0]?.[0] as {
          data: {
            ipAddress?: string;
            userAgent?: string;
          };
        };

      expect(createCall.data.ipAddress).toBe('127.0.0.1');
      expect(createCall.data.userAgent).toBe('Jest Test Agent');
    });

    it('should reject an unknown email address', async () => {
      jest.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(
        service.login(
          'unknown@oromiaphysicians.org',
          'ValidPassword123!',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('should reject an incorrect password', async () => {
      jest.mocked(argon2.verify).mockResolvedValue(false);

      await expect(
        service.login(
          'admin@oromiaphysicians.org',
          'WrongPassword123!',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('should reject a disabled user', async () => {
      jest.mocked(prisma.user.findUnique).mockResolvedValue({
        ...activeUser,
        status: UserStatus.DISABLED,
      } as never);

      await expect(
        service.login(
          'admin@oromiaphysicians.org',
          'ValidPassword123!',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('should return the same generic authentication error for unknown users and incorrect passwords', async () => {
      jest.mocked(prisma.user.findUnique).mockResolvedValue(null);

      let unknownUserError: unknown;

      try {
        await service.login(
          'unknown@oromiaphysicians.org',
          'ValidPassword123!',
        );
      } catch (error) {
        unknownUserError = error;
      }

      jest.mocked(prisma.user.findUnique).mockResolvedValue(
        activeUser as never,
      );

      jest.mocked(argon2.verify).mockResolvedValue(false);

      let incorrectPasswordError: unknown;

      try {
        await service.login(
          'admin@oromiaphysicians.org',
          'WrongPassword123!',
        );
      } catch (error) {
        incorrectPasswordError = error;
      }

      expect(unknownUserError).toBeInstanceOf(UnauthorizedException);
      expect(incorrectPasswordError).toBeInstanceOf(UnauthorizedException);

      expect(
        (unknownUserError as UnauthorizedException).message,
      ).toBe(
        (incorrectPasswordError as UnauthorizedException).message,
      );
    });

    it('should record a successful login audit event inside the transaction', async () => {
      await service.login(
        'admin@oromiaphysicians.org',
        'ValidPassword123!',
        '127.0.0.1',
        'Jest Test Agent',
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'AUTH_LOGIN_SUCCESS',
          entityType: 'USER',
          entityId: 'user-1',
          ipAddress: '127.0.0.1',
          userAgent: 'Jest Test Agent',
        }),
        transactionClient,
      );
    });

    it('should record a failed login audit event for an unknown user', async () => {
      jest.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(
        service.login(
          'unknown@oromiaphysicians.org',
          'WrongPassword123!',
          '127.0.0.1',
          'Jest Test Agent',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: null,
          action: 'AUTH_LOGIN_FAILED',
          entityType: 'AUTHENTICATION',
          entityId: 'unknown',
          metadata: expect.objectContaining({
            email: 'unknown@oromiaphysicians.org',
            reason: 'USER_NOT_FOUND',
          }),
        }),
      );
    });

    it('should not expose audit failures when rejecting invalid login credentials', async () => {
      jest.mocked(prisma.user.findUnique).mockResolvedValue(null);

      audit.record.mockRejectedValue(
        new Error('Audit database error'),
      );

      await expect(
        service.login(
          'unknown@oromiaphysicians.org',
          'WrongPassword123!',
        ),
      ).rejects.toThrow('Invalid email or password.');
    });
  });

  describe('logout', () => {
    it('should revoke the session using the transaction client', async () => {
      await service.logout('session-1');

      expect(
        transactionClient.session.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          id: 'session-1',
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date),
        },
      });
    });

    it('should record a logout audit event inside the same transaction', async () => {
      await service.logout(
        'session-1',
        'user-1',
        '127.0.0.1',
        'Jest Test Agent',
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'AUTH_LOGOUT',
          entityType: 'SESSION',
          entityId: 'session-1',
          metadata: {
            sessionId: 'session-1',
          },
          ipAddress: '127.0.0.1',
          userAgent: 'Jest Test Agent',
        }),
        transactionClient,
      );
    });

    it('should not record an audit event if the session was already revoked', async () => {
      jest.mocked(transactionClient.session.updateMany).mockResolvedValue({
        count: 0,
      } as never);

      await service.logout('session-1');

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('should propagate an audit failure when revoking a session', async () => {
      audit.record.mockRejectedValue(
        new Error('Audit database error'),
      );

      await expect(
        service.logout(
          'session-1',
          'user-1',
          '127.0.0.1',
          'Jest Test Agent',
        ),
      ).rejects.toThrow('Audit database error');

      expect(
        transactionClient.session.updateMany,
      ).toHaveBeenCalled();

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTH_LOGOUT',
          entityId: 'session-1',
        }),
        transactionClient,
      );
    });
  });
});
