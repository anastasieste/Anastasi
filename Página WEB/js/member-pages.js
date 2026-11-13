import { account, accountsReady, formMessage, initializeAccountForms, submitAccountForm, validPassword, videoPlayback, watchMemberSession } from './account.js?v=1.14';
import { setupMemberMenu } from './member-menu.js?v=1.14';
import { setupSiteNavigation } from './site-navigation.js';
import { galleryItems } from './data/content.js?v=1.2';

const page = document.body.dataset.memberPage;
const status = document.querySelector('.member-page-status');
const protectedContent = document.querySelector('.member-private');
const signInLink = document.querySelector('.member-page-signin');
setupSiteNavigation(document.querySelector('.header'));
const menu = setupMemberMenu(document.querySelector('.members-link'), {
  onSignIn: () => { location.href = './#portal'; },
  onSignOut: () => { location.replace('./'); },
});
const date = new Intl.DateTimeFormat('es-PR', { dateStyle: 'medium', timeZone: 'UTC' });
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
let initialized = false;
let administrator = false;
let validating = false;

function node(tag, text = '', className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function showAvatar(avatar, member) {
  if (!member.has_avatar) return;
  try {
    const picture = await account.avatar(member.id);
    if (!avatar.isConnected || !imageTypes.has(picture.type)) return;
    const source = URL.createObjectURL(picture);
    const image = document.createElement('img');
    image.alt = '';
    image.addEventListener('load', () => { URL.revokeObjectURL(source); avatar.replaceChildren(image); }, { once: true });
    image.addEventListener('error', () => URL.revokeObjectURL(source), { once: true });
    image.src = source;
  } catch { /* El avatar de reserva queda visible. */ }
}

const avatarObserver = 'IntersectionObserver' in window && new IntersectionObserver(entries => {
  for (const { target, isIntersecting } of entries) {
    if (!isIntersecting) continue;
    avatarObserver.unobserve(target);
    showAvatar(target, { id: target.dataset.memberId, has_avatar: true });
  }
}, { rootMargin: '120px' });

function avatarFor(member, large = false, fallback = false) {
  const initials = fallback ? member.callsign.slice(0, 2).toUpperCase() : '';
  const avatar = node('span', initials, large ? 'avatar avatar-large' : 'avatar');
  avatar.setAttribute('aria-hidden', 'true');
  if (member.has_avatar) {
    if (large || !avatarObserver) queueMicrotask(() => showAvatar(avatar, member));
    else {
      avatar.dataset.memberId = member.id;
      avatarObserver.observe(avatar);
    }
  }
  return avatar;
}

function memberCards(members) {
  const grid = node('div', '', 'member-grid');
  for (const member of members) {
    const card = node('a', '', 'member-tile');
    card.href = 'perfil.html?miembro=' + encodeURIComponent(member.id);
    if (member.has_avatar) card.append(avatarFor(member));
    card.append(node('strong', member.callsign));
    grid.append(card);
  }
  return grid;
}

function squadHeading(squad, count) {
  const title = node('span', '', 'squad-identity');
  if (squad.badge_file && /^[a-z\d_-]+\.(png|webp|jpe?g|avif)$/i.test(squad.badge_file)) {
    const badge = document.createElement('img');
    badge.alt = '';
    badge.src = 'assets/images/squads/' + squad.badge_file;
    title.append(badge);
  }
  const name = squad.display_name || squad.code;
  title.append(node('strong', name), node('span', count + (count === 1 ? ' integrante' : ' integrantes')));
  return title;
}

async function renderDirectory() {
  const [members, squads] = await Promise.all([account.directory(), account.squads()]);
  const roster = new Map();
  for (const member of members) {
    if (!roster.has(member.squad)) roster.set(member.squad, []);
    roster.get(member.squad).push(member);
  }
  const directory = document.querySelector('#member-directory');
  for (const squad of squads) {
    const group = roster.get(squad.code);
    if (!group?.length) continue;
    const panel = node('details', '', 'squad-panel');
    const summary = node('summary');
    summary.append(squadHeading(squad, group.length));
    panel.append(summary);
    if (squad.description) panel.append(node('p', squad.description, 'member-preformatted'));
    panel.append(memberCards(group));
    directory.append(panel);
  }
  if (!directory.children.length) directory.append(node('p', 'Todavía no hay miembros aprobados.'));
}

async function activity(container, memberId, own = false) {
  const staticItems = galleryItems.filter(item => item.approved === true && item.memberId === memberId && item.publishedAt && item.src);
  const published = await account.profileVideos(memberId).catch(() => []);
  const items = [...published.map(item => ({ ...item, publishedAt: item.published_at, src: videoPlayback(item.id) })), ...staticItems];
  if (!items.length) {
    container.replaceChildren(node('p', own ? 'Todavía no tienes actividad publicada.' : 'Todavía no hay actividad publicada.'));
    return;
  }
  const entries = node('ul', '', 'member-activity');
  for (const item of items) {
    const entry = node('li');
    const link = node('a', item.title);
    link.href = item.src;
    const time = node('time', date.format(new Date(item.publishedAt)));
    time.dateTime = item.publishedAt;
    entry.append(link, time);
    entries.append(entry);
  }
  container.replaceChildren(entries);
}

function showIdentity(member, own = false) {
  document.querySelector('.profile-kicker').textContent = own ? 'MI PERFIL' : 'PERFIL DE MIEMBRO';
  const avatar = document.querySelector('.profile-avatar');
  const show = own || member.has_avatar;
  avatar.hidden = !show;
  avatar.parentElement.classList.toggle('profile-banner-no-avatar', !show);
  if (show) avatar.replaceChildren(avatarFor(member, true, own));
  else avatar.replaceChildren();
  document.querySelector('.profile-callsign').textContent = member.callsign;
  document.querySelector('.profile-squad').textContent = member.squad;
  const biography = document.querySelector('.profile-bio');
  biography.textContent = member.biography || '';
  biography.hidden = !member.biography;
}

function bindForm(form, pending, action) {
  form.addEventListener('submit', event => {
    event.preventDefault();
    submitAccountForm(form, pending, action);
  });
}

async function renderOwnProfile() {
  const self = await account.ownProfile();
  if (!self) throw new Error('El perfil no está disponible.');
  showIdentity(self, true);
  document.querySelector('#own-profile').hidden = false;
  for (const field of document.querySelectorAll('[data-self]')) field.textContent = self[field.dataset.self];

  const profile = document.querySelector('#profile-form');
  profile.elements.full_name.value = self.full_name;
  profile.elements.biography.value = self.biography;
  profile.elements.details.value = self.profile_details;
  bindForm(profile, 'Guardando perfil…', async data => {
    const name = data.full_name.trim();
    if (name.length < 3) throw new Error('Escribe un nombre de al menos 3 caracteres.');
    await account.updateProfile(name, data.biography.trim(), data.details.trim());
    self.biography = data.biography.trim();
    const biography = document.querySelector('.profile-bio');
    biography.textContent = self.biography;
    biography.hidden = !self.biography;
    formMessage(profile, 'Perfil actualizado.');
  });

  const avatar = document.querySelector('#avatar-form');
  const remove = avatar.querySelector('[data-remove-avatar]');
  remove.hidden = !self.has_avatar;
  bindForm(avatar, 'Guardando foto…', async ({ avatar: file }) => {
    if (!file?.size || file.size > 2 * 1024 * 1024 || !imageTypes.has(file.type)) {
      throw new Error('Selecciona una imagen JPG, PNG o WebP de hasta 2 MB.');
    }
    try {
      const bitmap = await createImageBitmap(file);
      const tooLarge = bitmap.width > 4096 || bitmap.height > 4096;
      bitmap.close();
      if (tooLarge) throw new Error();
    } catch { throw new Error('Usa una imagen válida de hasta 4096 píxeles por lado.'); }
    await account.uploadAvatar(self.id, file);
    self.has_avatar = true;
    remove.hidden = false;
    avatar.reset();
    document.querySelector('.profile-avatar').replaceChildren(avatarFor(self, true, true));
    formMessage(avatar, 'Foto actualizada.');
  });
  remove.addEventListener('click', async () => {
    const submit = avatar.querySelector('[type="submit"]');
    if (submit.disabled || !window.confirm('¿Eliminar tu foto de perfil?')) return;
    remove.disabled = submit.disabled = true;
    try {
      await account.removeAvatar(self.id);
      self.has_avatar = false;
      remove.hidden = true;
      document.querySelector('.profile-avatar').replaceChildren(avatarFor(self, true, true));
      avatar.elements.avatar.focus();
      formMessage(avatar, 'Foto eliminada.');
    } catch (error) { formMessage(avatar, error.message, true); }
    finally { remove.disabled = submit.disabled = false; }
  });

  const email = document.querySelector('#email-form');
  email.elements.email.value = self.email;
  bindForm(email, 'Solicitando el cambio…', async data => {
    const address = data.email.trim();
    if (address.toLowerCase() === self.email.toLowerCase()) {
      formMessage(email, 'Esta dirección ya está asociada a tu cuenta.');
      return;
    }
    await account.changeEmail(address);
    email.elements.email.value = self.email;
    formMessage(email, 'Solicitud enviada. Confirma los enlaces que recibas en las direcciones de correo.');
  });

  const password = document.querySelector('#password-form');
  password.addEventListener('input', () => {
    password.elements.password.setCustomValidity('');
    password.elements.confirmation.setCustomValidity('');
  });
  password.addEventListener('submit', event => {
    event.preventDefault();
    if (!validPassword(password)) return;
    submitAccountForm(password, 'Cambiando contraseña…', async data => {
      await account.changePassword(data.password);
      password.reset();
      formMessage(password, 'Contraseña actualizada.');
    });
  });

  const privacy = document.querySelector('#privacy-form');
  const fields = ['show_biography', 'show_full_name', 'show_details', 'show_activity', 'show_avatar'];
  for (const field of fields) privacy.elements[field].checked = self[field];
  bindForm(privacy, 'Guardando privacidad…', async () => {
    await account.updatePrivacy(...fields.map(field => privacy.elements[field].checked));
    loadedSquad = false;
    formMessage(privacy, 'Preferencias guardadas.');
  });
  const videoPrivacy = document.querySelector('#video-privacy-form');
  account.videoNotice().then(value => {
    videoPrivacy.elements.show_notice.checked = value;
    videoPrivacy.hidden = false;
  }).catch(() => {});
  bindForm(videoPrivacy, 'Guardando…', async () => {
    await account.videoNotice(videoPrivacy.elements.show_notice.checked);
    formMessage(videoPrivacy, 'Preferencia guardada.');
  });
  activity(document.querySelector('#member-activity'), self.id, true);

  const sections = [...document.querySelectorAll('[data-section]')];
  const links = [...document.querySelectorAll('.profile-navigation a')];
  let loadedSquad = false;
  function selectSection() {
    const selected = sections.find(section => '#' + section.id === location.hash) || sections[0];
    for (const section of sections) section.hidden = section !== selected;
    for (const link of links) {
      if (link.hash.slice(1) === selected.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    if (selected.id === 'escuadron' && !loadedSquad) {
      loadedSquad = true;
      const message = document.querySelector('#squad-status');
      message.textContent = 'Cargando escuadrón…';
      Promise.all([account.directory(self.squad), account.squads()]).then(([members, squads]) => {
        const squad = squads.find(item => item.code === self.squad) || { code: self.squad };
        const panel = document.querySelector('#own-squad');
        panel.replaceChildren(squadHeading(squad, members.length));
        if (squad.description) panel.append(node('p', squad.description, 'member-preformatted'));
        panel.append(memberCards(members));
        message.textContent = '';
      }).catch(error => {
        loadedSquad = false;
        message.textContent = error.message;
      });
    }
  }
  window.addEventListener('hashchange', selectSection);
  selectSection();
}

async function renderDirectoryProfile(id) {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw new Error('Ese perfil no está disponible.');
  const member = await account.directoryProfile(id);
  if (!member) throw new Error('Ese perfil no está disponible.');
  showIdentity(member);
  document.title = member.callsign + ' · Anástasi';
  document.querySelector('#directory-profile').hidden = false;
  const details = document.querySelector('#shared-details');
  for (const [label, value] of [['Nombre', member.full_name], ['Información adicional', member.profile_details]]) {
    if (!value) continue;
    const fact = node('div');
    fact.append(node('dt', label), node('dd', value, 'member-preformatted'));
    details.querySelector('dl').append(fact);
  }
  details.hidden = !details.querySelector('dl').children.length;
  const sharedActivity = document.querySelector('#shared-activity');
  sharedActivity.hidden = !member.show_activity;
  if (member.show_activity) activity(sharedActivity.querySelector('div'), member.id);
  if (!administrator) return;

  const form = document.querySelector('#admin-edit-form');
  form.elements.callsign.value = member.callsign;
  for (const squad of await account.squads()) {
    form.elements.squad.add(new Option(squad.display_name || squad.code, squad.code));
  }
  form.elements.squad.value = member.squad;
  document.querySelector('#admin-edit').hidden = false;
  bindForm(form, 'Guardando cambios…', async ({ callsign, squad }) => {
    callsign = callsign.trim();
    if (!/^[a-z\d][a-z\d._-]{1,31}$/i.test(callsign)) throw new Error('Usa de 2 a 32 letras, números, puntos, guiones o guiones bajos.');
    try { await account.editMember(member.id, callsign, squad); }
    catch (error) {
      if (error.code === '23505') throw new Error('Ese callsign ya está en uso.');
      throw error;
    }
    member.callsign = callsign;
    member.squad = squad;
    showIdentity(member);
    menu.update(await account.current());
    formMessage(form, 'Cambios guardados y registrados.');
  });
}

async function start() {
  if (validating) return;
  validating = true;
  try {
    const profile = accountsReady ? await account.current() : null;
    menu.update(profile);
    if (profile?.status !== 'approved') {
      if (initialized) { location.replace('./#portal'); return; }
      protectedContent.hidden = true;
      status.textContent = 'Inicia sesión con una cuenta de miembro aprobada.';
      signInLink.hidden = false;
      return;
    }
    if (initialized) {
      if (administrator !== profile.is_admin) location.reload();
      return;
    }
    administrator = profile.is_admin;
    const id = new URLSearchParams(location.search).get('miembro');
    if (page === 'directory') await renderDirectory();
    if (page === 'editor') {
      const access = await account.videoEditorAccess();
      if (!access.allowed) {
        status.textContent = 'El Editor requiere una membresía activa.';
        return;
      }
      (await import('./editor.js?v=1.14')).setupEditor(profile);
    }
    if (page === 'upload') (await import('./content-upload.js?v=1.14')).setupContentUpload();
    if (page === 'profile') {
      if (id === null) await renderOwnProfile();
      else await renderDirectoryProfile(id);
    }
    initializeAccountForms();
    initialized = true;
    signInLink.hidden = true;
    protectedContent.hidden = false;
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message;
  } finally { validating = false; }
}

start();
watchMemberSession(start);
window.addEventListener('pageshow', event => { if (event.persisted) start(); });
