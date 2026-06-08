import type { AppType } from "@gold-platform/api";
import { hc } from "hono/client";

export const client = hc<AppType>("http://localhost:3000");
