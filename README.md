# Oromia Physicians Association — Platform

Monorepo foundation:
- `apps/web`: public Next.js site (3000)
- `apps/admin`: Next.js admin workspace (3001)
- `apps/api`: NestJS modular monolith REST API (4000, `/api/v1`)
- `packages/types`: shared TypeScript contracts
- PostgreSQL + Prisma

## Local setup
Requirements: Node.js 20.11+, pnpm 10+, Docker.

1. Copy `.env.example` to `.env`; change secrets.
2. `corepack enable`
3. `pnpm install`
4. `pnpm infra:up`
5. `pnpm db:generate`
6. `pnpm db:migrate`
7. `pnpm dev`

Public: http://localhost:3000 | Admin: http://localhost:3001 | API: http://localhost:4000/api/v1 | Swagger: http://localhost:4000/docs

Production hosting is not hard-coded. Confirm HahuCloud's actual plan supports Next.js SSR, multiple Node processes, NestJS, PostgreSQL and private persistent storage. Confirm Vercel Hobby eligibility before using it for an organizational production site. Preserve HahuCloud email DNS records during domain cutover.

This is an architecture and UI scaffold, not a production-ready authenticated platform. Never commit `.env` or expose database/storage credentials in `NEXT_PUBLIC_*` variables.
