export { LocationGallery, LocationGalleryOptions, modName }

import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"

import { DefaultLogger, } from "../../../../libs/basic/logger.js"
import { fromKeys } from "../../../../backend/cidb/cidb.js"
import { Paginated, PaginatedOptions } from "../Paginated/Paginated.js"
import { ExposedPromise, nodeFromString } from "../../../../libs/basic/misc.js"
import { ciGallerySettings } from "../CiGallery/CiGallery.js"

type LocationGalleryOptions = {
    itemsPerPage?: number,
    pageParam?: string,
    scrollToEl?: PaginatedOptions["scrollTo"],
    showLastItemOfPreviousPage?: boolean
}

const modName = "LocationGallery"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/LocationGallery/" + name, data, preferredTmpl())
const defaultPageParam = "pl"

function init() {
    customElements.define(LocationGallery.tagName, LocationGallery)
}

class LocationGallery extends HTMLElement {
    static readonly tagName = "sfc-location-gallery"

    readonly itemsPerPage: number
    readonly pageParam: string
    readonly scrollToEl: PaginatedOptions["scrollTo"]
    readonly showLastItemOfPreviousPage: boolean

    #paginated?: Paginated
    #primaryKeys: string[] = []

    #contentLoaded = new ExposedPromise<void>()
    initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    readonly #ui = {
        gallery: () => this.#shadow.getElementById("gallery") as HTMLElement
    }

    constructor(primaryKeys: string[], options?: LocationGalleryOptions) {
        super()
        options ??= {}
        this.#shadow = this.attachShadow({ mode: "open" })
        this.itemsPerPage = options.itemsPerPage ?? ciGallerySettings.echosPerPage.get()
        this.pageParam = options.pageParam ?? defaultPageParam
        this.scrollToEl = options.scrollToEl
        this.showLastItemOfPreviousPage = options.showLastItemOfPreviousPage ?? false
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
            return nodeFromString(tmpl("no_locations.html", {}))

        const offset = (pageNo - 1) * this.itemsPerPage
        const pagePks = this.#primaryKeys.slice(offset, offset + this.itemsPerPage)
        if (this.showLastItemOfPreviousPage && pageNo > 1) {
            pagePks.unshift(this.#primaryKeys[offset - 1])
        }
        const locations = await fromKeys("location", pagePks)

        type TmplData = {
            locations: {
                location: string,
                firstCi: Date | undefined,
                lastCi: Date | undefined,
                lastPost: Date | undefined,
                postCount: number,
                echoSum: number,
                echoMax: number
            }[]
        }

        const tmplData: TmplData = {
            locations: locations.map(loc => ({
                location: loc.location(),
                firstCi: loc.firstCi(),
                lastCi: loc.lastCi(),
                lastPost: loc.lastPost(),
                postCount: loc.postCount(),
                echoSum: loc.echoSum(),
                echoMax: loc.echoMax()
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
        lg.debug("goto pageNo %O", pageNo)
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