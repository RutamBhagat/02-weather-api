import { env } from "@02-weather-api/env/server";
import Redis from "ioredis";

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return times * 100;
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
    return data ? (JSON.parse(data as string) as T) : null;
  } catch (error) {
    console.error("Redis GET error:", error);
    return null;
  }
}

export async function setCached(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const client = getRedisClient();
    await client.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (error) {
    console.error("Redis SET error:", error);
  }
}

export async function delCached(key: string): Promise<void> {
  try {
    const client = getRedisClient();
    await client.del(key);
  } catch (error) {
    console.error("Redis DEL error:", error);
  }
}
