const tg = window.Telegram?.WebApp;
const eventsEl = document.getElementById('events');
const refreshButton = document.getElementById('refresh');

tg?.ready();
tg?.expand();

refreshButton.addEventListener('click', loadEvents);
loadEvents();
setInterval(loadEvents, 5_000);

async function loadEvents() {
  const response = await fetch('/api/v1/access/events?limit=50', {
    headers: authHeaders()
  });
  const payload = await response.json();

  if (!response.ok) {
    eventsEl.innerHTML = `<div class="empty">${payload.error || 'Не удалось загрузить журнал'}</div>`;
    return;
  }

  if (!payload.events.length) {
    eventsEl.innerHTML = '<div class="empty">Пока нет событий прохода.</div>';
    return;
  }

  eventsEl.replaceChildren(...payload.events.map(renderEvent));
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

function renderEvent(event) {
  const article = document.createElement('article');
  article.className = `event ${event.decision}`;

  const marker = document.createElement('div');
  marker.className = 'marker';

  const content = document.createElement('div');
  content.className = 'content';

  const topline = document.createElement('div');
  topline.className = 'topline';

  const decision = document.createElement('span');
  decision.className = 'decision';
  decision.textContent = event.decision === 'allow' ? 'Разрешено' : 'Запрещено';

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = new Date(event.occurred_at).toLocaleTimeString('ru-RU');

  topline.append(decision, time);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.append(
    chip(directionLabel(event.direction)),
    chip(event.access_point_label || event.scanner_id),
    chip(event.subject_name || 'Без пользователя'),
    chip(roleLabel(event.subject_kind || 'unknown'))
  );

  const reason = document.createElement('div');
  reason.className = 'reason';
  reason.textContent = `${event.display_message} · ${event.reason_code}`;

  content.append(topline, meta, reason);
  article.append(marker, content);

  return article;
}

function chip(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
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

function roleLabel(role) {
  return (
    {
      operator: 'администратор',
      tenant_admin: 'админ арендатора',
      employee: 'сотрудник',
      visitor: 'посетитель',
      internal_staff: 'персонал',
      guard: 'охранник',
      unknown: 'неизвестно'
    }[role] || role
  );
}
