// The judgement a teacher walks through at the board: check the preconditions, find the positions in the activity
// series, then conclude. `judge(metal, reagent)` returns that walk as data: the steps with pass / fail, the
// equations, what you would observe, and structured phenomena for the 3D bench to act out.
//
//   metal + dilute acid      1 the acid must be non-oxidizing   2 the metal must stand before hydrogen
//   metal + salt solution    1 the metal must not be K / Ca / Na   2 the salt must be soluble
//                            3 the metal must stand before the metal in the salt
//   K / Ca / Na + salt solution: reacts with the water instead; the hydroxide formed may then precipitate the
//                            salt's metal as its hydroxide. The metal itself is never displaced.
//
// No rendering, no DOM: this file and data.js / formula.js run under plain node (see judge.test.js).
import { DATA } from './data.js';
import { pretty, acidEquation, displacementEquation, waterEquation, precipitationEquation, hydroxide } from './formula.js';

const PASS = 'pass',
  FAIL = 'fail',
  SKIPPED = 'skipped';
const NOTHING = [{ type: 'none' }];
const NO_CHANGE = ['无明显现象'];
const eq = (label, plain) => ({ label, plain, text: pretty(plain) });
const step = (id, title, status, text = '') => ({ id, title, status, text });

// 'before' | 'after' | 'same': where a stands relative to b in the series
function relation(series, a, b) {
  const i = series.indexOf(a),
    j = series.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`not in the activity series: ${i < 0 ? a : b}`);
  return i < j ? 'before' : i > j ? 'after' : 'same';
}
const WORD = { before: '前面', after: '后面' };
const FLOATS = '浮在液面上，熔成闪亮的小球，四处游动并发出嘶嘶声';

export function judge(metalId, reagentId, data = DATA) {
  const metal = data.metals[metalId],
    reagent = data.reagents[reagentId];
  if (!metal) throw new Error(`unknown metal: ${metalId}`);
  if (!reagent) throw new Error(`unknown reagent: ${reagentId}`);
  const out = reagent.kind === 'acid' ? withAcid(metal, reagent, data) : withSalt(metal, reagent, data);
  return { metal: metalId, reagent: reagentId, caution: null, pitfall: null, ...out };
}

function withAcid(metal, acid, data) {
  const base = { family: 'metal-acid', displaces: null };
  const titles = ['核对酸的类型', '找金属在顺序表中的位置'];
  if (acid.oxidizing) {
    return {
      ...base,
      kind: 'out-of-scope',
      reacts: null,
      compare: null,
      steps: [step('acid-type', titles[0], FAIL, `${acid.name}是氧化性酸，不在这条规则的适用范围内`), step('position-vs-hydrogen', titles[1], SKIPPED)],
      equations: [],
      phenomena: [],
      observations: [],
      conclusion: `${acid.name}是氧化性酸，不能用“氢前金属置换氢”来判断`,
    };
  }
  const rel = relation(data.series, metal.symbol, 'H');
  const steps = [step('acid-type', titles[0], PASS, `${acid.name}是非氧化性酸，符合规则的适用范围`), step('position-vs-hydrogen', titles[1], rel === 'before' ? PASS : FAIL, `${metal.name}排在氢的${WORD[rel]}`)];
  const compare = { left: metal.symbol, right: 'H', relation: rel };
  if (rel !== 'before') {
    return { ...base, kind: 'no-reaction', reacts: false, compare, steps, equations: [], phenomena: NOTHING, observations: NO_CHANGE, conclusion: `${metal.name}排在氢的后面，不能与${acid.name}反应` };
  }
  const anion = data.anions[acid.anion];
  const violent = data.veryActive.includes(metal.symbol);
  const phenomena = [],
    observations = [];
  if (violent) {
    phenomena.push({ type: 'floatAndDart' });
    observations.push(`${metal.name}${FLOATS}，反应非常剧烈`);
  } else {
    observations.push(metal.vigor === 'slow' ? `${metal.name}表面产生少量气泡，反应缓慢` : `${metal.name}表面产生较多气泡，反应比较剧烈`);
    observations.push(`${metal.name}逐渐溶解`);
  }
  phenomena.push({ type: 'gas', gas: 'H2', from: 'metal', vigor: metal.vigor }, { type: 'dissolve', target: 'metal' });
  if (metal.ionColor !== 'colorless') {
    phenomena.push({ type: 'solutionColor', from: 'colorless', to: metal.ionColor });
    observations.push(`溶液由无色逐渐变为${data.colorNames[metal.ionColor]}`);
  }
  return {
    ...base,
    kind: 'acid-displacement',
    reacts: true,
    compare,
    steps,
    equations: [eq(violent ? `${metal.name}先与酸反应` : '置换出氢气', acidEquation(metal, anion))],
    phenomena,
    observations,
    conclusion: `${metal.name}排在氢的前面，能与${acid.name}反应生成氢气`,
    caution: violent ? `${metal.name}与酸的反应过于剧烈，可能燃烧甚至爆炸，实验室里不能这样操作` : null,
    pitfall: metal.symbol === 'Fe' ? '铁在置换反应中生成 +2 价的亚铁盐，溶液呈浅绿色，不要写成 +3 价的铁盐' : null,
  };
}

