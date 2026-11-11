const project = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const site = Deno.env.get("VIDEO_SITE_ORIGIN") || "https://anastasieste.github.io";
const signingSecret = Deno.env.get("VIDEO_SERVICE_SECRET") || "";
const driveApi = "https://www.googleapis.com/drive/v3/files";
const driveUpload = "https://www.googleapis.com/upload/drive/v3/files";
const chunkSize = 2 * 1024 * 1024;
const maxSize = 100 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const encoder = new TextEncoder();
const cors = {
  "Access-Control-Allow-Origin": site,
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-video-offset, range",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range",
  "Cache-Control": "no-store",
};

type Video = {
  id: string;
  author_id: string;
  title: string;
  bytes: number;
  drive_id: string;
  cover?: string | null;
  upload_url: string | null;
  created_at: string;
  status: "uploading" | "pending" | "approved" | "rejected" | "abandoned";
};
type DriveFile = { id: string; size?: string; mimeType?: string; parents?: string[]; trashed?: boolean };

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}
function configured(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new RequestError(503, "El servicio de video aún no está disponible.");
  return value;
}
function folders() {
  return {
    pending: configured("VIDEO_DRIVE_PENDING"),
    approved: configured("VIDEO_DRIVE_APPROVED"),
    rejected: configured("VIDEO_DRIVE_REJECTED"),
  };
}
async function database<T>(name: string, parameters: object): Promise<T> {
  const response = await fetch(project + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify(parameters),
  });
  if (!response.ok) throw new RequestError(503, "No se pudo guardar el estado del video.");
  return await response.json() as T;
}
function rpc<T>(operation: string, input: object = {}): Promise<T> {
  return database<T>("portal_video_service", { operation, input });
}
async function identify(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new RequestError(401, "Vuelve a iniciar sesión.");
  const response = await fetch(project + "/auth/v1/user", { headers: { apikey: serviceKey, Authorization: authorization } });
  if (!response.ok) throw new RequestError(response.status >= 500 ? 503 : 401, "No se pudo validar tu sesión.");
  const { id } = await response.json();
  if (!uuid.test(id)) throw new RequestError(401, "Vuelve a iniciar sesión.");
  return String(id);
}
async function requireMember(actor: string, admin = false) {
  if (!await rpc<boolean>(admin ? "can_review" : "eligible", { actor })) {
    throw new RequestError(403, admin ? "Se requiere una cuenta de administrador." : "Se requiere una membresía activa.");
  }
}
let cachedToken: { value: string; until: number } | undefined;
let requestingToken: Promise<string> | undefined;
async function driveToken() {
  if (cachedToken && cachedToken.until > Date.now()) return cachedToken.value;
  requestingToken ??= (async () => {
    const broker = configured("VIDEO_DRIVE_TOKEN_URL");
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[-\w]+\/exec$/.test(broker)) throw new Error("Invalid token endpoint");
    const response = await fetch(broker, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: configured("VIDEO_DRIVE_TOKEN_SECRET") }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json();
    if (!response.ok || typeof payload.token !== "string" || !payload.token) {
      throw new RequestError(503, "No se pudo conectar con el almacén de videos.");
    }
    cachedToken = { value: payload.token, until: Date.now() + 2 * 60 * 1000 };
    return payload.token as string;
  })().finally(() => { requestingToken = undefined; });
  return requestingToken;
}
async function drive(url: string, options: RequestInit = {}) {
  const token = await driveToken();
  const headers = new Headers(options.headers);
  headers.set("Authorization", "Bearer " + token);
  const response = await fetch(url, { ...options, headers, redirect: "manual" });
  if (response.status === 401) cachedToken = undefined;
  return response;
}
function driveError() {
  return new RequestError(502, "El almacén de videos no respondió. Intenta nuevamente.");
}
async function fileInfo(driveId: string): Promise<DriveFile | null> {
  const response = await drive(driveApi + "/" + encodeURIComponent(driveId) + "?fields=id,size,mimeType,parents,trashed");
  if (response.status === 404) return null;
  if (!response.ok) throw driveError();
  return await response.json();
}
async function availableInGallery(record: Video) {
  if (record.status !== "approved") return false;
  const info = await fileInfo(record.drive_id);
  return !!info && !info.trashed && info.mimeType === "video/mp4" && !!info.parents?.includes(folders().approved);
}
async function gallery() {
  const folder = folders().approved;
  if (!/^[-\w]+$/.test(folder)) throw driveError();
  const params = new URLSearchParams({
    q: `'${folder}' in parents and trashed = false and mimeType = 'video/mp4'`,
    fields: "nextPageToken,files(id)",
    pageSize: "1000",
  });
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) params.set("pageToken", pageToken);
    const response = await drive(driveApi + "?" + params);
    if (!response.ok) throw driveError();
    const page = await response.json() as { nextPageToken?: string; files: { id: string }[] };
    ids.push(...(page.files ?? []).map(file => file.id));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return json(ids.length ? await database("portal_video_gallery", { drive_ids: ids }) : []);
}
async function cover(record: Video) {
  if (!record.cover || !await availableInGallery(record)) throw new RequestError(404, "La carátula no está disponible.");
  const bytes = Uint8Array.from(atob(record.cover.slice("data:image/jpeg;base64,".length)), value => value.charCodeAt(0));
  return new Response(bytes, { headers: { ...cors, "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff" } });
}
function uploadOffset(response: Response) {
  const range = response.headers.get("Range");
  const last = range?.match(/^bytes=0-(\d+)$/)?.[1];
  return last === undefined ? 0 : Number(last) + 1;
}
async function beginUpload(request: Request, actor: string) {
  await requireMember(actor);
  const body = await request.json();
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : "";
  const bytes = body.bytes;
  if (!title || !Number.isInteger(bytes) || bytes < 1 || bytes > maxSize) {
    throw new RequestError(400, "El montaje debe tener un título y ocupar hasta 100 MB.");
  }
  const cover = body.cover ?? null;
  if (cover !== null && (typeof cover !== "string" || cover.length > 80023 ||
      !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(cover) ||
      (cover.length - "data:image/jpeg;base64,".length) % 4 !== 0)) {
    throw new RequestError(400, "La carátula no es válida.");
  }
  const pending = folders().pending;
  const generated = await drive(driveApi + "/generateIds?count=1&space=drive");
  if (!generated.ok) throw driveError();
  const { ids: [driveId] } = await generated.json();
  const response = await drive(driveUpload + "?uploadType=resumable&fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(bytes) },
    body: JSON.stringify({ id: driveId, name: title + ".mp4", mimeType: "video/mp4", parents: [pending] }),
  });
  const uploadUrl = response.headers.get("Location");
  if (!response.ok || !uploadUrl || !/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/.test(uploadUrl)) throw driveError();
  const record = await database<Video | { limit: true } | null>("portal_video_start_with_cover", {
    input: { actor, title, bytes, drive_id: driveId, upload_url: uploadUrl, cover },
  });
  if (record && "limit" in record) throw new RequestError(429, "Ya tienes cinco montajes en preparación o revisión.");
  if (!record) throw new RequestError(403, "Se requiere una membresía activa.");
  return json({ id: record.id, chunkSize }, 201);
}
async function ownUpload(id: string, actor: string) {
  const record = await rpc<Video | null>("get", { id });
  if (!record || record.author_id !== actor) throw new RequestError(404, "No se encontró este envío.");
  await requireMember(actor);
  return record;
}
async function submitVideo(record: Video, actor: string) {
  if (record.status === "pending") return json({ submitted: true, received: record.bytes });
  const info = await fileInfo(record.drive_id);
  if (!info || info.trashed || info.mimeType !== "video/mp4" || Number(info.size) !== record.bytes ||
      !info.parents?.includes(folders().pending)) throw driveError();
  const submitted = await rpc<Video | null>("submit", { id: record.id, actor });
  if (!submitted && (await rpc<Video | null>("get", { id: record.id }))?.status !== "pending") {
    throw new RequestError(409, "El envío cambió de estado. Actualiza la página.");
  }
  return json({ submitted: true, received: record.bytes });
}
async function transfer(request: Request, record: Video, actor: string) {
  if (record.status === "pending") return json({ submitted: true, received: record.bytes });
  if (record.status !== "uploading" || !record.upload_url) throw new RequestError(409, "Este envío ya terminó.");
  if (Date.parse(record.created_at) + 2 * 24 * 60 * 60 * 1000 <= Date.now()) {
    throw new RequestError(410, "El envío venció. Vuelve a iniciar la subida.");
  }
  if (request.method === "POST") {
    const response = await drive(record.upload_url, { method: "PUT", headers: { "Content-Range": "bytes */" + record.bytes } });
    if (response.status === 308) return json({ received: uploadOffset(response) });
    if (response.ok || (response.status === 404 && await fileInfo(record.drive_id))) return submitVideo(record, actor);
    if (response.status === 404) throw new RequestError(410, "El envío venció. Vuelve a iniciar la subida.");
    throw driveError();
  }
  const header = request.headers.get("x-video-offset");
  const offset = Number(header);
  if (!header || !Number.isInteger(offset) || offset < 0 || offset >= record.bytes || !request.body) {
    throw new RequestError(400, "Este fragmento no es válido.");
  }
  const length = Math.min(chunkSize, record.bytes - offset);
  const suppliedLength = request.headers.get("content-length");
  if (suppliedLength !== null && Number(suppliedLength) !== length) throw new RequestError(400, "El fragmento está incompleto.");
  const reader = request.body.getReader();
  const bytes = new Uint8Array(length);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > length) {
      await reader.cancel();
      throw new RequestError(400, "El fragmento es demasiado grande.");
    }
    bytes.set(value, size);
    size += value.length;
  }
  if (size !== length || (offset === 0 && new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp")) {
    throw new RequestError(400, "El fragmento está incompleto o el archivo no es un MP4.");
  }
  const response = await drive(record.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Range": `bytes ${offset}-${offset + length - 1}/${record.bytes}` },
    body: bytes,
  });
  if (response.status === 308) return json({ received: uploadOffset(response) });
  if (response.ok) return submitVideo(record, actor);
  throw driveError();
}

const toHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
async function signingKey() {
  if (signingSecret.length < 32) throw new RequestError(503, "El acceso al video aún no está disponible.");
  return await crypto.subtle.importKey("raw", encoder.encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function previewTicket(record: Video, actor: string) {
  if (record.status !== "pending") throw new RequestError(404, "Este video ya no está en revisión.");
  const expires = Math.floor(Date.now() / 1000) + 15 * 60;
  const stamp = actor + "." + expires;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(record.id + "." + stamp));
  return json({ ticket: stamp + "." + toHex(signature) });
}
async function validTicket(id: string, ticket: string) {
  const [actor, expires, signature, ...rest] = ticket.split(".");
  if (rest.length || !uuid.test(actor) || !/^\d{10}$/.test(expires) || Number(expires) < Date.now() / 1000 ||
      !/^[0-9a-f]{64}$/.test(signature)) return false;
  const bytes = Uint8Array.from(signature.match(/../g)!, value => parseInt(value, 16));
  return await crypto.subtle.verify("HMAC", await signingKey(), bytes, encoder.encode(id + "." + actor + "." + expires)) &&
    await rpc<boolean>("can_review", { actor });
}
async function play(request: Request, record: Video, ticket: string) {
  const available = record.status === "approved" ? await availableInGallery(record)
    : record.status === "pending" && ticket && await validTicket(record.id, ticket);
  if (!available) {
    throw new RequestError(404, "El video no está disponible.");
  }
  const range = request.headers.get("Range");
  if (range && !/^bytes=(?:\d{1,12}-\d{0,12}|-\d{1,12})$/.test(range)) {
    return new Response(null, { status: 416, headers: { ...cors, "Content-Range": "bytes */" + record.bytes } });
  }
  const response = await drive(driveApi + "/" + encodeURIComponent(record.drive_id) + "?alt=media", {
    method: "GET", headers: range ? { Range: range } : request.method === "HEAD" ? { Range: "bytes=0-0" } : {},
  });
  if (response.status === 416) return new Response(null, { status: 416, headers: { ...cors, "Content-Range": "bytes */" + record.bytes } });
  if (!response.ok) throw driveError();
  const headers = new Headers({ ...cors, "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" });
  for (const key of ["Content-Length", "Content-Range"]) {
    const value = response.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  if (request.method === "HEAD") {
    await response.body?.cancel();
    if (!range) {
      headers.delete("Content-Range");
      headers.set("Content-Length", String(record.bytes));
    }
    return new Response(null, { status: range ? response.status : 200, headers });
  }
  return new Response(response.body, { status: response.status, headers });
}
async function decide(request: Request, id: string, actor: string) {
  const { decision } = await request.json();
  if (decision !== "approved" && decision !== "rejected") throw new RequestError(400, "Selecciona una decisión válida.");
  const record = await rpc<Video | null>("claim", { id, actor, decision });
  if (!record) {
    if ((await rpc<Video | null>("get", { id }))?.status === decision) return json({ status: decision });
    throw new RequestError(409, "Otra decisión ya está en curso para este video.");
  }
  const destination = folders()[decision];
  const info = await fileInfo(record.drive_id);
  if (!info || info.trashed) throw driveError();
  if (!info.parents?.includes(destination)) {
    const params = new URLSearchParams({ addParents: destination, fields: "id,parents" });
    if (info.parents?.length) params.set("removeParents", info.parents.join(","));
    const response = await drive(driveApi + "/" + encodeURIComponent(record.drive_id) + "?" + params, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!response.ok && !(await fileInfo(record.drive_id))?.parents?.includes(destination)) throw driveError();
  }
  const completed = await rpc<Video | null>("decide", { id, decision });
  if (!completed && (await rpc<Video | null>("get", { id }))?.status !== decision) {
    throw new RequestError(409, "No se pudo confirmar la decisión. Intenta nuevamente.");
  }
  return json({ status: decision });
}
async function cleanup(request: Request) {
  const expected = configured("VIDEO_CLEANUP_SECRET");
  const incoming = request.headers.get("Authorization") || "";
  const key = await signingKey();
  const proof = await crypto.subtle.sign("HMAC", key, encoder.encode(incoming));
  if (!await crypto.subtle.verify("HMAC", key, proof, encoder.encode("Bearer " + expected))) {
    throw new RequestError(401, "Acceso denegado.");
  }
  const rows = await rpc<Pick<Video, "id" | "drive_id">[]>("expired");
  let deleted = 0;
  for (const record of rows) {
    const response = await drive(driveApi + "/" + encodeURIComponent(record.drive_id), { method: "DELETE" });
    if (response.status === 204 || response.status === 404) {
      await rpc("purged", { id: record.id });
      deleted++;
    }
  }
  return json({ deleted, remaining: rows.length - deleted });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  const [action, id, extra] = url.pathname.split("/member-video/").at(-1)!.split("/");
  try {
    if (action === "cleanup" && request.method === "POST") return await cleanup(request);
    if (action === "gallery" && !id && request.method === "GET") return await gallery();
    if (extra || (!["start", "access"].includes(action) && !uuid.test(id))) throw new RequestError(404, "Ruta no disponible.");
    if (action === "cover" && request.method === "GET") {
      const record = await rpc<Video | null>("get", { id });
      if (record) return await cover(record);
      throw new RequestError(404, "La carátula no está disponible.");
    }
    if (action === "play" && ["GET", "HEAD"].includes(request.method)) {
      const record = await rpc<Video | null>("get", { id });
      if (!record) throw new RequestError(404, "El video no está disponible.");
      return await play(request, record, url.searchParams.get("ticket") || "");
    }
    const actor = await identify(request);
    if (action === "access" && !id && request.method === "POST") return json({ allowed: await rpc<boolean>("eligible", { actor }) });
    if (action === "start" && !id && request.method === "POST") return await beginUpload(request, actor);
    if (action === "upload" && ["POST", "PUT"].includes(request.method)) return await transfer(request, await ownUpload(id, actor), actor);
    if (["preview", "decide"].includes(action) && request.method === "POST") {
      await requireMember(actor, true);
      if (action === "decide") return await decide(request, id, actor);
      const record = await rpc<Video | null>("get", { id });
      if (record) return await previewTicket(record, actor);
    }
    throw new RequestError(404, "Ruta no disponible.");
  } catch (error) {
    if (error instanceof RequestError) return json({ message: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ message: "La solicitud no es válida." }, 400);
    return json({ message: "No se pudo completar la operación de video. Intenta nuevamente." }, 502);
  }
});
