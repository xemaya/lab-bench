// npm test   (node --test "experiments/**/*.test.js")
// The expected results below were written by hand from the chemistry, not copied from the engine's output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, judgeAll } from './judge.js';
import { DATA } from './data.js';
import { pretty } from './formula.js';

// [metal, reagent, kind, equations, colour the solution ends up (null = unchanged), phenomena types in order]
const EXPECTED = [
  ['Cu', 'HCl', 'no-reaction', [], null, ['none']],
  ['Cu', 'H2SO4', 'no-reaction', [], null, ['none']],
  ['Cu', 'CuSO4', 'no-reaction', [], null, ['none']],
  ['Cu', 'FeSO4', 'no-reaction', [], null, ['none']],
  ['Zn', 'HCl', 'acid-displacement', ['Zn + 2HCl = ZnCl2 + H2↑'], null, ['gas', 'dissolve']],
  ['Zn', 'H2SO4', 'acid-displacement', ['Zn + H2SO4 = ZnSO4 + H2↑'], null, ['gas', 'dissolve']],
  ['Zn', 'CuSO4', 'salt-displacement', ['Zn + CuSO4 = ZnSO4 + Cu'], 'colorless', ['deposit', 'solutionColor']],
  ['Zn', 'FeSO4', 'salt-displacement', ['Zn + FeSO4 = ZnSO4 + Fe'], 'colorless', ['deposit', 'solutionColor']],
  ['Fe', 'HCl', 'acid-displacement', ['Fe + 2HCl = FeCl2 + H2↑'], 'paleGreen', ['gas', 'dissolve', 'solutionColor']],
  ['Fe', 'H2SO4', 'acid-displacement', ['Fe + H2SO4 = FeSO4 + H2↑'], 'paleGreen', ['gas', 'dissolve', 'solutionColor']],
  ['Fe', 'CuSO4', 'salt-displacement', ['Fe + CuSO4 = FeSO4 + Cu'], 'paleGreen', ['deposit', 'solutionColor']],
  ['Fe', 'FeSO4', 'no-reaction', [], null, ['none']],
  ['Na', 'HCl', 'acid-displacement', ['2Na + 2HCl = 2NaCl + H2↑'], null, ['floatAndDart', 'gas', 'dissolve']],
  ['Na', 'H2SO4', 'acid-displacement', ['2Na + H2SO4 = Na2SO4 + H2↑'], null, ['floatAndDart', 'gas', 'dissolve']],
  ['Na', 'CuSO4', 'water-first', ['2Na + 2H2O = 2NaOH + H2↑', '2NaOH + CuSO4 = Cu(OH)2↓ + Na2SO4'], null, ['floatAndDart', 'gas', 'dissolve', 'precipitate']],
  ['Na', 'FeSO4', 'water-first', ['2Na + 2H2O = 2NaOH + H2↑', '2NaOH + FeSO4 = Fe(OH)2↓ + Na2SO4', '4Fe(OH)2 + O2 + 2H2O = 4Fe(OH)3'], null, ['floatAndDart', 'gas', 'dissolve', 'precipitate']],
];

// ---- an independent atom counter, so the equation builder is not checking itself ----
function atoms(formula) {
  const stack = [{}];
  const re = /([A-Z][a-z]?)(\d*)|(\()|\)(\d*)/g;
  let m;
  while ((m = re.exec(formula))) {
    if (m[1]) stack.at(-1)[m[1]] = (stack.at(-1)[m[1]] || 0) + (m[2] ? +m[2] : 1);
    else if (m[3]) stack.push({});
    else {
      const inner = stack.pop(),
        k = m[4] ? +m[4] : 1;
      for (const el in inner) stack.at(-1)[el] = (stack.at(-1)[el] || 0) + inner[el] * k;
    }
  }
  return stack[0];
}
function side(text) {
  const total = {};
  for (const raw of text.split(' + ')) {
    const [, coef, formula] = raw.replace(/[↑↓]/g, '').trim().match(/^(\d*)(.+)$/);
    const a = atoms(formula);
    for (const el in a) total[el] = (total[el] || 0) + a[el] * (coef ? +coef : 1);
  }
  return total;
}
const balanced = (plain) => {
  const [l, r] = plain.split(' = ');
  return [side(l), side(r)];
};

