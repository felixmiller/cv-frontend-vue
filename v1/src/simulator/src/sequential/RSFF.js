import CircuitElement from '../circuitElement'
import Node, { findNode } from '../node'
import { simulationArea } from '../simulationArea'
import { correctWidth, lineTo, moveTo, fillText3, drawCircle2 } from '../canvasApi'
import { colors } from '../themer/themer'
import { scheduleUpdate } from '../engine'

/**
 * @class
 * RSFF
 * Configurable clocked RS flip flop with labeled ports (74-series style).
 * S=R=1 produces undefined output (forbidden state).
 * @extends CircuitElement
 * @category sequential
 */
export default class RSFF extends CircuitElement {
    constructor(
        x, y, scope = globalScope, dir = 'RIGHT', bitWidth = 1,
        hasPreset = false, hasClear = false, resetType = 'none',
        resetPolarity = 'high', clockPolarity = 'pos',
        hasEnable = false, enablePolarity = 'high', outputType = 'pushpull'
    ) {
        super(x, y, scope, dir, 1)
        this.directionFixed = true
        this.fixedBitWidth = true
        const hh = hasEnable ? 60 : 40
        this.setDimensions(30, hh)
        this.rectangleObject = false

        this.hasPreset = hasPreset
        this.hasClear = hasClear
        this.resetType = resetType
        this.resetPolarity = resetPolarity
        this.clockPolarity = clockPolarity
        this.hasEnable = hasEnable
        this.enablePolarity = enablePolarity
        this.outputType = outputType

        this.sInp = new Node(-30, -20, 0, this, 1, 'S')
        this.clkInp = new Node(clockPolarity === 'neg' ? -40 : -30, 0, 0, this, 1, 'Clock')
        this.rInp = new Node(-30, 20, 0, this, 1, 'R')
        this.qOutput = new Node(40, -20, 1, this, 1, 'Q')
        this.qnOutput = new Node(40, 20, 1, this, 1, 'Qn')

        // EN on left edge, 2 grids from bottom when active
        this.enNode = new Node(this._enNodeX(), 40, 0, this, 1, 'Enable')
        if (!this.hasEnable) {
            this.nodeList.splice(this.nodeList.indexOf(this.enNode), 1)
            this.enNode.disabled = true
        }

        this.preNode = new Node(0, this._preNodeY(), 0, this, 1,
            this.resetType === 'sync' ? 'Set' : 'Preset')
        if (!this.hasPreset || this.resetType === 'none') {
            this.nodeList.splice(this.nodeList.indexOf(this.preNode), 1)
            this.preNode.disabled = true
        }

        this.clrNode = new Node(0, this._clrNodeY(), 0, this, 1,
            this.resetType === 'sync' ? 'Reset' : 'Clear')
        if (!this.hasClear || this.resetType === 'none') {
            this.nodeList.splice(this.nodeList.indexOf(this.clrNode), 1)
            this.clrNode.disabled = true
        }

        this.state = 0
        this.masterState = 0
        this.prevClkState = 0
    }

    _moveNode(node, lx, ly) {
        node.leftx = lx
        node.lefty = ly
        node.updateRotation()
    }

    _preNodeY() { return this.resetPolarity === 'low' ? -50 : -40 }
    _clrNodeBaseY() { return this.hasEnable ? 60 : 40 }
    _clrNodeY() { const b = this._clrNodeBaseY(); return this.resetPolarity === 'low' ? b + 10 : b }
    _enNodeX() { return this.enablePolarity === 'low' ? -40 : -30 }

    get preset_async() { return this.hasPreset }
    get preset_sync() { return this.hasPreset }
    get clear_async() { return this.hasClear }
    get clear_sync() { return this.hasClear }

