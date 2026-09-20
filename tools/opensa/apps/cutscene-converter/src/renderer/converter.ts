import type { ConverterApi } from '../shared/ipc';

declare global {
  interface Window {
    readonly converter: ConverterApi;
  }
}

/** Everything the renderer can do to the outside world, exposed by the preload bridge. */
export const converter: ConverterApi = window.converter;
