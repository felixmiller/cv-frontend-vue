import CircuitElement from '../circuitElement'
import Node, { findNode } from '../node'
import { simulationArea } from '../simulationArea'
import { correctWidth, fillText3 } from '../canvasApi'
import { colors } from '../themer/themer'

/**
 * FPGA — Island-style FPGA with CLBs, routing channels, and switch boxes.
 *
 * Architecture:
 *   - Grid of CLBs (rows x cols), each containing a 3-input LUT, D-FF, and output MUX
 *   - Vertical wire channels between CLB columns (n_cols + 1 channels)
 *   - Horizontal wire channels between CLB rows (n_rows + 1 channels)
 *   - Switch boxes at every V/H channel intersection
 *   - I/O pins on left and right edges (one per horizontal channel)
 *
 * Step 1: Static skeleton — layout, boxes, wire channels. No simulation yet.
 */

// Layout constants (in circuit coordinate units, snapped to 10px grid)
const N_INPUTS = 3                 // LUT inputs (fixed for now)
const CLB_W = 120                  // CLB box width
const CLB_H = 100                  // CLB box height
const SB_SIZE = 40                 // switch box size
const H_WIRE_COUNT = 3             // horizontal wires per channel
const WIRE_PITCH = 10              // spacing between parallel wires
const CH_GAP = 10                  // gap between channel edge and CLB box
const IO_STUB = 30                 // I/O pin stub length

/** Round to nearest 10 (canvas grid). */
const snap10 = v => Math.round(v / 10) * 10

export default class FPGA extends CircuitElement {
    constructor(
        x, y, scope = globalScope,
        rows = 2, cols = 2,
        luts = null, muxSel = null
    ) {
        super(x, y, scope, 'RIGHT', 1)
        this.fixedBitWidth = true
        this.directionFixed = true
        this.rectangleObject = false

        this.rows = rows
        this.cols = cols
        this.nInputs = N_INPUTS

        // LUT contents: { "r,c": [8 bits] }  (string keys for JSON save)
        this.luts = luts || this._defaultLuts()
        // MUX select: { "r,c": 0 or 1 }
        this.muxSel = muxSel || this._defaultMuxSel()

        this._buildLayout()
        this._buildNodes()
    }

    // -- Defaults -------------------------------------------------------------

    _defaultLuts() {
        const luts = {}
        for (let r = 0; r < this.rows; r++)
            for (let c = 0; c < this.cols; c++)
                luts[`${r},${c}`] = new Array(1 << this.nInputs).fill(0)
        return luts
    }

    _defaultMuxSel() {
        const mux = {}
        for (let r = 0; r < this.rows; r++)
            for (let c = 0; c < this.cols; c++)
                mux[`${r},${c}`] = 0  // combinatorial by default
        return mux
    }

    // -- Layout ---------------------------------------------------------------

    /**
     * Compute absolute positions of all grid elements relative to element origin.
     *
     * Layout (left to right): SB | wires | CLB | wires | SB | wires | CLB | wires | SB
     * Layout (top to bottom): SB | wires | CLB | wires | SB | wires | CLB | wires | SB
     */
    _buildLayout() {
        const { rows, cols } = this

        // Vertical channel X centers: cols+1 channels
        // Channel vi=0 sits at left edge, vi=cols at right edge
        this.vChanX = []
        this.clbX = []   // left edge of each CLB column
        let x = 0
        for (let c = 0; c <= cols; c++) {
            this.vChanX.push(snap10(x))
            if (c < cols) {
                const clbLeft = x + SB_SIZE / 2 + CH_GAP
                this.clbX.push(snap10(clbLeft))
                x = clbLeft + CLB_W + CH_GAP
            }
        }

        // Horizontal channel Y centers: rows+1 channels
        this.hChanY = []
        this.clbY = []   // top edge of each CLB row
        let yPos = 0
        for (let r = 0; r <= rows; r++) {
            this.hChanY.push(snap10(yPos))
            if (r < rows) {
                const clbTop = yPos + SB_SIZE / 2 + CH_GAP
                this.clbY.push(snap10(clbTop))
                yPos = clbTop + CLB_H + CH_GAP
            }
        }

        // Total dimensions (for centering the element at its origin)
        const totalW = this.vChanX[cols] + SB_SIZE / 2
        const totalH = this.hChanY[rows] + SB_SIZE / 2
        this.offsetX = snap10(-totalW / 2)
        this.offsetY = snap10(-totalH / 2)

        // Bounding box for hit-testing
        this.leftDimensionX = -this.offsetX + IO_STUB + 20
        this.rightDimensionX = totalW + this.offsetX + IO_STUB + 20
        this.upDimensionY = -this.offsetY + 20
        this.downDimensionY = totalH + this.offsetY + 20
    }

    /** Number of vertical wires in channel vi. */
    _vWireCount(vi) {
        if (vi === 0) return this.nInputs
        if (vi < this.cols) return this.nInputs + 1
        return 2  // rightmost channel
    }

