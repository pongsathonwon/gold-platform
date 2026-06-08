import type { AppType } from "@gold-platform/api";
import { hc } from "hono/client";

export const client = hc<AppType>(import.meta.env.VITE_API_URL);
