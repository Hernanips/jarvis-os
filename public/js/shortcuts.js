import { state, escapeHtml } from './state.js';

const ICON_PACK = {
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
  utensils: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
  dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/></svg>',
  bike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>'
};

const ATAJOS_POR_DEFECTO = [
  { icon: 'calendar', label: 'Resumen del día', prompt: '¿Cómo llevo el día? Dime tareas pendientes, eventos y calorías.' }
];

let onSelectPromptCallback = () => {};

function obtenerSvgIcono(iconKey) {
  return ICON_PACK[iconKey] || ICON_PACK.calendar;
}

function obtenerClaveStorageAtajos() {
  return 'jarvis_shortcuts_' + state.currentUserId;
}

function cargarAtajosUsuario() {
  try {
    const guardados = localStorage.getItem(obtenerClaveStorageAtajos());
    if (guardados) {
      const parsed = JSON.parse(guardados);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return [...ATAJOS_POR_DEFECTO];
}

function guardarAtajosEnStorage(lista) {
  localStorage.setItem(obtenerClaveStorageAtajos(), JSON.stringify(lista));
  renderizarBarraAtajos();
  renderizarListaModalAtajos();
}

function renderizarPanelSelectorIconos() {
  const panel = document.getElementById('iconPickerPanel');
  const iconInput = document.getElementById('shortcutIconKey');
  const trigger = document.getElementById('iconPickerTrigger');
  if (!panel || !iconInput || !trigger) return;

  const seleccionado = iconInput.value || 'calendar';
  trigger.innerHTML = obtenerSvgIcono(seleccionado);

  panel.innerHTML = '';
  Object.keys(ICON_PACK).forEach((key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-option-btn' + (key === seleccionado ? ' selected' : '');
    btn.innerHTML = ICON_PACK[key];
    btn.addEventListener('click', () => seleccionarIconoAtajo(key));
    panel.appendChild(btn);
  });
}

function seleccionarIconoAtajo(key) {
  document.getElementById('shortcutIconKey').value = key;
  document.getElementById('iconPickerPanel')?.classList.remove('open');
  renderizarPanelSelectorIconos();
}

export function renderizarBarraAtajos() {
  const container = document.getElementById('quick-actions-container');
  if (!container) return;

  const atajos = cargarAtajosUsuario();
  container.innerHTML = '';

  atajos.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.disabled = state.isGenerating;
    btn.innerHTML = obtenerSvgIcono(item.icon) + '<span>' + escapeHtml(item.label) + '</span>';
    btn.addEventListener('click', () => onSelectPromptCallback(item.prompt));
    container.appendChild(btn);
  });

  const manageBtn = document.createElement('button');
  manageBtn.className = 'chip-action';
  manageBtn.innerHTML = '<span>＋ Atajo</span>';
  manageBtn.addEventListener('click', abrirModalAtajos);
  container.appendChild(manageBtn);
}

function abrirModalAtajos() {
  resetFormularioAtajo();
  renderizarListaModalAtajos();
  const modal = document.getElementById('shortcuts-modal');
  if (modal) modal.style.display = 'flex';
}

function cerrarModalAtajos() {
  const modal = document.getElementById('shortcuts-modal');
  if (modal) modal.style.display = 'none';
}

function moverAtajo(index, direccion) {
  const atajos = cargarAtajosUsuario();
  const nuevoIndex = index + direccion;
  if (nuevoIndex < 0 || nuevoIndex >= atajos.length) return;
  [atajos[index], atajos[nuevoIndex]] = [atajos[nuevoIndex], atajos[index]];
  guardarAtajosEnStorage(atajos);
}

