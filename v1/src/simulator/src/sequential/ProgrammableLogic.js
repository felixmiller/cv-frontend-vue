import CircuitElement from '../circuitElement'
import Node, { findNode } from '../node'
import { simulationArea } from '../simulationArea'
import { correctWidth, moveTo, lineTo, rect2, drawCircle2, fillText3 } from '../canvasApi'
import { colors } from '../themer/themer'
import { forceResetNodesSet } from '../engine'

const CELL = 20       // spacing between grid lines
const CLICK_RADIUS = 8
const MARK = 5        // x marker arm length
const DOT_R = 3       // fixed-connection dot radius
const BUFFER_H = 60   // space for input buffers above the grid
const GATE_GAP = 15   // gap between grid edge and gate center
const GATE_HW = 9     // gate symbol half-width
const OR_GAP = 20     // gap below grid for OR gates
const INV_GAP = 40    // space for XOR inverter section
const OUT_STUB = 20   // space below last gate row for output nodes
const TOGGLE_SIZE = 10 // invert toggle box size
const TOGGLE_OFF = 12  // horizontal offset from gate center to toggle box center

/** Round to nearest canvas grid point (10px) */
const snap10 = v => Math.round(v / 10) * 10

/**
 * Base class for programmable logic arrays (PLA, PAL, PROM).
 *
 * Layout (left to right):
 *   Input vertical lines (AND array) | & gates | Output vertical lines (OR array)
 *
 * Horizontal product term lines span the full width through both arrays.
 * AND fuses: intersections of input verticals with horizontal lines.
 * OR fuses: intersections of output verticals with horizontal lines.
 * OR gates sit below each output vertical. Output nodes below those.
 */
export default class ProgrammableLogic extends CircuitElement {
    constructor(
        x, y, scope = globalScope,
        inputs = 3, productTerms = 4, outputs = 2,
        andFuses = null, orFuses = null,
        hasInverters = false, locked = false, invertMask = null
    ) {
        super(x, y, scope, 'RIGHT', 1)
        this.fixedBitWidth = true
        this.directionFixed = true
        this.rectangleObject = false

        this.inputs = inputs
        this.productTerms = productTerms
        this.outputs = outputs
        this.andCols = 2 * inputs

        this.hasInverters = hasInverters
        this.locked = locked
        this.invertMask = invertMask || new Array(outputs).fill(0)
        this.andFuses = andFuses || this._defaultAndFuses()
        this.orFuses = orFuses || this._defaultOrFuses()

        this._buildLayout()
        this._buildNodes()
    }

    get andProgrammable() { return true }
    get orProgrammable() { return true }

    // -- Layout ---------------------------------------------------------------

    _buildLayout() {
        this.andGridW = (this.andCols - 1) * CELL
        this.orGridW = (this.outputs - 1) * CELL
        this.gridH = (this.productTerms - 1) * CELL

        // X positions — snap grid origins to canvas grid (10px) for node alignment
        const rawGap = 2 * (GATE_GAP + GATE_HW)  // space between AND and OR grids
        const rawTotalW = this.andGridW + rawGap + this.orGridW
        this.gridLeftX = snap10(-rawTotalW / 2)
        this.orLeftX = snap10(this.gridLeftX + this.andGridW + rawGap)
        // AND gate centered between AND grid right edge and OR grid left edge
        this.andGateX = (this.gridLeftX + this.andGridW + this.orLeftX) / 2
        this.hLineRightX = this.orLeftX + this.orGridW

        // Y positions — anchor grid center at y=0, extend up/down
        // All key Y positions are multiples of 10 (BUFFER_H, OR_GAP, INV_GAP, OUT_STUB all multiples of 10)
        this.gridTopY = snap10(-this.gridH / 2)
        this.gridBotY = this.gridTopY + this.gridH
        this.topY = this.gridTopY - BUFFER_H
        this.orGateY = this.gridBotY + OR_GAP
        this.xorGateY = this.hasInverters ? this.orGateY + INV_GAP : null
        this.botY = (this.hasInverters ? this.xorGateY : this.orGateY) + OUT_STUB

        // Asymmetric bounding box — nodes sit on box edge
        const rightEdge = this.hLineRightX + 10
        const leftEdge = -(this.gridLeftX - 10)
        this.halfW = Math.max(rightEdge, leftEdge)
        // Shift box 10 units right so toggle boxes fit without resizing
        this.boxOffX = 10
        this.boxTop = this.topY
        this.boxBot = this.botY
        // Asymmetric hit area matching box edges
        this.leftDimensionX = this.rightDimensionX = this.halfW
        this.upDimensionY = -this.boxTop    // positive distance above origin
        this.downDimensionY = this.boxBot   // positive distance below origin
    }