function withSalt(metal, salt, data) {
  const other = data.metals[salt.metal],
    anion = data.anions[salt.anion];
  const base = { family: 'metal-salt' };
  const titles = ['核对金属是不是钾、钙、钠', '核对盐是否可溶于水', '比较两种金属的位置'];
  const ids = ['special-metal', 'salt-soluble', 'position-vs-metal'];

  if (data.veryActive.includes(metal.symbol)) {
    const steps = [step(ids[0], titles[0], FAIL, `${metal.name}属于钾、钙、钠，放进溶液里会先与水反应`), step(ids[1], titles[1], SKIPPED), step(ids[2], titles[2], SKIPPED)];
    const equations = [eq(`${metal.name}先与水反应`, waterEquation(metal))];
    const phenomena = [{ type: 'floatAndDart' }, { type: 'gas', gas: 'H2', from: 'metal', vigor: 'violent' }, { type: 'dissolve', target: 'metal' }];
    const observations = [`${metal.name}${FLOATS}，产生气体`];
    const h = data.hydroxides[other.symbol];
    if (salt.soluble && h && !h.soluble) {
      const product = hydroxide(other);
      equations.push(eq(`生成的${pretty(hydroxide(metal))}再与${salt.solute}反应`, precipitationEquation(metal, other, anion)));
      const p = { type: 'precipitate', substance: product, color: h.color };
      let seen = `溶液中出现${h.text}`;
      if (h.ages) {
        p.ages = { via: h.ages.via, to: h.ages.to };
        seen += `，${h.ages.text}`;
        equations.push(eq(`${pretty(product)}被空气中的氧气氧化`, h.ages.equation));
      }
      phenomena.push(p);
      observations.push(seen);
    }
    observations.push(`没有${other.name}析出`);
    return {
      ...base,
      kind: 'water-first',
      reacts: true,
      displaces: false,
      compare: null,
      steps,
      equations,
      phenomena,
      observations,
      conclusion: `${metal.name}先与水反应，不能置换出${salt.solute}中的${other.name}`,
      caution: `${metal.name}与水反应剧烈，真实实验只能取绿豆大小的一块`,
      pitfall: '钾、钙、钠与盐溶液相遇，一律不能置换出盐中的金属',
    };
  }

  const steps = [step(ids[0], titles[0], PASS, `${metal.name}不属于钾、钙、钠`)];
  if (!salt.soluble) {
    steps.push(step(ids[1], titles[1], FAIL, `${salt.solute}不溶于水`), step(ids[2], titles[2], SKIPPED));
    return { ...base, kind: 'no-reaction', reacts: false, displaces: false, compare: null, steps, equations: [], phenomena: NOTHING, observations: NO_CHANGE, conclusion: `${salt.solute}不溶于水，不能在溶液中发生置换反应` };
  }
  steps.push(step(ids[1], titles[1], PASS, `${salt.solute}可溶于水`));
  const rel = relation(data.series, metal.symbol, other.symbol);
  const compare = { left: metal.symbol, right: other.symbol, relation: rel };
  if (rel !== 'before') {
    const same = rel === 'same';
    steps.push(step(ids[2], titles[2], FAIL, same ? `${metal.name}与盐中的金属是同一种` : `${metal.name}排在${other.name}的后面，活动性比${other.name}弱`));
    return {
      ...base,
      kind: 'no-reaction',
      reacts: false,
      displaces: false,
      compare,
      steps,
      equations: [],
      phenomena: NOTHING,
      observations: NO_CHANGE,
      conclusion: same ? `${metal.name}与盐中的金属相同，不发生置换反应` : `${metal.name}排在${other.name}的后面，不能置换出${other.name}`,
    };
  }
  steps.push(step(ids[2], titles[2], PASS, `${metal.name}排在${other.name}的前面，活动性比${other.name}强`));
  const deposit = other.deposit || { color: null, text: `${other.name}` };
  const phenomena = [{ type: 'deposit', on: 'metal', substance: other.symbol, color: deposit.color }];
  const observations = [`${metal.name}表面析出${deposit.text}`];
  if (metal.ionColor !== other.ionColor) {
    phenomena.push({ type: 'solutionColor', from: other.ionColor, to: metal.ionColor });
    observations.push(`溶液由${data.colorNames[other.ionColor]}逐渐变为${data.colorNames[metal.ionColor]}`);
  }
  return {
    ...base,
    kind: 'salt-displacement',
    reacts: true,
    displaces: true,
    compare,
    steps,
    equations: [eq(`置换出${other.name}`, displacementEquation(metal, other, anion))],
    phenomena,
    observations,
    conclusion: `${metal.name}排在${other.name}的前面，能把${other.name}从${salt.name}中置换出来`,
    pitfall: metal.symbol === 'Fe' ? '铁在置换反应中生成 +2 价的亚铁盐，溶液呈浅绿色，不要写成 +3 价的铁盐' : null,
  };
}

// every combination on the bench, for tables and tests
export function judgeAll(data = DATA) {
  const out = [];
  for (const m of Object.keys(data.metals)) for (const r of Object.keys(data.reagents)) out.push(judge(m, r, data));
  return out;
}