function renderizarListaModalAtajos() {
  const listEl = document.getElementById('shortcuts-list');
  if (!listEl) return;

  const atajos = cargarAtajosUsuario();
  listEl.innerHTML = '';

  atajos.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'shortcut-item';
    const isFirst = idx === 0 ? 'disabled' : '';
    const isLast = idx === atajos.length - 1 ? 'disabled' : '';

    row.innerHTML = [
      '<div class="shortcut-info">',
      '  <div class="shortcut-icon-preview">' + obtenerSvgIcono(item.icon) + '</div>',
      '  <div class="shortcut-text-group">',
      '    <div class="shortcut-title">' + escapeHtml(item.label) + '</div>',
      '    <div class="shortcut-prompt">' + escapeHtml(item.prompt) + '</div>',
      '  </div>',
      '</div>',
      '<div class="shortcut-item-actions">',
      '  <button class="mini-icon-btn" data-action="up" data-idx="' + idx + '" ' + isFirst + ' title="Subir">',
      '    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="18 15 12 9 6 15"/></svg>',
      '  </button>',
      '  <button class="mini-icon-btn" data-action="down" data-idx="' + idx + '" ' + isLast + ' title="Bajar">',
      '    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>',
      '  </button>',
      '  <button class="mini-icon-btn" data-action="edit" data-idx="' + idx + '" title="Editar">',
      '    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
      '  </button>',
      '  <button class="mini-icon-btn delete" data-action="delete" data-idx="' + idx + '" title="Borrar">',
      '    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      '  </button>',
      '</div>'
    ].join('\n');

    listEl.appendChild(row);
  });
}

function prepararEdicionAtajo(index) {
  const atajos = cargarAtajosUsuario();
  const item = atajos[index];
  if (!item) return;

  document.getElementById('form-shortcut-title').textContent = 'Editar atajo';
  document.getElementById('shortcutIconKey').value = ICON_PACK[item.icon] ? item.icon : 'calendar';
  document.getElementById('shortcutLabelInput').value = item.label;
  document.getElementById('shortcutPromptInput').value = item.prompt;
  document.getElementById('shortcutEditIndex').value = String(index);
  document.getElementById('cancelEditBtn').style.display = 'inline-block';
  renderizarPanelSelectorIconos();
}

function resetFormularioAtajo() {
  document.getElementById('form-shortcut-title').textContent = 'Añadir nuevo atajo';
  document.getElementById('shortcutIconKey').value = 'calendar';
  document.getElementById('shortcutLabelInput').value = '';
  document.getElementById('shortcutPromptInput').value = '';
  document.getElementById('shortcutEditIndex').value = '-1';
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('iconPickerPanel')?.classList.remove('open');
  renderizarPanelSelectorIconos();
}

function guardarAtajo() {
  const icon = document.getElementById('shortcutIconKey').value || 'calendar';
  const label = document.getElementById('shortcutLabelInput').value.trim();
  const prompt = document.getElementById('shortcutPromptInput').value.trim();
  const editIdx = parseInt(document.getElementById('shortcutEditIndex').value, 10);

  if (!label || !prompt) return alert('Rellena el nombre y la instrucción del atajo.');

  const atajos = cargarAtajosUsuario();
  if (editIdx >= 0 && editIdx < atajos.length) {
    atajos[editIdx] = { icon, label, prompt };
  } else {
    atajos.push({ icon, label, prompt });
  }

  guardarAtajosEnStorage(atajos);
  resetFormularioAtajo();
}

function eliminarAtajo(index) {
  const atajos = cargarAtajosUsuario();
  atajos.splice(index, 1);
  guardarAtajosEnStorage(atajos);
}

export function initShortcuts({ onSelectPrompt } = {}) {
  if (onSelectPrompt) onSelectPromptCallback = onSelectPrompt;

  const modal = document.getElementById('shortcuts-modal');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalAtajos();
  });

  document.getElementById('closeShortcutsBtn')?.addEventListener('click', cerrarModalAtajos);
  document.getElementById('iconPickerTrigger')?.addEventListener('click', () => {
    document.getElementById('iconPickerPanel')?.classList.toggle('open');
  });
  document.getElementById('cancelEditBtn')?.addEventListener('click', resetFormularioAtajo);
  document.getElementById('saveShortcutBtn')?.addEventListener('click', guardarAtajo);

  document.getElementById('shortcuts-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    const idx = parseInt(btn.dataset.idx, 10);
    if (Number.isNaN(idx)) return;

    const action = btn.dataset.action;
    if (action === 'up') moverAtajo(idx, -1);
    else if (action === 'down') moverAtajo(idx, 1);
    else if (action === 'edit') prepararEdicionAtajo(idx);
    else if (action === 'delete') eliminarAtajo(idx);
  });

  renderizarBarraAtajos();
  renderizarPanelSelectorIconos();
}