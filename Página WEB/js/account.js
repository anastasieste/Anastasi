import { accountConfig } from './data/account-config.js';

const { url, publishableKey } = accountConfig;
const sessionKey = 'anastasi.member.access';
export const accountsReady = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) && publishableKey.startsWith('sb_publishable_');

async function request(path, { body, method = body ? 'POST' : 'GET', token } = {}) {
  if (!accountsReady) throw new Error('El servicio de cuentas todavía no está conectado.');
  let response;
  try {
    response = await fetch(new URL(path, url), {
      method,
      headers: {
        apikey: publishableKey,
        ...(body && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: 'Bearer ' + token }),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw new Error('No se pudo conectar. Intenta de nuevo en unos minutos.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) throw new Error('Has hecho varios intentos. Espera un momento y vuelve a intentar.');
    const error = new Error('No se pudo completar la solicitud. Revisa los datos e inténtalo de nuevo.');
    error.status = response.status;
    throw error;
  }
  return result;
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
      if (profile?.status !== 'approved') throw new Error('No se pudo validar tu membresía.');
      sessionStorage.setItem(sessionKey, credentials.access_token);
      return profile;
    } catch (error) {
      if (error.status === 400 || error.status === 401) throw new Error('El correo o callsign y la contraseña no coinciden, o tu correo aún no está confirmado.');
      throw error;
    }
  },

  async current() {
    const token = sessionStorage.getItem(sessionKey);
    if (!token) return null;
    try {
      return await memberProfile(token);
    } catch (error) {
      if (error.status !== 401 && error.status !== 403) throw error;
      sessionStorage.removeItem(sessionKey);
      return null;
    }
  },

  async signOut() {
    const token = sessionStorage.getItem(sessionKey);
    sessionStorage.removeItem(sessionKey);
    if (token) await request('/auth/v1/logout?scope=local', { token, method: 'POST' });
  },

  recover: email => request('/auth/v1/recover', { body: { email } }),
  verify: (type, token_hash) => request('/auth/v1/verify', { body: { type, token_hash } }),
  updatePassword: (token, password) => request('/auth/v1/user', { token, method: 'PUT', body: { password } }),

  pendingApplications: () => request('/rest/v1/rpc/pending_member_applications', {
    body: {}, token: sessionStorage.getItem(sessionKey),
  }),
  decide: (application_id, approved) => request('/rest/v1/rpc/decide_member_application', {
    body: { application_id, approved }, token: sessionStorage.getItem(sessionKey),
  }),

  async squadCounts() {
    if (!accountsReady) return new Map();
    const rows = await request('/rest/v1/rpc/active_squad_counts', { body: {} });
    return new Map(rows.map(row => [row.code, Number(row.member_count)]));
  },
};

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
