/* global FileReader */

const tg = window.Telegram?.WebApp;
const TAB_LABELS = {
  register: 'Регистрация',
  waiting: 'Заявка',
  qr: 'QR',
  profile: 'Профиль',
  visitors: 'Гости',
  scanner: 'Сканер',
  audit: 'Журнал',
  users: 'Пользователи',
  requests: 'Заявки'
};
const ROLE_LABELS = {
  operator: 'Администратор',
  tenant_admin: 'Админ арендатора',
  employee: 'Сотрудник',
  visitor: 'Посетитель',
  internal_staff: 'Персонал',
  guard: 'Охранник'
};
const ADMIN_ROLES = ['operator', 'tenant_admin', 'employee', 'internal_staff', 'guard'];
const FACE_PHOTO_MAX_SIDE = 900;
const FACE_PHOTO_QUALITY = 0.72;

const els = {
  appTitle: document.getElementById('appTitle'),
  appSubtitle: document.getElementById('appSubtitle'),
  reloadApp: document.getElementById('reloadApp'),
  tabs: document.getElementById('tabs'),
  panes: Array.from(document.querySelectorAll('.pane')),
  consent: document.getElementById('consent'),
  registrationName: document.getElementById('registrationName'),
  roleChoices: document.getElementById('roleChoices'),
  facePhotoInput: document.getElementById('facePhotoInput'),
  facePhotoPreview: document.getElementById('facePhotoPreview'),
  submitRegistration: document.getElementById('submitRegistration'),
  registrationMessage: document.getElementById('registrationMessage'),
  waitingText: document.getElementById('waitingText'),
  qrName: document.getElementById('qrName'),
  qrRole: document.getElementById('qrRole'),
  qrStep: document.getElementById('qrStep'),
  qrBox: document.getElementById('qrBox'),
  qrTimer: document.getElementById('qrTimer'),
  qrAccess: document.getElementById('qrAccess'),
  refreshQr: document.getElementById('refreshQr'),
  qrMessage: document.getElementById('qrMessage'),
  profileName: document.getElementById('profileName'),
  profileDetails: document.getElementById('profileDetails'),
  visitorName: document.getElementById('visitorName'),
  createVisitorPass: document.getElementById('createVisitorPass'),
  visitorResult: document.getElementById('visitorResult'),
  visitorQrBox: document.getElementById('visitorQrBox'),
  visitorMessage: document.getElementById('visitorMessage'),
  scannerModes: document.getElementById('scannerModes'),
  scannerVideo: document.getElementById('scannerVideo'),
  cameraState: document.getElementById('cameraState'),
  manualToken: document.getElementById('manualToken'),
  submitManualScan: document.getElementById('submitManualScan'),
  faceCheck: document.getElementById('faceCheck'),
  faceName: document.getElementById('faceName'),
  faceHint: document.getElementById('faceHint'),
  facePhoto: document.getElementById('facePhoto'),
  faceOk: document.getElementById('faceOk'),
  faceFail: document.getElementById('faceFail'),
  scanResult: document.getElementById('scanResult'),
  scanDecision: document.getElementById('scanDecision'),
  scanReason: document.getElementById('scanReason'),
  refreshAudit: document.getElementById('refreshAudit'),
  auditList: document.getElementById('auditList'),
  refreshUsers: document.getElementById('refreshUsers'),
  usersList: document.getElementById('usersList'),
  refreshRequests: document.getElementById('refreshRequests'),
  requestsList: document.getElementById('requestsList')
};

let appState = null;
let activeTab = null;
let selectedRole = 'employee';
let registrationPhotoDataUrl = null;
let qrExpiresAt = null;
let qrTimerHandle = null;
let qrRefreshHandle = null;
let scannerId = 'scn_main_entry';
let detector = null;
let scannerBusy = false;
let scannerStarted = false;
let lastToken = '';
let lastTokenAt = 0;
let facePhotoObjectUrl = null;
let pendingFaceCheck = null;

tg?.ready();
tg?.expand();

bindEvents();
loadAppState();

