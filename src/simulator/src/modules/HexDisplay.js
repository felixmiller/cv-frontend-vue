import CircuitElement from '../circuitElement'
import Node, { findNode } from '../node'
import { simulationArea } from '../simulationArea'
import {
    correctWidth,
    lineTo,
    moveTo,
    rect2,
    validColor,
    colorToRGBA,
    fillText4,
} from '../canvasApi'
import { scheduleUpdate } from '../engine'
/**
 * @class
 * HexDisplay
 * @extends CircuitElement
 * @param {number} x - x coordinate of element.
 * @param {number} y - y coordinate of element.
 * @param {Scope=} scope - Cirucit on which element is drawn
 * @param {string} color - segment color
 * @param {string} connectorSide - side of the input pins: top, bottom, left, right
 * @param {string} inputMode - 'bus' (one 4 bit pin) or 'bits' (four 1 bit pins)
 * @category modules
 */
import { colors } from '../themer/themer'

const SIDES = ['top', 'bottom', 'left', 'right']

// Bus pin offset per side
const BUS_PIN = { top: [0, -50], bottom: [0, 50], left: [-30, 0], right: [30, 0] }

// Single bit pins, index = bit number. Same spacing as SevenSegDisplay pins.
// LSB is on the right (top/bottom) or at the bottom (left/right).
const BIT_POS = [20, 10, -10, -20]

// Offset from a pin to its weight label, towards the inside of the box
const LABEL_SHIFT = { top: [0, 6], bottom: [0, -6], left: [6, 0], right: [-6, 0] }

export default class HexDisplay extends CircuitElement {
    constructor(
        x, y, scope = globalScope, color = 'Red',
        connectorSide = 'top', inputMode = 'bus'
    ) {
        super(x, y, scope, 'RIGHT', 4)
        this.directionFixed = true
        this.fixedBitWidth = true
        this.setDimensions(30, 50)
        this.direction = 'RIGHT'
        this.color = color
        this.actualColor = color
        this.connectorSide = SIDES.includes(connectorSide) ? connectorSide : 'top'
        this.inputMode = inputMode === 'bits' ? 'bits' : 'bus'
        this._createPins()
    }

    _bitPinPos(i) {
        const p = BIT_POS[i]
        switch (this.connectorSide) {
            case 'bottom': return [p, 50]
            case 'left': return [-30, p]
            case 'right': return [30, p]
            default: return [p, -50]
        }
    }

    // Only the pins of the active mode exist, so the bus mode save format stays unchanged
    _createPins() {
        if (this.inputMode === 'bits') {
            this.inp = undefined
            this.inpBits = [0, 1, 2, 3].map(
                (i) => new Node(...this._bitPinPos(i), 0, this, 1, String(1 << i))
            )
        } else {
            this.inpBits = undefined
            this.inp = new Node(...BUS_PIN[this.connectorSide], 0, this, 4)
        }
    }

    _pins() {
        return this.inputMode === 'bits' ? this.inpBits : [this.inp]
    }

    _moveNode(node, lx, ly) {
        node.leftx = lx
        node.lefty = ly
        node.updateRotation()
    }

    // Removes a pin and the wire leading to it, up to the next junction or element pin
    _deletePinWithWire(pin) {
        const doomed = []
        for (const start of pin.connections) {
            let prev = pin
            let node = start
            while (
                node &&
                node.type === NODE_INTERMEDIATE &&
                node.connections.length <= 2 &&
                !doomed.includes(node)
            ) {
                doomed.push(node)
                const next = node.connections.find((n) => n !== prev)
                prev = node
                node = next
            }
        }
        doomed.forEach((node) => node.delete())
        this.nodeList = this.nodeList.filter((n) => n !== pin)
        pin.delete()
    }

    /**
     * @memberof HexDisplay
     * fn to move the input pins to another side, the display stays upright
     */
    setConnectorSide(side) {
        if (!SIDES.includes(side) || side === this.connectorSide) return
        this.connectorSide = side
        if (this.inputMode === 'bits') {
            this.inpBits.forEach((node, i) => this._moveNode(node, ...this._bitPinPos(i)))
        } else {
            this._moveNode(this.inp, ...BUS_PIN[side])
        }
        scheduleUpdate()
    }

    /**
     * @memberof HexDisplay
     * fn to switch between one 4 bit bus pin and four 1 bit pins.
     * Wires on the removed pins are deleted.
     */
    setInputMode(mode) {
        if ((mode !== 'bus' && mode !== 'bits') || mode === this.inputMode) return
        this._pins().forEach((pin) => this._deletePinWithWire(pin))
        this.inputMode = mode
        this._createPins()
        scheduleUpdate()
    }

    // Arrow key shortcut moves the connector instead of rotating the display
    newDirection(dir) {
        this.setConnectorSide(
            { UP: 'top', DOWN: 'bottom', LEFT: 'left', RIGHT: 'right' }[dir]
        )
    }

