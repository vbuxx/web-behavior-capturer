const shortTarget = document.querySelector('[data-wbc-id="short-animation"]');
document.querySelector('[data-wbc-id="short-trigger"]').addEventListener('click', () => {
  shortTarget.classList.remove('running');
  void shortTarget.offsetWidth;
  shortTarget.classList.add('running');
});

const worker = new Worker('/probe-worker.js');
worker.addEventListener('message', (event) => {
  const output = document.querySelector('[data-worker-status]');
  output.value = event.data.type;
  output.dataset.workerTime = String(event.data.workerTime);
});

fetch('/probe-config.json')
  .then((response) => response.json())
  .then((config) => {
    document.querySelector('[data-cross-origin-frame]').src = config.crossOriginFrameUrl;
  });

document.querySelector('[data-wbc-id="recreate-trigger"]').addEventListener('click', () => {
  const current = document.querySelector('[data-wbc-id="identity-probe"]');
  const replacement = current.cloneNode(true);
  replacement.dataset.instance = 'second';
  replacement.textContent = 'Replacement identity target';
  current.replaceWith(replacement);
});

document.body.dataset.wbcReady = 'true';