function bindEvents() {
  els.reloadApp.addEventListener('click', loadAppState);
  els.refreshQr.addEventListener('click', loadQr);
  els.submitRegistration.addEventListener('click', submitRegistration);
  els.facePhotoInput.addEventListener('change', handleRegistrationPhoto);
  els.createVisitorPass.addEventListener('click', createVisitorPass);
  els.submitManualScan.addEventListener('click', () => {
    const token = els.manualToken.value.trim();

    if (token) {
      submitScan(token);
    }
  });
  els.faceOk.addEventListener('click', () => submitFaceVerification(true));
  els.faceFail.addEventListener('click', () => submitFaceVerification(false));
  els.refreshAudit.addEventListener('click', loadAudit);
  els.refreshUsers.addEventListener('click', loadUsers);
  els.refreshRequests.addEventListener('click', loadRegistrationRequests);

  els.roleChoices.addEventListener('click', (event) => {
    const button = event.target.closest('[data-role]');

    if (!button) {
      return;
    }

    selectedRole = button.dataset.role;
    renderChoiceButtons(els.roleChoices, selectedRole, 'role');
  });

  els.scannerModes.addEventListener('click', (event) => {
    const button = event.target.closest('[data-scanner]');

    if (!button) {
      return;
    }

    scannerId = button.dataset.scanner;
    renderChoiceButtons(els.scannerModes, scannerId, 'scanner');
  });
}

async function loadAppState() {
  try {
    const payload = await fetchJson('/api/v1/app/state');

    appState = payload;
    renderAppShell();
  } catch (error) {
    els.appTitle.textContent = 'Откройте из Telegram';
    els.appSubtitle.textContent =
      error.message || 'Для работы приложения нужны данные Telegram Web App.';
    els.tabs.replaceChildren();
    showOnlyPane(null);
  }
}

function renderAppShell() {
  const subject = appState.subject;
  const request = appState.registration_request;

  els.appTitle.textContent = subject?.full_name || 'QR-доступ';
  els.appSubtitle.textContent = subject
    ? `${subject.role_label} · ${subject.tenant_name}`
    : request?.status === 'pending'
      ? 'Заявка ожидает решения администратора'
      : 'Пройдите регистрацию для получения доступа';

  renderTabs(appState.tabs);

  if (!activeTab || !appState.tabs.includes(activeTab)) {
    activeTab = appState.tabs[0] || null;
  }

  activateTab(activeTab);
}

function renderTabs(tabs) {
  const buttons = tabs.map((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = TAB_LABELS[tab] || tab;
    button.classList.toggle('active', tab === activeTab);
    button.addEventListener('click', () => activateTab(tab));
    return button;
  });

  els.tabs.replaceChildren(...buttons);
}

function activateTab(tab) {
  activeTab = tab;
  renderTabs(appState?.tabs || []);
  showOnlyPane(tab);

  if (tab === 'register') {
    renderChoiceButtons(els.roleChoices, selectedRole, 'role');
  }

  if (tab === 'waiting') {
    renderWaiting();
  }

  if (tab === 'qr') {
    loadQr();
  }

  if (tab === 'profile') {
    renderProfile();
  }

  if (tab === 'scanner') {
    renderChoiceButtons(els.scannerModes, scannerId, 'scanner');
    startScannerCamera();
  }

  if (tab === 'audit') {
    loadAudit();
  }

  if (tab === 'users') {
    loadUsers();
  }

  if (tab === 'requests') {
    loadRegistrationRequests();
  }
}

function showOnlyPane(tab) {
  for (const pane of els.panes) {
    pane.classList.toggle('active', pane.id === `pane-${tab}`);
  }
}

function renderWaiting() {
  const request = appState.registration_request;

  els.waitingText.textContent = request
    ? `Заявка на роль “${request.requested_role_label}” отправлена ${formatDate(request.created_at)}.`
    : 'После одобрения в приложении появятся доступные вкладки.';
}

async function handleRegistrationPhoto() {
  const file = els.facePhotoInput.files?.[0];

  registrationPhotoDataUrl = file ? await fileToCompressedImageDataUrl(file) : null;
  els.facePhotoPreview.classList.toggle('hidden', !registrationPhotoDataUrl);

  if (registrationPhotoDataUrl) {
    els.facePhotoPreview.src = registrationPhotoDataUrl;
  }
}

