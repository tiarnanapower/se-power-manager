import { getImage } from "@/lib/samples/library";
import { isAuthorizedForStore } from "@/lib/session/is-authorized-for-store";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

// Serves a sample's picture from the samples repo. The repo can be private, so the bytes are proxied
// to signed-in stores only, and cached hard: file names are content hashes and never change.
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const store = new URL(request.url).searchParams.get("s") || undefined;

  if (store && !/^[a-z0-9]{3,20}$/i.test(store)) return new Response("Not found", { status: 404 });
  if (!(await isAuthorizedForStore(store))) return new Response("Not authorised", { status: 403 });

  try {
    const bytes = await getImage(file);

    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
