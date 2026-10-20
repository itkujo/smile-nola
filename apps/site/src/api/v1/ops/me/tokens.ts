import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { badRequest, conflict, notFound } from "@/api/registry/errors";
import { PagingInput, pageOf, paginate } from "@/api/registry/paging";
import { isKnownScope } from "@/api/registry/scopes";
import { createToken, getToken, listTokens, revokeToken } from "@/api/registry/tokens";

export const TokenSchema = z.object({
  id: z.number().int(),
  label: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const tokensList = defineOperation({
  id: "tokens_list",
  summary: "My access tokens",
  description: "Every token, newest first, including revoked ones. Never the token itself.",
  tag: "me",
  method: "GET",
  path: "/me/tokens",
  scope: "admin",
  input: PagingInput,
  output: pageOf(TokenSchema),
  handler({ input }) {
    return paginate(input, {
      cursor: z.number().int().positive(),
      fetch: (beforeId, take) => listTokens({ take, beforeId }),
      cursorOf: (t) => t.id,
    });
  },
});

export const tokensCreate = defineOperation({
  id: "tokens_create",
  summary: "Make an access token",
  description:
    "The answer carries the token (sn_...) once. Only its hash is kept, so copy it now.",
  tag: "me",
  method: "POST",
  path: "/me/tokens",
  scope: "admin",
  successStatus: 201,
  input: z.object({
    label: z.string().trim().min(1, "is required").max(80, "must be 80 characters or fewer"),
    scopes: z
      .array(z.string().refine(isKnownScope, (s) => ({ message: `unknown scope "${s}"` })))
      .min(1, "pick at least one scope"),
    expiresAt: z
      .string()
      .datetime({ offset: true, message: "must be an ISO 8601 date-time" })
      .nullable()
      .optional(),
  }),
  output: TokenSchema.extend({ token: z.string() }),
  handler({ input }) {
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
      throw badRequest("expiresAt: must be in the future");
    }
    const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;
    const { token, record } = createToken({ label: input.label, scopes: input.scopes, expiresAt });
    return { ...record, token };
  },
});

export const tokensRevoke = defineOperation({
  id: "tokens_revoke",
  summary: "Revoke one of my tokens",
  description: "It stops working at once. Revoking is permanent.",
  tag: "me",
  method: "DELETE",
  path: "/me/tokens/{id}",
  scope: "admin",
  input: z.object({ id: z.coerce.number().int("must be a whole number").positive("must be positive") }),
  output: TokenSchema,
  handler({ input }) {
    const result = revokeToken(input.id);
    if (result === "missing") throw notFound(`No token with id ${input.id}.`);
    if (result === "already_revoked") throw conflict(`Token ${input.id} is already revoked.`);
    const record = getToken(input.id);
    if (!record) throw notFound(`No token with id ${input.id}.`);
    return record;
  },
});
