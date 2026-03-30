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
const N_LUT_ENTRIES = 1 << N_INPUTS  // 8
const CLB_W = 130                  // CLB box width
const CLB_H = 110                  // CLB box height
const SB_SIZE = 40                 // switch box size
const H_WIRE_COUNT = 3             // horizontal wires per channel
const WIRE_PITCH = 10              // spacing between parallel wires
const CH_GAP = 30                  // gap between channel edge and CLB box
const IO_STUB = 30                 // I/O pin stub length

// CLB internal layout (relative to CLB top-left corner)
const LUT_X = 5                    // LUT table left edge within CLB
const LUT_Y = 12                   // LUT table top edge within CLB
const LUT_ADDR_W = 22              // address column width
const LUT_BIT_W = 14               // bit column width
const LUT_ROW_H = 10               // row height
const LUT_LABEL_Y = 6              // "LUT" label Y offset from CLB top

const FF_X = 82                    // D-FF box left edge within CLB
const FF_Y = 42                    // D-FF box top edge within CLB
const FF_W = 22                    // D-FF box width
const FF_H = 45                    // D-FF box height
const FF_DQ_REL = 0.36             // D input and Q output relative Y (same level, aligned with MUX input 1)
const FF_CLK_REL = 0.55            // Clock input relative Y position

const MUX_X = 112                  // MUX box left edge within CLB
const MUX_Y = 12                   // MUX box top edge within CLB
const MUX_W = 12                   // MUX box width
const MUX_H = 48                   // MUX box height (tapered shape)

const SRAM_X = 112                 // SRAM cell left edge within CLB (aligned with MUX center)
const SRAM_Y = 80                  // SRAM cell top edge within CLB
const SRAM_SIZE = 12               // SRAM cell size

// PRE/CLR mux layout (small muxes between LUT and FF)
const PRE_MUX_X = 70               // PRE mux left edge within CLB
const CLR_MUX_X = 70               // CLR mux left edge within CLB
const RC_MUX_W = 8                 // PRE/CLR mux width
const RC_MUX_H = 14                // PRE/CLR mux height
const RC_SRAM_SIZE = 8             // PRE/CLR SRAM cell size
// PRE: SRAM below, mux above. Anchor = SRAM top Y
const PRE_SRAM_Y = 34              // PRE SRAM cell top within CLB
const PRE_MUX_Y = PRE_SRAM_Y - 2 - RC_MUX_H  // mux sits just above SRAM
// CLR: SRAM above, mux below. Anchor = SRAM top Y
const CLR_SRAM_Y = 80              // CLR SRAM cell top within CLB
const CLR_MUX_Y = CLR_SRAM_Y + RC_SRAM_SIZE + 2  // mux sits just below SRAM

// CLK/RST input positions within CLB (left edge, below LUT)
const CLB_CLK_Y = 96               // CLK input Y within CLB
const CLB_RST_Y = 104              // RST input Y within CLB

// Global signal inputs
const GLOBAL_STUB = 20             // stub length for CLK/RST labels

/** Round to nearest 10 (canvas grid). */
const snap10 = v => Math.round(v / 10) * 10

