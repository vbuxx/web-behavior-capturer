const animationTarget = document.querySelector('.animation-equivalent');
let activeAnimation;
document.querySelector('.run').addEventListener('click', () => {
  activeAnimation?.cancel();
  activeAnimation = animationTarget.animate(
    [
      { offset: 0, transform: 'translateX(0px) scale(1)', backgroundColor: '#e9f0f8' },
      { offset: 0.45, transform: 'translateX(72px) scale(1.08)', backgroundColor: '#b7d4ef' },
      { offset: 1, transform: 'translateX(120px) scale(1)', backgroundColor: '#8dbce7' },
    ],
    { duration: 600, easing: 'ease-in-out', fill: 'forwards' },
  );
});

const reveal = document.querySelector('.reveal-equivalent');
const scrubRegion = document.querySelector('[data-scroll-region]');
const scrubTarget = document.querySelector('.scrub-equivalent');

function updateScrollBehaviors() {
  const revealRect = reveal.getBoundingClientRect();
  const revealVisible = revealRect.top < innerHeight * 0.82 && revealRect.bottom > 0;
  reveal.dataset.visible = revealVisible ? 'true' : 'false';

  const start = scrubRegion.offsetTop - innerHeight * 0.7;
  const end = start + 500;
  const progress = Math.max(0, Math.min(1, (scrollY - start) / (end - start)));
  scrubTarget.style.transform = `translate3d(${420 * progress}px, 0, 0) rotate(${8 * progress}deg)`;
}

addEventListener('scroll', updateScrollBehaviors, { passive: true });
addEventListener('resize', updateScrollBehaviors);
updateScrollBehaviors();
document.body.dataset.wbcReady = 'true';
