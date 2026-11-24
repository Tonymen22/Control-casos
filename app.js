'use strict';
const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const storageKey = 'gestion-riesgos-v1';
const catalogLabels = {
  people: 'Analistas de riesgos',
  researchers: 'Analistas de investigación',
  departments: 'Dependencias solicitantes',
  types: 'Tipos de caso'
};
const typeDetails = {
  matrix: 'Matriz',
  research: 'Investigación',
  followup: 'Seguimiento'
};
const initial = {
  people: ['Luis Menendez', 'Julio Hernández', 'Renato Escobar', 'Roger González', 'Andrés López']
    .map((name, index) => ({ id: String(index + 1), name, active: true })),
  researchers: [
    { id: 'william', name: 'William Espinoza', active: true },
    { id: 'victor', name: 'Victor de León', active: true }
  ],
  departments: [
    { id: 'dit', name: 'Departamento de Infraestructura Tecnológica', active: true },
    { id: 'dgpt', name: 'Departamento de Gestión de Proyectos Tecnológicos', active: true }
  ],
  types: [
    { id: 'matrix', name: 'Matriz de Riesgos', mode: 'matrix', active: true },
    { id: 'research', name: 'Investigación con Matriz de Riesgos', mode: 'research', active: true },
    { id: 'followup', name: 'Seguimiento de Matriz de Riesgos', mode: 'followup', active: true }
  ],
  cases: []
};
let data;
let storageError = false;
try {
  data = { ...initial, ...JSON.parse(localStorage.getItem(storageKey)) };
} catch {
  storageError = true;
  data = initial;
}
const views = {
  dashboard: ['Dashboard', 'Consulta la carga de trabajo y los próximos vencimientos.'],
  cases: ['Casos', 'Registra, asigna y actualiza los casos de riesgos.'],
  calendar: ['Calendario', 'Consulta los casos por fecha de plazo.'],
  people: ['Catálogos', 'Administra los tipos de caso, responsables y dependencias solicitantes.']
};
let view = 'dashboard';
let selected = today();
let month = selected.slice(0, 7);
let query = '';
let filter = '';
let noticeTimer;
const dateFormat = new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('es-GT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
const formatDate = value => dateFormat.format(new Date(value + 'T00:00:00Z'));
const entryOf = (group, id) => data[group].find(entry => entry.id === id);
const nameOf = id => entryOf('people', id)?.name ?? 'Sin analista';
const typeOf = record => entryOf('types', record.type ?? 'matrix');
const catalogOptions = (group, selected) => data[group]
  .filter(entry => entry.active || entry.id === selected)
  .map(entry => `<option value="${escape(entry.id)}" ${entry.id === selected ? 'selected' : ''}>${escape(entry.name)}${entry.active ? '' : ' (inactivo)'}</option>`).join('');
const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const sortDue = (a, b) => a.due.localeCompare(b.due) || a.number.localeCompare(b.number);
function today() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts();
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
}
function daysLeft(due) {
  return (Date.parse(due) - Date.parse(today())) / 86400000;
}
function status(record) {
  if (record.closed) return ['Cerrado', 'done'];
  const days = daysLeft(record.due);
  if (days < 0) return ['Vencido', 'late'];
  if (days === 0) return ['Vence hoy', 'soon'];
  if (days <= 7) return ['Próximo', 'soon'];
  return ['Asignado', ''];
}
function notify(message) {
  const notice = document.querySelector('#notice');
  notice.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 4200);
}
function save(next, message) {
  try {
    if (storageError) throw new Error('Storage unavailable');
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    const error = dialog.querySelector('.error');
    if (error) error.textContent = 'No se pudo guardar en este dispositivo.';
    else notify('No se pudo guardar en este dispositivo.');
    return;
  }
  data = next;
  if (dialog.open) dialog.close();
  render();
  notify(message);
}
function caseRows(records, empty) {
  if (!records.length) return '<p class="empty">' + escape(empty) + '</p>';
  return records.map(record => {
    const [label, tone] = status(record);
    return `<article class="case row"><button data-edit-case="${escape(record.id)}"><strong>${escape(record.topic)}</strong>
      <small>Caso ${escape(record.number)} · Oficio ${escape(record.office)}</small>
      <small>${escape(nameOf(record.person))} · Plazo ${formatDate(record.due)}</small>
      <small>${escape(typeOf(record)?.name)}${record.department ? ' · ' + escape(entryOf('departments', record.department)?.name) : ''}</small>
      ${record.researcher ? `<small>Investigación · ${escape(entryOf('researchers', record.researcher)?.name)}</small>` : ''}
      ${record.origin ? `<small>Oficio de la matriz enviada · ${escape(record.origin)}</small>` : ''}</button>
      <span class="pill ${tone}">${label}</span></article>`;
  }).join('');
}
function dashboard() {
  const open = data.cases.filter(record => !record.closed);
  const upcoming = open.filter(record => daysLeft(record.due) >= 0 && daysLeft(record.due) <= 7);
  const overdue = open.filter(record => daysLeft(record.due) < 0);
  const counts = [['Total de casos', data.cases.length], ['En seguimiento', open.length], ['Vencen en 7 días', upcoming.length], ['Vencidos', overdue.length]];
  return `<div class="stats">${counts.map(([label, count]) => `<div class="card stat"><span>${label}</span><strong>${count}</strong></div>`).join('')}</div>
    <section class="card"><h2 class="section-title">Plazos pendientes</h2>${caseRows(open.slice().sort(sortDue).slice(0, 8), 'Aquí aparecerán los plazos de los casos abiertos.')}</section>`;
}
function filteredCases() {
  const matches = data.cases.filter(record => (!filter || record.person === filter) &&
    normalize([record.topic, record.number, record.office, nameOf(record.person), typeOf(record)?.name, entryOf('departments', record.department)?.name].join(' ')).includes(normalize(query.trim())));
  main.querySelector('#case-results').innerHTML = caseRows(matches.sort(sortDue), 'No hay casos que coincidan.');
}
function cases() {
  return `<section class="card"><div class="toolbar"><input id="search" type="search" aria-label="Buscar casos" placeholder="Buscar por caso, oficio o tema" value="${escape(query)}">
    <select id="filter" aria-label="Filtrar por analista"><option value="">Todos los analistas</option>${data.people.map(person =>
    `<option value="${escape(person.id)}" ${filter === person.id ? 'selected' : ''}>${escape(person.name)}</option>`).join('')}</select></div><div id="case-results"></div></section>`;
}
function calendar() {
  const first = new Date(month + '-01T00:00:00Z');
  const leading = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const monthCases = data.cases.filter(record => record.due.slice(0, 7) === month);
  const entries = record => {
    const mode = typeOf(record)?.mode ?? 'matrix';
    return `<button class="event event-${mode}" data-edit-case="${escape(record.id)}">
      <strong>Oficio ${escape(record.office)}</strong><span>${escape(nameOf(record.person))}</span>
      <small>${escape(typeOf(record)?.name)}</small></button>`;
  };
  const cells = Array.from({ length: count }, (_, index) => {
    const day = month + '-' + String(index + 1).padStart(2, '0');
    const records = monthCases.filter(record => record.due === day).sort(sortDue);
    return `<div class="calendar-cell"><button class="day ${day === today() ? 'today' : ''}" data-day="${day}" aria-pressed="${day === selected}"
      aria-label="${formatDate(day)}, ${records.length} casos">${index + 1}
      <span class="day-count">${records.length || ''}</span></button><div class="events">${records.map(entries).join('')}</div></div>`;
  }).join('');
  return `<section class="card"><div class="row"><h2>${monthFormat.format(first)}</h2><div class="calendar-actions">
    <button class="action" data-month="-1" aria-label="Mes anterior">‹</button><button class="action" data-today>Hoy</button>
    <button class="action" data-month="1" aria-label="Mes siguiente">›</button></div></div>
    <div class="legend">${Object.entries(typeDetails).map(([mode, label]) =>
    `<span class="event-${mode}">${label}</span>`).join('')}</div>
    <div class="calendar">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(day => `<span class="weekday">${day}</span>`).join('')}
    ${'<span></span>'.repeat(leading)}${cells}</div><h2 class="section-title">${formatDate(selected)}</h2>
    ${caseRows(monthCases.filter(record => record.due === selected), 'Sin plazos para este día.')}
    <div class="mobile-agenda"><h2>Plazos del mes</h2>${monthCases.length ?
      [...new Set(monthCases.map(record => record.due))].sort().map(day =>
        `<section><h3>${formatDate(day)}</h3>${monthCases.filter(record => record.due === day).sort(sortDue).map(entries).join('')}</section>`).join('') :
      '<p class="empty">Sin plazos para este mes.</p>'}</div></section>`;
}
function people() {
  return `<div class="catalog-grid">${Object.entries(catalogLabels).map(([group, label]) =>
    `<section class="card"><div class="row section-title"><h2>${label}</h2>
      <button class="action" data-catalog="${group}" data-entry="">Añadir</button></div>
      ${data[group].map(entry => `<article class="person row"><div><strong>${escape(entry.name)}</strong>
        <small>${entry.active ? 'Activo' : 'Inactivo'}${entry.mode ? ' · ' + typeDetails[entry.mode] : ''}</small></div>
        <button class="action" data-catalog="${group}" data-entry="${escape(entry.id)}" aria-label="Editar ${escape(entry.name)}">Editar</button></article>`).join('')}</section>`).join('')}</div>`;
}
function render() {
  document.querySelectorAll('nav button').forEach(button => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const [title, description] = views[view];
  const action = view === 'people' ? '' :
    '<button class="action primary" data-edit-case="">+ Nuevo caso</button>';
  main.innerHTML = `<header><div><div class="eyebrow">Gestión de Riesgos</div><h1>${title}</h1><p>${description}</p></div>${action}</header>
    ${storageError ? '<p class="error">No se pudo abrir el almacenamiento local.</p>' : ''}
    ${({ dashboard, cases, calendar, people })[view]()}`;
  if (view === 'cases') filteredCases();
}
function openForm(title, fields, submit, deleteAttrs = '') {
  dialog.innerHTML = `<div class="row"><h2 id="dialog-title">${title}</h2><button type="button" class="action" data-cancel aria-label="Cerrar">×</button></div>
    <form>${fields}<div class="error" role="alert"></div><div class="buttons">${deleteAttrs}
    <button type="button" class="action" data-cancel>Cancelar</button><button class="action primary">Guardar</button></div></form>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    submit(event.currentTarget, Object.fromEntries(new FormData(event.currentTarget)));
  });
  if (!dialog.open) dialog.showModal();
}
function caseEditor(id) {
  const existing = data.cases.find(record => record.id === id);
  const record = existing ?? { assigned: today() };
  const currentType = existing ? record.type ?? 'matrix' : '';
  const options = data.people.filter(person => person.active || person.id === record.person);
  if (!options.length) {
    notify('Activa o añade un analista antes de asignar un caso.');
    return;
  }
  const field = (key, label, limit) => `<label>${label}<input name="${key}" value="${escape(record[key])}" maxlength="${limit}" required></label>`;
  openForm(existing ? 'Editar caso' : 'Nuevo caso', `
    <div class="fields">${field('office', 'Número de oficio', 100)}${field('number', 'Número de caso', 100)}</div>
    ${field('topic', 'Tema', 300)}
    <label>Tipo de caso<select name="type" required><option value="">Seleccionar tipo</option>${catalogOptions('types', currentType)}</select></label>
    <label>Dependencia solicitante<select name="department" required><option value="">Seleccionar dependencia</option>${catalogOptions('departments', record.department)}</select></label>
    <label id="research-field" hidden>Responsable de investigación<select name="researcher"><option value="">Seleccionar responsable</option>${catalogOptions('researchers', record.researcher)}</select></label>
    <label id="followup-field" hidden>Oficio de la matriz enviada
      <input name="origin" list="matrix-offices" maxlength="100" value="${escape(record.origin)}" placeholder="Seleccionar o escribir el oficio">
      <datalist id="matrix-offices">${[...new Set(data.cases.filter(item => item.id !== id && typeOf(item)?.mode !== 'followup').map(item => item.office))]
      .map(office => `<option value="${escape(office)}"></option>`).join('')}</datalist></label>
    <label>Analista<select name="person" required><option value="">Seleccionar analista</option>${options.map(person =>
    `<option value="${escape(person.id)}" ${record.person === person.id ? 'selected' : ''}>${escape(person.name)}${person.active ? '' : ' (inactivo)'}</option>`).join('')}</select></label>
    <div class="fields"><label>Fecha de asignación<input name="assigned" type="date" required value="${escape(record.assigned)}"></label>
    <label>Fecha de plazo<input name="due" type="date" required value="${escape(record.due)}"></label></div>
    <label>Estado<select name="state"><option value="open">En seguimiento</option><option value="closed" ${record.closed ? 'selected' : ''}>Cerrado</option></select></label>`,
    (form, values) => {
      const { person, assigned, due, state, type, department } = values;
      const mode = entryOf('types', type)?.mode;
      const researcher = mode === 'research' ? values.researcher : '';
      const origin = mode === 'followup' ? values.origin?.trim() : '';
      const [office, number, topic] = ['office','number','topic'].map(key => values[key].trim());
      const error = form.querySelector('.error');
      if (!office || !number || !topic) { error.textContent = 'Completa el oficio, el número de caso y el tema.'; return; }
      if (!mode || !entryOf('departments', department)) { error.textContent = 'Selecciona el tipo de caso y la dependencia solicitante.'; return; }
      if (mode === 'research' && !entryOf('researchers', researcher)) { error.textContent = 'Selecciona el responsable de investigación.'; return; }
      if (mode === 'followup' && !origin) { error.textContent = 'Indica el oficio de la matriz enviada.'; return; }
      if (due < assigned) { error.textContent = 'El plazo debe ser igual o posterior a la asignación.'; return; }
      if (data.cases.some(item => item.id !== id && normalize(item.number) === normalize(number) &&
        (mode === 'followup' ? normalize(item.office) === normalize(office) : typeOf(item)?.mode !== 'followup' || normalize(item.office) === normalize(office)))) {
        error.textContent = 'Ya existe un registro con el mismo número de caso para esta asignación.'; return;
      }
      const item = { id: id || crypto.randomUUID(), office, number, topic, person, assigned, due, type, department, researcher, origin, closed: state === 'closed' };
      save({ ...data, cases: existing ? data.cases.map(entry => entry.id === id ? item : entry) : [...data.cases, item] }, 'Caso guardado.');
    }, existing ? `<button type="button" class="action danger" data-delete-case="${escape(id)}">Eliminar</button>` : '');
  const typeSelect = dialog.querySelector('[name="type"]');
  const updateFields = () => {
    const mode = entryOf('types', typeSelect.value)?.mode;
    for (const [selector, name, condition] of [
      ['#research-field', 'researcher', mode === 'research'],
      ['#followup-field', 'origin', mode === 'followup']
    ]) {
      const field = dialog.querySelector(selector);
      const control = field.querySelector(`[name="${name}"]`);
      field.hidden = !condition;
      control.disabled = !condition;
      control.required = condition;
    }
  };
  typeSelect.addEventListener('change', updateFields);
  updateFields();
}
function catalogEditor(group, id) {
  const entry = entryOf(group, id);
  const modeField = group === 'types' ? `<label>Comportamiento<select name="mode" ${entry ? 'disabled' : ''}>
    ${Object.entries(typeDetails).map(([mode, label]) =>
      `<option value="${mode}" ${entry?.mode === mode ? 'selected' : ''}>${label}</option>`).join('')}</select></label>` : '';
  openForm(entry ? 'Editar opción' : 'Añadir opción', `
    <label>Nombre<input name="name" required maxlength="150" value="${escape(entry?.name)}"></label>
    ${modeField}
    <label>Disponibilidad<select name="active"><option value="yes">Activo</option><option value="no" ${entry?.active === false ? 'selected' : ''}>Inactivo</option></select></label>`,
    (form, values) => {
      const name = values.name.trim();
      if (!name || data[group].some(item => item.id !== id && normalize(item.name) === normalize(name))) {
        form.querySelector('.error').textContent = 'Ingresa un nombre válido que no esté en este catálogo.';
        return;
      }
      const item = { id: id || crypto.randomUUID(), name, active: values.active === 'yes' };
      if (group === 'types') item.mode = entry?.mode ?? values.mode;
      save({ ...data, [group]: entry ? data[group].map(option => option.id === id ? item : option) : [...data[group], item] }, 'Opción guardada.');
    });
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const { dataset } = button;
  if ('view' in dataset) { view = dataset.view; render(); window.scrollTo(0, 0); }
  if ('editCase' in dataset) caseEditor(dataset.editCase);
  if ('catalog' in dataset) catalogEditor(dataset.catalog, dataset.entry);
  if ('cancel' in dataset) dialog.close();
  if ('deleteCase' in dataset && confirm('¿Eliminar este caso permanentemente?')) {
    save({ ...data, cases: data.cases.filter(record => record.id !== dataset.deleteCase) }, 'Caso eliminado.');
  }
  if ('day' in dataset) {
    selected = dataset.day;
    render();
    main.querySelector('[aria-pressed="true"]').focus();
  }
  if ('today' in dataset) { selected = today(); month = selected.slice(0, 7); render(); }
  if ('month' in dataset) {
    const cursor = new Date(month + '-01T00:00:00Z');
    cursor.setUTCMonth(cursor.getUTCMonth() + Number(dataset.month));
    selected = cursor.toISOString().slice(0, 10);
    month = selected.slice(0, 7);
    render();
  }
});
main.addEventListener('input', event => {
  if (event.target.id === 'search') { query = event.target.value; filteredCases(); }
});
main.addEventListener('change', event => {
  if (event.target.id === 'filter') { filter = event.target.value; filteredCases(); }
});
window.addEventListener('storage', event => {
  if (event.key === storageKey && event.newValue) {
    data = { ...initial, ...JSON.parse(event.newValue) };
    if (dialog.open) dialog.close();
    render();
  }
});
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
