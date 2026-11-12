const drive = 'https://www.googleapis.com/drive/v3/files';
const validId = /^[\w-]{10,128}$/;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp']);
const headers = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

type DrivePhoto = {
  id: string;
  mimeType: string;
  modifiedTime: string;
  parents?: string[];
  trashed?: boolean;
  imageMediaMetadata?: { width: number; height: number };
};
type Photo = { id: string; version: string; width?: number; height?: number };
type PhotoFolders = { carousel: string; about: string };
let driveToken: { value: string; expires: number } | undefined;

async function accessToken() {
  if (driveToken && Date.now() < driveToken.expires) return driveToken.value;
  const endpoint = Deno.env.get('PHOTO_TOKEN_URL');
  const secret = Deno.env.get('PHOTO_TOKEN_SECRET');
  if (!endpoint || !secret) throw new Error('Photo token provider is missing');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Photo token request failed');
  const { token } = await response.json();
  if (typeof token !== 'string' || !token) throw new Error('Photo token unavailable');
  driveToken = { value: token, expires: Date.now() + 120000 };
  return token;
}

async function driveRequest(url: string) {
  const send = async () => fetch(url, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(15000),
  });
  const response = await send();
  if (response.status !== 401) return response;
  await response.body?.cancel();
  driveToken = undefined;
  return send();
}

function json(body: object, status = 200) {
  return Response.json(body, { status, headers });
}

async function listPhotos(folders: PhotoFolders) {
  const query = new URLSearchParams({
    q: `('${folders.carousel}' in parents or '${folders.about}' in parents) and trashed = false and mimeType contains 'image/'`,
    fields: 'nextPageToken,files(id,mimeType,modifiedTime,parents,imageMediaMetadata(width,height))',
    pageSize: '1000',
    orderBy: 'name_natural',
  });
  const photos: { carousel: Photo[]; about: Photo[] } = { carousel: [], about: [] };
  let pageToken = '';
  do {
    if (pageToken) query.set('pageToken', pageToken);
    const response = await driveRequest(`${drive}?${query}`);
    if (!response.ok) throw new Error('Photo list unavailable');
    const { files, nextPageToken } = await response.json();
    for (const photo of files as DrivePhoto[]) {
      if (!imageTypes.has(photo.mimeType)) continue;
      const entry = { id: photo.id, version: photo.modifiedTime, ...photo.imageMediaMetadata };
      if (photo.parents?.includes(folders.carousel)) photos.carousel.push(entry);
      if (photo.parents?.includes(folders.about)) photos.about.push(entry);
    }
    pageToken = nextPageToken;
  } while (pageToken);
  return json(photos);
}

async function servePhoto(id: string, folder: string) {
  const notFound = () => json({ error: 'Fotografía no disponible.' }, 404);
  if (!validId.test(id)) return notFound();
  const metadata = await driveRequest(`${drive}/${id}?fields=mimeType,parents,trashed`);
  if (metadata.status === 404 || metadata.status === 403) return notFound();
  if (!metadata.ok) throw new Error('Photo metadata unavailable');
  const photo: DrivePhoto = await metadata.json();
  if (photo.trashed || !photo.parents?.includes(folder) || !imageTypes.has(photo.mimeType)) return notFound();
  const image = await driveRequest(`${drive}/${id}?alt=media`);
  if (image.status === 404 || image.status === 403) return notFound();
  if (!image.ok) throw new Error('Photo data unavailable');
  return new Response(image.body, {
    headers: { ...headers, 'Content-Type': photo.mimeType, 'Cache-Control': 'public, max-age=60' },
  });
}

Deno.serve(async request => {
  if (request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405);
  try {
    const carousel = Deno.env.get('PHOTO_DRIVE_CAROUSEL');
    const about = Deno.env.get('PHOTO_DRIVE_ABOUT');
    if (!carousel || !about || !validId.test(carousel) || !validId.test(about)) throw new Error('Photo folders not configured');
    const params = new URL(request.url).searchParams;
    const id = params.get('id');
    if (id === null) return await listPhotos({ carousel, about });
    const section = params.get('section');
    if (section !== 'carousel' && section !== 'about') return json({ error: 'Sección no disponible.' }, 404);
    return await servePhoto(id, section === 'carousel' ? carousel : about);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Photo request failed');
    return json({ error: 'Las fotografías no están disponibles.' }, 503);
  }
});
