export { KeyId, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { aliasOf } from "../../../../backend/cidb/cidb.js"
import { LocationPage } from "../../pages/Location/Location.js"
import { toRoutedLink } from "../../../../libs/etc/router.js"

type ObservedAttributes = typeof KeyId.observedAttributes[number]

const modName = "KeyIdComponent"
const tagName = "sfc-keyid"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/KeyId/" + name, data, preferredTmpl())

function init() {
    customElements.define(tagName, KeyId)
}

class KeyId extends HTMLElement {
    static observedAttributes = ["value"] as const

    get value() {
        return this.getAttribute("value")
    }

    set value(keyId: string | null) {
        if (keyId == null) {
            this.removeAttribute("value")
        } else {
            this.setAttribute("value", keyId)
        }
    }

    connectedCallback() {
        this.#render()
    }

    attributeChangedCallback(name: ObservedAttributes, _oldValue: string | null, _newValue: string | null) {
        if (!KeyId.observedAttributes.includes(name)) return
        this.#render()
    }

    #render() {
        const keyId = this.value
        if (keyId == null) {
            this.innerHTML = "<span>N/A</span>"
            return
        }

        this.innerHTML = tmpl("keyid.html", {
            keyId: keyId,
            alias: aliasOf(keyId),
            keyId12: keyId!.slice(0, 12),
            posterHref: LocationPage.path({ type: "poster", keyId: keyId }).toFragmentId()
        })

        this.querySelectorAll("a").forEach(aEl => toRoutedLink(aEl,"navigateTo"))
    }
}

init()