async function submitRegistration() {
  els.registrationMessage.textContent = '';

  if (!els.consent.checked) {
    els.registrationMessage.textContent = 'Нужно принять согласие на обработку данных.';
    return;
  }

  if (!els.registrationName.value.trim()) {
    els.registrationMessage.textContent = 'Введите имя и фамилию.';
    return;
  }

  if (!registrationPhotoDataUrl) {
    els.registrationMessage.textContent = 'Фото лица обязательно. Без фото заявку отправить нельзя.';
    return;
  }

  try {
    await fetchJson('/api/v1/registration/request', {
      method: 'POST',
      body: {
        full_name: els.registrationName.value.trim(),
        requested_role: selectedRole,
        consent_accepted: true,
        photo_data_url: registrationPhotoDataUrl
      }
    });
    els.registrationMessage.textContent = 'Заявка отправлена администратору.';
    await loadAppState();
  } catch (error) {
    els.registrationMessage.textContent = error.message || 'Не удалось отправить заявку.';
  }
}

async function loadQr() {
  clearTimeout(qrRefreshHandle);
  clearInterval(qrTimerHandle);

  try {
    const payload = await fetchJson('/api/v1/qr/current');

    renderQr(payload);

    if (payload.refresh_after_ms) {
      qrRefreshHandle = setTimeout(loadQr, payload.refresh_after_ms);
    }
  } catch (error) {
    els.qrMessage.textContent = error.message || 'Не удалось загрузить QR.';
  }
}

function renderQr(payload) {
  els.qrName.textContent = payload.display.full_name;
  els.qrRole.textContent = `${payload.display.job_title} · ${ROLE_LABELS[payload.mode] || payload.mode}`;
  els.qrStep.textContent = stepLabel(payload.step);
  els.qrAccess.textContent = payload.display.floors.length
    ? payload.display.floors.join(', ')
    : 'Главный вход и выход';
  els.qrMessage.textContent = payload.message;
  qrExpiresAt = payload.expires_at ? new Date(payload.expires_at) : null;

  if (payload.qr_token) {
    const img = new Image();
    img.alt = 'QR-код пропуска';
    img.src = `/api/v1/qr/svg?token=${encodeURIComponent(payload.qr_token)}`;
    els.qrBox.replaceChildren(img);
  } else {
    els.qrBox.replaceChildren(textNode('Нет активного QR'));
  }

  updateQrTimer();
  qrTimerHandle = setInterval(updateQrTimer, 1_000);
}

function updateQrTimer() {
  if (!qrExpiresAt) {
    els.qrTimer.textContent = 'нет токена';
    return;
  }

  const seconds = Math.max(0, Math.ceil((qrExpiresAt.getTime() - Date.now()) / 1_000));
  els.qrTimer.textContent = `${seconds} сек.`;
}

function renderProfile() {
  const subject = appState.subject;

  if (!subject) {
    return;
  }

  els.profileName.textContent = subject.full_name;
  els.profileDetails.replaceChildren(
    detail('Роль', subject.role_label),
    detail('Компания/группа', subject.tenant_name),
    detail('Статус', statusLabel(subject.status)),
    detail('Точки доступа', 'Главный вход и выход'),
    detail('Фото лица', subject.photo_data_url || subject.photo_file_id ? 'добавлено' : 'нет')
  );
}

async function createVisitorPass() {
  els.visitorMessage.textContent = '';
  els.visitorResult.classList.add('hidden');

  if (!els.visitorName.value.trim()) {
    els.visitorMessage.textContent = 'Введите имя и фамилию гостя.';
    return;
  }

  try {
    const payload = await fetchJson('/api/v1/visitor-passes/static', {
      method: 'POST',
      body: {
        full_name: els.visitorName.value.trim()
      }
    });
    const img = new Image();

    img.alt = 'Гостевой QR-код';
    img.src = `/api/v1/qr/svg?token=${encodeURIComponent(payload.qr_token)}`;
    els.visitorQrBox.replaceChildren(img);
    els.visitorMessage.textContent = `QR для ${payload.pass.visitor_full_name}. Действует до ${formatDate(payload.pass.expires_at)}.`;
    els.visitorResult.classList.remove('hidden');
  } catch (error) {
    els.visitorMessage.textContent = error.message || 'Не удалось создать гостевой QR.';
  }
}

async function startScannerCamera() {
  if (scannerStarted) {
    return;
  }

  scannerStarted = true;

  if (!('BarcodeDetector' in window)) {
    els.cameraState.textContent =
      'В этом браузере нет QR-детектора. Используйте ручную проверку ниже.';
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
    els.scannerVideo.srcObject = stream;
    await els.scannerVideo.play();
    els.cameraState.textContent = 'Сканирование активно';
    requestAnimationFrame(scanFrame);
  } catch (error) {
    els.cameraState.textContent = `Камера недоступна: ${error.message || error}`;
  }
}

