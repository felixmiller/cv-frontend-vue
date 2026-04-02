import CircuitElement from '../circuitElement'
import Node, { findNode } from '../node'
import { simulationArea } from '../simulationArea'
import { correctWidth } from '../canvasApi'
import { colors } from '../themer/themer'
import { forceResetNodesSet, scheduleUpdate } from '../engine'

/**
 * HmMemory — Base class for HM memory elements (ROM and RAM).
 *
 * Renders memory as a binary truth-table with clickable bit cells.
 * Configurable address width (1-6 bits), data width (1-32 bits).
 * Optional enable input, synchronous (clocked) mode, bus mode.
 */

// Table layout constants
const CELL_W = 14          // width of each bit cell
const CELL_H = 12          // height of each row
const ADDR_COL_W = 28      // address column width
const HEADER_H = 14        // header row height
const PAD = 16             // padding inside box around table (room for port labels)
const NODE_STUB = 10       // wire stub from box edge to node
const NODE_SPACING = 10    // vertical spacing between individual wire nodes

const snap10 = v => Math.round(v / 10) * 10

export default class HmMemory extends CircuitElement {
    constructor(
        x, y, scope = globalScope, dir = 'RIGHT',
        addressWidth = 2, dataWidth = 4, data = null,
        hasEnable = false, isSynchronous = false, isBusMode = false,
        enablePolarity = 'high', outputType = 'pushpull'
    ) {
        super(x, y, scope, 'RIGHT', 1)
        this.fixedBitWidth = true
        this.directionFixed = true
        this.rectangleObject = false

        this.addressWidth = addressWidth
        this.dataWidth = dataWidth
        this.numRows = 1 << addressWidth
        this.data = data || new Array(this.numRows).fill(0)

        this.hasEnable = hasEnable
        this.isSynchronous = isSynchronous
        this.isBusMode = isBusMode
        this.enablePolarity = enablePolarity
        this.outputType = outputType

        // Simulation state
        this.prevClkState = 0
        this.masterAddr = undefined
        this._activeRow = undefined  // for highlighting

        this._buildLayout()
        this._buildNodes()
    }

    // -- Layout ---------------------------------------------------------------

    _buildLayout() {
        this.tableW = ADDR_COL_W + this.dataWidth * CELL_W
        this.tableH = HEADER_H + this.numRows * CELL_H
        this.boxW = this.tableW + 2 * PAD
        this.boxH = this.tableH + 2 * PAD

        // Total left-side node count (for sizing box to fit all ports)
        const leftNodeCount = (this.isBusMode ? 1 : this.addressWidth)
            + this._getExtraNodeCount()
            + this._getControlCount()
        const leftPortsH = leftNodeCount * NODE_SPACING + NODE_SPACING  // +gap after addr group
        // Right-side node count
        const rightNodeCount = this.isBusMode ? 1 : this.dataWidth
        const rightPortsH = rightNodeCount * NODE_SPACING

        // Box must fit both table and ports, with 1 grid (10px) below lowest port
        const minPortH = Math.max(leftPortsH, rightPortsH) + PAD + NODE_SPACING + 10
        this.boxH = Math.max(this.boxH, minPortH)

        // halfW/halfH must be multiples of 10 so both box edges are on-grid
        this.halfW = snap10(Math.ceil(this.boxW / 2 / 10) * 10)
        this.halfH = snap10(Math.ceil(this.boxH / 2 / 10) * 10)
        this.boxW = this.halfW * 2
        this.boxH = this.halfH * 2

        // Hit-test dimensions
        this.leftDimensionX = this.halfW + NODE_STUB + 10
        this.rightDimensionX = this.halfW + NODE_STUB + 10
        this.upDimensionY = this.halfH + 10
        this.downDimensionY = this.halfH + 10
    }

    _getControlCount() {
        // Subclass overrides to add WE
        let count = 0
        if (this.isSynchronous) count++
        if (this.hasEnable) count++
        return count
    }

    // -- Nodes ----------------------------------------------------------------

