import ProgrammableLogic from './ProgrammableLogic'
import { simulationArea } from '../simulationArea'

/**
 * PAL — Programmable Array Logic
 * AND array: programmable (user clicks x to toggle)
 * OR array: fixed (shown as dots, evenly divided among outputs)
 *
 * Config uses "terms per output" instead of total product terms.
 * Total product terms = termsPerOutput * outputs.
 */
export default class PAL extends ProgrammableLogic {
    constructor(
        x, y, scope = globalScope,
        inputs = 3, productTerms = 4, outputs = 2,
        andFuses = null, orFuses = null,
        hasInverters = false, locked = false, invertMask = null
    ) {
        super(x, y, scope, inputs, productTerms, outputs, andFuses, orFuses,
            hasInverters, locked, invertMask)
    }

    get andProgrammable() { return true }
    get orProgrammable() { return false }

    get termsPerOutput() {
        return Math.ceil(this.productTerms / this.outputs)
    }
}

PAL.prototype.tooltipText = 'Programmable Array Logic (PAL): programmable AND, fixed OR'
PAL.prototype.objectType = 'PAL'

PAL.prototype.mutableProperties = {
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
        max: '8',
        min: '2',
        func: 'changeInputCount',
    },
    termsPerOutput: {
        name: 'Terms per Output',
        type: 'number',
        max: '8',
        min: '1',
        func: 'changeTermsPerOutput',
    },
    outputs: {
        name: 'Outputs',
        type: 'number',
        max: '8',
        min: '1',
        func: 'changeOutputCount',
    },
}

PAL.prototype.changeTermsPerOutput = function (val) {
    if (val === undefined || val < 1 || val > 8 || val === this.termsPerOutput) return
    const newTotal = val * this.outputs
    const obj = new this.constructor(this.x, this.y, this.scope,
        this.inputs, newTotal, this.outputs,
        null, null, this.hasInverters, this.locked, this.invertMask.slice())
    this.cleanDelete()
    simulationArea.lastSelected = obj
    return obj
}

// Override: changing outputs also recomputes total product terms
PAL.prototype.changeOutputCount = function (val) {
    if (val === undefined || val < 1 || val > 8 || val === this.outputs) return
    const newTotal = this.termsPerOutput * val
    const obj = new this.constructor(this.x, this.y, this.scope,
        this.inputs, newTotal, val,
        null, null, this.hasInverters, this.locked, this.invertMask.slice())
    this.cleanDelete()
    simulationArea.lastSelected = obj
    return obj
}
