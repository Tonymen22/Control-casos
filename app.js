'use strict';
const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const storageKey = 'gestion-riesgos-v1';
const initial = {
  people: ['Luis Menendez', 'Julio Hernández', 'Renato Escobar', 'Roger González', 'Andrés López']
    .map((name, index) => ({ id: String(index + 1), name, active: true })),
  cases: []
};
let data;
let storageError = false;
try {
  data = JSON.parse(localStorage.getItem(storageKey)) ?? initial;
} catch {
  storageError = true;
  data = initial;
}
const views = {
  dashboard: ['Dashboard', 'Consulta la carga de trabajo y los próximos vencimientos.'],
  cases: ['Casos', 'Registra, asigna y actualiza los casos de riesgos.'],
  calendar: ['Calendario', 'Consulta los casos por fecha de plazo.'],
  people: ['Analistas', 'Administra las opciones de la lista de asignación.']
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
const nameOf = id => data.people.find(person => person.id === id)?.name ?? 'Sin analista';
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
      <small>${escape(nameOf(record.person))} · Plazo ${formatDate(record.due)}</small></button>
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
    normalize([record.topic, record.number, record.office, nameOf(record.person)].join(' ')).includes(normalize(query.trim())));
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
  const cells = Array.from({ length: count }, (_, index) => {
    const day = month + '-' + String(index + 1).padStart(2, '0');
    const total = monthCases.filter(record => record.due === day).length;
    return `<button class="day ${day === today() ? 'today' : ''}" data-day="${day}" aria-pressed="${day === selected}"
      aria-label="${formatDate(day)}, ${total} casos">${index + 1}${total ? `<small>${total} caso${total === 1 ? '' : 's'}</small>` : ''}</button>`;
  }).join('');
  return `<section class="card"><div class="row"><h2>${monthFormat.format(first)}</h2><div class="calendar-actions">
    <button class="action" data-month="-1" aria-label="Mes anterior">‹</button><button class="action" data-today>Hoy</button>
    <button class="action" data-month="1" aria-label="Mes siguiente">›</button></div></div>
    <div class="calendar">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(day => `<span class="weekday">${day}</span>`).join('')}
    ${'<span></span>'.repeat(leading)}${cells}</div><h2 class="section-title">${formatDate(selected)}</h2>
    ${caseRows(monthCases.filter(record => record.due === selected), 'Sin plazos para este día.')}</section>`;
}
function people() {
  return `<section class="card"><h2 class="section-title">Lista de asignación</h2>${data.people.map(person =>
    `<article class="person row"><div><strong>${escape(person.name)}</strong><small>${person.active ? 'Activo' : 'Inactivo'}</small></div>
    <button class="action" data-edit-person="${escape(person.id)}" aria-label="Editar a ${escape(person.name)}">Editar</button></article>`).join('')}</section>`;
}
function render() {
  document.querySelectorAll('nav button').forEach(button => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const [title, description] = views[view];
  const action = view === 'people' ? '<button class="action primary" data-edit-person="">Añadir analista</button>' :
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
  const options = data.people.filter(person => person.active || person.id === record.person);
  if (!options.length) {
    notify('Activa o añade un analista antes de asignar un caso.');
    return;
  }
  const field = (key, label, limit) => `<label>${label}<input name="${key}" value="${escape(record[key])}" maxlength="${limit}" required></label>`;
  openForm(existing ? 'Editar caso' : 'Nuevo caso', `
    <div class="fields">${field('office', 'Número de oficio', 100)}${field('number', 'Número de caso', 100)}</div>
    ${field('topic', 'Tema', 300)}
    <label>Analista<select name="person" required><option value="">Seleccionar analista</option>${options.map(person =>
    `<option value="${escape(person.id)}" ${record.person === person.id ? 'selected' : ''}>${escape(person.name)}${person.active ? '' : ' (inactivo)'}</option>`).join('')}</select></label>
    <div class="fields"><label>Fecha de asignación<input name="assigned" type="date" required value="${escape(record.assigned)}"></label>
    <label>Fecha de plazo<input name="due" type="date" required value="${escape(record.due)}"></label></div>
    <label>Estado<select name="state"><option value="open">En seguimiento</option><option value="closed" ${record.closed ? 'selected' : ''}>Cerrado</option></select></label>`,
    (form, values) => {
      const { person, assigned, due, state } = values;
      const [office, number, topic] = ['office','number','topic'].map(key => values[key].trim());
      const error = form.querySelector('.error');
      if (!office || !number || !topic) { error.textContent = 'Completa el oficio, el número de caso y el tema.'; return; }
      if (due < assigned) { error.textContent = 'El plazo debe ser igual o posterior a la asignación.'; return; }
      if (data.cases.some(item => item.id !== id && normalize(item.number) === normalize(number))) {
        error.textContent = 'Ya existe un caso con ese número.'; return;
      }
      const item = { id: id || crypto.randomUUID(), office, number, topic, person, assigned, due, closed: state === 'closed' };
      save({ ...data, cases: existing ? data.cases.map(entry => entry.id === id ? item : entry) : [...data.cases, item] }, 'Caso guardado.');
    }, existing ? `<button type="button" class="action danger" data-delete-case="${escape(id)}">Eliminar</button>` : '');
}
function personEditor(id) {
  const person = data.people.find(entry => entry.id === id);
  openForm(person ? 'Editar analista' : 'Añadir analista', `
    <label>Nombre<input name="name" required maxlength="100" value="${escape(person?.name)}"></label>
    <label>Disponibilidad<select name="active"><option value="yes">Activo</option><option value="no" ${person?.active === false ? 'selected' : ''}>Inactivo</option></select></label>`,
    (form, values) => {
      const name = values.name.trim();
      if (!name || data.people.some(entry => entry.id !== id && normalize(entry.name) === normalize(name))) {
        form.querySelector('.error').textContent = 'Ingresa un nombre válido que no esté en la lista.';
        return;
      }
      const item = { id: id || crypto.randomUUID(), name, active: values.active === 'yes' };
      save({ ...data, people: person ? data.people.map(entry => entry.id === id ? item : entry) : [...data.people, item] }, 'Analista guardado.');
    });
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const { dataset } = button;
  if ('view' in dataset) { view = dataset.view; render(); window.scrollTo(0, 0); }
  if ('editCase' in dataset) caseEditor(dataset.editCase);
  if ('editPerson' in dataset) personEditor(dataset.editPerson);
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
    data = JSON.parse(event.newValue);
    if (dialog.open) dialog.close();
    render();
  }
});
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