    _buildNodes() {
        if (this.inputNodes) this.nodeList = []

        this.inputNodes = []
        for (let i = 0; i < this.inputs; i++) {
            const x = this.gridLeftX + (2 * i) * CELL
            this.inputNodes.push(new Node(x, this.boxTop, 0, this, 1, `x${i}`))
        }

        this.outputNodes = []
        for (let o = 0; o < this.outputs; o++) {
            const x = this.orLeftX + o * CELL
            this.outputNodes.push(new Node(x, this.boxBot, 1, this, 1, `y${o}`))
        }
    }

    // -- Save / Load ----------------------------------------------------------

    customSave() {
        return {
            constructorParamaters: [
                this.inputs, this.productTerms, this.outputs,
                this.andFuses, this.orFuses,
                this.hasInverters, this.locked, this.invertMask,
            ],
            nodes: {
                inputNodes: this.inputNodes.map(findNode),
                outputNodes: this.outputNodes.map(findNode),
            },
        }
    }

    // -- Fuse helpers ---------------------------------------------------------

    _makeArray(rows, cols, val) {
        const arr = []
        for (let r = 0; r < rows; r++) {
            arr[r] = []
            for (let c = 0; c < cols; c++) arr[r][c] = val
        }
        return arr
    }

    _defaultAndFuses() {
        return this._makeArray(this.productTerms, this.andCols, 0)
    }

    _defaultOrFuses() {
        const fuses = this._makeArray(this.productTerms, this.outputs, 0)
        const termsPerOutput = Math.ceil(this.productTerms / this.outputs)
        for (let p = 0; p < this.productTerms; p++) {
            const o = Math.min(Math.floor(p / termsPerOutput), this.outputs - 1)
            fuses[p][o] = 1
        }
        return fuses
    }

    // -- Click ----------------------------------------------------------------

    findPos() {
        const mx = simulationArea.mouseX - this.x
        const my = simulationArea.mouseY - this.y

        // AND array: cols = andCols (input lines), rows = productTerms
        const andHit = this._hitGrid(mx, my,
            this.gridLeftX, this.gridTopY, this.andCols, this.productTerms)
        if (andHit && this.andProgrammable)
            return { array: 'and', row: andHit.row, col: andHit.col }

        // OR array: cols = outputs (output lines), rows = productTerms
        const orHit = this._hitGrid(mx, my,
            this.orLeftX, this.gridTopY, this.outputs, this.productTerms)
        if (orHit && this.orProgrammable)
            return { array: 'or', row: orHit.row, col: orHit.col }

        return undefined
    }

    _hitGrid(mx, my, ox, oy, cols, rows) {
        const rx = mx - ox, ry = my - oy
        const c = Math.round(rx / CELL), r = Math.round(ry / CELL)
        if (c < 0 || r < 0 || c >= cols || r >= rows) return undefined
        const dx = rx - c * CELL, dy = ry - r * CELL
        if (dx * dx + dy * dy > CLICK_RADIUS * CLICK_RADIUS) return undefined
        return { row: r, col: c }
    }

    _hitToggle() {
        if (!this.hasInverters) return undefined
        const mx = simulationArea.mouseX - this.x
        const my = simulationArea.mouseY - this.y
        const hs = TOGGLE_SIZE / 2 + 2  // hit margin
        const toggleOffX = TOGGLE_OFF / 2 + 2  // must match _drawXorGates
        const toggleY = (this.orGateY + this.xorGateY) / 2  // must match _drawXorGates
        for (let o = 0; o < this.outputs; o++) {
            const tx = this.orLeftX + o * CELL + toggleOffX
            if (Math.abs(mx - tx) <= hs && Math.abs(my - toggleY) <= hs) return o
        }
        return undefined
    }

