// Usage: npx tsx scripts/voice-gate-report.ts <exported-log-file>
// Prints voice catch, fallback and banned-phrase rates per surface, and the
// morning delivery, open and numeric-first gates per athlete (doc 10).
import { readFileSync } from 'node:fs';
import { deliveryGateReport, gateExitCode, morningGateReport, planAwareGateReport, voiceGateReport } from '../src/gate-report';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/voice-gate-report.ts <exported-log-file>');
  process.exit(2);
}
const text = readFileSync(file, 'utf8');
const report = voiceGateReport(text);
const delivery = deliveryGateReport(text);
const morning = morningGateReport(text);
const planAware = planAwareGateReport(text);
console.log([...report.lines, '', ...delivery.lines, '', ...morning.lines, '', ...planAware.lines].join('\n'));
// 0 pass, 1 a bar failed, 3 not enough telemetry to judge (not a pass).
process.exit(gateExitCode(report, delivery, morning, planAware));
