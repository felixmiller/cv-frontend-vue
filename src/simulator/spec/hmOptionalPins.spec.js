import { setup } from '../src/setup';
import load from '../src/data/load';
import { backUp } from '../src/data/backupCircuit';
import { play } from '../src/engine';
import Input from '../src/modules/Input';
import Output from '../src/modules/Output';
import DFF from '../src/sequential/DFF';
import TFF from '../src/sequential/TFF';
import RSFF from '../src/sequential/RSFF';
import JKFF from '../src/sequential/JKFF';
import DLatch from '../src/sequential/DLatch';
import RSLatch from '../src/sequential/RSLatch';
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

let nextId = 93000000001;

function loadScope(scope) {
    const id = nextId++;
    load({
        name: 'pins',
        timePeriod: 500,
        clockEnabled: false,
        focussedCircuit: id,
        orderedTabs: [String(id)],
        scopes: [{ layout: { width: 100, height: 40, title_x: 50, title_y: 13, titleEnabled: true }, ...scope, id, name: `pins${id}` }],
    });
    return globalScope;
}

const emptyScope = () => loadScope({ allNodes: [], nodes: [] });

// Input element left of the pin on the same row, so the wire is straight
function drive(scope, pin, state = 0) {
    const inp = new Input(pin.absX() - 100 - pin.bitWidth * 10, pin.absY(), scope, 'RIGHT', pin.bitWidth);
    inp.output1.connect(pin);
    inp.state = state;
    return inp;
}

const pos = (n) => [n.leftx, n.lefty];
const onGrid = (n) => n.absX() % 10 === 0 && n.absY() % 10 === 0;
const optional = (e) => [e.preNode, e.clrNode, e.enNode];

// Preset, clear and enable shown
function showAll(e) {
    if (e.setResetType) e.setResetType('async'); // also turns clear on
    else e.setHasClear(true);
    e.setHasPreset(true);
    e.setHasEnable(true);
}

// Positions with all optional pins shown: [preset, clear, enable]
const SMALL = [[0, -30], [0, 50], [-30, 30]];
const TALL = [[0, -40], [0, 60], [-30, 40]];
const TYPES = [
    ['DFF', DFF, SMALL],
    ['TFF', TFF, SMALL],
    ['RSFF', RSFF, TALL],
    ['JKFF', JKFF, TALL],
    ['DLatch', DLatch, SMALL],
    ['RSLatch', RSLatch, TALL],
];

describe('HM sequential elements: hidden optional pins', () => {
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

    test.each(TYPES)('%s: hidden pins are parked off the grid', (name, Type) => {
        const e = new Type(200, 0, emptyScope());
        for (const pin of optional(e)) {
            expect(e.nodeList).not.toContain(pin);
            expect(pin.disabled).toBe(true);
            expect(onGrid(pin)).toBe(false);
        }
    });

    test.each(TYPES)('%s: shown pins at their position, polarity set while hidden is applied', (name, Type, expected) => {
        const e = new Type(200, 0, emptyScope());
        e.setEnablePolarity('low');
        showAll(e);
        const [pre, clr, en] = expected;
        expect(optional(e).map(pos)).toEqual([pre, clr, [-40, en[1]]]);
        for (const pin of optional(e)) {
            expect(e.nodeList).toContain(pin);
            expect(pin.disabled).toBe(false);
        }
    });

    test.each(TYPES)('%s: hiding a pin deletes its wire and parks it', (name, Type, expected) => {
        const scope = emptyScope();
        const e = new Type(200, 0, scope);
        showAll(e);
        const inp = drive(scope, e.enNode, 1);
        e.setHasEnable(false);
        expect(e.enNode.connections).toHaveLength(0);
        expect(inp.output1.connections).toHaveLength(0);
        expect(onGrid(e.enNode)).toBe(false);
        expect(pos(e.clrNode)).toEqual([0, expected[1][1] - 20]); // moves up with the shrinking box
    });

    test.each(TYPES)('%s: deleting the element removes hidden pins too', (name, Type) => {
        const scope = emptyScope();
        const e = new Type(200, 0, scope);
        const pins = optional(e);
        e.delete();
        for (const pin of pins) expect(scope.allNodes).not.toContain(pin);
    });

    test.each(TYPES)('%s: save and load keep hidden pins parked and shown pins in place', (name, Type, expected) => {
        let scope = emptyScope();
        new Type(200, 0, scope);
        showAll(new Type(200, 200, scope));
        scope = loadScope(backUp(scope));
        const [hidden, shown] = scope[name];
        for (const pin of optional(hidden)) {
            expect(pin.disabled).toBe(true);
            expect(onGrid(pin)).toBe(false);
        }
        expect(optional(shown).map(pos)).toEqual(expected);
    });

    // Before the fix a hidden pin kept its wires and its grid position, and wire ends
    // dropped there attached to it. Simulated here by hiding the enable pin the old way.
    test.each(TYPES)('%s: old file with wires on a hidden pin keeps the connection via a junction', (name, Type) => {
        let scope = emptyScope();
        const e = new Type(200, 0, scope);
        e.setHasEnable(true);
        const inp = drive(scope, e.enNode, 1);
        const out = new Output(0, 0, scope);
        out.x = e.enNode.absX() - (out.inp1.absX() - out.x);
        out.y = e.enNode.absY() + 100;
        out.inp1.connect(e.enNode);
        const [x, y] = [e.enNode.absX(), e.enNode.absY()];
        e.hasEnable = false;
        e.nodeList.splice(e.nodeList.indexOf(e.enNode), 1);
        e.enNode.disabled = true;

        scope = loadScope(backUp(scope));
        const loaded = scope[name][0];
        expect(loaded.enNode.connections).toHaveLength(0);
        expect(onGrid(loaded.enNode)).toBe(false);
        const junction = scope.Input[0].output1.connections[0];
        expect(junction.type).toBe(2);
        expect([junction.absX(), junction.absY()]).toEqual([x, y]);
        expect(junction.connections).toContain(scope.Output[0].inp1);
        play(scope);
        expect(scope.Output[0].inp1.value).toBe(1);
    });
});
