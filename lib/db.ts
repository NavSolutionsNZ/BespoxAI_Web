import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

// Runtime queries go through Prisma Postgres's connection pooler when
// PRISMA_POOLED_URL is set (host pooled.db.prisma.io, with &pgbouncer=true for
// its transaction-mode PgBouncer). PRISMA_DATABASE_URL is managed by the Vercel
// integration, can't be edited, and is a direct connection: the Free plan
// allows 10 direct connections (5 reserved), which a dashboard's ~13 parallel
// widget requests exhausted ("too many connections for role prisma_migration").
// Without PRISMA_POOLED_URL (local dev, or before it's set) the schema's
// datasource URL is used as before.
const pooledUrl = process.env.PRISMA_POOLED_URL

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  ...(pooledUrl ? { datasources: { db: { url: pooledUrl } } } : {}),
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
