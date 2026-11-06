
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import {
  AuthenticatedRequest,
} from '../auth.types';
import { UserStatus } from '@prisma/client';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const token = request.cookies?.opa_session;

    if (!token) {
        throw new UnauthorizedException('Authentication required.');
    }

    const tokenHash = createHash('sha256')
      .update(token)
      .digest('hex');

    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: {
        user: {
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
        },
      },
    });

    const now = new Date();

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    request.user = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      sessionId: session.id,
      roles: session.user.roles.map(({ role }) => role.name),
      permissions: [
        ...new Set(
          session.user.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.key),
          ),
        ),
      ],
    };

    // Refresh last-used information at most once every five minutes.
    const lastUsedAt = session.lastUsedAt?.getTime() ?? 0;

    if (now.getTime() - lastUsedAt >= 5 * 60 * 1000) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastUsedAt: now },
      });
    }

    return true;
  }
}
