/**
 * app.js — GateFlow Frontend
 * ─────────────────────────────────────────────────────────────────
 * Stack: Vanilla ES6+, WebSocket nativo, Fetch API
 * Backend: FastAPI su http://0.0.0.0:8000  /  ws://0.0.0.0:8000/ws (ascolta su tutte le reti)
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// CONFIGURAZIONE
// ═══════════════════════════════════════════════════════════════
const API_BASE = window.location.origin;
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${protocol}//${window.location.host}/ws`;
/** Soglia allarme: 120 minuti in millisecondi */
const OVERDUE_THRESHOLD_MS = 120 * 60 * 1000;
/** Stato modalità presentazione (simulazione +2h) */
let isPresentationMode = false;
let demoModeActivationTime = null;
const PRESENTATION_OFFSET_MS = 2 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// AUTOMAZIONE AMAZON (VRID Look-up)
// ═══════════════════════════════════════════════════════════════
const AMAZON_VRID_MAPPING = {
  "113S43RV": { linea: "AMA301", cliente: "MXP5 - CASTEL S.G.", is48h: true },
  "225B99XY": { linea: "AMA412", cliente: "BLQ1 - BOLOGNA", is48h: false },
  // Aggiungeremo qui gli altri codici forniti dall'utente
};

/** 
 * Esegue il lookup del VRID e compila i campi in automatico 
 */
function handleVridLookup(val, isModal = false) {
  const vrid = val.trim().toUpperCase();
  const prefix = isModal ? 'modal-' : 'ci-';

  const match = AMAZON_VRID_MAPPING[vrid];
  if (match) {
    const elLinea = document.getElementById(`${prefix}linea`);
    const elCliente = document.getElementById(`${prefix}cliente`);
    const elNote = document.getElementById(`${prefix}note`);

    if (elLinea) elLinea.value = match.linea;
    if (elCliente) elCliente.value = match.cliente;

    if (match.is48h) {
      if (elNote && !elNote.value.includes("DATA FDC")) {
        // Calcola in automatico la data + 48h (2 giorni)
        const fdcDate = new Date();
        fdcDate.setDate(fdcDate.getDate() + 2);
        const fdcStr = fdcDate.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });

        elNote.value = (elNote.value ? elNote.value + " - " : "") + `DATA FDC: ${fdcStr}`;
        elNote.style.borderColor = "var(--accent-amber)";
        toast(`🚛 Amazon 48h: Data FDC calcolata in automatico (${fdcStr})`, "info");
      }
    } else {
      toast(`✅ Amazon VRID riconosciuto: ${match.cliente}`, "success");
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// STATO GLOBALE
// ═══════════════════════════════════════════════════════════════

/** @type {Array<Object>} Elenco transiti attivi */
let transits = [];

/** @type {Array<Object>} Elenco per il registro storico */
let historyTransits = [];
let currentHistoryDate = new Date().toISOString().split('T')[0];

/** @type {WebSocket|null} Connessione WebSocket corrente */
let ws = null;

/** @type {string|null} ID transito in attesa nel modal */
let pendingStatusId = null;

/** @type {string|null} ID transito selezionato per il check-out */
let pendingCheckoutId = null;

/** Contatore ingressi/uscite di oggi (solo sessione) */
let sessionEntrate = 0;
let sessionUscite = 0;

/** @type {string|null} Token JWT salvato */
let jwtToken = null;
let currentUsername = null;
let currentRole = null;
let currentCanExport = false;
let currentNome = null;
let currentMatricola = null;
let appInitialized = false;

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

appInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('gateflow_jwt');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      // Semplice check espirazione
      if (payload.exp * 1000 < Date.now()) throw new Error('Token expired');
      jwtToken = token;
      currentRole = payload.role;
      currentUsername = payload.sub;
      currentCanExport = payload.can_export;
      currentNome = payload.nome;
      currentMatricola = payload.matricola;
      document.getElementById('login-modal').classList.remove('active');
      initAppContent();
    } catch (e) {
      console.error('[GateFlow] Token Error:', e);
      localStorage.removeItem('gateflow_jwt');
      document.getElementById('login-modal').classList.add('active');
    }
  } else {
    document.getElementById('login-modal').classList.add('active');
  }
});

function initAppContent() {
  if (appInitialized) return;
  appInitialized = true;

  // Aggiorna Sidebar User Card
  const sideName = document.getElementById('sidebar-user-name');
  const sideRole = document.getElementById('sidebar-user-role');
  if (sideName) sideName.innerText = currentNome || currentUsername;
  if (sideRole) {
    const roleMap = {
      'admin': 'Amministratore Hub',
      'responsabile': 'Responsabile Supervisione',
      'portineria_in': 'Operatore Portineria IN',
      'portineria_out': 'Operatore Portineria OUT',
      'magazzino': 'Operatore Magazzino'
    };
    sideRole.innerText = roleMap[currentRole] || currentRole;
  }

  applyRbac(currentRole, currentCanExport);
  startClock();
  loadTransits();
  loadHistory(currentHistoryDate); // Avvia con log di oggi
  connectWebSocket();
  applyRbacBottomNav(currentRole);

  // Ricalcola timer e allarmi ogni 60 secondi
  setInterval(tickTimers, 60_000);
  // Ping WS ogni 25s per keepalive
  setInterval(pingWs, 25_000);

  // Inizializzazione Event Delegation per elementi dinamici
  initEventDelegation();
}

