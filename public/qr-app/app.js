const tg = window.Telegram?.WebApp;
const els = {
  fullName: document.getElementById('fullName'),
  roleLine: document.getElementById('roleLine'),
  step: document.getElementById('step'),
  qrBox: document.getElementById('qrBox'),
  timer: document.getElementById('timer'),
  tenantName: document.getElementById('tenantName'),
  floors: document.getElementById('floors'),
  status: document.getElementById('status'),
  message: document.getElementById('message'),
  demoSubject: document.getElementById('demoSubject')
};

let expiresAt = null;
let refreshHandle = null;
let timerHandle = null;

tg?.ready();
tg?.expand();

const params = new URLSearchParams(window.location.search);
els.demoSubject.value = params.get('subject') || params.get('demo_user_id') || '';

els.demoSubject.addEventListener('change', () => {
  const next = new URL(window.location.href);

  if (els.demoSubject.value) {
    next.searchParams.set('subject', els.demoSubject.value);
  } else {
    next.searchParams.delete('subject');
    next.searchParams.delete('demo_user_id');
  }

  window.location.href = next.toString();
});

loadQr();

async function loadQr() {
  clearTimeout(refreshHandle);
  const query = new URLSearchParams();
  const subject = els.demoSubject.value;

  if (subject) {
    query.set('subject', subject);
  }

  const response = await fetch(`/api/v1/qr/current?${query.toString()}`, {
    headers: authHeaders()
  });

  const payload = await response.json();

  if (!response.ok) {
    renderError(payload.error || 'qr_load_failed');
    return;
  }

  renderQrState(payload);

  if (payload.refresh_after_ms) {
    refreshHandle = setTimeout(loadQr, payload.refresh_after_ms);
  }
}

function renderQrState(payload) {
  document.body.classList.toggle('is-bad', ['revoked', 'expired'].includes(payload.step));
  document.body.classList.toggle('is-warn', ['pending'].includes(payload.step));
  els.fullName.textContent = payload.display.full_name;
  els.roleLine.textContent = `${payload.display.job_title} · ${payload.mode}`;
  els.step.textContent = labelStep(payload.step);
  els.tenantName.textContent = payload.display.tenant_name;
  els.floors.textContent = payload.display.floors.length
    ? payload.display.floors.join(', ')
    : 'нет';
  els.status.textContent = payload.display.status;
  els.message.textContent = payload.message;
  expiresAt = payload.expires_at ? new Date(payload.expires_at) : null;

  if (payload.qr_token) {
    const img = new Image();
    img.alt = 'QR token';
    img.src = `/api/v1/qr/svg?token=${encodeURIComponent(payload.qr_token)}`;
    els.qrBox.replaceChildren(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.textContent = 'Нет активного QR';
    els.qrBox.replaceChildren(placeholder);
  }

  updateTimer();
  clearInterval(timerHandle);
  timerHandle = setInterval(updateTimer, 1_000);
}

function renderError(message) {
  document.body.classList.add('is-bad');
  els.fullName.textContent = 'Ошибка';
  els.roleLine.textContent = 'QR недоступен';
  els.step.textContent = 'deny';
  els.message.textContent = message;
}

function updateTimer() {
  if (!expiresAt) {
    els.timer.textContent = 'нет токена';
    return;
  }

  const seconds = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1_000));
  els.timer.textContent = `${seconds} сек.`;
}

function authHeaders() {
  const headers = {
    accept: 'application/json'
  };

  if (tg?.initData) {
    headers.authorization = `tma ${tg.initData}`;
  }

  return headers;
}

function labelStep(step) {
  return (
    {
      pending: 'ожидание',
      enter: 'вход',
      exit: 'выход',
      move: 'доступ',
      expired: 'истек',
      revoked: 'отозван'
    }[step] || step
  );
}
