export { EchoGallery, EchoGalleryOptions, modName }

import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"

import { DefaultLogger, } from "../../../../libs/basic/logger.js"
import { fromKeys, UserCiPrimaryKey } from "../../../../backend/cidb/cidb.js"
import { Paginated, PaginatedOptions } from "../Paginated/Paginated.js"
import { ExposedPromise, nodeFromString, toJson } from "../../../../libs/basic/misc.js"
import { LocationPage } from "../../pages/Location/Location.js"

type EchoGalleryOptions = {
    itemsPerPage?: number,
    pageParam?: string,
    showUrl?: boolean,
    scrollToEl?: PaginatedOptions["scrollTo"],
    showLastItemOfPreviousPage?: boolean,
    fromJobId?: number
}

const modName = "EchoGallery"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/EchoGallery/" + name, data, preferredTmpl())
const defaultPageParam = "pe"

function init() {
    customElements.define(EchoGallery.tagName, EchoGallery)
}

class EchoGallery extends HTMLElement {
    static readonly tagName = "sfc-echo-gallery"

    readonly itemsPerPage: number
    readonly pageParam: string
    readonly scrollToEl: PaginatedOptions["scrollTo"]
    readonly showLastItemOfPreviousPage: boolean
    readonly fromJobId?: number
    readonly showUrl: boolean

    #paginated?: Paginated
    #primaryKeys: UserCiPrimaryKey[] = []

    #contentLoaded = new ExposedPromise<void>()
    initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    readonly #ui = {
        gallery: () => this.#shadow.getElementById("gallery") as HTMLElement
    }

    constructor(primaryKeys: UserCiPrimaryKey[], options?: EchoGalleryOptions) {
        super()

        lg.debug("echo gallery pks: %O", primaryKeys)

        options ??= {}
        this.#shadow = this.attachShadow({ mode: "open" })
        this.itemsPerPage = options.itemsPerPage ?? 20
        this.pageParam = options.pageParam ?? defaultPageParam
        this.scrollToEl = options.scrollToEl
        this.showLastItemOfPreviousPage = options.showLastItemOfPreviousPage ?? false
        this.fromJobId = options.fromJobId
        this.showUrl = options.showUrl ?? true
        this.#primaryKeys = primaryKeys

        this.#shadow.innerHTML = tmpl("gallery.html", {})
        this.#paginated = new Paginated(this.noOfPages(), this.#page.bind(this), {
            parameter: this.pageParam,
            scrollTo: this.scrollToEl
        })
        this.#ui.gallery().replaceChildren(this.#paginated)
        this.#paginated.initialContentLoaded.then(() => this.#contentLoaded.resolve())
    }

    async #page(pageNo: number) {
        if (this.#primaryKeys.length == 0)
            return nodeFromString(tmpl("no_echos.html", {}))

        const offset = (pageNo - 1) * this.itemsPerPage
        const pagePks = this.#primaryKeys.slice(offset, offset + this.itemsPerPage)
        if (this.showLastItemOfPreviousPage && pageNo > 1) {
            pagePks.unshift(this.#primaryKeys[offset - 1])
        }
        const echos = await fromKeys("echo", pagePks)

        type TmplData = {
            isSinglePage: boolean,
            showUrl: boolean,
            echos: {
                seqNo: number,
                ciHref: string,
                location?: string,
                posterKind: "keyid" | "anon" | "unknown",
                keyId?: string,
                isYou: boolean,
                postedOn: Date,
                waitingTime: number,
                isNew: boolean
            }[]
        }

        const tmplData: TmplData = {
            isSinglePage: this.noOfPages() == 1,
            showUrl: this.showUrl,
            echos: echos.map(ci => ({
                seqNo: ci.ciId().seqNo,
                ciHref: LocationPage.path({ type: "uri", url: new URL(ci.ciUrn()) }).toFragmentId(),
                location: ci.location(),
                posterKind: ci.posterKind(),
                keyId: ci.poster(),
                isYou: ci.isYou() ?? false,
                postedOn: ci.postedOn(),
                waitingTime: ci.waitingTime(),
                isNew: this.fromJobId !== undefined && this.fromJobId === ci.firstJobId()
            }))
        }

        return nodeFromString(tmpl("table.html", tmplData))
    }

    noOfPages() {
        return Math.max(Math.ceil(this.#primaryKeys.length / this.itemsPerPage), 1)
    }

    /**
     * Must wait until `this.initialContentLoaded` has resolved, otherwise
     * an error is thrown since the paginated element might not be defined
     * yet.
     */
    goto(pageNo: number) {
        if (!this.#paginated) throw new Error("paginated element not defined. wait until initial content has loaded")
        this.#paginated.goto(pageNo)
    }

    /**
     * Must wait until `this.initialContentLoaded` has resolved, otherwise
     * an error is thrown since the paginated element might not be defined
     * yet.
     */
    curPage() {
        if (!this.#paginated) throw new Error("paginated element not defined. wait until initial content has loaded")
        return this.#paginated.curPage()
    }
}

init()