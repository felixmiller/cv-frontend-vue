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
const CLB_W = 140                  // CLB box width
const CLB_H = 110                  // CLB box height
const SB_SIZE = 40                 // switch box size
const H_WIRE_COUNT = 4             // horizontal wires per channel
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
const FF_CLK_REL = 1 - FF_DQ_REL   // Clock input relative Y (symmetric with D from bottom)

const MUX_X = 122                  // MUX box left edge within CLB
const MUX_Y = 12                   // MUX box top edge within CLB
const MUX_W = 12                   // MUX box width
const MUX_H = 48                   // MUX box height (tapered shape)

const SRAM_X = 122                 // SRAM cell left edge within CLB (aligned with MUX center)
const SRAM_Y = 70                  // SRAM cell top edge within CLB
const SRAM_SIZE = 12               // SRAM cell size

// PRE/CLR mux layout (small muxes between LUT and FF)
const PRE_MUX_X = 70               // PRE mux left edge within CLB
const CLR_MUX_X = 70               // CLR mux left edge within CLB
const RC_MUX_W = 8                 // PRE/CLR mux width
const RC_MUX_H = 14                // PRE/CLR mux height
const RC_SRAM_SIZE = 8             // PRE/CLR SRAM cell size
// PRE: SRAM below, mux above. Anchor = SRAM top Y
const PRE_SRAM_Y = 44              // PRE SRAM cell top within CLB
const PRE_MUX_Y = PRE_SRAM_Y - 2 - RC_MUX_H  // mux sits just above SRAM
// CLK/RST input positions within CLB (left edge, below LUT)
const CLB_CLK_Y = 96               // CLK input Y within CLB
const CLB_RST_Y = 104              // RST input Y within CLB

// CLR: SRAM above, mux below. Anchor = mux input 1 aligned with CLB_RST_Y
const CLR_MUX_Y = CLB_RST_Y - RC_MUX_H * 0.75  // input 1 aligns with RST line
const CLR_SRAM_Y = CLR_MUX_Y - 2 - RC_SRAM_SIZE  // SRAM sits just above mux

// Global signal inputs
const GLOBAL_STUB = 20             // stub length for CLK/RST labels

/** Round to nearest 10 (canvas grid). */
const snap10 = v => Math.round(v / 10) * 10