    /**
     * @memberof HexDisplay
     * value shown on the display. Single bits: unconnected or undefined bits count as 0.
     */
    displayValue() {
        if (this.inputMode === 'bus') return this.inp.value
        return this.inpBits.reduce(
            (sum, node, i) => sum + (node.value === 1 ? 1 << i : 0),
            0
        )
    }

    /**
     * @memberof HexDisplay
     * fn to change the color of HexDisplay
     * @return {JSON}
     */
    changeColor(value) {
        if (validColor(value)) {
            if (value.trim() === '') {
                this.color = 'Red'
                this.actualColor = 'rgba(255, 0, 0, 1)'
            } else {
                this.color = value
                const temp = colorToRGBA(value)
                this.actualColor = `rgba(${temp[0]},${temp[1]},${temp[2]}, ${temp[3]})`
            }
        }
    }

    /**
     * @memberof HexDisplay
     * fn to create save Json Data of object
     * @return {JSON}
     */
    customSave() {
        const data = {
            constructorParamaters: [this.color, this.connectorSide, this.inputMode],
            nodes:
                this.inputMode === 'bits'
                    ? { inpBits: this.inpBits.map(findNode) }
                    : { inp: findNode(this.inp) },
        }
        return data
    }

    /**
     * @memberof HexDisplay
     * function to draw element
     */
    customDrawSegment(x1, y1, x2, y2, color) {
        if (color === undefined) color = 'lightgrey'
        var ctx = simulationArea.context
        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.lineWidth = correctWidth(5)
        const xx = this.x
        const yy = this.y

        moveTo(ctx, x1, y1, xx, yy, this.direction)
        lineTo(ctx, x2, y2, xx, yy, this.direction)
        ctx.closePath()
        ctx.stroke()
    }

    /**
     * @memberof HexDisplay
     * function to draw element
     */
    customDraw() {
        var ctx = simulationArea.context

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(3)

        let a = 0,
            b = 0,
            c = 0,
            d = 0,
            e = 0,
            f = 0,
            g = 0
        switch (this.displayValue()) {
            case 0:
                a = b = c = d = e = f = 1
                break
            case 1:
                b = c = 1
                break
            case 2:
                a = b = g = e = d = 1
                break
            case 3:
                a = b = g = c = d = 1
                break
            case 4:
                f = g = b = c = 1
                break
            case 5:
                a = f = g = c = d = 1
                break
            case 6:
                a = f = g = e = c = d = 1
                break
            case 7:
                a = b = c = 1
                break
            case 8:
                a = b = c = d = e = g = f = 1
                break
            case 9:
                a = f = g = b = c = 1
                break
            case 0xa:
                a = f = b = c = g = e = 1
                break
            case 0xb:
                f = e = g = c = d = 1
                break
            case 0xc:
                a = f = e = d = 1
                break
            case 0xd:
                b = c = g = e = d = 1
                break
            case 0xe:
                a = f = g = e = d = 1
                break
            case 0xf:
                a = f = g = e = 1
                break
            default:
        }
        this.customDrawSegment(
            18,
            -3,
            18,
            -38,
            ['lightgrey', this.actualColor][b]
        )
        this.customDrawSegment(
            18,
            3,
            18,
            38,
            ['lightgrey', this.actualColor][c]
        )
        this.customDrawSegment(
            -18,
            -3,
            -18,
            -38,
            ['lightgrey', this.actualColor][f]
        )
        this.customDrawSegment(
            -18,
            3,
            -18,
            38,
            ['lightgrey', this.actualColor][e]
        )
        this.customDrawSegment(
            -17,
            -38,
            17,
            -38,
            ['lightgrey', this.actualColor][a]
        )
        this.customDrawSegment(
            -17,
            0,
            17,
            0,
            ['lightgrey', this.actualColor][g]
        )
        this.customDrawSegment(
            -15,
            38,
            17,
            38,
            ['lightgrey', this.actualColor][d]
        )

        if (this.inputMode === 'bits') {
            const [dx, dy] = LABEL_SHIFT[this.connectorSide]
            ctx.fillStyle = colors['text']
            ;[0, 1, 2, 3].forEach((i) => {
                const [px, py] = this._bitPinPos(i)
                fillText4(ctx, String(1 << i), px + dx, py + dy, this.x, this.y, 'RIGHT', 7, 'center')
            })
        }
    }

