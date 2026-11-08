import { account, accountsReady, formMessage, initializeAccountForms, submitAccountForm, validPassword } from './account.js';
import { squadCodes } from './data/content.js?v=1.2';

initializeAccountForms();
const fragment = new URLSearchParams(location.hash.slice(1));
const signup = document.querySelector('#registration-form');

function passwordValidation(form) {
  for (const field of [form.elements.password, form.elements.confirmation]) {
    field.addEventListener('input', () => {
      form.elements.password.setCustomValidity('');
      form.elements.confirmation.setCustomValidity('');
    });
  }
}

if (signup) {
  const confirmation = document.querySelector('#confirmation-form');
  const token = fragment.get('confirmacion');
  if (token) {
    signup.hidden = true;
    confirmation.hidden = false;
    document.querySelector('h1').textContent = 'Confirma tu correo';
    document.querySelector('.account-intro').textContent = 'Confirma tu dirección para enviar tu solicitud a revisión.';
    confirmation.addEventListener('submit', event => {
      event.preventDefault();
      submitAccountForm(confirmation, 'Confirmando tu correo…', async () => {
        await account.verify('email', token);
        history.replaceState(null, '', location.pathname);
        location.replace('./#portal');
      });
    });
  } else {
    for (const code of squadCodes) signup.elements.squad.add(new Option(code, code));
    passwordValidation(signup);
    signup.addEventListener('submit', event => {
      event.preventDefault();
      if (!validPassword(signup)) return;
      submitAccountForm(signup, 'Creando tu cuenta…', async data => {
        data.full_name = data.full_name.trim();
        data.callsign = data.callsign.trim();
        data.email = data.email.trim();
        await account.register(data);
        signup.reset();
        formMessage(signup, 'Si la solicitud es válida, recibirás un correo para confirmar tu cuenta.');
      });
    });
  }
}

const reset = document.querySelector('#reset-form');
if (reset) {
  const token = fragment.get('recuperacion');
  let recoveryAccess;
  passwordValidation(reset);
  if (!token && accountsReady) {
    reset.querySelector('button[type="submit"]').disabled = true;
    formMessage(reset, 'Abre el enlace que recibiste por correo para cambiar tu contraseña.', true);
  }
  reset.addEventListener('submit', event => {
    event.preventDefault();
    if (!token || !validPassword(reset)) return;
    submitAccountForm(reset, 'Guardando tu contraseña…', async ({ password }) => {
      if (!recoveryAccess) {
        const session = await account.verify('recovery', token);
        recoveryAccess = session.access_token;
        if (!recoveryAccess) throw new Error('El enlace no es válido o ha caducado. Solicita otro desde el portal.');
      }
      await account.updatePassword(recoveryAccess, password);
      recoveryAccess = undefined;
      history.replaceState(null, '', location.pathname);
      reset.reset();
      location.replace('./#portal');
    });
  });
}

const emailChange = document.querySelector('#email-change-confirmation');
if (emailChange) {
  const token = fragment.get('cambio');
  const submit = emailChange.querySelector('button[type="submit"]');
  if (!token) {
    submit.disabled = true;
    formMessage(emailChange, 'Abre el enlace que recibiste por correo.', true);
  }
  emailChange.addEventListener('submit', event => {
    event.preventDefault();
    if (!token || submit.hidden) return;
    submitAccountForm(emailChange, 'Confirmando el cambio…', async () => {
      const result = await account.verify('email_change', token);
      history.replaceState(null, '', location.pathname);
      submit.hidden = true;
      formMessage(emailChange, result.access_token
        ? 'Tu correo se actualizó. Puedes consultarlo en Mi perfil.'
        : 'Confirmación registrada. Si queda otro enlace por confirmar, ábrelo desde el otro buzón.');
    });
  });
}
