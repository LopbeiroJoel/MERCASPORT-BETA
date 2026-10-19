import {
  $,
  api,
  node,
  link,
  notice,
  options,
  identity,
  profileView,
  select,
  input,
  choices,
  values,
  run
} from './recruitment-ui.mjs';
let catalog, own;
const form = $('#cv-form');
async function init() {
  catalog = await options();
  const me = await identity();
  if (!me) return;
  $('#module-content').hidden = false;
  notice('');
  const query = new URLSearchParams(location.search),
    user = query.get('user'),
    club = query.get('club');
  if (user || club) {
    const data = await api(
      club
        ? `/clubs/${club}/public-profile`
        : `/profiles/${user}` +
            (query.get('conversation')
              ? '?conversation_id=' + encodeURIComponent(query.get('conversation'))
              : '')
    );
    $('#cv-preview').replaceChildren(profileView(data));
    form.hidden = true;
    return;
  }
  own = await api('/sport-profile/me');
  if (own.user.role !== 'PLAYER') {
    notice('La fiche sportive est réservée aux joueurs. Les clubs utilisent leur profil existant.');
    $('#cv-preview').append(link('Mon profil', 'profile.html'));
    return;
  }
  if (!own.profile) {
    notice('Votre fiche joueur est absente. Vous pouvez déjà contacter les clubs sans CV.');
    return;
  }
  const p = own.profile;
  $('#cv-preview').append(
    node(
      'p',
      'Complétez votre fiche existante. Aucune information n’est publiée sans votre accord.',
      'm-help'
    )
  );
  form.hidden = false;
  const fields = $('#cv-fields');
  const grid = node('div', null, 'm-form-grid');
  grid.append(
    select('sport_code', 'Sport', catalog.sports, p.sport_code),
    select('availability_code', 'Disponibilité', catalog.availability, p.availability_code),
    input('sport_city', 'Ville à partager', p.sport_city, 'text', 100),
    input('sport_season', 'Saison (ex. 2026/2027)', p.sport_season, 'text', 9),
    select(
      'preferred_foot',
      'Pied fort',
      catalog.feet.filter((v) => v.code !== 'ANY'),
      p.preferred_foot
    ),
    select('level', 'Niveau', catalog.divisions, p.level)
  );
  fields.append(
    grid,
    input('current_club', 'Club actuel', p.current_club),
    input('past_clubs', 'Anciens clubs', p.past_clubs, 'textarea', 2000),
    input('experience', 'Expérience', p.experience, 'textarea', 2000),
    select('primary_position', 'Poste principal', catalog.positions, p.positions?.[0]),
    choices(
      'secondary_positions',
      'Postes secondaires',
      catalog.positions,
      p.positions?.slice(1) || [],
      3
    )
  );
  if (p.positions.length > 4)
    fields.append(
      node(
        'p',
        'Votre ancienne fiche comporte plus de quatre postes. Ils restent conservés jusqu’à votre enregistrement ; choisissez alors un poste principal et trois secondaires au maximum.',
        'm-help'
      )
    );
  for (const [category, title] of [
    ['TECHNICAL', 'Qualités techniques'],
    ['PHYSICAL', 'Qualités physiques'],
    ['TACTICAL', 'Qualités tactiques'],
    ['MENTAL', 'Qualités mentales']
  ])
    fields.append(
      choices(
        'qualities',
        title,
        catalog.qualities.filter((q) => q.category === category),
        own.qualities,
        5
      )
    );
  const stats = node('div', null, 'm-form-grid');
  for (const [name, title] of [
    ['appearances', 'Matchs joués'],
    ['goals', 'Buts'],
    ['assists', 'Passes décisives']
  ]) {
    const field = input(name, title, p.sport_stats?.[name], 'number');
    field.querySelector('input').min = 0;
    field.querySelector('input').max = 99999;
    stats.append(field);
  }
  fields.append(node('h2', 'Statistiques de la saison'), stats);
  $('#cv-public').checked = p.is_public;
  form.onsubmit = (e) => {
    e.preventDefault();
    run($('#save-cv'), async () => {
      const raw = Object.fromEntries(new FormData(form)),
        body = {};
      for (const key of [
        'sport_code',
        'availability_code',
        'sport_city',
        'sport_season',
        'preferred_foot',
        'level',
        'current_club',
        'past_clubs',
        'experience'
      ])
        body[key] = raw[key] || null;
      const secondary = values(form, 'secondary_positions');
      if (raw.primary_position && secondary.includes(raw.primary_position))
        throw new Error('Le poste principal doit être différent des postes secondaires.');
      if (!raw.primary_position && secondary.length)
        throw new Error('Choisissez un poste principal avant les postes secondaires.');
      body.positions = [raw.primary_position, ...secondary].filter(Boolean);
      body.qualities = values(form, 'qualities');
      body.sport_stats = {};
      for (const k of ['appearances', 'goals', 'assists'])
        if (raw[k] !== '') body.sport_stats[k] = Number(raw[k]);
      body.is_public = $('#cv-public').checked;
      await api('/sport-profile/me', 'PATCH', body);
      notice('Votre fiche sportive a été enregistrée.');
    });
  };
}
init().catch((e) => notice(e.message, true));
