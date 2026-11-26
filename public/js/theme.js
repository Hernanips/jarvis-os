import { vibrar } from './state.js';

export function aplicarTemaUI() {
  const guardado = localStorage.getItem('jarvis_theme'); // 'light' | 'dark' | null (auto)
  const sistemaClaro = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const esClaro = guardado ? guardado === 'light' : sistemaClaro;

  if (guardado) {
    document.documentElement.setAttribute('data-theme', guardado);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', esClaro ? '#F3F3F3' : '#141414');

  const icon = document.getElementById('themeIconSvg');
  if (icon) {
    icon.innerHTML = esClaro
      ? '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>'
      : '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>';
  }
}

export function alternarTema() {
  vibrar(10);
  const guardado = localStorage.getItem('jarvis_theme');
  const sistemaClaro = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const actualEsClaro = guardado ? guardado === 'light' : sistemaClaro;
  const nuevoEsClaro = !actualEsClaro;

  if (nuevoEsClaro === sistemaClaro) {
    localStorage.removeItem('jarvis_theme');
  } else {
    localStorage.setItem('jarvis_theme', nuevoEsClaro ? 'light' : 'dark');
  }
  aplicarTemaUI();
}

export function initTheme() {
  aplicarTemaUI();
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', aplicarTemaUI);
  }
  document.getElementById('themeToggleBtn')?.addEventListener('click', alternarTema);
}