    _buildNodes() {
        if (this.ioNodesLeft) this.nodeList = []

        // I/O nodes on left and right edges (one per horizontal channel)
        this.ioNodesLeft = []
        this.ioNodesRight = []
        for (let hi = 0; hi <= this.rows; hi++) {
            const ny = this.offsetY + this.hChanY[hi]
            const leftX = this.offsetX + this.vChanX[0] - SB_SIZE / 2 - IO_STUB
            const rightX = this.offsetX + this.vChanX[this.cols] + SB_SIZE / 2 + IO_STUB
            this.ioNodesLeft.push(
                new Node(leftX, ny, 0, this, 1, `P${hi * 2}`)
            )
            this.ioNodesRight.push(
                new Node(rightX, ny, 1, this, 1, `P${hi * 2 + 1}`)
            )
        }
    }

    // -- Save / Load ----------------------------------------------------------

    customSave() {
        return {
            constructorParamaters: [
                this.rows, this.cols,
                this.luts, this.muxSel,
            ],
            nodes: {
                ioNodesLeft: this.ioNodesLeft.map(findNode),
                ioNodesRight: this.ioNodesRight.map(findNode),
            },
        }
    }

    // -- Resolve (placeholder) ------------------------------------------------

    resolve() {
        // Step 3: LUT evaluation, MUX routing, D-FF
    }

    // -- Drawing --------------------------------------------------------------

    customDraw() {
        const ctx = simulationArea.context
        const ox = this.offsetX  // shift to center
        const oy = this.offsetY

        this._drawFpgaBorder(ctx, ox, oy)
        this._drawSwitchBoxes(ctx, ox, oy)
        this._drawCLBs(ctx, ox, oy)
        this._drawVWires(ctx, ox, oy)
        this._drawHWires(ctx, ox, oy)
        this._drawIOStubs(ctx, ox, oy)
    }

    /** Outer FPGA border. */
    _drawFpgaBorder(ctx, ox, oy) {
        const pad = 5
        const x1 = this.vChanX[0] - SB_SIZE / 2 - pad
        const y1 = this.hChanY[0] - SB_SIZE / 2 - pad
        const x2 = this.vChanX[this.cols] + SB_SIZE / 2 + pad
        const y2 = this.hChanY[this.rows] + SB_SIZE / 2 + pad
        const w = x2 - x1
        const h = y2 - y1

        const xx = this.x + ox
        const yy = this.y + oy
        const s = globalScope.scale

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(2)
        ctx.strokeRect(
            (xx + x1) * s + globalScope.ox,
            (yy + y1) * s + globalScope.oy,
            w * s, h * s
        )
    }

    /** Switch boxes at every V/H channel intersection. */
    _drawSwitchBoxes(ctx, ox, oy) {
        const s = globalScope.scale
        const xx = this.x + ox
        const yy = this.y + oy
        const half = SB_SIZE / 2

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1)
        ctx.fillStyle = colors['fill']

