/// <reference types="emscripten" />

declare module '@cornerstonejs/codec-openjph/dist/openjphjs' {
  export class HTJ2KDecoder {
    decode: () => any;
    getBlockDimensions: () => any;
    getColorSpace: () => any;
    getDecodedBuffer: () => any;
    getEncodedBuffer: (length: number) => any;
    getFrameInfo: () => any;
    getImageOffset: () => any;
    getIsReversible: () => any;
    getNumDecompositions: () => any;
    getNumLayers: () => any;
    getProgressionOrder: () => number;
    getTileOffset: () => any;
    getTileSize: () => any;
  }
  export interface OpenJpegModule extends EmscriptenModule {
    HTJ2KDecoder: typeof HTJ2KDecoder;
  }

  declare const Module: EmscriptenModuleFactory<OpenJpegModule>;
  export default Module;
}

declare module '@cornerstonejs/codec-openjph/dist/openjphjs.wasm';
