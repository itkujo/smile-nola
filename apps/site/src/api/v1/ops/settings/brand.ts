import { z } from "zod";
import { defineOperation } from "@/api/registry/define";

export const BRAND = {
  name: "Smile NOLA",
  tagline: "cinematic event production · new orleans",
} as const;

export const publicBrandGet = defineOperation({
  id: "public_brand_get",
  summary: "The brand",
  description: "The site's name and tagline. No token needed.",
  tag: "settings",
  method: "GET",
  path: "/public/brand",
  scope: null,
  agent: true,
  input: z.object({}),
  output: z.object({ name: z.string(), tagline: z.string() }),
  handler() {
    return { ...BRAND };
  },
});
