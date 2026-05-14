export { ByteSize, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { approxByteSize } from "../../../../libs/etc/misc.js"
import { toNumber } from "../../../../libs/basic/misc.js"

type ObservedAttributes = typeof ByteSize.observedAttributes[number]

const modName = "ByteSizeComponent"
const tagName = "sfc-byte-size"
const lg = new DefaultLogger(modName)

function init() {
    customElements.define(tagName, ByteSize)
}

class ByteSize extends HTMLElement {
    static observedAttributes = ["value"] as const

    get value() {
        const x = this.getAttribute("value")
        if (x == null) return null //not set

        const n = toNumber(x)
        if (n == null) lg.error("'value' attribute of %O is not a number", this)

        return n
    }

    set value(byteSize: number | null) {
        if (byteSize === null) {
            this.removeAttribute("value")
        } else {
            this.setAttribute("value", byteSize.toString())
        }
    }

    connectedCallback() {
        this.#render()
    }

    attributeChangedCallback(name: ObservedAttributes, _oldValue: string | null, _newValue: string | null) {
        if(!ByteSize.observedAttributes.includes(name)) return
        this.#render()
    }

    #render() {        
        this.innerHTML = this.value === null ? "N/A" : approxByteSize(this.value)
    }

}

init()