    setHasPreset(val) {
        const active = (val === true || val === 'true')
        if (this.hasPreset === active) return
        this.hasPreset = active
        this.preNode.label = this.resetType === 'sync' ? 'Set' : 'Preset'
        const shouldBeActive = active && this.resetType !== 'none'
        this.preNode.disabled = !shouldBeActive
        if (shouldBeActive && !this.nodeList.includes(this.preNode)) {
            this._moveNode(this.preNode, 0, this._preNodeY())
            this.nodeList.push(this.preNode)
        }
        if (!shouldBeActive) { const i = this.nodeList.indexOf(this.preNode); if (i !== -1) this.nodeList.splice(i, 1) }
        scheduleUpdate()
    }

    setHasClear(val) {
        const active = (val === true || val === 'true')
        if (this.hasClear === active) return
        this.hasClear = active
        this.clrNode.label = this.resetType === 'sync' ? 'Reset' : 'Clear'
        const shouldBeActive = active && this.resetType !== 'none'
        this.clrNode.disabled = !shouldBeActive
        if (shouldBeActive && !this.nodeList.includes(this.clrNode)) {
            this._moveNode(this.clrNode, 0, this._clrNodeY())
            this.nodeList.push(this.clrNode)
        }
        if (!shouldBeActive) { const i = this.nodeList.indexOf(this.clrNode); if (i !== -1) this.nodeList.splice(i, 1) }
        scheduleUpdate()
    }

    setResetType(val) {
        if (this.resetType === val) return
        const wasNone = this.resetType === 'none'
        this.resetType = val
        this.preNode.label = val === 'sync' ? 'Set' : 'Preset'
        this.clrNode.label = val === 'sync' ? 'Reset' : 'Clear'
        if (wasNone && val !== 'none') this.hasClear = true
        const preActive = this.hasPreset && val !== 'none'
        this.preNode.disabled = !preActive
        if (preActive && !this.nodeList.includes(this.preNode)) {
            this._moveNode(this.preNode, 0, this._preNodeY())
            this.nodeList.push(this.preNode)
        }
        if (!preActive) { const i = this.nodeList.indexOf(this.preNode); if (i !== -1) this.nodeList.splice(i, 1) }
        const clrActive = this.hasClear && val !== 'none'
        this.clrNode.disabled = !clrActive
        if (clrActive && !this.nodeList.includes(this.clrNode)) {
            this._moveNode(this.clrNode, 0, this._clrNodeY())
            this.nodeList.push(this.clrNode)
        }
        if (!clrActive) { const i = this.nodeList.indexOf(this.clrNode); if (i !== -1) this.nodeList.splice(i, 1) }
        scheduleUpdate()
    }

    setResetPolarity(val) {
        if (this.resetPolarity === val) return
        this.resetPolarity = val
        if (this.hasPreset && this.resetType !== 'none') this._moveNode(this.preNode, 0, this._preNodeY())
        if (this.hasClear && this.resetType !== 'none') this._moveNode(this.clrNode, 0, this._clrNodeY())
        scheduleUpdate()
    }

    setClockPolarity(val) {
        if (this.clockPolarity === val) return
        this.clockPolarity = val
        const clkX = val === 'neg' ? -40 : -30
        this._moveNode(this.clkInp, clkX, this.clkInp.lefty)
        scheduleUpdate()
    }

    setEnablePolarity(val) {
        if (this.enablePolarity !== val) {
            this.enablePolarity = val
            if (this.hasEnable) this._moveNode(this.enNode, this._enNodeX(), this.enNode.lefty)
            scheduleUpdate()
        }
    }

    setOutputType(val) { if (this.outputType !== val) { this.outputType = val; scheduleUpdate() } }

    setHasEnable(val) {
        const active = (val === true || val === 'true')
        if (this.hasEnable === active) return
        this.hasEnable = active
        if (!active && this.outputType === 'tristate') this.outputType = 'pushpull'
        const hh = active ? 60 : 40
        this.setDimensions(30, hh)
        this._moveNode(this.clrNode, 0, this._clrNodeY())
        this.enNode.disabled = !active
        if (active && !this.nodeList.includes(this.enNode)) this.nodeList.push(this.enNode)
        if (!active) { const i = this.nodeList.indexOf(this.enNode); if (i !== -1) this.nodeList.splice(i, 1) }
        scheduleUpdate()
    }

