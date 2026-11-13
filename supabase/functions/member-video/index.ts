const project = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const site = Deno.env.get("VIDEO_SITE_ORIGIN") || "https://anastasieste.github.io";
const signingSecret = Deno.env.get("VIDEO_SERVICE_SECRET") || "";
const driveApi = "https://www.googleapis.com/drive/v3/files";
const driveUpload = "https://www.googleapis.com/upload/drive/v3/files";
const chunkSize = 2 * 1024 * 1024;
const maxSize = 100 * 1024 * 1024;
const photoMaxSize = 10 * 1024 * 1024;
const extensions = new Map([["video/mp4", ".mp4"], ["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
const outroName = "FinalVideoLogo.mp4";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const encoder = new TextEncoder();
const cors = {
  "Access-Control-Allow-Origin": site,
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-video-offset, range",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range",
  "Cache-Control": "no-store",
};

type Submission = {
  id: string;
  author_id: string;
  title: string;
  bytes: number;
  drive_id: string;
  mime_type: string;
  cover?: string | null;
  upload_url: string | null;
  created_at: string;
  status: "uploading" | "pending" | "approved" | "rejected" | "abandoned";
};
type DriveFile = { id: string; name?: string; size?: string; mimeType?: string; parents?: string[]; trashed?: boolean };

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
function folders(type = "video/mp4") {
  const prefix = type === "video/mp4" ? "VIDEO_DRIVE_" : "PHOTO_GALLERY_";
  return {
    pending: configured(prefix + "PENDING"),
    approved: configured(prefix + "APPROVED"),
    rejected: configured(prefix + "REJECTED"),
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
  return database<T>("portal_content_service", { operation, input });
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
function driveClient(urlKey: string, secretKey: string) {
  let cachedToken: { value: string; until: number } | undefined;
  let requestingToken: Promise<string> | undefined;
  async function token() {
    if (cachedToken && cachedToken.until > Date.now()) return cachedToken.value;
    requestingToken ??= (async () => {
      const broker = configured(urlKey);
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[-\w]+\/exec$/.test(broker)) throw new Error("Invalid token endpoint");
      const response = await fetch(broker, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: configured(secretKey) }),
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
  return async (url: string, options: RequestInit = {}) => {
    const access = await token();
    const headers = new Headers(options.headers);
    headers.set("Authorization", "Bearer " + access);
    const response = await fetch(url, { ...options, headers, redirect: "manual" });
    if (response.status === 401 && cachedToken?.value === access) cachedToken = undefined;
    return response;
  };
}
const drive = driveClient("VIDEO_DRIVE_TOKEN_URL", "VIDEO_DRIVE_TOKEN_SECRET");
const readDrive = driveClient("PHOTO_TOKEN_URL", "PHOTO_TOKEN_SECRET");
function driveError() {
  return new RequestError(502, "El almacén de videos no respondió. Intenta nuevamente.");
}
async function fileInfo(driveId: string): Promise<DriveFile | null> {
  const response = await drive(driveApi + "/" + encodeURIComponent(driveId) + "?fields=id,size,mimeType,parents,trashed");
  if (response.status === 404) return null;
  if (!response.ok) throw driveError();
  return await response.json();
}

async function outro(actor: string) {
  await requireMember(actor);
  const folder = configured("VIDEO_OUTRO_FOLDER");
  if (!/^[-\w]+$/.test(folder)) throw driveError();
  const params = new URLSearchParams({
    q: `'${folder}' in parents and trashed = false and name = '${outroName}' and mimeType = 'video/mp4'`,
    fields: "nextPageToken,files(id,name,size,mimeType,parents,trashed)",
    pageSize: "100",
  });
  let match: DriveFile | undefined;
  let pageToken: string | undefined;
  do {
    if (pageToken) params.set("pageToken", pageToken);
    const response = await readDrive(driveApi + "?" + params);
    if (!response.ok) throw driveError();
    const page = await response.json() as { nextPageToken?: string; files?: DriveFile[] };
    for (const file of page.files ?? []) {
      if (file.trashed || !file.parents?.includes(folder) || file.mimeType !== "video/mp4" || file.name !== outroName) continue;
      if (match) throw new RequestError(503, "Hay más de un FinalVideoLogo.mp4 en la carpeta del Editor.");
      match = file;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  const size = Number(match?.size);
  if (!match || !/^[-\w]+$/.test(match.id) || !Number.isSafeInteger(size) || size < 1 || size > maxSize) {
    throw new RequestError(503, "El video de cierre no está disponible. Intenta nuevamente.");
  }
  const response = await readDrive(driveApi + "/" + match.id + "?alt=media");
  if (!response.ok || !response.body) throw driveError();
  return new Response(response.body, { headers: { ...cors, "Content-Type": "video/mp4", "X-Content-Type-Options": "nosniff" } });
}
async function availableInGallery(record: Submission) {
  if (record.status !== "approved") return false;
  const info = await fileInfo(record.drive_id);
  return !!info && !info.trashed && info.mimeType === record.mime_type && !!info.parents?.includes(folders(record.mime_type).approved);
}
async function gallery(photos = false) {
  const folder = folders(photos ? "image/jpeg" : "video/mp4").approved;
  if (!/^[-\w]+$/.test(folder)) throw driveError();
  const params = new URLSearchParams({
    q: `'${folder}' in parents and trashed = false and ${photos ? "mimeType contains 'image/'" : "mimeType = 'video/mp4'"}`,
    fields: "nextPageToken,files(id)",
    pageSize: "1000",
  });
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) params.set("pageToken", pageToken);
    const response = await (photos ? readDrive : drive)(driveApi + "?" + params);
    if (!response.ok) throw driveError();
    const page = await response.json() as { nextPageToken?: string; files: { id: string }[] };
    ids.push(...(page.files ?? []).map(file => file.id));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return json(ids.length ? await database(photos ? "portal_photo_gallery" : "portal_video_gallery", { drive_ids: ids }) : []);
}
async function cover(record: Submission) {
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
  const mime = body.mime_type ?? "video/mp4";
  const isVideo = mime === "video/mp4";
  const extension = extensions.get(mime);
  if (!extension || !title || !Number.isInteger(bytes) || bytes < 1 || bytes > (isVideo ? maxSize : photoMaxSize)) {
    throw new RequestError(400, isVideo ? "El video debe tener un título y ocupar hasta 100 MB." : "La foto debe tener un título, ser JPG, PNG o WebP y ocupar hasta 10 MB.");
  }
  const cover = isVideo ? body.cover ?? null : null;
  if (cover !== null && (typeof cover !== "string" || cover.length > 80023 ||
      !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(cover) ||
      (cover.length - "data:image/jpeg;base64,".length) % 4 !== 0)) {
    throw new RequestError(400, "La carátula no es válida.");
  }
  const pending = folders(mime).pending;
  const generated = await drive(driveApi + "/generateIds?count=1&space=drive");
  if (!generated.ok) throw driveError();
  const { ids: [driveId] } = await generated.json();
  const response = await drive(driveUpload + "?uploadType=resumable&fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(bytes) },
    body: JSON.stringify({ id: driveId, name: title + extension, mimeType: mime, parents: [pending] }),
  });
  const uploadUrl = response.headers.get("Location");
  if (!response.ok || !uploadUrl || !/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/.test(uploadUrl)) throw driveError();
  const record = await database<Submission | { limit: true } | null>("portal_content_start", {
    input: { actor, title, bytes, drive_id: driveId, upload_url: uploadUrl, cover, mime_type: mime },
  });
  if (record && "limit" in record) throw new RequestError(429, "Ya tienes cinco envíos en preparación o revisión.");
  if (!record) throw new RequestError(403, "Se requiere una membresía activa.");
  return json({ id: record.id, chunkSize }, 201);
}
async function ownUpload(id: string, actor: string) {
  const record = await rpc<Submission | null>("get", { id });
  if (!record || record.author_id !== actor) throw new RequestError(404, "No se encontró este envío.");
  await requireMember(actor);
  return record;
}
async function submitContent(record: Submission, actor: string) {
  if (record.status === "pending") return json({ submitted: true, received: record.bytes });
  const info = await fileInfo(record.drive_id);
  if (!info || info.trashed || info.mimeType !== record.mime_type || Number(info.size) !== record.bytes ||
      !info.parents?.includes(folders(record.mime_type).pending)) throw driveError();
  const submitted = await rpc<Submission | null>("submit", { id: record.id, actor });
  if (!submitted && (await rpc<Submission | null>("get", { id: record.id }))?.status !== "pending") {
    throw new RequestError(409, "El envío cambió de estado. Actualiza la página.");
  }
  return json({ submitted: true, received: record.bytes });
}
function matchesType(bytes: Uint8Array, mime: string) {
  const chars = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  switch (mime) {
    case "video/mp4": return chars(4, 8) === "ftyp";
    case "image/jpeg": return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case "image/png": return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
    case "image/webp": return chars(0, 4) === "RIFF" && chars(8, 12) === "WEBP";
    default: return false;
  }
}
async function transfer(request: Request, record: Submission, actor: string) {
  if (record.status === "pending") return json({ submitted: true, received: record.bytes });
  if (record.status !== "uploading" || !record.upload_url) throw new RequestError(409, "Este envío ya terminó.");
  if (Date.parse(record.created_at) + 2 * 24 * 60 * 60 * 1000 <= Date.now()) {
    throw new RequestError(410, "El envío venció. Vuelve a iniciar la subida.");
  }
  if (request.method === "POST") {
    const response = await drive(record.upload_url, { method: "PUT", headers: { "Content-Range": "bytes */" + record.bytes } });
    if (response.status === 308) return json({ received: uploadOffset(response) });
    if (response.ok || (response.status === 404 && await fileInfo(record.drive_id))) return submitContent(record, actor);
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
  if (size !== length || (offset === 0 && !matchesType(bytes, record.mime_type))) {
    throw new RequestError(400, "El fragmento está incompleto o el formato del archivo no coincide.");
  }
  const response = await drive(record.upload_url, {
    method: "PUT",
    headers: { "Content-Type": record.mime_type, "Content-Range": `bytes ${offset}-${offset + length - 1}/${record.bytes}` },
    body: bytes,
  });
  if (response.status === 308) return json({ received: uploadOffset(response) });
  if (response.ok) return submitContent(record, actor);
  throw driveError();
}

const toHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
async function signingKey() {
  if (signingSecret.length < 32) throw new RequestError(503, "El acceso al video aún no está disponible.");
  return await crypto.subtle.importKey("raw", encoder.encode(signingSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function previewTicket(record: Submission, actor: string) {
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
async function play(request: Request, record: Submission, ticket: string) {
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
  const headers = new Headers({ ...cors, "Content-Type": record.mime_type, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" });
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
  const record = await rpc<Submission | null>("claim", { id, actor, decision });
  if (!record) {
    if ((await rpc<Submission | null>("get", { id }))?.status === decision) return json({ status: decision });
    throw new RequestError(409, "Otra decisión ya está en curso para este envío.");
  }
  const locations = folders(record.mime_type);
  const destination = locations[decision];
  const info = await fileInfo(record.drive_id);
  if (!info || info.trashed) throw driveError();
  if (!info.parents?.includes(destination)) {
    if (!info.parents?.includes(locations.pending)) throw new RequestError(409, "El archivo ya no está en su carpeta de revisión.");
    const params = new URLSearchParams({ addParents: destination, removeParents: locations.pending, fields: "id,parents" });
    const response = await drive(driveApi + "/" + encodeURIComponent(record.drive_id) + "?" + params, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!response.ok && !(await fileInfo(record.drive_id))?.parents?.includes(destination)) throw driveError();
  }
  const completed = await rpc<Submission | null>("decide", { id, decision });
  if (!completed && (await rpc<Submission | null>("get", { id }))?.status !== decision) {
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
  const rows = await rpc<Pick<Submission, "id" | "drive_id" | "mime_type" | "status">[]>("expired");
  let deleted = 0;
  for (const record of rows) {
    try {
      const locations = folders(record.mime_type);
      const expectedFolder = record.status === "rejected" ? locations.rejected : locations.pending;
      const info = await fileInfo(record.drive_id);
      if (info && !info.parents?.includes(expectedFolder)) continue;
      if (info) {
        const response = await drive(driveApi + "/" + encodeURIComponent(record.drive_id), { method: "DELETE" });
        if (response.status !== 204 && response.status !== 404) continue;
      }
      await rpc("purged", { id: record.id });
      deleted++;
    } catch { /* El siguiente ciclo puede reintentar este archivo. */ }
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
    if (action === "photos" && !id && request.method === "GET") return await gallery(true);
    if (extra || (!["start", "access", "outro"].includes(action) && !uuid.test(id))) throw new RequestError(404, "Ruta no disponible.");
    if (action === "cover" && request.method === "GET") {
      const record = await rpc<Submission | null>("get", { id });
      if (record) return await cover(record);
      throw new RequestError(404, "La carátula no está disponible.");
    }
    if (action === "play" && ["GET", "HEAD"].includes(request.method)) {
      const record = await rpc<Submission | null>("get", { id });
      if (!record) throw new RequestError(404, "El video no está disponible.");
      return await play(request, record, url.searchParams.get("ticket") || "");
    }
    const actor = await identify(request);
    if (action === "access" && !id && request.method === "POST") return json({ allowed: await rpc<boolean>("eligible", { actor }) });
    if (action === "outro" && !id && request.method === "GET") return await outro(actor);
    if (action === "start" && !id && request.method === "POST") return await beginUpload(request, actor);
    if (action === "upload" && ["POST", "PUT"].includes(request.method)) return await transfer(request, await ownUpload(id, actor), actor);
    if (["preview", "decide"].includes(action) && request.method === "POST") {
      await requireMember(actor, true);
      if (action === "decide") return await decide(request, id, actor);
      const record = await rpc<Submission | null>("get", { id });
      if (record) return await previewTicket(record, actor);
    }
    throw new RequestError(404, "Ruta no disponible.");
  } catch (error) {
    if (error instanceof RequestError) return json({ message: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ message: "La solicitud no es válida." }, 400);
    return json({ message: "No se pudo completar la operación de video. Intenta nuevamente." }, 502);
  }
});
