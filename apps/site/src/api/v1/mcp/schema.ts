/**
 * An operation's Zod input as a JSON Schema object, for an MCP tool's
 * inputSchema. Reuses the OpenAPI generator the registry already depends on,
 * so there is no second Zod-to-schema library.
 */

import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
// Importing openapi.ts extends Zod with .openapi() once, as the generator needs.
import "../../registry/openapi";
import type { AnyOperation } from "../../registry/define";

type JsonSchema = Record<string, unknown>;
const cache = new WeakMap<AnyOperation, JsonSchema>();

export function toolInputSchema(op: AnyOperation): JsonSchema {
  const hit = cache.get(op);
  if (hit) return hit;
  const registry = new OpenAPIRegistry();
  registry.register("Input", op.input);
  const doc = new OpenApiGeneratorV31(registry.definitions).generateComponents() as {
    components?: { schemas?: Record<string, JsonSchema> };
  };
  const schema = { ...(doc.components?.schemas?.Input ?? {}) };
  // MCP requires an object schema at the top.
  if (schema.type !== "object") {
    schema.type = "object";
    schema.properties ??= {};
  }
  cache.set(op, schema);
  return schema;
}
