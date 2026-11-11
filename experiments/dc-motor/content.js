// What the lesson says: nine chapters, six guided experiments, eight quiz questions. Pure data; main.js applies it.
//
// A chapter sets up the bench for one idea:
//   view    where the camera goes: yaw, pitch, zoom (1 = the whole bench) and what it looks at
//           ('bench' | 'motor' | 'coil' | 'commutator')
//   layers  which teaching overlays are on (current, field, force, rotation, hand, labels)
//   labels  which parts are named
//   set     bench state the chapter needs: closed (switch), exploded, speed (1 = real time)

const ALL = ['magnetN', 'magnetS', 'coil', 'commutator', 'brush', 'shaft', 'battery', 'switch', 'rheostat'];
const layers = (on) => ({ labels: true, current: false, field: false, force: false, rotation: false, hand: false, ...Object.fromEntries(on.map((k) => [k, true])) });

export const CHAPTERS = [
  {
    title: '认识电动机',
    goal: '知道电动机做什么，认出它的主要部件。',
    text: '电动机把电能转化为机械能。这台教学用的直流电动机把结构都露在外面：两块磁体提供磁场，中间是能转动的线圈，线圈一端装着换向器，两片电刷压在换向器上。',
    formula: '电能 → 机械能',
    note: '拖动空白处转动视角，滚轮拉近。点一下开关可以断电和通电。',
    view: { yaw: 0.3, pitch: 0.5, zoom: 1, at: 'bench' },
    layers: layers(['rotation']),
    labels: ALL,
    set: { closed: true, exploded: false, speed: 1 },
  },
  {
    title: '接线和启动',
    goal: '看懂电源、开关、变阻器和电动机是怎样连成一个回路的。',
    text: '合上开关，电流从电源正极出发，经过开关、左边的电刷和换向器流进线圈，再从另一片电刷流出，经过滑动变阻器回到电源负极。回路必须闭合，线圈里才有电流。',
    formula: '正极 → 开关 → 电刷 → 线圈 → 电刷 → 变阻器 → 负极',
    note: '橙色的小点表示电流方向（从正极流向负极）。断开开关，小点消失，线圈靠惯性转一会儿才停。',
    view: { yaw: 0.12, pitch: 0.82, zoom: 1, at: 'bench' },
    layers: layers(['current']),
    labels: ['battery', 'switch', 'rheostat', 'brush'],
    set: { closed: true, exploded: false, speed: 1 },
  },
  {
    title: '拆开看结构',
    goal: '看清每个部件，分清哪些会转、哪些不动。',
    text: '把磁体、线圈和电刷拉开。线圈、转轴和换向器装在一起，是转动的部分，叫转子；磁体和电刷固定在底座上不动。换向器是两个彼此绝缘的铜半环，各接线圈的一个线头。',
    formula: '转子 = 线圈 + 转轴 + 换向器',
    note: '拆开时电路是断的。再点一次“拆开”把它装回去。',
    view: { yaw: 0.38, pitch: 0.5, zoom: 0.5, at: 'motor' },
    layers: layers([]),
    labels: ['magnetN', 'magnetS', 'coil', 'commutator', 'brush', 'shaft'],
    set: { closed: false, exploded: true, speed: 1 },
  },
  {
    title: '电流在线圈里怎么走',
    goal: '看清电流进出线圈的路线。',
    text: '电流从正极一侧的电刷进入它压着的那个半环，沿线圈的一条长边流向后端，绕过后端，再沿另一条长边流回前端，从另一个半环和电刷流出。所以线圈两条长边里的电流方向总是相反的。',
    formula: '电刷 → 半环 → 一条边 → 另一条边 → 半环 → 电刷',
    note: '两条长边各缠了一圈色带：红色的是 A 边，白色的是 B 边。盯住一条边，看它里面的电流方向。',
    view: { yaw: 0.42, pitch: 0.55, zoom: 0.42, at: 'motor' },
    layers: layers(['current']),
    labels: ['coil', 'commutator', 'brush'],
    set: { closed: true, exploded: false, speed: 0.35 },
  },
  {
    title: '磁场和磁感线',
    goal: '知道磁体之间的磁场方向。',
    text: '磁体周围存在磁场。我们用磁感线表示磁场的方向和强弱：在磁体外部，磁感线从 N 极出发指向 S 极。两块磁体面对面放着，中间的磁场近似是均匀的，方向从 N 极一侧指向 S 极一侧。',
    formula: 'B：N 极 → S 极',
    note: '磁感线是为了描述磁场画出来的线，并不真实存在。把“磁场”调小，磁体会拉开，磁感线变疏。',
    view: { yaw: 0.2, pitch: 0.62, zoom: 0.45, at: 'motor' },
    layers: layers(['field']),
    labels: ['magnetN', 'magnetS'],
    set: { closed: false, exploded: false, speed: 1 },
  },
  {
    title: '通电线圈受到什么力',
    goal: '理解通电导线在磁场中受力，两条边的力让线圈转起来。',
    text: '通电导线在磁场中会受到力的作用。线圈两条长边里的电流方向相反，所以受到的力一个向上、一个向下。这两个力不在一条直线上，线圈就绕着转轴转起来。',
    formula: '受力方向与电流方向、磁场方向都有关',
    note: '绿色箭头是导线受到的力。注意它始终竖直：线圈转到哪里，力的方向都不变，变的是力臂。',
    view: { yaw: 0.34, pitch: 0.42, zoom: 0.4, at: 'coil' },
    layers: layers(['current', 'field', 'force', 'rotation']),
    labels: ['coil'],
    set: { closed: true, exploded: false, speed: 0.3 },
  },
  {
    title: '左手定则',
    goal: '会用左手定则判断通电导线的受力方向。',
    text: '伸开左手，让拇指与四指垂直，并且都在手掌平面内。让磁感线垂直穿进手心，四指指向电流方向，拇指所指的就是导线受力的方向。',
    formula: '磁感线穿手心 · 四指指电流 · 拇指指受力',
    note: '右边那条长边上画出了三个方向：蓝色 B、橙色 I、绿色 F。伸出左手对着屏幕比一比。对调电源或磁极后再比一次。',
    view: { yaw: 0.42, pitch: 0.4, zoom: 0.34, at: 'coil' },
    layers: layers(['field', 'force', 'hand']),
    labels: [],
    set: { closed: true, exploded: false, speed: 0.12 },
  },
  {
    title: '换向器为什么重要',
    goal: '理解换向器怎样让线圈一直朝一个方向转。',
    text: '线圈转过平衡位置（线圈平面与磁感线垂直）时，两个半环交换了各自接触的电刷，线圈里的电流方向随之反过来。与此同时两条长边也交换了左右位置，所以右边的那条边始终受到同一方向的力，线圈就能持续转下去。',
    formula: '转过平衡位置 → 电流反向 → 转矩方向不变',
    note: '这一章放慢了速度。盯住红色色带的 A 边：它在右边和在左边时，电流方向是相反的。',
    view: { yaw: 0.3, pitch: 0.36, zoom: 0.2, at: 'commutator' },
    layers: layers(['current', 'force', 'rotation']),
    labels: ['commutator', 'brush'],
    set: { closed: true, exploded: false, speed: 0.12 },
  },
  {
    title: '完整的工作过程',
    goal: '把电流、磁场、受力、换向串成一条线。',
    text: '合上开关，线圈中有了电流；磁体提供磁场；线圈两条长边受到方向相反的力而转动；每转过半圈，换向器让线圈中的电流反向一次，转动方向保持不变。想改变转动方向，对调电源两极或者对调磁极；想改变转速，改变电流大小或磁场强弱。',
    formula: '通电线圈在磁场中受力而转动',
    note: '试试右边的参数：对调电源、对调磁极、改变电流、磁场和匝数，再做“探究实验”。',
    view: { yaw: 0.3, pitch: 0.5, zoom: 0.8, at: 'bench' },
    layers: layers(['current', 'field', 'force', 'rotation']),
    labels: ALL,
    set: { closed: true, exploded: false, speed: 1 },
  },
];

