import { setup } from '../src/setup';
import load from '../src/data/load';
import { backUp } from '../src/data/backupCircuit';
import { play } from '../src/engine';
import Input from '../src/modules/Input';
import HmCounter from '../src/sequential/HmCounter';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { createRouter, createWebHistory } from 'vue-router';
import i18n from '#/locales/i18n';
import { routes } from '#/router';
import vuetify from '#/plugins/vuetify';
import simulator from '#/pages/simulator.vue';

vi.mock('codemirror', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        fromTextArea: vi.fn(() => ({ setValue: () => { } })),
    };
});

vi.mock('codemirror-editor-vue3', () => ({
    defineSimpleMode: vi.fn(),
}));

let nextId = 92000000001;

// Wraps one scope into a project and loads it, returns the loaded scope
function loadScope(scope) {
    const id = nextId++;
    load({
        name: 'ctr',
        timePeriod: 500,
        clockEnabled: false,
        focussedCircuit: id,
        orderedTabs: [String(id)],
        scopes: [{ layout: { width: 100, height: 40, title_x: 50, title_y: 13, titleEnabled: true }, ...scope, id, name: `ctr${id}` }],
    });
    return globalScope;
}

// Fresh scope with one counter at (200, 0), extra args are the constructor parameters after scope
function counter(...params) {
    const scope = loadScope({ allNodes: [], nodes: [] });
    return { scope, c: new HmCounter(200, 0, scope, ...params) };
}

// Input element left of the pin on the same row, so the wire is straight
function drive(scope, pin, state = 0) {
    const inp = new Input(pin.absX() - 100 - pin.bitWidth * 10, pin.absY(), scope, 'RIGHT', pin.bitWidth);
    inp.output1.connect(pin);
    inp.state = state;
    return inp;
}

function set(scope, inp, state) {
    inp.state = state;
    play(scope);
}

// One full clock period, the active edge comes first
function tick(scope, clk, n = 1, activeLevel = 1) {
    for (let i = 0; i < n; i++) {
        set(scope, clk, activeLevel);
        set(scope, clk, 1 - activeLevel);
    }
}

const pos = (n) => [n.leftx, n.lefty];
const onGrid = (n) => n.absX() % 10 === 0 && n.absY() % 10 === 0;

