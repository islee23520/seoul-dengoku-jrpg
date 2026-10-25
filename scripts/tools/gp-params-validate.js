#!/usr/bin/env node
// Retained legacy entry point: use exactly the same fail-closed CLI.
import('./gp-params-validate.mjs').then(({ main }) => {
  process.exitCode = main();
}).catch(error => {
  console.error('GP approval validation failed: ' + error.message);
  process.exitCode = 1;
});
