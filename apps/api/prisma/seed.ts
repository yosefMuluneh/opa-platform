
import argon2 from 'argon2';
import { PrismaClient, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

const permissions = [
  {
    key: 'dashboard.read',
    description: 'View the administration dashboard',
  },
  {
    key: 'membership.applications.read',
    description: 'View membership applications',
  },
  {
    key: 'membership.applications.review',
    description: 'Review membership applications',
  },
  {
    key: 'membership.applications.manage',
    description: 'Approve, decline, and manage applications',
  },
  {
    key: 'membership.members.read',
    description: 'View the member directory',
  },
  {
    key: 'membership.members.manage',
    description: 'Manage member records',
  },
  {
    key: 'content.read',
    description: 'View platform content',
  },
  {
    key: 'content.create',
    description: 'Create platform content',
  },
  {
    key: 'content.update',
    description: 'Edit platform content',
  },
  {
    key: 'content.publish',
    description: 'Publish and unpublish content',
  },
  {
    key: 'events.manage',
    description: 'Manage events and registrations',
  },
  {
    key: 'contacts.manage',
    description: 'Manage contact messages',
  },
  {
    key: 'media.manage',
    description: 'Manage media files',
  },
  {
    key: 'users.manage',
    description: 'Manage user accounts',
  },
  {
    key: 'roles.manage',
    description: 'Manage roles and permissions',
  },
  {
    key: 'reports.read',
    description: 'View platform reports',
  },
  {
    key: 'settings.manage',
    description: 'Manage platform settings',
  },
  {
    key: 'audit.read',
    description: 'View audit logs',
  },
];

async function main() {
  const name = process.env.SEED_ADMIN_NAME?.trim();
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!name || !email || !password) {
    throw new Error(
      'Missing SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, or SEED_ADMIN_PASSWORD.',
    );
  }

  if (password.length < 12) {
    throw new Error('The administrator password must be at least 12 characters.');
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  await prisma.$transaction(async (tx) => {
    const adminRole = await tx.role.upsert({
      where: { name: 'ADMIN' },
      update: {
        description: 'Full administrative access to the OPA platform',
        isSystem: true,
      },
      create: {
        name: 'ADMIN',
        description: 'Full administrative access to the OPA platform',
        isSystem: true,
      },
    });

    for (const permission of permissions) {
      const savedPermission = await tx.permission.upsert({
        where: { key: permission.key },
        update: { description: permission.description },
        create: permission,
      });

      await tx.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: savedPermission.id,
          },
        },
        update: {},
        create: {
          roleId: adminRole.id,
          permissionId: savedPermission.id,
        },
      });
    }

    let adminUser = await tx.user.findUnique({
      where: { email },
    });

    if (!adminUser) {
      adminUser = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });
    } else {
      if (
        adminUser.status !== UserStatus.ACTIVE ||
        !adminUser.passwordHash
      ) {
        throw new Error(
          'The configured administrator email already belongs to an inactive or incomplete account. Resolve that account manually before seeding.',
        );
      }
    }

    await tx.userRole.upsert({
      where: {
        userId_roleId: {
          userId: adminUser.id,
          roleId: adminRole.id,
        },
      },
      update: {},
      create: {
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    });

    console.log('Administrator role and permissions initialized.');
    console.log(`Administrator account: ${adminUser.email}`);
    console.log(`Permissions assigned: ${permissions.length}`);
  });
}

main()
  .catch((error: unknown) => {
    console.error('Prisma seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
