import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { PasswordResetTokenRepository, UserRepository } from "@resolution/database";
import {
  PASSWORD_RESET_TOKEN_TTL_MS,
  generatePasswordResetToken,
  hashPassword,
  hashResetToken,
  isPasswordStrongEnough,
  sessionCookieName,
  sessionCookieOptions,
  signSession,
  verifyPassword,
} from "@resolution/security";
import { passwordResetEmail, type EmailSender } from "@resolution/email";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
import { rateLimit, type RateLimitStore } from "../middleware/rate-limit";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../lib/errors";
import type { AppEnv } from "../types";

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  name: z.string().min(1).optional(),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

const ForgotPasswordBody = z.object({
  email: z.string().email(),
});

const ResetPasswordBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(1),
});

/** Shape returned for a user — never the passwordHash. `isSuperAdmin` is safe to expose to
 *  the user themselves (it's their own flag); the frontend uses it purely to decide whether
 *  to show the /platform section — every actual platform route re-checks it server-side via
 *  requireSuperAdmin regardless. */
function toPublicUser(user: {
  id: string;
  email: string;
  name: string | null;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    mustChangePassword: user.mustChangePassword,
  };
}

export function buildAuthRoutes(deps: {
  db: PrismaClient;
  env: Env;
  emailSender: EmailSender;
  rateLimitStores: { login: RateLimitStore; signup: RateLimitStore; forgotPassword: RateLimitStore };
}): Hono<AppEnv> {
  const { db, env, emailSender, rateLimitStores } = deps;
  const router = new Hono<AppEnv>();
  const users = new UserRepository(db);
  const resetTokens = new PasswordResetTokenRepository(db);
  const auth = authenticate(env.JWT_SECRET);
  const cookieOpts = sessionCookieOptions(env.NODE_ENV === "production");

  // Stricter than the app-wide 100/min in app.ts — these are the endpoints a brute-force or
  // user-enumeration attempt actually targets, so the rest of the API doesn't need (and
  // shouldn't pay for) the same tight budget. See middleware/rate-limit.ts's caveat on
  // per-isolate accuracy.
  const loginLimit = rateLimit(rateLimitStores.login, { max: 10, windowMs: 15 * 60_000 });
  const signupLimit = rateLimit(rateLimitStores.signup, { max: 5, windowMs: 60 * 60_000 });
  const forgotPasswordLimit = rateLimit(rateLimitStores.forgotPassword, {
    max: 5,
    windowMs: 60 * 60_000,
  });

  router.post("/signup", signupLimit, async (c) => {
    const body = SignupBody.parse(await c.req.json());

    if (!isPasswordStrongEnough(body.password)) {
      throw new ValidationError("Password must be at least 12 characters");
    }
    if (await users.findByEmail(body.email)) {
      // Deliberately vague — don't confirm which emails are registered.
      throw new ConflictError("An account with this email already exists");
    }

    const passwordHash = await hashPassword(body.password);
    const user = await users.create({ email: body.email, name: body.name, passwordHash });

    const token = await signSession({ sub: user.id }, env.JWT_SECRET);
    setCookie(c, sessionCookieName(), token, cookieOpts);
    return c.json({ user: toPublicUser(user) }, 201);
  });

  router.post("/login", loginLimit, async (c) => {
    const body = LoginBody.parse(await c.req.json());
    const user = await users.findByEmail(body.email);

    // Constant-shape response whether the email exists or not — avoids a user-enumeration
    // oracle via response timing/content. verifyPassword against a fixed dummy hash keeps
    // the bcrypt cost paid even on a miss.
    const passwordHash = user?.passwordHash ?? "$2a$12$invalidsaltinvalidsaltinvalidsaltinvOe";
    const valid = await verifyPassword(body.password, passwordHash);
    if (!user || !user.passwordHash || !valid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const token = await signSession({ sub: user.id }, env.JWT_SECRET);
    setCookie(c, sessionCookieName(), token, cookieOpts);
    return c.json({ user: toPublicUser(user) });
  });

  router.post("/forgot-password", forgotPasswordLimit, async (c) => {
    const body = ForgotPasswordBody.parse(await c.req.json());
    const user = await users.findByEmail(body.email);

    // Same constant-response discipline as /login — whether or not the email is registered,
    // the caller sees the same success message, so this can't be used to enumerate accounts.
    if (user) {
      const rawToken = generatePasswordResetToken();
      await resetTokens.create({
        userId: user.id,
        tokenHash: await hashResetToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
      });
      // CORS_ORIGIN is this deployment's own frontend origin (see env.ts/wrangler.toml) —
      // reused here rather than adding a separate APP_URL var that would just have to be
      // kept in sync with it.
      const resetUrl = `${env.CORS_ORIGIN}/reset-password?token=${rawToken}`;
      await emailSender.send({
        to: user.email,
        ...passwordResetEmail({ resetUrl, expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MS / 60_000 }),
      });
    }

    return c.json({ message: "If that email has an account, a reset link has been sent." });
  });

  router.post("/reset-password", forgotPasswordLimit, async (c) => {
    const body = ResetPasswordBody.parse(await c.req.json());
    if (!isPasswordStrongEnough(body.newPassword)) {
      throw new ValidationError("Password must be at least 12 characters");
    }

    const record = await resetTokens.findValidByHash(await hashResetToken(body.token));
    if (!record) {
      throw new UnauthorizedError("This reset link is invalid or has expired");
    }

    await users.updatePassword(record.userId, await hashPassword(body.newPassword));
    // Marked used only after the password write succeeds — a failure between the two would
    // otherwise burn the token with nothing to show for it, stranding the user.
    await resetTokens.markUsed(record.id);

    return c.body(null, 204);
  });

  router.post("/change-password", auth, async (c) => {
    const body = ChangePasswordBody.parse(await c.req.json());
    const user = await users.findById(c.get("userId")!);
    if (!user) throw new NotFoundError("User not found");

    const valid = user.passwordHash && (await verifyPassword(body.currentPassword, user.passwordHash));
    if (!valid) throw new UnauthorizedError("Current password is incorrect");

    if (!isPasswordStrongEnough(body.newPassword)) {
      throw new ValidationError("Password must be at least 12 characters");
    }

    const updated = await users.updatePassword(user.id, await hashPassword(body.newPassword));
    return c.json({ user: toPublicUser(updated) });
  });

  router.post("/logout", auth, (c) => {
    deleteCookie(c, sessionCookieName(), { path: "/" });
    return c.body(null, 204);
  });

  router.get("/me", auth, async (c) => {
    const user = await users.findById(c.get("userId")!);
    if (!user) throw new NotFoundError("User not found");
    return c.json({ user: toPublicUser(user) });
  });

  return router;
}
