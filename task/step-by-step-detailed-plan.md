# Weather API Implementation Plan

Build tRPC weather API with Redis caching using Bun runtime.

## Overview
- Fetch weather from Visual Crossing API
- Cache in Redis with 12hr TTL
- Test with Postman (no frontend)
- Follow existing tRPC patterns from todo router

---

## Step 1: Infrastructure - Add Redis to Docker

**File:** `packages/db/docker-compose.yml`

Add Redis service:
```yaml
redis:
  image: redis:7-alpine
  container_name: 02-weather-api-redis
  ports:
    - "6379:6379"
  volumes:
    - 02-weather-api_redis_data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 3s
    retries: 5
  restart: unless-stopped
```

Add volume:
```yaml
volumes:
  02-weather-api_redis_data:
```

Restart containers:
```bash
bun run db:down
bun run db:start
```

---

## Step 2: Install Dependencies

```bash
cd packages/api
bun add ioredis ms
bun add @types/ioredis @types/ms -D
```

Using ioredis (not Bun.redis) for better stability with external Redis.
Using ms for readable time duration handling.

---

## Step 3: Environment Variables

**File:** `apps/server/.env.example`

Add:
```env
REDIS_URL=redis://localhost:6379
WEATHER_API_KEY=
WEATHER_API_BASE_URL=https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline
```

**File:** `packages/env/src/server.ts`

Update server schema (after line 11):
```typescript
REDIS_URL: z.string().url(),
WEATHER_API_KEY: z.string().min(1),
WEATHER_API_BASE_URL: z.string().url(),
```

Create `apps/server/.env` with actual values (get free API key from visualcrossing.com).

---

## Step 4: Redis Client Utility

**Create:** `packages/api/src/lib/redis.ts`

```typescript
import { env } from "@02-weather-api/env/server";
import Redis from "ioredis";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 100, 2000);
      },
    });

    redisClient.on("error", (err) => {
      console.error("Redis connection error:", err);
    });
  }
  return redisClient;
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient();
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Redis GET error:", error);
    return null; // Graceful degradation
  }
}

export async function setCached(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    const client = getRedisClient();
    await client.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    console.error("Redis SET error:", error);
  }
}
```

**Pattern:** Singleton with graceful error handling (never throw from cache ops).

---

## Step 5: Weather Service

**Create:** `packages/api/src/lib/weather.ts`

```typescript
import { env } from "@02-weather-api/env/server";
import { TRPCError } from "@trpc/server";

export type WeatherData = {
  location: string;
  temperature: number;
  conditions: string;
  humidity: number;
  windSpeed: number;
  description: string;
  queryCost: number;
  latitude: number;
  longitude: number;
};

export async function fetchWeather(location: string): Promise<WeatherData> {
  const url = `${env.WEATHER_API_BASE_URL}/${encodeURIComponent(location)}?key=${env.WEATHER_API_KEY}&unitGroup=metric&include=current`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      if (response.status === 400) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid location provided",
        });
      }
      if (response.status === 401) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Weather API authentication failed",
        });
      }
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Weather API request failed",
      });
    }

    const data = await response.json();
    const current = data.currentConditions;

    return {
      location: data.resolvedAddress,
      temperature: current.temp,
      conditions: current.conditions,
      humidity: current.humidity,
      windSpeed: current.windspeed,
      description: data.description,
      queryCost: data.queryCost,
      latitude: data.latitude,
      longitude: data.longitude,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to fetch weather data",
      cause: error,
    });
  }
}
```

**Pattern:** Follow todo.ts error handling (TRPCError with codes).

---

## Step 6: Weather tRPC Router

**Create:** `packages/api/src/routers/weather.ts`

