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
let data = initial;
let localData;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && Array.isArray(saved.cases) && Array.isArray(saved.people)) localData = { ...initial, ...saved };
} catch {
  // A local backup is optional.
}
let client;
let account;
let role;
let analystCatalogId;
let globalDashboard;
const canManage = () => role === 'admin';
let revision;
let ready = false;
let busy = false;
let generation = 0;
const shell = document.querySelector('aside');
const sessionBar = document.querySelector('#session');
const views = {
  dashboard: ['Dashboard', 'Consulta la carga de trabajo y los próximos vencimientos.'],
  cases: ['Casos', 'Registra, asigna y actualiza los casos de riesgos.'],
  calendar: ['Agenda', 'Consulta lo que requiere atención y las fechas del equipo.'],
  reports: ['Reportes', 'Consulta el informe mensual y guárdalo como PDF.'],
  people: ['Catálogos', 'Administra los tipos de caso, responsables y dependencias solicitantes.']
};
let view = 'dashboard';
let agendaView = 'pending';
let agendaPerson = '';
let selected = today();
let month = selected.slice(0, 7);
let query = '';
let filter = '';
let drillFilter = null;
let caseTab = '';
let pendingFilter = '';
let caseSort = 'correlativo';
const defaultReport = () => ({mode:'monthly',month:today().slice(0,7),person:'',department:'',type:'',details:true,notes:false});
let reportSettings = defaultReport();
let noticeTimer;
const dateFormat = new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('es-GT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
const formatDate = value => value ? dateFormat.format(new Date(value + 'T00:00:00Z')) : 'Sin fecha';
const entryOf = (group, id) => data[group].find(entry => entry.id === id);
const nameOf = id => entryOf('people', id)?.name ?? 'Sin analista';
const typeOf = record => entryOf('types', record.type ?? 'matrix');
const caseMode = record => typeOf(record)?.mode ?? 'matrix';
const caseCategories = {
  matrix: 'Matrices',
  research: 'Investigaciones con matriz',
  followup: 'Seguimientos'
};
function correlate(value) {
  const match = /^(MRT|SEG)-(\d{1,9})-(\d{4})$/i.exec((value ?? '').trim());
  if (!match || Number(match[2]) < 1) return null;
  const prefix = match[1].toUpperCase();
  const sequence = Number(match[2]);
  return {prefix, sequence, year: match[3], key: prefix + '-' + match[3]};
}
function sequenceMarks(...snapshots) {
  const marks = {};
  for (const snapshot of snapshots) {
    for (const [key, value] of Object.entries(snapshot.sequenceMarks ?? {})) {
      if (/^(MRT|SEG)-\d{4}$/.test(key) && Number.isSafeInteger(value)) marks[key] = Math.max(marks[key] ?? 0,value);
    }
    for (const record of snapshot.cases) {
      for (const value of [record.matrix,record.followupNumber]) {
        const parsed = correlate(value);
        if (parsed) marks[parsed.key] = Math.max(marks[parsed.key] ?? 0,parsed.sequence);
      }
    }
  }
  return marks;
}
const formatSequence = (prefix, sequence, year) => `${prefix}-${String(sequence).padStart(2,'0')}-${year}`;
const caseIdentifier = record => caseMode(record) === 'followup' ? record.followupNumber : record.matrix;
const compareNames = new Intl.Collator('es-GT', {sensitivity:'base', numeric:true}).compare;
const sortedCatalog = group => [...data[group]].sort((a,b) => compareNames(a.name,b.name));
const catalogOptions = (group, selected) => sortedCatalog(group)
  .filter(entry => entry.active || entry.id === selected)
  .map(entry => `<option value="${escape(entry.id)}" ${entry.id === selected ? 'selected' : ''}>${escape(entry.name)}${entry.active ? '' : ' (inactivo)'}</option>`).join('');
const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const sortDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.number ?? '').localeCompare(b.number ?? '');
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
  if (!record.due) return ['Sin plazo', ''];
  const days = daysLeft(record.due);
  if (days < 0) return ['Vencido', 'late'];
  if (days === 0) return ['Vence hoy', 'soon'];
  if (days <= 7) return ['Próximo', 'soon'];
  return ['Pendiente', ''];
}
function notify(message) {
  const notice = document.querySelector('#notice');
  notice.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 4200);
}
function showGate(title, message, controls = '') {
  shell.hidden = true;
  sessionBar.hidden = true;
  main.classList.add('gated');
  main.innerHTML = `<section class="card login-card"><div class="eyebrow">Gestión de Riesgos</div>
    <h1>${escape(title)}</h1><p>${escape(message)}</p>${controls}</section>`;
}
function showLogin(message = 'Inicia sesión para acceder a Gestión de Riesgos.') {
  showGate('Iniciar sesión', message, `<form id="login-form">
    <label>Correo electrónico<input type="email" name="email" autocomplete="username" required></label>
    <label>Contraseña<input type="password" name="password" autocomplete="current-password" required></label>
    <button class="action primary">Entrar</button><p class="error" role="alert"></p></form>`);
}
async function loadWorkspace({ quiet = false } = {}) {
  if (!account || busy || dialog.open) return;
  busy = true;
  const request = generation;
  try {
    const membership = await client.from('risk_access').select('role, catalog_id').eq('user_id', account.id).maybeSingle();
    if (request !== generation) return;
    if (membership.error) throw membership.error;
    const nextRole = membership.data?.role;
    if (!nextRole) {
      ready = false;
      role = undefined;
      data = initial;
      showGate('Acceso pendiente', 'Pide al administrador que vincule esta cuenta.',
        '<div class="buttons gate-actions"><button class="action" data-logout>Cerrar sesión</button><button class="action primary" data-reload>Reintentar</button></div>');
      return;
    }
    const admin = nextRole === 'admin';
    const result = admin
      ? await client.from('risk_workspace').select('payload, revision').eq('owner_id', account.id).maybeSingle()
      : await client.rpc('risk_my_cases');
    if (request !== generation) return;
    if (result.error) throw result.error;
    if (!admin && !result.data) {
      ready = false;
      role = undefined;
      data = initial;
      showGate('Acceso pendiente', 'Pide al administrador que revise la vinculación de esta cuenta.',
        '<div class="buttons gate-actions"><button class="action" data-logout>Cerrar sesión</button><button class="action primary" data-reload>Reintentar</button></div>');
      return;
    }
    const summary = admin ? null : await client.rpc('risk_global_dashboard');
    if (request !== generation) return;
    if (summary?.error || (summary && !summary.data)) throw new Error('Dashboard no disponible');
    globalDashboard = summary?.data;
    if (role !== nextRole) {
      view = admin ? 'dashboard' : 'cases';
      filter = '';
      drillFilter = null;
      caseTab = '';
      pendingFilter = '';
      query = '';
    }
    role = nextRole;
    analystCatalogId = membership.data.catalog_id;
    data = (admin ? result.data?.payload : result.data) ?? initial;
    if (!admin && globalDashboard.departments.length) data = { ...data, departments: globalDashboard.departments };
    revision = admin ? result.data?.revision ?? null : null;
    ready = true;
    render();
  } catch {
    if (request !== generation) return;
    if (ready) {
      if (!quiet) notify('No se pudo actualizar. Intenta de nuevo.');
    } else {
      showGate('No se pudieron cargar los casos', 'Verifica la conexión y que el esquema esté instalado en Supabase.',
        '<div class="buttons gate-actions"><button class="action" data-logout>Cerrar sesión</button><button class="action primary" data-reload>Reintentar</button></div>');
    }
  } finally {
    if (request === generation) busy = false;
  }
}
function activateSession(session) {
  const user = session?.user;
  if (user?.id === account?.id && ready) return;
  generation++;
  account = user;
  role = undefined;
  analystCatalogId = undefined;
  globalDashboard = undefined;
  ready = false;
  busy = false;
  data = initial;
  revision = null;
  view = 'dashboard';
  query = '';
  filter = '';
  drillFilter = null;
  caseTab = '';
  pendingFilter = '';
  agendaView = 'pending';
  agendaPerson = '';
  reportSettings = defaultReport();
  if (dialog.open) dialog.close();
  document.querySelector('#notice').textContent = '';
  if (!account) {
    showLogin();
    return;
  }
  showGate('Cargando casos', 'Conectando con Supabase…');
  void loadWorkspace();
}
function showSaveError(message) {
  const error = dialog.open && dialog.querySelector('.error');
  if (error) error.textContent = message;
  else notify(message);
}
async function save(next, message) {
  if (!ready || !account || !canManage() || busy) {
    showSaveError('Hay una operación en curso. Intenta de nuevo.');
    return;
  }
  busy = true;
  const request = generation;
  const version = revision;
  const owner = account.id;
  next = { ...next, sequenceMarks: sequenceMarks(data,next) };
  let conflict = false;
  try {
    const table = client.from('risk_workspace');
    const write = version === null
      ? table.insert({ owner_id: owner, payload: next })
      : table.update({ payload: next, revision: version + 1 }).eq('owner_id', owner).eq('revision', version);
    const { data: row, error } = await write.select('revision').maybeSingle();
    if (request !== generation) return;
    if (error && error.code !== '23505') throw error;
    if (!row) {
      conflict = true;
      if (dialog.open) dialog.close();
      return;
    }
    revision = row.revision;
    data = next;
    if (dialog.open) dialog.close();
    render();
    notify(message);
  } catch {
    if (request === generation) showSaveError('No se pudo guardar en Supabase. Revisa tu conexión e intenta de nuevo.');
  } finally {
    if (request === generation) {
      busy = false;
      if (conflict) {
        await loadWorkspace();
        notify('Los datos cambiaron en otro dispositivo. Revisa la versión actual antes de volver a editar.');
      }
    }
  }
}
function caseRows(records, empty) {
  if (!records.length) return '<p class="empty">' + escape(empty) + '</p>';
  return records.map(record => {
    const [label, tone] = status(record);
    const mode = caseMode(record);
    const identifier = caseIdentifier(record);
    const deadlineTone = !record.due ? 'neutral' : !record.closed && tone === 'late' ? 'late'
      : !record.closed && tone === 'soon' ? 'soon' : 'dated';
    const badge = (caption, value, color) => `<span class="case-badge badge-${color}">
      <span>${caption}</span><b>${escape(value)}</b></span>`;
    return `<article class="case case-card case-kind-${mode}"><button type="button" class="case-card-open" data-edit-case="${escape(record.id)}">
      <span class="case-card-heading">
        <span class="case-identity"><strong class="case-code">${escape(identifier || 'Sin correlativo')}</strong>
          <span class="case-type">${escape(typeOf(record)?.name ?? 'Matriz de Riesgos')}</span></span>
        <span class="pill ${tone}">${label}</span>
      </span>
      <strong class="case-title">${escape(record.topic)}</strong>
      <span class="case-badges">
        ${badge('Analista', nameOf(record.person), 'person')}
        ${badge('Dependencia', entryOf('departments', record.department)?.name ?? 'Sin asignar', 'department')}
        ${badge('Plazo', formatDate(record.due), deadlineTone)}
        ${record.closedAt ? badge('Cierre', formatDate(record.closedAt), 'closed') : ''}
      </span>
      <span class="case-badges case-document-badges">
        ${record.number ? badge('Caso', record.number, 'neutral') : ''}
        ${record.office ? badge('Oficio', record.office, 'neutral') : ''}
        ${mode === 'followup' && record.matrix ? badge('Matriz de origen', record.matrix, 'neutral') : ''}
        ${record.researcher ? badge('Investigación', entryOf('researchers', record.researcher)?.name ?? 'Sin asignar', 'department') : ''}
        ${record.origin ? badge('Oficio de la matriz enviada', record.origin, 'neutral') : ''}
      </span></button></article>`;

  }).join('');
}
const caseGroupLabel = (kind, record) => {
  if (kind === 'people') return nameOf(record.person);
  if (kind === 'types') return typeOf(record)?.name ?? 'Sin tipo';
  return entryOf('departments', record.department)?.name ?? 'Sin dependencia registrada';
};
function byCorrelative(a,b) {
  const first = correlate(caseIdentifier(a)), second = correlate(caseIdentifier(b));
  if (first && second) return Number(second.year) - Number(first.year) ||
    second.sequence - first.sequence || compareNames(first.prefix,second.prefix) || compareNames(a.topic ?? '',b.topic ?? '');
  if (first || second) return first ? -1 : 1;
  return compareNames(a.topic ?? '',b.topic ?? '');
}
const caseOrders = {
  correlativo: ['Correlativo ↓', byCorrelative],
  ascendente: ['Correlativo ↑', (a,b) =>
    Boolean(correlate(caseIdentifier(a))) !== Boolean(correlate(caseIdentifier(b))) ? byCorrelative(a,b) : byCorrelative(b,a)],
  analista: ['Analista A–Z', (a,b) => compareNames(nameOf(a.person),nameOf(b.person)) || byCorrelative(a,b)],
  tema: ['Tema A–Z', (a,b) => compareNames(a.topic ?? '',b.topic ?? '') || byCorrelative(a,b)],
  plazo: ['Plazo más próximo', sortDue],
  asignacion: ['Asignación más reciente', (a,b) => (b.assigned ?? '').localeCompare(a.assigned ?? '') || byCorrelative(a,b)]
};


