
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './guards/permissions.guard';

type MockFunction = jest.Mock<(...args: any[]) => any>;

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: {
    getAllAndOverride: MockFunction;
  };

  const createContext = (user?: Record<string, any>) => {
    const request: Record<string, any> = { user };

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

    reflector = {
      getAllAndOverride: jest.fn(),
    };

    guard = new PermissionsGuard(
      reflector as unknown as Reflector,
    );
  });

  it('should allow a route without permission requirements', async () => {
    jest.mocked(reflector.getAllAndOverride).mockReturnValue(undefined);

    const { context } = createContext();

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow a user with the required permission', async () => {
    jest.mocked(reflector.getAllAndOverride).mockReturnValue([
      'dashboard.read',
    ]);

    const { context } = createContext({
      id: 'user-1',
      permissions: ['dashboard.read', 'users.manage'],
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should reject a user who does not have the required permission', async () => {
    jest.mocked(reflector.getAllAndOverride).mockReturnValue([
      'users.manage',
    ]);

    const { context } = createContext({
      id: 'user-1',
      permissions: ['dashboard.read'],
    });

    expect(() => guard.canActivate(context)).toThrow(
        ForbiddenException,
    );
  });

  it('should reject a request without an authenticated user when permissions are required', async () => {
    jest.mocked(reflector.getAllAndOverride).mockReturnValue([
      'dashboard.read',
    ]);

    const { context } = createContext();

    expect(() => guard.canActivate(context)).toThrow(
        ForbiddenException,
    );
  });

  it('should require all permissions declared on a route', async () => {
    jest.mocked(reflector.getAllAndOverride).mockReturnValue([
      'dashboard.read',
      'users.manage',
    ]);

    const { context } = createContext({
      id: 'user-1',
      permissions: ['dashboard.read'],
    });

    expect(() => guard.canActivate(context)).toThrow(
        ForbiddenException,
    );
  });

  it('should allow a user who has all required permissions', async () => {
    jest.mocked(reflector.getAllAndOverride).mockReturnValue([
      'dashboard.read',
      'users.manage',
    ]);

    const { context } = createContext({
      id: 'user-1',
      permissions: ['dashboard.read', 'users.manage', 'audit.read'],
    });

    await expect(guard.canActivate(context)).toBe(true);
  });
});