// `patch` is applied to the bench parameters; `chapter` is the index it switches to; `layers` are turned on.
export const EXPERIMENTS = [
  {
    title: '断开电源',
    goal: '断电后，线圈是不是马上停下？',
    steps: '让电动机转起来，然后点一下开关把它断开，观察线圈和电流。',
    expect: '电流立刻消失，线圈不再受力，但靠惯性继续转一会儿才停下。',
    chapter: 1,
    patch: { closed: true, supply: 1, magnet: 1, current: 1, field: 1, turns: 10 },
    layers: ['current', 'force', 'rotation'],
  },
  {
    title: '对调电源两极',
    goal: '电流方向反过来，转动方向会变吗？',
    steps: '保持磁体不动，点“对调电源”（或点电动机的接线柱），比较对调前后的转动方向。',
    expect: '线圈中的电流方向反了，两条边受力方向都反了，线圈反过来转。',
    chapter: 5,
    patch: { closed: true, supply: 1, magnet: 1, current: 1, field: 1, turns: 10 },
    layers: ['current', 'field', 'force', 'rotation'],
  },
  {
    title: '对调磁极',
    goal: '磁场方向反过来，转动方向会变吗？',
    steps: '保持电源接法不变，点“对调磁极”（或点磁体），比较对调前后的转动方向。',
    expect: '磁场方向反了，两条边受力方向都反了，线圈反过来转。电源和磁极都对调，转动方向不变。',
    chapter: 5,
    patch: { closed: true, supply: 1, magnet: 1, current: 1, field: 1, turns: 10 },
    layers: ['current', 'field', 'force', 'rotation'],
  },
  {
    title: '改变电流大小',
    goal: '电流变大，转得更快还是更慢？',
    steps: '电流先调到 20%，记下转速；再慢慢调到 100%，比较转矩和转速的读数。',
    expect: '电流越大，线圈受到的力越大，转得越快。',
    chapter: 5,
    patch: { closed: true, supply: 1, magnet: 1, current: 0.2, field: 1, turns: 10 },
    layers: ['current', 'force', 'rotation'],
  },
  {
    title: '改变磁场强弱',
    goal: '磁场变强，转得更快还是更慢？',
    steps: '磁场先调到 30%（磁体拉开），记下转速；再调到 100%，比较读数。',
    expect: '磁场越强，线圈受到的力越大，转得越快。',
    chapter: 4,
    patch: { closed: true, supply: 1, magnet: 1, current: 1, field: 0.3, turns: 10 },
    layers: ['field', 'force', 'rotation'],
  },
  {
    title: '改变线圈匝数',
    goal: '线圈多绕几圈有什么用？',
    steps: '依次选择 1、2、5、10 匝，观察线圈的样子和转矩、转速的读数。1 匝时再把电流调小试试。',
    expect: '匝数越多，受力的导线越多，转矩越大。匝数太少、电流又小时，线圈转不过平衡位置，甚至转不动。',
    chapter: 5,
    patch: { closed: true, supply: 1, magnet: 1, current: 1, field: 1, turns: 1 },
    layers: ['current', 'force', 'rotation'],
  },
];