async function scanFrame() {
  if (!detector || scannerBusy) {
    requestAnimationFrame(scanFrame);
    return;
  }

  try {
    const codes = await detector.detect(els.scannerVideo);
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
  scannerBusy = true;
  pendingFaceCheck = null;
  hideFaceCheck();
  renderScanResult('pending', 'Проверка', 'Отправляем QR на сервер.');
  const requestId = crypto.randomUUID();

  try {
    const payload = await fetchJson('/api/v1/access/scan', {
      method: 'POST',
      body: {
        request_id: requestId,
        scanner_id: scannerId,
        captured_at: new Date().toISOString(),
        token
      }
    });

    if (payload.decision === 'allow') {
      renderScanResult('allow', 'QR действителен', 'Теперь сверьте лицо с фото регистрации.');
      pendingFaceCheck = {
        requestId
      };
      renderFaceCheck(payload.subject);
      return;
    }

    pendingFaceCheck = null;
    renderScanResult(
      'deny',
      'Доступ запрещён',
      `${payload.display_message} · ${payload.reason_code}`
    );
  } catch (error) {
    pendingFaceCheck = null;
    renderScanResult('deny', 'Ошибка', error.message || 'Не удалось проверить QR.');
  } finally {
    setTimeout(() => {
      scannerBusy = false;
    }, 1_000);
  }
}

async function submitFaceVerification(matched) {
  if (!pendingFaceCheck) {
    hideFaceCheck();
    renderScanResult('deny', 'Проверка лица не найдена', 'Повторите сканирование QR.');
    return;
  }

  try {
    await fetchJson('/api/v1/access/face-check', {
      method: 'POST',
      body: {
        request_id: pendingFaceCheck.requestId,
        matched
      }
    });

    hideFaceCheck();
    pendingFaceCheck = null;

    if (matched) {
      renderScanResult('allow', 'Лицо подтверждено', 'Проход засчитан в системе.');
      return;
    }

    renderScanResult('deny', 'Лицо не совпадает', 'Проход отменён и записан как отказ.');
  } catch (error) {
    renderScanResult('deny', 'Ошибка проверки лица', error.message || 'Не удалось сохранить проверку лица.');
  }
}

function renderFaceCheck(subject) {
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
    els.faceHint.textContent = 'Фото не найдено. Для новых регистраций фото обязательно.';
    return;
  }

  loadTelegramPhoto(subject.photo_file_id);
}

async function loadTelegramPhoto(fileId) {
  try {
    if (facePhotoObjectUrl) {
      URL.revokeObjectURL(facePhotoObjectUrl);
    }

    const response = await fetch(`/api/v1/telegram/file/${encodeURIComponent(fileId)}`, {
      headers: authHeaders()
    });

    if (!response.ok) {
    throw new Error('Не удалось загрузить фото.');
    }

    facePhotoObjectUrl = URL.createObjectURL(await response.blob());
    els.facePhoto.src = facePhotoObjectUrl;
    els.faceHint.textContent = 'Сравните человека перед вами с фото регистрации.';
  } catch {
    els.facePhoto.removeAttribute('src');
    els.faceHint.textContent = 'Фото не удалось загрузить. Проверьте человека вручную.';
  }
}

function hideFaceCheck() {
  els.faceCheck.classList.add('hidden');
}

function renderScanResult(kind, title, reason) {
  els.scanResult.classList.toggle('allow', kind === 'allow');
  els.scanResult.classList.toggle('deny', kind === 'deny');
  els.scanDecision.textContent = title;
  els.scanReason.textContent = reason;
}

async function loadAudit() {
  try {
    const payload = await fetchJson('/api/v1/access/events?limit=50');
    const events = payload.events.map(renderAuditEvent);

    els.auditList.replaceChildren(
      ...(events.length ? events : [emptyArticle('Пока нет событий прохода.')])
    );
  } catch (error) {
    els.auditList.replaceChildren(emptyArticle(error.message || 'Не удалось загрузить журнал.'));
  }
}

