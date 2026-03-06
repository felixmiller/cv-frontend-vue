import ProgrammableLogic from './ProgrammableLogic'

/**
 * PLA — Programmable Logic Array
 * AND array: programmable (user clicks x to toggle)
 * OR array: programmable (user clicks x to toggle)
 */
export default class PLA extends ProgrammableLogic {
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
    get orProgrammable() { return true }
}

PLA.prototype.tooltipText = 'Programmable Logic Array (PLA): programmable AND and OR'
PLA.prototype.objectType = 'PLA'
