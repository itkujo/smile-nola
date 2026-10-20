import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { effectiveScopes } from "@/api/registry/auth";
import { ANY, SCOPE_NAMES } from "@/api/registry/scopes";
import { getToken } from "@/api/registry/tokens";

export const meGet = defineOperation({
  id: "me_get",
  summary: "Who am I",
  description:
    "How this request is signed in (the admin session, or a token) and the scopes it holds.",
  tag: "me",
  method: "GET",
  path: "/me",
  scope: ANY,
  agent: true,
  input: z.object({}),
  output: z.object({
    via: z.enum(["session", "token"]),
    scopes: z.array(z.string()),
    token: z
      .object({
        id: z.number().int(),
        label: z.string(),
        expiresAt: z.string().nullable(),
        createdAt: z.string(),
      })
      .nullable(),
  }),
  handler({ auth }) {
    const scopes = effectiveScopes(auth, SCOPE_NAMES);
    if (auth.kind === "token") {
      const t = getToken(auth.tokenId);
      return {
        via: "token" as const,
        scopes,
        token: t
          ? { id: t.id, label: t.label, expiresAt: t.expiresAt, createdAt: t.createdAt }
          : null,
      };
    }
    return { via: "session" as const, scopes, token: null };
  },
});
