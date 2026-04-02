import HmMemory from './HmMemory'
import Node, { findNode } from '../node'
import { simulationArea } from '../simulationArea'
import { colors } from '../themer/themer'
import { scheduleUpdate } from '../engine'

/**
 * HmRAM — Read/write memory with clickable binary table.
 * Adds data input (DIN), write enable (WE) ports.
 * Data persists across save/load unless 'volatile' is checked.
 */

const NODE_SPACING = 10
const snap10 = v => Math.round(v / 10) * 10

export default class HmRAM extends HmMemory {
    constructor(
        x, y, scope = globalScope, dir = 'RIGHT',
        addressWidth = 2, dataWidth = 4, data = null,
        hasEnable = false, isSynchronous = false, isBusMode = false,
        enablePolarity = 'high', outputType = 'pushpull',
        isVolatile = false
    ) {
        super(x, y, scope, dir, addressWidth, dataWidth, data,
            hasEnable, isSynchronous, isBusMode,
            enablePolarity, outputType)
        this.isVolatile = isVolatile

        // Master latches for synchronous write
        this.masterWriteAddr = undefined
        this.masterWriteData = undefined
        this.masterWriteEnable = false

        // Volatile: clear data on construction (which happens on load)
        if (isVolatile && data !== null) {
            this.data = new Array(this.numRows).fill(0)
        }
    }

    _titleText() { return 'RAM' }

    _getControlCount() {
        // WE + parent controls (CLK, EN)
        return 1 + super._getControlCount()
    }

    _getExtraNodeCount() {
        // DIN nodes count
        return this.isBusMode ? 1 : this.dataWidth
    }

    _buildExtraInputNodes(leftX, topY) {
        const addrEnd = this.isBusMode ? 1 : this.addressWidth
        const dinStartY = snap10(topY + addrEnd * NODE_SPACING + NODE_SPACING)

        // Data input nodes
        this.dinNodes = []
        if (this.isBusMode) {
            const midY = snap10(dinStartY + (this.dataWidth - 1) * NODE_SPACING / 2)
            this.dinNodes.push(new Node(leftX, midY, 0, this, this.dataWidth, 'DI'))
        } else {
            for (let i = 0; i < this.dataWidth; i++) {
                const ny = snap10(dinStartY + i * NODE_SPACING)
                this.dinNodes.push(new Node(leftX, ny, 0, this, 1, `DI${this.dataWidth - 1 - i}`))
            }
        }

        // Write enable node
        const dinEnd = this.isBusMode ? 1 : this.dataWidth
        const weY = snap10(dinStartY + dinEnd * NODE_SPACING)
        this.weNode = new Node(leftX, weY, 0, this, 1, 'WE')
    }

    _getControlStartY(topY) {
        // After address + DIN + WE
        const addrEnd = this.isBusMode ? 1 : this.addressWidth
        const dinEnd = this.isBusMode ? 1 : this.dataWidth
        return snap10(topY + (addrEnd + dinEnd + 1) * NODE_SPACING + NODE_SPACING)
    }

    _readDataInputs() {
        if (this.isBusMode) {
            return this.dinNodes[0].value
        }
        let val = 0
        for (let i = 0; i < this.dataWidth; i++) {
            const v = this.dinNodes[i].value
            if (v === undefined) return undefined
            val |= (v & 1) << (this.dataWidth - 1 - i)
        }
        return val
    }

    /** Perform write if WE is asserted. Called from base resolve(). */
    _doWrite(addr) {
        if (this.isSynchronous) {
            // Master-slave is handled in resolve override
            return
        }
        // Async write
        if (this.weNode.value === 1 && addr !== undefined) {
            const din = this._readDataInputs()
            if (din !== undefined) {
                this.data[addr] = din & ((1 << this.dataWidth) - 1)
            }
        }
    }

    resolve() {
        const addr = this._readAddress()
        this._activeRow = addr

        if (!this._isEnabled()) {
            this._writeOutputs(undefined)
            this.prevClkState = this.clkNode.value
            return
        }

        if (this.isSynchronous) {
            const clkVal = this.clkNode.value
            if (clkVal === undefined) {
                this.prevClkState = undefined
                return
            }
            if (clkVal === 0) {
                // Clock inactive: sample inputs into master latches
                this.masterWriteAddr = addr
                this.masterWriteData = this._readDataInputs()
                this.masterWriteEnable = this.weNode.value === 1
                if (addr !== undefined) this.masterAddr = addr
            } else if (this.prevClkState === 0) {
                // Rising edge: write first, then read
                if (this.masterWriteEnable && this.masterWriteAddr !== undefined &&
                    this.masterWriteData !== undefined) {
                    this.data[this.masterWriteAddr] = this.masterWriteData & ((1 << this.dataWidth) - 1)
                }
                const readAddr = this.masterAddr
                const val = readAddr !== undefined ? (this.data[readAddr] || 0) : undefined
                this._writeOutputs(val)
            }
            this.prevClkState = clkVal
        } else {
            // Async: write first, then read
            this._doWrite(addr)
            const val = addr !== undefined ? (this.data[addr] || 0) : undefined
            this._writeOutputs(val)
        }
    }

    customSave() {
        const base = super.customSave()
        base.constructorParamaters.push(this.isVolatile)
        base.nodes.dinNodes = this.dinNodes.map(findNode)
        base.nodes.weNode = findNode(this.weNode)
        return base
    }

    _subclassArgs() { return [this.isVolatile] }

    _drawExtraLabels(ctx, s, ox, oy, xx, yy) {
        const fontSize = Math.round(7 * s)
        ctx.font = `${fontSize}px sans-serif`
        ctx.fillStyle = colors['text']
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'

        const boxLeft = (xx - this.halfW) * s + ox

        // DIN labels
        for (const node of this.dinNodes) {
            if (node.disabled) continue
            ctx.fillText(node.label,
                boxLeft + 3 * s,
                (yy + node.lefty) * s + oy
            )
        }

        // WE label
        ctx.fillText('WE',
            boxLeft + 3 * s,
            (yy + this.weNode.lefty) * s + oy
        )
    }
}

HmRAM.prototype.objectType = 'HmRAM'
HmRAM.prototype.tooltipText = 'RAM (HM): Read/write memory with configurable address/data width'
HmRAM.prototype.constructorParametersDefault = [2, 4, null, false, false, false, 'high', 'pushpull', false]

HmRAM.prototype.mutableProperties = {
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
    isVolatile: {
        name: 'Volatile',
        type: 'checkbox',
        func: 'setIsVolatile',
    },
}

HmRAM.prototype.setIsVolatile = function (val) {
    const active = (val === true || val === 'true')
    if (this.isVolatile === active) return
    this.isVolatile = active
    scheduleUpdate()
}