test('the atom counter itself', () => {
  assert.deepEqual(atoms('Fe2(SO4)3'), { Fe: 2, S: 3, O: 12 });
  assert.deepEqual(side('2NaOH + CuSO4'), { Na: 2, O: 6, H: 2, Cu: 1, S: 1 });
  const [l, r] = balanced('Fe + 2HCl = FeCl3 + H2↑');
  assert.notDeepEqual(l, r);
});

test('every metal x reagent on the bench has exactly one expected row', () => {
  const all = judgeAll();
  assert.equal(all.length, Object.keys(DATA.metals).length * Object.keys(DATA.reagents).length);
  assert.equal(EXPECTED.length, all.length);
  assert.equal(new Set(EXPECTED.map((e) => e[0] + '+' + e[1])).size, all.length);
  for (const o of all) assert.ok(EXPECTED.some((e) => e[0] === o.metal && e[1] === o.reagent), `${o.metal} + ${o.reagent} has no expected row`);
});

for (const [metal, reagent, kind, equations, endColor, phenomena] of EXPECTED) {
  test(`${metal} + ${reagent}: ${kind}`, () => {
    const o = judge(metal, reagent);
    assert.equal(o.kind, kind);
    assert.equal(o.reacts, kind !== 'no-reaction');
    assert.deepEqual(o.equations.map((e) => e.plain), equations);
    assert.deepEqual(o.phenomena.map((p) => p.type), phenomena);
    const colour = o.phenomena.find((p) => p.type === 'solutionColor');
    assert.equal(colour ? colour.to : null, endColor);
    for (const e of o.equations) {
      const [l, r] = balanced(e.plain);
      assert.deepEqual(l, r, `not balanced: ${e.plain}`);
      assert.equal(e.text, pretty(e.plain));
      assert.ok(e.label);
    }
    // the walk is complete and ends where it should
    assert.ok(o.steps.length >= 2 && o.conclusion && o.observations.length);
    const decided = o.steps.findIndex((s) => s.status === 'fail');
    if (decided >= 0) for (const s of o.steps.slice(decided + 1)) assert.equal(s.status, 'skipped');
    else assert.ok(o.steps.every((s) => s.status === 'pass'));
    for (const s of o.steps) assert.ok(s.status === 'skipped' || s.text, `step ${s.id} has no explanation`);
    if (kind === 'no-reaction') assert.deepEqual(o.observations, ['无明显现象']);
  });
}

// ---- the teacher's own worked examples, step by step ----
const statuses = (o) => o.steps.map((s) => `${s.id}:${s.status}`);

test('例一：铜放入稀盐酸，不反应', () => {
  const o = judge('Cu', 'HCl');
  assert.deepEqual(statuses(o), ['acid-type:pass', 'position-vs-hydrogen:fail']);
  assert.deepEqual(o.compare, { left: 'Cu', right: 'H', relation: 'after' });
  assert.equal(o.steps[1].text, '铜排在氢的后面');
});

test('例一：锌放入稀硫酸，产生氢气', () => {
  const o = judge('Zn', 'H2SO4');
  assert.deepEqual(statuses(o), ['acid-type:pass', 'position-vs-hydrogen:pass']);
  assert.equal(o.equations[0].text, 'Zn + H₂SO₄ = ZnSO₄ + H₂↑');
  assert.equal(o.phenomena[0].gas, 'H2');
});

test('例二：铁放入硫酸铜溶液，析出红色的铜，溶液由蓝变浅绿', () => {
  const o = judge('Fe', 'CuSO4');
  assert.deepEqual(statuses(o), ['special-metal:pass', 'salt-soluble:pass', 'position-vs-metal:pass']);
  assert.equal(o.displaces, true);
  assert.deepEqual(o.phenomena, [
    { type: 'deposit', on: 'metal', substance: 'Cu', color: 'red' },
    { type: 'solutionColor', from: 'blue', to: 'paleGreen' },
  ]);
  assert.deepEqual(o.observations, ['铁表面析出红色固体', '溶液由蓝色逐渐变为浅绿色']);
});

