import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let total = 0;
for (const suite of ['attributes', 'buildings', 'reinforcement', 'commanders', 'growth', 'growth-runtime']) {
    const script = fileURLToPath(new URL(`./test-civ7-${suite}.mjs`, import.meta.url));
    const args = ['reinforcement', 'commanders', 'growth'].includes(suite) ? ['--experimental-vm-modules', script] : [script];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0 || result.error) {
        console.error(result.error ?? result.stderr);
        console.error(result.stdout);
        process.exit(result.status || 1);
    }
    const report = JSON.parse(result.stdout);
    if (report.failed || !report.passed) throw new Error(`${suite}: invalid test result`);
    total += report.passed;
    console.log(`${suite}: ${report.passed} passed`);
}
console.log(`Total: ${total} passed`);
