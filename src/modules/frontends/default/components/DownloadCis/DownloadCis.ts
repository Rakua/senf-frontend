export { DownloadCis, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { exportCis, UserCiPrimaryKey } from "../../../../backend/cidb/cidb.js"
import { anchorToBlobDownload, showChildEl } from "../../../../libs/etc/misc.js"

const modName = "DownloadCisComponent"
const tagName = "sfc-download-cis"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/DownloadCis/" + name, data, preferredTmpl())

function init() {
    customElements.define(tagName, DownloadCis)
}

class DownloadCis extends HTMLElement {
    #shadow: ShadowRoot
    readonly #ui = {
        content: () => this.#shadow.getElementById("content")! as HTMLElement,
        compilaA: () => this.#shadow.getElementById("compilaA")! as HTMLAnchorElement,
        downloadA: () => this.#shadow.getElementById("downloadA")! as HTMLAnchorElement
    }

    readonly filename: string
    #pks: UserCiPrimaryKey[] | undefined
    #releaseUrlObject?: () => void

    constructor(filename: string, pks?: UserCiPrimaryKey[]) {
        super()
        this.filename = filename
        this.#pks = pks

        this.#shadow = this.attachShadow({ mode: "open" })
        this.#shadow.innerHTML = tmpl("download.html", {})

        this.#ui.compilaA().addEventListener("click", () => this.downloadAllCis())
    }

    disconnectedCallback() {
        if (this.#releaseUrlObject) this.#releaseUrlObject()
    }

    async downloadAllCis() {
        if (this.#releaseUrlObject === undefined) {            
            lg.debug("compiling download")
            showChildEl(this.#ui.content(), 1)
            const blob = await exportCis(this.#pks)
            this.#releaseUrlObject = anchorToBlobDownload(this.#ui.downloadA(), this.filename, blob)
            showChildEl(this.#ui.content(), 2)
        }

        this.#ui.downloadA().click()
    }
}

init()