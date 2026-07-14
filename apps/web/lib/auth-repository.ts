import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  adminAccounts,
  adminSessions,
  bootstrapAdmin,
  type Db,
} from "@compare/db";
import type { AdminAuthRepository } from "./auth-service";
import { getDatabase } from "./database";

let bootstrapPromise: Promise<void> | undefined;

async function ensureBootstrapAccount(db: Db): Promise<void> {
  await bootstrapAdmin(
    {
      async find() {
        const [account] = await db.select({ id: adminAccounts.id }).from(adminAccounts).limit(1);
        return account ?? null;
      },
      async create(data) {
        await db.insert(adminAccounts).values(data);
      },
    },
    {
      username: process.env.ADMIN_INITIAL_USERNAME ?? "owner",
      password: process.env.ADMIN_INITIAL_PASSWORD ?? "CHANGE-ME-AT-FIRST-LOGIN",
    },
  );
}

export async function getAdminAuthRepository(): Promise<AdminAuthRepository> {
  const db = getDatabase();
  bootstrapPromise ??= ensureBootstrapAccount(db).catch((cause) => {
    bootstrapPromise = undefined;
    throw cause;
  });
  await bootstrapPromise;

  return {
    async findAccount() {
      const [account] = await db.select().from(adminAccounts).where(eq(adminAccounts.id, 1)).limit(1);
      return account ?? null;
    },
    async updateFailedAttempts(failedAttempts, lockedUntil) {
      await db.update(adminAccounts).set({ failedAttempts, lockedUntil, updatedAt: new Date() }).where(eq(adminAccounts.id, 1));
    },
    async resetFailedAttempts() {
      await db.update(adminAccounts).set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(adminAccounts.id, 1));
    },
    async createSession(session) {
      await db.insert(adminSessions).values({ id: randomUUID(), ...session });
    },
    async findSession(tokenHash) {
      const [session] = await db
        .select({
          expiresAt: adminSessions.expiresAt,
          revokedAt: adminSessions.revokedAt,
          csrfTokenHash: adminSessions.csrfTokenHash,
          sessionVersion: adminSessions.sessionVersion,
          forcePasswordChange: adminAccounts.forcePasswordChange,
        })
        .from(adminSessions)
        .innerJoin(adminAccounts, eq(adminAccounts.id, 1))
        .where(
          and(
            eq(adminSessions.tokenHash, tokenHash),
            isNull(adminSessions.revokedAt),
            gt(adminSessions.expiresAt, new Date()),
            eq(adminSessions.sessionVersion, adminAccounts.sessionVersion),
          ),
        )
        .limit(1);
      return session ?? null;
    },
    async replacePasswordAndRevokeSessions({ passwordHash, changedAt }) {
      await db.transaction(async (tx) => {
        await tx
          .update(adminAccounts)
          .set({
            passwordHash,
            failedAttempts: 0,
            lockedUntil: null,
            sessionVersion: sql`${adminAccounts.sessionVersion} + 1`,
            forcePasswordChange: false,
            bootstrapPasswordConsumedAt: changedAt,
            updatedAt: changedAt,
          })
          .where(eq(adminAccounts.id, 1));
        await tx
          .update(adminSessions)
          .set({ revokedAt: changedAt })
          .where(isNull(adminSessions.revokedAt));
      });
    },
  };
}

export async function revokeAdminSession(tokenHash: string): Promise<void> {
  const db = getDatabase();
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.tokenHash, tokenHash));
}
