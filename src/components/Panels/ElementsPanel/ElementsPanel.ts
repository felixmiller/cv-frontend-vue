import { simulationArea } from "#/simulator/src/simulationArea"
import modules from "#/simulator/src/modules"
import { uxvar } from "#/simulator/src/ux"

const iecSvgMap: Record<string, string> = {
  AndGate:  new URL('../../../assets/img/AndGateIec.svg',  import.meta.url).href,
  NandGate: new URL('../../../assets/img/NandGateIec.svg', import.meta.url).href,
  OrGate:   new URL('../../../assets/img/OrGateIec.svg',   import.meta.url).href,
  NorGate:  new URL('../../../assets/img/NorGateIec.svg',  import.meta.url).href,
  NotGate:  new URL('../../../assets/img/NotGateIec.svg',  import.meta.url).href,
  XorGate:  new URL('../../../assets/img/XorGateIec.svg',  import.meta.url).href,
  XnorGate: new URL('../../../assets/img/XnorGateIec.svg', import.meta.url).href,
}

export function getAdaptiveImgUrl(elementName: string, gateStyle: string): string {
  if (gateStyle === 'IEC' && iecSvgMap[elementName]) {
    return iecSvgMap[elementName]
  }
  return getImgUrl(elementName)
}

export function createElement(elementName: string) {
  if (simulationArea.lastSelected?.newElement)
      simulationArea.lastSelected.delete()
  var obj = new modules[elementName]()
  simulationArea.lastSelected = obj
  uxvar.smartDropXX += 70
  if (uxvar.smartDropXX / globalScope.scale > width) {
      uxvar.smartDropXX = 50
      uxvar.smartDropYY += 80
  }
}

export function getImgUrl(elementName: string) {
  try {
    const elementImg = new URL(`../../../assets/img/${elementName}.svg`, import.meta.url).href;
    return elementImg;
  } catch (e) {
    console.error("Error loading image:", e);
    return '';
  }
}
