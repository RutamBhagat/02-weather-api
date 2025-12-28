Step-by-step detailed plan

[ ] Review existing repo structure and constraints

- Scan the workspace to locate the app entrypoint and any existing backend framework wiring.
- Confirm the Docker Compose file already includes Redis and note service name, port, and env.
- Identify where environment variables are defined or documented (e.g., .env.example).

[ ] Define API contract for Postman

- Choose a single tRPC router (e.g., weatherRouter) with a minimal set of procedures.
- Define input schema for getWeather (e.g., city or location code).
- Define response shape (raw upstream data or a trimmed, stable payload).

[ ] Configure environment variables

- Add/confirm WEATHER_API_KEY and REDIS_URL (and any base URL).
- Ensure Bun picks up REDIS_URL for the Redis client.

[ ] Set up Redis client utilities (Bun)

- Create a small Redis helper module using Bun’s native client.
- Provide get/set with TTL helpers and basic error handling.

[ ] Implement caching strategy

- Use a consistent cache key pattern (e.g., weather:<cityCode>).
- Cache successful responses with TTL (e.g., 12 hours).
- Decide how to handle cache misses and stale/invalid data.

[ ] Implement tRPC router

- Add a weather router with a getWeather procedure.
- Flow: validate input -> check Redis -> fetch upstream -> store in Redis -> return response.
- Return useful error codes/messages when upstream fails or input is invalid.

[ ] Integrate upstream weather API

- Implement a fetch wrapper with timeouts and error normalization.
- Map upstream response to the API response shape used by tRPC.

[ ] Wire up server entrypoint

- Ensure tRPC is mounted and reachable by Postman.
- Verify the server starts via Bun (no Node usage).

[ ] Document Postman usage

- Provide example requests and inputs.
- Include expected responses for cache hit/miss scenarios.

[ ] Sanity checks

- Run the server with Redis via Docker Compose.
- Validate cache hit/miss behavior and TTL expiry.
- Test error paths (invalid city, upstream down).

[ ] Optional enhancements

- Add rate limiting using Redis (if desired).
- Add basic logging for cache hits/misses.