    click() {
        if (this.locked) return

        // Check invert toggle boxes
        const toggleHit = this._hitToggle()
        if (toggleHit !== undefined) {
            this.invertMask[toggleHit] ^= 1
            forceResetNodesSet(true)
            return
        }

        const pos = this.findPos()
        if (!pos) return
        if (pos.array === 'and') {
            this.andFuses[pos.row][pos.col] ^= 1
        } else {
            // orFuses[productTerm][output]: row = product term, col = output
            this.orFuses[pos.row][pos.col] ^= 1
        }
        // Force full re-simulation (inputs unchanged so normal propagation won't reach us)
        forceResetNodesSet(true)
    }

    // -- Drawing --------------------------------------------------------------

    customDraw() {
        const ctx = simulationArea.context
        const xx = this.x, yy = this.y
        const hover = this.findPos()

        this._drawOuterBox(ctx, xx, yy, hover)
        this._drawInputBuffers(ctx, xx, yy)

        // Grid lines
        this._drawHorizontalLines(ctx, xx, yy)
        this._drawOutputVerticals(ctx, xx, yy)

        // Gate symbols
        this._drawGateRow(ctx, xx, yy, this.andGateX, this.gridTopY,
            this.productTerms, '&', 'horizontal')
        this._drawOrGates(ctx, xx, yy)
        if (this.hasInverters) this._drawXorGates(ctx, xx, yy)
        this._drawOutputLines(ctx, xx, yy)

        // Fuse markers last (on top of everything)
        this._drawFuses(ctx, xx, yy, hover, 'and',
            this.gridLeftX, this.gridTopY, this.andCols, this.productTerms,
            (r, c) => this.andFuses[r][c], this.andProgrammable)
        this._drawFuses(ctx, xx, yy, hover, 'or',
            this.orLeftX, this.gridTopY, this.outputs, this.productTerms,
            (r, c) => this.orFuses[r][c], this.orProgrammable)
    }

    /** Check if mouse is inside the interactive grid area (suppresses drag/highlight) */
    _mouseInGrid() {
        const mx = simulationArea.mouseX - this.x
        const my = simulationArea.mouseY - this.y
        const margin = CELL / 2
        const inAnd = mx >= this.gridLeftX - margin && mx <= this.gridLeftX + this.andGridW + margin &&
                       my >= this.gridTopY - margin && my <= this.gridBotY + margin
        const inOr = mx >= this.orLeftX - margin && mx <= this.orLeftX + this.orGridW + margin &&
                      my >= this.gridTopY - margin && my <= this.gridBotY + margin
        return inAnd || inOr
    }

    _drawOuterBox(ctx, xx, yy, hover) {
        ctx.strokeStyle = colors['stroke']
        ctx.fillStyle = colors['fill']
        ctx.lineWidth = correctWidth(3)
        ctx.beginPath()
        rect2(ctx, -this.halfW + this.boxOffX, this.boxTop, 2 * this.halfW, this.boxBot - this.boxTop, xx, yy, 'RIGHT')
        if (!this._mouseInGrid() &&
            ((!simulationArea.shiftDown && this.hover) ||
                simulationArea.lastSelected === this ||
                simulationArea.multipleObjectSelections.includes(this)))
            ctx.fillStyle = colors['hover_select']
        ctx.fill()
        ctx.stroke()
    }