```typescript
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import ms from "ms";

import { publicProcedure, router } from "../index";
import { getCached, setCached, getRedisClient } from "../lib/redis";
import { fetchWeather } from "../lib/weather";

const CACHE_TTL_SECONDS = ms("12h") / 1000; // 12 hours (ms returns milliseconds, Redis wants seconds)

function getCacheKey(location: string): string {
  return `weather:${location.toLowerCase().trim()}`;
}

// Rate limiting helper
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
    .input(
      z.object({
        location: z.string().min(1, "Location is required"),
      }),
    )
    .query(async ({ input, ctx }) => {
      // Rate limiting (using IP or session-based identifier)
      const identifier = ctx.req?.headers.get("x-forwarded-for") || "default";
      await checkRateLimit(identifier);

      const cacheKey = getCacheKey(input.location);

      // Check cache
      const cached = await getCached<ReturnType<typeof fetchWeather>>(cacheKey);
      if (cached) {
        return { ...cached, fromCache: true };
      }

      // Cache miss - fetch from API
      const weatherData = await fetchWeather(input.location);

      // Store in cache
      setCached(cacheKey, weatherData, CACHE_TTL_SECONDS);

      return { ...weatherData, fromCache: false };
    }),

  clearCache: publicProcedure
    .input(z.object({ location: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const client = getRedisClient();
        const cacheKey = getCacheKey(input.location);
        await client.del(cacheKey);
        return { success: true, message: "Cache cleared" };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to clear cache",
        });
      }
    }),
});
```

**Rate limiting:**
- 100 requests per hour per IP
- Uses Redis INCR with TTL
- Key format: `ratelimit:weather:{ip}`
- Graceful degradation if Redis fails
- Returns TOO_MANY_REQUESTS error when exceeded

**Pattern:** Follow todo.ts structure (publicProcedure, input validation, queries/mutations).

---

## Step 7: Wire into App Router

**File:** `packages/api/src/routers/index.ts`

Add import:
```typescript
import { weatherRouter } from "./weather";
```

Add to router (line 14):
```typescript
export const appRouter = router({
  healthCheck: publicProcedure.query(() => "OK"),
  privateData: protectedProcedure.query(({ ctx }) => ({
    message: "This is private",
    user: ctx.session.user,
  })),
  todo: todoRouter,
  weather: weatherRouter, // Add this
});
```

---

## Step 8: Testing with Postman

**Start server:**
```bash
bun run dev
```

**Endpoints:**

1. **Get weather (cache miss):**
   ```
   GET http://localhost:3000/trpc/weather.getCurrent?input={"location":"London"}
   ```
   Response includes `fromCache: false`

2. **Get weather again (cache hit):**
   ```
   GET http://localhost:3000/trpc/weather.getCurrent?input={"location":"London"}
   ```
   Response includes `fromCache: true`

3. **Clear cache:**
   ```
   POST http://localhost:3000/trpc/weather.clearCache
   Body: {"location":"London"}
   ```

4. **Test error (invalid location):**
   ```
   GET http://localhost:3000/trpc/weather.getCurrent?input={"location":"InvalidCity12345"}
   ```
   Expect 400 error

**Verify Redis:**
```bash
docker exec -it 02-weather-api-redis redis-cli
> KEYS weather:*
> TTL weather:london
> GET weather:london
```

---

## Critical Files

**Create:**
- `packages/api/src/lib/redis.ts` - Redis client + helpers
- `packages/api/src/lib/weather.ts` - Weather service
- `packages/api/src/routers/weather.ts` - tRPC router

**Modify:**
- `packages/db/docker-compose.yml` - Add Redis service
- `packages/env/src/server.ts` - Add env validation
- `packages/api/src/routers/index.ts` - Wire weather router
- `apps/server/.env.example` - Document new env vars
- `apps/server/.env` - Set actual values (API key)

---

## Error Handling Strategy

**Redis failures:**
- Never throw from getCached/setCached
- Log errors, return null
- API works without cache (graceful degradation)

**Weather API failures:**
- 400 → TRPCError BAD_REQUEST (invalid location)
- 401 → TRPCError INTERNAL_SERVER_ERROR (auth issue)
- Timeout (10s) → TRPCError INTERNAL_SERVER_ERROR
- Network errors → Wrapped in TRPCError

**Cache strategy:**
- Key format: `weather:{normalized_location}` (lowercase, trimmed)
- TTL: 12 hours (using ms('12h') / 1000)
- Fire-and-forget cache writes (don't await setCached)

---

## Implementation Order

1. Infrastructure: Redis docker-compose, restart
2. Dependencies: Install ioredis
3. Config: Env vars + validation
4. Redis client: Create redis.ts
5. Weather service: Create weather.ts
6. Router: Create weather.ts router
7. Integration: Wire into index.ts
8. Testing: Setup .env, test with Postman
