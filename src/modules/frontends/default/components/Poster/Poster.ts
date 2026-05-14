export { Poster, PosterValue, modName, settings as posterSettings }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { newSettings } from "../../../../libs/etc/settings.js"

type ObservedAttributes = typeof Poster.observedAttributes[number]
type PosterValue = PosterValueKeyId | PosterValueAnon | PosterValueUnknown
type PosterValueKeyId = { type: "keyid", value: string }
type PosterValueAnon = { type: "anon" }
type PosterValueUnknown = { type: "unknown" }

const modName = "PosterComponent"
const tagName = "sfc-poster"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/Poster/" + name, data, preferredTmpl())

const settings = newSettings(modName, {
    showYou: { default: true }
})

function init() {
    customElements.define(tagName, Poster)
}

class Poster extends HTMLElement {
    static observedAttributes = ["value", "isyou","showyou"] as const

    get value(): PosterValue | null {
        const val = this.getAttribute("value")
        if (val === null) return null

        //parse value
        if (val == "anon" || val == "unknown") return { type: val }
        return { type: "keyid", value: val }
    }

    /**
     * The value may be a keyid or `"anon"` or `"unknown"`
     */
    set value(val: PosterValue | null) {
        if (val == null) {
            this.removeAttribute("value")
        } else {
            this.setAttribute("value", val.type == "keyid" ? val.value : val.type)
        }
    }

    get isyou() {
        return this.hasAttribute("isyou")
    }

    set isyou(you: boolean) {
        if (you) {
            this.setAttribute("isyou", "")
        } else {
            this.removeAttribute("isyou")
        }
    }

    get showyou() {
        const x = this.getAttribute("showyou")
        return x === null ? settings.showYou.get() : (x == "true")
    }

    set showyou(show: boolean | null) {
        if (show === null) {
            this.removeAttribute("showyou")            
        } else {
            this.setAttribute("showyou", show ? "true" : "false")
        }
    }    

    connectedCallback() {
        this.#render()
    }

    attributeChangedCallback(name: ObservedAttributes, _oldValue: string | null, _newValue: string | null) {
        if (!Poster.observedAttributes.includes(name)) return
        this.#render()
    }

    #render() {
        const poster = this.value
        if (poster === null) {
            this.innerHTML = "<span>N/A</span>"
            return
        }

        this.innerHTML = tmpl("poster.html", {
            poster: this.value,
            isYou: this.isyou,
            showYou: this.showyou
        })
    }
}

init()