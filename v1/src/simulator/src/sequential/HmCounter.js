import CircuitElement from '../circuitElement'
import Node, { findNode } from '../node'
import { simulationArea } from '../simulationArea'
import { correctWidth, lineTo, moveTo, fillText3, drawCircle2 } from '../canvasApi'
import { colors } from '../themer/themer'
import { scheduleUpdate } from '../engine'
import { syncOptionalPins, deleteHiddenPins } from './optionalPins'

const BOX_LEFT = -30
const BOX_TOP = -40 // one grid row above the first pin row holds the CTRn qualifier
const DISPLAY_FONT = 22
const DIGIT_WIDTH = 14 // estimated width of one display digit at DISPLAY_FONT

const RESET_TYPES = ['sync', 'async']
const LOW_HIGH = ['low', 'high']
const CLOCK_EDGES = ['pos', 'neg']
const DIRECTIONS = ['up', 'down', 'input']
const DISPLAY_FORMATS = ['hex', 'dec']

/**
 * @class
 * HmCounter
 * Synchronous binary counter (74-series style, behaves like 74x163/74x169).
 * Always present: CLK, count output Q (bus), reset RST (sync) or CLR (async).
 * Optional: parallel load (D bus + LD), direction input U/D (1 = up),
 * count enable EN (also gates TC), terminal count output TC.
 * Synchronous priority: RST > LD > EN and count. Unconnected control inputs are inactive,
 * unconnected EN counts as enabled.
 * The box keeps its top left corner, it grows downward with optional pins
 * and to the right with the number of display digits.
 * @extends CircuitElement
 * @category sequential
 */
export default class HmCounter extends CircuitElement {
    constructor(
        x, y, scope = globalScope, bitWidth = 4,
        resetType = 'sync', resetPolarity = 'high', clockPolarity = 'pos',
        countDirection = 'up', hasLoad = false, loadPolarity = 'high',
        hasEnable = false, enablePolarity = 'high', hasTC = false, displayFormat = 'hex'
    ) {
        super(x, y, scope, 'RIGHT', bitWidth)
        this.directionFixed = true
        this.rectangleObject = false

        this.resetType = resetType
        this.resetPolarity = resetPolarity
        this.clockPolarity = clockPolarity
        this.countDirection = countDirection
        this.hasLoad = hasLoad
        this.loadPolarity = loadPolarity
        this.hasEnable = hasEnable
        this.enablePolarity = enablePolarity
        this.hasTC = hasTC
        this.displayFormat = displayFormat

        // All pins always exist (stable save format), _updatePins() hides the inactive ones
        this.dInp = new Node(BOX_LEFT, -10, 0, this, this.bitWidth, 'D')
        this.ldInp = new Node(BOX_LEFT, 10, 0, this, 1, 'Load')
        this.udInp = new Node(BOX_LEFT, 30, 0, this, 1, 'Up/Down')
        this.enInp = new Node(BOX_LEFT, 50, 0, this, 1, 'Enable')
        this.clkInp = new Node(BOX_LEFT, 10, 0, this, 1, 'Clock')
        this.rstInp = new Node(0, 30, 0, this, 1, this._resetLabel())
        this.qOutput = new Node(40, -10, 1, this, this.bitWidth, 'Q')
        this.tcOutput = new Node(40, 10, 1, this, 1, 'TC')

        this.state = 0
        this.masterState = 0
        this.prevClkState = undefined

        this._updatePins()
    }

    // --- Geometry ---

    _resetLabel() { return this.resetType === 'sync' ? 'Reset' : 'Clear' }

    _optionalPins() { return [this.dInp, this.ldInp, this.udInp, this.enInp, this.tcOutput] }

    // Active left pins, top to bottom. CLK is always the lowest one.
    _leftPins() {
        const pins = []
        if (this.hasLoad) pins.push(this.dInp, this.ldInp)
        if (this.countDirection === 'input') pins.push(this.udInp)
        if (this.hasEnable) pins.push(this.enInp)
        pins.push(this.clkInp)
        return pins
    }