    isResolvable() { return true }

    _isEnabled() {
        if (!this.hasEnable) return true
        if (this.enNode.connections.length === 0) return true
        return this.enablePolarity === 'high' ? this.enNode.value === 1 : this.enNode.value === 0
    }

    _isResetAsserted(node) {
        if (node.connections.length === 0) return false
        return this.resetPolarity === 'high' ? node.value === 1 : node.value === 0
    }

    _commitOutputs() {
        const en = this._isEnabled()
        let qVal, qnVal
        if (!en && this.outputType === 'tristate') {
            qVal = undefined; qnVal = undefined
        } else if (!en && this.outputType === 'pushpull') {
            qVal = 0; qnVal = 0
        } else {
            qVal = this.state
            qnVal = this.state === undefined ? undefined : (this.state ^ 1)
        }
        if (this.qOutput.value !== qVal || this.qnOutput.value !== qnVal) {
            this.qOutput.value = qVal
            this.qnOutput.value = qnVal
            simulationArea.simulationQueue.add(this.qOutput)
            simulationArea.simulationQueue.add(this.qnOutput)
        }
    }

    resolve() {
        if (this.clkInp.value === undefined) { this.prevClkState = undefined; return }
        const activeEdge = this.clockPolarity === 'pos' ? 1 : 0

        // Async preset/clear override everything
        if (this.hasClear && this.resetType === 'async' && this._isResetAsserted(this.clrNode)) {
            this.masterState = this.state = 0
            this._commitOutputs(); this.prevClkState = this.clkInp.value; return
        }
        if (this.hasPreset && this.resetType === 'async' && this._isResetAsserted(this.preNode)) {
            this.masterState = this.state = 1
            this._commitOutputs(); this.prevClkState = this.clkInp.value; return
        }

        // Master-slave: sample S/R into masterState while clock is inactive,
        // transfer masterState → state on the active edge.
        if (this.clkInp.value !== activeEdge) {
            if (this._isEnabled()) {
                const s = this.sInp.value
                const r = this.rInp.value
                if (s === 1 && r === 1) {
                    this.masterState = undefined
                } else if (s === 1) {
                    this.masterState = 1
                } else if (r === 1) {
                    this.masterState = 0
                } else {
                    this.masterState = this.state
                }
            }
        } else if (this.prevClkState !== activeEdge) {
            // Active edge — transfer master to slave
            if (this._isEnabled()) {
                if (this.hasClear && this.resetType === 'sync' && this._isResetAsserted(this.clrNode)) {
                    this.state = 0
                } else if (this.hasPreset && this.resetType === 'sync' && this._isResetAsserted(this.preNode)) {
                    this.state = 1
                } else {
                    this.state = this.masterState
                }
            }
        }
        this._commitOutputs()
        this.prevClkState = this.clkInp.value
    }

    customSave() {
        return {
            nodes: {
                sInp: findNode(this.sInp),
                clkInp: findNode(this.clkInp),
                rInp: findNode(this.rInp),
                qOutput: findNode(this.qOutput),
                qnOutput: findNode(this.qnOutput),
                enNode: findNode(this.enNode),
                preNode: findNode(this.preNode),
                clrNode: findNode(this.clrNode),
            },
            constructorParamaters: [
                this.direction, this.bitWidth,
                this.hasPreset, this.hasClear, this.resetType, this.resetPolarity,
                this.clockPolarity, this.hasEnable, this.enablePolarity, this.outputType,
            ],
        }
    }

