const nodes = document.querySelector('#nodes');
for (let index = 0; index < 5000; index += 1) {
  const node = document.createElement('div');
  node.className = `node${index < 50 ? ' track' : ''}`;
  node.dataset.loadIndex = String(index);
  node.textContent = `Synthetic node ${index}`;
  nodes.append(node);
}
document.body.dataset.wbcReady = 'true';
globalThis.__WBC_LOAD__ = { ready: true, nodes: document.querySelectorAll('*').length, tracks: document.getAnimations().length };