    subcircuitDrawSegment(x1, y1, x2, y2, color, xxSegment, yySegment) {
        if (color == undefined) color = 'lightgrey'
        var ctx = simulationArea.context
        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.lineWidth = correctWidth(3)
        var xx = xxSegment
        var yy = yySegment

        moveTo(ctx, x1, y1, xx, yy, this.direction)
        lineTo(ctx, x2, y2, xx, yy, this.direction)
        ctx.closePath()
        ctx.stroke()
    }
    // Draws the element in the subcircuit. Used in layout mode
    subcircuitDraw(xOffset = 0, yOffset = 0) {
        var ctx = simulationArea.context

        var xx = this.subcircuitMetadata.x + xOffset
        var yy = this.subcircuitMetadata.y + yOffset

        ctx.strokeStyle = 'black'
        ctx.lineWidth = correctWidth(3)
        let a = 0,
            b = 0,
            c = 0,
            d = 0,
            e = 0,
            f = 0,
            g = 0

        switch (this.displayValue()) {
            case 0:
                a = b = c = d = e = f = 1
                break
            case 1:
                b = c = 1
                break
            case 2:
                a = b = g = e = d = 1
                break
            case 3:
                a = b = g = c = d = 1
                break
            case 4:
                f = g = b = c = 1
                break
            case 5:
                a = f = g = c = d = 1
                break
            case 6:
                a = f = g = e = c = d = 1
                break
            case 7:
                a = b = c = 1
                break
            case 8:
                a = b = c = d = e = g = f = 1
                break
            case 9:
                a = f = g = b = c = 1
                break
            case 0xa:
                a = f = b = c = g = e = 1
                break
            case 0xb:
                f = e = g = c = d = 1
                break
            case 0xc:
                a = f = e = d = 1
                break
            case 0xd:
                b = c = g = e = d = 1
                break
            case 0xe:
                a = f = g = e = d = 1
                break
            case 0xf:
                a = f = g = e = 1
                break
            default:
        }
        this.subcircuitDrawSegment(
            10,
            -20,
            10,
            -38,
            ['lightgrey', this.actualColor][b],
            xx,
            yy
        )
        this.subcircuitDrawSegment(
            10,
            -17,
            10,
            1,
            ['lightgrey', this.actualColor][c],
            xx,
            yy
        )
        this.subcircuitDrawSegment(
            -10,
            -20,
            -10,
            -38,
            ['lightgrey', this.actualColor][f],
            xx,
            yy
        )
        this.subcircuitDrawSegment(
            -10,
            -17,
            -10,
            1,
            ['lightgrey', this.actualColor][e],
            xx,
            yy
        )
        this.subcircuitDrawSegment(
            -8,
            -38,
            8,
            -38,
            ['lightgrey', this.actualColor][a],
            xx,
            yy
        )
        this.subcircuitDrawSegment(
            -8,
            -18,
            8,
            -18,
            ['lightgrey', this.actualColor][g],
            xx,
            yy
        )
        this.subcircuitDrawSegment(
            -8,
            1,
            8,
            1,
            ['lightgrey', this.actualColor][d],
            xx,
            yy
        )

        ctx.beginPath()
        ctx.strokeStyle = 'black'
        ctx.lineWidth = correctWidth(1)
        rect2(ctx, -15, -42, 33, 51, xx, yy, this.direction)
        ctx.stroke()

        if (
            (this.hover && !simulationArea.shiftDown) ||
            simulationArea.lastSelected == this ||
            simulationArea.multipleObjectSelections.includes(this)
        ) {
            ctx.fillStyle = 'rgba(255, 255, 32,0.6)'
            ctx.fill()
        }
    }
    generateVerilog() {
        // Single bits: concatenate MSB first, unconnected bits are 0
        const value =
            this.inputMode === 'bits'
                ? `{${[...this.inpBits]
                      .reverse()
                      .map((n) => (n.connections.length ? n.verilogLabel : "1'b0"))
                      .join(', ')}}`
                : this.inp.verilogLabel
        return `
      always @ (*)
        $display("HexDisplay:${this.verilogLabel}=%d", ${value});`
    }
}

/**
 * @memberof HexDisplay
 * Help Tip
 * @type {string}
 * @category modules
 */
HexDisplay.prototype.tooltipText =
    'Hex Display ToolTip: Inputs a 4 Bit Hex number and displays it. Inputs as one 4 bit bus or as four single bits (8 4 2 1).'

/**
 * @memberof HexDisplay
 * Help URL
 * @type {string}
 * @category modules
 */
HexDisplay.prototype.helplink =
    'https://docs.circuitverse.org/chapter4/chapter4-output#hexdisplay'
HexDisplay.prototype.objectType = 'HexDisplay'
HexDisplay.prototype.canShowInSubcircuit = true
HexDisplay.prototype.layoutProperties = {
    rightDimensionX: 20,
    leftDimensionX: 15,
    upDimensionY: 42,
    downDimensionY: 10,
}

/**
 * @memberof HexDisplay
 * Mutable properties of the element
 * @type {JSON}
 * @category modules
 */
HexDisplay.prototype.mutableProperties = {
    color: {
        name: 'Color: ',
        type: 'text',
        func: 'changeColor',
    },
    connectorSide: {
        name: 'Connector',
        type: 'select',
        options: SIDES,
        func: 'setConnectorSide',
    },
    inputMode: {
        name: 'Inputs',
        type: 'select',
        options: ['bus', 'bits'],
        func: 'setInputMode',
    },
}
