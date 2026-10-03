import Node from '../node'
import { wireToBeCheckedSet } from '../engine'

/**
 * Optional pins of the HM sequential elements (preset, clear, enable, ...).
 * All pins always exist so the save format stays the same, hidden ones are only
 * removed from nodeList. A hidden pin is still in scope.allNodes, so a wire end
 * dropped on its position would attach to it. Hidden pins are therefore parked
 * off the grid inside the box, where no wire end can land.
 * @category sequential
 */

const NODE_INTERMEDIATE = 2
const PARK_X = -25
const PARK_Y = -25

function moveNode(node, lx, ly) {
    node.leftx = lx
    node.lefty = ly
    node.updateRotation()
}

const isHidden = (element, pin) => !element.nodeList.includes(pin)

/**
 * Deletes the wires on a pin, up to the next junction or element pin.
 * The pin itself is kept.
 */
export function detachWires(pin) {
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
    for (const other of pin.connections) {
        other.connections = other.connections.filter((n) => n !== pin)
    }
    pin.connections = []
    wireToBeCheckedSet(1)
}

/**
 * Shows or hides optional pins. Shown pins are moved to their position,
 * hidden pins lose their wires and are parked.
 * @param {CircuitElement} element
 * @param {Array} pins - one [node, shown, x, y] entry per optional pin
 */
export function syncOptionalPins(element, pins) {
    for (const [pin, shown, lx, ly] of pins) {
        if (shown) {
            if (isHidden(element, pin)) element.nodeList.push(pin)
            moveNode(pin, lx, ly)
        } else {
            if (pin.connections.length) detachWires(pin)
            if (!isHidden(element, pin)) element.nodeList.splice(element.nodeList.indexOf(pin), 1)
            moveNode(pin, PARK_X, PARK_Y)
        }
        pin.disabled = !shown
    }
}

/**
 * Called after loading. In files saved before hidden pins were parked, a hidden pin
 * can still carry wires (wired before it was hidden, or wire ends dropped on it, which
 * then connected through the invisible pin). These wires move to a new junction at the
 * same position, so the circuit stays electrically the same, then the pin is parked.
 */
export function releaseHiddenPins(element, pins) {
    for (const pin of pins) {
        if (!isHidden(element, pin)) continue
        if (pin.connections.length) {
            const junction = new Node(pin.absX(), pin.absY(), NODE_INTERMEDIATE, element.scope.root)
            for (const other of pin.connections) {
                other.connections = other.connections.filter((n) => n !== pin)
                junction.connect(other)
            }
            pin.connections = []
            wireToBeCheckedSet(1)
        }
        moveNode(pin, PARK_X, PARK_Y)
        pin.disabled = true
    }
}

/**
 * The base class delete() only handles nodeList, hidden pins would stay in scope.allNodes.
 * Call before super.delete().
 */
export function deleteHiddenPins(element, pins) {
    for (const pin of pins) {
        if (isHidden(element, pin)) pin.delete()
    }
}
