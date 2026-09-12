/**
 * `eslint.config.js` is plain JavaScript, and `architecture.test.ts` reads its zones to check
 * that the layering names every directory that exists. Declared as an opaque list rather than
 * typed properly: the test asserts the shape it needs and nothing else should read this file.
 */
declare module "*/eslint.config.js" {
  const config: { rules?: Record<string, unknown> }[];
  export default config;
}
