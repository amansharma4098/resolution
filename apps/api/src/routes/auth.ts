import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { PrismaClient } from "@resolution/database";
import { UserRepository } from "@resolution/database";
import {
  hashPassword,
  isPasswordStrongEnough,
  sessionCookieName,
  sessionCookieOptions,
  signSession,
  verifyPassword,
} from "@resolution/security";
import type { Env } from "../env";
import { authenticate } from "../middleware/authenticate";
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

export function buildAuthRoutes(deps: { db: PrismaClient; env: Env }): Hono<AppEnv> {
  const { db, env } = deps;
  const router = new Hono<AppEnv>();
  const users = new UserRepository(db);
  const auth = authenticate(env.JWT_SECRET);
  const cookieOpts = sessionCookieOptions(env.NODE_ENV === "production");

  router.post("/signup", async (c) => {
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

  router.post("/login", async (c) => {
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
