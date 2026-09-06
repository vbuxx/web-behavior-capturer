const sessionLine = document.querySelector('#session-line');
const metrics = document.querySelector('#metrics');
const behaviors = document.querySelector('#behaviors');
const targets = document.querySelector('#targets');
const evidence = document.querySelector('#evidence');
const timeline = document.querySelector('#timeline');
const visuals = document.querySelector('#visuals');
const graphSummary = document.querySelector('#graph-summary');
const graphNodes = document.querySelector('#graph-nodes');
const graphEdges = document.querySelector('#graph-edges');
const annotations = document.querySelector('#annotations');
const error = document.querySelector('#error');
const revisionSelect = document.querySelector('#revision-select');
const behaviorDetail = document.querySelector('#behavior-detail');
const verificationSummary = document.querySelector('#verification-summary');
const verificationDetail = document.querySelector('#verification-detail');
const probeStatus = document.querySelector('#probe-status');
let selectedRevision = '';

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
  const page = await json(`/api/evidence?limit=20&byteBudget=65536${selectedRevision ? `&revisionId=${encodeURIComponent(selectedRevision)}` : ''}`);
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
  const page = await json(`/api/visuals${selectedRevision ? `?revisionId=${encodeURIComponent(selectedRevision)}` : ''}`);
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

async function loadTimeline() {
  const mode = document.querySelector('#timeline-mode').value;
  const page = await json(`/api/timeline?mode=${encodeURIComponent(mode)}&limit=100&byteBudget=65536${selectedRevision ? `&revisionId=${encodeURIComponent(selectedRevision)}` : ''}`);
  timeline.replaceChildren();
  for (const point of page.points) {
    const row = document.createElement('tr');
    appendTextCell(row, mode === 'scroll' && point.progress !== null ? Number(point.progress).toFixed(3) : Number(point.time).toFixed(1));
    appendTextCell(row, point.type);
    appendTextCell(row, point.source);
    appendTextCell(row, point.targetRef);
    timeline.append(row);
  }
}

async function loadVerification() {
  const reports = await json('/api/verification');
  const reference = reports.reference?.summary;
  const replica = reports.replica?.summary;
  verificationSummary.textContent = reference && replica
    ? `Reference ${reference.passed}/${reference.total} · Replica ${replica.passed}/${replica.total}`
    : 'Verification reports are not available for this package.';
  verificationDetail.textContent = JSON.stringify({ reference: reports.reference, replica: reports.replica }, null, 2);
}

async function loadGraph() {
  try {
    const graph = await json(`/api/graph${selectedRevision ? `?revisionId=${encodeURIComponent(selectedRevision)}` : ''}`);
    const counts = new Map();
    for (const node of graph.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    graphSummary.textContent = `${graph.revision} · ${graph.edges.length} edges · ${graph.limitations.length} limitations`;
    graphNodes.replaceChildren();
    for (const [kind, count] of counts) {
      const row = document.createElement('tr');
      appendTextCell(row, kind);
      appendTextCell(row, count);
      graphNodes.append(row);
    }
    graphEdges.replaceChildren();
    for (const edge of graph.edges.slice(0, 80)) {
      const row = document.createElement('tr');
      appendTextCell(row, edge.from);
      appendTextCell(row, edge.class);
      appendTextCell(row, edge.to);
      appendTextCell(row, edge.limitation);
      graphEdges.append(row);
    }
  } catch (cause) {
    graphSummary.textContent = cause instanceof Error && cause.message.includes('graph_not_available') ? 'No evidence graph in this package revision.' : String(cause);
  }
}

async function loadAnnotations() {
  const page = await json('/api/annotations');
  annotations.replaceChildren();
  for (const annotation of page.annotations) {
    const item = document.createElement('p');
    item.textContent = `${annotation.createdAt} · ${annotation.note}`;
    annotations.append(item);
  }
}

async function load() {
  try {
    const [session, behaviorPage] = await Promise.all([json('/api/session'), json(`/api/behaviors?limit=100${selectedRevision ? `&revisionId=${encodeURIComponent(selectedRevision)}` : ''}`)]);
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
      card.addEventListener('click', () => void json(`/api/behaviors?limit=100${selectedRevision ? `&revisionId=${encodeURIComponent(selectedRevision)}` : ''}`).then(async () => {
        const detail = await json(`/api/behavior/${encodeURIComponent(behavior.behaviorId)}${selectedRevision ? `?revisionId=${encodeURIComponent(selectedRevision)}` : ''}`).catch(() => null);
        behaviorDetail.textContent = detail ? JSON.stringify(detail, null, 2) : `Behavior ${behavior.behaviorId} is available through MCP behavior.get.`;
      }));
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
    await Promise.all([loadEvidence(), loadTimeline(), loadVisuals(), loadGraph(), loadAnnotations(), loadVerification()]);
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : String(cause);
  }
}

async function loadRevisions() {
  const page = await json('/api/revisions');
  revisionSelect.querySelectorAll('option:not(:first-child)').forEach((option) => option.remove());
  for (const revision of page.revisions) {
    const option = document.createElement('option');
    option.value = revision.revisionId;
    option.textContent = `${revision.revisionId} · ${revision.createdAt}`;
    revisionSelect.append(option);
  }
  if (page.activeRevisionId) revisionSelect.value = page.activeRevisionId;
}

document.querySelector('#reload').addEventListener('click', () => void loadEvidence().catch((cause) => { error.textContent = cause.message; }));
document.querySelector('#reload-timeline').addEventListener('click', () => void loadTimeline().catch((cause) => { error.textContent = cause.message; }));
document.querySelector('#timeline-mode').addEventListener('change', () => void loadTimeline().catch((cause) => { error.textContent = cause.message; }));
revisionSelect.addEventListener('change', () => { selectedRevision = revisionSelect.value; behaviors.replaceChildren(); metrics.replaceChildren(); targets.replaceChildren(); void load(); });
document.querySelector('#annotation-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const note = document.querySelector('#annotation-note').value;
  const edgeId = document.querySelector('#annotation-edge').value.trim();
  const edgeClass = document.querySelector('#annotation-class').value;
  const edgeCorrection = edgeId ? { edgeId, ...(edgeClass ? { class: edgeClass } : {}) } : undefined;
  fetch('/api/annotations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note, ...(edgeCorrection ? { edgeCorrection } : {}) }) })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(new Error(payload.error))))
    .then(() => { document.querySelector('#annotation-note').value = ''; return loadAnnotations(); })
    .catch((cause) => { error.textContent = cause.message; });
});
document.querySelector('#run-probe').addEventListener('click', () => {
  const resetRecipeId = document.querySelector('#probe-recipe').value.trim();
  const maxRuns = Number(document.querySelector('#probe-max-runs').value);
  fetch('/api/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resetRecipeId, maxRuns, baseRevisionId: selectedRevision || undefined }) })
    .then((response) => response.ok ? response.json() : response.json().then((payload) => Promise.reject(new Error(payload.error))))
    .then(async (job) => {
      probeStatus.textContent = JSON.stringify(job, null, 2);
      if (job.jobId) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const current = await json(`/api/probe/${encodeURIComponent(job.jobId)}`);
          probeStatus.textContent = JSON.stringify(current, null, 2);
          if (['completed', 'failed', 'cancelled'].includes(current.status)) { await loadRevisions(); break; }
        }
      }
    })
    .catch((cause) => { error.textContent = cause.message; });
});
void loadRevisions().then(() => { selectedRevision = revisionSelect.value; return load(); }).catch((cause) => { error.textContent = cause.message; });
