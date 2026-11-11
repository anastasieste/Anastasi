import { accountConfig } from './data/account-config.js';

const { url, publishableKey } = accountConfig;
const sessionKey = 'anastasi.member.session';
const legacyKey = 'anastasi.member.access';
const storageObjects = '/storage/v1/object';
const avatarBucket = '/member-avatars';
export const accountsReady = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && publishableKey.startsWith('sb_publishable_');

async function request(path, { body, method = body ? 'POST' : 'GET', token, file, image, chunk, offset } = {}) {
  if (!accountsReady) throw new Error('El servicio de cuentas todavía no está conectado.');
  let response;
  try {
    response = await fetch(new URL(path, url), {
      method,
      headers: {
        apikey: publishableKey,
        ...(body && { 'Content-Type': 'application/json' }),
        ...(file && { 'Content-Type': file.type, 'x-upsert': 'true' }),
        ...(chunk && { 'Content-Type': 'application/octet-stream', 'X-Video-Offset': String(offset) }),
        ...(token && { Authorization: 'Bearer ' + token }),
      },
      body: chunk || file || (body ? JSON.stringify(body) : undefined),
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw new Error('No se pudo conectar. Intenta de nuevo en unos minutos.');
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const videoMessage = path.startsWith('/functions/v1/member-video/') && typeof failure.message === 'string' ? failure.message : '';
    const error = new Error(videoMessage || (response.status === 429
      ? 'Has hecho varios intentos. Espera un momento y vuelve a intentar.'
      : 'No se pudo completar la solicitud. Revisa los datos e inténtalo de nuevo.'));
    error.status = response.status;
    error.code = failure.code || failure.error_code;
    throw error;
  }
  return image ? response.blob() : response.json().catch(() => ({}));
}

function storedSession() {
  try {
    const session = JSON.parse(localStorage.getItem(sessionKey));
    if (session?.access && session.refresh) return session;
  } catch { /* Una sesión inválida se trata como cerrada. */ }
  const access = sessionStorage.getItem(legacyKey);
  return access ? { access } : null;
}

function saveSession(credentials) {
  if (!credentials.access_token || !credentials.refresh_token) {
    throw new Error('No se recibió una sesión completa. Vuelve a iniciar sesión.');
  }
  const session = {
    access: credentials.access_token,
    refresh: credentials.refresh_token,
    expires: credentials.expires_at || (Math.floor(Date.now() / 1000) + Number(credentials.expires_in || 3600)),
  };
  localStorage.setItem(sessionKey, JSON.stringify(session));
  sessionStorage.removeItem(legacyKey);
  return session;
}

function clearSession() {
  localStorage.removeItem(sessionKey);
  sessionStorage.removeItem(legacyKey);
}

function sessionLock(callback) {
  return navigator.locks ? navigator.locks.request(sessionKey, callback) : callback();
}

let refreshing;
function activeSession(expiredAccess) {
  if (refreshing) return refreshing;
  refreshing = sessionLock(async () => {
    const session = storedSession();
    if (!session) return null;
    const rejected = session.access === expiredAccess;
    if (!rejected && (!session.refresh || session.expires > Date.now() / 1000 + 45)) return session;
    if (!session.refresh) { clearSession(); return null; }
    try {
      const credentials = await request('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh } });
      if (storedSession()?.refresh !== session.refresh) return storedSession();
      return saveSession(credentials);
    } catch (error) {
      if (storedSession()?.refresh !== session.refresh) return storedSession();
      if (![400, 401, 403].includes(error.status)) throw error;
      clearSession();
      return null;
    }
  }).finally(() => { refreshing = undefined; });
  return refreshing;
}

async function memberRequest(path, options) {
  const session = await activeSession();
  if (!session) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
  try { return await request(path, { ...options, token: session.access }); }
  catch (error) {
    if (error.status !== 401) throw error;
    const renewed = await activeSession(session.access);
    if (!renewed) throw new Error('Tu sesión terminó. Vuelve a iniciar sesión.');
    return request(path, { ...options, token: renewed.access });
  }
}

function rpc(name, body = {}) {
  return memberRequest('/rest/v1/rpc/' + name, { body });
}

function avatarObject(id) {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw new Error('Perfil no válido.');
  return id + '/avatar';
}

async function memberProfile(token) {
  const rows = await request('/rest/v1/rpc/current_member_profile', { body: {}, token });
  return rows[0] ?? null;
}

export const account = {
  register: ({ email, password, full_name, callsign, squad }) =>
    request('/auth/v1/signup', { body: { email, password, data: { full_name, callsign, squad } } }),

  async signIn(identifier, password) {
    try {
      const credentials = identifier.includes('@')
        ? await request('/auth/v1/token?grant_type=password', { body: { email: identifier, password } })
        : await request('/functions/v1/callsign-login', { body: { callsign: identifier, password } });
      if (!credentials.access_token) throw new Error('No se recibió una sesión válida.');
      const profile = await memberProfile(credentials.access_token);
      if (profile?.status === 'pending') throw new Error('Tu solicitud está pendiente de revisión. Te avisaremos por correo.');
      if (profile?.status === 'rejected') throw new Error('Tu solicitud de membresía fue rechazada.');
      if (profile?.status === 'suspended') throw new Error('Tu cuenta está suspendida. Comunícate con la administración.');
      if (profile?.status !== 'approved') throw new Error('No se pudo validar tu membresía.');
      await sessionLock(() => saveSession(credentials));
      return profile;
    } catch (error) {
      if (error.code === 'user_banned') throw new Error('Tu cuenta está suspendida. Comunícate con la administración.');
      if (error.status === 400 || error.status === 401) throw new Error('El correo o callsign y la contraseña no coinciden, o tu correo aún no está confirmado.');
      throw error;
    }
  },

  async current() {
    if (!storedSession()) return null;
    try { return (await rpc('current_member_profile'))[0] ?? null; }
    catch (error) { if (storedSession()) throw error; return null; }
  },

  async signOut() {
    await activeSession().catch(() => {});
    await sessionLock(async () => {
      const token = storedSession()?.access;
      clearSession();
      if (token) await request('/auth/v1/logout?scope=local', { token, method: 'POST' });
    });
  },

  recover: email => request('/auth/v1/recover', { body: { email } }),
  verify: (type, token_hash) => request('/auth/v1/verify', { body: { type, token_hash } }),
  updatePassword: (token, password) => request('/auth/v1/user', { token, method: 'PUT', body: { password } }),

  changePassword: password => memberRequest('/auth/v1/user', { method: 'PUT', body: { password } }),
  changeEmail: email => memberRequest('/auth/v1/user', { method: 'PUT', body: { email } }),
  ownProfile: async () => (await rpc('portal_own_profile'))[0],
  updateProfile: (member_name, bio, details) => rpc('portal_update_profile', { member_name, bio, details }),
  updatePrivacy: (bio_visible, name_visible, details_visible, activity_visible) =>
    rpc('portal_update_privacy', { bio_visible, name_visible, details_visible, activity_visible }),
  directory: (squad_filter = null) => rpc('portal_directory', { squad_filter }),
  squads: () => rpc('portal_squads'),
  directoryProfile: async member_id => (await rpc('portal_directory_profile', { member_id }))[0],
  editMember: (member_id, member_callsign, member_squad) =>
    rpc('portal_admin_edit_member', { member_id, member_callsign, member_squad }),
  avatar: id => memberRequest(storageObjects + '/authenticated' + avatarBucket + '/' + avatarObject(id), { image: true }),
  uploadAvatar: (id, file) => memberRequest(storageObjects + avatarBucket + '/' + avatarObject(id), { method: 'POST', file }),
  removeAvatar: id => memberRequest(storageObjects + avatarBucket, {
    method: 'DELETE', body: { prefixes: [avatarObject(id)] },
  }),
  pendingApplications: () => rpc('pending_member_applications'),
  applicationHistory: () => rpc('portal_application_history'),
  managementSnapshot: () => rpc('portal_management_snapshot'),
  manageAccounts: changes => rpc('portal_manage_accounts', { changes }),
  decide: (application_id, approved, review_note) => rpc('decide_member_application', { application_id, approved, review_note }),
  videoNotice: show_notice => rpc('portal_video_notice', { show_notice }),
  profileVideos: member_id => rpc('portal_profile_videos', { member_id }),
  publicVideos: () => request('/rest/v1/rpc/portal_public_videos', { body: {} }),
  videoQueue: () => rpc('portal_video_queue'),
  videoStart: (title, bytes) => memberRequest('/functions/v1/member-video/start', { body: { title, bytes } }),
  videoOffset: id => memberRequest('/functions/v1/member-video/upload/' + id, { method: 'POST' }),
  videoChunk: (id, chunk, offset) => memberRequest('/functions/v1/member-video/upload/' + id, { method: 'PUT', chunk, offset }),
  videoPreview: id => memberRequest('/functions/v1/member-video/preview/' + id, { method: 'POST' }),
  videoDecision: (id, decision) => memberRequest('/functions/v1/member-video/decide/' + id, { body: { decision } }),

  async squadCounts() {
    if (!accountsReady) return new Map();
    const rows = await request('/rest/v1/rpc/active_squad_counts', { body: {} });
    return new Map(rows.map(row => [row.code, Number(row.member_count)]));
  },
};

export function videoPlayback(id, ticket) {
  const playback = new URL('/functions/v1/member-video/play/' + encodeURIComponent(id), url);
  if (ticket) playback.searchParams.set('ticket', ticket);
  return playback.href;
}

export function watchMemberSession(callback) {
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === sessionKey) callback();
  });
}

