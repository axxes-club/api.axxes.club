// Cloud Run entrypoint: serves the same single-file handler Vercel runs in
// production (api/index.ts, reached via the "/(.*)" → "/api" rewrite), with the
// few VercelRequest/VercelResponse helpers it uses: req.body, res.status, res.json.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import handler from "../api/index.ts";

class BodyError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function readBody(req: IncomingMessage): Promise<unknown> {
  const limit = 65536;
  const declared = req.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > limit)) throw new BodyError(413, "Body too large");
  const chunks: Buffer[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new BodyError(408, "Body timeout")); req.destroy?.(); }, 10000); });
  try {
    return await Promise.race([(async () => {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > limit) throw new BodyError(413, "Body too large");
        chunks.push(chunk as Buffer);
      }
      if (!chunks.length) return undefined;
      const raw = Buffer.concat(chunks).toString("utf8");
      if ((req.headers["content-type"] ?? "").includes("application/json")) {
        try { return JSON.parse(raw); } catch { throw new BodyError(400, "Invalid JSON"); }
      }
      return raw;
    })(), expired]);
  } finally { clearTimeout(timer); }
}

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const vreq = req;
  const vres = Object.assign(res, {
    status(code: number) { res.statusCode = code; return vres; },
    json(data: unknown) {
      if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
      return vres;
    },
  });
  try {
    Object.assign(vreq, { body: await readBody(req) });
    await handler(vreq, vres);
  } catch (err) {
    if (!res.headersSent) vres.status(err instanceof BodyError ? err.status : 500).json({ error: err instanceof BodyError ? err.message : "internal_error" });
  }
}).listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
