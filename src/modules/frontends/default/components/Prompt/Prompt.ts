export { Prompt, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"
import { ExposedPromise } from "../../../../libs/basic/misc.js"

type PromptOptions = {
    placeholder?: string,
    validator?: (x: string) => boolean,
    rightAlign?: boolean,
    okButtonLabel?: string,
    cancelButtonLabel?: string
}

const modName = "PromptComponent"
const tagName = "sfc-prompt"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/Prompt/" + name, data, preferredTmpl())

function init() {
    customElements.define(tagName, Prompt)
}

class Prompt extends HTMLElement {
    #response?: ExposedPromise<null | string[]>
    #validator: (x: string) => boolean
    #multilinePasteEnabled?: boolean

    #shadow: ShadowRoot
    readonly #ui = {
        dialog: () => this.#shadow.querySelector("dialog")!,
        input: () => this.#shadow.querySelector("input")!,
        okButton: () => this.#shadow.getElementById("okButton")! as HTMLButtonElement,
        closeButton: () => this.#shadow.getElementById("closeButton")! as HTMLButtonElement
    }

    constructor(promptText: string, options?: PromptOptions) {
        super()
        this.#shadow = this.attachShadow({ mode: "open" })
        watchDialogs(this.#shadow)
        this.#shadow.innerHTML = tmpl("prompt.html", {
            promptText: promptText,
            placeholder: options?.placeholder,
            rightAlign: options?.rightAlign,
            okButtonLabel: options?.okButtonLabel,
            cancelButtonLabel: options?.cancelButtonLabel
        })

        this.#validator = options?.validator ?? ((x: string) => true)
        this.#ui.input().addEventListener("input", () => {
            //enable ok button iff input passes the validator
            this.#ui.okButton().disabled = !this.#validator(this.#ui.input().value)
        })

        this.#ui.input().addEventListener("keypress", (e) => {
            if (e.key == "Enter") this.#ui.okButton().click()
        })

        this.#ui.input().addEventListener("paste", this.#multilinePaste.bind(this))
    }

    #multilinePaste(ev: ClipboardEvent) {
        if (!this.#multilinePasteEnabled) return
        const pastedText = ev.clipboardData?.getData("text").trim() ?? ""

        //ignore non-multiline pastes
        if (pastedText.indexOf("\n") == -1) return

        const res = pastedText.split("\n").filter(x => this.#validator(x))
        //do nothing if all lines are invalid
        if (res.length == 0) return

        this.#response?.resolve(res)
        this.close()
    }

    async #prompt(defaultValue: string | undefined): Promise<null | string[]> {
        //new response promise for new prompt
        this.#response = new ExposedPromise()

        //reset input
        this.#ui.input().value = defaultValue ?? ""
        this.#ui.okButton().disabled = !this.#validator(this.#ui.input().value)

        this.#ui.okButton().onclick = () => {
            //important: resolve before closing to prevent the resolve in 
            //the close event from setting the result to null
            this.#response?.resolve([this.#ui.input().value])
            this.#ui.dialog().close()
        }
        this.#ui.closeButton().onclick = () => this.#ui.dialog().close()
        this.#ui.dialog().addEventListener("close", () => this.#response?.resolve(null))

        this.#ui.dialog().showModal()

        return this.#response.promise
    }

    async prompt(defaultValue?: string): Promise<null | string> {
        this.#multilinePasteEnabled = false
        const res = await this.#prompt(defaultValue)
        return Array.isArray(res) ? res[0] : null
    }

    async promptWithMultilinePaste(defaultValue?: string): Promise<null | string[]> {
        this.#multilinePasteEnabled = true
        return this.#prompt(defaultValue)
    }

    close() {
        this.#ui.dialog().close()
    }
}

init()