export function initializeAccountForms(root = document) {
  if (!accountsReady) return;
  root.querySelectorAll('[data-account-notice]').forEach(notice => { notice.hidden = true; });
  root.querySelectorAll('.account-form button[type="submit"]').forEach(button => { button.disabled = false; });
}

export function formMessage(form, text, error = false) {
  const message = form.querySelector('.form-message');
  message.textContent = text;
  message.toggleAttribute('data-error', error);
}

export async function submitAccountForm(form, pending, submit) {
  const button = form.querySelector('button[type="submit"]');
  if (!accountsReady || button.disabled) return;
  button.disabled = true;
  formMessage(form, pending);
  try {
    await submit(Object.fromEntries(new FormData(form)));
  } catch (error) {
    formMessage(form, error.message, true);
  } finally {
    button.disabled = false;
  }
}

export function validPassword(form) {
  const { password, confirmation } = form.elements;
  const value = password.value;
  const symbols = "!@#$%^&*()_+-=[]{};':\"|<>?,./~" + String.fromCharCode(92, 96);
  const valid = [...value].length >= 9 && new TextEncoder().encode(value).length <= 72
    && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value) && [...value].some(character => symbols.includes(character));
  password.setCustomValidity(valid ? '' : 'Usa al menos 9 caracteres, una mayúscula, una minúscula, un número y un símbolo, con un máximo de 72 bytes.');
  confirmation.setCustomValidity(value === confirmation.value ? '' : 'Las contraseñas deben coincidir.');
  return form.reportValidity();
}
