// Prints every metal x reagent result as a Markdown table, for a teacher to read through and sign off.
//   node experiments/metal-activity/chem/matrix.mjs
import { judgeAll } from './judge.js';
import { DATA } from './data.js';

const MARK = { pass: '✓', fail: '✗', skipped: '–' };
const cell = (s) => String(s).replace(/\|/g, '\\|');
const rows = judgeAll().map((o) => {
  const m = DATA.metals[o.metal],
    r = DATA.reagents[o.reagent];
  const verdict = o.reacts === null ? '规则不适用' : !o.reacts ? '不反应' : o.kind === 'water-first' ? '反应，但不置换' : '反应';
  const steps = o.steps.map((s) => `${MARK[s.status]} ${s.status === 'skipped' ? s.title : s.text}`).join('<br>');
  const notes = [o.caution && `注意：${o.caution}`, o.pitfall && `易错：${o.pitfall}`].filter(Boolean).join('<br>');
  return [`${m.name} + ${r.name}`, verdict, steps, o.equations.map((e) => e.text).join('<br>') || '—', o.observations.join('<br>'), notes || '—'];
});
console.log('| 组合 | 结论 | 判断步骤 | 方程式 | 现象 | 备注 |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) console.log('| ' + r.map(cell).join(' | ') + ' |');
