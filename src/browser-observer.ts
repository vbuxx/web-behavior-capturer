import type { BrowserContext, Frame, Page } from 'playwright';

export interface PageObserverState {
  records: Array<{
    id: string;
    source: 'input' | 'page';
    sequence: number;
    sourceTime: number;
    receiveTime: number;
    type: string;
    targetRef?: string;
    payload: Record<string, unknown>;
  }>;
  droppedRecords: number;
  frameIntervals: number[];
  timeOrigin: number;
  now: number;
}

export async function installPageObserver(context: BrowserContext, maxRecords = 10_000): Promise<void> {
  // tsx names nested functions with a small helper; define it in the page realm before serialized callbacks run.
  await context.addInitScript('globalThis.__name = globalThis.__name || ((target) => target);');
  await context.addInitScript((limit: number) => {
    const state = {
      records: [] as PageObserverState['records'],
      droppedRecords: 0,
      frameIntervals: [] as number[],
      sequence: 0,
    };

    const targetRef = (target: EventTarget | null): string | undefined => {
      if (!(target instanceof Element)) return undefined;
      const element = target.closest('[data-wbc-id]');
      return element instanceof HTMLElement && element.dataset.wbcId
        ? `nav-1:main:${element.dataset.wbcId}`
        : undefined;
    };

    const push = (source: 'input' | 'page', type: string, target: EventTarget | null, payload: Record<string, unknown>) => {
      if (state.records.length >= limit) {
        state.droppedRecords += 1;
        return;
      }
      state.sequence += 1;
      const ref = targetRef(target);
      const record: PageObserverState['records'][number] = {
        id: `page-${state.sequence}`,
        source,
        sequence: state.sequence,
        sourceTime: performance.now(),
        receiveTime: Date.now(),
        type,
        payload,
      };
      if (ref) record.targetRef = ref;
      state.records.push(record);
    };

    const start = () => {
      for (const type of ['pointerover', 'pointerout', 'focusin', 'focusout', 'click']) {
        document.addEventListener(type, (event) => {
          const pointer = event instanceof PointerEvent
            ? { clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType }
            : {};
          push('input', type, event.target, pointer);
        }, true);
      }

      document.addEventListener('scroll', (event) => {
        push('input', 'scroll', event.target, { scrollX: window.scrollX, scrollY: window.scrollY });
      }, true);

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          push('page', 'mutation', mutation.target, {
            mutationType: mutation.type,
            attributeName: mutation.attributeName,
          });
        }
      });
      observer.observe(document, {
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-expanded', 'hidden'],
        childList: true,
        subtree: true,
      });

      let previous = performance.now();
      const tick = (now: number) => {
        state.frameIntervals.push(now - previous);
        if (state.frameIntervals.length > 2_000) state.frameIntervals.shift();
        previous = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    (window as unknown as { __WBC_OBSERVER__: typeof state }).__WBC_OBSERVER__ = state;
    start();
  }, maxRecords);
}

export async function readPageObserver(realm: Page | Frame): Promise<PageObserverState> {
  return realm.evaluate(() => {
    const state = (window as unknown as { __WBC_OBSERVER__: Omit<PageObserverState, 'timeOrigin' | 'now'> }).__WBC_OBSERVER__;
    return {
      ...state,
      timeOrigin: performance.timeOrigin,
      now: performance.now(),
    };
  });
}

export async function measureFrameIntervals(page: Page, count = 90): Promise<number[]> {
  return page.evaluate(async (sampleCount) => {
    const intervals: number[] = [];
    let previous = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        intervals.push(now - previous);
        previous = now;
        if (intervals.length >= sampleCount) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return intervals.slice(2);
  }, count);
}