function renderAuditEvent(event) {
  const article = document.createElement('article');
  const title = document.createElement('div');
  const chips = document.createElement('div');
  const reason = document.createElement('p');

  title.className = 'item-title';
  chips.className = 'chips';
  title.append(
    strong(event.decision === 'allow' ? 'Разрешено' : 'Запрещено'),
    span(new Date(event.occurred_at).toLocaleTimeString('ru-RU'))
  );
  chips.append(
    chip(directionLabel(event.direction)),
    chip(event.access_point_label || event.scanner_id),
    chip(event.subject_name || 'Без пользователя'),
    chip(ROLE_LABELS[event.subject_kind] || 'неизвестно')
  );
  reason.className = 'muted';
  reason.textContent = `${event.display_message} · ${event.reason_code}`;
  article.append(title, chips, reason);

  return article;
}

async function loadUsers() {
  try {
    const payload = await fetchJson('/api/v1/users');
    const users = payload.users.map(renderUser);

    els.usersList.replaceChildren(
      ...(users.length ? users : [emptyArticle('Пользователей пока нет.')])
    );
  } catch (error) {
    els.usersList.replaceChildren(emptyArticle(error.message || 'Не удалось загрузить пользователей.'));
  }
}

function renderUser(user) {
  const article = document.createElement('article');
  const title = document.createElement('div');
  const chips = document.createElement('div');
  const actions = document.createElement('div');
  const deleteButton = button('Удалить', 'danger');

  title.className = 'item-title';
  chips.className = 'chips';
  actions.className = 'choice-row';
  title.append(strong(user.full_name), span(user.role_label));
  chips.append(
    chip(user.telegram_username ? `@${user.telegram_username}` : 'без username'),
    chip(user.tenant_name),
    chip(user.photo_data_url || user.photo_file_id ? 'фото есть' : 'фото нет')
  );

  for (const role of ADMIN_ROLES) {
    const roleButton = button(ROLE_LABELS[role]);

    roleButton.classList.toggle('active', role === user.kind);
    roleButton.addEventListener('click', () => updateUserRole(user.id, role));
    actions.append(roleButton);
  }

  deleteButton.addEventListener('click', () => deleteUser(user.id));
  actions.append(deleteButton);
  article.append(title, chips, actions);

  return article;
}

async function updateUserRole(userId, role) {
  await fetchJson(`/api/v1/users/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    body: {
      role
    }
  });
  await loadUsers();
  await loadAppState();
}

async function deleteUser(userId) {
  await fetchJson(`/api/v1/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE'
  });
  await loadUsers();
}

async function loadRegistrationRequests() {
  try {
    const payload = await fetchJson('/api/v1/registration/requests?status=pending');
    const requests = payload.requests.map(renderRegistrationRequest);

    els.requestsList.replaceChildren(
      ...(requests.length ? requests : [emptyArticle('Новых заявок нет.')])
    );
  } catch (error) {
    els.requestsList.replaceChildren(emptyArticle(error.message || 'Не удалось загрузить заявки.'));
  }
}

function renderRegistrationRequest(request) {
  const article = document.createElement('article');
  const title = document.createElement('div');
  const chips = document.createElement('div');
  const actions = document.createElement('div');
  const photo = document.createElement('img');
  const approveButton = button('Одобрить');
  const rejectButton = button('Отклонить', 'danger');

  title.className = 'item-title';
  chips.className = 'chips';
  actions.className = 'choice-row';
  photo.className = 'inline-photo';
  photo.alt = `Фото ${request.full_name}`;
  photo.src = request.photo_data_url;
  title.append(strong(request.full_name), span(request.requested_role_label));
  chips.append(
    chip(request.username ? `@${request.username}` : 'без username'),
    chip(formatDate(request.created_at)),
    chip('согласие получено')
  );
  approveButton.addEventListener('click', () => reviewRegistrationRequest(request.id, true));
  rejectButton.addEventListener('click', () => reviewRegistrationRequest(request.id, false));
  actions.append(approveButton, rejectButton);
  article.append(title, photo, chips, actions);

  return article;
}

async function reviewRegistrationRequest(requestId, approve) {
  await fetchJson(
    `/api/v1/registration/requests/${encodeURIComponent(requestId)}/${approve ? 'approve' : 'reject'}`,
    {
      method: 'POST',
      body: approve ? undefined : { reason: 'Отклонено администратором' }
    }
  );
  await loadRegistrationRequests();
  await loadUsers();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      ...authHeaders(),
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 413) {
      throw new Error('Фото слишком большое. Выберите другое фото или сделайте снимок ближе к лицу.');
    }

    throw new Error(errorLabel(payload.error) || response.statusText);
  }

  return payload;
}

