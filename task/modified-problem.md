Weather API (tRPC + Redis + Bun)

Build a backend-only weather API that fetches data from a third-party weather service and returns it via tRPC procedures. The goal is to learn Redis caching using Bun's native Redis client. There is no frontend; you will test everything with Postman.

Requirements

- Use tRPC for the API layer (procedures/routers only; no frontend).
- Use Redis for in-memory caching via Bun's Redis client.
- Use the existing Docker Compose setup for Redis.
- Cache responses by location key (e.g., city code) with an expiration (e.g., 12 hours).
- Store secrets and connection strings in environment variables (weather API key, Redis URL).
- Handle errors cleanly (invalid location, upstream API failure, Redis issues).
- Provide a minimal set of procedures usable from Postman (e.g., getWeather by city).

Notes

- Pick any third-party weather API (Visual Crossing is a free option).
- Start with a hardcoded response, then wire up the real API and caching.
- Focus on Redis fundamentals: get/set, TTL/expiry, cache hits/misses, and invalidation behavior.
- Rate limiting is optional; implement if you want extra practice.