    customDraw() {
        const ctx = simulationArea.context
        const xx = this.x; const yy = this.y

        // Asymmetric box: top always at -40, bottom extends to +60 when EN active
        const boxBottom = this.hasEnable ? 60 : 40
        ctx.strokeStyle = colors['stroke']
        ctx.fillStyle = (
            (this.hover && !simulationArea.shiftDown) ||
            simulationArea.lastSelected === this ||
            simulationArea.multipleObjectSelections.includes(this)
        ) ? colors['hover_select'] : colors['fill']
        ctx.lineWidth = correctWidth(3)
        ctx.beginPath()
        moveTo(ctx, -30, -40, xx, yy, this.direction)
        lineTo(ctx, 30, -40, xx, yy, this.direction)
        lineTo(ctx, 30, boxBottom, xx, yy, this.direction)
        lineTo(ctx, -30, boxBottom, xx, yy, this.direction)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1.5)
        ctx.fillStyle = 'black'

        const clkY = this.clkInp.lefty
        if (this.clockPolarity === 'neg') {
            ctx.lineWidth = correctWidth(3)
            ctx.lineCap = 'round'
            ctx.beginPath()
            drawCircle2(ctx, -35, clkY, 4, xx, yy, this.direction)
            ctx.stroke()
            ctx.lineWidth = correctWidth(1.5)
        }
        ctx.lineWidth = correctWidth(1.5)
        ctx.beginPath()
        moveTo(ctx, -30, clkY - 5, xx, yy, this.direction)
        lineTo(ctx, -22, clkY, xx, yy, this.direction)
        lineTo(ctx, -30, clkY + 5, xx, yy, this.direction)
        ctx.stroke()

        ctx.textBaseline = 'middle'
        fillText3(ctx, 'C', -19, clkY, xx, yy, 14, 'Raleway', 'left')
        fillText3(ctx, 'S', -25, -20, xx, yy, 14, 'Raleway', 'left')
        fillText3(ctx, 'R', -25, 20, xx, yy, 14, 'Raleway', 'left')

        // Q stub + Qn bubble use wire thickness
        ctx.lineWidth = correctWidth(3)
        ctx.lineCap = 'round'

        ctx.beginPath()
        moveTo(ctx, 30, -20, xx, yy, this.direction)
        lineTo(ctx, 40, -20, xx, yy, this.direction)
        ctx.stroke()

        ctx.beginPath()
        drawCircle2(ctx, 35, 20, 4, xx, yy, this.direction)
        ctx.stroke()

        ctx.lineWidth = correctWidth(1.5)

        if (this.outputType === 'tristate') {
            _drawTristateSymbol(ctx, 22, -20, xx, yy, this.direction)
            _drawTristateSymbol(ctx, 22, 20, xx, yy, this.direction)
        }

        // Output port labels
        ctx.textBaseline = 'bottom'
        fillText3(ctx, 'Q', 36, -21.5, xx, yy, 10)
        fillText3(ctx, 'Q', 36, 15.5, xx, yy, 10)
        // Manual overbar for Qn label (combining char unreliable in canvas)
        ctx.strokeStyle = 'black'
        ctx.lineWidth = correctWidth(1)
        ctx.beginPath()
        moveTo(ctx, 33.5, 4.5, xx, yy, this.direction)
        lineTo(ctx, 39.0, 4.5, xx, yy, this.direction)
        ctx.stroke()
        ctx.strokeStyle = colors['stroke']
        ctx.textBaseline = 'middle'

        if (this.hasEnable) {
            const enY = this.enNode.lefty
            ctx.textAlign = 'left'
            fillText3(ctx, 'EN', -25, enY, xx, yy, 14, 'Raleway', 'left')
            if (this.enablePolarity === 'low') {
                ctx.lineWidth = correctWidth(3); ctx.lineCap = 'round'
                ctx.beginPath(); drawCircle2(ctx, -35, enY, 4, xx, yy, this.direction); ctx.stroke()
                ctx.lineWidth = correctWidth(1.5)
            }
        }

