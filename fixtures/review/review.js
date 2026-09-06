const sessionLine = document.querySelector('#session-line');
const metrics = document.querySelector('#metrics');
const behaviors = document.querySelector('#behaviors');
const targets = document.querySelector('#targets');
const evidence = document.querySelector('#evidence');
const visuals = document.querySelector('#visuals');
const error = document.querySelector('#error');

function appendTextCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = String(value ?? '—');
  row.append(cell);
}

async function json(path) {
  const response = await fetch(path);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `Request failed: ${response.status}`);
  return payload;
}

async function loadEvidence() {
  const page = await json('/api/evidence?limit=20&byteBudget=65536');
  evidence.replaceChildren();
  for (const record of page.records) {
    const row = document.createElement('tr');
    appendTextCell(row, record.source);
    appendTextCell(row, record.type);
    appendTextCell(row, record.targetRef);
    appendTextCell(row, record.sourceTime.toFixed(1));
    evidence.append(row);
  }
}

async function loadVisuals() {
  const page = await json('/api/visuals');
  visuals.replaceChildren();
  for (const visual of page.visuals) {
    const figure = document.createElement('figure');
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.src = `/api/visual/${encodeURIComponent(visual.id)}`;
    image.alt = `Visual evidence ${visual.id}`;
    const caption = document.createElement('figcaption');
    caption.textContent = `${visual.id} · ${visual.sha256.slice(0, 12)}…`;
    figure.append(image, caption);
    visuals.append(figure);
  }
}

async function load() {
  try {
    const [session, behaviorPage] = await Promise.all([json('/api/session'), json('/api/behaviors?limit=100')]);
    sessionLine.textContent = `${session.productVersion} · ${session.sessionId}`;
    for (const [label, value] of Object.entries({ Integrity: session.integrity, Targets: session.counts.targets, Elements: session.counts.elements, Records: session.counts.records })) {
      const item = document.createElement('div');
      item.className = 'metric';
      const caption = document.createElement('span');
      caption.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = value;
      item.append(caption, strong);
      metrics.append(item);
    }
    for (const behavior of behaviorPage.behaviors) {
      const card = document.createElement('article');
      card.className = 'card';
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = behavior.kind;
      const title = document.createElement('h3');
      title.textContent = behavior.behaviorId;
      const ref = document.createElement('code');
      ref.textContent = behavior.targetRef;
      card.append(pill, title, ref);
      behaviors.append(card);
    }
    for (const target of session.targets) {
      const row = document.createElement('tr');
      appendTextCell(row, target.targetId);
      appendTextCell(row, target.kind);
      appendTextCell(row, target.lifecycleStatus);
      appendTextCell(row, target.completeness);
      targets.append(row);
    }
    await Promise.all([loadEvidence(), loadVisuals()]);
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : String(cause);
  }
}

document.querySelector('#reload').addEventListener('click', () => void loadEvidence().catch((cause) => { error.textContent = cause.message; }));
void load();
