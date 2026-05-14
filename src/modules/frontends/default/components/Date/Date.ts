export { DateView, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { dateToString, preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { approxDuration } from "../../../../libs/etc/misc.js"

type ObservedAttributes = typeof DateView.observedAttributes[number]
type Mode = typeof modes[number]
type TmplData = {
    mode: Mode,
    relativeDate: string,
    absoluteDate: string,
    absoluteDateWoTime: string
}

const modName = "DateComponent"
const tagName = "sfc-date"
const tmpl = (name: string, data: any) => tmpl0("components/Date/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)

const modes = ["absolute", "absoluteWithoutTime", "relative"] as const
let globalMode: Mode = "relative"

let instances: DateView[] = []

function init() {
    customElements.define(tagName, DateView)
}

function toggleMode(startMode?: Mode) {
    startMode ??= globalMode
    globalMode = modes[(modes.findIndex(x => x == startMode) + 1) % modes.length]
    instances.forEach(el => el.setAttribute("mode", globalMode))
}

function isValidMode(mode: string): mode is Mode {
    return (modes as unknown as string[]).includes(mode)
}

class DateView extends HTMLElement {
    static observedAttributes = ["value", "mode"] as const
    #hasListener: boolean

    constructor() {
        super()
        instances.push(this)
        this.#hasListener = false
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

    get mode() {
        const x = this.getAttribute("mode")
        if (x === null) return null

        if (!(modes as unknown as string[]).includes(x)) {
            lg.error("'mode' attribute of %O is invalid (expected one of the following values %O)", this, modes)
            return null
        }

        return x as Mode
    }

    set mode(m: Mode | null) {
        if (m == null) {
            this.removeAttribute("value")
        } else {
            this.setAttribute("value", m)
        }
    }

    connectedCallback() {
        if (!this.#hasListener) {
            this.addEventListener("click", (ev) => {
                const selection = window.getSelection()
                if (selection != null && selection.toString().length > 0) {
                    //ignore when text is selected
                    return
                }

                const modeAttr = this.getAttribute("mode")
                const startMode = modeAttr == null || !isValidMode(modeAttr)
                    ? undefined : modeAttr
                toggleMode(startMode)
            })
            this.#hasListener = true
        }
        this.#render()
    }
    
    attributeChangedCallback(name: ObservedAttributes, _oldValue: string | null, _newValue: string | null) {
        if(!DateView.observedAttributes.includes(name)) return
        this.#render()
    }

    #render() {
        const dateVal = this.value
        if (dateVal === null) {
            this.#renderInvalid()
            return
        }
        const modeVal = this.mode ?? globalMode
        this.#renderValid(dateVal, modeVal)
    }

    #renderValid(date: Date, mode: Mode) {
        const since = Math.round((Date.now() - date.getTime()) / 60000)
        const tmplData: TmplData = {
            mode: mode,
            relativeDate: approxDuration(since),
            absoluteDate: dateToString(date, "full"),
            absoluteDateWoTime: dateToString(date, "dateOnly")
        }

        this.innerHTML = tmpl("date.html", tmplData)
    }

    #renderInvalid() {
        this.innerHTML = "[invalid date]"
    }
}

init()