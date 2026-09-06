const nodes = document.querySelector('#nodes');
for (let index = 0; index < 5000; index += 1) {
  const node = document.createElement('div');
  node.className = `node${index < 50 ? ' track' : ''}`;
  node.dataset.loadIndex = String(index);
  node.textContent = `Synthetic node ${index}`;
  nodes.append(node);
}
const loadState = {
  ready: false,
  nodes: 0,
  tracks: 0,
  workerMessages: 0,
  crossOriginReady: false,
};
globalThis.__WBC_LOAD__ = loadState;
const worker = new Worker('/probe-worker.js');
worker.addEventListener('message', () => { loadState.workerMessages += 1; });
worker.postMessage({ type: 'load-benchmark-ping' });
fetch('/load-config.json').then((response) => response.json()).then(({ crossOriginFrameUrl }) => {
  const frame = document.createElement('iframe');
  frame.title = 'synthetic cross-origin load frame';
  frame.width = '320';
  frame.height = '80';
  frame.onload = () => { loadState.crossOriginReady = true; };
  frame.src = crossOriginFrameUrl;
  document.body.append(frame);
  loadState.nodes = document.querySelectorAll('*').length;
  loadState.tracks = document.getAnimations().length;
  loadState.ready = true;
  document.body.dataset.wbcReady = 'true';
});
