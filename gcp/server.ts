// Cloud Run entrypoint: serves the same single-file handler Vercel runs in
// production (api/index.ts, reached via the "/(.*)" → "/api" rewrite), with the
// few VercelRequest/VercelResponse helpers it uses: req.body, res.status, res.json.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import handler from "../api/index.ts";

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  if ((req.headers["content-type"] ?? "").includes("application/json")) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const vreq = Object.assign(req, { body: await readBody(req) });
  const vres = Object.assign(res, {
    status(code: number) { res.statusCode = code; return vres; },
    json(data: unknown) {
      if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
      return vres;
    },
  });
  try {
    await handler(vreq as never, vres as never);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) vres.status(500).json({ error: "internal_error" });
  }
}).listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
