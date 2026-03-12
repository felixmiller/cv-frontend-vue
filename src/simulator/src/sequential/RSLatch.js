import CircuitElement from '../circuitElement'
import Node, { findNode } from '../node'
import { simulationArea } from '../simulationArea'
import { correctWidth, lineTo, moveTo, fillText3, drawCircle2 } from '../canvasApi'
import { colors } from '../themer/themer'
import { scheduleUpdate } from '../engine'

/**
 * @class
 * RSLatch
 * Configurable gated RS latch with labeled ports (74-series style).
 * S=R=1 while gate active produces undefined output (forbidden state).
 * Optional EN (output enable) independently gates the outputs.
 * @extends CircuitElement
 * @category sequential
 */
export default class RSLatch extends CircuitElement {
    constructor(
        x, y, scope = globalScope, dir = 'RIGHT', bitWidth = 1,
        hasPreset = false, hasClear = false,
        resetPolarity = 'high', gatePolarity = 'high',
        hasEnable = false, enablePolarity = 'high', outputType = 'pushpull',
        hasClock = true
    ) {
        super(x, y, scope, dir, 1)
        this.directionFixed = true
        this.fixedBitWidth = true
        this.rectangleObject = false
        this.setDimensions(30, hasEnable ? 60 : 40)

        this.hasPreset = hasPreset
        this.hasClear = hasClear
        this.resetPolarity = resetPolarity
        this.gatePolarity = gatePolarity
        this.hasClock = hasClock
        this.hasEnable = hasEnable
        this.enablePolarity = enablePolarity
        this.outputType = outputType

        this.sInp = new Node(-30, -20, 0, this, 1, 'S')
        this.gInp = new Node(this._gNodeX(), 0, 0, this, 1, 'C')
        if (!this.hasClock) {
            this.nodeList.splice(this.nodeList.indexOf(this.gInp), 1)
            this.gInp.disabled = true
        }
        this.rInp = new Node(-30,  20, 0, this, 1, 'R')

        this.qOutput  = new Node(40, -20, 1, this, 1, 'Q')
        this.qnOutput = new Node(40,  20, 1, this, 1, 'Qn')

        this.enNode = new Node(this._enNodeX(), 40, 0, this, 1, 'Enable')
        if (!this.hasEnable) {
            this.nodeList.splice(this.nodeList.indexOf(this.enNode), 1)
            this.enNode.disabled = true
        }

        this.preNode = new Node(0, this._preNodeY(), 0, this, 1, 'Preset')
        if (!this.hasPreset) {
            this.nodeList.splice(this.nodeList.indexOf(this.preNode), 1)
            this.preNode.disabled = true
        }

        this.clrNode = new Node(0, this._clrNodeY(), 0, this, 1, 'Clear')
        if (!this.hasClear) {
            this.nodeList.splice(this.nodeList.indexOf(this.clrNode), 1)
            this.clrNode.disabled = true
        }

        this.state = 0
    }

    _moveNode(node, lx, ly) {
        node.leftx = lx
        node.lefty = ly
        node.updateRotation()
    }

    _gNodeX()         { return this.gatePolarity === 'low' ? -40 : -30 }
    _enNodeX()        { return this.enablePolarity === 'low' ? -40 : -30 }
    _preNodeY()       { return this.resetPolarity === 'low' ? -50 : -40 }
    _clrNodeBaseY()   { return this.hasEnable ? 60 : 40 }
    _clrNodeY()       { const b = this._clrNodeBaseY(); return this.resetPolarity === 'low' ? b + 10 : b }

    setHasPreset(val) {
        const active = (val === true || val === 'true')
        if (this.hasPreset === active) return
        this.hasPreset = active
        this.preNode.disabled = !active
        if (active && !this.nodeList.includes(this.preNode)) {
            this._moveNode(this.preNode, 0, this._preNodeY())
            this.nodeList.push(this.preNode)
        }
        if (!active) { const i = this.nodeList.indexOf(this.preNode); if (i !== -1) this.nodeList.splice(i, 1) }
        scheduleUpdate()
    }

    setHasClear(val) {
        const active = (val === true || val === 'true')
        if (this.hasClear === active) return
        this.hasClear = active
        this.clrNode.disabled = !active
        if (active && !this.nodeList.includes(this.clrNode)) {
            this._moveNode(this.clrNode, 0, this._clrNodeY())
            this.nodeList.push(this.clrNode)
        }
        if (!active) { const i = this.nodeList.indexOf(this.clrNode); if (i !== -1) this.nodeList.splice(i, 1) }
        scheduleUpdate()
    }

