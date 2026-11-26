import {
  state,
  vibrar,
  actualizarEstadoConexion,
  marcarStravaConectadoUI,
  agregarMensajeChat
} from './state.js';

let onAuthReadyCallback = () => {};

function capturarTokensUrl() {
  const hashOrQuery = window.location.hash.substring(1) || window.location.search.substring(1);
  if (!hashOrQuery) return;

  const params = new URLSearchParams(hashOrQuery);
  const pToken = params.get('provider_token');
  const pRefresh = params.get('provider_refresh_token');
  const oauthError = params.get('error_description') || params.get('error');

  if (pToken) localStorage.setItem('jarvis_google_token', pToken);
  if (pRefresh) localStorage.setItem('jarvis_google_refresh_token', pRefresh);

  if (oauthError) {
    setTimeout(() => {
      alert('Error devuelto por Supabase/Google: ' + decodeURIComponent(oauthError.replace(/\+/g, ' ')));
    }, 400);
  }
}

function mostrarErrorAuth(msg = '') {
  const errEl = document.getElementById('auth-error');
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.style.display = msg ? 'block' : 'none';
}

export async function obtenerSesionActiva() {
  if (!state.supabaseClient) return state.currentSession;
  const { data: { session } } = await state.supabaseClient.auth.getSession();
  return session || state.currentSession;
}

export function conectarStrava() {
  vibrar(12);
  if (!state.stravaClientIdGlobal) {
    return alert('Falta STRAVA_CLIENT_ID en las variables de entorno de Vercel.');
  }
  const redirectUri = encodeURIComponent(window.location.origin);
  const scope = 'read,activity:read_all,profile:read_all';
  window.location.href =
    'https://www.strava.com/oauth/authorize?client_id=' +
    state.stravaClientIdGlobal +
    '&response_type=code&redirect_uri=' +
    redirectUri +
    '&approval_prompt=auto&scope=' +
    scope;
}

async function sincronizarRefreshTokenEnServidor(accessToken) {
  if (!accessToken) return;
  try {
    if (state.pendingStravaCode) {
      const codeToExchange = state.pendingStravaCode;
      state.pendingStravaCode = null;
      window.history.replaceState(null, '', window.location.pathname);

      const resSt = await fetch('/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + accessToken
        },
        body: JSON.stringify({ mode: 'strava_exchange', code: codeToExchange })
      });
      const dataSt = await resSt.json().catch(() => ({}));
      if (dataSt.stravaConnected) {
        marcarStravaConectadoUI(true);
        agregarMensajeChat('✅ <strong>Strava vinculado correctamente.</strong> Ya tengo acceso en tiempo real a tus carreras, rutas en bici, sesiones de gimnasio y pulsaciones.');
      }
    }

    const rToken = localStorage.getItem('jarvis_google_refresh_token') || '';
    const res = await fetch('/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + accessToken,
        'X-Google-Refresh-Token': rToken
      },
      body: JSON.stringify({ syncTokenOnly: true })
    });
    const data = await res.json().catch(() => ({}));
    if (data.stravaConnected) marcarStravaConectadoUI(true);
  } catch (e) {}
}

function crearClienteSupabase(url, key) {
  if (state.supabaseClient) return state.supabaseClient;

  state.supabaseClient = window.supabase.createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  state.supabaseClient.auth.onAuthStateChange((_event, session) => {
    state.currentSession = session || null;
    if (session) {
      state.currentUserId = session.user.id;
      if (session.provider_token) localStorage.setItem('jarvis_google_token', session.provider_token);
      if (session.provider_refresh_token) localStorage.setItem('jarvis_google_refresh_token', session.provider_refresh_token);

      sincronizarRefreshTokenEnServidor(session.access_token);
      const authModal = document.getElementById('auth-modal');
      if (authModal) authModal.style.display = 'none';
      onAuthReadyCallback();

      if (window.location.hash && window.location.hash.includes('access_token=')) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  });

  return state.supabaseClient;
}

export async function cargarConfigYAuth() {
  const authModal = document.getElementById('auth-modal');

  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    setTimeout(cargarConfigYAuth, 300);
    return;
  }

  try {
    mostrarErrorAuth('');
    const res = await fetch('/api');
    if (!res.ok) throw new Error('El servidor respondió con HTTP ' + res.status + ' en /api');

    const config = await res.json();
    if (config.stravaClientId) state.stravaClientIdGlobal = config.stravaClientId;

    localStorage.setItem('jarvis_supa_config', JSON.stringify(config));
    crearClienteSupabase(config.supabaseUrl, config.supabaseAnonKey);

    const { data: { session } } = await state.supabaseClient.auth.getSession();
    state.currentSession = session || null;

    if (session) {
      state.currentUserId = session.user.id;
      if (session.provider_token) localStorage.setItem('jarvis_google_token', session.provider_token);
      if (session.provider_refresh_token) localStorage.setItem('jarvis_google_refresh_token', session.provider_refresh_token);

      sincronizarRefreshTokenEnServidor(session.access_token);
      if (authModal) authModal.style.display = 'none';
      onAuthReadyCallback();
    } else if (authModal) {
      authModal.style.display = 'flex';
    }
    actualizarEstadoConexion('online');
  } catch (e) {
    console.error('❌ Error inicializando Supabase:', e);
    actualizarEstadoConexion('offline');
    mostrarErrorAuth('No se pudo conectar con /api (' + e.message + '). Revisa el deploy en Vercel o vuelve a intentarlo.');
    if (authModal) authModal.style.display = 'flex';
  }
}

export async function loginGoogle() {
  try {
    if (!state.supabaseClient) await cargarConfigYAuth();
    if (!state.supabaseClient) return;

    const { error } = await state.supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });
    if (error) alert('Error al conectar con Google: ' + error.message);
  } catch (err) {
    alert('Error en login: ' + err.message);
  }
}

export async function logout() {
  state.currentSession = null;
  localStorage.removeItem('jarvis_google_token');
  localStorage.removeItem('jarvis_google_refresh_token');
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith('sb-')) localStorage.removeItem(k);
  });

  if (state.supabaseClient) {
    try {
      await Promise.race([
        state.supabaseClient.auth.signOut(),
        new Promise((resolve) => setTimeout(resolve, 800))
      ]);
    } catch (e) {}
  }
  window.location.href = window.location.origin;
}

export function initAuth({ onAuthReady } = {}) {
  if (onAuthReady) onAuthReadyCallback = onAuthReady;
  capturarTokensUrl();

  document.getElementById('googleLoginBtn')?.addEventListener('click', loginGoogle);
  document.getElementById('stravaBtn')?.addEventListener('click', conectarStrava);
  document.getElementById('logoutBtn')?.addEventListener('click', logout);

  cargarConfigYAuth();
}