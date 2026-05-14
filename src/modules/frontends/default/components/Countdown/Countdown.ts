export { Countdown, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"

type ObservedAttributes = typeof Countdown.observedAttributes[number]

const modName = "CountdownComponent"
const tagName = "sfc-countdown"
const lg = new DefaultLogger(modName)

function init() {
    customElements.define(tagName, Countdown)
}

class Countdown extends HTMLElement {
    static observedAttributes = ["value"] as const

    #timerId: number

    constructor() {
        super()
        this.#timerId = 0
    }

    /**
     * Returns `null` if the `value` attribute is missing or it contains an
     * invalid date string.
     */
    get value() {    
        const x = this.getAttribute("value")        
        if (x == null) return null

        const d = new Date(x)
        if (isNaN(d.getTime())) {
            lg.error("'value' attribute of %O is not a valid date", this)
            return null
        } else {
            return d //valid Date object
        }        
    }

    set value(date: Date | null) {
        if (date == null) {
            this.removeAttribute("value")
        } else {            
            this.setAttribute("value", date.toISOString())
        }
    }

    connectedCallback() {
        this.#render()
        this.#timerId = setInterval(() => this.#render(), 1000)
    }

    disconnectedCallback() {
        clearInterval(this.#timerId)
    }

    attributeChangedCallback(name: ObservedAttributes, _oldValue: string | null, _newValue: string | null) {
        if(!Countdown.observedAttributes.includes(name)) return
        this.#render()
    }    

    #render() {
        const pad = (x: number) => String(x).padStart(2, "0")
        const secInHour = 3600
        const secInMin = 60

        const targetDate = this.value
        if (targetDate == null) {            
            this.innerHTML = "??:??:??"
            return
        }

        const now = new Date()
        let remainingTimeSec = Math.max(0, Math.floor((targetDate.getTime() - now.getTime()) / 1000))

        const remainingHours = Math.floor(remainingTimeSec / secInHour)
        remainingTimeSec %= secInHour
        const remainingMinutes = Math.floor(remainingTimeSec / secInMin)
        remainingTimeSec %= secInMin
        const remainingSeconds = remainingTimeSec

        const rh = remainingHours == 0 ? "" : pad(remainingHours) + ":"
        const rm = pad(remainingMinutes)
        const rs = pad(remainingSeconds)

        this.innerHTML = `${rh}${rm}:${rs}`
    }
}

init()