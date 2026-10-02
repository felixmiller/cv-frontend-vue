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

let nextId = 91000000001;

// Wraps one scope into a project and loads it, returns the loaded scope
function loadScope(scope) {
    const id = nextId++;
    load({
        name: 'hex',
        timePeriod: 500,
        clockEnabled: false,
        focussedCircuit: id,
        orderedTabs: [String(id)],
        scopes: [{ layout: { width: 100, height: 40, title_x: 50, title_y: 13, titleEnabled: true }, ...scope, id, name: `hex${id}` }],
    });
    return globalScope;
}

function input(x, y, bitWidth, node, state) {
    return {
        x, y, objectType: 'Input', label: '', direction: 'RIGHT', labelDirection: 'LEFT', propagationDelay: 0,
        customData: { nodes: { output1: node }, values: { state }, constructorParamaters: ['RIGHT', bitWidth] },
    };
}

function hex(customData, x = 200) {
    return {
        x, y: 0, objectType: 'HexDisplay', label: '', direction: 'RIGHT', labelDirection: 'LEFT',
        propagationDelay: 10, customData,
    };
}

const node = (x, y, type, bitWidth, connections) => ({ x, y, type, bitWidth, label: '', connections });

// Saved before this change: only the color as constructor parameter.
// 4 bit input at (0,-100) -> bend at (200,-100) -> hex display bus pin at (200,-50)
function oldFormatScope(state = 10) {
    return {
        allNodes: [node(40, 0, 1, 4, [2]), node(0, -50, 0, 4, [2]), node(200, -100, 2, 4, [0, 1])],
        nodes: [2],
        Input: [input(0, -100, 4, 0, state)],
        HexDisplay: [hex({ constructorParamaters: ['Red'], nodes: { inp: 1 } })],
    };
}

const pos = (n) => [n.leftx, n.lefty];

