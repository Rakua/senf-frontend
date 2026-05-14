export { Alert, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"

const modName = "AlertComponent"
const tagName = "sfc-alert"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/Alert/" + name, data, preferredTmpl())

function init() {
    customElements.define(tagName, Alert)
}

class Alert extends HTMLElement {
    #shadow: ShadowRoot
    readonly #ui = {
        dialog: () => this.#shadow.querySelector("dialog")!,        
        content: () => this.#shadow.getElementById("content")! as HTMLElement,
        okButton: () => this.#shadow.getElementById("okButton")! as HTMLButtonElement        
    }

    constructor(htmlContent: string) {
        super()
        this.#shadow = this.attachShadow({ mode: "open" })
        watchDialogs(this.#shadow)
        this.#shadow.innerHTML = tmpl("alert.html", {
            htmlContent: htmlContent
        })
    }

    async alert(htmlContent?: string): Promise<void> {
        if(htmlContent != undefined) {
            this.#ui.content().innerHTML = htmlContent
        }
        this.#ui.dialog().showModal()

        return new Promise((r) => {
            this.#ui.okButton().onclick = () => {
                r()
                this.#ui.dialog().close()
            }
        })
    }

    close() {
        this.#ui.dialog().close()
    }
}

init()