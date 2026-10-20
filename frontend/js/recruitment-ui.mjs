export const $ = (selector) => document.querySelector(selector);
const errors = {
  AUTH_REQUIRED: 'Connectez-vous pour continuer.',
  ACTIVE_ACCOUNT_REQUIRED: 'Votre compte doit être activé.',
  CONTACT_BLOCKED: 'Les échanges sont bloqués entre ces comptes.',
  SPORT_PROFILE_MISSING: 'Votre fiche joueur est absente. La messagerie reste accessible.',
  TOO_MANY_REQUESTS: 'Trop de demandes. Patientez avant de réessayer.',
  INVALID_TRANSITION: 'Ce changement de statut n’est plus possible.',
  STATUS_PERMISSION_DENIED: 'Cette décision appartient à votre interlocuteur.',
  RESOURCE_CONFLICT: 'Cet élément existe déjà ou a été modifié.',
  AD_NOT_FOUND: 'Cette annonce n’est plus disponible.',
  CONVERSATION_NOT_FOUND: 'Cette conversation est introuvable.',
  LIVE_CAPACITY: 'Utilisez le bouton Actualiser.'
};
export async function api(path, method = 'GET', data) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {})
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(
      errors[result?.code] || result?.message || 'Action impossible. Réessayez.'
    );
    error.status = response.status;
    error.code = result?.code;
    throw error;
  }
  return result;
}
export function node(tag, content, className) {
  const el = document.createElement(tag);
  if (content !== undefined && content !== null) el.textContent = String(content);
  if (className) el.className = className;
  return el;
}
export function link(label, url, className) {
  const el = node('a', label, className);
  el.href = url;
  return el;
}
export function button(label, action, className) {
  const el = node('button', label, className);
  el.type = 'button';
  el.addEventListener('click', () => run(el, action));
  return el;
}
export function notice(message, error = false) {
  const target = $('#module-status') || $('#apply-message') || $('#offers-count');
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('error', error);
  target.setAttribute('role', error ? 'alert' : 'status');
  const chat = $('#chat-feedback');
  if (chat) {
    chat.textContent = message;
    chat.classList.toggle('error', error);
    chat.setAttribute('role', error ? 'alert' : 'status');
  }
}
export async function run(control, action) {
  if (control.disabled) return;
  control.disabled = true;
  try {
    return await action();
  } catch (error) {
    notice(error.message, true);
  } finally {
    control.disabled = false;
  }
}
export const date = (value) =>
  value ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