export const QUIZ = [
  { q: '电动机工作时，能量是怎样转化的？', options: ['机械能转化为电能', '电能转化为机械能', '电能转化为化学能'], a: 1, explain: '通电线圈在磁场中受力转动，把电能转化为机械能。', chapter: 0 },
  { q: '电动机里的磁场是谁提供的？', options: ['换向器', '磁体', '电刷'], a: 1, explain: '两块磁体面对面放置，中间的磁场从 N 极一侧指向 S 极一侧。', chapter: 4 },
  { q: '下面哪些部件会跟着一起转？', options: ['电刷', '线圈和换向器', '磁体'], a: 1, explain: '线圈、转轴和换向器装在一起，是转子；磁体和电刷固定不动。', chapter: 2 },
  { q: '线圈转到平衡位置时没有电流，为什么还能继续转？', options: ['靠惯性', '磁场突然变强', '电刷推了它一下'], a: 0, explain: '平衡位置时电刷压在两个半环之间的绝缘缝上，线圈不受力，靠惯性转过去。', chapter: 7 },
  { q: '线圈两条长边受到的力为什么方向相反？', options: ['两条边里的电流方向相反', '两条边处的磁场方向相反', '两条边长度不同'], a: 0, explain: '磁场方向相同，电流方向相反，所以受力方向相反，一上一下使线圈转动。', chapter: 5 },
  { q: '换向器的作用是什么？', options: ['改变电动机的转动方向', '每转半圈改变一次线圈中的电流方向，使线圈持续转动', '提高电源电压'], a: 1, explain: '线圈转过平衡位置时，换向器自动改变线圈中的电流方向，转矩方向保持不变。', chapter: 7 },
  { q: '只对调电源的正负极，线圈的转动方向会怎样？', options: ['不变', '反过来转', '立即停止'], a: 1, explain: '电流方向反了，受力方向跟着反，线圈反转。', chapter: 5 },
  { q: '同时对调电源正负极和磁体的两极，转动方向会怎样？', options: ['不变', '反过来转', '转得更快'], a: 0, explain: '电流方向和磁场方向都反了，受力方向反了两次，等于没变。', chapter: 5 },
];

export const PART_NAMES = {
  magnetN: 'N 极',
  magnetS: 'S 极',
  coil: '线圈',
  commutator: '换向器',
  brush: '电刷',
  shaft: '转轴',
  battery: '电源',
  switch: '开关',
  rheostat: '滑动变阻器',
};
