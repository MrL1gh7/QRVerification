const tg = window.Telegram?.WebApp;
const els = {
  scannerId: document.getElementById('scannerId'),
  video: document.getElementById('video'),
  cameraState: document.getElementById('cameraState'),
  manualToken: document.getElementById('manualToken'),
  submitManual: document.getElementById('submitManual'),
  result: document.getElementById('result'),
  decision: document.getElementById('decision'),
  reason: document.getElementById('reason')
};

let detector = null;
let stream = null;
let busy = false;
let lastToken = '';
let lastTokenAt = 0;

tg?.ready();
tg?.expand();

els.submitManual.addEventListener('click', () => {
  const token = els.manualToken.value.trim();

  if (token) {
    submitScan(token);
  }
});

startCamera();

async function startCamera() {
  if (!('BarcodeDetector' in window)) {
    els.cameraState.textContent = 'Камера без QR-детектора. Используйте ручную проверку.';
    return;
  }

  try {
    detector = new BarcodeDetector({ formats: ['qr_code'] });
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment'
      },
      audio: false
    });
    els.video.srcObject = stream;
    await els.video.play();
    els.cameraState.textContent = 'Сканирование активно';
    requestAnimationFrame(scanFrame);
  } catch (error) {
    els.cameraState.textContent = `Камера недоступна: ${error.message || error}`;
  }
}

async function scanFrame() {
  if (!detector || busy) {
    requestAnimationFrame(scanFrame);
    return;
  }

  try {
    const codes = await detector.detect(els.video);
    const token = codes[0]?.rawValue;

    if (token?.startsWith('tgac:v1:')) {
      const now = Date.now();

      if (token !== lastToken || now - lastTokenAt > 5_000) {
        lastToken = token;
        lastTokenAt = now;
        els.manualToken.value = token;
        await submitScan(token);
      }
    }
  } catch (error) {
    els.cameraState.textContent = `Ошибка сканирования: ${error.message || error}`;
  } finally {
    requestAnimationFrame(scanFrame);
  }
}

async function submitScan(token) {
  busy = true;
  renderPending();

  try {
    const response = await fetch('/api/v1/access/scan', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        request_id: crypto.randomUUID(),
        scanner_id: els.scannerId.value,
        captured_at: new Date().toISOString(),
        token
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      renderResult('deny', 'Ошибка', payload.error || 'scan_failed');
      return;
    }

    renderResult(
      payload.decision,
      payload.decision === 'allow' ? 'Доступ разрешен' : 'Доступ запрещен',
      `${payload.display_message} · ${payload.reason_code}`
    );
  } catch (error) {
    renderResult('deny', 'Ошибка', String(error.message || error));
  } finally {
    setTimeout(() => {
      busy = false;
    }, 1_000);
  }
}

function renderPending() {
  els.result.classList.remove('allow', 'deny');
  els.decision.textContent = 'Проверка';
  els.reason.textContent = 'Отправляем QR на сервер.';
}

function renderResult(decision, title, reason) {
  els.result.classList.toggle('allow', decision === 'allow');
  els.result.classList.toggle('deny', decision !== 'allow');
  els.decision.textContent = title;
  els.reason.textContent = reason;
}

function authHeaders() {
  const headers = {};

  if (tg?.initData) {
    headers.authorization = `tma ${tg.initData}`;
  }

  return headers;
}
