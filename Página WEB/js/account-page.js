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
