import { z } from "zod";
import { defineOperation } from "@/api/registry/define";
import { API_PREFIX } from "@/api/registry/router";
import { generateOpenApi, publicOrigin } from "@/api/registry/openapi";

export const openapiGet = defineOperation({
  id: "openapi_get",
  summary: "This API, as OpenAPI 3.1",
  description: "Generated from the same definitions the server runs. No token needed.",
  tag: "meta",
  method: "GET",
  path: "/openapi.json",
  scope: null,
  input: z.object({}),
  output: z.record(z.unknown()),
  async handler({ request }) {
    // Imported lazily: the registry index imports this file.
    const { getOperations } = await import("@/api/registry/index");
    return generateOpenApi(getOperations(), { serverUrl: publicOrigin(request) + API_PREFIX });
  },
});