    _drawInputBuffers(ctx, xx, yy) {
        const branchY = this.topY + BUFFER_H * 0.35
        const invR = 3    // inverter bubble radius
        const invBw = 14  // inverter box width
        const invBh = 14  // inverter box height
        const invY = branchY + (this.gridTopY - branchY) / 2 - invBh / 4  // center of inverter box

        for (let i = 0; i < this.inputs; i++) {
            const trueX = this.gridLeftX + (2 * i) * CELL
            const compX = this.gridLeftX + (2 * i + 1) * CELL

            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(1)

            // Non-inverted: straight vertical from input node down through grid
            ctx.beginPath()
            moveTo(ctx, trueX, this.boxTop, xx, yy, 'RIGHT')
            lineTo(ctx, trueX, this.gridBotY + 5, xx, yy, 'RIGHT')
            ctx.stroke()

            // Branch right from non-inverted line at branchY
            ctx.beginPath()
            moveTo(ctx, trueX, branchY, xx, yy, 'RIGHT')
            lineTo(ctx, compX, branchY, xx, yy, 'RIGHT')
            // Turn down towards inverter box
            lineTo(ctx, compX, invY - invBh / 2, xx, yy, 'RIGHT')
            ctx.stroke()

            // Inverter box
            ctx.fillStyle = colors['fill']
            ctx.beginPath()
            rect2(ctx, compX - invBw / 2, invY - invBh / 2, invBw, invBh, xx, yy, 'RIGHT')
            ctx.fill()
            ctx.stroke()

            // "1" label inside box
            ctx.fillStyle = colors['stroke']
            fillText3(ctx, '1', compX, invY + 3, xx, yy, 8, 'Raleway', 'center')

            // Inversion bubble below box
            ctx.beginPath()
            ctx.fillStyle = colors['fill']
            drawCircle2(ctx, compX, invY + invBh / 2 + invR, invR, xx, yy, 'RIGHT')
            ctx.fill()
            ctx.stroke()

            // Complement line from below inversion bubble down through grid
            ctx.beginPath()
            moveTo(ctx, compX, invY + invBh / 2 + invR * 2, xx, yy, 'RIGHT')
            lineTo(ctx, compX, this.gridBotY + 5, xx, yy, 'RIGHT')
            ctx.stroke()
        }
    }

    /** Horizontal product term lines — full width with 5px overshoot on each side */
    _drawHorizontalLines(ctx, xx, yy) {
        ctx.strokeStyle = '#aaa'
        ctx.lineWidth = correctWidth(1)
        for (let r = 0; r < this.productTerms; r++) {
            const y = this.gridTopY + r * CELL
            ctx.beginPath()
            moveTo(ctx, this.gridLeftX - 5, y, xx, yy, 'RIGHT')
            lineTo(ctx, this.hLineRightX + 5, y, xx, yy, 'RIGHT')
            ctx.stroke()
        }
    }

    /** OR section: vertical output lines (5px overshoot at top) */
    _drawOutputVerticals(ctx, xx, yy) {
        ctx.strokeStyle = '#aaa'
        ctx.lineWidth = correctWidth(1)
        for (let o = 0; o < this.outputs; o++) {
            const x = this.orLeftX + o * CELL
            ctx.beginPath()
            moveTo(ctx, x, this.gridTopY - 5, xx, yy, 'RIGHT')
            lineTo(ctx, x, this.gridBotY, xx, yy, 'RIGHT')
            ctx.stroke()
        }
    }

