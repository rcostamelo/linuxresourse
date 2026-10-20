declare const __APP_VERSION__: string

/** Versão do app, injetada em build a partir do package.json. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
