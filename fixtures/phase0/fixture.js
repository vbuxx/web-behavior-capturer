/* global gsap, ScrollTrigger */

const animationTarget = document.querySelector('#css-animation');
document.querySelector('#animation-trigger').addEventListener('click', () => {
  animationTarget.classList.remove('running');
  void animationTarget.offsetWidth;
  animationTarget.classList.add('running');
});

const revealTarget = document.querySelector('#scroll-reveal');
const revealObserver = new IntersectionObserver(
  ([entry]) => revealTarget.classList.toggle('revealed', entry.isIntersecting),
  { threshold: 0.2, rootMargin: '0px 0px -18% 0px' },
);
revealObserver.observe(revealTarget);

gsap.registerPlugin(ScrollTrigger);
const scrubTween = gsap.to('#gsap-scrub', {
  x: 420,
  rotation: 8,
  ease: 'none',
  scrollTrigger: {
    id: 'phase0-scrub',
    trigger: '#scrub-section',
    start: 'top 70%',
    end: '+=500',
    scrub: true,
  },
});

window.__WBC_GSAP_ADAPTER__ = {
  version: gsap.version,
  list() {
    return ScrollTrigger.getAll().map((instance) => ({
      id: instance.vars.id || null,
      start: instance.start,
      end: instance.end,
      progress: instance.progress,
      scrub: instance.vars.scrub,
      triggerSelector: instance.trigger?.id ? `#${instance.trigger.id}` : null,
      targetSelector: '#gsap-scrub',
      animationDuration: instance.animation?.duration() ?? null,
      animationProgress: instance.animation?.progress() ?? null,
    }));
  },
};

const captureWorker = new Worker('/probe-worker.js');
captureWorker.addEventListener('message', (event) => {
  const output = document.querySelector('[data-capture-worker-status]');
  output.value = event.data.type;
  output.dataset.workerTime = String(event.data.workerTime);
});

fetch('/probe-config.json')
  .then((response) => response.json())
  .then((config) => {
    document.querySelector('[data-capture-cross-origin-frame]').src = config.crossOriginFrameUrl;
  });

const lifecycleFrame = document.querySelector('[data-capture-lifecycle-frame]');

window.__WBC_FIXTURE__ = {
  scrubTween,
  captureWorker,
  navigateLifecycleTarget() {
    lifecycleFrame.src = '/lifecycle-b/';
  },
  detachLifecycleTarget() {
    lifecycleFrame.remove();
  },
  ready: true,
};
document.body.dataset.wbcReady = 'true';
