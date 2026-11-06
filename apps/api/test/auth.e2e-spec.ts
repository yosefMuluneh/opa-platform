
import {
  Controller,
  Get,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import argon2 from 'argon2';
import request from 'supertest';
import { createHash } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { RequirePermissions } from '../src/common/decorators/require-permissions.decorator';
import { configureApp } from '../src/configure-app';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';

const API_PREFIX = '/api/v1';
const ADMIN_ORIGIN = 'http://localhost:3001';

const ADMIN_EMAIL = 'e2e-admin@opa.test';
const LIMITED_EMAIL = 'e2e-limited@opa.test';
const TEST_PASSWORD = 'E2E-Test-Password-2026!';

const ADMIN_ROLE = 'E2E_TEST_ADMIN';
const LIMITED_ROLE = 'E2E_TEST_LIMITED';
const TEST_PERMISSION = 'e2e:access';

@Controller('__e2e')
class E2ePermissionController {
  @Get('protected')
  @RequirePermissions(TEST_PERMISSION)
  protectedEndpoint() {
    return { message: 'Permission granted' };
  }
}

describe('Authentication E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auditService: AuditService;

  let adminUser = {
    id: '',
    email: ADMIN_EMAIL,
  };

  let adminCookie = '';
  let limitedCookie = '';
  let adminSessionId = '';

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is required. Point it to the isolated opa_test database.',
      );
    }

    const databaseName = new URL(databaseUrl).pathname
      .replace(/^\//, '')
      .split('?')[0];

    if (databaseName !== 'opa_test') {
      throw new Error(
        `E2E tests must use the opa_test database. Current database: ${databaseName}`,
      );
    }

    process.env.NODE_ENV = 'test';
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    process.env.ADMIN_ORIGIN = ADMIN_ORIGIN;
    process.env.API_ORIGIN = 'http://localhost:4000';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [E2ePermissionController],
    }).compile();

    app = moduleRef.createNestApplication();

    configureApp(app);

    await app.init();

    prisma = app.get(PrismaService);
    auditService = app.get(AuditService);

    await cleanFixtures();

    const passwordHash = await argon2.hash(TEST_PASSWORD);

    const permission = await prisma.permission.create({
      data: {
        key: TEST_PERMISSION,
        description: 'Permission used by authentication E2E tests',
      },
    });

    const adminRole = await prisma.role.create({
      data: {
        name: ADMIN_ROLE,
        description: 'E2E test role with protected endpoint access',
      },
    });

    const limitedRole = await prisma.role.create({
      data: {
        name: LIMITED_ROLE,
        description: 'E2E test role without protected endpoint access',
      },
    });

    await prisma.rolePermission.create({
      data: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });

    const admin = await prisma.user.create({
      data: {
        name: 'E2E Administrator',
        email: ADMIN_EMAIL,
        passwordHash,
        status: UserStatus.ACTIVE,
      },
    });

    const limited = await prisma.user.create({
      data: {
        name: 'E2E Limited User',
        email: LIMITED_EMAIL,
        passwordHash,
        status: UserStatus.ACTIVE,
      },
    });

    await prisma.userRole.createMany({
      data: [
        {
          userId: admin.id,
          roleId: adminRole.id,
        },
        {
          userId: limited.id,
          roleId: limitedRole.id,
        },
      ],
    });

    adminUser = {
      id: admin.id,
      email: admin.email,
    };
  });

  afterAll(async () => {
    if (prisma) {
      await cleanFixtures();
    }

    if (app) {
      await app.close();
    }
  });

  async function cleanFixtures(): Promise<void> {
    const existingUsers = await prisma.user.findMany({
      where: {
        email: {
          in: [ADMIN_EMAIL, LIMITED_EMAIL],
        },
      },
      select: {
        id: true,
      },
    });

    const userIds = existingUsers.map((user) => user.id);

    if (userIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: {
          actorId: {
            in: userIds,
          },
        },
      });

      await prisma.user.deleteMany({
        where: {
          id: {
            in: userIds,
          },
        },
      });
    }

    await prisma.role.deleteMany({
      where: {
        name: {
          in: [ADMIN_ROLE, LIMITED_ROLE],
        },
      },
    });

    await prisma.permission.deleteMany({
      where: {
        key: TEST_PERMISSION,
      },
    });
  }

  async function login(email: string, password: string) {
    const response = await request(app.getHttpServer())
      .post(`${API_PREFIX}/auth/login`)
      .set('Origin', ADMIN_ORIGIN)
      .send({ email, password });

    const rawCookies = response.headers['set-cookie'];

    const cookies = rawCookies
      ? Array.isArray(rawCookies)
        ? rawCookies
        : [rawCookies]
      : [];

    const sessionCookie = cookies.find((cookie) =>
      cookie.startsWith('opa_session='),
    );

    return {
      status: response.status,
      cookie: sessionCookie
        ? sessionCookie.split(';')[0]
        : '',
      body: response.body,
      headers: response.headers,
    };
  }

  it('rejects invalid credentials and records a failed login audit event', async () => {
    const response = await login(
      ADMIN_EMAIL,
      'incorrect-password',
    );

    expect(response.status).toBe(401);
    expect(response.body.message).toBe(
      'Invalid email or password.',
    );

    const audit = await prisma.auditLog.findFirst({
      where: {
        actorId: adminUser.id,
        action: 'AUTH_LOGIN_FAILED',
        entityType: 'AUTHENTICATION',
      },
    });

    expect(audit).not.toBeNull();
  });

  it('authenticates a valid user and creates an HTTP-only session cookie', async () => {
    const response = await login(
      ADMIN_EMAIL,
      TEST_PASSWORD,
    );

    expect(response.status).toBe(200);
    expect(response.cookie).toBeTruthy();

    expect(response.body.user).toMatchObject({
      id: adminUser.id,
      email: ADMIN_EMAIL,
      roles: [ADMIN_ROLE],
      permissions: [TEST_PERMISSION],
    });

    expect(response.body).not.toHaveProperty('token');

    const rawCookies = response.headers['set-cookie'];

    const cookies = rawCookies
      ? Array.isArray(rawCookies)
        ? rawCookies
        : [rawCookies]
      : [];

    const sessionCookie = cookies.find((cookie) =>
      cookie.startsWith('opa_session='),
    );

    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Strict');
    expect(sessionCookie).toContain('Path=/');

    adminCookie = response.cookie;

    const session = await prisma.session.findFirst({
      where: {
        userId: adminUser.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    expect(session).not.toBeNull();
    expect(session?.revokedAt).toBeNull();

    adminSessionId = session!.id;

    const updatedUser = await prisma.user.findUnique({
      where: {
        id: adminUser.id,
      },
    });

    expect(updatedUser?.lastLoginAt).not.toBeNull();

    const loginAudit = await prisma.auditLog.findFirst({
      where: {
        actorId: adminUser.id,
        action: 'AUTH_LOGIN_SUCCESS',
        entityType: 'USER',
      },
    });

    expect(loginAudit).not.toBeNull();
  });

  it('allows /auth/me with a valid session and rejects unauthenticated requests', async () => {
    const authenticatedResponse = await request(app.getHttpServer())
      .get(`${API_PREFIX}/auth/me`)
      .set('Cookie', adminCookie);

    expect(authenticatedResponse.status).toBe(200);
    expect(authenticatedResponse.body.user).toMatchObject({
      id: adminUser.id,
      email: ADMIN_EMAIL,
    });

    const unauthenticatedResponse = await request(app.getHttpServer())
      .get(`${API_PREFIX}/auth/me`);

    expect(unauthenticatedResponse.status).toBe(401);
  });

  it('enforces permissions on protected endpoints', async () => {
    const unauthenticatedResponse = await request(app.getHttpServer())
      .get(`${API_PREFIX}/__e2e/protected`);

    expect(unauthenticatedResponse.status).toBe(401);

    const limitedLogin = await login(
      LIMITED_EMAIL,
      TEST_PASSWORD,
    );

    expect(limitedLogin.status).toBe(200);
    expect(limitedLogin.cookie).toBeTruthy();

    limitedCookie = limitedLogin.cookie;

    const limitedResponse = await request(app.getHttpServer())
      .get(`${API_PREFIX}/__e2e/protected`)
      .set('Cookie', limitedCookie);

    expect(limitedResponse.status).toBe(403);

    const adminResponse = await request(app.getHttpServer())
      .get(`${API_PREFIX}/__e2e/protected`)
      .set('Cookie', adminCookie);

    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body).toEqual({
      message: 'Permission granted',
    });
  });

  it('rejects an expired session', async () => {
    const expiredToken = 'e2e-expired-session-token';

    const tokenHash = createHash('sha256')
      .update(expiredToken)
      .digest('hex');

    await prisma.session.create({
      data: {
        userId: adminUser.id,
        tokenHash,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const response = await request(app.getHttpServer())
      .get(`${API_PREFIX}/auth/me`)
      .set('Cookie', `opa_session=${expiredToken}`);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe(
      'Invalid or expired session.',
    );
  });

  it('rejects an existing session when the user is disabled', async () => {
    expect(limitedCookie).toBeTruthy();

    await prisma.user.update({
      where: {
        email: LIMITED_EMAIL,
      },
      data: {
        status: UserStatus.DISABLED,
      },
    });

    try {
      const response = await request(app.getHttpServer())
        .get(`${API_PREFIX}/auth/me`)
        .set('Cookie', limitedCookie);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(
        'Invalid or expired session.',
      );
    } finally {
      await prisma.user.update({
        where: {
          email: LIMITED_EMAIL,
        },
        data: {
          status: UserStatus.ACTIVE,
        },
      });
    }
  });

  it('sets the Secure cookie attribute in production', async () => {
    const previousNodeEnv = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'production';

      const response = await login(
        ADMIN_EMAIL,
        TEST_PASSWORD,
      );

      expect(response.status).toBe(200);

      const rawCookies = response.headers['set-cookie'];

      const cookies = rawCookies
        ? Array.isArray(rawCookies)
          ? rawCookies
          : [rawCookies]
        : [];

      const sessionCookie = cookies.find((cookie) =>
        cookie.startsWith('opa_session='),
      );

      expect(sessionCookie).toBeDefined();
      expect(sessionCookie).toContain('Secure');
      expect(sessionCookie).toContain('HttpOnly');
      expect(sessionCookie).toContain('SameSite=Strict');
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it('rolls back session revocation when logout audit recording fails', async () => {
    const auditSpy = jest
      .spyOn(auditService, 'record')
      .mockRejectedValueOnce(
        new Error('Simulated audit database failure'),
      );

    try {
      const failedLogout = await request(app.getHttpServer())
        .post(`${API_PREFIX}/auth/logout`)
        .set('Origin', ADMIN_ORIGIN)
        .set('Cookie', adminCookie);

      expect(failedLogout.status).toBe(500);
    } finally {
      auditSpy.mockRestore();
    }

    const sessionAfterFailure = await prisma.session.findUnique({
      where: {
        id: adminSessionId,
      },
    });

    expect(sessionAfterFailure).not.toBeNull();
    expect(sessionAfterFailure?.revokedAt).toBeNull();

    const logoutAuditCount = await prisma.auditLog.count({
      where: {
        actorId: adminUser.id,
        action: 'AUTH_LOGOUT',
        entityId: adminSessionId,
      },
    });

    expect(logoutAuditCount).toBe(0);
  });

  it('successfully logs out, records the audit event, and invalidates the old session', async () => {
    const response = await request(app.getHttpServer())
      .post(`${API_PREFIX}/auth/logout`)
      .set('Origin', ADMIN_ORIGIN)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(204);

    const rawCookies = response.headers['set-cookie'];

    const cookies = rawCookies
      ? Array.isArray(rawCookies)
        ? rawCookies
        : [rawCookies]
      : [];

    expect(
      cookies.some((cookie) =>
        cookie.startsWith('opa_session=;'),
      ),
    ).toBe(true);

    const revokedSession = await prisma.session.findUnique({
      where: {
        id: adminSessionId,
      },
    });

    expect(revokedSession?.revokedAt).not.toBeNull();

    const logoutAudit = await prisma.auditLog.findFirst({
      where: {
        actorId: adminUser.id,
        action: 'AUTH_LOGOUT',
        entityId: adminSessionId,
      },
    });

    expect(logoutAudit).not.toBeNull();

    const oldSessionResponse = await request(app.getHttpServer())
      .get(`${API_PREFIX}/auth/me`)
      .set('Cookie', adminCookie);

    expect(oldSessionResponse.status).toBe(401);
  });

  it('rejects the sixth login attempt within the rate-limit window', async () => {
    // Four login requests have already occurred in the preceding tests.
    // The fifth should be allowed; the sixth should be throttled.

    const fifthAttempt = await login(
      ADMIN_EMAIL,
      'incorrect-password',
    );

    expect(fifthAttempt.status).toBe(401);

    const sixthAttempt = await login(
      ADMIN_EMAIL,
      'incorrect-password',
    );

    expect(sixthAttempt.status).toBe(429);
  });
});