/** Inizializzazione gestori eventi globali (Delegation) */
function initEventDelegation() {
  document.addEventListener('click', e => {
    // 1. Modifica Transito (Modali)
    const editTrigger = e.target.closest('[data-action="edit-transit"]');
    if (editTrigger) {
      const id = editTrigger.getAttribute('data-id');
      const readOnly = editTrigger.getAttribute('data-readonly') === 'true';
      if (id) openStatusModal(id, readOnly);
      return;
    }

    // 2. Cambio Stato Rapido (Warehouse)
    const quickTrigger = e.target.closest('[data-action="quick-status"]');
    if (quickTrigger) {
      const id = quickTrigger.getAttribute('data-id');
      const state = quickTrigger.getAttribute('data-state');
      if (id && state) quickStatusChange(id, state);
      return;
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// RBAC E LOGIN
// ═══════════════════════════════════════════════════════════════

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('login-submit-btn');
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;

  if (!user || !pass) return;

  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> Accesso...`;

  try {
    console.log(`[GateFlow] Tentativo login per: ${user} su ${API_BASE}`);
    const formData = new URLSearchParams();
    formData.append("username", user);
    formData.append("password", pass);

    const loginRes = await fetch(`${API_BASE}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData
    });

    if (!loginRes.ok) {
      throw new Error("Credenziali non valide.");
    }
    const data = await loginRes.json();
    jwtToken = data.access_token;
    localStorage.setItem('gateflow_jwt', jwtToken);

    const payload = JSON.parse(atob(jwtToken.split('.')[1]));
    currentRole = payload.role;
    currentUsername = payload.sub;
    currentCanExport = payload.can_export;
    currentNome = payload.nome;
    currentMatricola = payload.matricola;

    document.getElementById('login-modal').classList.remove('active');
    initAppContent();
    toast(`✅ Benvenuto, <strong>${currentNome || user}</strong>`, 'success');
  } catch (err) {
    toast(`❌ ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `Accedi`;
  }
}

function handleLogout() {
  localStorage.removeItem('gateflow_jwt');
  jwtToken = null;
  currentRole = null;
  currentUsername = null;
  currentCanExport = false;
  appInitialized = false;
  window.location.reload();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar && overlay) {
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
  }
}

function applyRbac(role, canExport) {
  const tabs = ['side-portineria-in', 'side-portineria-out', 'side-dashboard', 'side-magazzino', 'side-admin'];
  const mapNav = {
    'admin': ['side-portineria-in', 'side-portineria-out', 'side-dashboard', 'side-magazzino', 'side-admin'],
    'responsabile': ['side-portineria-in', 'side-portineria-out', 'side-dashboard', 'side-magazzino', 'side-admin'],
    'portineria_in': ['side-portineria-in', 'side-dashboard'],
    'portineria_out': ['side-portineria-out', 'side-dashboard'],
    'magazzino': ['side-magazzino', 'side-dashboard'],
  };

  const allowedTabs = mapNav[role] || mapNav['admin'];

  tabs.forEach(tabId => {
    const sideBtn = document.getElementById(tabId);
    if (sideBtn) {
      sideBtn.style.display = allowedTabs.includes(tabId) ? 'flex' : 'none';
    }
  });

  // Mostra sempre il tasto sicurezza se loggato
  const secBtn = document.getElementById('side-security');
  if (secBtn) secBtn.style.display = role ? 'flex' : 'none';

  // Hides/Shows Export button based on Role
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.style.display = canExport ? 'inline-flex' : 'none';
  }

  // Activate default view based on role priority
  if (role === 'portineria_in') switchView('portineria-in', document.getElementById('side-portineria-in'));
  else if (role === 'portineria_out') switchView('portineria-out', document.getElementById('side-portineria-out'));
  else if (role === 'magazzino') switchView('magazzino', document.getElementById('side-magazzino'));
  else switchView('dashboard', document.getElementById('side-dashboard'));

  // Gestione specifica per tab Amministrazione
  const usersTabLabel = document.getElementById('label-users-tab');
  const btnNewUser = document.getElementById('btn-new-user');
  
  if (role === 'responsabile') {
    if (usersTabLabel) usersTabLabel.innerText = "Anagrafica Personale";
    if (btnNewUser) btnNewUser.style.display = "none";
  } else if (role === 'admin') {
    if (usersTabLabel) usersTabLabel.innerText = "Gestione Operatori";
    if (btnNewUser) btnNewUser.style.display = "inline-flex";
  }
}

function applyRbacBottomNav(role) {
  const mapNav = {
    'admin': ['portineria-in', 'portineria-out', 'dashboard', 'magazzino', 'admin'],
    'responsabile': ['portineria-in', 'portineria-out', 'dashboard', 'magazzino', 'admin'],
    'portineria_in': ['portineria-in', 'dashboard'],
    'portineria_out': ['portineria-out', 'dashboard'],
    'magazzino': ['magazzino', 'dashboard'],
  };
  const allowed = mapNav[role] || mapNav['admin'];

  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    if (allowed.includes(btn.getAttribute('data-view'))) {
      btn.style.display = 'flex';
    } else {
      btn.style.display = 'none';
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// OROLOGIO HEADER
// ═══════════════════════════════════════════════════════════════

function startClock() {
  const el = document.getElementById('clock');
  const tick = () => {
    el.textContent = new Date().toLocaleTimeString('it-IT', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };
  tick();
  setInterval(tick, 1000);
}

// ═══════════════════════════════════════════════════════════════
// WEBSOCKET — Connessione e gestione eventi
// ═══════════════════════════════════════════════════════════════
let wsReconnectDelay = 2000;
const MAX_RECONNECT_DELAY = 30000;

function connectWebSocket() {
  const dot = document.getElementById('ws-dot');
  const label = document.getElementById('ws-label');

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    dot.classList.add('connected');
    label.textContent = 'Connesso in tempo reale';
    wsReconnectDelay = 2000; // Reset del backoff
  };

  ws.onclose = () => {
    dot.classList.remove('connected');
    label.textContent = `Disconnesso — riconnessione tra ${wsReconnectDelay / 1000}s...`;

    // Exponential backoff
    setTimeout(connectWebSocket, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 2, MAX_RECONNECT_DELAY);
  };

  ws.onerror = () => {
    dot.classList.remove('connected');
    label.textContent = 'Errore WebSocket';
  };

  /**
   * HANDLER PRINCIPALE MESSAGGI
   * Ascolta evento `update_piazzale` (e quelli specifici del backend).
   * Aggiorna la tabella istantaneamente, senza ricaricare la pagina.
   */
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (_) {
      // Non-JSON (pong dal server), ignorato
    }
  };
}

/**
 * Invia ping periodico per mantenere la connessione WebSocket viva.
 */
function pingWs() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send('ping');
  }
}

/**
 * Processa il messaggio WebSocket ricevuto.
 * Gestisce: check_in | status_update | check_out | update_piazzale
 *
 * La tabella si aggiorna ISTANTANEAMENTE aggiungendo/rimuovendo righe
 * senza alcun refresh della pagina.
 *
 * @param {{ event: string, data: Object }} msg
 */
function handleWsMessage(msg) {
  const { event, data } = msg;

  switch (event) {

    case 'check_in':
    case 'update_piazzale': {
      // Aggiunge il nuovo transito se non già presente
      const existingIdx = transits.findIndex(t => t.id === data.id);
      if (existingIdx === -1) {
        transits.unshift(data);
        sessionEntrate++;
        document.getElementById('badge-entrate').textContent =
          `${sessionEntrate} oggi`;
        toast(
          `🚛 Nuovo arrivo: <strong>${escHtml(data.targa)}</strong> (${escHtml(data.vettore)})`,
          'success'
        );
      } else {
        transits[existingIdx] = data;
      }
      break;
    }

    case 'status_update': {
      const idx = transits.findIndex(t => t.id === data.id);
      if (idx !== -1) {
        transits[idx] = data;
        toast(`✏️ Stato aggiornato: <strong>${escHtml(data.targa)}</strong> → ${stateLabel(data.stato)}`, 'info');
      } else {
        transits.unshift(data);
      }
      break;
    }

    case 'check_out': {
      const idx = transits.findIndex(t => t.id === data.id);
      if (idx !== -1) {
        transits[idx] = data;  // mantenuto brevemente con stato USCITO
        sessionUscite++;
        document.getElementById('badge-uscite').textContent =
          `${sessionUscite} oggi`;
        toast(`🚪 Mezzo rilasciato: <strong>${escHtml(data.targa)}</strong>`, 'info');
      }
      break;
    }

    default:
      return;  // evento sconosciuto, ignora
  }

  // Rimuove i transiti già USCITI dalla lista attivi
  transits = transits.filter(t => t.stato !== 'USCITO');

  // Aggiornamento dello storico se è selezionato oggi
  const todayStr = new Date().toISOString().split('T')[0];
  if (currentHistoryDate === todayStr) {
    const existingHistIdx = historyTransits.findIndex(t => t.id === data.id);
    if (existingHistIdx === -1) {
      historyTransits.unshift(data);
    } else {
      historyTransits[existingHistIdx] = data;
    }
    historyTransits.sort((a, b) => new Date(b.timestamp_in) - new Date(a.timestamp_in));
  }

  // ──── AGGIORNAMENTO TABELLA IN REAL-TIME ────
  // Nessun reload della pagina: solo la DOM viene aggiornata
  renderAll(event === 'check_in' || event === 'update_piazzale' ? data.id : null);
}

// ═══════════════════════════════════════════════════════════════
// API CALLS (Fetch)
// ═══════════════════════════════════════════════════════════════

async function apiFetch(url, options = {}) {
  if (!options.headers) options.headers = {};
  if (jwtToken) options.headers['Authorization'] = `Bearer ${jwtToken}`;

  let res = await fetch(url, options);
  if (res.status === 401) {
    // Il token è scaduto o non valido: forza un rilogin
    localStorage.removeItem('gateflow_jwt');
    jwtToken = null;
    document.getElementById('login-modal').classList.add('active');
    appInitialized = false; // per rinizializzare la navbar al prossimo login
    throw new Error("Sessione scaduta. Effettuare di nuovo l'accesso.");
  }
  return res;
}

/**
 * Carica tutti i transiti attivi dal server (GET /transits).
 * Usato all'avvio e quando l'utente clicca "Ricarica".
 */
async function loadTransits() {
  try {
    const res = await fetch(`${API_BASE}/transits`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    transits = await res.json();
    // Rimuove USCITI dall'elenco attivi
    transits = transits.filter(t => t.stato !== 'USCITO');
    renderAll();
  } catch (err) {
    console.error('[GateFlow] Errore caricamento transiti:', err);
    renderEmptyState('dashboard-tbody', 7, '⚠️',
      'Impossibile contattare il server API. Avviare il backend (python run.py).');
    renderEmptyState('warehouse-tbody', 7, '⚠️', 'Server non raggiungibile.');
  }
}

/**
 * Carica il registro storico di una data
 */
async function loadHistory(dateStr) {
  if (!dateStr) dateStr = new Date().toISOString().split('T')[0];
  currentHistoryDate = dateStr;

  // Allinea i due input visivi
  const elIn = document.getElementById('history-date-in');
  const elOut = document.getElementById('history-date-out');
  if (elIn && elIn.value !== dateStr) elIn.value = dateStr;
  if (elOut && elOut.value !== dateStr) elOut.value = dateStr;

  try {
    const res = await apiFetch(`${API_BASE}/transits/history?day=${dateStr}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    historyTransits = await res.json();
    renderActivityLog();
  } catch (err) {
    console.error('[GateFlow] Errore caricamento storico:', err);
    const tbodyIn = document.getElementById('activity-tbody-in');
    const tbodyOut = document.getElementById('activity-tbody-out');
    if (tbodyIn) tbodyIn.innerHTML = emptyRow(7, '⚠️', 'Impossibile caricare il registro.');
    if (tbodyOut) tbodyOut.innerHTML = emptyRow(8, '⚠️', 'Impossibile caricare il registro.');
  }
}

/**
 * POST /check-in — Registra l'ingresso di un nuovo mezzo.
 * Collegato al bottone verde "REGISTRA INGRESSO".
 *
 * Invia i dati del form in formato JSON e fornisce
 * feedback immediato tramite toast notification.
 *
 * @param {SubmitEvent} e
 */
async function handleCheckIn(e) {
  e.preventDefault();

  const btn = document.getElementById('checkin-submit-btn');
  const targa = document.getElementById('ci-targa').value.trim().toUpperCase();
  const vettore = document.getElementById('ci-vettore').value.trim();
  const moloVal = document.getElementById('ci-molo').value;
  const molo = moloVal ? parseInt(moloVal, 10) : null;

  // Validazione base lato client
  if (!targa) {
    toast('❌ Inserire la targa del mezzo.', 'error');
    document.getElementById('ci-targa').focus();
    return;
  }
  if (!vettore) {
    toast('❌ Inserire il nome del vettore / corriere.', 'error');
    document.getElementById('ci-vettore').focus();
    return;
  }

  // UI feedback: disabilita il pulsante durante la chiamata
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> Registrazione in corso...`;

  try {
    /**
     * Chiamata API asincrona (POST) — invio dati in JSON
     */
    const tipo_operazione = document.getElementById('ci-operazione').value;
    const ddt = document.getElementById('ci-ddt').value.trim() || null;
    const colli_val = document.getElementById('ci-colli').value;
    const colli = colli_val ? parseInt(colli_val, 10) : null;
    const peso_val = document.getElementById('ci-peso').value;
    const peso = peso_val ? parseInt(peso_val, 10) : null;
    const note = document.getElementById('ci-note').value.trim() || null;

    // Nuovi campi
    const targa_smr = document.getElementById('ci-targa-smr').value.trim() || null;
    const autista = document.getElementById('ci-autista').value.trim() || null;
    const telefono = document.getElementById('ci-telefono').value.trim() || null;
    const codice_linea = document.getElementById('ci-linea').value.trim() || null;
    const codice_vred_tme = document.getElementById('ci-vred').value.trim() || null;
    const cliente = document.getElementById('ci-cliente').value.trim() || null;
    const partenza = document.getElementById('ci-partenza').value.trim() || null;
    const bi_val = document.getElementById('ci-bi').value;
    const bi = bi_val ? parseInt(bi_val, 10) : null;
    const ci_val = document.getElementById('ci-ci').value;
    const ci = ci_val ? parseInt(ci_val, 10) : null;
    const sacco_val = document.getElementById('ci-sacco').value;
    const sacco = sacco_val ? parseInt(sacco_val, 10) : null;
    const sfu_val = document.getElementById('ci-sfu').value;
    const percentuale_sfu = sfu_val ? parseInt(sfu_val, 10) : null;
    const pe_val = document.getElementById('ci-pe').value;
    const pe = pe_val ? parseInt(pe_val, 10) : null;
    const rr = document.getElementById('ci-rr').value.trim() || null;
    const me = document.getElementById('ci-me').value.trim() || null;
    const sigillo1 = document.getElementById('ci-sigillo1').value.trim() || null;
    const sigillo2 = document.getElementById('ci-sigillo2').value.trim() || null;

    const res = await apiFetch(`${API_BASE}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targa, vettore, molo, tipo_operazione, ddt, colli, peso, note,
        targa_smr, autista, telefono, codice_linea, codice_vred_tme,
        cliente, partenza, bi, ci, sacco, percentuale_sfu, pe, rr, me,
        sigillo1, sigillo2
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || `Errore server (HTTP ${res.status})`);
    }

    // ✅ Successo
    toast(`✅ Mezzo registrato con successo: <strong>${escHtml(data.targa)}</strong>`, 'success');
    document.getElementById('checkin-form').reset();
    document.getElementById('ci-targa').focus();

    // Il WebSocket aggiornerà automaticamente la dashboard.
    // Aggiorniamo comunque la storia locale.
    renderActivityLog();

  } catch (err) {
    toast(`❌ ${escHtml(err.message)}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      REGISTRA INGRESSO`;
  }
}

