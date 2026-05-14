export { SourcePage, modName }

import { tmpl as tmpl0 } from "../../tmpl.js"
import { mainSettings, preferredTmpl } from "../../../../../config.js"
import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { pageTitleR } from "../../App/App.js"
import { ExposedPromise } from "../../../../libs/basic/misc.js"
import { serializeUserCi, getUserCi, jsonSrFromUserCi, getCiSourcesAndCategories } from "../../../../backend/cidb/cidb.js"
import { ciHash, CiId, CiUrn, parseCiUrn, toCiUrn } from "../../../../backend/cidb/types/ci.js"
import { currentNaviPath, NaviPath } from "../../../../libs/etc/router.js"
import { fallback, guard } from "../../../../libs/etc/guard.js"
import { PostBody } from "../../components/PostBody/PostBody.js"
import { removeCommands } from "../../../../backend/parser/parser.js"
import { SDSTVerifyRequest } from "../../../../libs/etc/sdst-request.js"
import { anchorToPlainTextDownload, showEl } from "../../../../libs/etc/misc.js"

const modName = "SourcePage"
const tmpl = (name: string, data: any) => tmpl0("pages/Source/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)

function init() {
    customElements.define(SourcePage.tagName, SourcePage);
}

class SourcePage extends HTMLElement {
    static readonly pageName = "source"
    static readonly tagName = "sf-source"

    static path = {
        source: (ciUrn: CiUrn) => new NaviPath(SourcePage.pageName).set("uri", ciUrn)
    }

    #contentLoaded = new ExposedPromise<void>()
    readonly initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    readonly #ui = {
        source: () => this.#shadow.getElementById("source") as HTMLElement,
        verifyButton: () => this.#shadow.getElementById("verifyButton") as HTMLButtonElement,
        verifyContentButton: () => this.#shadow.getElementById("verifyContentButton") as HTMLButtonElement,
        downloadButton: () => this.#shadow.getElementById("downloadButton") as HTMLButtonElement,
        backButton: () => this.#shadow.getElementById("backButton") as HTMLButtonElement,

        downloadA: () => this.#shadow.getElementById("downloadA") as HTMLAnchorElement,
    }

    constructor() {
        super()
        this.#shadow = this.attachShadow({ mode: "open" })

        const ciUrn = this.#urn()
        if (ciUrn == null) {
            pageTitleR.set("Source")
            this.#shadow.innerHTML = tmpl("invalid.html", {})
            return
        }

        pageTitleR.set("Source of #" + ciUrn.seqNo)
        this.#shadow.innerHTML = tmpl("source.html", { seqNo: ciUrn.seqNo })
        this.#ui.backButton().addEventListener("click", () => history.back())

        this.#init(ciUrn)
    }

    async #init(ciId: CiId) {
        const userCi = await getUserCi(ciId)
        if (userCi == undefined) {
            this.#ui.source().innerHTML = tmpl("dne.html", { ciUrn: toCiUrn(ciId) })
        } else {
            const jsonSr = await jsonSrFromUserCi(userCi)
            const jsonSrWoPubKey = structuredClone(jsonSr)
            delete (jsonSrWoPubKey.signatures[0] as any).publicKey
            let sourceCode: Record<string, any> = {
                hash: await ciHash(jsonSrWoPubKey),
                ci: jsonSrWoPubKey,
            }

            const sourcesAndCats = await getCiSourcesAndCategories([ciId.chain, ciId.seqNo])
            if (sourcesAndCats != null) {
                const f = (x: Record<string, string>) => {
                    if (Object.hasOwn(x, "url")) x.url = decodeURI(x.url)
                    if (Object.hasOwn(x, "archive")) x.url = decodeURI(x.url)
                    return x
                }
                sourceCode.sources = sourcesAndCats.jobs.map(x =>
                    ({ ...f(x.from), jobId: x.jobId, loadedOn: x.started }))
                sourceCode.categories = sourcesAndCats.categories
            }

            const escCiSrc = removeCommands(JSON.stringify(sourceCode, undefined, 2))
            const content = "§<json \n" + escCiSrc + "\n§>"
            const pfel = new PostBody(content)
            this.#ui.source().replaceChildren(pfel)

            this.#ui.verifyButton().addEventListener("click", async () => {
                this.#ui.verifyButton().disabled = true
                const vr = new SDSTVerifyRequest(jsonSr, mainSettings.sdstUrl.get())
                await vr.start()
                this.#ui.verifyButton().disabled = false
            })

            this.#ui.verifyContentButton().addEventListener("click", async () => {
                this.#ui.verifyContentButton().disabled = true
                const vr = new SDSTVerifyRequest(userCi.data.content, mainSettings.sdstUrl.get())
                await vr.start()
                this.#ui.verifyContentButton().disabled = false
            })

            const dlContent = serializeUserCi(userCi)
            this.#ui.downloadButton().addEventListener("click", () => this.#ui.downloadA().click())
            anchorToPlainTextDownload(this.#ui.downloadA(), `${ciId.seqNo}_${ciId.chain}.senf.in.json`, dlContent)

            const isSigned = Array.isArray(userCi.data.content.signatures) && userCi.data.content.signatures.length == 1
            if (isSigned) showEl(this.#ui.verifyContentButton())
        }

        this.#ui.verifyButton().disabled = false
        this.#ui.verifyContentButton().disabled = false
        this.#ui.downloadButton().disabled = false
        this.#contentLoaded.resolve()
    }


    #urn() {
        const cnp = currentNaviPath()
        const uri = fallback(cnp.get("uri"), "", guard(""))

        const urn = parseCiUrn(uri)
        if (urn == null || urn.platform !== mainSettings.platformName.get()) return null
        return urn
    }
}

init()