    _buildNodes() {
        if (this.addrNodes) this.nodeList = []

        const leftX = snap10(-this.halfW)
        const rightX = snap10(this.halfW)
        const topY = snap10(-this.halfH + PAD + HEADER_H + CELL_H / 2)

        // Address inputs
        this.addrNodes = []
        if (this.isBusMode) {
            this.addrNodes.push(new Node(leftX, snap10(topY), 0, this, this.addressWidth, 'A'))
        } else {
            for (let i = 0; i < this.addressWidth; i++) {
                const ny = snap10(topY + i * NODE_SPACING)
                this.addrNodes.push(new Node(leftX, ny, 0, this, 1, `A${this.addressWidth - 1 - i}`))
            }
        }

        // Data outputs
        this.doutNodes = []
        if (this.isBusMode) {
            this.doutNodes.push(new Node(rightX, snap10(topY), 1, this, this.dataWidth, 'D'))
        } else {
            for (let i = 0; i < this.dataWidth; i++) {
                const ny = snap10(topY + i * NODE_SPACING)
                this.doutNodes.push(new Node(rightX, ny, 1, this, 1, `D${this.dataWidth - 1 - i}`))
            }
        }

        // Build subclass-specific input nodes (RAM adds DIN + WE)
        this._buildExtraInputNodes(leftX, topY)

        // Control nodes: CLK, EN (always created, conditionally removed)
        const controlStartY = this._getControlStartY(topY)
        let cy = controlStartY

        this.clkNode = new Node(leftX, snap10(cy), 0, this, 1, 'CLK')
        if (!this.isSynchronous) {
            this.nodeList.splice(this.nodeList.indexOf(this.clkNode), 1)
            this.clkNode.disabled = true
        }
        cy += NODE_SPACING

        const enX = this.enablePolarity === 'low' ? leftX - 10 : leftX
        this.enNode = new Node(enX, snap10(cy), 0, this, 1, 'EN')
        if (!this.hasEnable) {
            this.nodeList.splice(this.nodeList.indexOf(this.enNode), 1)
            this.enNode.disabled = true
        }
    }

    /** Override point for subclasses to add extra input nodes (DIN, WE). */
    _buildExtraInputNodes(leftX, topY) {}

    /** Y position where control nodes start. */
    _getControlStartY(topY) {
        // After address nodes (or subclass extra nodes)
        const addrEnd = this.isBusMode ? 1 : this.addressWidth
        return snap10(topY + (addrEnd + this._getExtraNodeCount()) * NODE_SPACING + NODE_SPACING)
    }

    /** How many extra nodes the subclass adds (for positioning). */
    _getExtraNodeCount() { return 0 }

    // -- Save / Load ----------------------------------------------------------

    customSave() {
        return {
            constructorParamaters: [
                this.addressWidth, this.dataWidth, this.data,
                this.hasEnable, this.isSynchronous, this.isBusMode,
                this.enablePolarity, this.outputType,
            ],
            nodes: {
                addrNodes: this.addrNodes.map(findNode),
                doutNodes: this.doutNodes.map(findNode),
                clkNode: findNode(this.clkNode),
                enNode: findNode(this.enNode),
            },
        }
    }

    // -- Address / Data helpers ------------------------------------------------

    _readAddress() {
        if (this.isBusMode) {
            return this.addrNodes[0].value
        }
        let addr = 0
        for (let i = 0; i < this.addressWidth; i++) {
            const v = this.addrNodes[i].value
            if (v === undefined) return undefined
            // addrNodes[0] is MSB
            addr |= (v & 1) << (this.addressWidth - 1 - i)
        }
        return addr
    }

    _writeOutputs(value) {
        if (this.isBusMode) {
            if (this.doutNodes[0].value !== value) {
                this.doutNodes[0].value = value
                simulationArea.simulationQueue.add(this.doutNodes[0])
            }
        } else {
            for (let i = 0; i < this.dataWidth; i++) {
                // doutNodes[0] is MSB
                const bit = value !== undefined
                    ? (value >> (this.dataWidth - 1 - i)) & 1
                    : undefined
                if (this.doutNodes[i].value !== bit) {
                    this.doutNodes[i].value = bit
                    simulationArea.simulationQueue.add(this.doutNodes[i])
                }
            }
        }
    }

    _isEnabled() {
        if (!this.hasEnable) return true
        if (this.enNode.connections.length === 0) return true
        return this.enablePolarity === 'high'
            ? this.enNode.value === 1
            : this.enNode.value === 0
    }

    // -- Simulation -----------------------------------------------------------

