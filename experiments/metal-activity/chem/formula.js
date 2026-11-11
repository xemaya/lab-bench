// Formulas and balanced equations, derived from ion charges. Everything is built as plain text ("Na2SO4"); `pretty`
// turns it into what a textbook prints ("Na₂SO₄"). The tests re-count the atoms of every equation independently.

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const SUB = '₀₁₂₃₄₅₆₇₈₉';

// digits that follow a letter or a closing bracket are subscripts; leading coefficients stay as they are
export const pretty = (plain) => plain.replace(/(?<=[A-Za-z)])\d+/g, (d) => [...d].map((c) => SUB[+c]).join(''));

const group = (symbol, count, poly) => (count === 1 ? symbol : poly ? `(${symbol})${count}` : `${symbol}${count}`);
const term = (coef, formula) => (coef === 1 ? '' : coef) + formula;

// cation of charge m with an anion of charge n: the smallest neutral combination
export function salt(metal, anion) {
  const g = gcd(metal.charge, anion.charge);
  const metals = anion.charge / g,
    anions = metal.charge / g;
  return { formula: group(metal.symbol, metals, false) + group(anion.symbol, anions, anion.poly), metals, anions };
}
export const acid = (anion) => group('H', anion.charge, false) + anion.symbol;
export const hydroxide = (metal) => (metal.charge === 1 ? `${metal.symbol}OH` : `${metal.symbol}(OH)${metal.charge}`);

// metal + acid -> salt + hydrogen
export function acidEquation(metal, anion) {
  const s = salt(metal, anion);
  const z = (s.anions * anion.charge) % 2 === 0 ? 1 : 2; // hydrogen atoms must pair up into H2
  return `${term(z * s.metals, metal.symbol)} + ${term(z * s.anions, acid(anion))} = ${term(z, s.formula)} + ${term((z * s.anions * anion.charge) / 2, 'H2')}↑`;
}

// metal + salt of another metal -> its own salt + the other metal
export function displacementEquation(metal, other, anion) {
  const from = salt(other, anion),
    to = salt(metal, anion);
  const g = gcd(to.anions, from.anions);
  const y = to.anions / g, // units of the salt consumed
    z = from.anions / g; // units of the salt formed
  if (z * to.metals * metal.charge !== y * from.metals * other.charge) throw new Error(`cannot balance ${metal.symbol} + ${from.formula}`);
  return `${term(z * to.metals, metal.symbol)} + ${term(y, from.formula)} = ${term(z, to.formula)} + ${term(y * from.metals, other.symbol)}`;
}

// a very active metal + water -> its hydroxide + hydrogen
export function waterEquation(metal) {
  const k = metal.charge % 2 === 0 ? 1 : 2;
  return `${term(k, metal.symbol)} + ${term(k * metal.charge, 'H2O')} = ${term(k, hydroxide(metal))} + ${term((k * metal.charge) / 2, 'H2')}↑`;
}

// that hydroxide + the dissolved salt -> the other metal's hydroxide (a precipitate) + a salt
export function precipitationEquation(metal, other, anion) {
  const from = salt(other, anion),
    to = salt(metal, anion);
  const q = to.anions / gcd(to.anions, from.anions);
  const s = (q * from.anions) / to.anions,
    r = q * from.metals,
    p = s * to.metals;
  if (p * metal.charge !== r * other.charge) throw new Error(`cannot balance ${hydroxide(metal)} + ${from.formula}`);
  return `${term(p, hydroxide(metal))} + ${term(q, from.formula)} = ${term(r, hydroxide(other))}↓ + ${term(s, to.formula)}`;
}