describe('HexDisplay connector side and input mode', () => {
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

    test('old file loads unchanged: bus, connector on top, wire intact', () => {
        const scope = loadScope(oldFormatScope(10));
        const h = scope.HexDisplay[0];
        expect(h.inputMode).toBe('bus');
        expect(h.connectorSide).toBe('top');
        expect(pos(h.inp)).toEqual([0, -50]);
        expect(h.inp.connections.length).toBe(1);
        play(scope);
        expect(h.displayValue()).toBe(10);
    });

    test('bus mode saves the old node format plus the new parameters', () => {
        const scope = loadScope(oldFormatScope());
        const saved = backUp(scope).HexDisplay[0].customData;
        expect(Object.keys(saved.nodes)).toEqual(['inp']);
        expect(saved.constructorParamaters).toEqual(['Red', 'top', 'bus']);
    });

    test('connector side moves the bus pin, keeps the wire, survives save/load', () => {
        let scope = loadScope(oldFormatScope(7));
        scope.HexDisplay[0].setConnectorSide('left');
        expect(pos(scope.HexDisplay[0].inp)).toEqual([-30, 0]);
        expect(scope.HexDisplay[0].inp.connections.length).toBe(1);
        expect(scope.HexDisplay[0].direction).toBe('RIGHT');

        scope = loadScope(backUp(scope));
        const h = scope.HexDisplay[0];
        expect(h.connectorSide).toBe('left');
        expect(pos(h.inp)).toEqual([-30, 0]);
        expect(h.inp.connections.length).toBe(1);
        play(scope);
        expect(h.displayValue()).toBe(7);
    });

    test('arrow key direction moves the connector, display stays upright', () => {
        const scope = loadScope(oldFormatScope());
        const h = scope.HexDisplay[0];
        h.newDirection('DOWN');
        expect(h.connectorSide).toBe('bottom');
        expect(pos(h.inp)).toEqual([0, 50]);
        expect(h.direction).toBe('RIGHT');
    });

    test('switching to bits deletes the bus wire and creates labelled pins', () => {
        const scope = loadScope(oldFormatScope());
        const h = scope.HexDisplay[0];
        const busPin = h.inp;
        h.setInputMode('bits');
        expect(h.inp).toBeUndefined();
        expect(h.inpBits.map(pos)).toEqual([[20, -50], [10, -50], [-10, -50], [-20, -50]]);
        expect(h.inpBits.map((n) => n.label)).toEqual(['1', '2', '4', '8']);
        expect(h.nodeList).toEqual(h.inpBits);
        expect(scope.allNodes).not.toContain(busPin);
        expect(scope.nodes.length).toBe(0); // bend node removed
        expect(scope.Input[0].output1.connections.length).toBe(0);
        // repeated select events with the same value must not touch anything
        const pins = h.inpBits;
        h.setInputMode('bits');
        expect(h.inpBits).toBe(pins);
    });

    test('bits mode: value from single bits, unconnected counts as 0', () => {
        // bit0 = 1, bit1 = 0, bit2 unconnected, bit3 = 1  ->  9
        // Straight wires without crossings: input -> bend above the pin -> pin
        const scope = loadScope({
            allNodes: [
                node(10, 0, 1, 1, [7]), node(10, 0, 1, 1, [8]), node(10, 0, 1, 1, [9]),
                node(20, -50, 0, 1, [7]), node(10, -50, 0, 1, [8]), node(-10, -50, 0, 1, []), node(-20, -50, 0, 1, [9]),
                node(220, -140, 2, 1, [0, 3]), node(210, -120, 2, 1, [1, 4]), node(180, -100, 2, 1, [2, 6]),
            ],
            nodes: [7, 8, 9],
            Input: [input(0, -140, 1, 0, 1), input(0, -120, 1, 1, 0), input(0, -100, 1, 2, 1)],
            HexDisplay: [hex({ constructorParamaters: ['Red', 'top', 'bits'], nodes: { inpBits: [3, 4, 5, 6] } })],
        });
        const h = scope.HexDisplay[0];
        play(scope);
        expect(h.displayValue()).toBe(9);

        // side change and save/load keep all connections
        h.setConnectorSide('right');
        expect(h.inpBits.map(pos)).toEqual([[30, 20], [30, 10], [30, -10], [30, -20]]);
        const saved = backUp(scope);
        expect(saved.HexDisplay[0].customData.constructorParamaters).toEqual(['Red', 'right', 'bits']);
        expect(Object.keys(saved.HexDisplay[0].customData.nodes)).toEqual(['inpBits']);

        const reloaded = loadScope(saved);
        const h2 = reloaded.HexDisplay[0];
        expect(h2.inpBits.map(pos)).toEqual([[30, 20], [30, 10], [30, -10], [30, -20]]);
        expect(h2.inpBits.map((n) => n.connections.length)).toEqual([1, 1, 0, 1]);
        play(reloaded);
        expect(h2.displayValue()).toBe(9);

        // back to bus: bit wires including their bends are deleted
        h2.setInputMode('bus');
        expect(reloaded.nodes.length).toBe(0);
        expect(reloaded.Input.map((i) => i.output1.connections.length)).toEqual([0, 0, 0]);
    });

    test('wire deletion stops at a junction that feeds another element', () => {
        // input -> junction J (200,-100) -> display 1 pin, and J -> bend (400,-100) -> display 2 pin
        const scope = loadScope({
            allNodes: [
                node(40, 0, 1, 4, [3]), node(0, -50, 0, 4, [3]), node(0, -50, 0, 4, [4]),
                node(200, -100, 2, 4, [0, 1, 4]), node(400, -100, 2, 4, [3, 2]),
            ],
            nodes: [3, 4],
            Input: [input(0, -100, 4, 0, 12)],
            HexDisplay: [
                hex({ constructorParamaters: ['Red'], nodes: { inp: 1 } }, 200),
                hex({ constructorParamaters: ['Red'], nodes: { inp: 2 } }, 400),
            ],
        });
        const [h1, h2] = scope.HexDisplay;
        h1.setInputMode('bits');
        expect(scope.nodes.length).toBe(2); // junction and bend of the other branch stay
        expect(h2.inp.connections.length).toBe(1);
        play(scope);
        expect(h2.displayValue()).toBe(12);
    });

    test('switching back to bus restores the single bus pin', () => {
        const scope = loadScope(oldFormatScope());
        const h = scope.HexDisplay[0];
        h.setInputMode('bits');
        h.setInputMode('bus');
        expect(h.inpBits).toBeUndefined();
        expect(pos(h.inp)).toEqual([0, -50]);
        expect(h.nodeList).toEqual([h.inp]);
    });
});
