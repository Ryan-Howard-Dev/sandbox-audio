import { runMixtapeIdentifyFixtures } from '../src/catalogIdentifyMixtape.fixture';

const { passed, failed } = runMixtapeIdentifyFixtures();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