    resolve() {
        const addr = this._readAddress()
        this._activeRow = addr

        if (!this._isEnabled()) {
            // Tristate: outputs float (undefined). Pushpull: outputs 0.
            this._writeOutputs(this.outputType === 'tristate' ? undefined : 0)
            this.prevClkState = this.clkNode.value
            return
        }

        if (this.isSynchronous) {
            const clkVal = this.clkNode.value
            if (clkVal === undefined) {
                this.prevClkState = undefined
                return
            }
            // Master-slave: sample on inactive, transfer on rising edge
            if (clkVal === 0) {
                // Clock inactive: sample address
                if (addr !== undefined) this.masterAddr = addr
            } else if (this.prevClkState === 0) {
                // Rising edge: read from sampled address
                this._doWrite(this.masterAddr)  // subclass hook (RAM writes here)
                const val = this.masterAddr !== undefined ? (this.data[this.masterAddr] || 0) : undefined
                this._writeOutputs(val)
            }
            this.prevClkState = clkVal
        } else {
            // Asynchronous: combinatorial read
            this._doWrite(addr)  // subclass hook
            const val = addr !== undefined ? (this.data[addr] || 0) : undefined
            this._writeOutputs(val)
        }
    }

    /** Override point for RAM to perform write before read. */
    _doWrite(addr) {}

    // -- Wire color helper ----------------------------------------------------

    _wireColor(val) {
        if (val === undefined) return colors['color_wire_lose']
        return val ? colors['color_wire_pow'] : colors['color_wire_con']
    }

    // -- Click handling -------------------------------------------------------

    click() {
        const hit = this._hitTable()
        if (!hit) return

        // Toggle the bit
        this.data[hit.row] ^= (1 << (this.dataWidth - 1 - hit.col))
        forceResetNodesSet(true)
    }

    _hitTable() {
        const mx = simulationArea.mouseXf - this.x
        const my = simulationArea.mouseYf - this.y

        const tableLeft = -this.halfW + PAD + ADDR_COL_W
        const tableTop = -this.halfH + PAD + HEADER_H

        for (let r = 0; r < this.numRows; r++) {
            for (let c = 0; c < this.dataWidth; c++) {
                const cx = tableLeft + c * CELL_W
                const cy = tableTop + r * CELL_H
                if (mx >= cx && mx <= cx + CELL_W &&
                    my >= cy && my <= cy + CELL_H) {
                    return { row: r, col: c }
                }
            }
        }
        return null
    }

    _mouseInGrid() {
        return this._hitTable() !== null
    }

    // -- Drawing --------------------------------------------------------------

    customDraw() {
        const ctx = simulationArea.context
        const s = globalScope.scale
        const ox = globalScope.ox
        const oy = globalScope.oy
        const xx = this.x
        const yy = this.y
        const hover = this._hitTable()

        this._drawBox(ctx, s, ox, oy, xx, yy)
        this._drawTitle(ctx, s, ox, oy, xx, yy)
        this._drawHeader(ctx, s, ox, oy, xx, yy)
        this._drawRows(ctx, s, ox, oy, xx, yy, hover)
        this._drawNodeLabels(ctx, s, ox, oy, xx, yy)
    }

    _drawBox(ctx, s, ox, oy, xx, yy) {
        ctx.strokeStyle = colors['stroke']
        ctx.lineWidth = correctWidth(2)

        if (!this._mouseInGrid() &&
            ((!simulationArea.shiftDown && this.hover) ||
                simulationArea.lastSelected === this ||
                simulationArea.multipleObjectSelections.includes(this))) {
            ctx.fillStyle = colors['hover_select']
        } else {
            ctx.fillStyle = colors['fill']
        }

        const px = (xx - this.halfW) * s + ox
        const py = (yy - this.halfH) * s + oy
        ctx.fillRect(px, py, this.boxW * s, this.boxH * s)
        ctx.strokeRect(px, py, this.boxW * s, this.boxH * s)
    }

    _drawTitle(ctx, s, ox, oy, xx, yy) {
        ctx.fillStyle = colors['text']
        ctx.font = `${Math.round(10 * s)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(this._titleText(),
            xx * s + ox,
            (yy - this.halfH + 3) * s + oy
        )
    }

    /** Override in subclass for element name. */
    _titleText() { return 'MEM' }

    _drawHeader(ctx, s, ox, oy, xx, yy) {
        const tableLeft = -this.halfW + PAD
        const tableTop = -this.halfH + PAD
        const fontSize = Math.round(7 * s)
        ctx.font = `${fontSize}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        // "Addr" header
        ctx.fillStyle = colors['text']
        ctx.fillText('Addr',
            (xx + tableLeft + ADDR_COL_W / 2) * s + ox,
            (yy + tableTop + HEADER_H / 2) * s + oy
        )

        // Bit column headers (MSB left)
        for (let c = 0; c < this.dataWidth; c++) {
            const bitIdx = this.dataWidth - 1 - c
            ctx.fillText(bitIdx.toString(),
                (xx + tableLeft + ADDR_COL_W + c * CELL_W + CELL_W / 2) * s + ox,
                (yy + tableTop + HEADER_H / 2) * s + oy
            )
        }
    }