    _isLowActive(pin) {
        if (pin === this.clkInp) return this.clockPolarity === 'neg'
        if (pin === this.ldInp) return this.loadPolarity === 'low'
        if (pin === this.enInp) return this.enablePolarity === 'low'
        return false
    }

    _digits() {
        return this.displayFormat === 'dec'
            ? String(2 ** this.bitWidth - 1).length
            : Math.ceil(this.bitWidth / 4)
    }

    // Label columns inside the box, the display sits between them
    _leftCol() { return this.countDirection === 'input' ? 40 : 30 }
    _rightCol() { return this.hasTC ? 26 : 18 }

    // Multiple of 20 keeps the bottom centre (reset pin) on the grid
    _boxWidth() {
        const needed = this._leftCol() + 4 + this._digits() * DIGIT_WIDTH + 4 + this._rightCol()
        return Math.max(80, Math.ceil(needed / 20) * 20)
    }

    _moveNode(node, lx, ly) {
        node.leftx = lx
        node.lefty = ly
        node.updateRotation()
    }

    // Places all pins and sets the box size for the current configuration
    _updatePins() {
        const left = this._leftPins()
        const firstRow = left.length === 1 ? 1 : 0 // CLK alone sits next to TC, like the FF elements
        const right = BOX_LEFT + this._boxWidth()
        const bottom = Math.max(30, -10 + 20 * (firstRow + left.length - 1) + 20)

        const leftX = (pin) => (this._isLowActive(pin) ? BOX_LEFT - 10 : BOX_LEFT)
        const rowY = (pin) => -10 + 20 * (firstRow + left.indexOf(pin))

        // Hidden pins lose their wires and are parked off the grid (see optionalPins.js)
        syncOptionalPins(this, [
            ...[this.dInp, this.ldInp, this.udInp, this.enInp].map(
                (pin) => [pin, left.includes(pin), leftX(pin), rowY(pin)]
            ),
            [this.tcOutput, this.hasTC, right + 10, 10],
        ])
        this._moveNode(this.clkInp, leftX(this.clkInp), rowY(this.clkInp))
        this._moveNode(this.qOutput, right + 10, -10)
        const cx = (BOX_LEFT + right) / 2
        this._moveNode(this.rstInp, cx, this.resetPolarity === 'low' ? bottom + 10 : bottom)

        this.boxRight = right
        this.boxBottom = bottom
        this.leftDimensionX = -BOX_LEFT
        this.rightDimensionX = right
        this.upDimensionY = -BOX_TOP
        this.downDimensionY = bottom
    }

    // --- Property setters (also called repeatedly with the same value by the panel) ---

    _setOption(key, val, allowed) {
        if (!allowed.includes(val) || this[key] === val) return
        this[key] = val
        this._updatePins()
        scheduleUpdate()
    }

    setResetType(val) {
        this._setOption('resetType', val, RESET_TYPES)
        this.rstInp.label = this._resetLabel()
    }

    setResetPolarity(val) { this._setOption('resetPolarity', val, LOW_HIGH) }
    setClockPolarity(val) { this._setOption('clockPolarity', val, CLOCK_EDGES) }
    setCountDirection(val) { this._setOption('countDirection', val, DIRECTIONS) }
    setHasLoad(val) { this._setOption('hasLoad', val === true || val === 'true', [true, false]) }
    setLoadPolarity(val) { this._setOption('loadPolarity', val, LOW_HIGH) }
    setHasEnable(val) { this._setOption('hasEnable', val === true || val === 'true', [true, false]) }
    setEnablePolarity(val) { this._setOption('enablePolarity', val, LOW_HIGH) }
    setHasTC(val) { this._setOption('hasTC', val === true || val === 'true', [true, false]) }
    setDisplayFormat(val) { this._setOption('displayFormat', val, DISPLAY_FORMATS) }

