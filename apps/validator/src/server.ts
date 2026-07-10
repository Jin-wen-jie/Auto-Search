import Fastify from "fastify";
import { z } from "zod";
import { fetchPage } from "./fetch-page.js";
import { extractProduct } from "./extract-product.js";
import { PublicUrlError } from "./safe-url.js";
import { FetchError } from "./fetch-page.js";

const validateSchema = z.object({
  url: z.string().url(),
});

const SHARED_TOKEN = process.env.VALIDATOR_SHARED_TOKEN ?? "dev-token";

export async function buildServer() {
  const app = Fastify({ logger: true });

  // Health check
  app.get("/health", async () => ({ status: "ok" }));

  // Validate endpoint
  app.post("/validate", async (request, reply) => {
    // Auth check
    const auth = request.headers.authorization;
    if (!auth || auth !== `Bearer ${SHARED_TOKEN}`) {
      return reply.status(401).send({ error: "UNAUTHORIZED" });
    }

    const parsed = validateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "INVALID_REQUEST",
        details: parsed.error.issues,
      });
    }

    const { url } = parsed.data;

    try {
      const fetchResult = await fetchPage(url);
      const extraction = extractProduct(fetchResult.body, fetchResult.finalUrl);

      return {
        originalUrl: fetchResult.originalUrl,
        finalUrl: fetchResult.finalUrl,
        redirectChain: fetchResult.redirectChain,
        httpStatus: fetchResult.httpStatus,
        elapsedMs: fetchResult.elapsedMs,
        extraction,
      };
    } catch (err: unknown) {
      if (err instanceof PublicUrlError) {
        return reply.status(400).send({
          error: err.code,
          message: err.message,
        });
      }
      if (err instanceof FetchError) {
        const status =
          err.code === "TIMEOUT" || err.code === "TOTAL_TIMEOUT"
            ? 504
            : err.code === "TOO_LARGE"
            ? 413
            : 502;
        return reply.status(status).send({
          error: err.code,
          message: err.message,
        });
      }
      throw err;
    }
  });

  return app;
}

// Start server if this file is run directly
const isMain =
  process.argv[1]?.includes("server") || process.argv[1]?.endsWith("server.ts");
if (isMain) {
  const server = await buildServer();
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  await server.listen({ port, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`Validator listening on port ${port}`);
}
