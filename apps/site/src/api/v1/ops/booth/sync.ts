import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { conflict } from "@/api/registry/errors";
import { readBoothConfig } from "@/lib/booth/config";
import { drainOnce, syncStatus } from "@/lib/booth/sync";

const LastRunSchema = z.object({ at: z.string(), ok: z.boolean(), message: z.string() }).nullable();

export const boothSyncStatus = defineOperation({
  id: "booth_sync_status",
  summary: "Booth sync status",
  description: "Mode, how many booth rows are waiting for prod, and the outcome of the last drain.",
  tag: "booth",
  method: "GET",
  path: "/booth/sync/status",
  scope: "read:booth",
  agent: true,
  input: z.object({}),
  output: z.object({
    mode: z.enum(["booth", "prod"]),
    configured: z.boolean(),
    target: z.string().nullable(),
    intervalMs: z.number().int(),
    loopRunning: z.boolean(),
    total: z.number().int(),
    pending: z.number().int(),
    synced: z.number().int(),
    lastRun: LastRunSchema,
  }),
  handler() {
    return syncStatus();
  },
});

export const boothSyncDrain = defineOperation({
  id: "booth_sync_drain",
  summary: "Drain booth inquiries to prod now",
  description:
    "Pushes unsynced booth rows to BOOTH_PROD_API_URL right away instead of waiting for the next tick. " +
    "Only available in booth mode. Safe to repeat: prod dedupes on external_uuid.",
  tag: "booth",
  method: "POST",
  path: "/booth/sync/drain",
  scope: "write:booth",
  input: z.object({}),
  output: z.object({
    ok: z.boolean(),
    attempted: z.number().int(),
    inserted: z.number().int(),
    duplicates: z.number().int(),
    pending: z.number().int(),
    message: z.string(),
  }),
  async handler() {
    if (readBoothConfig().mode !== "booth") {
      throw conflict("This server is not in booth mode (SMILE_NOLA_MODE=booth), so it has nothing to drain.");
    }
    return drainOnce();
  },
});
