# Architecture

Modular monolith, not microservices. Public Next.js and admin Next.js applications call one NestJS REST API. PostgreSQL is accessed through Prisma. Persistent uploads use a storage adapter, not the app filesystem.

NestJS modules: Auth, Users/Roles, Membership, Content, Events, Contact, Media, Notifications, Audit and Settings.

Membership invariants:
- An application is not a member; approval creates a Member record.
- Application status and payment status are independent.
- Receipt upload is not proof of bank deposit.
- Record who verified payment, when and with what outcome.
- Preserve review history and consequential decisions.
- Application documents and receipts are private.

Locales: English (`en`) and Afaan Oromoo (`om`). Translation records have independent publication states.

Security: admin-only authentication initially; Argon2id password hashes; secure HTTP-only SameSite cookies; server-side session revocation; NestJS authorization; rate limiting; validation; audit logs; MFA before production.

Keep storage and email behind provider interfaces. Database and storage secrets stay on the API server. Production requires HTTPS, staging/production separation, automated backups and tested restoration, logs and uptime checks.