export default class FPGA extends CircuitElement {
    constructor(
        x, y, scope = globalScope,
        rows = 2, cols = 2,
        luts = null, muxSel = null,
        preSel = null, clrSel = null
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
        // Output MUX select: { "r,c": 0 or 1 }
        this.muxSel = muxSel || this._defaultMuxSel()
        // PRE mux select: { "r,c": 0 (const 0) or 1 (RST signal) }
        this.preSel = preSel || this._defaultMuxSel()
        // CLR mux select: { "r,c": 0 (const 0) or 1 (RST signal) }
        this.clrSel = clrSel || this._defaultMuxSel()

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
                const clbLeft = x + SB_SIZE / 2 + CH_GAP - 20
                this.clbX.push(snap10(clbLeft))
                x = clbLeft + CLB_W + CH_GAP + 20
            }
        }

        // Horizontal channel Y centers: rows+1 channels
        this.hChanY = []
        this.clbY = []   // top edge of each CLB row
        let yPos = 0
        for (let r = 0; r <= rows; r++) {
            this.hChanY.push(snap10(yPos))
            if (r < rows) {
                const clbTop = yPos + SB_SIZE / 2 + CH_GAP - 20
                this.clbY.push(snap10(clbTop))
                yPos = clbTop + CLB_H + CH_GAP + 20
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
        this.downDimensionY = totalH + this.offsetY + GLOBAL_STUB + 40
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

        // Global CLK and RST inputs below the FPGA
        const botEdge = this.offsetY + this.hChanY[this.rows] + SB_SIZE / 2
        const midX = this.offsetX + (this.vChanX[0] + this.vChanX[this.cols]) / 2
        this.clkNode = new Node(snap10(midX - 20), snap10(botEdge + GLOBAL_STUB), 0, this, 1, 'CLK')
        this.rstNode = new Node(snap10(midX + 20), snap10(botEdge + GLOBAL_STUB), 0, this, 1, 'RST')
    }

    // -- Save / Load ----------------------------------------------------------

    customSave() {
        return {
            constructorParamaters: [
                this.rows, this.cols,
                this.luts, this.muxSel,
                this.preSel, this.clrSel,
            ],
            nodes: {
                ioNodesLeft: this.ioNodesLeft.map(findNode),
                ioNodesRight: this.ioNodesRight.map(findNode),
                clkNode: findNode(this.clkNode),
                rstNode: findNode(this.rstNode),
            },
        }
    }

    // -- Resolve (placeholder) ------------------------------------------------

    resolve() {
        // Step 3: LUT evaluation, MUX routing, D-FF
    }

    // -- Click handling -------------------------------------------------------

    click() {
        const hit = this._hitCLB()
        if (!hit) return

        if (hit.type === 'lut') {
            this.luts[hit.key][hit.bit] ^= 1
            forceResetNodesSet(true)
        } else if (hit.type === 'mux') {
            this.muxSel[hit.key] ^= 1
            forceResetNodesSet(true)
        } else if (hit.type === 'pre') {
            this.preSel[hit.key] ^= 1
            forceResetNodesSet(true)
        } else if (hit.type === 'clr') {
            this.clrSel[hit.key] ^= 1
            forceResetNodesSet(true)
        }
    }

    /**
     * Hit-test: determine if the mouse is over a clickable CLB element.
     * Returns { type: 'lut', key, bit } or { type: 'mux', key } or null.
     */
    _hitCLB() {
        const mx = simulationArea.mouseXf - this.x - this.offsetX
        const my = simulationArea.mouseYf - this.y - this.offsetY

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const cx = this.clbX[c]
                const cy = this.clbY[r]
                const key = `${r},${c}`

                // Check LUT bit cells
                const bx = cx + LUT_X + LUT_ADDR_W
                const by = cy + LUT_Y
                for (let i = 0; i < N_LUT_ENTRIES; i++) {
                    const ry = by + i * LUT_ROW_H
                    if (mx >= bx && mx <= bx + LUT_BIT_W &&
                        my >= ry && my <= ry + LUT_ROW_H) {
                        return { type: 'lut', key, bit: i }
                    }
                }

                // Check output MUX SRAM cell
                const sx = cx + SRAM_X
                const sy = cy + SRAM_Y
                if (mx >= sx && mx <= sx + SRAM_SIZE &&
                    my >= sy && my <= sy + SRAM_SIZE) {
                    return { type: 'mux', key }
                }

                // Check PRE/CLR SRAM cells
                for (const cfg of [
                    { type: 'pre', muxX: PRE_MUX_X, sramY: PRE_SRAM_Y },
                    { type: 'clr', muxX: CLR_MUX_X, sramY: CLR_SRAM_Y },
                ]) {
                    const rsx = cx + cfg.muxX - 2
                    const rsy = cy + cfg.sramY
                    if (mx >= rsx && mx <= rsx + RC_SRAM_SIZE &&
                        my >= rsy && my <= rsy + RC_SRAM_SIZE) {
                        return { type: cfg.type, key }
                    }
                }
            }
        }
        return null
    }

    /** Suppress drag/selection highlight when clicking inside CLBs. */
    _mouseInGrid() {
        return this._hitCLB() !== null
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
        this._drawGlobalInputs(ctx, ox, oy)
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

    /** CLB boxes with internal components. */
    _drawCLBs(ctx, ox, oy) {
        const s = globalScope.scale
        const xx = this.x + ox
        const yy = this.y + oy
        const hover = this._hitCLB()

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const cx = this.clbX[c]
                const cy = this.clbY[r]
                const px = (xx + cx) * s + globalScope.ox
                const py = (yy + cy) * s + globalScope.oy
                const key = `${r},${c}`

                // Dashed border
                ctx.strokeStyle = colors['stroke']
                ctx.lineWidth = correctWidth(1)
                ctx.setLineDash([5 * s, 3 * s])
                ctx.strokeRect(px, py, CLB_W * s, CLB_H * s)
                ctx.setLineDash([])

                // CLB label
                ctx.fillStyle = colors['text']
                ctx.textAlign = 'center'
                ctx.textBaseline = 'top'
                ctx.font = `${Math.round(8 * s)}px sans-serif`
                ctx.fillText(`CLB (${r},${c})`, px + (CLB_W / 2) * s, py + 1 * s)

                this._drawLUT(ctx, px, py, s, key, hover)
                this._drawFF(ctx, px, py, s)
                this._drawMux(ctx, px, py, s, key, hover)
                this._drawPreClrMuxes(ctx, px, py, s, key, hover)
                this._drawCLBWiring(ctx, px, py, s)
            }
        }
    }

    /** LUT truth table inside a CLB. px,py = CLB top-left in screen coords. */
    _drawLUT(ctx, px, py, s, key, hover) {
        const bits = this.luts[key]
        const nRows = N_LUT_ENTRIES
        const x0 = px + LUT_X * s
        const y0 = py + LUT_Y * s

        // "LUT" label
        ctx.fillStyle = colors['text']
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.font = `${Math.round(7 * s)}px sans-serif`
        ctx.fillText('LUT', x0 + ((LUT_ADDR_W + LUT_BIT_W) / 2) * s, py + LUT_LABEL_Y * s)

        for (let i = 0; i < nRows; i++) {
            const ry = y0 + i * LUT_ROW_H * s

            // Address cell
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(0.5)
            ctx.fillStyle = colors['fill']
            ctx.fillRect(x0, ry, LUT_ADDR_W * s, LUT_ROW_H * s)
            ctx.strokeRect(x0, ry, LUT_ADDR_W * s, LUT_ROW_H * s)

            // Address text
            ctx.fillStyle = colors['text']
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.font = `${Math.round(7 * s)}px monospace`
            ctx.fillText(
                i.toString(2).padStart(N_INPUTS, '0'),
                x0 + (LUT_ADDR_W / 2) * s,
                ry + (LUT_ROW_H / 2) * s
            )

            // Bit cell (clickable)
            const bx = x0 + LUT_ADDR_W * s
            const isHover = hover && hover.type === 'lut' && hover.key === key && hover.bit === i
            ctx.fillStyle = isHover ? colors['hover_select'] : colors['fill']
            ctx.fillRect(bx, ry, LUT_BIT_W * s, LUT_ROW_H * s)
            ctx.strokeRect(bx, ry, LUT_BIT_W * s, LUT_ROW_H * s)

            // Bit value
            ctx.fillStyle = colors['text']
            ctx.font = `${Math.round(8 * s)}px monospace`
            ctx.fillText(
                bits[i].toString(),
                bx + (LUT_BIT_W / 2) * s,
                ry + (LUT_ROW_H / 2) * s
            )
        }
    }

    /** D Flip-Flop box inside a CLB. */
    _drawFF(ctx, px, py, s) {
        const fx = px + FF_X * s
        const fy = py + FF_Y * s
        const midX = fx + (FF_W / 2) * s

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1)
        ctx.fillStyle = colors['fill']
        ctx.fillRect(fx, fy, FF_W * s, FF_H * s)
        ctx.strokeRect(fx, fy, FF_W * s, FF_H * s)

        ctx.fillStyle = colors['text']
        ctx.font = `${Math.round(7 * s)}px sans-serif`
        ctx.textBaseline = 'middle'

        // "D" label (left side)
        ctx.textAlign = 'left'
        ctx.fillText('D', fx + 2 * s, fy + (FF_H * FF_DQ_REL) * s)

        // "Q" label (right side)
        ctx.textAlign = 'right'
        ctx.fillText('Q', fx + (FF_W - 2) * s, fy + (FF_H * FF_DQ_REL) * s)

        // Clock triangle
        const triSize = 4 * s
        const triX = fx
        const triY = fy + (FF_H * FF_CLK_REL) * s
        ctx.beginPath()
        ctx.moveTo(triX, triY - triSize)
        ctx.lineTo(triX + triSize, triY)
        ctx.lineTo(triX, triY + triSize)
        ctx.stroke()

        // PRE label (inside, top)
        ctx.fillStyle = colors['text']
        ctx.font = `${Math.round(5 * s)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText('PRE', midX, fy + 1 * s)

        // CLR label (inside, bottom)
        const botY = fy + FF_H * s
        ctx.textBaseline = 'bottom'
        ctx.fillText('CLR', midX, botY - 1 * s)
    }

    /** MUX (trapezoid shape) inside a CLB. */
    _drawMux(ctx, px, py, s, key, hover) {
        const mx = px + MUX_X * s
        const my = py + MUX_Y * s
        const taper = 5 * s  // how much narrower the top/bottom are

        // Trapezoid: wider on left (inputs), narrower on right (output)
        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1)
        ctx.fillStyle = colors['fill']
        ctx.beginPath()
        ctx.moveTo(mx, my)                              // top-left
        ctx.lineTo(mx + MUX_W * s, my + taper)          // top-right (narrower)
        ctx.lineTo(mx + MUX_W * s, my + MUX_H * s - taper)  // bottom-right
        ctx.lineTo(mx, my + MUX_H * s)                  // bottom-left
        ctx.closePath()
        ctx.fill()
        ctx.stroke()

        // "0" and "1" input labels
        ctx.fillStyle = colors['text']
        ctx.font = `${Math.round(6 * s)}px sans-serif`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText('0', mx + 1 * s, my + MUX_H * 0.25 * s)
        ctx.fillText('1', mx + 1 * s, my + MUX_H * 0.75 * s)

        // SRAM select cell
        const sx = px + SRAM_X * s
        const sy = py + SRAM_Y * s
        const isHover = hover && hover.type === 'mux' && hover.key === key
        ctx.fillStyle = isHover ? colors['hover_select'] : colors['fill']
        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(0.5)
        ctx.fillRect(sx, sy, SRAM_SIZE * s, SRAM_SIZE * s)
        ctx.strokeRect(sx, sy, SRAM_SIZE * s, SRAM_SIZE * s)

        // SRAM value
        ctx.fillStyle = colors['text']
        ctx.font = `${Math.round(8 * s)}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(
            this.muxSel[key].toString(),
            sx + (SRAM_SIZE / 2) * s,
            sy + (SRAM_SIZE / 2) * s
        )

        // Vertical line from SRAM to MUX bottom
        const midX = px + (SRAM_X + SRAM_SIZE / 2) * s
        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(0.5)
        ctx.beginPath()
        ctx.moveTo(midX, sy)
        ctx.lineTo(midX, my + MUX_H * s)
        ctx.stroke()
    }

    /** Internal wiring: LUT -> fork -> FF.D and MUX.0, FF.Q -> MUX.1, MUX.out -> CLB out */
    _drawCLBWiring(ctx, px, py, s) {
        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(0.5)

        // LUT output to fork point
        const lutOutX = px + (LUT_X + LUT_ADDR_W + LUT_BIT_W) * s
        const lutOutY = py + (LUT_Y + (N_LUT_ENTRIES * LUT_ROW_H) / 2) * s
        const forkX = px + (LUT_X + LUT_ADDR_W + LUT_BIT_W + 8) * s
        ctx.beginPath()
        ctx.moveTo(lutOutX, lutOutY)
        ctx.lineTo(forkX, lutOutY)
        ctx.stroke()

        // Fork dot
        ctx.fillStyle = colors['stroke']
        ctx.beginPath()
        ctx.arc(forkX, lutOutY, 2 * s, 0, 2 * Math.PI)
        ctx.fill()

        // Fork to FF.D
        const ffDY = py + (FF_Y + FF_H * FF_DQ_REL) * s
        const ffDX = px + FF_X * s
        ctx.beginPath()
        ctx.moveTo(forkX, lutOutY)
        ctx.lineTo(forkX, ffDY)
        ctx.lineTo(ffDX, ffDY)
        ctx.stroke()

        // Fork to MUX input 0 (combinatorial bypass)
        const mux0Y = py + (MUX_Y + MUX_H * 0.25) * s
        const muxLeftX = px + MUX_X * s
        ctx.beginPath()
        ctx.moveTo(forkX, lutOutY)
        ctx.lineTo(forkX, mux0Y)
        ctx.lineTo(muxLeftX, mux0Y)
        ctx.stroke()

        // FF.Q to MUX input 1
        const ffQX = px + (FF_X + FF_W) * s
        const ffQY = py + (FF_Y + FF_H * FF_DQ_REL) * s
        const mux1Y = py + (MUX_Y + MUX_H * 0.75) * s
        ctx.beginPath()
        ctx.moveTo(ffQX, ffQY)
        ctx.lineTo(ffQX + 4 * s, ffQY)
        ctx.lineTo(ffQX + 4 * s, mux1Y)
        ctx.lineTo(muxLeftX, mux1Y)
        ctx.stroke()

        // MUX output to CLB right edge
        const muxOutX = px + (MUX_X + MUX_W) * s
        const muxOutY = py + (MUX_Y + MUX_H / 2) * s
        const clbRightX = px + CLB_W * s
        ctx.beginPath()
        ctx.moveTo(muxOutX, muxOutY)
        ctx.lineTo(clbRightX, muxOutY)
        ctx.stroke()

        // CLK input: from CLB left edge to FF clock input
        const clkY = py + CLB_CLK_Y * s
        const clbLeftX = px
        const ffClkX = px + FF_X * s
        const ffClkY = py + (FF_Y + FF_H * FF_CLK_REL) * s
        ctx.beginPath()
        ctx.moveTo(clbLeftX, clkY)
        ctx.lineTo(clbLeftX - 5 * s, clkY)  // small stub outside CLB
        ctx.stroke()
        // Wire from input to FF clock
        ctx.beginPath()
        ctx.moveTo(clbLeftX, clkY)
        ctx.lineTo(ffClkX - 4 * s, clkY)
        ctx.lineTo(ffClkX - 4 * s, ffClkY)
        ctx.lineTo(ffClkX, ffClkY)
        ctx.stroke()
        // Label
        ctx.fillStyle = colors['text']
        ctx.font = `${Math.round(7 * s)}px sans-serif`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText('CLK', clbLeftX - 6 * s, clkY)

        // RST input: from CLB left edge, connects to PRE/CLR mux "1" inputs
        const rstY = py + CLB_RST_Y * s
        ctx.strokeStyle = colors['stroke']
        ctx.beginPath()
        ctx.moveTo(clbLeftX, rstY)
        ctx.lineTo(clbLeftX - 5 * s, rstY)
        ctx.stroke()
        // Label
        ctx.fillStyle = colors['text']
        ctx.textAlign = 'right'
        ctx.fillText('RST', clbLeftX - 6 * s, rstY)
    }

    /** PRE/CLR muxes with SRAM cells inside a CLB. */
    _drawPreClrMuxes(ctx, px, py, s, key, hover) {
        const configs = [
            { muxX: PRE_MUX_X, muxY: PRE_MUX_Y, sramY: PRE_SRAM_Y, sel: this.preSel[key], type: 'pre', sramBelow: true },
            { muxX: CLR_MUX_X, muxY: CLR_MUX_Y, sramY: CLR_SRAM_Y, sel: this.clrSel[key], type: 'clr', sramBelow: false },
        ]

        for (const cfg of configs) {
            const mx = px + cfg.muxX * s
            const my = py + cfg.muxY * s
            const taper = 2 * s

            // Small trapezoid mux
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(0.5)
            ctx.fillStyle = colors['fill']
            ctx.beginPath()
            ctx.moveTo(mx, my)
            ctx.lineTo(mx + RC_MUX_W * s, my + taper)
            ctx.lineTo(mx + RC_MUX_W * s, my + RC_MUX_H * s - taper)
            ctx.lineTo(mx, my + RC_MUX_H * s)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()

            // "0" and "1" labels on mux inputs
            ctx.fillStyle = colors['text']
            ctx.font = `${Math.round(5 * s)}px sans-serif`
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.fillText('0', mx + 1 * s, my + RC_MUX_H * 0.25 * s)
            ctx.fillText('1', mx + 1 * s, my + RC_MUX_H * 0.75 * s)

            // SRAM cell at explicit position
            const sx = mx - 2 * s
            const sy = py + cfg.sramY * s
            const isHover = hover && hover.type === cfg.type && hover.key === key
            ctx.fillStyle = isHover ? colors['hover_select'] : colors['fill']
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(0.5)
            ctx.fillRect(sx, sy, RC_SRAM_SIZE * s, RC_SRAM_SIZE * s)
            ctx.strokeRect(sx, sy, RC_SRAM_SIZE * s, RC_SRAM_SIZE * s)

            // SRAM value
            ctx.fillStyle = colors['text']
            ctx.font = `${Math.round(6 * s)}px monospace`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(
                cfg.sel.toString(),
                sx + (RC_SRAM_SIZE / 2) * s,
                sy + (RC_SRAM_SIZE / 2) * s
            )

            // Vertical line from SRAM to MUX
            const sramMidX = sx + (RC_SRAM_SIZE / 2) * s
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(0.5)
            ctx.beginPath()
            if (cfg.sramBelow) {
                ctx.moveTo(sramMidX, sy)
                ctx.lineTo(sramMidX, my + RC_MUX_H * s)
            } else {
                ctx.moveTo(sramMidX, sy + RC_SRAM_SIZE * s)
                ctx.lineTo(sramMidX, my)
            }
            ctx.stroke()

            // Mux output line to FF PRE/CLR
            const muxOutX = mx + RC_MUX_W * s
            const muxOutY = my + (RC_MUX_H / 2) * s
            const ffMidX = px + (FF_X + FF_W / 2) * s
            ctx.beginPath()
            ctx.moveTo(muxOutX, muxOutY)
            ctx.lineTo(ffMidX, muxOutY)
            if (cfg.type === 'pre') {
                ctx.lineTo(ffMidX, py + FF_Y * s)
            } else {
                ctx.lineTo(ffMidX, py + (FF_Y + FF_H) * s)
            }
            ctx.stroke()

            // Input 0: short stub from left (constant 0)
            const in0Y = my + RC_MUX_H * 0.25 * s
            ctx.beginPath()
            ctx.moveTo(mx, in0Y)
            ctx.lineTo(mx - 6 * s, in0Y)
            ctx.stroke()

            ctx.fillStyle = colors['text']
            ctx.font = `${Math.round(5 * s)}px sans-serif`
            ctx.textAlign = 'right'
            ctx.textBaseline = 'middle'
            ctx.fillText('0', mx - 7 * s, in0Y)

            // Input 1: stub from left labeled "RST" (connected from CLB RST input)
            const in1Y = my + RC_MUX_H * 0.75 * s
            const rstInputX = px  // CLB left edge
            ctx.strokeStyle = colors['stroke']
            ctx.beginPath()
            ctx.moveTo(mx, in1Y)
            ctx.lineTo(mx - 6 * s, in1Y)
            ctx.stroke()

            ctx.fillStyle = colors['text']
            ctx.textAlign = 'right'
            ctx.fillText('RST', mx - 7 * s, in1Y)
        }
    }

    /** Global CLK and RST input stubs below the FPGA. */
    _drawGlobalInputs(ctx, ox, oy) {
        const s = globalScope.scale
        const xx = this.x + ox
        const yy = this.y + oy

        const botEdge = this.hChanY[this.rows] + SB_SIZE / 2
        const midX = (this.vChanX[0] + this.vChanX[this.cols]) / 2

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1)

        // CLK stub
        const clkX = snap10(midX - 20)
        ctx.beginPath()
        ctx.moveTo((xx + clkX) * s + globalScope.ox, (yy + botEdge) * s + globalScope.oy)
        ctx.lineTo((xx + clkX) * s + globalScope.ox, (yy + botEdge + GLOBAL_STUB) * s + globalScope.oy)
        ctx.stroke()

        ctx.fillStyle = colors['text']
        ctx.font = `${Math.round(10 * s)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText('CLK', (xx + clkX) * s + globalScope.ox, (yy + botEdge + GLOBAL_STUB + 2) * s + globalScope.oy)

        // RST stub
        const rstX = snap10(midX + 20)
        ctx.strokeStyle = colors['stroke']
        ctx.beginPath()
        ctx.moveTo((xx + rstX) * s + globalScope.ox, (yy + botEdge) * s + globalScope.oy)
        ctx.lineTo((xx + rstX) * s + globalScope.ox, (yy + botEdge + GLOBAL_STUB) * s + globalScope.oy)
        ctx.stroke()

        ctx.fillStyle = colors['text']
        ctx.fillText('RST', (xx + rstX) * s + globalScope.ox, (yy + botEdge + GLOBAL_STUB + 2) * s + globalScope.oy)
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
FPGA.prototype.constructorParametersDefault = [2, 2, null, null, null, null]

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
