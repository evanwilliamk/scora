// Usage: npx tsx scripts/log-audit.ts <exported-log-file>
// Doc 10 gate 1.1.6: flags log lines carrying health values or secrets, by
// line number and category only (the matched text is never printed).
import { readFileSync } from 'node:fs';
import { auditReport } from '../src/log-audit';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/log-audit.ts <exported-log-file>');
  process.exit(2);
}
const report = auditReport(readFileSync(file, 'utf8'));
console.log(report.lines.join('\n'));
process.exit(report.findings.length === 0 ? 0 : 1);