function searchTransit(query) {
  const resultBox = document.getElementById('search-result');
  const checkoutBtn = document.getElementById('checkout-btn');
  const q = query.trim().toUpperCase();

  if (!q || q.length < 3) {
    resultBox.className = 'search-result';
    resultBox.innerHTML = `
      <div class="search-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p>Inserisci almeno 3 caratteri della targa</p>
      </div>`;
    checkoutBtn.disabled = true;
    pendingCheckoutId = null;
    return;
  }

  const matches = transits.filter(t => t.targa.toUpperCase().includes(q));

  if (matches.length === 0) {
    resultBox.className = 'search-result notfound';
    resultBox.innerHTML = `
      <div class="search-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p>Nessun mezzo trovato con targa o parte di <strong>${escHtml(q)}</strong></p>
      </div>`;
    checkoutBtn.disabled = true;
    pendingCheckoutId = null;
  } else if (matches.length === 1) {
    renderCheckoutCard(matches[0], resultBox, checkoutBtn);
  } else {
    resultBox.className = 'search-result found';
    resultBox.innerHTML = `
      <div style="margin-bottom:10px;font-size:0.9rem;color:var(--text-muted)">Più mezzi trovati. Seleziona quello corretto:</div>
      ${matches.map(m => `
        <div class="vehicle-card" style="cursor:pointer; margin-bottom:8px; border:1px solid var(--border-color); padding:8px;" onclick="selectTransitExact('${escHtml(m.id)}')">
          <div style="display:flex; justify-content:space-between; align-items:center;">
             <strong>${escHtml(m.targa)}</strong>
             <span style="font-size:0.8rem; color:var(--text-muted)">${stateLabel(m.stato)}</span>
          </div>
          <div style="font-size:0.8rem; margin-top:4px;">🚛 ${escHtml(m.vettore)} ${m.molo ? `| 🏭 Molo ${m.molo}` : ''}</div>
        </div>
      `).join('')}
    `;
    checkoutBtn.disabled = true;
    pendingCheckoutId = null;
  }
}

function selectTransitExact(id) {
  const m = transits.find(t => t.id === id);
  if (m) {
    document.getElementById('co-targa').value = m.targa;
    const resultBox = document.getElementById('search-result');
    const checkoutBtn = document.getElementById('checkout-btn');
    renderCheckoutCard(m, resultBox, checkoutBtn);
  }
}

function renderCheckoutCard(found, resultBox, checkoutBtn) {
  const isOk = found.stato === 'COMPLETATO';
  resultBox.className = isOk ? 'search-result found' : 'search-result notfound';

  let html = `
    <div class="vehicle-card">
      <div class="vehicle-targa">${escHtml(found.targa)}</div>
      <div class="vehicle-meta">
        <span>🚛 ${escHtml(found.vettore)}</span>
        <span>⏱ ${formatElapsed(Date.now() - new Date(found.timestamp_in).getTime())}</span>
        ${found.molo ? `<span>🏭 Molo ${found.molo}</span>` : ''}
      </div>
      <div style="margin-top:8px;">
         <span class="badge badge-${escHtml(found.stato)}">
           ${isOk ? '✅ COMPLETATO — Autorizzato all\'uscita' : stateLabel(found.stato)}
         </span>
      </div>`;

  if (!isOk) {
    html += `
      <div style="margin-top:12px; padding-top:12px; border-top:1px dashed rgba(255,255,255,0.1)">
        <p style="font-size:0.8rem;color:var(--accent-red); margin-bottom:8px;">
          ⚠ Lo stato attuale del mezzo non autorizza l'uscita. Il magazzino ha dimenticato di aggiornarlo?
        </p>
        <button class="btn btn-sm btn-outline" style="width:100%" onclick="forceCompleteAndCheckout('${escHtml(found.id)}')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Registro Ingressi & Transiti
        </button>
      </div>`;
    checkoutBtn.disabled = true;
    pendingCheckoutId = null;
  } else {
    checkoutBtn.disabled = false;
    pendingCheckoutId = found.id;
  }

  html += `</div>`;
  resultBox.innerHTML = html;
}

