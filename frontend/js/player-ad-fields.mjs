import {
  api,
  node,
  button,
  choices,
  values,
  label,
  catalog as sharedCatalog
} from './recruitment-ui.mjs';
const categoryLabels = {
  TECHNICAL: 'Qualités techniques',
  PHYSICAL: 'Qualités physiques',
  TACTICAL: 'Qualités tactiques',
  MENTAL: 'Qualités mentales'
};
export function mountPlayerFields(container, catalog, ad = {}) {
  const controls = {},
    errors = {},
    details = ad.player_details || {};
  container.replaceChildren();
  const help = node(
    'p',
    'Les champs marqués * sont obligatoires pour publier. Les informations validées ici seront visibles dans votre annonce.',
    'publish-field-help'
  );
  container.append(help);
  function section(title) {
    const box = node('section', null, 'publish-section');
    box.append(node('h2', title));
    container.append(box);
    return box;
  }
  function control(
    parent,
    name,
    title,
    value,
    { required = false, type = 'text', max = 150, options, min, maxNumber } = {}
  ) {
    const box = node('div', null, 'publish-field'),
      caption = node('label', title + (required ? ' *' : ' (facultatif)')),
      input = node(options ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    input.name = name;
    input.id = 'ad-player-' + name.replaceAll('.', '-');
    caption.htmlFor = input.id;
    if (options) {
      const empty = node('option', 'Choisir');
      empty.value = '';
      input.append(empty);
      for (const item of options) {
        const option = node('option', item.label || item.code);
        option.value = item.code;
        input.append(option);
      }
    } else {
      if (type !== 'textarea') input.type = type;
      else input.rows = 4;
      input.maxLength = max;
    }
    input.required = required;
    if (min !== undefined) input.min = min;
    if (maxNumber !== undefined) input.max = maxNumber;
    input.value = value ?? '';
    const error = node('p', '', 'publish-error');
    error.id = input.id + '-error';
    input.setAttribute('aria-describedby', error.id);
    box.append(caption, input, error);
    parent.append(box);
    controls[name] = input;
    errors[name] = error;
    input.addEventListener('input', () => {
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    });
    return input;
  }
  function selection(parent, name, title, options, selected, max, required = false) {
    const box = choices(name, title + (required ? ' *' : ''), options, selected, max);
    box.classList.add('player-ad-choices');
    const error = node('p', '', 'publish-error');
    box.append(error);
    parent.append(box);
    controls[name] = box;
    errors[name] = error;
  }
  const search = section('Votre recherche de club');
  control(search, 'title', 'Titre de l’annonce', ad.title, { required: true });
  control(search, 'description', 'Présentez votre recherche', ad.description, {
    required: true,
    type: 'textarea',
    max: 5000
  });
  selection(
    search,
    'positions',
    'Postes que vous pouvez jouer',
    catalog.positions,
    ad.positions || [],
    2,
    true
  );
  control(search, 'division_code', 'Niveau recherché', ad.division_code, {
    required: true,
    options: catalog.divisions
  });
  control(search, 'city', 'Ville / localisation', ad.city, {
    required: true,
    max: 100
  });
  control(search, 'mobility_code', 'Rayon de mobilité', ad.mobility_code, {
    required: true,
    options: catalog.mobility
  });
  control(search, 'availability_code', 'Disponibilité', ad.availability_code, {
    required: true,
    options: catalog.availability
  });
  selection(
    search,
    'project_types',
    'Types de projet recherchés',
    catalog.project_types,
    ad.project_types || [],
    3,
    true
  );
  const career = section('Votre parcours');
  career.append(
    node(
      'p',
      'Sans club ou débutant ? Indiquez simplement « Aucun club », « Aucun ancien club » ou « Débutant », selon votre situation.',
      'publish-field-help'
    )
  );
  control(career, 'player_details.current_club', 'Club actuel', details.current_club, {
    required: true
  });
  control(career, 'player_details.past_clubs', 'Anciens clubs', details.past_clubs, {
    required: true,
    type: 'textarea',
    max: 2000
  });
  control(career, 'player_details.experience', 'Expérience', details.experience, {
    required: true,
    type: 'textarea',
    max: 2000
  });
  const optional = section('Informations facultatives');
  control(optional, 'player_details.age', 'Âge', details.age, {
    type: 'number',
    min: 5,
    maxNumber: 100
  });
  control(optional, 'player_details.height_cm', 'Taille en centimètres', details.height_cm, {
    type: 'number',
    min: 80,
    maxNumber: 250
  });
  control(
    optional,
    'preferred_foot_code',
    'Pied fort',
    catalog.feet.find((f) => f.label === ad.preferred_foot)?.code,
    { options: catalog.feet.filter((f) => f.code !== 'ANY') }
  );
  control(
    optional,
    'player_details.sport_season',
    'Saison des statistiques (ex. 2026/2027)',
    details.sport_season,
    { max: 9 }
  );
  for (const [key, title] of [
    ['appearances', 'Matchs joués'],
    ['goals', 'Buts'],
    ['assists', 'Passes décisives']
  ])
    control(optional, 'stats.' + key, title, details.sport_stats?.[key], {
      type: 'number',
      min: 0,
      maxNumber: 99999
    });
  for (const [category, title] of Object.entries(categoryLabels))
    selection(
      optional,
      'qualities_' + category,
      title,
      catalog.qualities.filter((q) => q.category === category),
      ad.qualities || [],
      5
    );
  const prefill = button('Proposer les informations de mon CV', async () => {
    const own = await api('/sport-profile/me'),
      p = own.profile;
    if (!p) {
      help.textContent =
        'Aucune fiche sportive à préremplir. Vous pouvez remplir directement votre annonce.';
      return;
    }
    const source = {
      city: p.sport_city,
      division_code: p.level,
      availability_code: p.availability_code,
      preferred_foot_code: p.preferred_foot,
      'player_details.current_club': p.current_club,
      'player_details.past_clubs': p.past_clubs,
      'player_details.experience': p.experience,
      'player_details.height_cm': p.height_cm,
      'player_details.sport_season': p.sport_season
    };
    if (p.birth_date) {
      const birth = new Date(p.birth_date),
        now = new Date();
      let age = now.getFullYear() - birth.getUTCFullYear();
      if (
        now.getMonth() < birth.getUTCMonth() ||
        (now.getMonth() === birth.getUTCMonth() && now.getDate() < birth.getUTCDate())
      )
        age--;
      source['player_details.age'] = age;
    }
    for (const key of ['appearances', 'goals', 'assists'])
      source['stats.' + key] = p.sport_stats?.[key];
    for (const [key, value] of Object.entries(source))
      if (value != null && !controls[key].value) controls[key].value = value;
    for (const key of [
      'positions',
      ...Object.keys(categoryLabels).map((c) => 'qualities_' + c)
    ]) {
      const box = controls[key];
      if (box.querySelector('input:checked')) continue;
      const selected =
        key === 'positions' ? (p.positions || []).slice(0, 2) : own.qualities || [];
      for (const check of box.querySelectorAll('input'))
        check.checked = selected.includes(check.value);
    }
    showErrors();
    help.textContent =
      'Informations du CV proposées. Vérifiez ce que vous souhaitez publier avant d’enregistrer.';
  });
  container.prepend(prefill);
  function read() {
    const data = {
      sport_code: ad.sport_code || 'FOOTBALL',
      positions: values(container, 'positions'),
      project_types: values(container, 'project_types'),
      qualities: Object.keys(categoryLabels).flatMap((c) =>
        values(container, 'qualities_' + c)
      ),
      player_details: {}
    };
    for (const key of [
      'title',
      'description',
      'division_code',
      'city',
      'mobility_code',
      'availability_code',
      'preferred_foot_code'
    ])
      data[key] = controls[key].value.trim() || null;
    for (const key of ['current_club', 'past_clubs', 'experience', 'sport_season'])
      data.player_details[key] = controls['player_details.' + key].value.trim() || null;
    for (const key of ['age', 'height_cm'])
      data.player_details[key] =
        controls['player_details.' + key].value === ''
          ? null
          : Number(controls['player_details.' + key].value);
    data.player_details.sport_stats = {};
    for (const key of ['appearances', 'goals', 'assists'])
      if (controls['stats.' + key].value !== '')
        data.player_details.sport_stats[key] = Number(controls['stats.' + key].value);
    return data;
  }
  function validate(published = true) {
    const result = {};
    if (published) {
      for (const key of [
        'title',
        'description',
        'division_code',
        'city',
        'mobility_code',
        'availability_code',
        'player_details.current_club',
        'player_details.past_clubs',
        'player_details.experience'
      ])
        if (!controls[key].value.trim()) result[key] = 'Ce champ est obligatoire.';
      for (const key of ['positions', 'project_types'])
        if (!values(container, key).length) result[key] = 'Choisir au moins une option.';
    }
    for (const [key, input] of Object.entries(controls))
      if (input.matches('input,textarea,select') && input.value && !input.validity.valid)
        result[key] = 'Vérifiez la valeur et sa longueur.';
    if (
      controls['player_details.sport_season'].value &&
      !/^\d{4}\/\d{4}$/.test(controls['player_details.sport_season'].value)
    )
      result['player_details.sport_season'] = 'Utiliser le format 2026/2027.';
    return result;
  }
  function showErrors(values = {}) {
    for (const [key, target] of Object.entries(errors)) {
      target.textContent = values[key] || '';
      controls[key].setAttribute('aria-invalid', String(!!values[key]));
    }
    const first = Object.keys(values).find((k) => controls[k]);
    if (first) {
      const control = controls[first];
      (control.matches('fieldset') ? control.querySelector('input') : control)?.focus();
    }
  }
  return { read, validate, showErrors };
}

export function playerDetailsView(ad) {
  const data = ad.player_details || {},
    box = node('dl', null, 'player-ad-public-details');
  function add(title, value) {
    if (value == null || value === '') return;
    box.append(node('dt', title), node('dd', value));
  }
  add('Mobilité', ad.mobility_code ? label('mobility', ad.mobility_code) : null);
  add('Projets recherchés', ad.project_types?.map((v) => label('project_types', v)).join(', '));
  add('Club actuel', data.current_club);
  add('Anciens clubs', data.past_clubs);
  add('Expérience', data.experience);
  add('Âge', data.age ? data.age + ' ans' : null);
  add('Taille', data.height_cm ? data.height_cm + ' cm' : null);
  add('Pied fort', ad.preferred_foot);
  add('Saison', data.sport_season);
  for (const [key, title] of [
    ['appearances', 'Matchs'],
    ['goals', 'Buts'],
    ['assists', 'Passes décisives']
  ])
    if (data.sport_stats?.[key] != null) add(title, String(data.sport_stats[key]));
  for (const [category, title] of Object.entries(categoryLabels)) {
    const selected = (ad.qualities || []).filter(
      (code) => catalogQualityCategory(code) === category
    );
    add(title, selected.map((q) => label('qualities', q)).join(', '));
  }
  return box;
}
// Le catalogue partagé a déjà été chargé par les pages avant l'affichage.
const catalogQualityCategory = (code) =>
  sharedCatalog?.qualities.find((q) => q.code === code)?.category;
