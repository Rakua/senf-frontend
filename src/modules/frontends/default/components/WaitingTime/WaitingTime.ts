export { WaitingTime, modName }

import { round, toNumber } from "../../../../libs/basic/misc.js"
import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { approxDuration, formatDuration } from "../../../../libs/etc/misc.js"

type ObservedAttributes = typeof WaitingTime.observedAttributes[number]

const modName = "WaitingTimeComponent"
const tagName = "sfc-waiting-time"
const lg = new DefaultLogger(modName)

function init() {
    customElements.define(tagName, WaitingTime)
}

class WaitingTime extends HTMLElement {
    static observedAttributes = ["value"] as const

    get value() {
        const x = this.getAttribute("value")
        if (x == null) return null //not set

        const n = toNumber(x)
        if (n == null) lg.error("'value' attribute of %O is not a number", this)

        return n
    }

    set value(minutes: number | null) {
        if (minutes === null) {
            this.removeAttribute("value")
        } else {
            this.setAttribute("value", minutes.toString())
        }
    }

    connectedCallback() {
        this.#render()
    }

    attributeChangedCallback(name: ObservedAttributes, _oldValue: string | null, _newValue: string | null) {
        if (!WaitingTime.observedAttributes.includes(name)) return
        this.#render()
    }

    #render() {
        const val = this.getAttribute("value")

        const durationInMin0 = toNumber(val ?? "")
        if (durationInMin0 == null) {
            this.innerHTML = `<span title="${val}">NaN</span>`
            return
        }
        const durationInMin = round(durationInMin0, 0)
        this.innerHTML = `<span title="${formatDuration(durationInMin)}">${approxDuration(durationInMin)}</span>`
    }
}

init()