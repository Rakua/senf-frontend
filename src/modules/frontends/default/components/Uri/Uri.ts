export { UriView, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { LocationPage } from "../../pages/Location/Location.js"
import { abbreviateUri } from "../../../../libs/etc/misc.js"
import { newSettings } from "../../../../libs/etc/settings.js"
import { guards } from "../../../../libs/etc/guard.js"
import { toNumber } from "../../../../libs/basic/misc.js"
import { toRoutedLink } from "../../../../libs/etc/router.js"

type ObservedAttributes = typeof UriView.observedAttributes[number]

const modName = "UriComponent"
const tagName = "sfc-uri"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/Uri/" + name, data, preferredTmpl())

const settings = newSettings(modName, {
    maxLength: { default: 80, guard: guards.positiveInteger }
})

function init() {
    customElements.define(tagName, UriView)
}

class UriView extends HTMLElement {
    static observedAttributes = ["value", "maxlen"] as const

    constructor() {
        super()
    }

    get value() {
        const x = this.getAttribute("value")
        if (x === null) return null

        try {
            new URL(x)
            return x
        } catch (e) {
            lg.error("'value' attribute of %O is invalid URI (%O)", this, e)
            return null
        }
    }

    set value(uri: string | null) {
        if (uri === null) {
            this.removeAttribute("value")
        } else {
            this.setAttribute("value", uri)
        }
    }

    get maxlen() {
        const x = this.getAttribute("maxlen")
        return toNumber(x ?? "")
    }

    set maxlen(maxLen: number | null) {
        if (maxLen === null) {
            this.removeAttribute("maxlen")
        } else {
            this.setAttribute("maxlen", maxLen.toString())
        }
    }

    connectedCallback() {
        this.#render()
    }

    attributeChangedCallback(name: ObservedAttributes, _oldValue: string | null, _newValue: string | null) {
        if (!UriView.observedAttributes.includes(name)) return
        this.#render()
    }

    #render() {
        const uri = this.value

        if (uri === null) {
            this.innerHTML = "N/A"
            return
        }

        const url = new URL(uri)
        const protocol = url.protocol.slice(0, -1) //remove colon

        this.innerHTML = tmpl("uri.html", {
            isHttp: protocol == "http" || protocol == "https",
            uri: url.href,
            location: LocationPage.path({ type: "uri", url: url }).toFragmentId(),
            abbreviatedUri: abbreviateUri(url.href, this.maxLen())
        })

        this.querySelectorAll<HTMLAnchorElement>("a.routed").forEach(aEl => toRoutedLink(aEl, "navigateTo"))        
    }

    maxLen() {
        const m = this.maxlen
        return m === null ? settings.maxLength.get() : m
    }
}

init()