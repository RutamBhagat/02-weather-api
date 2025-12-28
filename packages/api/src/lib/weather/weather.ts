import { env } from "@02-weather-api/env/server";
import { TRPCError } from "@trpc/server";
import type { WeatherData } from "./types";
import axios from "axios";
import { AxiosError } from "axios";
import ms from "ms";

export async function fetchWeather(location: string): Promise<WeatherData> {
  const url = new URL(
    `${env.WEATHER_API_BASE_URL}/${encodeURIComponent(location)}`
  );
  url.searchParams.set("key", env.WEATHER_API_KEY);
  url.searchParams.set("unitGroup", "metric");
  url.searchParams.set("include", "current");

  try {
    const response = await axios.get<WeatherData>(url.toString(), {
      timeout: ms("10s"),
    });

    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.status === 400) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid location provided",
        });
      }
      if (error.response?.status === 401) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Weather API authentication failed",
        });
      }
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Weather API request failed",
      cause: error,
    });
  }
}