    _drawRows(ctx, s, ox, oy, xx, yy, hover) {
        const tableLeft = -this.halfW + PAD
        const tableTop = -this.halfH + PAD + HEADER_H
        const fontSize = Math.round(7 * s)
        const bitFontSize = Math.round(8 * s)

        for (let r = 0; r < this.numRows; r++) {
            const ry = tableTop + r * CELL_H
            const isActive = this._activeRow === r

            // Address cell
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(0.5)
            ctx.fillStyle = isActive ? colors['hover_select'] : colors['fill']
            const addrPx = (xx + tableLeft) * s + ox
            const addrPy = (yy + ry) * s + oy
            ctx.fillRect(addrPx, addrPy, ADDR_COL_W * s, CELL_H * s)
            ctx.strokeRect(addrPx, addrPy, ADDR_COL_W * s, CELL_H * s)

            // Address text
            ctx.fillStyle = colors['text']
            ctx.font = `${fontSize}px monospace`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(
                r.toString(2).padStart(this.addressWidth, '0'),
                (xx + tableLeft + ADDR_COL_W / 2) * s + ox,
                (yy + ry + CELL_H / 2) * s + oy
            )

            // Data bit cells
            const word = this.data[r] || 0
            for (let c = 0; c < this.dataWidth; c++) {
                const cx = tableLeft + ADDR_COL_W + c * CELL_W
                const bitIdx = this.dataWidth - 1 - c
                const bit = (word >> bitIdx) & 1
                const isHover = hover && hover.row === r && hover.col === c

                ctx.fillStyle = isHover ? colors['hover_select']
                    : isActive ? colors['hover_select']
                    : colors['fill']
                const cellPx = (xx + cx) * s + ox
                const cellPy = (yy + ry) * s + oy
                ctx.fillRect(cellPx, cellPy, CELL_W * s, CELL_H * s)
                ctx.strokeRect(cellPx, cellPy, CELL_W * s, CELL_H * s)

                ctx.fillStyle = colors['text']
                ctx.font = `${bitFontSize}px monospace`
                ctx.fillText(
                    bit.toString(),
                    (xx + cx + CELL_W / 2) * s + ox,
                    (yy + ry + CELL_H / 2) * s + oy
                )
            }
        }
    }

    _drawNodeLabels(ctx, s, ox, oy, xx, yy) {
        const fontSize = Math.round(7 * s)
        ctx.font = `${fontSize}px sans-serif`
        ctx.fillStyle = colors['text']
        ctx.textBaseline = 'middle'

        const boxLeft = (xx - this.halfW) * s + ox
        const boxRight = (xx + this.halfW) * s + ox

        // Address labels inside left edge
        ctx.textAlign = 'left'
        for (const node of this.addrNodes) {
            if (node.disabled) continue
            ctx.fillText(node.label,
                boxLeft + 3 * s,
                (yy + node.lefty) * s + oy
            )
        }

        // Data output labels inside right edge
        ctx.textAlign = 'right'
        for (const node of this.doutNodes) {
            if (node.disabled) continue
            ctx.fillText(node.label,
                boxRight - 3 * s,
                (yy + node.lefty) * s + oy
            )
        }

        // Clock triangle + label (inside left edge)
        if (this.isSynchronous) {
            const clkPy = (yy + this.clkNode.lefty) * s + oy
            const triSize = 4 * s
            ctx.strokeStyle = colors['stroke']
            ctx.lineWidth = correctWidth(1)
            ctx.beginPath()
            ctx.moveTo(boxLeft, clkPy - triSize)
            ctx.lineTo(boxLeft + triSize, clkPy)
            ctx.lineTo(boxLeft, clkPy + triSize)
            ctx.stroke()
            // Label after triangle
            ctx.fillStyle = colors['text']
            ctx.textAlign = 'left'
            ctx.fillText('CLK', boxLeft + triSize + 2 * s, clkPy)
        }

        // Enable label + inversion bubble
        if (this.hasEnable) {
            const enPy = (yy + this.enNode.lefty) * s + oy
            if (this.enablePolarity === 'low') {
                // Inversion bubble outside the left edge
                const bubbleR = 4 * s
                ctx.strokeStyle = colors['stroke']
                ctx.fillStyle = colors['fill']
                ctx.lineWidth = correctWidth(1.5)
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.arc(boxLeft - bubbleR, enPy, bubbleR, 0, 2 * Math.PI)
                ctx.fill()
                ctx.stroke()
                ctx.lineCap = 'butt'
                // Label inside
                ctx.fillStyle = colors['text']
                ctx.textAlign = 'left'
                ctx.fillText('EN', boxLeft + 3 * s, enPy)
            } else {
                ctx.fillStyle = colors['text']
                ctx.textAlign = 'left'
                ctx.fillText('EN', boxLeft + 3 * s, enPy)
            }
        }

        // Subclass labels
        this._drawExtraLabels(ctx, s, ox, oy, xx, yy)
    }

