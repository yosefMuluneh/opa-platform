
import {
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type {
  NextFunction,
  Request,
  Response,
} from 'express';
import { createOriginValidationMiddleware } from './origin-validation.middleware';

describe('OriginValidationMiddleware', () => {
  const middleware = createOriginValidationMiddleware([
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:4000',
  ]);

  function execute(method: string, origin?: string) {
    const req = {
      method,
      get: jest.fn().mockReturnValue(origin),
    } as unknown as Request;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;

    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);

    return { req, res, next };
  }

  it('allows safe GET requests without an Origin header', () => {
    const { next } = execute('GET');

    expect(next).toHaveBeenCalled();
  });

  it('allows OPTIONS requests without an Origin header', () => {
    const { next } = execute('OPTIONS');

    expect(next).toHaveBeenCalled();
  });

  it('allows state-changing requests from an approved origin', () => {
    const { next } = execute(
      'POST',
      'http://localhost:3001',
    );

    expect(next).toHaveBeenCalled();
  });

  it('rejects state-changing requests without an Origin header', () => {
    const { res, next } = execute('POST');

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests from an untrusted origin', () => {
    const { res, next } = execute(
      'POST',
      'https://attacker.example',
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with a null Origin', () => {
    const { res, next } = execute('DELETE', 'null');

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an unapproved origin even when it shares a hostname suffix', () => {
    const { res, next } = execute(
      'POST',
      'http://localhost:3001.attacker.example',
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
