import type { Context as HonoContext } from "hono";

import { auth } from "@02-weather-api/auth";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  return {
    session,
    req: context.req,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