    setResetPolarity(val) {
        if (this.resetPolarity === val) return
        this.resetPolarity = val
        if (this.hasPreset) this._moveNode(this.preNode, 0, this._preNodeY())
        if (this.hasClear)  this._moveNode(this.clrNode, 0, this._clrNodeY())
        scheduleUpdate()
    }

    setGatePolarity(val) {
        if (this.gatePolarity === val) return
        this.gatePolarity = val
        if (this.hasClock) this._moveNode(this.gInp, this._gNodeX(), this.gInp.lefty)
        scheduleUpdate()
    }

    setHasClock(val) {
        const active = (val === true || val === 'true')
        if (this.hasClock === active) return
        this.hasClock = active
        this.gInp.disabled = !active
        if (active && !this.nodeList.includes(this.gInp)) {
            this._moveNode(this.gInp, this._gNodeX(), 0)
            this.nodeList.push(this.gInp)
        }
        if (!active) { const i = this.nodeList.indexOf(this.gInp); if (i !== -1) this.nodeList.splice(i, 1) }
        scheduleUpdate()
    }

    setHasEnable(val) {
        const active = (val === true || val === 'true')
        if (this.hasEnable === active) return
        this.hasEnable = active
        if (!active && this.outputType === 'tristate') this.outputType = 'pushpull'
        this.setDimensions(30, active ? 60 : 40)
        this._moveNode(this.clrNode, 0, this._clrNodeY())
        this.enNode.disabled = !active
        if (active && !this.nodeList.includes(this.enNode)) this.nodeList.push(this.enNode)
        if (!active) { const i = this.nodeList.indexOf(this.enNode); if (i !== -1) this.nodeList.splice(i, 1) }
        scheduleUpdate()
    }

    setEnablePolarity(val) {
        if (this.enablePolarity === val) return
        this.enablePolarity = val
        if (this.hasEnable) this._moveNode(this.enNode, this._enNodeX(), this.enNode.lefty)
        scheduleUpdate()
    }

    setOutputType(val) { if (this.outputType !== val) { this.outputType = val; scheduleUpdate() } }

    isResolvable() { return true }

    _isGateActive() {
        if (!this.hasClock) return true
        return this.gatePolarity === 'high' ? this.gInp.value === 1 : this.gInp.value === 0
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
        const enabled = this._isEnabled()
        let qVal, qnVal
        if (!enabled && this.outputType === 'tristate') {
            qVal = undefined; qnVal = undefined
        } else if (!enabled) {
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
        if (this.hasClear && this._isResetAsserted(this.clrNode)) {
            this.state = 0; this._commitOutputs(); return
        }
        if (this.hasPreset && this._isResetAsserted(this.preNode)) {
            this.state = 1; this._commitOutputs(); return
        }

        if (this._isGateActive()) {
            const s = this.sInp.value
            const r = this.rInp.value
            if (s === 1 && r === 1) {
                this.state = undefined
            } else if (s === 1) {
                this.state = 1
            } else if (r === 1) {
                this.state = 0
            }
            // s=r=0: hold
        }
        this._commitOutputs()
    }

    customSave() {
        return {
            nodes: {
                sInp:     findNode(this.sInp),
                gInp:     findNode(this.gInp),
                rInp:     findNode(this.rInp),
                qOutput:  findNode(this.qOutput),
                qnOutput: findNode(this.qnOutput),
                enNode:   findNode(this.enNode),
                preNode:  findNode(this.preNode),
                clrNode:  findNode(this.clrNode),
            },
            constructorParamaters: [
                this.direction, this.bitWidth,
                this.hasPreset, this.hasClear,
                this.resetPolarity, this.gatePolarity,
                this.hasEnable, this.enablePolarity, this.outputType,
                this.hasClock,
            ],
        }
    }

    customDraw() {
        const ctx = simulationArea.context
        const xx = this.x; const yy = this.y
        const boxBottom = this.hasEnable ? 60 : 40

        // Symmetric box: top at -40, bottom at boxBottom
        ctx.strokeStyle = colors['stroke']
        ctx.fillStyle = (
            (this.hover && !simulationArea.shiftDown) ||
            simulationArea.lastSelected === this ||
            simulationArea.multipleObjectSelections.includes(this)
        ) ? colors['hover_select'] : colors['fill']
        ctx.lineWidth = correctWidth(3)
        ctx.beginPath()
        moveTo(ctx, -30, -40, xx, yy, this.direction)
        lineTo(ctx,  30, -40, xx, yy, this.direction)
        lineTo(ctx,  30, boxBottom, xx, yy, this.direction)
        lineTo(ctx, -30, boxBottom, xx, yy, this.direction)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1.5)
        ctx.fillStyle = 'black'
        ctx.textBaseline = 'middle'

        fillText3(ctx, 'S', -25, -20, xx, yy, 14, 'Raleway', 'left')
        fillText3(ctx, 'R', -25,  20, xx, yy, 14, 'Raleway', 'left')

        if (this.hasClock) {
            fillText3(ctx, 'C', -25,   0, xx, yy, 14, 'Raleway', 'left')
            if (this.gatePolarity === 'low') {
                ctx.lineWidth = correctWidth(3); ctx.lineCap = 'round'
                ctx.beginPath(); drawCircle2(ctx, -35, 0, 4, xx, yy, this.direction); ctx.stroke()
                ctx.lineWidth = correctWidth(1.5)
            }
        }

        // Q stub (no bubble) + Qn bubble
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
            _drawTristateSymbol(ctx, 22,  20, xx, yy, this.direction)
        }

