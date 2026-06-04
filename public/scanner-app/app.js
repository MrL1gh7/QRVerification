const tg = window.Telegram?.WebApp;
const els = {
  scannerLabel: document.getElementById('scannerLabel'),
  modeTabs: Array.from(document.querySelectorAll('[data-scanner]')),
  video: document.getElementById('video'),
  cameraState: document.getElementById('cameraState'),
  manualToken: document.getElementById('manualToken'),
  submitManual: document.getElementById('submitManual'),
  faceCheck: document.getElementById('faceCheck'),
  faceName: document.getElementById('faceName'),
  faceHint: document.getElementById('faceHint'),
  facePhoto: document.getElementById('facePhoto'),
  faceOk: document.getElementById('faceOk'),
  faceFail: document.getElementById('faceFail'),
  result: document.getElementById('result'),
  decision: document.getElementById('decision'),
  reason: document.getElementById('reason')
};

let detector = null;
let busy = false;
let lastToken = '';
let lastTokenAt = 0;
let facePhotoUrl = null;
let scannerId = scannerFromQuery();
let pendingFaceCheck = null;

tg?.ready();
tg?.expand();

renderScannerMode();
hideFaceCheck();

for (const tab of els.modeTabs) {
  tab.addEventListener('click', () => {
    scannerId = tab.dataset.scanner || 'scn_main_entry';
    const nextUrl = new URL(window.location.href);

    nextUrl.searchParams.set('scanner', scannerId);
    window.history.replaceState(null, '', nextUrl);
    renderScannerMode();
    hideFaceCheck();
  });
}

els.submitManual.addEventListener('click', () => {
  const token = els.manualToken.value.trim();

  if (token) {
    submitScan(token);
  }
});

els.faceOk.addEventListener('click', () => submitFaceVerification(true));
els.faceFail.addEventListener('click', () => submitFaceVerification(false));

startCamera();

async function startCamera() {
  if (!('BarcodeDetector' in window)) {
    els.cameraState.textContent = 'Камера без QR-детектора. Используйте ручную проверку.';
    return;
  }

  try {
    detector = new BarcodeDetector({ formats: ['qr_code'] });
    const stream = await navigator.mediaDevices.getUserMedia({
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
  pendingFaceCheck = null;
  hideFaceCheck();
  renderPending();
  const requestId = crypto.randomUUID();

  try {
    const response = await fetch('/api/v1/access/scan', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        request_id: requestId,
        scanner_id: scannerId,
        captured_at: new Date().toISOString(),
        token
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      renderResult('deny', 'Ошибка', errorLabel(payload.error));
      return;
    }

    if (payload.decision === 'allow') {
      renderResult('allow', 'QR действителен', 'Теперь проверьте лицо человека.');
      pendingFaceCheck = {
        requestId
      };
      await renderFaceCheck(payload.subject);
      return;
    }

    pendingFaceCheck = null;
    renderResult('deny', 'Доступ запрещён', `${payload.display_message} · ${payload.reason_code}`);
  } catch (error) {
    pendingFaceCheck = null;
    renderResult('deny', 'Ошибка', String(error.message || error));
  } finally {
    setTimeout(() => {
      busy = false;
    }, 1_000);
  }
}

async function submitFaceVerification(matched) {
  if (!pendingFaceCheck) {
    hideFaceCheck();
    renderResult('deny', 'Проверка лица не найдена', 'Повторите сканирование QR.');
    return;
  }

  try {
    const response = await fetch('/api/v1/access/face-check', {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        request_id: pendingFaceCheck.requestId,
        matched
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      renderResult('deny', 'Ошибка проверки лица', errorLabel(payload.error));
      return;
    }

    hideFaceCheck();
    pendingFaceCheck = null;

    if (matched) {
      renderResult('allow', 'Лицо подтверждено', 'Проход засчитан в системе.');
      return;
    }

    renderResult('deny', 'Лицо не совпадает', 'Проход отменён и записан как отказ.');
  } catch (error) {
    renderResult('deny', 'Ошибка проверки лица', String(error.message || error));
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

async function renderFaceCheck(subject) {
  if (!subject) {
    return;
  }

  els.faceName.textContent = subject.full_name || 'Пользователь';
  els.faceCheck.classList.remove('hidden');

  if (subject.photo_data_url) {
    els.facePhoto.src = subject.photo_data_url;
    els.faceHint.textContent = 'Сравните человека перед вами с фото регистрации.';
    return;
  }

  if (!subject.photo_file_id) {
    els.facePhoto.removeAttribute('src');
    els.faceHint.textContent = 'Фото регистрации не добавлено. Проверьте документ или попросите пользователя обновить регистрацию.';
    return;
  }

  try {
    if (facePhotoUrl) {
      URL.revokeObjectURL(facePhotoUrl);
    }

    const response = await fetch(
      `/api/v1/telegram/file/${encodeURIComponent(subject.photo_file_id)}`,
      {
        headers: authHeaders()
      }
    );

    if (!response.ok) {
      throw new Error('Не удалось загрузить фото.');
    }

    facePhotoUrl = URL.createObjectURL(await response.blob());
    els.facePhoto.src = facePhotoUrl;
    els.faceHint.textContent = 'Сравните человека перед вами с фото регистрации.';
  } catch {
    els.facePhoto.removeAttribute('src');
    els.faceHint.textContent = 'Фото не удалось загрузить. Проверьте человека вручную.';
  }
}

function hideFaceCheck() {
  els.faceCheck.classList.add('hidden');
}

function authHeaders() {
  const headers = {};

  if (tg?.initData) {
    headers.authorization = `tma ${tg.initData}`;
  }

  return headers;
}

function scannerFromQuery() {
  const scanner = new URLSearchParams(window.location.search).get('scanner');

  return scanner === 'scn_exit' ? 'scn_exit' : 'scn_main_entry';
}

function renderScannerMode() {
  const isExit = scannerId === 'scn_exit';

  els.scannerLabel.textContent = isExit ? 'Выход' : 'Вход';

  for (const tab of els.modeTabs) {
    const isActive = tab.dataset.scanner === scannerId;

    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  }
}

function errorLabel(error) {
  return (
    {
      invalid_scanner_secret: 'Неверный ключ сканера.',
      invalid_scan_payload: 'Некорректные данные сканирования.',
      scanner_not_allowed: 'Нет доступа к сканеру.',
      photo_access_denied: 'Нет доступа к фото пользователя.',
      invalid_face_verification_payload: 'Некорректные данные проверки лица.',
      access_event_not_found: 'Событие сканирования не найдено. Повторите сканирование.'
    }[error] || error || 'Не удалось проверить QR.'
  );
}
