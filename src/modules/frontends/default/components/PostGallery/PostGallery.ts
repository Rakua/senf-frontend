export { PostGallery, PostGalleryOptions, modName, init }

import { mainSettings, preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"

import { DefaultLogger, } from "../../../../libs/basic/logger.js"
import { fromKeys, UserCiPrimaryKey } from "../../../../backend/cidb/cidb.js"
import { PostFull, PostFullOptions } from "../PostFull/PostFull.js"
import { Paginated, PaginatedOptions } from "../Paginated/Paginated.js"
import { ExposedPromise, nodeFromString } from "../../../../libs/basic/misc.js"

type PostGalleryOptions = {
    postFullOptions?: PostFullOptions,
    itemsPerPage?: number,
    pageParam?: string,
    scrollToEl?: PaginatedOptions["scrollTo"],
    showLastItemOfPreviousPage?: boolean
}

const modName = "PostGallery"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/PostGallery/" + name, data, preferredTmpl())
const defaultPageParam = "pc"

function init() {
    customElements.define(PostGallery.tagName, PostGallery)
}

class PostGallery extends HTMLElement {
    static readonly tagName = "sfc-post-gallery"

    readonly itemsPerPage: number
    readonly pageParam: string
    readonly postFullOptions: PostFullOptions
    readonly scrollToEl: PaginatedOptions["scrollTo"]
    readonly showLastItemOfPreviousPage: boolean

    #paginated: Paginated
    #primaryKeys: UserCiPrimaryKey[] = []

    #contentLoaded = new ExposedPromise<void>()
    initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    readonly #ui = {
        gallery: () => this.#shadow.getElementById("gallery") as HTMLElement
    }

    constructor(primaryKeys: UserCiPrimaryKey[], options?: PostGalleryOptions) {
        super()
        options ??= {}
        this.#shadow = this.attachShadow({ mode: "open" })
        this.itemsPerPage = options.itemsPerPage ?? 50
        this.pageParam = options.pageParam ?? defaultPageParam
        this.postFullOptions = options.postFullOptions ?? {}
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
            return nodeFromString(tmpl("no_comments.html", {}))

        const offset = (pageNo - 1) * this.itemsPerPage
        const container = document.createElement("div")
        container.setAttribute("part", "post-gallery")

        const pagePks = this.#primaryKeys.slice(offset, offset + this.itemsPerPage)
        if (this.showLastItemOfPreviousPage && pageNo > 1) {
            pagePks.unshift(this.#primaryKeys[offset - 1])
        }
        const posts = await fromKeys("post", pagePks)
        posts.forEach(p => {
            const postFullEl = new PostFull(p, this.postFullOptions)
            postFullEl.setAttribute("part", "post-item")

            const div = document.createElement("div")
            div.setAttribute("part", "post-item-container")
            div.appendChild(postFullEl)

            container.appendChild(div)
        })

        if (this.noOfPages() == 1 && mainSettings.layout.get() == "m") {            
            const el = container.firstElementChild as HTMLElement | null
            if (el != null) {
                lg.debug("setting paddding 0px: %O", el)                
                el.classList.add("no-top-padding")
            }
        }
        container.lastElementChild?.setAttribute("part", "post-item-container-last")
        return container
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