describe('HM binary counter', () => {
    beforeAll(async () => {
        const pinia = createPinia();
        setActivePinia(pinia);
        const router = createRouter({ history: createWebHistory(), routes });
        const elem = document.createElement('div');
        document.body.appendChild(elem);
        global.document.createRange = vi.fn(() => ({
            setEnd: vi.fn(),
            setStart: vi.fn(),
            getBoundingClientRect: vi.fn(() => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 })),
            getClientRects: vi.fn(() => ({ item: vi.fn(() => null), length: 0, [Symbol.iterator]: vi.fn(() => []) })),
        }));
        global.globalScope = global.globalScope || {};
        mount(simulator, { global: { plugins: [pinia, router, i18n, vuetify] }, attachTo: elem });
        setup();
    });

    test('base version: CLK, RST, Q only, counts up on rising edges and wraps', () => {
        const { scope, c } = counter();
        expect(c.nodeList).toHaveLength(3);
        expect(pos(c.clkInp)).toEqual([-30, 10]);
        expect(pos(c.qOutput)).toEqual([60, -10]);
        expect(pos(c.rstInp)).toEqual([10, 30]);
        expect(c.qOutput.bitWidth).toBe(4);
        const clk = drive(scope, c.clkInp);
        play(scope);
        expect(c.qOutput.value).toBe(0);
        set(scope, clk, 1);
        expect(c.qOutput.value).toBe(1);
        set(scope, clk, 0);
        expect(c.qOutput.value).toBe(1);
        tick(scope, clk, 14);
        expect(c.qOutput.value).toBe(15);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(0);
    });

    test('negative edge: bubble position, counts on falling edge', () => {
        const { scope, c } = counter(4, 'sync', 'high', 'neg');
        expect(pos(c.clkInp)).toEqual([-40, 10]);
        const clk = drive(scope, c.clkInp, 1);
        play(scope);
        set(scope, clk, 0);
        expect(c.qOutput.value).toBe(1);
        set(scope, clk, 1);
        expect(c.qOutput.value).toBe(1);
    });

    test('sync reset acts on the edge, async reset immediately, unconnected reset is inactive', () => {
        let { scope, c } = counter(4, 'sync', 'high');
        let clk = drive(scope, c.clkInp);
        play(scope);
        tick(scope, clk, 5);
        let rst = drive(scope, c.rstInp, 1);
        play(scope);
        expect(c.qOutput.value).toBe(5);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(0);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(0);

        ({ scope, c } = counter(4, 'async', 'low'));
        expect(pos(c.rstInp)).toEqual([10, 40]);
        clk = drive(scope, c.clkInp);
        play(scope);
        tick(scope, clk, 5); // low active, but unconnected: no reset
        expect(c.qOutput.value).toBe(5);
        rst = drive(scope, c.rstInp, 1);
        play(scope);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(6);
        set(scope, rst, 0);
        expect(c.qOutput.value).toBe(0);
        tick(scope, clk, 3);
        expect(c.qOutput.value).toBe(0);
        set(scope, rst, 1);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(1);
    });

    test('synchronous load, priority RST > LD > EN, load ignores EN', () => {
        const { scope, c } = counter(4, 'sync', 'high', 'pos', 'up', true, 'high', true, 'high', true);
        expect([c.dInp, c.ldInp, c.enInp, c.clkInp].map(pos)).toEqual([[-30, -10], [-30, 10], [-30, 30], [-30, 50]]);
        expect(pos(c.rstInp)).toEqual([10, 70]);
        const clk = drive(scope, c.clkInp);
        const d = drive(scope, c.dInp, 9);
        const ld = drive(scope, c.ldInp, 1);
        const en = drive(scope, c.enInp, 0);
        const rst = drive(scope, c.rstInp, 0);
        play(scope);
        set(scope, clk, 1);
        expect(c.qOutput.value).toBe(9); // loaded although disabled
        set(scope, clk, 0);
        set(scope, rst, 1);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(0); // reset wins over load
        set(scope, rst, 0);
        set(scope, ld, 0);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(0); // disabled: hold
        set(scope, en, 1);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(1);
        set(scope, d, 15);
        set(scope, ld, 1);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(15);
    });

    test('low active load and enable get a bubble position and invert', () => {
        const { scope, c } = counter(4, 'sync', 'high', 'pos', 'up', true, 'low', true, 'low');
        expect(pos(c.ldInp)).toEqual([-40, 10]);
        expect(pos(c.enInp)).toEqual([-40, 30]);
        const clk = drive(scope, c.clkInp);
        drive(scope, c.dInp, 7);
        const ld = drive(scope, c.ldInp, 1);
        const en = drive(scope, c.enInp, 1);
        play(scope);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(0); // LD inactive, EN inactive
        set(scope, en, 0);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(1);
        set(scope, ld, 0);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(7);
    });

    test('count direction down and via U/D input (1 = up, unconnected = up)', () => {
        let { scope, c } = counter(4, 'sync', 'high', 'pos', 'down');
        let clk = drive(scope, c.clkInp);
        play(scope);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(15);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(14);

        ({ scope, c } = counter(4, 'sync', 'high', 'pos', 'input'));
        expect([c.udInp, c.clkInp].map(pos)).toEqual([[-30, -10], [-30, 10]]);
        clk = drive(scope, c.clkInp);
        play(scope);
        tick(scope, clk, 2);
        expect(c.qOutput.value).toBe(2);
        const ud = drive(scope, c.udInp, 0);
        play(scope);
        tick(scope, clk, 3);
        expect(c.qOutput.value).toBe(15);
        set(scope, ud, 1);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(0);
    });

    test('TC: max value counting up, zero counting down, gated by EN, follows U/D immediately', () => {
        const { scope, c } = counter(2, 'sync', 'high', 'pos', 'input', false, 'high', true, 'high', true);
        const clk = drive(scope, c.clkInp);
        const ud = drive(scope, c.udInp, 1);
        const en = drive(scope, c.enInp, 1);
        play(scope);
        expect(c.tcOutput.value).toBe(0);
        tick(scope, clk, 3);
        expect(c.qOutput.value).toBe(3);
        expect(c.tcOutput.value).toBe(1);
        set(scope, en, 0);
        expect(c.tcOutput.value).toBe(0);
        set(scope, en, 1);
        set(scope, ud, 0);
        expect(c.tcOutput.value).toBe(0);
        tick(scope, clk, 3);
        expect(c.qOutput.value).toBe(0);
        expect(c.tcOutput.value).toBe(1);
        set(scope, ud, 1);
        expect(c.tcOutput.value).toBe(0);
    });

    // A counter reads its inputs one propagation delay after the clock edge. If the low counter is
    // faster, its new TC is already there by then. Only the master-slave sampling keeps the high
    // counter from counting one period early in that case.
    test.each([[10, 10], [0, 10]])('cascade on a shared clock: TC of the low counter enables the high counter (delays %i, %i)', (loDelay, hiDelay) => {
        const { scope, c } = counter(4, 'sync', 'high', 'pos', 'up', false, 'high', false, 'high', true);
        const hi = new HmCounter(200, 200, scope, 4, 'sync', 'high', 'pos', 'up', false, 'high', true);
        c.propagationDelay = loDelay;
        hi.propagationDelay = hiDelay;
        const clk = drive(scope, c.clkInp);
        clk.output1.connect(hi.clkInp);
        c.tcOutput.connect(hi.enInp);
        play(scope);
        tick(scope, clk, 15);
        expect([hi.qOutput.value, c.qOutput.value]).toEqual([0, 15]);
        tick(scope, clk);
        expect([hi.qOutput.value, c.qOutput.value]).toEqual([1, 0]);
        tick(scope, clk, 16 * 3 + 5);
        expect([hi.qOutput.value, c.qOutput.value]).toEqual([4, 5]);
    });

    test('hiding a pin deletes its wire and parks the pin off the grid', () => {
        const { scope, c } = counter(4, 'sync', 'high', 'pos', 'up', true);
        const d = drive(scope, c.dInp, 3);
        const wires = scope.wires.length;
        c.setHasLoad(false);
        expect(c.nodeList).not.toContain(c.dInp);
        expect(c.dInp.connections).toHaveLength(0);
        expect(d.output1.connections).toHaveLength(0);
        scope.wires.slice().forEach((w) => w.checkConnections()); // engine does this on the next update
        expect(scope.wires.length).toBe(wires - 1);
        expect(onGrid(c.dInp)).toBe(false);
        expect(pos(c.clkInp)).toEqual([-30, 10]);
        c.setHasLoad(true);
        expect(pos(c.dInp)).toEqual([-30, -10]);
        expect(c.nodeList).toContain(c.dInp);
    });

    test('repeated panel events with the same value change nothing', () => {
        const { c } = counter(4, 'sync', 'high', 'pos', 'up', true);
        const nodes = c.nodeList.slice();
        c.setHasLoad(true);
        c.setHasLoad('true');
        c.setCountDirection('up');
        c.setCountDirection('sideways');
        c.newBitWidth(4);
        expect(c.nodeList.length).toBe(nodes.length);
        expect(c.nodeList.every((n, i) => n === nodes[i])).toBe(true);
        expect(c.countDirection).toBe('up');
    });

    test('deleting the counter removes the hidden pins too', () => {
        const { scope, c } = counter();
        const pins = [c.dInp, c.ldInp, c.udInp, c.enInp, c.tcOutput, c.clkInp, c.rstInp, c.qOutput];
        c.delete();
        for (const pin of pins) expect(scope.allNodes).not.toContain(pin);
    });

    test('bit width and display format: widths, wrap, box width', () => {
        const { scope, c } = counter(4, 'sync', 'high', 'pos', 'down', true);
        c.newBitWidth(8);
        expect([c.dInp.bitWidth, c.qOutput.bitWidth, c.clkInp.bitWidth]).toEqual([8, 8, 1]);
        const clk = drive(scope, c.clkInp);
        play(scope);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(255);
        expect(c._displayText()).toBe('FF');
        expect(pos(c.qOutput)).toEqual([80, -10]);
        c.setDisplayFormat('dec');
        expect(c._displayText()).toBe('255');
        expect(pos(c.qOutput)).toEqual([80, -10]);
        c.newBitWidth(16); // 65535: 5 digits
        expect(pos(c.qOutput)).toEqual([120, -10]);
        expect(onGrid(c.rstInp)).toBe(true);
        c.newBitWidth(32);
        tick(scope, clk);
        expect(c.qOutput.value).toBe(254);
        c.newBitWidth(3);
        expect(c.qOutput.value).toBe(254); // until next simulation
        play(scope);
        expect(c.qOutput.value).toBe(6);
    });

    test('save and load keep configuration, pin positions and wires', () => {
        let { scope, c } = counter(4, 'async', 'low', 'neg', 'input', true, 'low', true, 'high', true, 'dec');
        for (const pin of [c.clkInp, c.dInp, c.ldInp, c.udInp, c.enInp]) drive(scope, pin);
        new HmCounter(400, 0, scope); // default: optional pins hidden
        const saved = backUp(scope);
        const params = saved.HmCounter[0].customData.constructorParamaters;
        expect(params).toEqual([4, 'async', 'low', 'neg', 'input', true, 'low', true, 'high', true, 'dec']);
        const before = c.nodeList.map(pos);

        scope = loadScope(saved);
        c = scope.HmCounter[0];
        expect(c.resetType).toBe('async');
        expect(c.nodeList.map(pos).sort()).toEqual(before.sort());
        for (const pin of [c.clkInp, c.dInp, c.ldInp, c.udInp, c.enInp]) expect(pin.connections).toHaveLength(1);
        expect(c.rstInp.connections).toHaveLength(0);
        expect(c.tcOutput.disabled).toBe(false);
        expect(scope.Input).toHaveLength(5);

        const plain = scope.HmCounter[1];
        expect(plain.nodeList).toHaveLength(3);
        for (const pin of [plain.dInp, plain.ldInp, plain.udInp, plain.enInp, plain.tcOutput]) {
            expect(pin.disabled).toBe(true);
            expect(onGrid(pin)).toBe(false);
        }
    });
});
