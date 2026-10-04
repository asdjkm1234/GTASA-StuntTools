import { buildMain } from './main-bundle';

buildMain()
  .then(() => console.log('cutscene-converter: bundled dist/main/main.cjs'))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
