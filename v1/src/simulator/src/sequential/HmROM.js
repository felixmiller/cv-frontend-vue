import HmMemory from './HmMemory'

/**
 * HmROM — Read-only memory with clickable binary table.
 * Data persists across save/load (stored in constructorParamaters).
 */
export default class HmROM extends HmMemory {
    constructor(
        x, y, scope = globalScope, dir = 'RIGHT',
        addressWidth = 2, dataWidth = 4, data = null,
        hasEnable = false, isSynchronous = false, isBusMode = false,
        enablePolarity = 'high', outputType = 'pushpull'
    ) {
        super(x, y, scope, dir, addressWidth, dataWidth, data,
            hasEnable, isSynchronous, isBusMode,
            enablePolarity, outputType)
    }

    _titleText() { return 'ROM' }
}

HmROM.prototype.objectType = 'HmROM'
HmROM.prototype.tooltipText = 'ROM (HM): Read-only memory with configurable address/data width'
HmROM.prototype.constructorParametersDefault = [2, 4, null, false, false, false, 'high', 'pushpull']

HmROM.prototype.mutableProperties = {
    addressWidth: {
        name: 'Address Width',
        type: 'number',
        max: '6',
        min: '1',
        func: 'setAddressWidth',
    },
    dataWidth: {
        name: 'Data Width',
        type: 'number',
        max: '32',
        min: '1',
        func: 'setDataWidth',
    },
    hasEnable: {
        name: 'Enable Input',
        type: 'checkbox',
        func: 'setHasEnable',
    },
    enablePolarity: {
        name: 'Enable Polarity',
        type: 'select',
        options: ['high', 'low'],
        func: 'setEnablePolarity',
        condition: 'hasEnable',
        conditionValues: [true],
    },
    outputType: {
        name: 'Output Type',
        type: 'select',
        options: ['pushpull', 'tristate'],
        func: 'setOutputType',
        condition: 'hasEnable',
        conditionValues: [true],
    },
    isSynchronous: {
        name: 'Synchronous',
        type: 'checkbox',
        func: 'setIsSynchronous',
    },
    isBusMode: {
        name: 'Bus Mode',
        type: 'checkbox',
        func: 'setIsBusMode',
    },
}
