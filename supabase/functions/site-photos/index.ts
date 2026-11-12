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
type Section = 'carousel' | 'about';
type PhotoFolders = Record<Section, string>;
type PhotoIndex = {
  photos: Record<Section, Photo[]>;
  files: Record<Section, Map<string, DrivePhoto>>;
  expires: number;
};
let driveToken: { value: string; expires: number } | undefined;
let pendingToken: Promise<string> | undefined;
let photoIndex: PhotoIndex | undefined;
let pendingIndex: Promise<PhotoIndex> | undefined;

async function requestToken() {
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
  driveToken = { value: token, expires: Date.now() + 10 * 60_000 };
  return token;
}

function accessToken() {
  if (driveToken && Date.now() < driveToken.expires) return Promise.resolve(driveToken.value);
  return pendingToken ??= requestToken().finally(() => { pendingToken = undefined; });
}

async function driveRequest(url: string) {
  const send = (token: string) => fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  const token = await accessToken();
  const response = await send(token);
  if (response.status !== 401) return response;
  await response.body?.cancel();
  if (driveToken?.value === token) driveToken = undefined;
  return send(await accessToken());
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
  const photos: PhotoIndex['photos'] = { carousel: [], about: [] };
  const indexedFiles: PhotoIndex['files'] = { carousel: new Map(), about: new Map() };
  let pageToken = '';
  do {
    if (pageToken) query.set('pageToken', pageToken);
    const response = await driveRequest(`${drive}?${query}`);
    if (!response.ok) throw new Error('Photo list unavailable');
    const { files, nextPageToken } = await response.json();
    for (const photo of files as DrivePhoto[]) {
      if (!imageTypes.has(photo.mimeType)) continue;
      const entry = { id: photo.id, version: photo.modifiedTime, ...photo.imageMediaMetadata };
      for (const section of ['carousel', 'about'] as const) {
        if (!photo.parents?.includes(folders[section])) continue;
        photos[section].push(entry);
        indexedFiles[section].set(photo.id, photo);
      }
    }
    pageToken = nextPageToken;
  } while (pageToken);
  return { photos, files: indexedFiles, expires: Date.now() + 15_000 };
}

function getPhotoIndex(folders: PhotoFolders) {
  if (photoIndex && Date.now() < photoIndex.expires) return Promise.resolve(photoIndex);
  return pendingIndex ??= listPhotos(folders).then(index => {
    photoIndex = index;
    return index;
  }).finally(() => { pendingIndex = undefined; });
}

async function servePhoto(id: string, folder: string, section: Section, version: string | null) {
  const notFound = () => json({ error: 'Fotografía no disponible.' }, 404);
  if (!validId.test(id)) return notFound();
  // Reusa la comprobación de carpeta que acaba de hacer el listado para esta versión.
  const cached = photoIndex && Date.now() < photoIndex.expires ? photoIndex.files[section].get(id) : undefined;
  let photo = cached && cached.modifiedTime === version ? cached : undefined;
  if (!photo) {
    const metadata = await driveRequest(`${drive}/${id}?fields=mimeType,parents,trashed`);
    if (metadata.status === 404 || metadata.status === 403) return notFound();
    if (!metadata.ok) throw new Error('Photo metadata unavailable');
    photo = await metadata.json() as DrivePhoto;
  }
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
    if (id === null) return json((await getPhotoIndex({ carousel, about })).photos);
    const section = params.get('section');
    if (section !== 'carousel' && section !== 'about') return json({ error: 'Sección no disponible.' }, 404);
    return await servePhoto(id, section === 'carousel' ? carousel : about, section, params.get('v'));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Photo request failed');
    return json({ error: 'Las fotografías no están disponibles.' }, 503);
  }
});
