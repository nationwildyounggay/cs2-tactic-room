import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_INS, COLORS, MAPS, clone, emptyState, validateState,
} from '../public/presets.js';

function changed(mutator) {
  const state = emptyState();
  mutator(state);
  return state;
}

function element(type = 'smoke', extra = {}) {
  return { id: 'element-1', type, player: 0, color: COLORS[0], x: 500, y: 500, ...extra };
}

test('every selectable map has a valid independent empty tactic', () => {
  for (const map of Object.keys(MAPS)) {
    const first = emptyState(map);
    const second = emptyState(map);
    assert.equal(validateState(first), true, map);
    assert.equal(first.players.length, 5);
    assert.equal(first.phases.length, 3);
    assert.notStrictEqual(first.players, second.players);
    assert.notEqual(first.phases[0].id, second.phases[0].id);
  }
});

test('all built-in factories produce valid five-player multi-stage tactics', () => {
  assert.equal(new Set(BUILT_INS.map(preset => preset.id)).size, BUILT_INS.length);
  for (const preset of BUILT_INS) {
    const state = preset.factory();
    assert.equal(validateState(state), true, preset.id);
    assert.equal(state.map, preset.map);
    assert.equal(state.title, preset.name);
    assert.equal(state.players.length, 5);
    assert.ok(state.phases.length > 1);
    assert.ok(state.players.every(player => player.task.trim().length));
    assert.ok(state.phases[state.phaseIndex]);
  }
});

test('built-in factory calls and clones never share editable state', () => {
  for (const preset of BUILT_INS) {
    const first = preset.factory();
    const second = preset.factory();
    const copied = clone(first);
    copied.players[0].name = 'Changed';
    copied.phases[0].elements.push(element());
    assert.notEqual(first.players[0].name, copied.players[0].name);
    assert.equal(second.players[0].name, first.players[0].name);
    assert.equal(first.phases[0].elements.length, second.phases[0].elements.length);
  }
});

test('validator safely rejects null, primitives, and incomplete state', () => {
  for (const value of [null, undefined, false, true, 1, '', 'state', [], {}]) {
    assert.equal(validateState(value), false, String(value));
  }
});

test('map selection rejects unknown, inherited, and coercible non-string keys', () => {
  for (const map of ['missing', '__proto__', 'constructor', 'toString', ['mirage'], null]) {
    assert.equal(validateState(changed(state => { state.map = map; })), false, JSON.stringify(map));
  }
});

test('round, side, and purchase strategy respect schema boundaries', () => {
  for (const round of [1, 99]) {
    assert.equal(validateState(changed(state => { state.round = round; })), true);
  }
  for (const round of [0, 100, 1.5, '1', NaN, Infinity]) {
    assert.equal(validateState(changed(state => { state.round = round; })), false, String(round));
  }
  assert.equal(validateState(changed(state => { state.side = 'CT'; })), true);
  assert.equal(validateState(changed(state => { state.side = 'spectator'; })), false);
  assert.equal(validateState(changed(state => { state.roundType = 'unknown'; })), false);
});

test('phase counts, selected phase, and element counts stay bounded', () => {
  assert.equal(validateState(changed(state => { state.phases = []; })), false);
  assert.equal(validateState(changed(state => { state.phaseIndex = -1; })), false);
  assert.equal(validateState(changed(state => { state.phaseIndex = state.phases.length; })), false);
  assert.equal(validateState(changed(state => { state.phaseIndex = 0.5; })), false);
  assert.equal(validateState(changed(state => {
    state.phases = Array.from({ length: 13 }, (_, i) => ({ id: `phase-${i}`, name: 'Phase', elements: [] }));
  })), false);
  for (const count of [500, 501]) {
    const state = changed(state => {
      state.phases[0].elements = Array.from({ length: count }, (_, i) => element('smoke', { id: `item-${i}` }));
    });
    assert.equal(validateState(state), count === 500, `${count} elements`);
  }
});

test('player counts, money, field lengths, and grenade kinds are validated', () => {
  const mutations = [
    state => { state.players.pop(); },
    state => { state.players[0].money = -1; },
    state => { state.players[0].money = 16001; },
    state => { state.players[0].money = Infinity; },
    state => { state.players[0].money = '500'; },
    state => { state.players[0].name = 'x'.repeat(21); },
    state => { state.players[0].role = 'x'.repeat(31); },
    state => { state.players[0].task = 'x'.repeat(201); },
    state => { state.players[0].grenades = ['unknown']; },
    state => { state.players[0].grenades = Array(5).fill('flash'); },
  ];
  for (const mutate of mutations) assert.equal(validateState(changed(mutate)), false);
  assert.equal(validateState(changed(state => { state.players[0].money = 16000; })), true);
});

test('every supported marker type passes with valid coordinates and data', () => {
  for (const type of ['smoke', 'flash', 'fire', 'grenade', 'player', 'text', 'route', 'pen']) {
    const marker = element(type, type === 'text' ? { text: 'A < B & C' } : {});
    if (type === 'route' || type === 'pen') marker.points = [[0, 0], [1000, 1000]];
    assert.equal(validateState(changed(state => { state.phases[0].elements = [marker]; })), true, type);
  }
});

test('invalid marker types, colors, coordinates, and player indexes are rejected', () => {
  const markers = [
    element('script'),
    element('smoke', { player: -1 }),
    element('smoke', { player: 5 }),
    element('smoke', { color: 'red' }),
    element('smoke', { color: '#ffffff\" onclick=\"bad' }),
    element('smoke', { x: -1 }),
    element('smoke', { y: 1001 }),
    element('smoke', { x: Infinity }),
    element('smoke', { x: '500' }),
    element('text', { text: 'x'.repeat(81) }),
    element('text', { text: null }),
  ];
  for (const marker of markers) {
    assert.equal(validateState(changed(state => { state.phases[0].elements = [marker]; })), false);
  }
});

test('routes require between two and two thousand finite in-bounds points', () => {
  for (const points of [[], [[0, 0]], [[0, 0], [-1, 0]], [[0, 0], [1001, 0]], [[0, 0], [0, Infinity]], [[0, 0], [0, 0, 0]], Array(2001).fill([0, 0])]) {
    assert.equal(validateState(changed(state => { state.phases[0].elements = [element('route', { points })]; })), false);
  }
  assert.equal(validateState(changed(state => {
    state.phases[0].elements = [element('route', { points: Array(2000).fill([0, 0]) })];
  })), true);
});

test('custom maps accept only bounded raster data URLs', () => {
  for (const type of ['png', 'jpeg', 'webp']) {
    assert.equal(validateState(changed(state => {
      state.customMap = { name: 'map', data: `data:image/${type};base64,AAAA` };
    })), true);
  }
  for (const data of ['https://example.com/map.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,<!bad>', `data:image/png;base64,${'A'.repeat(4300000)}`]) {
    assert.equal(validateState(changed(state => { state.customMap = { name: 'map', data }; })), false);
  }
});