    newBitWidth(bitWidth) {
        bitWidth = Math.floor(bitWidth)
        if (!(bitWidth >= 1 && bitWidth <= 32) || bitWidth === this.bitWidth) return
        this.bitWidth = bitWidth
        this.dInp.bitWidth = bitWidth
        this.qOutput.bitWidth = bitWidth
        this.state %= this._modulus()
        this.masterState %= this._modulus()
        this._updatePins()
        scheduleUpdate()
    }

    delete() {
        deleteHiddenPins(this, this._optionalPins())
        super.delete()
    }

    // --- Logic ---

    isResolvable() { return true }

    _modulus() { return 2 ** this.bitWidth }

    _connected(node) { return node.connections.length > 0 }

    // Unconnected control inputs are inactive, undefined values too
    _asserted(node, polarity) {
        if (!this._connected(node)) return false
        return node.value === (polarity === 'low' ? 0 : 1)
    }

    _isEnabled() {
        if (!this.hasEnable || !this._connected(this.enInp)) return true
        return this.enInp.value === (this.enablePolarity === 'low' ? 0 : 1)
    }

    // U/D: 1 = up, 0 = down, unconnected or undefined = up
    _countsUp() {
        if (this.countDirection !== 'input') return this.countDirection === 'up'
        return !this._connected(this.udInp) || this.udInp.value !== 0
    }

    // State after the next active clock edge, priority RST > LD > EN and count (74x163)
    _nextState() {
        const m = this._modulus()
        if (this.resetType === 'sync' && this._asserted(this.rstInp, this.resetPolarity)) return 0
        if (this.hasLoad && this._asserted(this.ldInp, this.loadPolarity)) {
            const d = this._connected(this.dInp) ? this.dInp.value : undefined
            return d === undefined ? 0 : ((d % m) + m) % m
        }
        if (!this._isEnabled()) return this.state
        return this._countsUp() ? (this.state + 1) % m : (this.state + m - 1) % m
    }

    // Combinational: max value counting up, 0 counting down, gated by EN
    _terminalCount() {
        if (!this._isEnabled()) return 0
        return this.state === (this._countsUp() ? this._modulus() - 1 : 0) ? 1 : 0
    }

    _setOutput(node, val) {
        if (node.value === val) return
        node.value = val
        simulationArea.simulationQueue.add(node)
    }

    resolve() {
        const clk = this.clkInp.value
        if (this.resetType === 'async' && this._asserted(this.rstInp, this.resetPolarity)) {
            this.state = this.masterState = 0
        } else if (clk !== undefined) {
            const activeLevel = this.clockPolarity === 'pos' ? 1 : 0
            // Master-slave: the master follows the next state while the clock is inactive and is
            // copied on the active edge. Inputs that change because of this edge (e.g. TC of a
            // cascaded counter on the same clock) therefore cannot affect this edge.
            if (clk !== activeLevel) {
                this.masterState = this._nextState()
            } else if (this.prevClkState === 1 - activeLevel) {
                this.state = this.masterState
            }
        }
        this.prevClkState = clk
        this._setOutput(this.qOutput, this.state)
        if (this.hasTC) this._setOutput(this.tcOutput, this._terminalCount())
    }

    // --- Persistence ---

    customSave() {
        return {
            nodes: {
                dInp: findNode(this.dInp),
                ldInp: findNode(this.ldInp),
                udInp: findNode(this.udInp),
                enInp: findNode(this.enInp),
                clkInp: findNode(this.clkInp),
                rstInp: findNode(this.rstInp),
                qOutput: findNode(this.qOutput),
                tcOutput: findNode(this.tcOutput),
            },
            constructorParamaters: [
                this.bitWidth,
                this.resetType, this.resetPolarity, this.clockPolarity,
                this.countDirection, this.hasLoad, this.loadPolarity,
                this.hasEnable, this.enablePolarity, this.hasTC, this.displayFormat,
            ],
        }
    }