        ctx.textBaseline = 'alphabetic'
        const hh = this.downDimensionY  // matches box bottom (40 or 60)
        const boxTop = 40               // top edge is always fixed
        if (this.hasPreset && this.resetType !== 'none') {
            ctx.textBaseline = 'top'
            fillText3(ctx, this.resetType === 'sync' ? 'SET' : 'PRE', 0, -(boxTop - 3), xx, yy, 12)
            ctx.textBaseline = 'alphabetic'
            if (this.resetPolarity === 'low') {
                ctx.lineWidth = correctWidth(3); ctx.lineCap = 'round'
                ctx.beginPath(); drawCircle2(ctx, 0, -(boxTop + 5), 4, xx, yy, this.direction); ctx.stroke()
                ctx.lineWidth = correctWidth(1.5)
            }
        }

        if (this.hasClear && this.resetType !== 'none') {
            ctx.textBaseline = 'bottom'
            fillText3(ctx, this.resetType === 'sync' ? 'RST' : 'CLR', 0, hh - 3, xx, yy, 12)
            ctx.textBaseline = 'alphabetic'
            if (this.resetPolarity === 'low') {
                ctx.lineWidth = correctWidth(3); ctx.lineCap = 'round'
                ctx.beginPath(); drawCircle2(ctx, 0, hh + 5, 4, xx, yy, this.direction); ctx.stroke()
                ctx.lineWidth = correctWidth(1.5)
            }
        }

        const stateStr = this.state === undefined ? '?' : this.state.toString(16)
        ctx.fillStyle = colors['input_text']
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        ctx.font = `bold ${26 * globalScope.scale}px Raleway`
        ctx.fillText(stateStr,
            (xx + 10) * globalScope.scale + globalScope.ox,
            (yy + (hh - boxTop) / 2) * globalScope.scale + globalScope.oy)
        ctx.textBaseline = 'alphabetic'
    }
}

function _drawTristateSymbol(ctx, x, y, xx, yy, dir) {
    ctx.beginPath()
    moveTo(ctx, x - 3.5, y - 3.5, xx, yy, dir)
    lineTo(ctx, x + 3.5, y - 3.5, xx, yy, dir)
    lineTo(ctx, x, y + 3.5, xx, yy, dir)
    ctx.closePath()
    ctx.stroke()
}

RSFF.prototype.tooltipText = 'RS Flip Flop: S=R=1 is forbidden (outputs undefined)'
RSFF.prototype.objectType = 'RSFF'
RSFF.prototype.helplink = 'https://docs.circuitverse.org/chapter4/chapter4-sequentialelements/#sr-flip-flop'

RSFF.prototype.mutableProperties = {
    resetType: {
        name: 'Reset Type',
        type: 'select',
        options: ['none', 'async', 'sync'],
        func: 'setResetType',
    },
    preset_async: {
        name: 'Preset',
        type: 'checkbox',
        func: 'setHasPreset',
        condition: 'resetType',
        conditionValues: ['async'],
        sameRow: true,
    },
    preset_sync: {
        name: 'Set',
        type: 'checkbox',
        func: 'setHasPreset',
        condition: 'resetType',
        conditionValues: ['sync'],
        sameRow: true,
    },
    clear_async: {
        name: 'Clear',
        type: 'checkbox',
        func: 'setHasClear',
        condition: 'resetType',
        conditionValues: ['async'],
        sameRow: true,
    },
    clear_sync: {
        name: 'Reset',
        type: 'checkbox',
        func: 'setHasClear',
        condition: 'resetType',
        conditionValues: ['sync'],
        sameRow: true,
    },
    resetPolarity: {
        name: 'Reset Polarity',
        type: 'select',
        options: ['low', 'high'],
        func: 'setResetPolarity',
        condition: 'resetType',
        conditionValues: ['async', 'sync'],
    },
    clockPolarity: {
        name: 'Clock Edge',
        type: 'select',
        options: ['pos', 'neg'],
        func: 'setClockPolarity',
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
}