export function avatar(url, name) {
  const el = node('img', null, 'm-avatar');
  el.alt = name || '';
  el.width = 40;
  el.height = 40;
  el.referrerPolicy = 'no-referrer';
  try {
    if (!url) throw new Error('No avatar');
    const safe = new URL(url, location.origin);
    el.src =
      safe.protocol === 'https:' || safe.origin === location.origin
        ? safe.href
        : '/assets/default-avatar.svg';
  } catch {
    el.src = '/assets/default-avatar.svg';
  }
  return el;
}
export function linkedText(value) {
  const fragment = document.createDocumentFragment();
  let start = 0;
  for (const match of value.matchAll(/https?:\/\/[^\s<>]+/g)) {
    fragment.append(document.createTextNode(value.slice(start, match.index)));
    let url;
    try {
      url = new URL(match[0]);
    } catch {}
    if (url && !url.username && !url.password) {
      const a = link(match[0], url.href);
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
      fragment.append(a);
    } else fragment.append(document.createTextNode(match[0]));
    start = match.index + match[0].length;
  }
  fragment.append(document.createTextNode(value.slice(start)));
  return fragment;
}
export let catalog;
export async function options() {
  return (catalog ||= await api('/recruitment/options'));
}
export function label(group, code) {
  return catalog?.[group]?.find((row) => row.code === code)?.label || code || 'Non renseigné';
}
export function select(name, title, values, value = '', optional = true) {
  const field = node('label', title, 'm-field'),
    input = node('select');
  input.name = name;
  if (optional) {
    const empty = node('option', 'Non renseigné');
    empty.value = '';
    input.append(empty);
  }
  for (const row of values) {
    const option = node('option', row.label || row.code);
    option.value = row.code;
    input.append(option);
  }
  input.value = value || '';
  field.append(input);
  return field;
}
export function input(name, title, value = '', type = 'text', max = 150) {
  const field = node('label', title, 'm-field'),
    control = node(type === 'textarea' ? 'textarea' : 'input');
  control.name = name;
  control.value = value ?? '';
  if (type !== 'textarea') control.type = type;
  control.maxLength = max;
  if (type === 'textarea') control.rows = 4;
  field.append(control);
  return field;
}
export function choices(name, title, values, selected = [], max = 3) {
  const field = node('fieldset', null, 'm-choices');
  field.append(node('legend', `${title} · ${max} maximum`));
  const hint = node('p', '', 'm-small');
  hint.setAttribute('aria-live', 'polite');
  for (const row of values) {
    const choice = node('label'),
      check = node('input');
    check.type = 'checkbox';
    check.name = name;
    check.value = row.code;
    check.checked = selected.includes(row.code);
    check.addEventListener('change', () => {
      if (field.querySelectorAll('input:checked').length > max) {
        check.checked = false;
        hint.textContent = `Maximum ${max} choix.`;
      } else hint.textContent = '';
    });
    choice.append(check, document.createTextNode(row.label || row.code));
    field.append(choice);
  }
  field.append(hint);
  return field;
}
export function values(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((e) => e.value);
}
export async function identity(required = true) {
  try {
    return await api('/messaging/identities');
  } catch (error) {
    if (error.status === 401 && required) {
      notice('Connectez-vous pour accéder à cet espace.');
      const root = $('#module-content');
      root?.replaceChildren(link('Se connecter', 'login.html', 'm-button'));
      return null;
    }
    if (required) throw error;
    return null;
  }
}
export function profileView(data, compact = false) {
  const box = node('div', null, 'm-profile');
  box.append(node('h2', data.user?.username || 'Profil'));
  if (!data.shared || !data.profile) {
    box.append(node('p', 'La fiche sportive n’est pas partagée. Vous pouvez échanger sans CV.'));
    return box;
  }
  const p = data.profile,
    dl = node('dl');
  const rows =
    data.role === 'CLUB'
      ? [
          ['Club', p.name],
          ['Ville', p.city],
          ['Divisions', p.divisions],
          ['Présentation', p.description],
          ['Informations', p.general_info]
        ]
      : [
          ['Joueur', [p.first_name, p.last_name].filter(Boolean).join(' ')],
          ['Âge', p.age ? `${p.age} ans` : null],
          ['Ville', p.city],
          ['Poste principal', label('positions', p.positions?.[0])],
          [
            'Autres postes',
            p.positions
              ?.slice(1)
              .map((v) => label('positions', v))
              .join(', ')
          ],
          ['Pied', p.preferred_foot ? label('feet', p.preferred_foot) : null],
          ['Niveau', p.level],
          [
            'Disponibilité',
            p.availability_code ? label('availability', p.availability_code) : null
          ],
          ['Club actuel', p.current_club],
          ...(!compact
            ? [
                ['Anciens clubs', p.past_clubs],
                ['Expérience', p.experience],
                ['Biographie', p.biography]
              ]
            : []),
          [
            'Qualités',
            data.qualities
              ?.slice(0, compact ? 5 : 20)
              .map((q) => q.label)
              .join(', ')
          ],
          ['Saison', p.sport_season],
          ['Matchs', p.sport_stats?.appearances],
          ['Buts', p.sport_stats?.goals],
          ['Passes décisives', p.sport_stats?.assists]
        ];
  rows.push(['E-mail visible', p.email], ['Téléphone visible', p.phone]);
  for (const [title, value] of rows)
    if (value !== undefined && value !== null && value !== '') {
      dl.append(node('dt', title), node('dd', Array.isArray(value) ? value.join(', ') : value));
    }
  box.append(dl);
  return box;
}
