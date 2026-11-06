import { getAppDataStore } from "@/lib/app-data/get-app-data-store";
import { getUpload } from "@/lib/enrich/queue";
import { isAuthorizedForStore } from "@/lib/session/is-authorized-for-store";

// Serves an uploaded packshot back to the review screen. The files are private
// and short-lived, so the bytes are proxied rather than exposed by URL.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const storeParam = params.get("s") || undefined;
  const key = params.get("key") ?? "";

  if (storeParam && !/^[a-z0-9]{3,20}$/i.test(storeParam)) return new Response("Not found", { status: 404 });
  if (!(await isAuthorizedForStore(storeParam))) return new Response("Not authorised", { status: 403 });

  try {
    const { buffer, mime } = await getUpload({ data: getAppDataStore(), storeHash: storeParam ?? process.env.STATIC_STORE_HASH ?? "static" }, key);

    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": mime.startsWith("image/") ? mime : "application/octet-stream", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