    // --- Drawing ---

    _displayText() {
        if (this.displayFormat === 'dec') return String(this.state)
        return this.state.toString(16).toUpperCase().padStart(this._digits(), '0')
    }

    // Inversion bubble at wire thickness, like the FF elements
    _drawBubble(ctx, x, y) {
        ctx.lineWidth = correctWidth(3)
        ctx.lineCap = 'round'
        ctx.beginPath()
        drawCircle2(ctx, x, y, 4, this.x, this.y, this.direction)
        ctx.stroke()
        ctx.lineWidth = correctWidth(1.5)
    }

    _drawStub(ctx, x, y) {
        ctx.lineWidth = correctWidth(3)
        ctx.lineCap = 'round'
        ctx.beginPath()
        moveTo(ctx, x, y, this.x, this.y, this.direction)
        lineTo(ctx, x + 10, y, this.x, this.y, this.direction)
        ctx.stroke()
        ctx.lineWidth = correctWidth(1.5)
    }

    customDraw() {
        const ctx = simulationArea.context
        const xx = this.x
        const yy = this.y
        const dir = this.direction
        const right = this.boxRight
        const bottom = this.boxBottom

        ctx.strokeStyle = colors['stroke']
        ctx.fillStyle = (
            (this.hover && !simulationArea.shiftDown) ||
            simulationArea.lastSelected === this ||
            simulationArea.multipleObjectSelections.includes(this)
        ) ? colors['hover_select'] : colors['fill']
        ctx.lineWidth = correctWidth(3)
        ctx.beginPath()
        moveTo(ctx, BOX_LEFT, BOX_TOP, xx, yy, dir)
        lineTo(ctx, right, BOX_TOP, xx, yy, dir)
        lineTo(ctx, right, bottom, xx, yy, dir)
        lineTo(ctx, BOX_LEFT, bottom, xx, yy, dir)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1.5)
        ctx.fillStyle = 'black'
        ctx.textBaseline = 'middle'

        // Clock: optional neg bubble, triangle, label
        const clkY = this.clkInp.lefty
        if (this.clockPolarity === 'neg') this._drawBubble(ctx, BOX_LEFT - 5, clkY)
        ctx.beginPath()
        moveTo(ctx, BOX_LEFT, clkY - 5, xx, yy, dir)
        lineTo(ctx, BOX_LEFT + 8, clkY, xx, yy, dir)
        lineTo(ctx, BOX_LEFT, clkY + 5, xx, yy, dir)
        ctx.stroke()
        fillText3(ctx, 'C', BOX_LEFT + 11, clkY, xx, yy, 14, 'Raleway', 'left')

        if (this.hasLoad) {
            fillText3(ctx, 'D', BOX_LEFT + 5, this.dInp.lefty, xx, yy, 14, 'Raleway', 'left')
            fillText3(ctx, 'LD', BOX_LEFT + 5, this.ldInp.lefty, xx, yy, 14, 'Raleway', 'left')
            if (this.loadPolarity === 'low') this._drawBubble(ctx, BOX_LEFT - 5, this.ldInp.lefty)
        }
        if (this.countDirection === 'input') {
            // "U/D" with overbar on D: 1 = up, 0 = down
            const udY = this.udInp.lefty
            fillText3(ctx, 'U/D', BOX_LEFT + 5, udY, xx, yy, 14, 'Raleway', 'left')
            const scale = globalScope.scale
            const barStart = BOX_LEFT + 5 + ctx.measureText('U/').width / scale
            const barEnd = BOX_LEFT + 5 + ctx.measureText('U/D').width / scale
            ctx.lineWidth = correctWidth(1)
            ctx.strokeStyle = 'black'
            ctx.beginPath()
            moveTo(ctx, barStart, udY - 7, xx, yy, dir)
            lineTo(ctx, barEnd, udY - 7, xx, yy, dir)
            ctx.stroke()
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(1.5)
        }
        if (this.hasEnable) {
            fillText3(ctx, 'EN', BOX_LEFT + 5, this.enInp.lefty, xx, yy, 14, 'Raleway', 'left')
            if (this.enablePolarity === 'low') this._drawBubble(ctx, BOX_LEFT - 5, this.enInp.lefty)
        }

