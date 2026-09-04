// Dedicated Jest project for scripts/** (data-import tooling), kept separate
// from the main `src/` suite (see package.json's "jest" block) so that
// widening one never risks the other. Same transform/resolution shape as
// test/jest-e2e.json, just pointed at `scripts` instead of `test`.
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/scripts'],
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: ['node_modules/(?!(@nestjs)/)'],
};
