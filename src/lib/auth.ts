import { db } from "@/lib/db";
import { users, sessions, magicLinks } from "@/lib/db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { cookies } from "next/headers";

const SESSION_COOKIE = "aurelius_session";
const SESSION_DURATION_DAYS = 30;
const MAGIC_LINK_EXPIRY_MINUTES = 15;

export async function createMagicLink(email: string) {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000);

  await db.insert(magicLinks).values({
    email,
    token,
    expiresAt,
  });

  return token;
}

export async function verifyMagicLink(token: string) {
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(
      and(
        eq(magicLinks.token, token),
        gt(magicLinks.expiresAt, new Date()),
        isNull(magicLinks.usedAt)
      )
    );

  if (!link) return null;

  // Mark as used
  await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(eq(magicLinks.id, link.id));

  return link;
}

export async function createSession(email: string) {
  // Get or create user
  let [user] = await db.select().from(users).where(eq(users.email, email));

  if (!user) {
    [user] = await db.insert(users).values({ email }).returning();
  }

  // Create session
  const token = nanoid(32);
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000
  );

  await db.insert(sessions).values({
    userId: user.id,
    token,
    expiresAt,
  });

  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  return user;
}

// Dev mode mock session for local development
const DEV_SESSION = {
  session: {
    id: "dev-session",
    userId: "dev-user",
    token: "dev-token",
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  },
  user: {
    id: "dev-user",
    email: "dev@localhost",
    createdAt: new Date(),
  },
};

export async function getSession() {
  // Bypass auth in development
  if (process.env.NODE_ENV === "development") {
    return DEV_SESSION;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) return null;

  const [session] = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())));

  return session ?? null;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
    cookieStore.delete(SESSION_COOKIE);
  }
}

export function isAdminEmail(email: string) {
  return email.toLowerCase() === process.env.ADMIN_EMAIL?.toLowerCase();
}