async function forceCompleteAndCheckout(id) {
  await quickStatusChange(id, 'COMPLETATO');
  setTimeout(() => selectTransitExact(id), 600); // Ricarica la vista dopo l'aggiornamento
}

/**
 * POST /check-out/{id} — Rilascia il mezzo selezionato.
 * Collegato al bottone rosso "VERIFICA E RILASCIA".
 */
async function handleCheckOut() {
  if (!pendingCheckoutId) return;

  const t = transits.find(t => t.id === pendingCheckoutId);
  const targa = t ? t.targa : 'mezzo';

  const btn = document.getElementById('checkout-btn');
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> Rilascio in corso...`;

  try {
    const res = await apiFetch(`${API_BASE}/check-out/${pendingCheckoutId}`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `Errore HTTP ${res.status}`);

    toast(`✅ Check-out registrato: <strong>${escHtml(data.targa)}</strong>. Buona strada!`, 'success');

    // Reset pannello uscita
    document.getElementById('co-targa').value = '';
    searchTransit('');
    pendingCheckoutId = null;

  } catch (err) {
    toast(`❌ Errore check-out: ${escHtml(err.message)}`, 'error');
  } finally {
    btn.disabled = !pendingCheckoutId;
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      VERIFICA E RILASCIA`;
  }
}

/**
 * PATCH /update-status/{id} — Aggiorna lo stato da magazzino o dashboard.
 */
