import { setup } from '../src/setup';
import load from '../src/data/load';
import { backUp } from '../src/data/backupCircuit';
import { play } from '../src/engine';
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
        name: 'split',
        timePeriod: 500,
        clockEnabled: false,
        focussedCircuit: id,
        orderedTabs: [String(id)],
        scopes: [{ layout: { width: 100, height: 40, title_x: 50, title_y: 13, titleEnabled: true }, ...scope, id, name: `split${id}` }],
    });
    return globalScope;
}

const node = (x, y, type, bitWidth, connections) => ({ x, y, type, bitWidth, label: '', connections });
const pos = (n) => [n.leftx, n.lefty];

// Saved before this change: no flip parameter. 8 bit input -> splitter (2 3 3), straight wire at y = 20
function oldFormatScope(state = 0xd6) {
    return {
        allNodes: [
            node(80, 0, 1, 8, [1]),
            node(-10, 20, 0, 8, [0]), node(20, -30, 0, 2, []), node(20, -10, 0, 3, []), node(20, 10, 0, 3, []),
        ],
        nodes: [],
        Input: [{
            x: 0, y: 20, objectType: 'Input', label: '', direction: 'RIGHT', labelDirection: 'LEFT', propagationDelay: 0,
            customData: { nodes: { output1: 0 }, values: { state }, constructorParamaters: ['RIGHT', 8] },
        }],
        Splitter: [{
            x: 200, y: 0, objectType: 'Splitter', label: '', direction: 'RIGHT', labelDirection: 'LEFT', propagationDelay: 10,
            customData: { constructorParamaters: ['RIGHT', 8, [2, 3, 3]], nodes: { outputs: [2, 3, 4], inp1: 1 } },
        }],
    };
}

const outValues = (s) => s.outputs.map((o) => o.value);

describe('Splitter flip and fixed bit width', () => {
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

    test('old file loads unflipped with unchanged pins', () => {
        const scope = loadScope(oldFormatScope());
        const s = scope.Splitter[0];
        expect(s.flipped).toBe(false);
        expect(pos(s.inp1)).toEqual([-10, 20]);
        expect(s.outputs.map(pos)).toEqual([[20, -30], [20, -10], [20, 10]]);
        play(scope);
        expect(outValues(s)).toEqual([2, 5, 6]); // 0xd6 = 110 101 10
    });

    test('flip mirrors the pins about the spine middle and keeps the wire', () => {
        const scope = loadScope(oldFormatScope());
        const s = scope.Splitter[0];
        s.setFlipped(true);
        expect(pos(s.inp1)).toEqual([-10, -40]);
        expect(s.outputs.map(pos)).toEqual([[20, 10], [20, -10], [20, -30]]);
        expect(s.inp1.connections.length).toBe(1);
        s.setFlipped(true); // repeated checkbox events must not flip back
        expect(pos(s.inp1)).toEqual([-10, -40]);
        play(scope);
        expect(outValues(s)).toEqual([2, 5, 6]);
        s.setFlipped(false);
        expect(pos(s.inp1)).toEqual([-10, 20]);
        expect(s.outputs.map(pos)).toEqual([[20, -30], [20, -10], [20, 10]]);
    });

    test('flip survives save and load', () => {
        let scope = loadScope(oldFormatScope(0x2b));
        scope.Splitter[0].setFlipped(true);
        const saved = backUp(scope);
        expect(saved.Splitter[0].customData.constructorParamaters).toEqual(['RIGHT', 8, [2, 3, 3], true]);

        scope = loadScope(saved);
        const s = scope.Splitter[0];
        expect(s.flipped).toBe(true);
        expect(pos(s.inp1)).toEqual([-10, -40]);
        expect(s.outputs.map(pos)).toEqual([[20, 10], [20, -10], [20, -30]]);
        expect(s.inp1.connections.length).toBe(1);
        play(scope);
        expect(outValues(s)).toEqual([3, 2, 1]); // 0x2b = 001 010 11
    });

    test('bit width cannot be changed after creation', () => {
        const scope = loadScope(oldFormatScope());
        const s = scope.Splitter[0];
        expect(s.fixedBitWidth).toBe(true);
        s.newBitWidth(16);
        expect(s.bitWidth).toBe(8);
        expect([s.inp1, ...s.outputs].map((n) => n.bitWidth)).toEqual([8, 2, 3, 3]);
    });

    test('unflipped splitters save the flag as false', () => {
        const scope = loadScope(oldFormatScope());
        expect(backUp(scope).Splitter[0].customData.constructorParamaters).toEqual(['RIGHT', 8, [2, 3, 3], false]);
    });
});