test('例二：铜放入硫酸亚铁溶液，无明显现象', () => {
  const o = judge('Cu', 'FeSO4');
  assert.deepEqual(statuses(o), ['special-metal:pass', 'salt-soluble:pass', 'position-vs-metal:fail']);
  assert.deepEqual(o.compare, { left: 'Cu', right: 'Fe', relation: 'after' });
  assert.equal(o.displaces, false);
});

test('例三：钠放入硫酸铜溶液，先与水反应，得到蓝色沉淀而不是铜', () => {
  const o = judge('Na', 'CuSO4');
  assert.deepEqual(statuses(o), ['special-metal:fail', 'salt-soluble:skipped', 'position-vs-metal:skipped']);
  assert.equal(o.reacts, true);
  assert.equal(o.displaces, false);
  assert.deepEqual(o.phenomena.at(-1), { type: 'precipitate', substance: 'Cu(OH)2', color: 'blue' });
  assert.ok(!o.phenomena.some((p) => p.type === 'deposit'), 'no copper may appear');
  assert.equal(o.observations.at(-1), '没有铜析出');
  assert.ok(o.pitfall && o.caution);
});

test('铁生成的是亚铁盐：产物里只有 Fe²⁺', () => {
  for (const r of ['HCl', 'H2SO4', 'CuSO4']) {
    const o = judge('Fe', r);
    assert.ok(/FeCl2|FeSO4/.test(o.equations[0].plain) && !/FeCl3|Fe2\(SO4\)3/.test(o.equations[0].plain));
    assert.ok(o.pitfall);
  }
});

test('同一种金属不置换自己', () => {
  for (const [m, r] of [['Cu', 'CuSO4'], ['Fe', 'FeSO4']]) assert.equal(judge(m, r).compare.relation, 'same');
});

test('钠与酸：氢前金属，能反应，但标注危险', () => {
  for (const r of ['HCl', 'H2SO4']) {
    const o = judge('Na', r);
    assert.equal(o.kind, 'acid-displacement');
    assert.ok(o.caution);
    assert.equal(o.phenomena.find((p) => p.type === 'gas').vigor, 'violent');
  }
});

// ---- branches no reagent on the bench reaches yet (second batch): checked with made-up bottles ----
const withReagent = (id, reagent) => ({ ...DATA, reagents: { ...DATA.reagents, [id]: reagent } });

test('氧化性酸：规则不适用，不下结论', () => {
  const data = withReagent('HNO3c', { kind: 'acid', name: '浓硝酸', anion: 'Cl', oxidizing: true });
  const o = judge('Cu', 'HNO3c', data);
  assert.equal(o.kind, 'out-of-scope');
  assert.equal(o.reacts, null);
  assert.deepEqual(statuses(o), ['acid-type:fail', 'position-vs-hydrogen:skipped']);
  assert.deepEqual(o.equations, []);
});

test('不溶的盐：不能在溶液中置换', () => {
  const data = withReagent('AgCl', { kind: 'salt', name: '氯化银', solute: '氯化银', metal: 'Ag', anion: 'Cl', soluble: false });
  const o = judge('Fe', 'AgCl', data);
  assert.equal(o.reacts, false);
  assert.deepEqual(statuses(o), ['special-metal:pass', 'salt-soluble:fail', 'position-vs-metal:skipped']);
});

test('不认识的物质直接报错', () => {
  assert.throws(() => judge('Au', 'HCl'), /unknown metal/);
  assert.throws(() => judge('Zn', 'NaCl'), /unknown reagent/);
});

test('活动性顺序表', () => {
  assert.equal(DATA.series.join(' '), 'K Ca Na Mg Al Zn Fe Sn Pb H Cu Hg Ag Pt Au');
  for (const m of Object.keys(DATA.metals)) assert.ok(DATA.series.includes(m));
});
