import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { db } from "@/lib/db";
import { isNepalMobile, normalizeNepalPhone } from "@/lib/phone";
import { createAuthMiddleware } from "better-auth/api";
import { notify } from "./notify";
import { LOGIN_PATHS, recordLoginAttempt } from "./login-events";

export const AUTH_COOKIE_PREFIX = "dabba";

function baseURL() {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3100";
}

const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;
if (!secret && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
  throw new Error("BETTER_AUTH_SECRET is required in production");
}

/**
 * Better Auth: email + password, Nepal mobile OTP (when an SMS provider is configured),
 * TOTP two-factor (required for staff by the staff2fa flag), DB sessions, DB rate limiting.
 */
export const auth = betterAuth({
  appName: "Dabba Bela",
  baseURL: baseURL(),
  secret: secret || "dev-only-insecure-secret-change-me-0123456789",
  trustedOrigins: [baseURL(), ...(process.env.AUTH_TRUSTED_ORIGINS?.split(",").filter(Boolean) ?? [])],
  database: prismaAdapter(db, { provider: "postgresql" }),
  advanced: {
    cookiePrefix: AUTH_COOKIE_PREFIX,
    database: { generateId: false },
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "CUSTOMER", required: false },
      isActive: { type: "boolean", input: false, defaultValue: true, required: false },
      locale: { type: "string", input: true, defaultValue: "en", required: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    async sendResetPassword({ user, url }) {
      await notify("auth.reset_password", { userId: user.id, email: user.email }, {}, { link: url, sendNow: true });
    },
  },
  rateLimit: {
    enabled: process.env.NODE_ENV === "production" || process.env.AUTH_RATE_LIMIT === "true",
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 6 },
      "/sign-up/email": { window: 300, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
      "/phone-number/send-otp": { window: 300, max: 3 },
      "/phone-number/verify": { window: 300, max: 6 },
      "/two-factor/verify-totp": { window: 60, max: 6 },
    },
  },
  hooks: {
    // Login activity (LoginEvent) for every sign-in attempt, success or failure.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path && LOGIN_PATHS[ctx.path]) await recordLoginAttempt(ctx as unknown as Parameters<typeof recordLoginAttempt>[0]);
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // Deactivated or deleted users cannot start sessions.
        async before(session) {
          const u = await db.user.findUnique({ where: { id: session.userId }, select: { isActive: true, deletedAt: true } });
          if (!u || !u.isActive || u.deletedAt) return false;
          await db.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
          return { data: session };
        },
      },
    },
  },
  plugins: [
    twoFactor({ issuer: "Dabba Bela" }),
    phoneNumber({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      phoneNumberValidator: (p) => isNepalMobile(p),
      async sendOTP({ phoneNumber: p, code }) {
        await notify("auth.otp", { phone: normalizeNepalPhone(p) ?? p }, { code }, { sendNow: true });
      },
      signUpOnVerification: {
        getTempEmail: (p) => `${p.replace(/\D/g, "")}@phone.dabbabela.local`,
        getTempName: () => "New member",
      },
    }),
    nextCookies(), // must be last
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
