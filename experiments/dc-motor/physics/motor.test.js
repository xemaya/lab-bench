// npm test
// Expected values are worked out by hand from F = IL x B and the geometry of a split-ring commutator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coilCurrent, onRightBrush, sideForces, torque, drive, direction, step, nudge, createRotor, settledSpeed, describe, GAP, CARRIES_THROUGH } from './motor.js';

const BASE = { closed: true, supply: 1, magnet: 1, current: 1, field: 1, turns: 10 };
const deg = (d) => (d * Math.PI) / 180;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const run = (rotor, p, seconds) => {
  let stopped = null;
  for (let i = 0; i < seconds * 60; i++) stopped = step(rotor, p, 1 / 60);
  return stopped;
};

test('左手定则：B 向右，电流朝向观察者，受力向上', () => {
  // coil flat, side A on the right. supply +1: the side on the right carries current toward the viewer (+z).
  // left hand: field (left to right) into the palm, fingers toward the viewer, thumb points up.
  const f = sideForces(BASE, 0);
  assert.equal(f.a.current, 1);
  assert.deepEqual(f.a.at, [1, 0]);
  near(f.a.force[0], 0);
  near(f.a.force[1], 1); // up
  assert.equal(f.b.current, -1);
  near(f.b.force[1], -1); // the other side is pushed down: a couple
  assert.ok(f.torque > 0, 'right side up, left side down: anticlockwise seen from the front');
});

test('力始终竖直：与线圈转到哪里无关，变的只是力臂', () => {
  for (const d of [0, 30, 60, 80]) {
    const f = sideForces(BASE, deg(d));
    near(f.a.force[0], 0);
    near(f.a.force[1], 1);
    near(torque(BASE, deg(d)), Math.cos(deg(d)));
  }
});

test('换向器：每转半圈线圈电流反向，转矩方向不变', () => {
  assert.equal(onRightBrush(deg(10)), 'A');
  assert.equal(onRightBrush(deg(170)), 'B');
  assert.equal(coilCurrent(BASE, deg(10)), 1);
  assert.equal(coilCurrent(BASE, deg(170)), -1); // the same wire now carries current the other way
  for (let d = 0; d < 360; d += 5) {
    const t = torque(BASE, deg(d));
    assert.ok(t >= 0, `torque went negative at ${d} degrees`);
    near(t, Math.abs(Math.cos(deg(d))) < Math.sin(GAP) ? 0 : Math.abs(Math.cos(deg(d))));
  }
});

test('没有换向器会怎样：电流不反向，转矩每半圈反一次', () => {
  // the same coil with the current held in one direction: what the commutator is there to prevent
  const fixed = (d) => Math.cos(deg(d)) * 1; // torque = lever arm x force, force fixed
  assert.ok(fixed(10) > 0 && fixed(170) < 0);
  assert.ok(torque(BASE, deg(170)) > 0);
});

test('平衡位置：电刷压在绝缘缝上，线圈中没有电流，也没有转矩', () => {
  for (const d of [90, 270, 92, 88]) {
    assert.equal(onRightBrush(deg(d)), null);
    assert.equal(coilCurrent(BASE, deg(d)), 0);
    near(torque(BASE, deg(d)), 0);
  }
});

test('转向：对调电源或对调磁极都会反转，两个都对调则不变', () => {
  assert.equal(direction(BASE), 1);
  assert.equal(direction({ ...BASE, supply: -1 }), -1);
  assert.equal(direction({ ...BASE, magnet: -1 }), -1);
  assert.equal(direction({ ...BASE, supply: -1, magnet: -1 }), 1);
  assert.equal(direction({ ...BASE, closed: false }), 0);
  for (const [supply, magnet] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const p = { ...BASE, supply, magnet };
    for (const d of [0, 45, 135, 200, 300]) assert.equal(Math.sign(torque(p, deg(d))), supply * magnet);
  }
});

test('对调磁极时电流不变，变的是力的方向', () => {
  const f = sideForces({ ...BASE, magnet: -1 }, 0);
  assert.equal(f.a.current, 1);
  near(f.a.force[1], -1);
});