    /** Override point for subclass labels (DIN, WE). */
    _drawExtraLabels(ctx, s, ox, oy, xx, yy) {}

    // -- Property setters (mutableProperties) ---------------------------------

    _rebuildElement(...args) {
        const obj = new this.constructor(this.x, this.y, this.scope, this.direction, ...args)
        this.cleanDelete()
        simulationArea.lastSelected = obj
        return obj
    }
}

HmMemory.prototype.tooltipText = 'Memory (HM)'
HmMemory.prototype.objectType = 'HmMemory'

// Shared setters assigned to prototypes of subclasses
HmMemory.prototype.setAddressWidth = function (val) {
    val = parseInt(val)
    if (!val || val < 1 || val > 6 || val === this.addressWidth) return
    // Preserve data where possible
    const newRows = 1 << val
    const newData = new Array(newRows).fill(0)
    const mask = (1 << this.dataWidth) - 1
    for (let i = 0; i < Math.min(newRows, this.data.length); i++) {
        newData[i] = this.data[i] & mask
    }
    return this._rebuildElement(val, this.dataWidth, newData,
        this.hasEnable, this.isSynchronous, this.isBusMode,
        this.enablePolarity, this.outputType,
        ...this._subclassArgs())
}

HmMemory.prototype.setDataWidth = function (val) {
    val = parseInt(val)
    if (!val || val < 1 || val > 32 || val === this.dataWidth) return
    const mask = (1 << val) - 1
    const newData = this.data.map(v => v & mask)
    return this._rebuildElement(this.addressWidth, val, newData,
        this.hasEnable, this.isSynchronous, this.isBusMode,
        this.enablePolarity, this.outputType,
        ...this._subclassArgs())
}

HmMemory.prototype.setHasEnable = function (val) {
    const active = (val === true || val === 'true')
    if (this.hasEnable === active) return
    this.hasEnable = active
    if (!active && this.outputType === 'tristate') this.outputType = 'pushpull'
    this.enNode.disabled = !active
    if (active && !this.nodeList.includes(this.enNode)) this.nodeList.push(this.enNode)
    if (!active) { const i = this.nodeList.indexOf(this.enNode); if (i !== -1) this.nodeList.splice(i, 1) }
    scheduleUpdate()
}

HmMemory.prototype.setEnablePolarity = function (val) {
    if (this.enablePolarity === val) return
    this.enablePolarity = val
    const leftX = snap10(-this.halfW)
    const enX = val === 'low' ? leftX - 10 : leftX
    this.enNode.leftx = enX
    this.enNode.updateRotation()
    scheduleUpdate()
}

HmMemory.prototype.setOutputType = function (val) {
    if (this.outputType === val) return
    this.outputType = val
    scheduleUpdate()
}

HmMemory.prototype.setIsSynchronous = function (val) {
    const active = (val === true || val === 'true')
    if (this.isSynchronous === active) return
    this.isSynchronous = active
    this.clkNode.disabled = !active
    if (active && !this.nodeList.includes(this.clkNode)) this.nodeList.push(this.clkNode)
    if (!active) { const i = this.nodeList.indexOf(this.clkNode); if (i !== -1) this.nodeList.splice(i, 1) }
    scheduleUpdate()
}

HmMemory.prototype.setIsBusMode = function (val) {
    const active = (val === true || val === 'true')
    if (this.isBusMode === active) return
    return this._rebuildElement(this.addressWidth, this.dataWidth, this.data.slice(),
        this.hasEnable, this.isSynchronous, active,
        this.enablePolarity, this.outputType,
        ...this._subclassArgs())
}

/** Override in subclass to return extra constructor args for rebuild. */
HmMemory.prototype._subclassArgs = function () { return [] }
