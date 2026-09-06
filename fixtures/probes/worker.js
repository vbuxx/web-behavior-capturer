postMessage({ type: 'worker-ready', workerTime: performance.now() });
self.addEventListener('message', (event) => {
  postMessage({ type: 'worker-echo', value: event.data, workerTime: performance.now() });
});