    _drawFuses(ctx, xx, yy, hover, arrayName, ox, oy, cols, rows, getFuse, programmable) {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const ix = ox + c * CELL, iy = oy + r * CELL

                if (getFuse(r, c)) {
                    if (programmable) {
                        ctx.strokeStyle = '#333'
                        ctx.lineWidth = correctWidth(2)
                        ctx.beginPath()
                        moveTo(ctx, ix - MARK, iy - MARK, xx, yy, 'RIGHT')
                        lineTo(ctx, ix + MARK, iy + MARK, xx, yy, 'RIGHT')
                        ctx.stroke()
                        ctx.beginPath()
                        moveTo(ctx, ix + MARK, iy - MARK, xx, yy, 'RIGHT')
                        lineTo(ctx, ix - MARK, iy + MARK, xx, yy, 'RIGHT')
                        ctx.stroke()
                    } else {
                        ctx.beginPath()
                        ctx.fillStyle = '#333'
                        drawCircle2(ctx, ix, iy, DOT_R, xx, yy, 'RIGHT')
                        ctx.fill()
                    }
                }

                if (programmable && hover &&
                    hover.array === arrayName && hover.row === r && hover.col === c) {
                    ctx.beginPath()
                    ctx.fillStyle = 'rgba(255, 200, 0, 0.4)'
                    drawCircle2(ctx, ix, iy, CLICK_RADIUS, xx, yy, 'RIGHT')
                    ctx.fill()
                }
            }
        }
    }

    /** AND gate column: one gate per product term, on the right edge of AND section */
    _drawGateRow(ctx, xx, yy, gx, oy, count, label) {
        const gw = GATE_HW * 2, gh = 14
        for (let i = 0; i < count; i++) {
            const gy = oy + i * CELL
            ctx.strokeStyle = colors['stroke']
            ctx.fillStyle = colors['fill']
            ctx.lineWidth = correctWidth(1)
            ctx.beginPath()
            rect2(ctx, gx - GATE_HW, gy - gh / 2, gw, gh, xx, yy, 'RIGHT')
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = colors['stroke']
            fillText3(ctx, label, gx, gy + 4, xx, yy, 10, 'Raleway', 'center')
        }
    }

    /** OR gates: one per output, centered below each output vertical line */
    _drawOrGates(ctx, xx, yy) {
        const ghw = Math.min(GATE_HW, CELL / 2 - 3)  // narrow enough to not overlap
        const gw = ghw * 2, gh = 14
        for (let o = 0; o < this.outputs; o++) {
            const gx = this.orLeftX + o * CELL
            const gy = this.orGateY

            // Stub line from bottom of output vertical to OR gate
            ctx.strokeStyle = '#aaa'
            ctx.lineWidth = correctWidth(1)
            ctx.beginPath()
            moveTo(ctx, gx, this.gridBotY, xx, yy, 'RIGHT')
            lineTo(ctx, gx, gy - gh / 2, xx, yy, 'RIGHT')
            ctx.stroke()

            // Gate box
            ctx.strokeStyle = colors['stroke']
            ctx.fillStyle = colors['fill']
            ctx.lineWidth = correctWidth(1)
            ctx.beginPath()
            rect2(ctx, gx - ghw, gy - gh / 2, gw, gh, xx, yy, 'RIGHT')
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = colors['stroke']
            fillText3(ctx, '\u22651', gx, gy + 4, xx, yy, 10, 'Raleway', 'center')
        }
    }

    /** XOR gates with toggle boxes for output inversion */
    _drawXorGates(ctx, xx, yy) {
        const ghw = Math.min(GATE_HW, CELL / 2 - 3)
        const gh = 14
        const ths = TOGGLE_SIZE / 2
        const toggleOffX = TOGGLE_OFF / 2 + 2  // horizontal offset for toggle box
        const toggleY = (this.orGateY + this.xorGateY) / 2  // centered between OR and XOR

        for (let o = 0; o < this.outputs; o++) {
            const gx = this.orLeftX + o * CELL  // XOR centered on output line
            const gy = this.xorGateY
            const tx = gx + toggleOffX  // toggle box center x

            // Stub line from OR gate straight down into XOR gate
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(1)
            ctx.beginPath()
            moveTo(ctx, gx, this.orGateY + gh / 2, xx, yy, 'RIGHT')
            lineTo(ctx, gx, gy - gh / 2, xx, yy, 'RIGHT')
            ctx.stroke()

            // Toggle box (between OR and XOR, to the right)
            ctx.fillStyle = this.invertMask[o] ? '#ddd' : colors['fill']
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(1)
            ctx.beginPath()
            rect2(ctx, tx - ths, toggleY - ths, TOGGLE_SIZE, TOGGLE_SIZE, xx, yy, 'RIGHT')
            ctx.fill()
            ctx.stroke()

            // Toggle value
            ctx.fillStyle = colors['stroke']
            fillText3(ctx, this.invertMask[o] ? '1' : '0', tx, toggleY + 4, xx, yy, 9, 'Raleway', 'center')

            // Line from toggle box down, bends into right side of XOR gate
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(1)
            ctx.beginPath()
            moveTo(ctx, tx, toggleY + ths, xx, yy, 'RIGHT')
            lineTo(ctx, tx, gy - gh / 2 - 3, xx, yy, 'RIGHT')
            lineTo(ctx, gx + ghw - 2, gy - gh / 2 - 3, xx, yy, 'RIGHT')
            lineTo(ctx, gx + ghw - 2, gy - gh / 2, xx, yy, 'RIGHT')
            ctx.stroke()

            // XOR gate box (same narrow width as OR gates, centered on gx)
            ctx.strokeStyle = colors['stroke']
            ctx.fillStyle = colors['fill']
            ctx.lineWidth = correctWidth(1)
            ctx.beginPath()
            rect2(ctx, gx - ghw, gy - gh / 2, ghw * 2, gh, xx, yy, 'RIGHT')
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = colors['stroke']
            fillText3(ctx, '=1', gx, gy + 4, xx, yy, 10, 'Raleway', 'center')
        }
    }

    /** Lines from last gate row down to output nodes */
    _drawOutputLines(ctx, xx, yy) {
        const lastGateY = this.hasInverters ? this.xorGateY : this.orGateY
        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1)
        for (let o = 0; o < this.outputs; o++) {
            const x = this.orLeftX + o * CELL
            ctx.beginPath()
            moveTo(ctx, x, lastGateY + 7, xx, yy, 'RIGHT')
            lineTo(ctx, x, this.boxBot, xx, yy, 'RIGHT')
            ctx.stroke()
        }
    }

    // -- Simulation -----------------------------------------------------------

    isResolvable() {
        for (let i = 0; i < this.inputs; i++) {
            if (this.inputNodes[i].value === undefined) return false
        }
        return true
    }

    resolve() {
        if (!this.isResolvable()) return

        const inputLines = []
        for (let i = 0; i < this.inputs; i++) {
            const v = this.inputNodes[i].value & 1
            inputLines.push(v)
            inputLines.push(v ^ 1)
        }

        const andOutputs = []
        for (let p = 0; p < this.productTerms; p++) {
            let result = 1, hasAny = false
            for (let c = 0; c < this.andCols; c++) {
                if (this.andFuses[p][c]) {
                    result &= inputLines[c]
                    hasAny = true
                }
            }
            andOutputs.push(hasAny ? result : 0)
        }

        for (let o = 0; o < this.outputs; o++) {
            let result = 0
            for (let p = 0; p < this.productTerms; p++) {
                if (this.orFuses[p][o]) result |= andOutputs[p]
            }
            if (this.hasInverters && this.invertMask[o]) result ^= 1
            this.outputNodes[o].value = result
            simulationArea.simulationQueue.add(this.outputNodes[o])
        }
    }
}

