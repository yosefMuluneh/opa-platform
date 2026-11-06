
import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    let passwordIsValid = false;

    if (user?.passwordHash && user.status === UserStatus.ACTIVE) {
      passwordIsValid = await argon2
        .verify(user.passwordHash, password)
        .catch(() => false);
    }

    if (!user || !passwordIsValid) {
      try {
        await this.audit.record({
          actorId: user?.id ?? null,
          action: 'AUTH_LOGIN_FAILED',
          entityType: 'AUTHENTICATION',
          entityId: user?.id ?? 'unknown',
          metadata: {
            email: normalizedEmail,
            reason: !user
              ? 'USER_NOT_FOUND'
              : user.status !== UserStatus.ACTIVE
                ? 'USER_NOT_ACTIVE'
                : 'INVALID_CREDENTIALS',
          },
          ipAddress,
          userAgent,
        });
      } catch (error) {
        this.logger.error(
          'Could not record failed login audit event.',
          error instanceof Error ? error.stack : undefined,
        );
      }

      throw new UnauthorizedException('Invalid email or password.');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      await this.audit.record(
        {
          actorId: user.id,
          action: 'AUTH_LOGIN_SUCCESS',
          entityType: 'USER',
          entityId: user.id,
          metadata: {
            email: user.email,
            sessionExpiresAt: expiresAt.toISOString(),
          },
          ipAddress,
          userAgent,
        },
        tx,
      );
    });

    const roles = user.roles.map(({ role }) => role.name);

    const permissions = [
      ...new Set(
        user.roles.flatMap(({ role }) =>
          role.permissions.map(({ permission }) => permission.key),
        ),
      ),
    ];

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles,
        permissions,
      },
    };
  }

    async logout(
    sessionId: string,
    actorId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: {
          id: sessionId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      if (result.count === 0) {
        return;
      }

      await this.audit.record(
        {
          actorId: actorId ?? null,
          action: 'AUTH_LOGOUT',
          entityType: 'SESSION',
          entityId: sessionId,
          metadata: {
            sessionId,
          },
          ipAddress,
          userAgent,
        },
        tx,
      );
    });
  }
}
