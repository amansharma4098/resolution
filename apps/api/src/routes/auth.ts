import type { FastifyInstance } from "fastify";
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

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  name: z.string().min(1).optional(),
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Shape returned for a user — never the passwordHash. */
function toPublicUser(user: { id: string; email: string; name: string | null }) {
  return { id: user.id, email: user.email, name: user.name };
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { db: PrismaClient; env: Env },
): void {
  const { db, env } = deps;
  const users = new UserRepository(db);
  const auth = authenticate(env.JWT_SECRET);
  const cookieOpts = sessionCookieOptions(env.NODE_ENV === "production");

  app.post("/signup", async (request, reply) => {
    const body = SignupBody.parse(request.body);

    if (!isPasswordStrongEnough(body.password)) {
      throw new ValidationError("Password must be at least 12 characters");
    }
    if (await users.findByEmail(body.email)) {
      // Deliberately vague — don't confirm which emails are registered.
      throw new ConflictError("An account with this email already exists");
    }

    const passwordHash = await hashPassword(body.password);
    const user = await users.create({ email: body.email, name: body.name, passwordHash });

    const token = signSession({ sub: user.id }, env.JWT_SECRET);
    reply.setCookie(sessionCookieName(), token, cookieOpts);
    reply.status(201).send({ user: toPublicUser(user) });
  });

  app.post("/login", async (request, reply) => {
    const body = LoginBody.parse(request.body);
    const user = await users.findByEmail(body.email);

    // Constant-shape response whether the email exists or not — avoids a user-enumeration
    // oracle via response timing/content. verifyPassword against a fixed dummy hash keeps
    // the bcrypt cost paid even on a miss.
    const passwordHash = user?.passwordHash ?? "$2a$12$invalidsaltinvalidsaltinvalidsaltinvOe";
    const valid = await verifyPassword(body.password, passwordHash);
    if (!user || !user.passwordHash || !valid) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const token = signSession({ sub: user.id }, env.JWT_SECRET);
    reply.setCookie(sessionCookieName(), token, cookieOpts);
    reply.send({ user: toPublicUser(user) });
  });

  app.post("/logout", { preHandler: auth }, async (request, reply) => {
    reply.clearCookie(sessionCookieName(), { path: "/" });
    reply.status(204).send();
  });

  app.get("/me", { preHandler: auth }, async (request, reply) => {
    const user = await users.findById(request.userId!);
    if (!user) throw new NotFoundError("User not found");
    reply.send({ user: toPublicUser(user) });
  });
}