const pendingCategories = {
  overdue: ['Vencidos', (record,date) => !record.closed && Boolean(record.due) && record.due < date],
  upcoming: ['Vencen en 7 días', (record,date) => {
    if (record.closed || !record.due) return false;
    const days = (Date.parse(record.due) - Date.parse(date)) / 86400000;
    return days >= 0 && days <= 7;
  }],
  undated: ['Sin plazo', record => !record.closed && !record.due],
  followups: ['Seguimientos por iniciar', record => Boolean(followupDate(record))]
};
function pendingTray() {
  const date = today();
  return `<section class="card pending-tray"><h2>${canManage() ? 'Bandeja de pendientes' : 'Mis pendientes'}</h2>
    <div class="pending-grid">${Object.entries(pendingCategories)
      .filter(([key]) => key !== 'followups' || canManage())
      .map(([key,[label,match]]) => `<button type="button" class="pending-option pending-${key}" data-pending="${key}">
        <span>${label}</span><strong>${data.cases.filter(record => match(record,date)).length}</strong>
        <span aria-hidden="true" class="dashboard-chevron">›</span></button>`).join('')}</div></section>`;
}
function dashboard() {
  const open = data.cases.filter(record => !record.closed);
  const closed = data.cases.filter(record => record.closed);
  const remaining = open.filter(record => record.due);
  const todayDate = today();
  const currentMonth = todayDate.slice(0,7);
  const upcoming = remaining.filter(record => daysLeft(record.due) >= 0 && daysLeft(record.due) <= 7);
  const overdue = remaining.filter(record => record.due < todayDate);
  const measurable = closed.filter(record => record.due && record.closedAt);
  const onTime = measurable.filter(record => record.closedAt <= record.due).length;
  const elapsed = closed.filter(record => record.closedAt && record.assigned && record.closedAt >= record.assigned)
    .map(record => (Date.parse(record.closedAt) - Date.parse(record.assigned)) / 86400000);
  const metrics = globalDashboard?.metrics ?? {
    total: data.cases.length, opened: open.length, closed: closed.length, upcoming: upcoming.length, overdue: overdue.length,
    undated: open.length - remaining.length, closed_month: closed.filter(record => record.closedAt?.startsWith(currentMonth)).length,
    measurable: measurable.length, on_time: onTime, average_days: elapsed.length ? elapsed.reduce((a,b) => a+b,0) / elapsed.length : null
  };
  const counts = [
    ['Total de casos', metrics.total], ['Abiertos', metrics.opened], ['Cerrados', metrics.closed],
    ['Vencen en 7 días', metrics.upcoming], ['Vencidos', metrics.overdue], ['Abiertos sin plazo', metrics.undated],
    ['Cerrados este mes', metrics.closed_month],
    ['Cerrados a tiempo', metrics.measurable ? metrics.on_time + ' / ' + metrics.measurable : '—'],
    ['Promedio de cierre (días calendario)', metrics.average_days == null ? '—' :
      new Intl.NumberFormat('es-GT', {maximumFractionDigits:1}).format(metrics.average_days)]
  ];
  const breakdown = (title, column, kind, labelOf) => {
    const groups = new Map();
    if (globalDashboard) {
      for (const row of globalDashboard.groups.filter(row => row.kind === kind)) {
        groups.set(row.label, [row.opened, row.closed, row.overdue]);
      }
    } else {
      for (const record of data.cases) {
        const label = labelOf(record);
        const values = groups.get(label) ?? [0,0,0];
        values[record.closed ? 1 : 0]++;
        if (!record.closed && record.due && record.due < todayDate) values[2]++;
        groups.set(label, values);
      }
    }
    const totalOf = ([opened, closed]) => Number(opened) + Number(closed);
    const rows = [...groups].sort(([a, av], [b, bv]) => totalOf(bv) - totalOf(av) || compareNames(a,b));
    const drillAttrs = label => {
      const allowed = kind === 'types' || kind === 'departments' || (kind === 'people' && (canManage() ||
        (role === 'risk' && analystCatalogId && nameOf(analystCatalogId) === label)));
      return allowed ? `data-drill-kind="${kind}" data-drill-label="${escape(label)}"
        aria-label="Ver casos de ${escape(label)}"` : '';
    };
    const maximum = rows.length ? Math.max(1, totalOf(rows[0][1])) : 1;
    return `<section class="card dashboard-table"><h2>${title}</h2>${rows.length ? `
      <div class="chart-legend" aria-hidden="true"><span>Abiertos</span><span>Cerrados</span></div>
      <div class="dashboard-chart">${rows.slice(0,6).map(([label, values]) => {
        const [opened, closed] = values;
        const attrs = drillAttrs(label);
        const tag = attrs ? 'button' : 'div';
        return `<${tag} class="chart-row ${attrs ? 'dashboard-action dashboard-chart-action' : ''}" ${attrs}><span class="chart-caption"><span>${escape(label)}</span><span class="chart-end"><strong>${totalOf(values)}</strong>${attrs ? '<span class="dashboard-chevron" aria-hidden="true">›</span>' : ''}</span></span>
          <span class="chart-track"><span style="width:${100 * opened / maximum}%"></span><span style="width:${100 * closed / maximum}%"></span></span></${tag}>`;
      }).join('')}</div>
      ${rows.length > 6 ? '<p class="chart-note">Gráfica de los seis grupos con más casos.</p>' : ''}
      <div class="table-scroll"><table aria-label="${title}, de mayor a menor por total">
      <thead><tr><th>${column}</th><th aria-sort="descending">Total</th><th>Abiertos</th><th>Cerrados</th><th>Vencidos</th></tr></thead><tbody>
      ${rows.map(([label, values]) => {
        const attrs = drillAttrs(label);
        return `<tr><th scope="row">${attrs ? `<button type="button" class="dashboard-action dashboard-table-action" ${attrs}><span>${escape(label)}</span><span class="dashboard-chevron" aria-hidden="true">›</span></button>` : escape(label)}</th><td><strong>${totalOf(values)}</strong></td>${values.map(value => `<td>${value}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div>` :
      '<p class="empty">Sin casos registrados.</p>'}</section>`;

  };
  return `${pendingTray()}<div class="stats">${counts.map(([label, count], index) => `<div class="card stat stat-${index}"><span>${label}</span><strong>${count}</strong></div>`).join('')}</div>
    <div class="dashboard-grid">
    ${breakdown('Carga por analista', 'Analista', 'people', record => caseGroupLabel('people', record))}
    ${breakdown('Casos por tipo', 'Tipo', 'types', record => caseGroupLabel('types', record))}
    ${breakdown('Casos por dependencia', 'Dependencia', 'departments', record => caseGroupLabel('departments', record))}
    </div>
    ${canManage() ? `<section class="card followup-reminders"><h2 class="section-title">Seguimientos por iniciar</h2>
      ${data.cases.map(record => ({record, date: followupDate(record)})).filter(item => item.date)
        .sort((a,b) => a.date.localeCompare(b.date)).slice(0,8).map(({record,date}) =>
          `<button class="event event-reminder" data-start-followup="${escape(record.id)}">
          <strong>${escape(record.topic)}</strong><span>${date < todayDate ? 'Pendiente desde' : 'Programado para'} ${formatDate(date)} · ${escape(nameOf(record.person))}</span></button>`).join('')
        || '<p class="empty">Sin seguimientos pendientes.</p>'}</section>` : ''}
    <section class="card"><h2 class="section-title">${canManage() ? 'Plazos pendientes' : 'Mis próximos plazos'}</h2>${caseRows(remaining.sort(sortDue).slice(0, 8), 'Aquí aparecerán los plazos de los casos abiertos.')}</section>`;
}
function filteredCases() {
  const date = today();
  const pendingMatch = pendingCategories[pendingFilter]?.[1];
  const matches = data.cases.filter(record => (!filter || record.person === filter) && (!caseTab || caseMode(record) === caseTab) &&
    (!pendingMatch || pendingMatch(record,date)) &&
    (!drillFilter || caseGroupLabel(drillFilter.kind, record) === drillFilter.label) &&
    normalize([record.topic, record.number, record.matrix, record.followupNumber, record.office, record.responseOffice, nameOf(record.person), typeOf(record)?.name, entryOf('departments', record.department)?.name].join(' ')).includes(normalize(query.trim())));
  main.querySelector('#case-results').innerHTML = caseRows(matches.sort(caseOrders[caseSort][1]), 'No hay casos que coincidan.');
}
function cases() {
  const tabs = [['','Todos'], ...Object.entries(caseCategories)];
  return `<section class="card"><div class="case-tabs" role="group" aria-label="Tipo de caso">
    ${tabs.map(([mode,label]) => `<button type="button" class="case-tab case-kind-${mode || 'all'}" data-case-tab="${mode}"
      aria-pressed="${mode === caseTab}">${label}</button>`).join('')}</div>
    ${pendingFilter ? `<div class="toolbar active-filter"><strong>${pendingCategories[pendingFilter][0]}</strong>
      <button type="button" class="action" data-clear-drill>Limpiar filtro</button></div>` : ''}${drillFilter ? `<div class="toolbar active-filter">
    <span><strong>${({people:'Analista', departments:'Dependencia solicitante', types:'Tipo de caso'})[drillFilter.kind]}</strong> · ${escape(drillFilter.label)}</span>
    <button class="action" data-clear-drill>Limpiar filtro</button></div>` : ''}<div class="toolbar"><input id="search" type="search" aria-label="Buscar casos" placeholder="Buscar por correlativo, caso, oficio o tema" value="${escape(query)}">
    <select id="filter" aria-label="Filtrar por analista"><option value="">Todos los analistas</option>${sortedCatalog('people').map(person =>
    `<option value="${escape(person.id)}" ${filter === person.id ? 'selected' : ''}>${escape(person.name)}</option>`).join('')}</select><label class="case-sort-label">Ordenar por
      <select id="case-sort">${Object.entries(caseOrders).map(([key,[label]]) =>
        `<option value="${key}" ${caseSort === key ? 'selected' : ''}>${label}</option>`).join('')}</select>
    </label></div><div id="case-results"></div></section>`;
}
function matrixResponse(value) {
  const match = /^ST\s*\/\s*DIPT\s*\/\s*DRIGCT\s+No\.?\s*(\d+)$/i.exec((value ?? '').trim());
  return match ? `ST/DIPT/DRIGCT No. ${match[1]}` : '';
}
const isFinalizedMatrix = record => record.closed && ['matrix','research'].includes(typeOf(record)?.mode ?? 'matrix');
function existingFollowup(source) {
  const office = matrixResponse(source.responseOffice);
  return data.cases.find(item => typeOf(item)?.mode === 'followup' &&
    (item.sourceMatrixId === source.id || (!item.sourceMatrixId && office && matrixResponse(item.origin) === office &&
      ((source.matrix && item.matrix === source.matrix) || (source.number && item.number === source.number &&
        (!source.matrix || !item.matrix))))));
}
function followupDate(record, includeLinked = false) {
  if (!canManage() || !record.closedAt || !isFinalizedMatrix(record) || (!includeLinked && existingFollowup(record))) return '';
  const [year, month, day] = record.closedAt.split('-').map(Number);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0,10);
}
function agenda() {
  const controls = `<div class="case-tabs agenda-switch" role="group" aria-label="Vista de agenda">
    <button type="button" class="case-tab" data-agenda="pending" aria-pressed="${agendaView === 'pending'}">Pendientes</button>
    <button type="button" class="case-tab" data-agenda="calendar" aria-pressed="${agendaView === 'calendar'}">Calendario mensual</button></div>`;
  if (agendaView === 'calendar') return controls + calendar();
  const date = today();
  const scope = agendaPerson ? data.cases.filter(record => record.person === agendaPerson) : data.cases;
  const open = scope.filter(record => !record.closed);
  const sections = [
    ['Vencidos', 'overdue', open.filter(record => pendingCategories.overdue[1](record,date))],
    ['Vencen hoy o en los próximos 7 días', 'upcoming', open.filter(record => pendingCategories.upcoming[1](record,date))],
    ['Pendientes sin plazo', 'undated', open.filter(record => !record.due)],
    ['Plazos posteriores', 'later', open.filter(record => record.due && daysLeft(record.due) > 7)]
  ];
  const followups = canManage() ? scope.map(record => ({record,date:followupDate(record)}))
    .filter(item => item.date).sort((a,b) => a.date.localeCompare(b.date)) : [];
  return `${controls}<section class="card agenda-summary">
    <div><h2>${canManage() ? 'Pendientes del equipo' : 'Mis pendientes'}</h2><p>${open.length} casos abiertos${canManage() ? ' · ' + followups.length + ' seguimientos por iniciar' : ''}</p></div>
    ${canManage() ? `<label>Analista<select id="agenda-person"><option value="">Todos los analistas</option>
      ${sortedCatalog('people').map(person => `<option value="${escape(person.id)}" ${agendaPerson === person.id ? 'selected' : ''}>${escape(person.name)}</option>`).join('')}
    </select></label>` : ''}</section>
    ${sections.map(([label,key,records]) => `<section class="card agenda-section agenda-${key}">
      <h2>${label} <span class="pill">${records.length}</span></h2>
      ${caseRows(records.sort(sortDue), 'Sin casos en esta categoría.')}</section>`).join('')}
    ${canManage() ? `<section class="card agenda-section agenda-upcoming"><h2>Seguimientos por iniciar <span class="pill">${followups.length}</span></h2>
      ${followups.map(({record,date:planned}) => `<button type="button" class="event event-reminder" data-start-followup="${escape(record.id)}">
        <strong>${escape(caseIdentifier(record) || record.number || 'Matriz')} · ${escape(record.topic)}</strong>
        <span>${planned < date ? 'Pendiente desde' : 'Programado para'} ${formatDate(planned)} · ${escape(nameOf(record.person))}</span></button>`).join('') ||
        '<p class="empty">Sin seguimientos por iniciar.</p>'}</section>` : ''}`;
}
function calendar() {
  const first = new Date(month + '-01T00:00:00Z');
  const leading = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const byDate = new Map();
  for (const record of data.cases) {
    for (const [date, label] of [[record.due, 'Plazo'], [record.closed && record.closedAt, 'Cierre'], [followupDate(record), 'Iniciar seguimiento']]) {
      if (!date || date.slice(0, 7) !== month) continue;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push({record, label});
    }
  }
  for (const events of byDate.values()) events.sort((a,b) => a.label === b.label ? sortDue(a.record,b.record) : ['Plazo','Cierre','Iniciar seguimiento'].indexOf(a.label) - ['Plazo','Cierre','Iniciar seguimiento'].indexOf(b.label));
  const entries = ({record, label}) => {
    const mode = typeOf(record)?.mode ?? 'matrix';
    const office = label === 'Plazo' ? record.office : record.responseOffice;
    const reference = office || record.matrix || record.number || 'Sin oficio';
    const reminder = label === 'Iniciar seguimiento';
    const action = reminder ? 'data-start-followup' : 'data-edit-case';
    return `<button class="event event-${reminder ? 'reminder' : mode} ${label === 'Cierre' ? 'closure-event' : ''}" ${action}="${escape(record.id)}">
      <strong>${label} · ${escape(reference)}</strong><span>${escape(nameOf(record.person))}</span>
      <small>${escape(typeOf(record)?.name)}</small></button>`;
  };
  const cells = Array.from({ length: count }, (_, index) => {
    const day = month + '-' + String(index + 1).padStart(2, '0');
    const records = byDate.get(day) ?? [];
    return `<div class="calendar-cell"><button class="day ${day === today() ? 'today' : ''}" data-day="${day}" aria-pressed="${day === selected}"
      aria-label="${formatDate(day)}, ${records.length} eventos">${index + 1}
      <span class="day-count">${records.length || ''}</span></button><div class="events">${records.map(entries).join('')}</div></div>`;
  }).join('');
  return `<section class="card"><div class="row"><h2>${monthFormat.format(first)}</h2><div class="calendar-actions">
    <button class="action" data-month="-1" aria-label="Mes anterior">‹</button><button class="action" data-today>Hoy</button>
    <button class="action" data-month="1" aria-label="Mes siguiente">›</button></div></div>
    <div class="legend">${Object.entries(typeDetails).map(([mode, label]) =>
    `<span class="event-${mode}">${label}</span>`).join('')}${canManage() ? '<span class="event-reminder">Inicio de seguimiento</span>' : ''}</div>
    <div class="calendar">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(day => `<span class="weekday">${day}</span>`).join('')}
    ${'<span></span>'.repeat(leading)}${cells}</div><h2 class="section-title">${formatDate(selected)}</h2>
    <div class="selected-events">${byDate.has(selected) ? byDate.get(selected).map(entries).join('') : '<p class="empty">Sin eventos para este día.</p>'}</div>
    <div class="mobile-agenda"><h2>Agenda del mes</h2>${byDate.size ?
      [...byDate.keys()].sort().map(day =>
        `<section><h3>${formatDate(day)}</h3>${byDate.get(day).map(entries).join('')}</section>`).join('') :
      '<p class="empty">Sin eventos para este mes.</p>'}</div></section>`;
}
function people() {
  return `<div class="catalog-grid">${Object.entries(catalogLabels).map(([group, label]) =>
    `<section class="card"><div class="row section-title"><h2>${label}</h2>
      <button class="action" data-catalog="${group}" data-entry="">Añadir</button></div>
      ${sortedCatalog(group).map(entry => `<article class="person row"><div><strong>${escape(entry.name)}</strong>
        <small>${entry.active ? 'Activo' : 'Inactivo'}${entry.mode ? ' · ' + typeDetails[entry.mode] : ''}</small></div>
        <button class="action" data-catalog="${group}" data-entry="${escape(entry.id)}" aria-label="Editar ${escape(entry.name)}">Editar</button></article>`).join('')}</section>`).join('')}</div>`;
}
const reportModes = {monthly:'Mensual', historical:'Histórico completo', open:'Casos abiertos'};
function reportData(settings, currentDate = today()) {
  const mode = settings.mode ?? 'monthly';
  const monthly = mode === 'monthly';
  const [year, monthNumber] = (settings.month || currentDate.slice(0,7)).split('-').map(Number);
  const start = monthly ? settings.month + '-01' : '';
  const end = monthly ? new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0,10) : currentDate;
  const cutoff = !monthly || currentDate < end ? currentDate : end;
  const inPeriod = date => Boolean(date && date >= start && date <= cutoff);
  const scope = data.cases.filter(record =>
    (!settings.person || record.person === settings.person) &&
    (!settings.department || record.department === settings.department) &&
    (!settings.type || caseMode(record) === settings.type));
  const records = scope.map(record => {
    const assigned = inPeriod(record.assigned);
    const closed = record.closed && inPeriod(record.closedAt);
    const pending = Boolean(record.assigned && record.assigned <= cutoff &&
      (!record.closed || (monthly && record.closedAt && record.closedAt > cutoff)));
    const row = monthly ? {record, assigned, closed, pending}
      : {record, assigned: Boolean(record.assigned), closed: Boolean(record.closed), pending: !record.closed};
    return { ...row, overdue: row.pending && record.due && record.due < cutoff };
  }).filter(row => mode === 'open' ? row.pending : !monthly || row.assigned || row.closed || row.pending);
  const closed = records.filter(row => row.closed).map(row => row.record);
  const measured = closed.filter(record => record.due);
  const durations = closed.filter(record => record.assigned && record.assigned <= record.closedAt)
    .map(record => (Date.parse(record.closedAt) - Date.parse(record.assigned))/86400000);
  const followups = mode === 'open' ? [] : scope.filter(record =>
    isFinalizedMatrix(record) && (monthly ? inPeriod(record.closedAt) : Boolean(record.closedAt)));
  return {start, cutoff, records, measured, durations, followups,
    undetermined: scope.filter(record => record.closed && !record.closedAt && record.assigned && record.assigned <= cutoff).length};
}
function reportBreakdown(rows, kind, title, column, mode) {
  const grouped = new Map();
  for (const row of rows) {
    const label = caseGroupLabel(kind,row.record);
    const counts = grouped.get(label) ?? {assigned:0,closed:0,pending:0,total:0,overdue:0,undated:0};
    counts.assigned += Number(row.assigned);
    counts.closed += Number(row.closed);
    counts.pending += Number(row.pending);
    counts.total++;
    counts.overdue += Number(Boolean(row.overdue));
    counts.undated += Number(row.pending && !row.record.due);
    grouped.set(label,counts);
  }
  const entries = [...grouped].sort(([a,av],[b,bv]) => bv.total-av.total || compareNames(a,b));
  const maximum = entries[0]?.[1].total || 1;
  const columns = mode === 'open' ? [['Abiertos','pending'],['Vencidos','overdue'],['Sin plazo','undated']]
    : mode === 'historical' ? [['Total','total'],['Finalizados','closed'],['Abiertos','pending']]
    : [['Asignados','assigned'],['Finalizados','closed'],['Pendientes','pending']];
  return `<section class="report-block"><h3>${title}</h3>${entries.length ?
    `<table><thead><tr><th>${column}</th>${columns.map(([label]) => `<th>${label}</th>`).join('')}</tr></thead><tbody>
    ${entries.map(([label,counts]) => `<tr><th scope="row">${escape(label)}
    ${kind === 'types' ? `<span class="report-bar" aria-hidden="true"><span style="width:${counts.total / maximum * 100}%"></span></span>` : ''}</th>
    ${columns.map(([,key]) => `<td>${counts[key]}</td>`).join('')}</tr>`).join('')}</tbody></table>` :
    '<p>Sin casos para los filtros seleccionados.</p>'}</section>`;
}
function reportPreview(settings) {
  const mode = settings.mode ?? 'monthly';
  const monthly = mode === 'monthly';
  if (monthly && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(settings.month) || settings.month > today().slice(0,7))) {
    return '<p class="empty">Selecciona un mes válido, hasta el mes actual.</p>';
  }
  const {start, cutoff, records, measured, durations, followups, undetermined} = reportData(settings);
  const e = escape;
  const count = key => records.filter(row => row[key]).length;
  const closedFromPeriod = records.filter(row => row.closed && row.assigned).length;
  const closedFromEarlier = records.filter(row => row.closed && row.record.assigned && row.record.assigned < start).length;
  const closedUnknown = count('closed') - closedFromPeriod - closedFromEarlier;
  const pendingFromPeriod = records.filter(row => row.pending && row.assigned).length;
  const pendingFromEarlier = count('pending') - pendingFromPeriod;
  const onTime = measured.filter(record => record.closedAt <= record.due).length;
  const average = durations.length ? new Intl.NumberFormat('es-GT',{maximumFractionDigits:1})
    .format(durations.reduce((sum,days) => sum+days,0)/durations.length) : '—';
  const title = monthly ? (settings.person ? 'Informe mensual por analista' : 'Informe mensual consolidado')
    : mode === 'open' ? 'Informe de casos abiertos' : 'Informe histórico completo';
  const scope = [settings.person ? nameOf(settings.person) : 'Todo el equipo',
    settings.department ? entryOf('departments',settings.department)?.name : '',
    settings.type ? caseCategories[settings.type] : ''].filter(Boolean).join(' · ');
  let summary = [['Asignados en el mes',count('assigned')],['Finalizados en el mes',count('closed')],['Pendientes al corte',count('pending')],
    ['Vencidos al corte', count('overdue')], ['Pendientes sin plazo',records.filter(row => row.pending && !row.record.due).length],
    ['Cierres a tiempo', measured.length ? onTime + ' de ' + measured.length + ' (' + new Intl.NumberFormat('es-GT',{style:'percent',maximumFractionDigits:1}).format(onTime/measured.length) + ')' : '—'],
    ['Cierres fuera de plazo',measured.length ? measured.length-onTime : '—'],
    ['Promedio de cierre (días calendario)',average]];
  if (mode === 'historical') summary = [
    ['Total de casos registrados',records.length],['Finalizados',count('closed')],['Abiertos',count('pending')],
    ...summary.slice(3).map(([label,value]) => [label === 'Vencidos al corte' ? 'Abiertos vencidos' : label,value])
  ];
  if (mode === 'open') summary = [
    ['Total de casos abiertos',records.length],['Vencidos',count('overdue')],
    ['Vencen en 7 días',records.filter(row => pendingCategories.upcoming[1](row.record,cutoff)).length],
    ['Sin plazo',records.filter(row => !row.record.due).length]
  ];
  const date = value => value ? e(formatDate(value)) : '—';
  const field = (label,value) => `<span><b>${label}</b> ${value}</span>`;
  return `<article class="report-paper">
    <header class="report-heading">
      <img class="report-logo" src="./icon-192.png" width="52" height="52" alt="">
      <div><div class="eyebrow">Gestión de Riesgos</div><h2>${title}</h2>
        <p class="report-scope">${e(scope)}</p><p class="report-period">${monthly ? date(start) + ' al ' + date(cutoff) : 'Al ' + date(cutoff)} · Emitido el ${date(today())}</p>
      </div></header>
    <div class="report-stats">${summary.map(([label,value],index) => `<div class="report-indicator report-indicator-${index}"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
    ${monthly ? `<section class="report-block report-reconcile"><h3>Cómo se componen los cierres y pendientes</h3>
      <table><thead><tr><th>Fecha de asignación</th><th>Cierres del mes</th><th>Pendientes al corte</th></tr></thead>
      <tbody><tr><th scope="row">En el mes</th><td>${closedFromPeriod}</td><td>${pendingFromPeriod}</td></tr>
      <tr><th scope="row">Antes del mes</th><td>${closedFromEarlier}</td><td>${pendingFromEarlier}</td></tr>
      ${closedUnknown ? `<tr><th scope="row">Sin fecha de asignación válida para el corte</th><td>${closedUnknown}</td><td>—</td></tr>` : ''}
      <tr class="report-total"><th scope="row">Total</th><td>${count('closed')}</td><td>${count('pending')}</td></tr></tbody></table>
    </section>
    <p class="report-note">Asignaciones y cierres se cuentan por sus respectivas fechas. Los pendientes al corte se estiman con las fechas y asignaciones actuales. Los cambios de responsable, reaperturas y eliminaciones pueden modificar un corte anterior. El cumplimiento considera solo cierres con plazo registrado.${undetermined ? ' Hay ' + undetermined + ' casos cerrados sin fecha que quedaron fuera del cálculo de pendientes al corte.' : ''}</p>` :
      `<p class="report-note">${mode === 'open' ? 'Incluye los casos abiertos al generar el informe, con o sin plazo.'
        : 'Incluye todos los casos disponibles en el registro actual, incluso los que carecen de fecha.'} El alcance por analista usa el responsable principal registrado.</p>`}
    ${settings.person ? '' : reportBreakdown(records,'people','Carga por analista','Analista',mode)}
    ${reportBreakdown(records,'types','Distribución por tipo','Tipo de caso',mode)}
    ${reportBreakdown(records,'departments','Distribución por dependencia','Dependencia',mode)}
    ${followups.length ? `<section class="report-block"><h3>Seguimientos de matrices cerradas${monthly ? ' en el mes' : ''}</h3>
      <table><thead><tr><th>Matriz</th><th>Oficio de respuesta</th><th>Inicio previsto</th><th>Seguimiento</th></tr></thead><tbody>
      ${followups.slice().sort(byCorrelative).map(record => {
        const link = existingFollowup(record);
        const planned = followupDate(record, true);
        return `<tr><th scope="row">${e(record.matrix || record.number || record.topic)}</th><td>${e(record.responseOffice || '—')}</td>
          <td>${date(planned)}</td><td>${link ? e([link.followupNumber,status(link)[0]].filter(Boolean).join(' · ')) : 'Por iniciar'}</td></tr>`;
      }).join('')}</tbody></table></section>` : ''}
    ${settings.details ? `<section class="report-block report-details"><h3>Detalle de casos</h3>
      ${records.length ? records.slice().sort((a,b) => byCorrelative(a.record,b.record)).map(({record,assigned,closed,pending,overdue}) =>
      `<div class="report-case">
        <h4>${e(caseIdentifier(record) || record.number || 'Sin correlativo')} · ${e(record.topic)}</h4>
        <p class="report-case-scope">${monthly ? [assigned && 'Asignado en el mes',closed && 'Finalizado en el mes',pending && (overdue ? 'Vencido al corte' : 'Pendiente al corte')].filter(Boolean).join(' · ') : status(record)[0]}</p>
        <div class="report-case-fields">
          ${field('Tipo',e(caseGroupLabel('types',record)))}${field('Caso',e(record.number || '—'))}
          ${field('Analista',e(nameOf(record.person)))}${field('Dependencia',e(caseGroupLabel('departments',record)))}
          ${record.researcher ? field('Investigación',e(entryOf('researchers',record.researcher)?.name || '—')) : ''}
          ${field('Oficio de ingreso',e(record.office || '—'))}${field('Oficio de respuesta',e((monthly && record.closedAt && record.closedAt > cutoff ? '' : record.responseOffice) || '—'))}
          ${field('Asignado',date(record.assigned))}${field('Plazo',date(record.due))}${field(monthly ? 'Cierre al corte' : 'Fecha de cierre',date(monthly && record.closedAt > cutoff ? '' : record.closedAt))}
          ${caseMode(record) === 'followup' && record.matrix ? field('Matriz de origen',e(record.matrix)) : ''}
          ${record.origin ? field('Oficio de la matriz enviada',e(record.origin)) : ''}
        </div>${settings.notes && record.notes ? `<p class="report-notes"><b>Observaciones</b> ${e(record.notes)}</p>` : ''}</div>`).join('') :
        '<p>Sin casos para los filtros seleccionados.</p>'}</section>` : ''}
  </article>`;
}
function reports() {
  const settings = reportSettings;
  const options = (group,key) => sortedCatalog(group).map(entry =>
    `<option value="${escape(entry.id)}" ${settings[key] === entry.id ? 'selected' : ''}>${escape(entry.name)}</option>`).join('');
  return `<section class="card report-controls"><form id="report-settings">
    <div class="report-filters">
      <label>Tipo de informe<select name="mode">${Object.entries(reportModes).map(([key,label]) =>
        `<option value="${key}" ${key === settings.mode ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label ${settings.mode === 'monthly' ? '' : 'hidden'}>Mes<input ${settings.mode === 'monthly' ? '' : 'disabled'} name="month" type="month" value="${escape(settings.month)}" max="${today().slice(0,7)}" required></label>
      <label>Alcance<select name="person"><option value="">Consolidado del equipo</option>${options('people','person')}</select></label>
      <label>Dependencia<select name="department"><option value="">Todas</option>${options('departments','department')}</select></label>
      <label>Tipo de caso<select name="type"><option value="">Todos</option>${Object.entries(caseCategories).map(([key,label]) =>
        `<option value="${key}" ${key === settings.type ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    </div><div class="report-actions">
      <label><input name="details" type="checkbox" ${settings.details ? 'checked' : ''}> Incluir detalle de casos</label>
      <label><input name="notes" type="checkbox" ${settings.notes ? 'checked' : ''} ${settings.details ? '' : 'disabled'}> Incluir observaciones</label>
      <button type="submit" class="action primary">Generar PDF</button>
    </div></form></section><section id="report-preview" aria-label="Vista previa del informe">${reportPreview(settings)}</section>`;
}
function updateReport(form) {
  const mode = Object.hasOwn(reportModes,form.elements.mode.value) ? form.elements.mode.value : 'monthly';
  form.elements.month.disabled = mode !== 'monthly';
  form.elements.month.parentElement.hidden = mode !== 'monthly';
  const values = new FormData(form);
  reportSettings = {
    mode, month: String(values.get('month') ?? reportSettings.month), person:String(values.get('person') ?? ''),
    department:String(values.get('department') ?? ''), type:String(values.get('type') ?? ''),
    details:values.has('details'), notes:form.elements.notes.checked
  };
  form.elements.notes.disabled = !reportSettings.details;
  main.querySelector('#report-preview').innerHTML = reportPreview(reportSettings);
}

function render() {
  if (!ready) return;
  shell.hidden = false;
  sessionBar.hidden = false;
  main.classList.remove('gated');
  sessionBar.querySelector('span').textContent = account.email ?? '';
  shell.classList.toggle('analyst-nav', !canManage());
  const importButton = canManage() && localData && revision === null
    ? '<div class="card import-card"><p>Hay datos de una versión anterior en este dispositivo.</p><button class="action" data-import>Importar a esta cuenta</button></div>'
    : '';
  document.querySelectorAll('nav button').forEach(button => {
    button.hidden = !canManage() && ['people','reports'].includes(button.dataset.view);
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const [title, description] = !canManage() && view === 'cases'
    ? ['Mis casos', 'Consulta y actualiza los casos que tienes asignados.'] :
    !canManage() && view === 'dashboard' ? ['Dashboard global', 'Consulta los indicadores y la carga de trabajo de todo el equipo.'] : views[view];
  const action = !canManage() || ['people','reports'].includes(view) ? '' :
    '<button class="action primary" data-edit-case="">+ Nuevo caso</button>' + (view === 'cases' ? ' <button class="action" data-csv>Importar Excel</button>' : '');
  main.innerHTML = `<header><div><div class="eyebrow">Gestión de Riesgos</div><h1 tabindex="-1">${title}</h1><p>${description}</p></div>${action ? `<div class="header-actions">${action}</div>` : ''}</header>
    ${importButton}
    ${({ dashboard, cases, calendar:agenda, people, reports })[view]()}`;
  if (view === 'cases') filteredCases();
}
async function saveAnalystCase(record, values, form) {
  const errorText = form.querySelector('.error');
  if (!ready || canManage() || busy) return;
  const topic = values.topic.trim();
  if (!topic) { errorText.textContent = 'Escribe el tema del caso.'; return; }
  const finalizing = !record.closed && values.state === 'closed';
  const responseOffice = finalizing ? values.responseOffice.trim() : '';
  if (finalizing && (!actualOffice(responseOffice) || !/\d/.test(responseOffice))) {
    errorText.textContent = 'Ingresa el número de oficio de respuesta para finalizar el caso.';
    return;
  }
  let refresh = false;
  busy = true;
  const request = generation;
  const button = form.querySelector('.primary');
  button.disabled = true;
  try {
    const { data: closedAt, error } = await client.rpc('risk_update_assigned_case', {
      p_case_id: record.id, p_topic: topic, p_department: values.department, p_notes: values.notes.trim(),
      p_response_office: finalizing ? responseOffice : null,
      p_expected_topic: record.topic ?? '', p_expected_department: record.department ?? '', p_expected_notes: record.notes ?? '', p_expected_closed: Boolean(record.closed)
    });
    if (request !== generation) return;
    if (error) throw error;
    data = { ...data, cases: data.cases.map(item => item.id === record.id
      ? { ...item, topic, department: values.department, notes: values.notes.trim(),
        ...(finalizing ? {closed: true, closedAt, responseOffice} : {}) } : item) };
    if (dialog.open && dialog.contains(form)) dialog.close();
    render();
    notify(finalizing ? 'Caso finalizado.' : 'Caso actualizado.');
    refresh = true;
  } catch (error) {
    if (request === generation) errorText.textContent = error.code === '40001' || error.code === '42501'
      ? 'El caso cambió o dejó de estar asignado a ti. Cierra el formulario y pulsa Actualizar.'
      : 'No se pudo guardar. Comprueba la dependencia seleccionada y vuelve a intentar.';
  } finally {
    if (request === generation) {
      busy = false;
      button.disabled = false;
      if (refresh) void loadWorkspace({quiet: true});
    }
  }
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
function startFollowup(id) {
  if (!canManage()) return;
  const source = data.cases.find(record => record.id === id);
  if (!source || !isFinalizedMatrix(source)) return;
  const linked = existingFollowup(source);
  if (linked) { caseEditor(linked.id); return; }
  const type = sortedCatalog('types').find(item => item.mode === 'followup' && item.active);
  if (!type) { notify('Activa un tipo de seguimiento en Catálogos.'); return; }
  if (!matrixResponse(source.responseOffice)) {
    caseEditor(id, null, 'Para crear el seguimiento, corrige el oficio de respuesta de esta matriz con el formato ST/DIPT/DRIGCT No. 123.');
    return;
  }
  caseEditor('', source);
}
const historyLabels = {
  person:'Analista', researcher:'Investigación', department:'Dependencia', type:'Tipo',
  assigned:'Asignación', due:'Plazo', closedAt:'Fecha de cierre', responseOffice:'Oficio de respuesta',
  office:'Oficio de ingreso', number:'Número de caso', matrix:'Matriz', followupNumber:'Seguimiento',
  origin:'Oficio de la matriz enviada', topic:'Tema'
};
const historyEventNames = {
  created:'Caso registrado', imported:'Caso importado', closed:'Caso finalizado',
  reopened:'Caso reabierto', updated:'Caso actualizado', deleted:'Caso eliminado'
};
const historyClock = new Intl.DateTimeFormat('es-GT', {dateStyle:'medium', timeStyle:'short', timeZone:'America/Guatemala'});
function historyItem(row) {
  const changes = row.changes ?? {};
  const title = row.event_type === 'updated' && Object.hasOwn(changes,'person') ? 'Caso reasignado'
    : row.event_type === 'updated' && Object.hasOwn(changes,'due') ? 'Plazo actualizado'
    : historyEventNames[row.event_type] ?? 'Cambio registrado';
  return `<li><strong>${title}</strong><small>${escape(row.actor_label)} · ${escape(historyClock.format(new Date(row.occurred_at)))}</small>
    ${Object.entries(changes).filter(([key]) => Object.hasOwn(historyLabels,key)).map(([key,[before,after]]) => {
      const display = value => escape(!value ? 'Sin dato' : ['assigned','due','closedAt'].includes(key) ? formatDate(value) : value);
      return `<div><b>${historyLabels[key]}</b> ${before == null ? display(after) : `${display(before)} → ${display(after)}`}</div>`;
    }).join('')}</li>`;
}
function attachHistory(id) {
  const panel = dialog.querySelector('#case-history');
  const status = panel.querySelector('.history-status');
  const timeline = panel.querySelector('ol');
  const more = panel.querySelector('button');
  let loaded = false;
  let loading = false;
  let cursor = null;
  const request = generation;
  const fetchPage = async () => {
    if (loading) return;
    loading = true;
    more.hidden = true;
    status.textContent = 'Cargando historial…';
    try {
      const {data: rows, error} = await client.rpc('risk_read_case_history', {p_case_id:id,p_before:cursor});
      if (request !== generation || !panel.isConnected) return;
      if (error) throw error;
      timeline.insertAdjacentHTML('beforeend', rows.map(historyItem).join(''));
      if (rows.length) cursor = rows.at(-1).id;
      status.textContent = !loaded && !rows.length ? 'Aún no hay cambios registrados.' : '';
      loaded = true;
      more.textContent = 'Ver cambios anteriores';
      more.hidden = rows.length < 30;
    } catch {
      if (request !== generation || !panel.isConnected) return;
      status.textContent = 'No se pudo cargar el historial.';
      more.textContent = 'Reintentar';
      more.hidden = false;
    } finally {
      loading = false;
    }
  };
  panel.addEventListener('toggle', () => { if (panel.open && !loaded) void fetchPage(); });
  more.addEventListener('click', () => void fetchPage());
}
function caseEditor(id, source = null, message = '') {
  const analyst = !canManage();
  const existing = data.cases.find(record => record.id === id);
  if (analyst && !existing) return;
  const draft = source ? {
    sourceMatrixId: source.id, office: source.office, number: source.number, matrix: source.matrix,
    topic: source.topic, person: source.person, department: source.department, notes: source.notes,
    origin: matrixResponse(source.responseOffice), assigned: today(),
    type: sortedCatalog('types').find(item => item.mode === 'followup' && item.active)?.id
  } : { assigned: today() };
  const record = existing ?? draft;
  const parent = source ?? data.cases.find(item => item.id === record.sourceMatrixId);
  const currentType = record.type ?? (existing ? 'matrix' : '');
  const linked = !analyst && existing && isFinalizedMatrix(existing) ? existingFollowup(existing) : null;
  const followupButton = !analyst && existing && isFinalizedMatrix(existing)
    ? `<button type="button" class="action" data-start-followup="${escape(id)}">${linked ? 'Ver seguimiento' : 'Crear seguimiento'}</button>` : '';
  const options = sortedCatalog('people').filter(person => person.active || person.id === record.person);
  if (!analyst && !options.length) {
    notify('Activa o añade un analista antes de asignar un caso.');
    return;
  }
  const field = (key, label, limit, required = true) => `<label>${label}<input name="${key}" value="${escape(record[key])}" maxlength="${limit}" ${required ? 'required' : ''}></label>`;
  openForm(existing ? 'Editar caso' : source ? 'Crear seguimiento' : 'Nuevo caso', `
    ${message ? `<p class="edit-scope">${escape(message)}</p>` : ''}
    ${parent ? `<p class="edit-scope">Matriz de origen <strong>${escape(parent.matrix || parent.number || parent.topic)}</strong></p>` : ''}
    ${analyst ? '<p class="edit-scope">Puedes editar el tema, la dependencia solicitante y las observaciones.</p>' : ''}
    <div class="fields">${field('office', 'Oficio de ingreso', 100, !record.historical && !record.sourceMatrixId)}${field('number', 'Número de caso', 100, !record.historical && !record.sourceMatrixId)}</div>
    ${field('matrix', 'Número de matriz', 100, false)}
    <label id="followup-number-field" hidden>Correlativo de seguimiento
      <input name="followupNumber" maxlength="100" value="${escape(record.followupNumber)}" placeholder="Automático al guardar">
    </label>
    ${field('topic', 'Tema', 300)}
    <label>Tipo de caso<select name="type" required ${record.sourceMatrixId ? 'disabled' : ''}><option value="">Seleccionar tipo</option>${catalogOptions('types', currentType)}</select></label>
    <label>Dependencia solicitante<select name="department" ${(record.historical || record.sourceMatrixId) ? '' : 'required'}><option value="">Seleccionar dependencia</option>${catalogOptions('departments', record.department)}</select></label>
    <label id="research-field" hidden>Responsable de investigación<select name="researcher"><option value="">Seleccionar responsable</option>${catalogOptions('researchers', record.researcher)}</select></label>
    <label id="followup-field" hidden>Oficio de la matriz enviada
      <input name="origin" list="matrix-offices" maxlength="100" value="${escape(record.origin)}" placeholder="ST/DIPT/DRIGCT No. 123" ${record.sourceMatrixId ? 'readonly' : ''}>
      <datalist id="matrix-offices">${[...new Set(data.cases.filter(isFinalizedMatrix).map(item => matrixResponse(item.responseOffice)).filter(Boolean))]
      .map(office => `<option value="${escape(office)}"></option>`).join('')}</datalist></label>
    <label>Analista<select name="person" required><option value="">Seleccionar analista</option>${options.map(person =>
    `<option value="${escape(person.id)}" ${record.person === person.id ? 'selected' : ''}>${escape(person.name)}${person.active ? '' : ' (inactivo)'}</option>`).join('')}</select></label>
    <div class="fields"><label>Fecha de asignación<input name="assigned" type="date" required value="${escape(record.assigned)}"></label>
    <label>Fecha de plazo<input name="due" type="date" ${record.historical ? '' : 'required'} value="${escape(record.due)}"></label></div>
    <label>Estado<select name="state"><option value="open">En seguimiento</option><option value="closed" ${record.closed ? 'selected' : ''}>Finalizado</option></select></label>
    <div id="close-fields" class="fields" hidden>
      <label>Fecha de cierre<input name="closedAt" type="date" value="${escape(record.closedAt)}"></label>
      ${field('responseOffice', 'Oficio de respuesta', 100, false)}
    </div>
    <label>Observaciones<textarea name="notes" rows="2">${escape(record.notes)}</textarea></label>
    ${existing ? `<details id="case-history" class="case-history"><summary>Historial del caso</summary>
      <p class="history-status" role="status"></p><ol class="history-timeline"></ol>
      <button type="button" class="action" hidden>Ver cambios anteriores</button></details>` : ''}`,
    (form, values) => {
      if (analyst) { void saveAnalystCase(record, values, form); return; }
      const { person, assigned, due, state, department } = values;
      const type = record.sourceMatrixId ? currentType : values.type;
      const mode = entryOf('types', type)?.mode;
      const researcher = mode === 'research' ? values.researcher : '';
      const rawOrigin = values.origin?.trim() ?? '';
      const origin = mode === 'followup' ? matrixResponse(rawOrigin) ||
        (existing?.origin === rawOrigin && typeOf(existing)?.mode === 'followup' ? rawOrigin : '') : '';
      const [office, number, topic] = ['office','number','topic'].map(key => values[key].trim());
      const error = form.querySelector('.error');
      let matrix = values.matrix.trim();
      let followupNumber = values.followupNumber?.trim() ?? '';
      const prefix = mode === 'followup' ? 'SEG' : 'MRT';
      const year = assigned.slice(0,4);
      const value = prefix === 'SEG' ? followupNumber : matrix;
      const previous = prefix === 'SEG' ? existing?.followupNumber : caseMode(existing ?? {}) === 'followup' ? '' : existing?.matrix;
      let identifier = value;
      if (value !== previous || !value) {
        const entered = correlate(value);
        if (value && (!entered || entered.prefix !== prefix)) {
          error.textContent = 'Usa el formato ' + prefix + '-01-' + year + ' o deja el campo vacío para asignarlo automáticamente.'; return;
        }
        const amount = entered?.sequence ?? ((sequenceMarks(data)[prefix + '-' + year] ?? 0) + 1);
        if (amount > 999999999) { error.textContent = 'La serie de correlativos alcanzó su límite.'; return; }
        identifier = formatSequence(prefix, amount, entered?.year ?? year);
        const parsed = correlate(identifier);
        if (data.cases.some(item => {
          if (item.id === id) return false;
          const other = correlate(caseIdentifier(item));
          return other?.key === parsed.key && other.sequence === parsed.sequence;
        })) { error.textContent = 'Ya existe un caso con ese correlativo.'; return; }
      }
      if (mode === 'followup') followupNumber = identifier;
      else { matrix = identifier; followupNumber = ''; }
      const closed = state === 'closed';
      const closedAt = closed ? values.closedAt : '';
      const responseOffice = closed ? values.responseOffice.trim() : '';
      const unchangedClose = existing?.closed && (existing.closedAt ?? '') === closedAt && (existing.responseOffice ?? '') === responseOffice;
      if (closed && !unchangedClose && (!closedAt || !actualOffice(responseOffice) || !/\d/.test(responseOffice))) {
        error.textContent = 'Para cerrar el caso, ingresa la fecha de cierre y el número de oficio de respuesta.'; return;
      }
      if (closedAt && (closedAt < assigned || (!unchangedClose && closedAt > today()))) {
        error.textContent = 'La fecha de cierre debe estar entre la asignación y hoy.'; return;
      }
      if ((!record.historical && !record.sourceMatrixId && (!office || !number)) || !topic) { error.textContent = 'Completa el oficio, el número de caso y el tema.'; return; }
      if (!mode || ((department || (!record.historical && !record.sourceMatrixId)) && !entryOf('departments', department))) { error.textContent = 'Selecciona el tipo de caso y la dependencia solicitante.'; return; }
      if (mode === 'research' && !entryOf('researchers', researcher)) { error.textContent = 'Selecciona el responsable de investigación.'; return; }
      if (mode === 'followup' && !origin) { error.textContent = 'Indica el oficio de respuesta de la matriz con el formato ST/DIPT/DRIGCT No. 123.'; return; }
      if (due && due < assigned) { error.textContent = 'El plazo debe ser igual o posterior a la asignación.'; return; }
      if (matrix && data.cases.some(item => item.id !== id && normalize(item.matrix ?? '') === normalize(matrix) &&
          mode !== 'followup' && caseMode(item) !== 'followup')) {
        error.textContent = 'Ya existe un registro con ese número de matriz.'; return;
      }
      if (!record.historical && !record.sourceMatrixId && number && data.cases.some(item => item.id !== id && normalize(item.number ?? '') === normalize(number) &&
        (mode === 'followup' ? normalize(item.office) === normalize(office) : typeOf(item)?.mode !== 'followup' || normalize(item.office) === normalize(office)))) {
        error.textContent = 'Ya existe un registro con el mismo número de caso para esta asignación.'; return;
      }
      if (source && existingFollowup(source)) {
        error.textContent = 'Esta matriz ya tiene un seguimiento.'; return;
      }
      const item = { ...record, id: id || crypto.randomUUID(), office, number, matrix, followupNumber, topic, person, assigned, due,
        type, department, researcher, origin, closed, closedAt, responseOffice, notes: values.notes.trim() };
      save({ ...data, cases: existing ? data.cases.map(entry => entry.id === id ? item : entry) : [...data.cases, item] }, 'Caso guardado.');
    }, existing && !analyst ? `${followupButton}<button type="button" class="action danger" data-delete-case="${escape(id)}">Eliminar</button>` : '');
  const typeSelect = dialog.querySelector('[name="type"]');
  const updateFields = () => {
    const mode = entryOf('types', typeSelect.value)?.mode;
    const matrixInput = dialog.querySelector('[name="matrix"]');
    matrixInput.placeholder = mode === 'followup' ? 'Matriz de origen' : 'Automático al guardar';
    matrixInput.readOnly = mode === 'followup' && Boolean(record.sourceMatrixId);
    matrixInput.parentElement.firstChild.textContent = mode === 'followup' ? 'Número de matriz de origen' : 'Número de matriz';
    const followupField = dialog.querySelector('#followup-number-field');
    followupField.hidden = mode !== 'followup';
    followupField.querySelector('input').disabled = mode !== 'followup';
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
  const stateSelect = dialog.querySelector('[name="state"]');
  const closeFields = dialog.querySelector('#close-fields');
  const dateInput = closeFields.querySelector('[name="closedAt"]');
  const responseInput = closeFields.querySelector('[name="responseOffice"]');
  const updateClose = () => {
    const closing = stateSelect.value === 'closed';
    closeFields.hidden = !closing;
    dateInput.disabled = !closing || analyst;
    responseInput.disabled = !closing || (analyst && Boolean(record.closed));
    responseInput.required = closing && !existing?.closed;
    if (closing && !dateInput.value && !existing?.closed) dateInput.value = today();
  };
  stateSelect.addEventListener('change', updateClose);
  updateClose();
  typeSelect.addEventListener('change', updateFields);
  updateFields();
  if (analyst) {
    dialog.querySelectorAll('input[name], select[name], textarea[name]').forEach(input => {
      const editable = ['topic','department','notes'];
      if (!record.closed) editable.push('state','responseOffice');
      if (!editable.includes(input.name)) input.disabled = true;
    });
  }
  if (existing) attachHistory(id);
  const submitButton = dialog.querySelector('form .primary');
  const updateLabel = () => {
    submitButton.textContent = !existing?.closed && stateSelect.value === 'closed' ? 'Finalizar caso' : 'Guardar';
  };
  stateSelect.addEventListener('change', updateLabel);
  updateLabel();
}
function decodeCsv(bytes) {
  const bom = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  const encoding = bom[0] === 255 && bom[1] === 254 ? 'utf-16le'
    : bom[0] === 254 && bom[1] === 255 ? 'utf-16be' : 'utf-8';
  let text;
  try {
    text = new TextDecoder(encoding, {fatal:true}).decode(bytes);
  } catch (error) {
    if (encoding !== 'utf-8') throw error;
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  if (text.includes('�')) throw new Error('El archivo ya contiene caracteres dañados (�). Exporta otra vez desde el Excel original como CSV UTF-8.');
  return text;
}
function csvRows(text) {
  const source = text.replace(/^\uFEFF/, '');
  const header = source.split(/\r?\n/, 1)[0];
  const delimiter = [';', ',', '\t'].sort((a,b) => header.split(b).length - header.split(a).length)[0];
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else if (quoted || !value) quoted = !quoted;
      else value += c;
    } else if (!quoted && (c === delimiter || c === '\n' || c === '\r')) {
      row.push(value.trim());
      value = '';
      if (c !== delimiter) {
        if (c === '\r' && source[i + 1] === '\n') i++;
        rows.push(row);
        row = [];
      }
    } else value += c;
  }
  if (quoted) throw new Error('El CSV contiene comillas sin cerrar.');
  if (value || row.length) rows.push([...row, value.trim()]);
  return rows;
}
function importDate(value) {
  if (!value) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!iso && !local) return null;
  const date = iso ? value : [local[3], local[2].padStart(2,'0'), local[1].padStart(2,'0')].join('-');
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === date ? date : null;
}
const missingValue = value => /^(?:n\/?a|no aplica|-)$/i.test(value) ? '' : value;
const actualOffice = value => Boolean(value && missingValue(value.trim()) && normalize(value.trim()) !== 'correo');
function prepareImport(text) {
  const [header, ...rows] = csvRows(text);
  const key = value => normalize(value).replace(/[^a-z0-9]/g,'');
  const keys = (header ?? []).map(key);
  const columns = {
    assigned:['fecha ingreso'], number:['# de caso','número de caso'], matrix:['no. matriz','número de matriz'],
    topic:['nombre de la matriz de riesgo','tema'], closedAt:['respuesta','fecha de respuesta','fecha de cierre'],
    responseOffice:['oficio de respuesta'], analyst:['designado principal','analista'], state:['estado'],
    office:['oficio de ingreso','oficio de solicitud'], due:['fecha de plazo','plazo'], department:['dependencia solicitante'], notes:['observaciones']
  };
  const positions = Object.fromEntries(Object.entries(columns).map(([name, labels]) => [name, keys.findIndex(value => labels.map(key).includes(value))]));
  if (positions.responseOffice < 0) {
    const adjacent = positions.closedAt + 1;
    if (positions.closedAt >= 0 && keys[adjacent] === 'oficio') positions.responseOffice = adjacent;
  }
  const required = ['assigned','number','matrix','topic','closedAt','responseOffice','analyst','state'];
  const absent = required.filter(name => positions[name] < 0);
  if (absent.length) throw new Error('Faltan columnas: ' + absent.map(name => columns[name][0]).join(', ') + '.');
  const existing = new Map(data.cases.filter(record => record.matrix && typeOf(record)?.mode !== 'followup').map(record => [normalize(record.matrix), record]));
  const seen = new Set();
  const accepted = [], issues = [], repairs = new Map();
  const textFields = ['topic', 'notes', 'office', 'responseOffice'];
  let duplicates = 0, historicalWithoutOffice = 0;
  rows.forEach((row, index) => {
    const get = name => row[positions[name]]?.trim() ?? '';
    const matrix = get('matrix');
    const topic = get('topic');
    const analyst = get('analyst');
    if (!matrix && !topic && !analyst) return;
    const matrixKey = normalize(matrix);
    if (matrixKey && seen.has(matrixKey)) { duplicates++; return; }
    if (matrixKey) seen.add(matrixKey);
    const stored = existing.get(matrixKey);
    if (stored) {
      const changes = {};
      if (stored.historical) for (const field of textFields) {
        const previous = stored[field] ?? '';
        const original = get(field);
        const characters = [...previous];
        const candidates = [...original];
        if (previous.includes('�') && characters.length === candidates.length &&
            characters.every((character, index) => character === '�' || character === candidates[index])) {
          changes[field] = original;
        }
      }
      if (Object.keys(changes).length) repairs.set(stored.id, changes);
      else duplicates++;
      return;
    }
    const assigned = importDate(get('assigned'));
    const closedAt = importDate(get('closedAt'));
    const due = importDate(get('due'));
    const person = data.people.find(item => normalize(item.name) === normalize(analyst));
    const dependency = missingValue(get('department'));
    const department = data.departments.find(item => normalize(item.name) === normalize(dependency));
    const state = normalize(get('state'));
    const closed = ['entregado','cerrado','finalizado'].includes(state) || (!state && Boolean(closedAt));
    const error = !matrix || !topic || !assigned ? 'Completa el número de matriz, el tema y la fecha de ingreso.'
      : !person ? 'El analista «' + (analyst || 'sin nombre') + '» no coincide con Catálogos.'
      : dependency && !department ? 'La dependencia «' + dependency + '» no coincide con Catálogos.'
      : due === null || closedAt === null || (due && due < assigned) || (closedAt && closedAt < assigned) ? 'Revisa las fechas.'
      : state && !['entregado','cerrado','finalizado','en proceso','en seguimiento','abierto','pendiente'].includes(state) ? 'Estado desconocido.'
      : closed && !closedAt ? 'Completa la fecha de respuesta del caso entregado.'
      : !closed && (closedAt || actualOffice(get('responseOffice'))) ? 'El caso está abierto y contiene datos de respuesta.'
      : '';
    if (error) { issues.push('Fila ' + (index + 2) + (matrix ? ' (' + matrix + ')' : '') + ' · ' + error); return; }
    const responseOffice = closed ? get('responseOffice') : '';
    if (closed && !actualOffice(responseOffice)) historicalWithoutOffice++;
    accepted.push({ id: crypto.randomUUID(), matrix, number: missingValue(get('number')), topic, person: person.id,
      assigned, due, department: department?.id ?? '', office: missingValue(get('office')), type:'matrix',
      closed, closedAt: closed ? closedAt : '', responseOffice, notes: get('notes'), historical: true });
  });
  return { accepted, issues, duplicates, historicalWithoutOffice, repairs };
}
function openCsvImport() {
  openForm('Importar Excel', `
    <p>Guarda tu hoja como CSV UTF-8 en Excel. Revisa el resultado antes de importar.</p>
    <label>Archivo CSV<input name="csv" type="file" accept=".csv,text/csv" required></label>
    <div id="csv-preview" aria-live="polite"></div>`, (form) => {
      if (!preview || (!preview.accepted.length && !preview.repairs.size)) return;
      const repaired = data.cases.map(record => preview.repairs.has(record.id) ? { ...record, ...preview.repairs.get(record.id) } : record);
      void save({ ...data, cases: [...repaired, ...preview.accepted] },
        `${preview.accepted.length} casos importados · ${preview.repairs.size} con texto reparado.`);
    });
  const form = dialog.querySelector('form');
  const input = form.elements.csv;
  const result = form.querySelector('#csv-preview');
  const submit = form.querySelector('.primary');
  submit.textContent = 'Aplicar importación';
  submit.disabled = true;
  let preview;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    preview = undefined;
    submit.disabled = true;
    result.textContent = '';
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('El CSV supera 5 MB. Divide el archivo en varios bloques.');
      const text = decodeCsv(await file.arrayBuffer());
      if (input.files[0] !== file) return;
      preview = prepareImport(text);
      const { accepted, duplicates, issues, historicalWithoutOffice, repairs } = preview;
      result.innerHTML = `<p>${accepted.length} nuevos · ${repairs.size} para reparar · ${duplicates} matrices repetidas · ${issues.length} filas para corregir</p>
        ${historicalWithoutOffice ? `<p>${historicalWithoutOffice} cierres históricos carecen de número de oficio.</p>` : ''}
        ${issues.length ? `<ul class="import-errors">${issues.map(issue => `<li>${escape(issue)}</li>`).join('')}</ul>` : ''}`;
      submit.disabled = !accepted.length && !repairs.size;
    } catch (error) {
      result.textContent = error.message;
    }
  });
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
  if ('reload' in dataset) void loadWorkspace();
  if ('logout' in dataset) {
    client.auth.signOut({ scope: 'local' }).then(({error}) => {
      if (error) notify('No se pudo cerrar la sesión. Intenta de nuevo.');
      else if (account) activateSession(null);
    });
  }
  if ('import' in dataset && ready && canManage() && localData && revision === null &&
      confirm('¿Importar los casos y catálogos de este dispositivo a tu cuenta actual?')) {
    void save(localData, 'Datos importados a Supabase.');
  }
  if (!ready) return;
  if ('pending' in dataset && view === 'dashboard' && Object.hasOwn(pendingCategories,dataset.pending) &&
      (dataset.pending !== 'followups' || canManage())) {
    pendingFilter = dataset.pending;
    drillFilter = null;
    caseTab = '';
    filter = '';
    query = '';
    view = 'cases';
    render();
    window.scrollTo(0,0);
    main.querySelector('h1')?.focus({preventScroll:true});
  }
  if ('drillKind' in dataset && view === 'dashboard' && ['people','departments','types'].includes(dataset.drillKind)) {
    pendingFilter = '';
    drillFilter = {kind:dataset.drillKind, label:dataset.drillLabel};
    const type = dataset.drillKind === 'types'
      ? data.types.find(type => type.name === dataset.drillLabel) ??
        initial.types.find(type => type.name === dataset.drillLabel)
      : null;
    caseTab = type?.mode ?? '';
    filter = '';
    query = '';
    view = 'cases';
    render();
    window.scrollTo(0, 0);
    main.querySelector('h1')?.focus({preventScroll:true});
  }
  if ('caseTab' in dataset && view === 'cases' && (dataset.caseTab === '' || Object.hasOwn(caseCategories,dataset.caseTab))) {
    caseTab = dataset.caseTab;
    if (drillFilter?.kind === 'types') {
      drillFilter = null;
      render();
      [...main.querySelectorAll('[data-case-tab]')].find(tab => tab.dataset.caseTab === caseTab)?.focus();
      return;
    }
    main.querySelectorAll('[data-case-tab]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.caseTab === caseTab)));
    filteredCases();
  }
  if ('clearDrill' in dataset && view === 'cases') {
    pendingFilter = '';
    drillFilter = null;
    caseTab = '';
    filter = '';
    query = '';
    render();
    main.querySelector('#search')?.focus();
  }
  if ('view' in dataset && (canManage() || ['dashboard','cases','calendar'].includes(dataset.view))) { view = dataset.view; render(); window.scrollTo(0, 0); }
  if ('startFollowup' in dataset) startFollowup(dataset.startFollowup);
  if ('editCase' in dataset) caseEditor(dataset.editCase);
  if (canManage() && 'csv' in dataset) openCsvImport();
  if (canManage() && 'catalog' in dataset) catalogEditor(dataset.catalog, dataset.entry);
  if ('cancel' in dataset) dialog.close();
  if (canManage() && 'deleteCase' in dataset && confirm('¿Eliminar este caso permanentemente?')) {
    save({ ...data, cases: data.cases.filter(record => record.id !== dataset.deleteCase) }, 'Caso eliminado.');
  }
  if ('agenda' in dataset && view === 'calendar' && ['pending','calendar'].includes(dataset.agenda)) {
    agendaView = dataset.agenda;
    render();
    main.querySelector('[data-agenda][aria-pressed="true"]')?.focus();
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
  if (view === 'calendar' && canManage() && event.target.id === 'agenda-person') {
    agendaPerson = event.target.value;
    render();
    main.querySelector('#agenda-person')?.focus();
  }
  if (view === 'reports' && canManage() && event.target.form?.id === 'report-settings') updateReport(event.target.form);
  if (event.target.id === 'case-sort' && Object.hasOwn(caseOrders,event.target.value)) {
    caseSort = event.target.value;
    filteredCases();
  }
  if (event.target.id === 'filter') { filter = event.target.value; filteredCases(); }
});
document.addEventListener('submit', async event => {
  if (event.target.id === 'report-settings') {
    event.preventDefault();
    if (!ready || !canManage() || view !== 'reports') return;
    updateReport(event.target);
    if (main.querySelector('.report-paper')) {
      if (typeof window.print === 'function') window.print();
      else notify('Abre el informe en el navegador y usa su opción Imprimir para guardarlo como PDF.');
    }
    return;
  }
  if (event.target.id !== 'login-form') return;
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  const errorText = form.querySelector('.error');
  const { email, password } = Object.fromEntries(new FormData(form));
  button.disabled = true;
  errorText.textContent = '';
  try {
    const { data: auth, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      errorText.textContent = error.status >= 500 || !error.status
        ? 'No se pudo conectar. Intenta de nuevo.'
        : 'No se pudo iniciar sesión. Revisa tu correo y contraseña.';
    } else if (auth.session?.user?.id !== account?.id) {
      activateSession(auth.session);
    }
  } catch {
    errorText.textContent = 'No se pudo conectar. Intenta de nuevo.';
  } finally {
    button.disabled = false;
  }
});
document.addEventListener('visibilitychange', () => {
  if (ready && !document.hidden) void loadWorkspace({ quiet: true });
});
async function start() {
  showGate('Gestión de Riesgos', 'Preparando el inicio de sesión…');
  try {
    const { projectUrl, publishableKey } = await import('./supabase-config.js?v=18');
    if (!projectUrl || !publishableKey) {
      showGate('Configurar Supabase', 'Completa supabase-config.js y ejecuta supabase.sql para habilitar el inicio de sesión.');
      return;
    }
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.89.0/+esm');
    client = createClient(projectUrl, publishableKey);
    client.auth.onAuthStateChange((event, session) => {
      if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) {
        setTimeout(() => {
          if (!session || session.user.id !== account?.id) activateSession(session);
        }, 0);
      }
    });
  } catch {
    showGate('Conexión no disponible', 'Revisa la configuración de Supabase y vuelve a cargar la página.');
  }
}
void start();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
