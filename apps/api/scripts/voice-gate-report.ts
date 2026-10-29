// Usage: npx tsx scripts/voice-gate-report.ts <exported-log-file>
// Prints voice catch, fallback and banned-phrase rates per surface, and the
// morning on-time delivery gate per athlete (doc 10).
import { readFileSync } from 'node:fs';
import { deliveryGateReport, voiceGateReport } from '../src/gate-report';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/voice-gate-report.ts <exported-log-file>');
  process.exit(2);
}
const text = readFileSync(file, 'utf8');
const report = voiceGateReport(text);
const delivery = deliveryGateReport(text);
console.log([...report.lines, '', ...delivery.lines].join('\n'));
// 0 pass, 1 a bar failed, 3 no telemetry lines found (not a pass).
const voiceFail = report.total.emissions > 0 && report.bannedRate >= 0.005;
const noData = report.total.emissions === 0 && delivery.pass === null;
process.exit(noData ? 3 : voiceFail || delivery.pass === false ? 1 : 0);