export default class FPGA extends CircuitElement {
    constructor(
        x, y, scope = globalScope,
        rows = 2, cols = 2,
        luts = null, muxSel = null,
        preSel = null, clrSel = null,
        sbMuxes = null
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
        // SB mux configs: { "vi,hi": { "portName": selectedInput (0=n.c., 1..N=input index) } }
        this.sbMuxes = sbMuxes || this._defaultSbMuxes()

        // UI state for SB interaction (not saved)
        this.activeSB = null          // { vi, hi } of the magnified SB, or null
        this.activePort = null        // selected output port name in the magnified SB, or null

        // Simulation state per CLB (not saved, rebuilt on resolve)
        this.ffState = {}             // { "r,c": latched Q value }
        this.ffMasterState = {}       // { "r,c": master latch value }
        this.prevClk = undefined      // previous clock value for edge detection
        this.simErrors = []           // error messages from last resolve

        this._initSimState()
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

    _initSimState() {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const key = `${r},${c}`
                if (this.ffState[key] === undefined) this.ffState[key] = 0
                if (this.ffMasterState[key] === undefined) this.ffMasterState[key] = 0
            }
        }
    }

    /**
     * Get the port definitions for a switch box at position (vi, hi).
     * Returns { inputs: [...], outputs: [...], all: [...] }
     * Each port: { name, side, wireIdx, isOutput }
     *
     * Variants by position:
     *   Central (0<vi<cols, 0<hi<rows): T/B=4 wires (w0=in, w1-3=out), L/R=4 interleaved
     *   Top/Bottom edge: missing T or B ports respectively
     *   Left edge (vi=0): T/B=3 wires (all outputs), L=1 input (I/O pin)
     *   Right edge (vi=cols): T/B=1 wire (input only), R=1 output (I/O pin)
     *   Corners: combinations of the above
     */
    _sbPorts(vi, hi) {
        const ports = []
        const nv = this._vWireCount(vi)
        const isTop = hi === 0
        const isBot = hi === this.rows
        const isLeft = vi === 0
        const isRight = vi === this.cols

        // Top vertical ports (skip if at top edge)
        if (!isTop) {
            for (let w = 0; w < nv; w++) {
                if (isLeft) {
                    // Leftmost channel: all wires are CLB inputs → outputs from SB
                    ports.push({ name: `T${w}`, side: 'T', wireIdx: w, isOutput: true })
                } else if (isRight) {
                    // Rightmost channel: 1 wire = CLB output → input to SB
                    ports.push({ name: `T${w}`, side: 'T', wireIdx: w, isOutput: false })
                } else {
                    // Interior: wire 0 = input (CLB output), rest = outputs (CLB inputs)
                    ports.push({ name: `T${w}`, side: 'T', wireIdx: w, isOutput: w > 0 })
                }
            }
        }

        // Bottom vertical ports (skip if at bottom edge)
        if (!isBot) {
            for (let w = 0; w < nv; w++) {
                if (isLeft) {
                    ports.push({ name: `B${w}`, side: 'B', wireIdx: w, isOutput: true })
                } else if (isRight) {
                    ports.push({ name: `B${w}`, side: 'B', wireIdx: w, isOutput: false })
                } else {
                    ports.push({ name: `B${w}`, side: 'B', wireIdx: w, isOutput: w > 0 })
                }
            }
        }

        // Left horizontal ports
        if (isLeft) {
            // Left edge: single input port (I/O pin)
            ports.push({ name: 'L0', side: 'L', wireIdx: 0, isOutput: false })
        } else {
            // Interior/right: 4 wires interleaved
            // Even wires go right: input on left side
            // Odd wires go left: output on left side
            for (let w = 0; w < H_WIRE_COUNT; w++) {
                ports.push({ name: `L${w}`, side: 'L', wireIdx: w, isOutput: w % 2 === 1 })
            }
        }

        // Right horizontal ports
        if (isRight) {
            // Right edge: single output port (I/O pin)
            ports.push({ name: 'R0', side: 'R', wireIdx: 0, isOutput: true })
        } else {
            // Interior/left: 4 wires interleaved
            // Even wires go right: output on right side
            // Odd wires go left: input on right side
            for (let w = 0; w < H_WIRE_COUNT; w++) {
                ports.push({ name: `R${w}`, side: 'R', wireIdx: w, isOutput: w % 2 === 0 })
            }
        }

        const inputs = ports.filter(p => !p.isOutput)
        const outputs = ports.filter(p => p.isOutput)
        return { inputs, outputs, all: ports }
    }

    /** Default SB muxes: all outputs set to 0 (n.c.) */
    _defaultSbMuxes() {
        const sbs = {}
        for (let vi = 0; vi <= this.cols; vi++) {
            for (let hi = 0; hi <= this.rows; hi++) {
                const { outputs } = this._sbPorts(vi, hi)
                const muxes = {}
                for (const p of outputs) muxes[p.name] = 0  // n.c.
                sbs[`${vi},${hi}`] = muxes
            }
        }
        return sbs
    }

    /**
     * Get the pixel position of a port within the SB box.
     * Returns { x, y } relative to SB center, in circuit units.
     */
    _sbPortPos(vi, port) {
        const half = SB_SIZE / 2
        const nv = this._vWireCount(vi)
        const vBw = (nv - 1) * WIRE_PITCH
        const hBw = (H_WIRE_COUNT - 1) * WIRE_PITCH
        const isLeft = vi === 0
        const isRight = vi === this.cols

        if (port.side === 'T' || port.side === 'B') {
            const x = -vBw / 2 + port.wireIdx * WIRE_PITCH
            const y = port.side === 'T' ? -half : half
            return { x, y }
        } else {
            const x = port.side === 'L' ? -half : half
            // Edge SBs with single L/R port: center it
            if ((isLeft && port.side === 'L') || (isRight && port.side === 'R')) {
                return { x, y: 0 }
            }
            const y = -hBw / 2 + port.wireIdx * WIRE_PITCH
            return { x, y }
        }
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
                const clbLeft = x + SB_SIZE / 2 + CH_GAP - 10
                this.clbX.push(snap10(clbLeft))
                x = clbLeft + CLB_W + CH_GAP + 10
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
        this.downDimensionY = totalH + this.offsetY + GLOBAL_STUB + 40
    }

    /** Number of vertical wires in channel vi. */
    _vWireCount(vi) {
        if (vi === 0) return this.nInputs              // left: CLB inputs only
        if (vi < this.cols) return this.nInputs + 1    // interior: CLB output + inputs
        return 1                                        // right: CLB output only
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
                new Node(leftX, ny, 0, this, 1, `IN${hi}`)
            )
            this.ioNodesRight.push(
                new Node(rightX, ny, 1, this, 1, `OUT${hi}`)
            )
        }

        // Global CLK and RST inputs on left edge, between IN0 and IN1
        // Same X as I/O nodes (no extra border pad offset)
        const leftX = this.offsetX + this.vChanX[0] - SB_SIZE / 2 - IO_STUB
        const midY = this.offsetY + (this.hChanY[0] + this.hChanY[Math.min(1, this.rows)]) / 2
        this.clkNode = new Node(snap10(leftX), snap10(midY - 10), 0, this, 1, 'CLK')
        this.rstNode = new Node(snap10(leftX), snap10(midY + 10), 0, this, 1, 'RST')
    }

    // -- Save / Load ----------------------------------------------------------

    customSave() {
        return {
            constructorParamaters: [
                this.rows, this.cols,
                this.luts, this.muxSel,
                this.preSel, this.clrSel,
                this.sbMuxes,
            ],
            nodes: {
                ioNodesLeft: this.ioNodesLeft.map(findNode),
                ioNodesRight: this.ioNodesRight.map(findNode),
                clkNode: findNode(this.clkNode),
                rstNode: findNode(this.rstNode),
            },
        }
    }

    // -- Simulation -----------------------------------------------------------

    resolve() {
        this.simErrors = []

        // Wire value map: "wireType:channel:wireIdx:segment" → value
        // Vertical wire segments: "v:vi:w:hi" (between h-channel hi and hi+1)
        // Horizontal wire segments: "h:hi:w:vi" (between v-channel vi and vi+1)
        const wires = {}
        const wireDrivers = {}  // tracks who drives each wire (for collision detection)

        const setWire = (id, val, source) => {
            if (wireDrivers[id] && wireDrivers[id] !== source) {
                this.simErrors.push(`Collision on wire ${id}: driven by ${wireDrivers[id]} and ${source}`)
                wires[id] = undefined
                return
            }
            wireDrivers[id] = source
            wires[id] = val
        }

        const getWire = (id) => wires[id] !== undefined ? wires[id] : undefined

        // -- 1. Read external inputs into left-edge vertical wire segments --
        // Left I/O pins feed into the left SB (vi=0) horizontal channels
        // Actually, I/O pins connect to the SB's L0 port. But the routing
        // goes through the SB muxes. We model it differently:
        // Each I/O input drives a special wire "io:left:hi"
        // Each I/O output reads from a special wire "io:right:hi"
        for (let hi = 0; hi <= this.rows; hi++) {
            const val = this.ioNodesLeft[hi].value
            setWire(`io:left:${hi}`, val !== undefined ? val : undefined, `IN${hi}`)
        }

        // CLK and RST global signals
        const clkVal = this.clkNode.value
        const rstVal = this.rstNode.value

        // -- 2. Evaluate CLBs (combinatorial outputs first) --
        // CLB outputs drive vertical wire segments.
        // CLB inputs come from vertical wire segments.
        // We need to propagate through SBs to connect them.
        //
        // Strategy: iterative propagation.
        // 1. Seed: CLB registered outputs (from previous cycle), I/O inputs
        // 2. Propagate through all SBs
        // 3. Evaluate CLBs (compute combinatorial outputs)
        // 4. Propagate CLB outputs through SBs
        // 5. Repeat until stable (max iterations to catch loops)

        const MAX_ITER = 20
        let changed = true
        let iter = 0

        // Seed: CLB registered outputs from previous state (for feedback paths)
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const key = `${r},${c}`
                if (this.muxSel[key] === 1) {
                    // Registered mode: use previous FF state as initial output
                    const vi_out = c + 1
                    setWire(`v:${vi_out}:0:${r}`, this.ffState[key], `CLB(${r},${c})`)
                }
            }
        }

        while (changed && iter < MAX_ITER) {
            changed = false
            iter++

            // -- Propagate through switch boxes --
            for (let vi = 0; vi <= this.cols; vi++) {
                for (let hi = 0; hi <= this.rows; hi++) {
                    const sbKey = `${vi},${hi}`
                    const muxes = this.sbMuxes[sbKey]
                    if (!muxes) continue
                    const { inputs, outputs } = this._sbPorts(vi, hi)

                    for (const outPort of outputs) {
                        const selIdx = muxes[outPort.name]
                        if (!selIdx || selIdx === 0) continue  // n.c.
                        const inPort = inputs[selIdx - 1]
                        if (!inPort) continue

                        // Resolve input wire value
                        const inWire = this._portToWire(vi, hi, inPort, 'in')
                        const outWire = this._portToWire(vi, hi, outPort, 'out')
                        if (!inWire || !outWire) continue

                        const inVal = getWire(inWire)
                        if (inVal === undefined) continue

                        const oldVal = getWire(outWire)
                        if (oldVal !== inVal) {
                            setWire(outWire, inVal, `SB(${vi},${hi}):${outPort.name}`)
                            changed = true
                        }
                    }
                }
            }

            // -- Evaluate CLBs --
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    const key = `${r},${c}`
                    const vi_in = c       // input channel
                    const vi_out = c + 1  // output channel
                    const nw_in = this._vWireCount(vi_in)

                    // Read LUT inputs from vertical wires
                    // MSB (in0) = leftmost wire, LSB (in2) = rightmost wire
                    const firstWire = nw_in - N_INPUTS
                    let addr = 0
                    let allDefined = true
                    for (let i = 0; i < N_INPUTS; i++) {
                        const wireIdx = firstWire + i
                        // Wire segment between h-channel r and r+1 (the row this CLB sits in)
                        const wId = `v:${vi_in}:${wireIdx}:${r}`
                        const v = getWire(wId)
                        if (v === undefined) {
                            allDefined = false
                        } else {
                            // in0 is MSB (weight 4), in2 is LSB (weight 1)
                            addr |= (v & 1) << (N_INPUTS - 1 - i)
                        }
                    }

                    // LUT output
                    const lutBits = this.luts[key]
                    const lutOut = allDefined ? (lutBits[addr] || 0) : undefined

                    // PRE/CLR mux: 0=const 0, 1=RST signal
                    const preActive = this.preSel[key] === 1 ? (rstVal || 0) : 0
                    const clrActive = this.clrSel[key] === 1 ? (rstVal || 0) : 0

                    // D-FF with master-slave behavior
                    // Async preset/clear override
                    if (clrActive) {
                        this.ffMasterState[key] = this.ffState[key] = 0
                    } else if (preActive) {
                        this.ffMasterState[key] = this.ffState[key] = 1
                    } else if (clkVal !== undefined) {
                        // Positive-edge triggered master-slave
                        if (clkVal === 0) {
                            // Clock inactive: sample D into master
                            if (lutOut !== undefined) {
                                this.ffMasterState[key] = lutOut
                            }
                        } else if (this.prevClk === 0) {
                            // Rising edge: transfer master to slave
                            this.ffState[key] = this.ffMasterState[key]
                        }
                    }

                    // Output MUX: 0=combinatorial (LUT out), 1=registered (FF Q)
                    const clbOut = this.muxSel[key] === 1 ? this.ffState[key] : lutOut

                    // Drive CLB output onto vertical wire
                    const outWire = `v:${vi_out}:0:${r}`
                    const oldOut = getWire(outWire)
                    if (clbOut !== undefined && oldOut !== clbOut) {
                        setWire(outWire, clbOut, `CLB(${r},${c})`)
                        changed = true
                    }
                }
            }
        }

        // Update clock edge detection
        this.prevClk = clkVal

        if (iter >= MAX_ITER) {
            this.simErrors.push('Routing did not converge (possible circular dependency)')
        }

        // -- 3. Write output nodes --
        for (let hi = 0; hi <= this.rows; hi++) {
            // Right I/O reads from the right-edge SB's R0 output
            // That output is driven by SB mux routing — check the wire
            const outWire = `io:right:${hi}`
            const val = getWire(outWire)
            if (this.ioNodesRight[hi].value !== val) {
                this.ioNodesRight[hi].value = val !== undefined ? val : undefined
                simulationArea.simulationQueue.add(this.ioNodesRight[hi])
            }
        }
    }

    /**
     * Map a switch box port to its wire segment ID.
     * direction: 'in' (wire entering the SB) or 'out' (wire leaving the SB)
     */
    _portToWire(vi, hi, port, direction) {
        const isLeft = vi === 0
        const isRight = vi === this.cols

        if (port.side === 'T') {
            // Top port: vertical wire in channel vi, segment above (between hi-1 and hi)
            if (hi === 0) return null
            return `v:${vi}:${port.wireIdx}:${hi - 1}`
        }
        if (port.side === 'B') {
            // Bottom port: vertical wire in channel vi, segment below (between hi and hi+1)
            if (hi >= this.rows) return null
            return `v:${vi}:${port.wireIdx}:${hi}`
        }
        if (port.side === 'L') {
            if (isLeft) {
                // Left edge: connects to I/O input
                return `io:left:${hi}`
            }
            // Interior: horizontal wire segment to the left (between vi-1 and vi)
            return `h:${hi}:${port.wireIdx}:${vi - 1}`
        }
        if (port.side === 'R') {
            if (isRight) {
                // Right edge: connects to I/O output
                return `io:right:${hi}`
            }
            // Interior: horizontal wire segment to the right (between vi and vi+1)
            return `h:${hi}:${port.wireIdx}:${vi}`
        }
        return null
    }

    // -- Click handling -------------------------------------------------------

    click() {
        // If magnified SB is active, handle clicks inside it first
        if (this.activeSB) {
            const sbHit = this._hitActiveSBPort()
            if (sbHit) {
                if (sbHit.type === 'port') {
                    const port = sbHit.port
                    if (port.isOutput) {
                        // Select/deselect output port
                        if (this.activePort === port.name) {
                            // Already selected — cycle the mux
                            const key = `${this.activeSB.vi},${this.activeSB.hi}`
                            const { inputs } = this._sbPorts(this.activeSB.vi, this.activeSB.hi)
                            const muxes = this.sbMuxes[key]
                            const cur = muxes[port.name] || 0
                            muxes[port.name] = (cur + 1) % (inputs.length + 1)  // 0=n.c., 1..N
                            forceResetNodesSet(true)
                        } else {
                            this.activePort = port.name
                        }
                    }
                }
                return
            }
            // Click outside magnified SB — close it
            this.activeSB = null
            this.activePort = null
            return
        }

        // Check if click is on an SB (normal size)
        const sbHit = this._hitSB()
        if (sbHit) {
            this.activeSB = sbHit
            this.activePort = null
            return
        }

        // Otherwise handle CLB clicks
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

    /** Hit-test: is the mouse over a normal-size switch box? */
    _hitSB() {
        const mx = simulationArea.mouseXf - this.x - this.offsetX
        const my = simulationArea.mouseYf - this.y - this.offsetY
        const half = SB_SIZE / 2

        for (let vi = 0; vi <= this.cols; vi++) {
            for (let hi = 0; hi <= this.rows; hi++) {
                const cx = this.vChanX[vi]
                const cy = this.hChanY[hi]
                if (mx >= cx - half && mx <= cx + half &&
                    my >= cy - half && my <= cy + half) {
                    return { vi, hi }
                }
            }
        }
        return null
    }

    /** Hit-test: is the mouse over a port in the active SB? */
    _hitActiveSBPort() {
        if (!this.activeSB) return null
        const { vi, hi } = this.activeSB
        const mx = simulationArea.mouseXf - this.x - this.offsetX
        const my = simulationArea.mouseYf - this.y - this.offsetY
        const cx = this.vChanX[vi]
        const cy = this.hChanY[hi]
        const { all } = this._sbPorts(vi, hi)
        const hitR = 5  // hit radius for ports

        for (const port of all) {
            const pos = this._sbPortPos(vi, port)
            const px = cx + pos.x
            const py = cy + pos.y
            if (Math.abs(mx - px) <= hitR && Math.abs(my - py) <= hitR) {
                return { type: 'port', port }
            }
        }
        return null
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
                    const rsx = cx + cfg.muxX + (RC_MUX_W - RC_SRAM_SIZE) / 2
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

    /** Suppress drag/selection highlight when clicking inside CLBs or SBs. */
    _mouseInGrid() {
        return this._hitCLB() !== null || this._hitSB() !== null || this.activeSB !== null
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
        this._drawCLBConnections(ctx, ox, oy)
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

        for (let vi = 0; vi <= this.cols; vi++) {
            for (let hi = 0; hi <= this.rows; hi++) {
                const cx = this.vChanX[vi]
                const cy = this.hChanY[hi]
                const sbPx = (xx + cx - half) * s + globalScope.ox
                const sbPy = (yy + cy - half) * s + globalScope.oy
                const sbCx = (xx + cx) * s + globalScope.ox
                const sbCy = (yy + cy) * s + globalScope.oy
                const key = `${vi},${hi}`
                const muxes = this.sbMuxes[key]
                const isActive = this.activeSB && this.activeSB.vi === vi && this.activeSB.hi === hi
                const { inputs, outputs, all } = this._sbPorts(vi, hi)

                // SB box
                ctx.strokeStyle = colors['stroke']
                ctx.lineWidth = correctWidth(isActive ? 2 : 1)
                ctx.fillStyle = colors['fill']
                ctx.fillRect(sbPx, sbPy, SB_SIZE * s, SB_SIZE * s)
                ctx.strokeRect(sbPx, sbPy, SB_SIZE * s, SB_SIZE * s)

                if (!muxes) continue

                // Draw active connections inside the SB
                for (const outPort of outputs) {
                    const selIdx = muxes[outPort.name]
                    if (!selIdx || selIdx === 0) continue  // n.c.
                    const inPort = inputs[selIdx - 1]
                    if (!inPort) continue
                    const from = this._sbPortPos(vi, inPort)
                    const to = this._sbPortPos(vi, outPort)

                    // Highlight the active port's connection in blue
                    const isSelectedConn = isActive && this.activePort === outPort.name
                    ctx.strokeStyle = isSelectedConn ? '#0066cc' : colors['stroke']
                    ctx.lineWidth = correctWidth(isSelectedConn ? 2 : 1)

                    const fx = sbCx + from.x * s
                    const fy = sbCy + from.y * s
                    const tx = sbCx + to.x * s
                    const ty = sbCy + to.y * s

                    if (inPort.side === outPort.side) {
                        // Same side: draw an arc bowing inward toward SB center
                        const midX = (fx + tx) / 2
                        const midY = (fy + ty) / 2
                        const dist = Math.sqrt((tx - fx) ** 2 + (ty - fy) ** 2)
                        const bulge = Math.max(dist * 0.5, 6 * s)
                        // Control point pushed toward SB center
                        let cpx = midX, cpy = midY
                        if (inPort.side === 'T') cpy += bulge
                        else if (inPort.side === 'B') cpy -= bulge
                        else if (inPort.side === 'L') cpx += bulge
                        else cpx -= bulge

                        ctx.beginPath()
                        ctx.moveTo(fx, fy)
                        ctx.quadraticCurveTo(cpx, cpy, tx, ty)
                        ctx.stroke()
                    } else {
                        ctx.beginPath()
                        ctx.moveTo(fx, fy)
                        ctx.lineTo(tx, ty)
                        ctx.stroke()
                    }
                }

                // When active, draw port indicators
                if (isActive) {
                    const portR = 3 * s

                    for (const port of all) {
                        const pos = this._sbPortPos(vi, port)
                        const px = sbCx + pos.x * s
                        const py = sbCy + pos.y * s

                        const isSelected = this.activePort === port.name
                        ctx.beginPath()
                        ctx.arc(px, py, portR, 0, 2 * Math.PI)
                        if (isSelected) {
                            ctx.fillStyle = colors['hover_select']
                        } else if (port.isOutput) {
                            ctx.fillStyle = '#aaddff'
                        } else {
                            ctx.fillStyle = colors['fill']
                        }
                        ctx.fill()
                        ctx.strokeStyle = colors['stroke']
                        ctx.lineWidth = correctWidth(0.5)
                        ctx.stroke()
                    }

                    // Show label for selected port
                    if (this.activePort && muxes) {
                        const selIdx = muxes[this.activePort] || 0
                        const label = selIdx === 0 ? 'n.c.' : inputs[selIdx - 1]?.name || '?'
                        ctx.fillStyle = colors['text']
                        ctx.font = `${Math.round(6 * s)}px sans-serif`
                        ctx.textAlign = 'center'
                        ctx.textBaseline = 'middle'
                        ctx.fillText(`${this.activePort}←${label}`, sbCx, sbCy)
                    }
                }
            }
        }

        // Draw direction arrows on wires near each SB
        this._drawSBArrows(ctx, xx, yy, s)
    }

    /** Small filled triangle arrow. dir: 'up','down','left','right' */
    _drawArrow(ctx, x, y, dir, size) {
        ctx.beginPath()
        if (dir === 'up') {
            ctx.moveTo(x, y - size); ctx.lineTo(x - size, y + size); ctx.lineTo(x + size, y + size)
        } else if (dir === 'down') {
            ctx.moveTo(x, y + size); ctx.lineTo(x - size, y - size); ctx.lineTo(x + size, y - size)
        } else if (dir === 'left') {
            ctx.moveTo(x - size, y); ctx.lineTo(x + size, y - size); ctx.lineTo(x + size, y + size)
        } else {
            ctx.moveTo(x + size, y); ctx.lineTo(x - size, y - size); ctx.lineTo(x - size, y + size)
        }
        ctx.closePath()
        ctx.fill()
    }

    /** Draw direction arrows on wires adjacent to switch boxes. */
    _drawSBArrows(ctx, xx, yy, s) {
        const half = SB_SIZE / 2
        const gap = 5  // 0.5 grid from SB edge
        const arrowSize = 1.5 * s

        ctx.fillStyle = colors['stroke']

        for (let vi = 0; vi <= this.cols; vi++) {
            for (let hi = 0; hi <= this.rows; hi++) {
                const cx = this.vChanX[vi]
                const cy = this.hChanY[hi]
                const { all } = this._sbPorts(vi, hi)

                for (const port of all) {
                    const pos = this._sbPortPos(vi, port)
                    const wx = (xx + cx + pos.x) * s + globalScope.ox
                    const wy = (yy + cy + pos.y) * s + globalScope.oy

                    // Arrow placed just outside the SB edge
                    if (port.side === 'T') {
                        const ay = wy - gap * s
                        // Input = arrow pointing into SB (down), output = pointing away (up)
                        this._drawArrow(ctx, wx, ay, port.isOutput ? 'up' : 'down', arrowSize)
                    } else if (port.side === 'B') {
                        const ay = wy + gap * s
                        this._drawArrow(ctx, wx, ay, port.isOutput ? 'down' : 'up', arrowSize)
                    } else if (port.side === 'L') {
                        const ax = wx - gap * s
                        this._drawArrow(ctx, ax, wy, port.isOutput ? 'left' : 'right', arrowSize)
                    } else {
                        const ax = wx + gap * s
                        this._drawArrow(ctx, ax, wy, port.isOutput ? 'right' : 'left', arrowSize)
                    }
                }
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

        // Vertical line from SRAM to MUX bottom (account for taper at center)
        const midX = px + (SRAM_X + SRAM_SIZE / 2) * s
        const muxBotAtCenter = my + MUX_H * s - taper / 2
        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(0.5)
        ctx.beginPath()
        ctx.moveTo(midX, sy)
        ctx.lineTo(midX, muxBotAtCenter)
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
        const ffMuxMidX = px + ((FF_X + FF_W + MUX_X) / 2) * s
        ctx.lineTo(ffMuxMidX, ffQY)
        ctx.lineTo(ffMuxMidX, mux1Y)
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
        // Vertical segment aligned with LUT output fork
        const clkVertX = forkX
        ctx.beginPath()
        ctx.moveTo(clbLeftX, clkY)
        ctx.lineTo(clbLeftX - 5 * s, clkY)  // small stub outside CLB
        ctx.stroke()
        // Wire from input to FF clock via vertical aligned with fork
        ctx.beginPath()
        ctx.moveTo(clbLeftX, clkY)
        ctx.lineTo(clkVertX, clkY)
        ctx.lineTo(clkVertX, ffClkY)
        ctx.lineTo(ffClkX, ffClkY)
        ctx.stroke()
        // Label
        ctx.fillStyle = colors['text']
        ctx.font = `${Math.round(7 * s)}px sans-serif`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText('CLK', clbLeftX - 6 * s, clkY)

        // RST input: from CLB left edge, vertical line connecting to PRE/CLR mux "1" inputs
        const rstY = py + CLB_RST_Y * s
        const rstVertX = forkX + 10 * s  // vertical RST bus, 1 grid right of CLK/fork
        const preMux1Y = py + (PRE_MUX_Y + RC_MUX_H * 0.75) * s
        ctx.strokeStyle = colors['stroke']
        ctx.beginPath()
        ctx.moveTo(clbLeftX, rstY)
        ctx.lineTo(clbLeftX - 5 * s, rstY)  // small stub outside CLB
        ctx.stroke()
        // Horizontal from input to vertical bus
        ctx.beginPath()
        ctx.moveTo(clbLeftX, rstY)
        ctx.lineTo(rstVertX, rstY)
        ctx.stroke()
        // Vertical bus up to PRE mux input
        ctx.beginPath()
        ctx.moveTo(rstVertX, rstY)
        ctx.lineTo(rstVertX, preMux1Y)
        ctx.stroke()
        // Connection dot at junction
        ctx.fillStyle = colors['stroke']
        ctx.beginPath()
        ctx.arc(rstVertX, rstY, 2 * s, 0, 2 * Math.PI)
        ctx.fill()
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

            // SRAM cell centered horizontally on mux
            const sx = mx + (RC_MUX_W - RC_SRAM_SIZE) / 2 * s
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

            // Vertical line from SRAM to MUX (account for taper at center)
            const sramMidX = sx + (RC_SRAM_SIZE / 2) * s
            const halfTaper = taper / 2  // taper at midpoint of trapezoid edge
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(0.5)
            ctx.beginPath()
            if (cfg.sramBelow) {
                ctx.moveTo(sramMidX, sy)
                ctx.lineTo(sramMidX, my + RC_MUX_H * s - halfTaper)
            } else {
                ctx.moveTo(sramMidX, sy + RC_SRAM_SIZE * s)
                ctx.lineTo(sramMidX, my + halfTaper)
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
            ctx.lineTo(mx - 4 * s, in0Y)
            ctx.stroke()

            ctx.fillStyle = colors['text']
            ctx.font = `${Math.round(5 * s)}px sans-serif`
            ctx.textAlign = 'right'
            ctx.textBaseline = 'middle'
            ctx.fillText('0', mx - 5 * s, in0Y)

            // Input 1: connected from RST vertical bus
            const in1Y = my + RC_MUX_H * 0.75 * s
            const rstBusX = px + (LUT_X + LUT_ADDR_W + LUT_BIT_W + 8 + 10) * s
            ctx.strokeStyle = colors['stroke']
            ctx.beginPath()
            ctx.moveTo(mx, in1Y)
            ctx.lineTo(rstBusX, in1Y)
            ctx.stroke()
        }
    }

    /** Global CLK and RST input stubs on the left edge. */
    _drawGlobalInputs(ctx, ox, oy) {
        const s = globalScope.scale
        const xx = this.x + ox
        const yy = this.y + oy

        const borderLeft = this.vChanX[0] - SB_SIZE / 2 - 5  // matches FPGA border pad
        const midY = (this.hChanY[0] + this.hChanY[Math.min(1, this.rows)]) / 2

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(1)

        // CLK stub (short line from node to FPGA border)
        const clkY = snap10(midY - 10)
        const nodeX = this.vChanX[0] - SB_SIZE / 2 - IO_STUB
        ctx.beginPath()
        ctx.moveTo((xx + nodeX) * s + globalScope.ox, (yy + clkY) * s + globalScope.oy)
        ctx.lineTo((xx + borderLeft) * s + globalScope.ox, (yy + clkY) * s + globalScope.oy)
        ctx.stroke()

        ctx.fillStyle = colors['text']
        ctx.font = `${Math.round(10 * s)}px sans-serif`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText('CLK', (xx + nodeX - 5) * s + globalScope.ox, (yy + clkY) * s + globalScope.oy)

        // RST stub (short line from node to FPGA border)
        const rstY = snap10(midY + 10)
        ctx.strokeStyle = colors['stroke']
        ctx.beginPath()
        ctx.moveTo((xx + nodeX) * s + globalScope.ox, (yy + rstY) * s + globalScope.oy)
        ctx.lineTo((xx + borderLeft) * s + globalScope.ox, (yy + rstY) * s + globalScope.oy)
        ctx.stroke()

        ctx.fillStyle = colors['text']
        ctx.fillText('RST', (xx + nodeX - 5) * s + globalScope.ox, (yy + rstY) * s + globalScope.oy)
    }

    /** Fixed connections between CLB pins and vertical channel wires. */
    _drawCLBConnections(ctx, ox, oy) {
        const s = globalScope.scale
        const xx = this.x + ox
        const yy = this.y + oy
        const halfSB = SB_SIZE / 2
        const DOT_R = 3

        // LUT input Y positions within CLB (at horizontal lines of the table)
        // in0=MSB at row boundary 3, in1 at boundary 4 (center), in2=LSB at boundary 5
        const inY = [
            LUT_Y + 3 * LUT_ROW_H,  // in0 (MSB)
            LUT_Y + 4 * LUT_ROW_H,  // in1
            LUT_Y + 5 * LUT_ROW_H,  // in2 (LSB)
        ]
        // CLB output Y (matches MUX output in _drawCLBWiring)
        const outY = MUX_Y + MUX_H / 2

        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(0.5)

        for (let r = 0; r < this.rows; r++) {
            const clbCY = this.clbY[r]

            for (let c = 0; c < this.cols; c++) {
                const clbCX = this.clbX[c]

                // --- Inputs: connect from left vertical channel ---
                const vi_in = c  // channel to the left of column c
                const nw_in = this._vWireCount(vi_in)
                const bw_in = (nw_in - 1) * WIRE_PITCH
                const baseX_in = this.vChanX[vi_in] - bw_in / 2

                // Pick the rightmost N_INPUTS wires from this channel
                const firstInputWire = nw_in - N_INPUTS
                for (let i = 0; i < N_INPUTS; i++) {
                    const wireIdx = firstInputWire + i
                    const wx = baseX_in + wireIdx * WIRE_PITCH
                    const pinY = clbCY + inY[i]
                    const clbLeft = clbCX + LUT_X  // LUT left edge

                    // Horizontal line from wire to LUT left edge
                    const pWx = (xx + wx) * s + globalScope.ox
                    const pPinY = (yy + pinY) * s + globalScope.oy
                    const pClbLeft = (xx + clbLeft) * s + globalScope.ox
                    ctx.beginPath()
                    ctx.moveTo(pWx, pPinY)
                    ctx.lineTo(pClbLeft, pPinY)
                    ctx.stroke()

                    // Connection dot on the vertical wire
                    ctx.fillStyle = colors['stroke']
                    ctx.beginPath()
                    ctx.arc(pWx, pPinY, DOT_R * s, 0, 2 * Math.PI)
                    ctx.fill()

                    // Address weight label just outside CLB box
                    const weight = 1 << (N_INPUTS - 1 - i)  // MSB first: 4, 2, 1
                    const pClbBoxLeft = (xx + clbCX) * s + globalScope.ox
                    ctx.fillStyle = colors['text']
                    ctx.font = `${Math.round(5 * s)}px sans-serif`
                    ctx.textAlign = 'right'
                    ctx.textBaseline = 'bottom'
                    ctx.fillText(weight.toString(), pClbBoxLeft - 2 * s, pPinY - 1 * s)
                }

                // --- Output: connect to closest wire in right vertical channel ---
                const vi_out = c + 1
                const nw_out = this._vWireCount(vi_out)
                const bw_out = (nw_out - 1) * WIRE_PITCH
                const baseX_out = this.vChanX[vi_out] - bw_out / 2
                // Closest wire = leftmost (wire 0) in the right channel
                const outWx = baseX_out
                const outPinY = clbCY + outY
                const clbRight = clbCX + CLB_W  // CLB right edge

                const pOutWx = (xx + outWx) * s + globalScope.ox
                const pOutPinY = (yy + outPinY) * s + globalScope.oy
                const pClbRight = (xx + clbRight) * s + globalScope.ox
                ctx.strokeStyle = colors['stroke']
                ctx.beginPath()
                ctx.moveTo(pClbRight, pOutPinY)
                ctx.lineTo(pOutWx, pOutPinY)
                ctx.stroke()

                // Connection dot on the vertical wire
                ctx.fillStyle = colors['stroke']
                ctx.beginPath()
                ctx.arc(pOutWx, pOutPinY, DOT_R * s, 0, 2 * Math.PI)
                ctx.fill()
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
                `IN${hi}`,
                (xx + lx1 - 5) * s + globalScope.ox,
                (yy + cy) * s + globalScope.oy
            )
            ctx.textAlign = 'left'
            ctx.fillText(
                `OUT${hi}`,
                (xx + rx2 + 5) * s + globalScope.ox,
                (yy + cy) * s + globalScope.oy
            )
        }
    }
}

FPGA.prototype.tooltipText = 'FPGA: Island-style FPGA with configurable CLBs and routing'
FPGA.prototype.objectType = 'FPGA'
FPGA.prototype.alwaysResolve = true
FPGA.prototype.constructorParametersDefault = [2, 2, null, null, null, null, null]

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
