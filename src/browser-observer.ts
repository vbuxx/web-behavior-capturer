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
      const element = target instanceof Element
        ? target.closest('[data-wbc-id]')
        : null;
      return element instanceof HTMLElement && element.dataset.wbcId
        ? `nav-1:main:${element.dataset.wbcId}`
        : undefined;
    };

    const eventTarget = (event: Event): EventTarget | null => {
      const shadowTarget = event.composedPath().find((candidate) => candidate instanceof Element);
      return shadowTarget instanceof Element ? shadowTarget : event.target;
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
          push('input', type, eventTarget(event), pointer);
        }, true);
      }

      document.addEventListener('scroll', (event) => {
        const source = event.target instanceof Element ? event.target : document.scrollingElement;
        const maxScroll = source instanceof Element
          ? Math.max(1, source.scrollHeight - source.clientHeight)
          : Math.max(1, document.documentElement.scrollHeight - innerHeight);
        const offset = source instanceof Element ? source.scrollTop : window.scrollY;
        push('input', 'scroll', event.target, {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          containerRef: source instanceof HTMLElement && source !== document.body && source !== document.documentElement ? source.getAttribute('data-wbc-id') ?? source.tagName.toLowerCase() : 'viewport',
          containerScrollTop: offset,
          containerProgress: Math.max(0, Math.min(1, offset / maxScroll)),
          containerScrollLeft: source instanceof Element ? source.scrollLeft : window.scrollX,
        });
      }, true);

      const observeMutations = (root: Node): void => {
        const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          push('page', 'mutation', mutation.target, {
            mutationType: mutation.type,
            attributeName: mutation.attributeName,
          });
        }
      });
        observer.observe(root, {
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-expanded', 'hidden'],
        childList: true,
        subtree: true,
      });
      };
      observeMutations(document);
      const nativeAttachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit): ShadowRoot {
        const root = nativeAttachShadow.call(this, init);
        if (init.mode === 'open') observeMutations(root);
        return root;
      };

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

export async function drainPageObserver(realm: Page | Frame): Promise<PageObserverState> {
  return realm.evaluate(() => {
    const state = (window as unknown as { __WBC_OBSERVER__: Omit<PageObserverState, 'timeOrigin' | 'now'> }).__WBC_OBSERVER__;
    const records = state.records.splice(0, state.records.length);
    return {
      ...state,
      records,
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