function authHeaders() {
  const headers = {};

  if (tg?.initData) {
    headers.authorization = `tma ${tg.initData}`;
    return headers;
  }

  const params = new URLSearchParams(window.location.search);
  const devUsername = params.get('dev_username');
  const devUserId = params.get('dev_user_id') || (devUsername ? `dev_${devUsername}` : null);

  if (devUserId) {
    headers['x-dev-telegram-user-id'] = devUserId;
  }

  if (devUsername) {
    headers['x-dev-telegram-username'] = devUsername;
  }

  return headers;
}

function renderChoiceButtons(container, activeValue, dataKey) {
  for (const button of container.querySelectorAll(`[data-${dataKey}]`)) {
    button.classList.toggle('active', button.dataset[dataKey] === activeValue);
  }
}

async function fileToCompressedImageDataUrl(file) {
  const sourceDataUrl = await fileToDataUrl(file);
  return compressImageDataUrl(sourceDataUrl);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(sourceDataUrl) {
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      const scale = Math.min(1, FACE_PHOTO_MAX_SIDE / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');

      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');

      if (!context) {
        resolve(sourceDataUrl);
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      resolve(canvas.toDataURL('image/jpeg', FACE_PHOTO_QUALITY));
    };

    image.onerror = () => resolve(sourceDataUrl);
    image.src = sourceDataUrl;
  });
}

function detail(label, value) {
  const item = document.createElement('div');
  const labelEl = document.createElement('span');
  const valueEl = document.createElement('strong');

  labelEl.textContent = label;
  valueEl.textContent = value;
  item.append(labelEl, valueEl);

  return item;
}

function emptyArticle(message) {
  const article = document.createElement('article');

  article.className = 'muted';
  article.textContent = message;

  return article;
}

function button(label, className) {
  const element = document.createElement('button');

  element.type = 'button';
  element.textContent = label;

  if (className) {
    element.classList.add(className);
  }

  return element;
}

function chip(label) {
  const element = document.createElement('span');

  element.textContent = label;
  return element;
}

function strong(value) {
  const element = document.createElement('strong');

  element.textContent = value;
  return element;
}

function span(value) {
  const element = document.createElement('span');

  element.textContent = value;
  return element;
}

function textNode(value) {
  const element = document.createElement('span');

  element.textContent = value;
  return element;
}

function formatDate(value) {
  return new Date(value).toLocaleString('ru-RU');
}

function stepLabel(step) {
  return (
    {
      pending: 'ожидание',
      enter: 'вход',
      exit: 'выход',
      move: 'доступ',
      expired: 'истёк',
      revoked: 'отозван'
    }[step] || step
  );
}

function statusLabel(status) {
  return (
    {
      active: 'активен',
      disabled: 'отключён',
      revoked: 'отозван'
    }[status] || status
  );
}

function directionLabel(direction) {
  return (
    {
      enter: 'вход',
      exit: 'выход',
      move: 'доступ'
    }[direction] || direction
  );
}

function errorLabel(error) {
  return (
    {
      open_app_from_telegram: 'Откройте приложение через Telegram.',
      already_registered: 'Вы уже зарегистрированы.',
      invalid_registration_payload: 'Проверьте имя, роль и фото. Фото должно быть обычным изображением и не слишком большим.',
      full_name_requires_first_and_last_name: 'Введите имя и фамилию.',
      face_photo_required: 'Фото лица обязательно.',
      personal_data_consent_required: 'Нужно принять согласие на обработку данных.',
      role_requires_admin_approval: 'Эту роль нельзя выбрать самостоятельно.',
      registration_requests_not_allowed: 'Нет доступа к заявкам.',
      users_not_allowed: 'Нет доступа к списку пользователей.',
      visitor_pass_not_allowed: 'Нет доступа к созданию гостевых QR.',
      cannot_change_own_role: 'Нельзя изменить свою роль.',
      cannot_delete_self: 'Нельзя удалить самого себя.',
      invalid_scanner_secret: 'Неверный ключ сканера.',
      invalid_scan_payload: 'Некорректные данные сканирования.',
      scanner_not_allowed: 'Нет доступа к сканеру.',
      audit_not_allowed: 'Нет доступа к журналу.',
      photo_access_denied: 'Нет доступа к фото пользователя.',
      invalid_face_verification_payload: 'Некорректные данные проверки лица.',
      access_event_not_found: 'Событие сканирования не найдено. Повторите сканирование.'
    }[error] || 'Произошла ошибка. Попробуйте ещё раз.'
  );
}
