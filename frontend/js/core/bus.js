/** Bus de eventos mínimo para comunicar módulos sin acoplarlos. */
const target = new EventTarget();
export const bus = {
  on(type, fn) {
    const h = (e) => fn(e.detail);
    target.addEventListener(type, h);
    return () => target.removeEventListener(type, h);
  },
  emit(type, detail) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  },
};