        // Output port labels
        ctx.textBaseline = 'bottom'
        fillText3(ctx, 'Q', 36, -21.5, xx, yy, 10)
        fillText3(ctx, 'Q', 36,  15.5, xx, yy, 10)
        ctx.strokeStyle = 'black'
        ctx.lineWidth = correctWidth(1)
        ctx.beginPath()
        moveTo(ctx, 33.5, 4.5, xx, yy, this.direction)
        lineTo(ctx, 39.0, 4.5, xx, yy, this.direction)
        ctx.stroke()
        ctx.strokeStyle = colors['stroke']
        ctx.textBaseline = 'middle'

        // EN
        if (this.hasEnable) {
            const enY = this.enNode.lefty
            fillText3(ctx, 'EN', -25, enY, xx, yy, 14, 'Raleway', 'left')
            if (this.enablePolarity === 'low') {
                ctx.lineWidth = correctWidth(3); ctx.lineCap = 'round'
                ctx.beginPath(); drawCircle2(ctx, -35, enY, 4, xx, yy, this.direction); ctx.stroke()
                ctx.lineWidth = correctWidth(1.5)
            }
        }

        // Preset / Clear
        const boxTop = 40
        if (this.hasPreset) {
            ctx.textBaseline = 'top'
            fillText3(ctx, 'PRE', 0, -(boxTop - 3), xx, yy, 12)
            ctx.textBaseline = 'alphabetic'
            if (this.resetPolarity === 'low') {
                ctx.lineWidth = correctWidth(3); ctx.lineCap = 'round'
                ctx.beginPath(); drawCircle2(ctx, 0, -(boxTop + 5), 4, xx, yy, this.direction); ctx.stroke()
                ctx.lineWidth = correctWidth(1.5)
            }
        }
        if (this.hasClear) {
            const hh = this.downDimensionY
            ctx.textBaseline = 'bottom'
            fillText3(ctx, 'CLR', 0, hh - 3, xx, yy, 12)
            ctx.textBaseline = 'alphabetic'
            if (this.resetPolarity === 'low') {
                ctx.lineWidth = correctWidth(3); ctx.lineCap = 'round'
                ctx.beginPath(); drawCircle2(ctx, 0, hh + 5, 4, xx, yy, this.direction); ctx.stroke()
                ctx.lineWidth = correctWidth(1.5)
            }
        }

        // State display
        const stateStr = this.state === undefined ? '?' : this.state.toString(16)
        ctx.fillStyle = colors['input_text']
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        ctx.font = `bold ${26 * globalScope.scale}px Raleway`
        ctx.fillText(stateStr,
            (xx + 8) * globalScope.scale + globalScope.ox,
            (yy + (boxBottom - 40) / 2) * globalScope.scale + globalScope.oy)
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

RSLatch.prototype.tooltipText = 'RS Latch: S=R=1 is forbidden (outputs undefined)'
RSLatch.prototype.objectType = 'RSLatch'
RSLatch.prototype.helplink = 'https://docs.circuitverse.org/chapter4/chapter4-sequentialelements/#sr-flip-flop'

RSLatch.prototype.mutableProperties = {
    hasPreset: {
        name: 'Preset',
        type: 'checkbox',
        func: 'setHasPreset',
        sameRow: true,
    },
    hasClear: {
        name: 'Clear',
        type: 'checkbox',
        func: 'setHasClear',
        sameRow: true,
    },
    resetPolarity: {
        name: 'Reset Polarity',
        type: 'select',
        options: ['low', 'high'],
        func: 'setResetPolarity',
    },
    hasClock: {
        name: 'Control Input',
        type: 'checkbox',
        func: 'setHasClock',
    },
    gatePolarity: {
        name: 'Control Polarity',
        type: 'select',
        options: ['high', 'low'],
        func: 'setGatePolarity',
        condition: 'hasClock',
        conditionValues: [true],
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