        // Outputs: stub to the node, label inside the box
        this._drawStub(ctx, right, -10)
        fillText3(ctx, 'Q', right - 5, -10, xx, yy, 14, 'Raleway', 'right')
        if (this.hasTC) {
            this._drawStub(ctx, right, 10)
            fillText3(ctx, 'TC', right - 5, 10, xx, yy, 14, 'Raleway', 'right')
        }

        // Reset (bottom edge)
        const cx = this.rstInp.leftx
        ctx.textBaseline = 'bottom'
        fillText3(ctx, this.resetType === 'sync' ? 'RST' : 'CLR', cx, bottom - 3, xx, yy, 12)
        if (this.resetPolarity === 'low') this._drawBubble(ctx, cx, bottom + 5)

        // Qualifier CTRn (n = bit width), top centre, port label size but bold
        ctx.fillStyle = 'black'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        ctx.font = `bold ${Math.round(14 * globalScope.scale)}px Raleway`
        ctx.fillText(`CTR${this.bitWidth}`,
            (xx + cx) * globalScope.scale + globalScope.ox,
            (yy + BOX_TOP + 12) * globalScope.scale + globalScope.oy)

        // Count value between the label columns, font shrinks if an estimate was too small
        const text = this._displayText()
        const displayLeft = BOX_LEFT + this._leftCol()
        const displayRight = right - this._rightCol()
        const room = displayRight - displayLeft
        let fontSize = DISPLAY_FONT
        ctx.font = `bold ${fontSize * globalScope.scale}px Raleway`
        const width = ctx.measureText(text).width / globalScope.scale
        if (width > room) fontSize *= room / width
        ctx.fillStyle = colors['input_text']
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        ctx.font = `bold ${fontSize * globalScope.scale}px Raleway`
        ctx.fillText(text,
            (xx + (displayLeft + displayRight) / 2) * globalScope.scale + globalScope.ox,
            (yy + (BOX_TOP + bottom) / 2) * globalScope.scale + globalScope.oy)
        ctx.textBaseline = 'alphabetic'
    }
}

HmCounter.prototype.tooltipText = 'Binary Counter: synchronous, with optional load, direction input, enable and terminal count'
HmCounter.prototype.objectType = 'HmCounter'

HmCounter.prototype.mutableProperties = {
    resetType: {
        name: 'Reset Type',
        type: 'select',
        options: RESET_TYPES,
        func: 'setResetType',
    },
    resetPolarity: {
        name: 'Reset Polarity',
        type: 'select',
        options: LOW_HIGH,
        func: 'setResetPolarity',
    },
    clockPolarity: {
        name: 'Clock Edge',
        type: 'select',
        options: CLOCK_EDGES,
        func: 'setClockPolarity',
    },
    countDirection: {
        name: 'Count Direction',
        type: 'select',
        options: DIRECTIONS,
        func: 'setCountDirection',
    },
    hasLoad: {
        name: 'Load Input',
        type: 'checkbox',
        func: 'setHasLoad',
    },
    loadPolarity: {
        name: 'Load Polarity',
        type: 'select',
        options: ['high', 'low'],
        func: 'setLoadPolarity',
        condition: 'hasLoad',
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
    hasTC: {
        name: 'TC Output',
        type: 'checkbox',
        func: 'setHasTC',
    },
    displayFormat: {
        name: 'Display',
        type: 'select',
        options: DISPLAY_FORMATS,
        func: 'setDisplayFormat',
    },
}
