import ProgrammableLogic from './ProgrammableLogic'
import { simulationArea } from '../simulationArea'

/**
 * PLE — Programmable Logic Element (also known as ROM)
 * AND array: fixed full decoder (one product term per minterm, shown as dots)
 * OR array: programmable (user clicks x to toggle)
 *
 * Product terms = 2^inputs (always a full decoder).
 * Config: inputs (max 4, since 2^4 = 16 terms), outputs.
 */
export default class PLE extends ProgrammableLogic {
    constructor(
        x, y, scope = globalScope,
        inputs = 3, productTerms = null, outputs = 2,
        andFuses = null, orFuses = null,
        hasInverters = false, locked = false, invertMask = null
    ) {
        // Force product terms to 2^inputs
        const terms = Math.pow(2, inputs)
        super(x, y, scope, inputs, terms, outputs, andFuses, orFuses,
            hasInverters, locked, invertMask)
    }

    get andProgrammable() { return false }
    get orProgrammable() { return true }

    /** Full decoder: each product term p corresponds to minterm p */
    _defaultAndFuses() {
        const fuses = this._makeArray(this.productTerms, this.andCols, 0)
        for (let p = 0; p < this.productTerms; p++) {
            for (let i = 0; i < this.inputs; i++) {
                const bit = (p >> (this.inputs - 1 - i)) & 1
                // MSB leftmost: input i uses bit (inputs-1-i) of term index
                fuses[p][2 * i + (bit ? 0 : 1)] = 1
            }
        }
        return fuses
    }

    /** Start with all OR fuses off (user programs the function) */
    _defaultOrFuses() {
        return this._makeArray(this.productTerms, this.outputs, 0)
    }
}

PLE.prototype.tooltipText = 'Programmable Logic Element (PLE/ROM): fixed decoder AND, programmable OR'
PLE.prototype.objectType = 'PLE'

PLE.prototype.mutableProperties = {
    locked: {
        name: 'Lock Fuses',
        type: 'checkbox',
        func: 'setLocked',
    },
    hasInverters: {
        name: 'Output Inverters',
        type: 'checkbox',
        func: 'setHasInverters',
    },
    inputs: {
        name: 'Inputs',
        type: 'number',
        max: '4',
        min: '2',
        func: 'changeInputCount',
    },
    outputs: {
        name: 'Outputs',
        type: 'number',
        max: '8',
        min: '1',
        func: 'changeOutputCount',
    },
}

// Override: changing inputs recomputes product terms (2^inputs)
PLE.prototype.changeInputCount = function (val) {
    if (val === undefined || val < 2 || val > 4 || val === this.inputs) return
    const obj = new this.constructor(this.x, this.y, this.scope,
        val, null, this.outputs,
        null, null, this.hasInverters, this.locked, this.invertMask.slice())
    this.cleanDelete()
    simulationArea.lastSelected = obj
    return obj
}
