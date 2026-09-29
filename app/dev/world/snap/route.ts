import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Dev only: /dev/world's snapAt(name, true) posts its JPEG here and it lands in <os tmp>/world-snaps/<name>.jpg — so a
// screenshot session never has to carry the image through the browser tooling. Off unless NEXT_PUBLIC_APP_MODE=dev.

export async function POST(req: Request): Promise<Response> {
  if (process.env.NEXT_PUBLIC_APP_MODE !== "dev") return new Response("not found", { status: 404 });
  const { name, data } = (await req.json()) as { name?: unknown; data?: unknown };
  if (typeof name !== "string" || !/^[a-z0-9-]{1,40}$/.test(name) || typeof data !== "string" || !data.startsWith("data:image/jpeg;base64,")) {
    return new Response("bad request", { status: 400 });
  }
  const dir = path.join(tmpdir(), "world-snaps");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.jpg`);
  await writeFile(file, Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
  return Response.json({ file });
}