        for (let vi = 0; vi <= this.cols; vi++) {
            for (let hi = 0; hi <= this.rows; hi++) {
                const cx = this.vChanX[vi]
                const cy = this.hChanY[hi]
                const px = (xx + cx - half) * s + globalScope.ox
                const py = (yy + cy - half) * s + globalScope.oy
                ctx.fillRect(px, py, SB_SIZE * s, SB_SIZE * s)
                ctx.strokeRect(px, py, SB_SIZE * s, SB_SIZE * s)
            }
        }
    }

    /** CLB boxes with labels. */
    _drawCLBs(ctx, ox, oy) {
        const s = globalScope.scale
        const xx = this.x + ox
        const yy = this.y + oy

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const cx = this.clbX[c]
                const cy = this.clbY[r]
                const px = (xx + cx) * s + globalScope.ox
                const py = (yy + cy) * s + globalScope.oy

                // Dashed border
                ctx.strokeStyle = colors['stroke']
                ctx.lineWidth = correctWidth(1)
                ctx.setLineDash([5 * s, 3 * s])
                ctx.strokeRect(px, py, CLB_W * s, CLB_H * s)
                ctx.setLineDash([])

                // Label
                ctx.fillStyle = colors['text']
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                const fontSize = Math.round(12 * s)
                ctx.font = `${fontSize}px sans-serif`
                ctx.fillText(
                    `CLB (${r},${c})`,
                    px + (CLB_W / 2) * s,
                    py + (CLB_H / 2) * s
                )
            }
        }
    }

    /** Vertical wire segments between switch boxes. */
    _drawVWires(ctx, ox, oy) {
        const s = globalScope.scale
        const xx = this.x + ox
        const yy = this.y + oy
        const halfSB = SB_SIZE / 2

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(0.5)

        for (let vi = 0; vi <= this.cols; vi++) {
            const nw = this._vWireCount(vi)
            const bw = (nw - 1) * WIRE_PITCH
            const baseX = this.vChanX[vi] - bw / 2

            for (let w = 0; w < nw; w++) {
                const wx = baseX + w * WIRE_PITCH
                for (let hi = 0; hi < this.rows; hi++) {
                    const y1 = this.hChanY[hi] + halfSB
                    const y2 = this.hChanY[hi + 1] - halfSB
                    const px = (xx + wx) * s + globalScope.ox
                    const py1 = (yy + y1) * s + globalScope.oy
                    const py2 = (yy + y2) * s + globalScope.oy
                    ctx.beginPath()
                    ctx.moveTo(px, py1)
                    ctx.lineTo(px, py2)
                    ctx.stroke()
                }
            }
        }
    }

    /** Horizontal wire segments between switch boxes. */
    _drawHWires(ctx, ox, oy) {
        const s = globalScope.scale
        const xx = this.x + ox
        const yy = this.y + oy
        const halfSB = SB_SIZE / 2
        const bw = (H_WIRE_COUNT - 1) * WIRE_PITCH

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(0.5)

        for (let hi = 0; hi <= this.rows; hi++) {
            const baseY = this.hChanY[hi] - bw / 2
            for (let w = 0; w < H_WIRE_COUNT; w++) {
                const wy = baseY + w * WIRE_PITCH
                for (let vi = 0; vi < this.cols; vi++) {
                    const x1 = this.vChanX[vi] + halfSB
                    const x2 = this.vChanX[vi + 1] - halfSB
                    const py = (yy + wy) * s + globalScope.oy
                    const px1 = (xx + x1) * s + globalScope.ox
                    const px2 = (xx + x2) * s + globalScope.ox
                    ctx.beginPath()
                    ctx.moveTo(px1, py)
                    ctx.lineTo(px2, py)
                    ctx.stroke()
                }
            }
        }
    }

    /** I/O pin stubs from FPGA border to switch boxes. */
    _drawIOStubs(ctx, ox, oy) {
        const s = globalScope.scale
        const xx = this.x + ox
        const yy = this.y + oy
        const halfSB = SB_SIZE / 2

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1)

        for (let hi = 0; hi <= this.rows; hi++) {
            const cy = this.hChanY[hi]

            // Left stub
            const lx1 = this.vChanX[0] - halfSB - IO_STUB
            const lx2 = this.vChanX[0] - halfSB
            ctx.beginPath()
            ctx.moveTo((xx + lx1) * s + globalScope.ox, (yy + cy) * s + globalScope.oy)
            ctx.lineTo((xx + lx2) * s + globalScope.ox, (yy + cy) * s + globalScope.oy)
            ctx.stroke()

            // Right stub
            const rx1 = this.vChanX[this.cols] + halfSB
            const rx2 = rx1 + IO_STUB
            ctx.beginPath()
            ctx.moveTo((xx + rx1) * s + globalScope.ox, (yy + cy) * s + globalScope.oy)
            ctx.lineTo((xx + rx2) * s + globalScope.ox, (yy + cy) * s + globalScope.oy)
            ctx.stroke()

            // Pin labels
            ctx.fillStyle = colors['text']
            ctx.textBaseline = 'middle'
            const fontSize = Math.round(10 * s)
            ctx.font = `${fontSize}px sans-serif`

            ctx.textAlign = 'right'
            ctx.fillText(
                `P${hi * 2}`,
                (xx + lx1 - 5) * s + globalScope.ox,
                (yy + cy) * s + globalScope.oy
            )
            ctx.textAlign = 'left'
            ctx.fillText(
                `P${hi * 2 + 1}`,
                (xx + rx2 + 5) * s + globalScope.ox,
                (yy + cy) * s + globalScope.oy
            )
        }
    }
}

FPGA.prototype.tooltipText = 'FPGA: Island-style FPGA with configurable CLBs and routing'
FPGA.prototype.objectType = 'FPGA'
FPGA.prototype.constructorParametersDefault = [2, 2, null, null]

FPGA.prototype.mutableProperties = {
    rows: {
        name: 'Rows',
        type: 'number',
        max: '6',
        min: '1',
        func: 'changeRows',
    },
    cols: {
        name: 'Columns',
        type: 'number',
        max: '6',
        min: '1',
        func: 'changeCols',
    },
}

FPGA.prototype.changeRows = function (val) {
    val = parseInt(val)
    if (!val || val < 1 || val > 6 || val === this.rows) return
    const obj = new FPGA(this.x, this.y, this.scope, val, this.cols)
    this.cleanDelete()
    simulationArea.lastSelected = obj
    return obj
}

FPGA.prototype.changeCols = function (val) {
    val = parseInt(val)
    if (!val || val < 1 || val > 6 || val === this.cols) return
    const obj = new FPGA(this.x, this.y, this.scope, this.rows, val)
    this.cleanDelete()
    simulationArea.lastSelected = obj
    return obj
}