ProgrammableLogic.prototype.tooltipText = 'Programmable Logic Array'
ProgrammableLogic.prototype.objectType = 'ProgrammableLogic'
ProgrammableLogic.prototype.mutableProperties = {
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
    productTerms: {
        name: 'Product Terms',
        type: 'number',
        max: '16',
        min: '2',
        func: 'changeProductTermCount',
    },
    outputs: {
        name: 'Outputs',
        type: 'number',
        max: '8',
        min: '1',
        func: 'changeOutputCount',
    },
}

ProgrammableLogic.prototype.changeInputCount = function (val) {
    if (val === undefined || val < 2 || val > 8 || val === this.inputs) return
    const obj = new this.constructor(this.x, this.y, this.scope,
        val, this.productTerms, this.outputs,
        null, null, this.hasInverters, this.locked, this.invertMask.slice())
    this.cleanDelete()
    simulationArea.lastSelected = obj
    return obj
}

ProgrammableLogic.prototype.changeProductTermCount = function (val) {
    if (val === undefined || val < 2 || val > 16 || val === this.productTerms) return
    const obj = new this.constructor(this.x, this.y, this.scope,
        this.inputs, val, this.outputs,
        null, null, this.hasInverters, this.locked, this.invertMask.slice())
    this.cleanDelete()
    simulationArea.lastSelected = obj
    return obj
}

ProgrammableLogic.prototype.changeOutputCount = function (val) {
    if (val === undefined || val < 1 || val > 8 || val === this.outputs) return
    const obj = new this.constructor(this.x, this.y, this.scope,
        this.inputs, this.productTerms, val,
        null, null, this.hasInverters, this.locked, this.invertMask.slice())
    this.cleanDelete()
    simulationArea.lastSelected = obj
    return obj
}

ProgrammableLogic.prototype.setLocked = function (val) {
    this.locked = (val === true || val === 'true')
}

ProgrammableLogic.prototype.setHasInverters = function (val) {
    const hasInv = (val === true || val === 'true')
    if (hasInv === this.hasInverters) return
    const mask = this.invertMask.slice()
    while (mask.length < this.outputs) mask.push(0)
    const obj = new this.constructor(this.x, this.y, this.scope,
        this.inputs, this.productTerms, this.outputs,
        this.andFuses, this.orFuses, hasInv, this.locked, mask)
    this.cleanDelete()
    simulationArea.lastSelected = obj
}