async function quickStatusChange(id, stato) {
  try {
    const res = await apiFetch(`${API_BASE}/update-status/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stato }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Errore aggiornamento');
    toast(`✅ <strong>${escHtml(data.targa)}</strong> → ${stateLabel(stato)}`, 'success');
  } catch (err) {
    toast(`❌ ${escHtml(err.message)}`, 'error');
  }
}

/** Export giornaliero Excel */
async function exportDaily(e) {
  e.preventDefault();
  toast('📊 Generazione report Excel in corso...', 'info');

  try {
    const res = await apiFetch(`${API_BASE}/export/daily?day=${currentHistoryDate}`);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Errore HTTP ${res.status}`);
    }

    // Scarica il blob del file Excel
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transiti_${currentHistoryDate}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();

    toast('✅ Report scaricato con successo', 'success');
  } catch (err) {
    console.error('[GateFlow] Export Error:', err);
    toast(`❌ Errore esportazione: ${err.message}`, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// MODAL — Aggiorna stato (da dashboard)
// ═══════════════════════════════════════════════════════════════

function openStatusModal(id, readOnly = false) {
  console.log("🔍 Tentativo apertura modale per ID:", id, "ReadOnly:", readOnly);
  pendingStatusId = id;

  // Cerchiamo in tutti i set di dati disponibili
  let t = transits.find(x => x.id === id);
  if (!t) {
    t = historyTransits.find(x => x.id === id);
  }

  if (!t) {
    console.error("❌ Transito non trovato per ID:", id);
    toast("Errore: Transito non trovato nei dati caricati.", "error");
    return;
  }

  console.log("✅ Transito trovato:", t.targa);

  document.getElementById('modal-transit-id').value = t.id;
  document.getElementById('modal-targa').value = t.targa || '';
  document.getElementById('modal-targa-smr').value = t.targa_smr || '';
  document.getElementById('modal-autista').value = t.autista || '';
  document.getElementById('modal-telefono').value = t.telefono || '';
  document.getElementById('modal-vettore').value = t.vettore || '';
  document.getElementById('modal-operazione').value = t.tipo_operazione || 'CARICO';
  document.getElementById('modal-stato').value = t.stato || '';
  document.getElementById('modal-molo').value = t.molo || '';
  document.getElementById('modal-linea').value = t.codice_linea || '';
  document.getElementById('modal-vred').value = t.codice_vred_tme || '';
  document.getElementById('modal-cliente').value = t.cliente || '';
  document.getElementById('modal-partenza').value = t.partenza || '';
  document.getElementById('modal-ddt').value = t.ddt || '';
  document.getElementById('modal-colli').value = t.colli || '';
  document.getElementById('modal-bi').value = t.bi || '';
  document.getElementById('modal-ci').value = t.ci || '';
  document.getElementById('modal-sacco').value = t.sacco || '';
  document.getElementById('modal-sfu').value = t.percentuale_sfu || '';
  document.getElementById('modal-pe').value = t.pe || '';
  document.getElementById('modal-rr').value = t.rr || '';
  document.getElementById('modal-me').value = t.me || '';
  document.getElementById('modal-sigillo1').value = t.sigillo1 || '';
  document.getElementById('modal-sigillo2').value = t.sigillo2 || '';
  document.getElementById('modal-note').value = t.note || '';

  // Gestione modalità sola lettura
  const saveBtn = document.querySelector('#status-modal .modal-footer .btn-primary');
  const modalInputs = document.querySelectorAll('#status-modal .field-input');

  const delBtn = document.getElementById('delete-transit-btn');

  if (readOnly) {
    if (saveBtn) saveBtn.style.display = 'none';
    if (delBtn) delBtn.style.display = 'none';
    modalInputs.forEach(input => input.disabled = true);
    document.getElementById('modal-heading').innerText = 'Dettagli Transito (Sola Lettura)';
  } else {
    if (saveBtn) saveBtn.style.display = 'inline-flex';
    modalInputs.forEach(input => input.disabled = false);
    // Solo Admin e Responsabile possono eliminare
    if (delBtn) {
      delBtn.style.display = (currentRole === 'admin' || currentRole === 'responsabile') ? 'inline-flex' : 'none';
    }
    document.getElementById('modal-heading').innerText = 'Modifica Transito';

    // RBAC di Campo: I profili base non possono modificare i dati anagrafici del mezzo
    const advancedFields = ['modal-targa', 'modal-targa-smr', 'modal-vettore', 'modal-linea', 'modal-vred', 'modal-cliente', 'modal-partenza', 'modal-autista', 'modal-telefono', 'modal-operazione'];
    const isPowerUser = (currentRole === 'admin' || currentRole === 'responsabile');
    
    advancedFields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !isPowerUser;
    });
  }

  document.getElementById('status-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('status-modal').classList.remove('active');
  pendingStatusId = null;
}

async function confirmStatusChange() {
  if (!pendingStatusId) return;
  const targa = document.getElementById('modal-targa').value.trim().toUpperCase();
  const vettore = document.getElementById('modal-vettore').value.trim();
  const tipo_operazione = document.getElementById('modal-operazione').value;
  const nuovoStato = document.getElementById('modal-stato').value;
  const moloVal = document.getElementById('modal-molo').value;
  const molo = (moloVal && !isNaN(moloVal)) ? parseInt(moloVal, 10) : null;
  const ddt = document.getElementById('modal-ddt').value.trim() || null;
  const colliVal = document.getElementById('modal-colli').value;
  const colli = (colliVal && !isNaN(colliVal)) ? parseInt(colliVal, 10) : null;
  const note = document.getElementById('modal-note').value.trim() || null;

  const payload = {
    targa, vettore, tipo_operazione, molo, ddt, colli, note,
    targa_smr: document.getElementById('modal-targa-smr').value.trim() || null,
    autista: document.getElementById('modal-autista').value.trim() || null,
    telefono: document.getElementById('modal-telefono').value.trim() || null,
    codice_linea: document.getElementById('modal-linea').value.trim() || null,
    codice_vred_tme: document.getElementById('modal-vred').value.trim() || null,
    cliente: document.getElementById('modal-cliente').value.trim() || null,
    partenza: document.getElementById('modal-partenza').value.trim() || null,
    bi: document.getElementById('modal-bi').value ? parseInt(document.getElementById('modal-bi').value, 10) : null,
    ci: document.getElementById('modal-ci').value ? parseInt(document.getElementById('modal-ci').value, 10) : null,
    sacco: document.getElementById('modal-sacco').value ? parseInt(document.getElementById('modal-sacco').value, 10) : null,
    percentuale_sfu: document.getElementById('modal-sfu').value ? parseInt(document.getElementById('modal-sfu').value, 10) : null,
    pe: document.getElementById('modal-pe').value ? parseInt(document.getElementById('modal-pe').value, 10) : null,
    rr: document.getElementById('modal-rr').value.trim() || null,
    me: document.getElementById('modal-me').value.trim() || null,
    sigillo1: document.getElementById('modal-sigillo1').value.trim() || null,
    sigillo2: document.getElementById('modal-sigillo2').value.trim() || null,
  };

  if (nuovoStato) payload.stato = nuovoStato;

  try {
    const res = await apiFetch(`${API_BASE}/transito/${pendingStatusId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      const detail = data.detail;
      let msg;
      if (Array.isArray(detail)) {
        msg = detail.map(e => {
          const field = e.loc ? e.loc[e.loc.length - 1] : 'campo';
          return `<b>${field}</b>: ${e.msg}`;
        }).join('<br>');
      } else {
        msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
      }
      toast(`❌ Errore salvataggio:<br>${msg}`, 'error');
      return;
    }
    toast(`✅ Transito aggiornato: <strong>${escHtml(data.targa)}</strong>`, 'success');
    loadTransits();
    loadHistory();
    closeModal();
  } catch (err) {
    toast(`❌ ${err.message || 'Errore sconosciuto'}`, 'error');
  }
}

// Chiudi modal cliccando sull'overlay
document.getElementById('status-modal').addEventListener('click', function (e) {
  if (e.target === this) closeModal();
});

/** Eliminazione definitiva di un transito (Admin/Responsabile) */
async function handleDeleteTransit() {
  if (!pendingStatusId) return;
  if (!confirm("Sei sicuro di voler eliminare definitivamente questo transito? L'azione non è reversibile.")) return;

  try {
    const res = await apiFetch(`${API_BASE}/transito/${pendingStatusId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error("Errore durante l'eliminazione");
    
    toast("Transito eliminato", "success");
    closeModal();
    loadTransits();
  } catch (err) {
    toast(err.message, "error");
  }
}





// ═══════════════════════════════════════════════════════════════
// RENDER — Aggiornamento DOM
// ═══════════════════════════════════════════════════════════════

/** Aggiorna tutti i componenti visual */
function renderAll(newlyAddedId = null) {
  updateKpis();
  renderDashboard(newlyAddedId);
  renderWarehouse();
  renderActivityLog();
  renderFastTrack();
}

/** Renderizza la lista fast track dei mezzi pronti per uscire */
function renderFastTrack() {
  const container = document.getElementById('fast-track-list');
  if (!container) return;

  const readyTransits = transits.filter(t => t.stato === 'COMPLETATO');

  if (readyTransits.length === 0) {
    container.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 1rem; border: 1px dashed var(--glass-border); border-radius: var(--radius-sm);">Nessun mezzo in attesa di rilascio.</div>`;
    return;
  }

  container.innerHTML = readyTransits.map(t => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border: 1px solid var(--accent-emerald); border-radius: var(--radius-sm); background: #f0fdf4; margin-bottom: 8px;">
      <div>
        <div style="font-family: 'Roboto Mono', monospace; font-size: 1.3rem; font-weight: 800; color: var(--accent-emerald); line-height: 1.2;">${escHtml(t.targa)}</div>
        <div style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">🚛 ${escHtml(t.vettore)} ${t.molo ? `| 🏭 Molo ${t.molo}` : ''}</div>
      </div>
      <button class="btn btn-sm btn-ingresso" onclick="forceCheckout('${escHtml(t.id)}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"><polyline points="15 18 9 12 15 6"/></svg>
        RILASCIA SUBITO
      </button>
    </div>
  `).join('');
}

async function forceCheckout(id) {
  pendingCheckoutId = id;
  await handleCheckOut();
}

/** Aggiorna le KPI card nella dashboard */
function updateKpis() {
  const now = Date.now();
  const counts = { INGRESSO: 0, IN_CARICO: 0, COMPLETATO: 0, overdue: 0 };

  transits.forEach(t => {
    if (t.stato === 'INGRESSO') counts.INGRESSO++;
    if (t.stato === 'IN_CARICO') counts.IN_CARICO++;
    if (t.stato === 'COMPLETATO') counts.COMPLETATO++;
    const age = now - new Date(t.timestamp_in).getTime();
    if (age > OVERDUE_THRESHOLD_MS && t.stato !== 'USCITO') counts.overdue++;
  });

  document.getElementById('stat-total').textContent = transits.length;
  document.getElementById('stat-ingresso').textContent = counts.INGRESSO;
  document.getElementById('stat-in-carico').textContent = counts.IN_CARICO;
  document.getElementById('stat-completato').textContent = counts.COMPLETATO;
  document.getElementById('stat-overdue').textContent = counts.overdue;

  // Evidenzia KPI allarme se > 0
  const kpiOverdue = document.getElementById('kpi-overdue');
  if (kpiOverdue) {
    kpiOverdue.style.borderColor = counts.overdue > 0
      ? 'rgba(240,82,82,0.5)'
      : 'rgba(240,82,82,0.25)';
  }
}

/**
 * Render tabellone piazzale Real-Time.
 *
 * Logica allarmi: se permanenza > 120 min → classe `alert-red`
 * (sfondo rosso chiaro + bordo sinistro rosso).
 *
 * @param {string|null} newlyAddedId — ID da evidenziare con flash
 */
function renderDashboard(newlyAddedId = null) {
  const tbody = document.getElementById('dashboard-tbody');
  if (!tbody) return;

  if (transits.length === 0) {
    tbody.innerHTML = emptyRow(8, '🏭', 'Nessun mezzo attualmente in hub.');
    return;
  }

  const now = Date.now();
  tbody.innerHTML = transits.map(t => {
    const t_entry = new Date(t.timestamp_in).getTime();
    const offset = (isPresentationMode && t_entry < demoModeActivationTime) ? PRESENTATION_OFFSET_MS : 0;
    const ageMs = (now - t_entry) + offset;
    const isOverdue = ageMs > OVERDUE_THRESHOLD_MS;
    const rowClass = isOverdue ? 'alert-red' : '';
    const flashClass = t.id === newlyAddedId ? 'row-flash' : '';

    return `
      <tr class="${rowClass} ${flashClass}" data-id="${escHtml(t.id)}">
        <td><div style="font-weight:700;">${formatTime(t.timestamp_in)}</div><div style="font-size:0.7rem;opacity:0.6;">${formatDate(t.timestamp_in)}</div></td>
        <td>
          <div class="plate-group">
            <strong class="plate-text">${escHtml(t.targa)}</strong>
            ${t.targa_smr ? `<span class="smr-tag">${escHtml(t.targa_smr)}</span>` : ''}
          </div>
        </td>
        <td>
          <div style="font-weight:600; color:var(--accent-blue);">${escHtml(t.codice_linea || '—')}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${escHtml(t.cliente || '—')}</div>
        </td>
        <td><span style="font-size:0.85rem; font-weight:700;">${escHtml(t.partenza || '—')}</span></td>
        <td>
          <div style="font-size:0.85rem; font-weight:600;">${escHtml(t.vettore)}</div>
          <span class="badge ${t.tipo_operazione === 'SCARICO' ? 'badge-info' : 'badge-outline'}" style="font-size:0.65rem; padding:2px 6px;">${escHtml(t.tipo_operazione)}</span>
        </td>
        <td><div class="molo-badge">${t.molo ?? '—'}</div></td>
        <td style="max-width: 180px; cursor: pointer;" data-action="edit-transit" data-id="${t.id}" title="Modifica transito">
          <div class="note-cell-dashboard">
            <span style="font-size: 0.8rem; font-style: italic; color: var(--text-secondary); line-height: 1.2;">
               ${escHtml(t.note || '—')}
            </span>
          </div>
        </td>
        <td>
          <span class="timer ${timerClass(ageMs)}" data-ts="${t.timestamp_in}">
            ${formatElapsed(ageMs)}
          </span>
        </td>
        <td><span class="badge badge-${escHtml(t.stato)}">${stateLabelDetailed(t)}</span></td>
      </tr>`;
  }).join('');
}

/** Render tabella gestione magazzino */
function renderWarehouse() {
  const tbody = document.getElementById('warehouse-tbody');
  if (!tbody) return;

  const active = transits.filter(t => t.stato !== 'USCITO');

  if (active.length === 0) {
    tbody.innerHTML = emptyRow(8, '🏭', 'Nessun mezzo in hub da gestire.');
    return;
  }

  const now = Date.now();
  tbody.innerHTML = active.map(t => {
    const t_entry = new Date(t.timestamp_in).getTime();
    const offset = (isPresentationMode && t_entry < demoModeActivationTime) ? PRESENTATION_OFFSET_MS : 0;
    const ageMs = (now - t_entry) + offset;
    const nexts = nextStates(t.stato);

    return `
      <tr data-id="${escHtml(t.id)}">
        <td><div style="font-weight:700;">${formatTime(t.timestamp_in)}</div></td>
        <td>
          <div class="plate-group">
            <strong class="plate-text-small">${escHtml(t.targa)}</strong>
            <div style="font-size:0.7rem; color:var(--accent-blue); font-weight:700; margin-top:2px;">${escHtml(t.codice_linea || '—')}</div>
          </div>
        </td>
        <td><span style="font-size:0.85rem; font-weight:600;">${escHtml(t.cliente || '—')}</span></td>
        <td>
          <div style="font-size:0.85rem; font-weight:600;">${escHtml(t.vettore)}</div>
          <span class="badge ${t.tipo_operazione === 'SCARICO' ? 'badge-info' : 'badge-outline'}" style="font-size:0.65rem; padding:2px 6px;">${escHtml(t.tipo_operazione)}</span>
        </td>
        <td style="font-size:0.8rem;">
            ${t.note ? `<div style="color:var(--accent-amber); font-weight:800; text-transform:uppercase; font-size:0.65rem;">Nota Op:</div><div style="font-weight:600;">${escHtml(t.note)}</div>` : ''}
            ${t.ddt ? `<div style="opacity:0.6; margin-top:4px;">DDT: ${escHtml(t.ddt)}</div>` : ''}
            ${!t.note && !t.ddt ? '<span style="color:var(--text-muted)">Nessun dettaglio</span>' : ''}
        </td>
        <td><div class="molo-badge-mini" style="background:var(--accent-blue); color:white; border-radius:50%;">${t.molo ?? '—'}</div></td>
        <td><span class="badge badge-${escHtml(t.stato)}">${stateLabelDetailed(t)}</span></td>
        <td class="cell-action-edit" onclick="openStatusModal('${t.id}', false)" title="Modifica Completa">
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </td>
        <td>
          <div style="display:flex; flex-direction:column; gap:4px;">
            ${nexts.map(s => `
              <button class="btn btn-sm btn-state-${cssStateKey(s)}" 
                      style="font-size:0.65rem; padding:4px 8px; justify-content:flex-start;"
                      onclick="quickStatusChange('${t.id}','${s}')">
                <span style="display:flex; align-items:center; gap:6px;">${stateIcon(s)} ${stateShortLabelDetailed(s, t.tipo_operazione)}</span>
              </button>`).join('')}
          </div>
        </td>
      </tr>`;
  }).join('');
}

/** Render log attività (tab Portineria) */
function renderActivityLog() {
  const tbodyIn = document.getElementById('activity-tbody-in');
  const tbodyOut = document.getElementById('activity-tbody-out');

  if (historyTransits.length === 0) {
    const emptyHtml = emptyRow(8, '📋', 'Nessuna attività registrata per la data selezionata.');
    if (tbodyIn) tbodyIn.innerHTML = emptyHtml;
    if (tbodyOut) tbodyOut.innerHTML = emptyHtml;
    return;
  }

  // REGISTRO INGRESSI (Ottimizzato per Portineria IN)
  // Mostra tutti i transiti, evidenziando quelli in ingresso
  if (tbodyIn) {
    tbodyIn.innerHTML = [...historyTransits].reverse().map(t => `
      <tr class="row-compact ${t.stato === 'INGRESSO' ? 'row-highlight-in' : ''}">
        <td><div style="font-weight:700;">${formatTime(t.timestamp_in)}</div></td>
        <td>
          <div class="plate-group">
            <strong class="plate-text-small">${escHtml(t.targa)}</strong>
            ${t.targa_smr ? `<span class="smr-tag-mini">${escHtml(t.targa_smr)}</span>` : ''}
          </div>
        </td>
        <td>
          <div style="font-weight:600; font-size:0.85rem;">${escHtml(t.codice_linea || '—')}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${escHtml(t.cliente || '—')}</div>
        </td>
        <td>
          <div style="font-size:0.85rem; font-weight:600;">${escHtml(t.vettore)}</div>
          <span class="badge badge-outline" style="font-size:0.6rem; padding:1px 4px;">${escHtml(t.tipo_operazione)}</span>
        </td>
        <td><div class="molo-badge-mini">${t.molo ?? '—'}</div></td>
        <td><span class="badge badge-${escHtml(t.stato)}">${stateLabelDetailed(t)}</span></td>
        <td class="cell-action-edit" data-action="edit-transit" data-id="${t.id}" data-readonly="false" title="Modifica">
           <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
        </td>
      </tr>`).join('');
  }

  // REGISTRO USCITE (Ottimizzato per Portineria OUT)
  // Mostra solo i transiti CONCLUSI (usciti), con focus sui tempi di rilascio
  if (tbodyOut) {
    const exited = historyTransits.filter(t => t.stato === 'USCITO');
    if (exited.length === 0) {
      tbodyOut.innerHTML = emptyRow(8, '🚚', 'Nessuna uscita registrata per la data selezionata.');
    } else {
      tbodyOut.innerHTML = [...exited].reverse().map(t => `
        <tr class="row-compact row-highlight-out">
          <td><div style="font-weight:700; color:var(--accent-red);">${formatTime(t.timestamp_out)}</div></td>
          <td><strong class="plate-text-small">${escHtml(t.targa)}</strong></td>
          <td><div style="font-size:0.85rem; font-weight:600;">${escHtml(t.vettore)}</div></td>
          <td><span class="badge badge-outline" style="font-size:0.6rem;">${escHtml(t.tipo_operazione)}</span></td>
          <td>
             <div style="font-size:0.75rem; color:var(--text-muted);">Entrato: ${formatTime(t.timestamp_in)}</div>
             <div style="font-size:0.75rem; color:var(--accent-red); font-weight:700;">Uscito: ${formatTime(t.timestamp_out)}</div>
          </td>
          <td><div class="molo-badge-mini" style="background:#cbd5e1">${t.molo ?? '—'}</div></td>
          <td><span class="badge badge-USCITO">RILASCIATO</span></td>
          <td class="cell-action-edit" data-action="edit-transit" data-id="${t.id}" data-readonly="false" title="Modifica">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </td>
        </tr>`).join('');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// TIMER TICK — Aggiornamento permanenze ogni 60s
// ═══════════════════════════════════════════════════════════════

/**
 * Ricalcola tutti i timer e gli allarmi visivi ogni minuto.
 * Non ricostruisce l'intera tabella, aggiorna solo gli span .timer
 * e le classi delle righe in modo efficiente.
 */
function tickTimers() {
  const now = Date.now();

  // Aggiorna span timer
  document.querySelectorAll('.timer[data-ts]').forEach(el => {
    const tsRaw = el.getAttribute('data-ts');
    const ageMs = now - new Date(tsRaw).getTime();
    el.textContent = formatElapsed(ageMs);
    el.className = `timer ${timerClass(ageMs)}`;
  });

  // Applica/rimuovi classe allarme sulle righe
  document.querySelectorAll('#dashboard-tbody tr[data-id]').forEach(row => {
    const id = row.getAttribute('data-id');
    const t = transits.find(x => x.id === id);
    if (!t) return;
    const isOverdue = (now - new Date(t.timestamp_in).getTime()) > OVERDUE_THRESHOLD_MS;
    row.classList.toggle('alert-red', isOverdue);
  });

  // Aggiorna badge KPI
  updateKpis();
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION — Vista (Portineria / Dashboard / Magazzino)
// ═══════════════════════════════════════════════════════════════

/**
 * Passa tra le viste (Portineria, Tabellone, Magazzino).
 * Aggiorna sia i pulsanti nav-tab desktop che i bottom-nav-btn mobile.
 *
 * @param {string} viewName
 * @param {HTMLElement} btn
 */
function switchView(viewName, btn) {
  // Deseleziona tutto
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('active'));

  // Attiva vista
  const viewEl = document.getElementById(`view-${viewName}`);
  if (viewEl) viewEl.classList.add('active');

  // Attiva pulsante passato (se esiste)
  if (btn) btn.classList.add('active');

  // Attiva pulsante sidebar (se non è già quello passato)
  const sideBtn = document.getElementById(`side-${viewName}`);
  if (sideBtn) sideBtn.classList.add('active');

  // Attiva pulsante bottom-nav (mobile)
  const mobileBtn = document.querySelector(`.bottom-nav-btn[data-view="${viewName}"]`);
  if (mobileBtn) mobileBtn.classList.add('active');

  // Gestione visibilità Export Button
  // Mostra solo in IN, OUT e MAGAZZINO e se l'utente può esportare
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    const showExport = ['portineria-in', 'portineria-out', 'magazzino'].includes(viewName);
    exportBtn.style.display = (showExport && currentCanExport) ? 'inline-flex' : 'none';
  }

  // Ricarica dati se necessario
  if (viewName === 'dashboard' || viewName === 'magazzino') loadTransits();
  if (viewName === 'admin') loadUsers();
  if (viewName === 'portineria-in' || viewName === 'portineria-out') {
    const today = new Date().toISOString().split('T')[0];
    loadHistory(today);
  }
}

/** Inizializza bottom nav - No longer needed as we use static HTML for SEO/Stability */
function initBottomNav() {
  // We use the static <nav class="bottom-nav"> in index.html now.
}

// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
function togglePresentationMode() {
  isPresentationMode = !isPresentationMode;

  const btn = document.getElementById('demo-toggle-btn');
  const text = document.getElementById('demo-status-text');

  if (isPresentationMode) {
    // Registriamo il momento di attivazione per non influenzare i nuovi inserimenti live
    demoModeActivationTime = Date.now();
    btn.style.color = 'var(--accent-amber)';
    btn.style.fontWeight = '700';
    text.innerText = 'Demo Attiva (+2h)';
    toast('🚀 Modalità Demo Attivata: permanenza simulata +2 ore', 'warning');
  } else {
    btn.style.color = '';
    btn.style.fontWeight = '';
    text.innerText = 'Attiva Demo (+2h)';
    toast('⏹️ Modalità Demo Disattivata', 'info');
  }

  // Forza il refresh delle tabelle per vedere l'effetto
  renderDashboard();
  renderWarehouse();
}

// ═══════════════════════════════════════════════════════════════

/**
 * Mostra una notifica toast.
 * @param {string} html  — Messaggio (HTML permesso)
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {number} [duration=4500]
 */
function toast(html, type = 'info', duration = 4500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    error: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
    warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    info: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
  };

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content">${formatErrorMessage(html)}</div>
    <button class="toast-close-btn" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('toast-exit');
    setTimeout(() => el.remove(), 400);
  }, duration);
}

// ═══════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Restituisce la stringa di permanenza formattata.
 * Aggiorna ogni minuto tramite tickTimers().
 *
 * @param {number} ms — Millisecondi trascorsi
 */
function formatElapsed(ms) {
  if (ms < 0) return '—';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

/** Classe CSS del timer in base alla permanenza */
function timerClass(ms) {
  if (ms >= OVERDUE_THRESHOLD_MS) return 'danger';
  if (ms >= OVERDUE_THRESHOLD_MS * 0.75) return 'warning';
  return '';
}

// ═══════════════════════════════════════════════════════════════
// GESTIONE AMMINISTRAZIONE (LOGISTICS CONTROL CENTER)
// ═══════════════════════════════════════════════════════════════

/** Switch tra i tab del pannello admin */
function switchAdminTab(tabId, btn) {
  // Update Buttons
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Update Content
  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  const content = document.getElementById(`admin-tab-${tabId}`);
  if (content) content.classList.add('active');

  if (tabId === 'users') loadUsers();
  if (tabId === 'audit') loadAuditLogs();
}

/** Carica log attività reale */
async function loadAuditLogs() {
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;

  try {
    const res = await apiFetch(`${API_BASE}/logs`);
    if (!res.ok) throw new Error("Errore caricamento log");
    const logs = await res.json();

    if (logs.length === 0) {
      tbody.innerHTML = emptyRow(4, '📋', 'Nessun attività registrata.');
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const dateStr = new Date(l.timestamp).toLocaleString();
      let badgeClass = 'badge-outline';
      let roleLabel = l.role.toUpperCase();
      
      if (l.role === 'admin') { badgeClass = 'badge-admin'; roleLabel = 'ADMIN'; }
      else if (l.role === 'responsabile') { badgeClass = 'badge-resp'; roleLabel = 'RESPONSABILE'; }

      const operatorInfo = l.operator_name ? 
        `<div style="font-size:0.7rem; color:var(--text-muted); opacity:0.8;">${escHtml(l.operator_name)} ${l.operator_badge ? `[${escHtml(l.operator_badge)}]` : ''}</div>` : 
        '';

      return `
        <tr>
          <td><div style="font-size:0.8rem; font-family:monospace;">${dateStr}</div></td>
          <td>
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="font-weight:700;">${escHtml(l.username)}</div>
              <span class="badge ${badgeClass}" style="font-size:0.6rem; padding:1px 4px;">${roleLabel}</span>
            </div>
            ${operatorInfo}
          </td>
          <td><span style="font-weight:600; color:var(--accent-blue);">${escHtml(l.action)}</span></td>
          <td><div style="font-size:0.85rem; max-width:300px; white-space:normal;">${escHtml(l.details)}</div></td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    toast("Errore nel caricamento del registro attività", "error");
    console.error(err);
  }
}

/** Info per reset password (non loggato) */
function showResetInfo() {
  document.getElementById('reset-info-modal').classList.add('active');
}

function closeResetInfo() {
  document.getElementById('reset-info-modal').classList.remove('active');
}

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  if (currentRole !== 'admin' && currentRole !== 'responsabile') {
    tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center; padding:2rem;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom:8px; opacity:0.5;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><br>
      Accesso limitato
    </td></tr>`;
    return;
  }

  try {
    const res = await apiFetch(`${API_BASE}/auth/users`);
    if (!res.ok) throw new Error("Errore caricamento utenti");
    const users = await res.json();

    if (users.length === 0) {
      tbody.innerHTML = emptyRow(3, '👤', 'Nessun utente configurato.');
      return;
    }

    // Esclude l'admin principale per sicurezza, come richiesto
    const visibleUsers = users.filter(u => u.username !== 'admin');

    tbody.innerHTML = visibleUsers.map(u => `
      <tr>
        <td>
          <div style="font-weight:700;">${escHtml(u.username)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">
            ${escHtml(u.nome || 'N/D')} ${u.matricola ? `— <span style="font-family:monospace; background:#f1f5f9; padding:0 3px;">[${escHtml(u.matricola)}]</span>` : ''}
          </div>
        </td>
        <td>
          <span class="badge badge-outline" style="font-size:0.7rem;">${escHtml(u.role)}</span>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:6px;">
            <div style="width:8px; height:8px; border-radius:50%; background:${u.can_export ? 'var(--accent-green)' : 'var(--text-muted)'}"></div>
            <span style="font-size:0.8rem;">${u.can_export ? 'Sì' : 'No'}</span>
          </div>
        </td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-ghost btn-sm" onclick="manageUser('${u.id}')" title="Modifica">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn btn-ghost btn-sm" style="color:var(--accent-red);" onclick="deleteUser('${u.id}')" title="Elimina">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    renderEmptyState('users-tbody', 3, '❌', err.message);
  }
}

/** Apre il modale per creare o modificare un utente */
async function manageUser(userId = null) {
  const modal = document.getElementById('user-modal');
  const heading = document.getElementById('user-modal-heading');

  // Reset form
  document.getElementById('manage-user-id').value = userId || '';
  document.getElementById('user-username').value = '';
  document.getElementById('user-password').value = '';
  document.getElementById('user-nome').value = '';
  document.getElementById('user-matricola').value = '';
  document.getElementById('user-role').value = 'portineria_in';
  document.getElementById('user-can-export').checked = false;

  if (userId) {
    heading.innerText = (currentRole === 'responsabile') ? 'Recupero Password / Reset' : 'Modifica Profilo Operativo';
    try {
      const res = await apiFetch(`${API_BASE}/auth/users`);
      const users = await res.json();
      const u = users.find(user => user.id === userId);
      if (u) {
        document.getElementById('user-username').value = u.username;
        document.getElementById('user-nome').value = u.nome || '';
        document.getElementById('user-matricola').value = u.matricola || '';
        document.getElementById('user-role').value = u.role;
        document.getElementById('user-can-export').checked = u.can_export;
      }

      // Se Responsabile, disabilita tutto tranne la password
      if (currentRole === 'responsabile') {
        document.getElementById('user-username').disabled = true;
        document.getElementById('user-nome').disabled = true;
        document.getElementById('user-matricola').disabled = true;
        document.getElementById('user-role').disabled = true;
        document.getElementById('user-can-export').disabled = true;
        document.getElementById('user-password').placeholder = "Inserisci nuova password per il reset";
      } else {
        document.getElementById('user-username').disabled = false;
        document.getElementById('user-nome').disabled = false;
        document.getElementById('user-matricola').disabled = false;
        document.getElementById('user-role').disabled = false;
        document.getElementById('user-can-export').disabled = false;
        document.getElementById('user-password').placeholder = "";
      }

    } catch (err) {
      toast("Errore nel recupero dati utente", "error");
    }
  } else {
    heading.innerText = 'Crea Nuovo Operatore';
    // Reset disabilitazione per nuovi (solo admin può)
    document.querySelectorAll('#user-modal .field-input').forEach(i => i.disabled = false);
    document.getElementById('user-can-export').disabled = false;
  }

  modal.classList.add('active');
}

function closeUserModal() {
  document.getElementById('user-modal').classList.remove('active');
}

/** Salva (Crea o Aggiorna) un utente */
async function confirmUserSave() {
  const id = document.getElementById('manage-user-id').value;
  const username = document.getElementById('user-username').value.trim();
  const password = document.getElementById('user-password').value;
  const role = document.getElementById('user-role').value;
  const canExport = document.getElementById('user-can-export').checked;
  const nome = document.getElementById('user-nome').value;
  const matricola = document.getElementById('user-matricola').value;

  if (!username) return toast("Username richiesto", "warning");
  if (!id && !password) return toast("Password richiesta per nuovi utenti", "warning");

  let body = {};
  if (currentRole === 'responsabile' && id) {
    // Se responsabile e stiamo aggiornando, mandiamo SOLO la password se presente
    if (password) body.password = password;
    else return toast("Inserisci una nuova password", "warning");
  } else {
    body = { username, role, can_export: canExport, nome, matricola };
    if (password) body.password = password;
  }

  try {
    const url = id ? `${API_BASE}/auth/users/${id}` : `${API_BASE}/auth/users`;
    const method = id ? 'PATCH' : 'POST';

    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || "Errore nel salvataggio");
    }

    toast(id ? "Utente aggiornato" : "Nuovo utente creato", "success");
    closeUserModal();
    loadUsers();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function deleteUser(id) {
  if (!confirm("Sei sicuro di voler eliminare questo utente? L'azione è irreversibile.")) return;
  try {
    const res = await apiFetch(`${API_BASE}/auth/users/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error("Impossibile eliminare l'utente");
    toast("Utente eliminato con successo", "success");
    loadUsers();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ═══════════════════════════════════════════════════════════════
// SICUREZZA PROFILO PERSONALE
// ═══════════════════════════════════════════════════════════════

function openMyPasswordModal() {
  document.getElementById('my-new-password').value = '';
  document.getElementById('my-confirm-password').value = '';
  document.getElementById('my-password-modal').classList.add('active');
}

function closeMyPasswordModal() {
  document.getElementById('my-password-modal').classList.remove('active');
}

async function confirmMyPasswordChange() {
  const pass = document.getElementById('my-new-password').value;
  const conf = document.getElementById('my-confirm-password').value;
  
  if (pass.length < 6) return toast("La password deve essere di almeno 6 caratteri", "warning");
  if (pass !== conf) return toast("Le password non coincidono", "warning");
  
  try {
    const res = await apiFetch(`${API_BASE}/auth/me/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });
    
    if (!res.ok) throw new Error("Errore durante l'aggiornamento password");
    
    toast("Password aggiornata con successo", "success");
    closeMyPasswordModal();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════


/** Formatta un timestamp ISO in orario italiano */
function formatTime(ts) {
  if (!ts) return '—';
  // Trattiamo il timestamp come ora locale (naive) per evitare offset di fuso orario
  const d = new Date(ts.replace(' ', 'T'));
  return d.toLocaleTimeString('it-IT', {
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/** Transizioni di stato valide */
function nextStates(current) {
  return ({
    INGRESSO: ['IN_CARICO'],
    IN_CARICO: ['COMPLETATO'],
    COMPLETATO: [],
    USCITO: [],
  })[current] ?? [];
}

/** Etichetta testo stato */
function stateLabel(stato) {
  return ({
    INGRESSO: 'Ingresso',
    IN_CARICO: 'In Carico',
    COMPLETATO: 'Completato',
    USCITO: 'Uscito',
  })[stato] ?? stato;
}

/** Etichetta testo stato dettagliata in base all'operazione */
function stateLabelDetailed(t) {
  if (t.stato === 'IN_CARICO') {
    if (t.tipo_operazione === 'SCARICO') return 'In Scarico';
    if (t.tipo_operazione === 'RESO') return 'In Reso';
    return 'In Carico';
  }
  return stateLabel(t.stato);
}

/** Etichetta corta per pulsanti rapidi dettagliata */
function stateShortLabelDetailed(s, op) {
  if (s === 'IN_CARICO') {
    if (op === 'SCARICO') return 'In Scarico';
    if (op === 'RESO') return 'In Reso';
    return 'In Carico';
  }
  return stateShortLabel(s);
}

/** Etichetta corta per pulsanti rapidi */
function stateShortLabel(s) {
  return ({ IN_CARICO: 'In Carico', COMPLETATO: 'Completato', USCITO: 'Uscito' })[s] ?? s;
}

/** Icona emoji per stato */
/** Icona SVG per stato */
function stateIcon(s) {
  const icons = {
    IN_CARICO: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>`,
    COMPLETATO: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    USCITO: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`
  };
  return icons[s] ?? '';
}

/** Chiave CSS per bottoni stato rapidi */
function cssStateKey(s) {
  return ({ IN_CARICO: 'carico', COMPLETATO: 'completato', USCITO: 'uscito' })[s] ?? s;
}

/** Helper: genera riga tabelI vuota */
function emptyRow(cols, icon, msg) {
  return `<tr><td colspan="${cols}">
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <p>${msg}</p>
    </div>
  </td></tr>`;
}

/** Helper: render empty state in tabella specifica */
function renderEmptyState(tbodyId, cols, icon, msg) {
  const el = document.getElementById(tbodyId);
  if (el) el.innerHTML = emptyRow(cols, icon, msg);
}

/**
 * Escape HTML — sicurezza contro XSS
 * Tutti i dati dal server passano per questa funzione prima
 * di essere inseriti nel DOM.
 */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formatta gli errori (specialmente quelli di validazione FastAPI/Pydantic) */
function formatErrorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (Array.isArray(err)) {
    return err.map(e => {
      const field = e.loc ? e.loc[e.loc.length - 1] : 'dato';
      return `Campo <strong>${field}</strong>: ${e.msg}`;
    }).join('<br>');
  }
  if (typeof err === 'object') {
    if (err.message) return err.message;
    return JSON.stringify(err);
  }
  return String(err);
}
