// Usage: npx tsx scripts/voice-gate-report.ts <exported-log-file>
// Prints voice catch, fallback and banned-phrase rates per surface (doc 10).
import { readFileSync } from 'node:fs';
import { voiceGateReport } from '../src/gate-report';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/voice-gate-report.ts <exported-log-file>');
  process.exit(2);
}
const report = voiceGateReport(readFileSync(file, 'utf8'));
console.log(report.lines.join('\n'));
// 0 pass, 1 over the bar, 3 no telemetry lines found (not a pass).
process.exit(report.total.emissions === 0 ? 3 : report.bannedRate >= 0.005 ? 1 : 0);
