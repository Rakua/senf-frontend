export { Confirm, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"

type ConfirmOptions = {
    okButtonLabel?: string,
    cancelButtonLabel?: string
}

const modName = "ConfirmComponent"
const tagName = "sfc-confirm"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/Confirm/" + name, data, preferredTmpl())

function init() {
    customElements.define(tagName, Confirm)
}

class Confirm extends HTMLElement {
    #shadow: ShadowRoot
    readonly #ui = {
        dialog: () => this.#shadow.querySelector("dialog")!,
        okButton: () => this.#shadow.getElementById("okButton")! as HTMLButtonElement,
        closeButton: () => this.#shadow.getElementById("closeButton")! as HTMLButtonElement
    }

    constructor(confirmText: string, options?: ConfirmOptions) {
        super()
        this.#shadow = this.attachShadow({ mode: "open" })
        watchDialogs(this.#shadow)
        this.#shadow.innerHTML = tmpl("confirm.html", {
            confirmText: confirmText,
            okButtonLabel: options?.okButtonLabel,
            cancelButtonLabel: options?.cancelButtonLabel
        })
    }

    async confirm(): Promise<boolean> {
        return new Promise((r) => {
            this.#ui.okButton().onclick = () => {
                r(true)
                this.#ui.dialog().close()
            }
            this.#ui.closeButton().onclick = () => this.#ui.dialog().close()
            this.#ui.dialog().addEventListener("close", () => r(false))

            this.#ui.dialog().showModal()
        })
    }

    close() {
        this.#ui.dialog().close()
    }    
}

init()