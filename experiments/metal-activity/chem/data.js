// Substances for the metal-activity experiments. Pure data: the rules in judge.js read it, nothing here decides.
// Adding a metal or a reagent is a data change; every new combination must also get a row in judge.test.js.

// 金属活动性顺序. 'H' is the dividing line for reactions with acids.
export const ACTIVITY_SERIES = ['K', 'Ca', 'Na', 'Mg', 'Al', 'Zn', 'Fe', 'Sn', 'Pb', 'H', 'Cu', 'Hg', 'Ag', 'Pt', 'Au'];

// 钾、钙、钠: so active that in any aqueous solution they react with the water first.
export const VERY_ACTIVE = ['K', 'Ca', 'Na'];

export const COLOR_NAMES = {
  colorless: '无色',
  blue: '蓝色',
  paleGreen: '浅绿色',
  red: '红色',
  darkGrey: '灰黑色',
  white: '白色',
  greyGreen: '灰绿色',
  redBrown: '红褐色',
};

// charge   : the ion formed in these displacement reactions (iron gives Fe²⁺, never Fe³⁺)
// ionColor : colour its ion gives a solution
// vigor    : how fast it reacts with a dilute acid (only meaningful for metals before hydrogen)
// deposit  : what it looks like when another metal displaces it out of solution
export const METALS = {
  Cu: { symbol: 'Cu', name: '铜', charge: 2, ionColor: 'blue', deposit: { color: 'red', text: '红色固体' } },
  Zn: { symbol: 'Zn', name: '锌', charge: 2, ionColor: 'colorless', vigor: 'steady' },
  Fe: { symbol: 'Fe', name: '铁', charge: 2, ionColor: 'paleGreen', vigor: 'slow', deposit: { color: 'darkGrey', text: '灰黑色固体' } },
  Na: { symbol: 'Na', name: '钠', charge: 1, ionColor: 'colorless', vigor: 'violent' },
};

// poly: a group of atoms, bracketed when it appears more than once in a formula
export const ANIONS = {
  Cl: { symbol: 'Cl', charge: 1, poly: false },
  SO4: { symbol: 'SO4', charge: 2, poly: true },
};

// What the hydroxide of a metal does in water. Only the metals that occur as salts on the bench need an entry.
export const HYDROXIDES = {
  Cu: { soluble: false, color: 'blue', text: '蓝色絮状沉淀' },
  Fe: {
    soluble: false,
    color: 'white',
    text: '白色絮状沉淀',
    // Fe(OH)₂ is oxidised by the air within seconds
    ages: { via: 'greyGreen', to: 'redBrown', text: '迅速变成灰绿色，最后变成红褐色', equation: '4Fe(OH)2 + O2 + 2H2O = 4Fe(OH)3' },
  },
};

// kind 'acid': oxidizing = false means 非氧化性酸, the only acids the activity-series rule covers.
// kind 'salt': a solution of one salt; `metal` is the metal it contains, `soluble` whether the salt dissolves at all.
export const REAGENTS = {
  HCl: { kind: 'acid', name: '稀盐酸', anion: 'Cl', oxidizing: false },
  H2SO4: { kind: 'acid', name: '稀硫酸', anion: 'SO4', oxidizing: false },
  CuSO4: { kind: 'salt', name: '硫酸铜溶液', solute: '硫酸铜', metal: 'Cu', anion: 'SO4', soluble: true },
  FeSO4: { kind: 'salt', name: '硫酸亚铁溶液', solute: '硫酸亚铁', metal: 'Fe', anion: 'SO4', soluble: true },
};

export const DATA = { series: ACTIVITY_SERIES, veryActive: VERY_ACTIVE, metals: METALS, anions: ANIONS, hydroxides: HYDROXIDES, reagents: REAGENTS, colorNames: COLOR_NAMES };