test('转矩与电流、磁场、匝数成正比', () => {
  near(drive(BASE), 1);
  near(drive({ ...BASE, current: 0.2 }), 0.2);
  near(drive({ ...BASE, field: 0.3 }), 0.3);
  near(drive({ ...BASE, turns: 1 }), 0.1);
  near(torque({ ...BASE, current: 0.5, field: 0.5, turns: 5 }, 0), 0.125);
  near(settledSpeed({ ...BASE, current: 0.5 }) / settledSpeed(BASE), 0.5);
  assert.equal(drive({ ...BASE, closed: false }), 0);
});

test('通电后转起来，并稳定在与驱动成正比的转速', () => {
  const fast = createRotor(),
    slow = createRotor();
  assert.equal(run(fast, BASE, 20), null);
  assert.equal(run(slow, { ...BASE, current: 0.5 }, 20), null);
  // mean speed over the last ten seconds, in revolutions per second
  const mean = (rotor, p) => {
    const a0 = rotor.angle;
    run(rotor, p, 10);
    return (rotor.angle - a0) / (2 * Math.PI) / 10;
  };
  const vf = mean(fast, BASE),
    vs = mean(slow, { ...BASE, current: 0.5 });
  near(vf, settledSpeed(BASE), 0.06);
  near(vs / vf, 0.5, 0.03);
});

test('反接后先减速再反转', () => {
  const r = createRotor();
  run(r, BASE, 10);
  assert.ok(r.omega > 0);
  const p = { ...BASE, supply: -1 };
  step(r, p, 1 / 60);
  assert.match(describe(p, r, null).text, /减速并反转/);
  run(r, p, 15);
  assert.ok(r.omega < 0);
  assert.match(describe(p, r, null).text, /顺时针/);
});

test('断电后靠惯性继续转，然后停下', () => {
  const r = createRotor();
  run(r, BASE, 10);
  const off = { ...BASE, closed: false };
  assert.equal(step(r, off, 1 / 60), null);
  assert.match(describe(off, r, null).text, /惯性/);
  assert.equal(run(r, off, 20), 'open');
  assert.equal(r.omega, 0);
});

test('停在平衡位置不能自己启动，拨一下就能转', () => {
  const r = createRotor(deg(90));
  assert.equal(run(r, BASE, 3), 'dead-point');
  assert.equal(r.angle, deg(90));
  assert.match(describe(BASE, r, 'dead-point').text, /拨一下/);
  nudge(r);
  assert.equal(run(r, BASE, 10), null);
  assert.ok(r.angle > deg(90) + 4 * Math.PI, 'it should keep turning');
});

test('驱动太弱：转不过平衡位置，或者根本转不动', () => {
  const strongEnough = { ...BASE, current: CARRIES_THROUGH },
    marginal = { ...BASE, current: CARRIES_THROUGH * 0.8 },
    hopeless = { ...BASE, turns: 1, current: 0.1 };
  const a = createRotor(),
    b = createRotor(),
    c = createRotor();
  assert.equal(run(a, strongEnough, 60), null);
  assert.ok(a.angle > 2 * Math.PI);
  assert.equal(run(b, marginal, 60), 'dead-point');
  assert.ok(b.angle < deg(96), 'stalled at the first dead point');
  assert.match(describe(marginal, b, 'dead-point').text, /转不过平衡位置/);
  assert.equal(run(c, hopeless, 5), 'too-weak');
  assert.equal(c.angle, createRotor().angle);
});

test('原页面的六个探究实验，结论都能从模型里得到', () => {
  assert.equal(direction({ ...BASE, closed: false }), 0); // 1 断开电源
  assert.equal(direction({ ...BASE, supply: -1 }), -direction(BASE)); // 2 交换正负极
  assert.equal(direction({ ...BASE, magnet: -1 }), -direction(BASE)); // 3 交换磁极
  assert.ok(settledSpeed({ ...BASE, current: 1 }) > settledSpeed({ ...BASE, current: 0.2 })); // 4 增大电流
  assert.ok(settledSpeed({ ...BASE, field: 1 }) > settledSpeed({ ...BASE, field: 0.3 })); // 5 增强磁场
  const byTurns = [1, 2, 5, 10].map((turns) => settledSpeed({ ...BASE, turns })); // 6 增加匝数
  assert.deepEqual([...byTurns].sort((x, y) => x - y), byTurns);
});
