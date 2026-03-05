import CircuitElement from '../circuitElement'
import Node, { findNode } from '../node'
import { simulationArea } from '../simulationArea'
import { correctWidth, lineTo, moveTo, fillText3, drawCircle2 } from '../canvasApi'
import { colors } from '../themer/themer'
import { scheduleUpdate } from '../engine'

/**
 * @class
 * DFF
 * Configurable D flip flop with labeled ports (74-series style).
 * Box resizes when Enable is toggled: compact (30×40) without EN, taller (30×60) with EN.
 * @extends CircuitElement
 * @category sequential
 */
export default class DFF extends CircuitElement {
    constructor(
        x, y, scope = globalScope, dir = 'RIGHT', bitWidth = 1,
        hasPreset = false, hasClear = false, resetType = 'none',
        resetPolarity = 'high', clockPolarity = 'pos',
        hasEnable = false, enablePolarity = 'high', outputType = 'pushpull'
    ) {
        super(x, y, scope, dir, bitWidth)
        this.directionFixed = true
        this.rectangleObject = false

        this.hasPreset = hasPreset
        this.hasClear = hasClear
        this.resetType = resetType
        this.resetPolarity = resetPolarity
        this.clockPolarity = clockPolarity
        this.hasEnable = hasEnable
        this.enablePolarity = enablePolarity
        this.outputType = outputType

        // D at (0,4), CLK at (0,2) from bottom-left in grids; EN extends box downward when active
        const hh = hasEnable ? 50 : 30
        this.setDimensions(30, hh)
        this.dInp = new Node(-30, -10, 0, this, this.bitWidth, 'D')
        this.clkInp = new Node(clockPolarity === 'neg' ? -40 : -30, 10, 0, this, 1, 'Clock')
        this.qOutput = new Node(40, -10, 1, this, this.bitWidth, 'Q')
        this.qnOutput = new Node(40, 10, 1, this, this.bitWidth, 'Qn')

        this.preNode = new Node(0, this._preNodeY(), 0, this, this.bitWidth,
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

        this.enNode = new Node(this._enNodeX(), 30, 0, this, 1, 'Enable')
        if (!this.hasEnable) {
            this.nodeList.splice(this.nodeList.indexOf(this.enNode), 1)
            this.enNode.disabled = true
        }

        this.state = 0
        this.prevClkState = 0
    }

    _moveNode(node, lx, ly) {
        node.leftx = lx
        node.lefty = ly
        node.updateRotation()
    }

    _preNodeY() { return this.resetPolarity === 'low' ? -40 : -30 }
    _clrNodeBaseY() { return this.hasEnable ? 50 : 30 }
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

    setHasEnable(val) {
        const active = (val === true || val === 'true')
        if (this.hasEnable === active) return
        this.hasEnable = active
        if (!active && this.outputType === 'tristate') this.outputType = 'pushpull'
        const hh = active ? 50 : 30
        this.setDimensions(30, hh)
        this._moveNode(this.clrNode, 0, this._clrNodeY())
        this.enNode.disabled = !active
        if (active && !this.nodeList.includes(this.enNode)) this.nodeList.push(this.enNode)
        if (!active) { const i = this.nodeList.indexOf(this.enNode); if (i !== -1) this.nodeList.splice(i, 1) }
        scheduleUpdate()
    }

    setEnablePolarity(val) {
        if (this.enablePolarity !== val) {
            this.enablePolarity = val
            if (this.hasEnable) this._moveNode(this.enNode, this._enNodeX(), this.enNode.lefty)
            scheduleUpdate()
        }
    }

    setOutputType(val) {
        if (this.outputType === val) return
        this.outputType = val
        scheduleUpdate()
    }

    // --- Logic ---

    isResolvable() { return true }

    newBitWidth(bitWidth) {
        this.bitWidth = bitWidth
        this.dInp.bitWidth = bitWidth
        this.qOutput.bitWidth = bitWidth
        this.qnOutput.bitWidth = bitWidth
        this.preNode.bitWidth = bitWidth
    }

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
            qVal = this.state; qnVal = this.flipBits(this.state)
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

        if (this.hasClear && this.resetType === 'async' && this._isResetAsserted(this.clrNode)) {
            this.state = 0; this._commitOutputs(); this.prevClkState = this.clkInp.value; return
        }
        if (this.hasPreset && this.resetType === 'async' && this._isResetAsserted(this.preNode)) {
            this.state = (1 << this.bitWidth) - 1; this._commitOutputs(); this.prevClkState = this.clkInp.value; return
        }

        if (this.clkInp.value === activeEdge && this.prevClkState !== activeEdge) {
            if (this._isEnabled()) {
                if (this.hasClear && this.resetType === 'sync' && this._isResetAsserted(this.clrNode)) {
                    this.state = 0
                } else if (this.hasPreset && this.resetType === 'sync' && this._isResetAsserted(this.preNode)) {
                    this.state = (1 << this.bitWidth) - 1
                } else if (this.dInp.value !== undefined) {
                    this.state = this.dInp.value
                }
            }
        }
        this._commitOutputs()
        this.prevClkState = this.clkInp.value
    }

