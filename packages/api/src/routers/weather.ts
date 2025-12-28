import { TRPCError } from "@trpc/server";
import { z } from "zod";
import ms from "ms";

import { publicProcedure, router } from "../index";
import { getCached, setCached, getRedisClient, delCached } from "../lib/redis";
import { fetchWeather } from "../lib/weather/weather";
import type { WeatherData } from "../lib/weather/types";

const CACHE_TTL_SECONDS = ms("12h") / 1000; // 12 hours (ms returns milliseconds, Redis wants seconds)

function getCacheKey(location: string): string {
  return `weather:${location.toLowerCase().trim()}`;
}

async function checkRateLimit(identifier: string): Promise<void> {
  const client = getRedisClient();
  const key = `ratelimit:weather:${identifier}`;
  const limit = 100; // requests per hour
  const window = ms("1h") / 1000; // 1 hour in seconds

  try {
    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, window);
    }
    if (current > limit) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Rate limit exceeded. Try again later.",
      });
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    // If Redis fails, allow request (graceful degradation)
    console.error("Rate limit check failed:", error);
  }
}

export const weatherRouter = router({
  getCurrent: publicProcedure
    .input(z.object({ location: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const identifier = ctx.req?.header("x-forwarded-for") || "default";
      await checkRateLimit(identifier);

      const cacheKey = getCacheKey(input.location);

      const cached = await getCached<WeatherData>(cacheKey);

      if (cached) {
        return { ...cached, fromCache: true };
      }

      const weatherData = await fetchWeather(input.location);

      setCached(cacheKey, weatherData, CACHE_TTL_SECONDS);

      return { ...weatherData, fromCache: false };
    }),

  clearCache: publicProcedure
    .input(z.object({ location: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const cacheKey = getCacheKey(input.location);
        await delCached(cacheKey);
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to clear cache",
          cause: error,
        });
      }
    }),
});