    // --- Persistence ---

    customSave() {
        return {
            nodes: {
                dInp: findNode(this.dInp),
                clkInp: findNode(this.clkInp),
                qOutput: findNode(this.qOutput),
                qnOutput: findNode(this.qnOutput),
                preNode: findNode(this.preNode),
                clrNode: findNode(this.clrNode),
                enNode: findNode(this.enNode),
            },
            constructorParamaters: [
                this.direction, this.bitWidth,
                this.hasPreset, this.hasClear, this.resetType, this.resetPolarity,
                this.clockPolarity, this.hasEnable, this.enablePolarity, this.outputType,
            ],
        }
    }

    // --- Drawing ---

    customDraw() {
        const ctx = simulationArea.context
        const xx = this.x
        const yy = this.y
        const hh = this.downDimensionY  // matches box bottom (30 or 50)
        const boxTop = 30               // top edge is always fixed

        // Asymmetric box: top always at -30, bottom extends to +50 when EN active
        const boxBottom = this.hasEnable ? 50 : 30
        ctx.strokeStyle = colors['stroke']
        ctx.fillStyle = (
            (this.hover && !simulationArea.shiftDown) ||
            simulationArea.lastSelected === this ||
            simulationArea.multipleObjectSelections.includes(this)
        ) ? colors['hover_select'] : colors['fill']
        ctx.lineWidth = correctWidth(3)
        ctx.beginPath()
        moveTo(ctx, -30, -30, xx, yy, this.direction)
        lineTo(ctx, 30, -30, xx, yy, this.direction)
        lineTo(ctx, 30, boxBottom, xx, yy, this.direction)
        lineTo(ctx, -30, boxBottom, xx, yy, this.direction)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1.5)
        ctx.fillStyle = 'black'

        // Clock neg bubble (wire thickness, separate from triangle)
        const clkY = this.clkInp.lefty
        if (this.clockPolarity === 'neg') {
            ctx.lineWidth = correctWidth(3)
            ctx.lineCap = 'round'
            ctx.beginPath()
            drawCircle2(ctx, -35, clkY, 4, xx, yy, this.direction)
            ctx.stroke()
            ctx.lineWidth = correctWidth(1.5)
        }

        // Clock triangle
        ctx.lineWidth = correctWidth(1.5)
        ctx.beginPath()
        moveTo(ctx, -30, clkY - 5, xx, yy, this.direction)
        lineTo(ctx, -22, clkY, xx, yy, this.direction)
        lineTo(ctx, -30, clkY + 5, xx, yy, this.direction)
        ctx.stroke()

        // D input label at dInp y position
        ctx.textBaseline = 'middle'
        fillText3(ctx, 'C', -19, clkY, xx, yy, 14, 'Raleway', 'left')
        fillText3(ctx, 'D', -25, this.dInp.lefty, xx, yy, 14, 'Raleway', 'left')

        // Q stub + Qn bubble use wire thickness
        ctx.lineWidth = correctWidth(3)
        ctx.lineCap = 'round'

        ctx.beginPath()
        moveTo(ctx, 30, -10, xx, yy, this.direction)
        lineTo(ctx, 40, -10, xx, yy, this.direction)
        ctx.stroke()

        ctx.beginPath()
        drawCircle2(ctx, 35, 10, 4, xx, yy, this.direction)
        ctx.stroke()

        ctx.lineWidth = correctWidth(1.5)

        // Tristate triangles (inside box, not touching right edge)
        if (this.outputType === 'tristate') {
            _drawTristateSymbol(ctx, 22, -10, xx, yy, this.direction)
            _drawTristateSymbol(ctx, 22, 10, xx, yy, this.direction)
        }

        // Output port labels
        ctx.textBaseline = 'bottom'
        fillText3(ctx, 'Q', 36, -11.5, xx, yy, 10)
        fillText3(ctx, 'Q', 36, 5.5, xx, yy, 10)
        ctx.strokeStyle = 'black'
        ctx.lineWidth = correctWidth(1)
        ctx.beginPath()
        moveTo(ctx, 33.5, -5.5, xx, yy, this.direction)
        lineTo(ctx, 39.0, -5.5, xx, yy, this.direction)
        ctx.stroke()
        ctx.strokeStyle = colors['stroke']
        ctx.textBaseline = 'middle'

        if (this.hasEnable) {
            const enY = this.enNode.lefty
            fillText3(ctx, 'EN', -25, enY, xx, yy, 14, 'Raleway', 'left')
            if (this.enablePolarity === 'low') {
                ctx.lineWidth = correctWidth(3); ctx.lineCap = 'round'
                ctx.beginPath(); drawCircle2(ctx, -35, enY, 4, xx, yy, this.direction); ctx.stroke()
                ctx.lineWidth = correctWidth(1.5)
            }
        }

        ctx.textBaseline = 'alphabetic'
        // Preset (top edge)
        if (this.hasPreset && this.resetType !== 'none') {
            const label = this.resetType === 'sync' ? 'SET' : 'PRE'
            ctx.textBaseline = 'top'
            fillText3(ctx, label, 0, -(boxTop - 3), xx, yy, 12)
            ctx.textBaseline = 'alphabetic'
            if (this.resetPolarity === 'low') {
                ctx.lineWidth = correctWidth(3)
                ctx.lineCap = 'round'
                ctx.beginPath()
                drawCircle2(ctx, 0, -(boxTop + 5), 4, xx, yy, this.direction)
                ctx.stroke()
                ctx.lineWidth = correctWidth(1.5)
            }
        }

        // Clear (bottom edge)
        if (this.hasClear && this.resetType !== 'none') {
            const label = this.resetType === 'sync' ? 'RST' : 'CLR'
            ctx.textBaseline = 'bottom'
            fillText3(ctx, label, 0, hh - 3, xx, yy, 12)
            ctx.textBaseline = 'alphabetic'
            if (this.resetPolarity === 'low') {
                ctx.lineWidth = correctWidth(3)
                ctx.lineCap = 'round'
                ctx.beginPath()
                drawCircle2(ctx, 0, hh + 5, 4, xx, yy, this.direction)
                ctx.stroke()
                ctx.lineWidth = correctWidth(1.5)
            }
        }

        // State display
        ctx.fillStyle = colors['input_text']
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        ctx.font = `bold ${26 * globalScope.scale}px Raleway`
        ctx.fillText(this.state.toString(16),
            (xx + 10) * globalScope.scale + globalScope.ox,
            (yy + (hh - boxTop) / 2) * globalScope.scale + globalScope.oy)
        ctx.textBaseline = 'alphabetic'
    }
}

function _drawTristateSymbol(ctx, x, y, xx, yy, dir) {
    // Narrow downward-pointing triangle, vertically centered on port y
    ctx.beginPath()
    moveTo(ctx, x - 3, y - 3, xx, yy, dir)
    lineTo(ctx, x + 3, y - 3, xx, yy, dir)
    lineTo(ctx, x, y + 3, xx, yy, dir)
    ctx.closePath()
    ctx.stroke()
}

DFF.prototype.tooltipText = 'D Flip Flop: Configurable with labels, preset/clear, clock polarity, enable'
DFF.prototype.objectType = 'DFF'
DFF.prototype.helplink = 'https://docs.circuitverse.org/chapter4/chapter4-sequentialelements/#d-flip-flop'

DFF.prototype.mutableProperties = {
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
