export { CiGallery, CiGalleryQuery, modName, settings as ciGallerySettings, addCiGallery }

import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { Query, queryWithoutProgress } from "../../../../backend/cidb/cidb.js"
import { PostFullOptions } from "../PostFull/PostFull.js"
import { newSettings } from "../../../../libs/etc/settings.js"
import { guards } from "../../../../libs/etc/guard.js"
import { ExposedPromise, toJson } from "../../../../libs/basic/misc.js"
import { Tabs } from "../Tabs/Tabs.js"
import { PostGallery, PostGalleryOptions } from "../PostGallery/PostGallery.js"
import { EchoGallery, EchoGalleryOptions } from "../EchoGallery/EchoGallery.js"
import { Paginated, PaginatedOptions } from "../Paginated/Paginated.js"
import { BaseQuery, QueryBar } from "../QueryBar/QueryBar.js"
import { App } from "../../App/App.js"

//#region types
type CiGalleryQuery = Omit<Query<"post">, "entity"> & Omit<Query<"echo">, "entity">

type CiGalleryOptions = {
    postFullOptions?: PostFullOptions,
    showUrl?: boolean,
    echosPerPage?: number,
    postsPerPage?: number,
    scrollToEl?: PaginatedOptions["scrollTo"],
    showLastItemOfPreviousPage?: boolean,
    fromJobId?: number
}
//#endregion

const modName = "CiGallery"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/CiGallery/" + name, data, preferredTmpl())

const settings = newSettings(modName, {
    postsPerPage: { default: 20, guard: guards.positiveInteger },
    echosPerPage: { default: 20, guard: guards.positiveInteger },
    showLastItemOfPreviousPage: { default: false }
})

function init() {
    customElements.define(CiGallery.tagName, CiGallery)
}

async function addCiGallery(baseQuery: BaseQuery<"ci">, querybarEl: HTMLElement, galleryEl: HTMLElement, ciGalleryOptions?: CiGalleryOptions) {
    ciGalleryOptions ??= {}

    const querybar = new QueryBar("ci", baseQuery)
    return await querybar.liveQueryCi().then(async (liveQuery) => {
        const gallery = new CiGallery(await liveQuery.get(), {
            postFullOptions: { showUrl: true },
            scrollToEl: galleryEl,
            ...ciGalleryOptions,
        })
        liveQuery.onChange(async (query) => await gallery.setQuery(await query))
        querybarEl.replaceChildren(querybar)
        galleryEl.replaceChildren(gallery)

        await Promise.allSettled([querybar.initialContentLoaded, gallery.initialContentLoaded])
        return {
            gallery: gallery,
            querybar: querybar
        }
    })
}

class CiGallery extends HTMLElement {
    static readonly tagName = "sfc-ci-gallery"

    readonly postsPerPage: number
    readonly echosPerPage: number
    readonly showUrl: boolean
    readonly postFullOptions: PostFullOptions
    readonly showLastItemOfPreviousPage: boolean
    readonly scrollToEl: PaginatedOptions["scrollTo"]
    readonly fromJobId?: number

    #galleryQuery: CiGalleryQuery

    #contentLoaded = new ExposedPromise<void>()
    initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    #tabs0 = () => this.#shadow.getElementById("tabs") as Tabs
    readonly #ui = {
        tabs: this.#tabs0,
        commentCount: () => (this.#tabs0().get("comments").title as HTMLElement).getElementsByClassName("count").item(0) as HTMLElement,
        echoCount: () => (this.#tabs0().get("echos").title as HTMLElement).getElementsByClassName("count").item(0) as HTMLElement,

        periodSelect: () => this.#shadow.getElementById("periodSelect") as HTMLSelectElement,
        orderSelect: () => this.#shadow.getElementById("orderSelect") as HTMLSelectElement,
    }

    /**
     * 
     * @param index may be a set of CI primary keys or 
     * @param options 
     */
    constructor(galleryQuery: CiGalleryQuery, options?: CiGalleryOptions) {
        super()

        options ??= {}
        options.postFullOptions ??= {}
        options.postFullOptions.showUrl ??= options.showUrl

        this.postsPerPage = options.postsPerPage ?? settings.postsPerPage.get()
        this.echosPerPage = options.echosPerPage ?? settings.echosPerPage.get()
        this.showUrl = options.showUrl ?? true
        this.postFullOptions = options.postFullOptions ?? { showUrl: this.showUrl }
        this.scrollToEl = options.scrollToEl ?? this
        this.showLastItemOfPreviousPage = options.showLastItemOfPreviousPage ?? settings.showLastItemOfPreviousPage.get()
        this.fromJobId = options.fromJobId
        if (this.fromJobId !== undefined) this.postFullOptions.fromJobId = this.fromJobId
        this.#galleryQuery = galleryQuery

        this.#shadow = this.attachShadow({ mode: "open" })
        this.#shadow.innerHTML = tmpl("ci_gallery.html", {})
        this.#setQuery(galleryQuery, true).then(() => this.#contentLoaded.resolve())
    }

    async #setQuery(galleryQuery: CiGalleryQuery, fromConstructor: boolean) {
        this.#galleryQuery = galleryQuery
        const g = await this.#render()
        if (fromConstructor) return
        g.postGallery.goto(1)
        g.echoGallery.goto(1)
    }

    async setQuery(galleryQuery: CiGalleryQuery) {
        lg.debug("set query called")
        await this.#setQuery(galleryQuery, false)
    }

    async scrollToFirstComment() {
        lg.debug("scrollToFirstComment")
        await this.initialContentLoaded

        const lastNaviType = await App.lastNavigation()
        const stfcNaviTypes: typeof lastNaviType[] = ["navigateTo", "navigateWithinPage", "refresh"]
        if (!stfcNaviTypes.includes(lastNaviType)) {
            lg.debug("just restore old scroll position")
            return
        }

        const pg = this.#ui.tabs().shadowRoot!.querySelector("sfc-post-gallery")
        const tabsEl = this.#shadow.querySelector<Tabs>("sfc-tabs")
        if (tabsEl == null) {
            lg.impossible("tabsEl not found")
            return
        }
        const postGalleryEl = tabsEl.shadowRoot?.querySelector<PostGallery>("sfc-post-gallery")

        if (postGalleryEl == null) {
            lg.impossible("postGalleryEl not found")
            return
        }
        const paginatedEl = postGalleryEl.shadowRoot?.querySelector<Paginated>("sfc-paginated")
        if (paginatedEl == null) {
            lg.impossible("paginatedEl not found")
            return
        }
        const pageContentsEl = paginatedEl.shadowRoot?.getElementById("pageContents")
        if (pageContentsEl == null) {
            lg.impossible("pageContentsEl not found")
            return
        }
        const postGalleryPart = pageContentsEl.children[0] as HTMLElement
        if (postGalleryPart == null) {
            lg.impossible("postGalleryPart not found")
            return
        }
        lg.debug("scrollToFirstComment to %O", postGalleryPart)
        App.scrollTo(postGalleryPart, true)
    }

    async #render() {
        const postQuery = { ...this.#galleryQuery, entity: "post" } as Query<"post">
        const echoQuery = { ...this.#galleryQuery, entity: "echo" } as Query<"echo">

        const echoPks = await queryWithoutProgress(echoQuery)
        const postPks = await queryWithoutProgress(postQuery)

        lg.debug("post pks: %O", postPks)
        lg.debug("echo pks: %O", echoPks)

        const postGallery = new PostGallery(postPks, this.#postGalleryOptions())
        const echoGallery = new EchoGallery(echoPks, this.#echoGalleryOptions())

        await this.#ui.tabs().initialContentLoaded
        await Promise.allSettled([postGallery.initialContentLoaded, echoGallery.initialContentLoaded])

        this.#ui.commentCount().innerText = postPks.length.toString()
        this.#ui.echoCount().innerText = echoPks.length.toString()
        this.#ui.tabs().get("comments").contents.replaceChildren(postGallery)
        this.#ui.tabs().get("echos").contents.replaceChildren(echoGallery)
        return { postGallery: postGallery, echoGallery: echoGallery }
    }

    #postGalleryOptions(): PostGalleryOptions {
        return {
            postFullOptions: this.postFullOptions,
            itemsPerPage: this.postsPerPage,
            pageParam: "pc",
            scrollToEl: this.scrollToEl,
            showLastItemOfPreviousPage: this.showLastItemOfPreviousPage
        }
    }

    #echoGalleryOptions(): EchoGalleryOptions {
        return {
            itemsPerPage: this.echosPerPage,
            pageParam: "pe",
            scrollToEl: this.scrollToEl,
            showLastItemOfPreviousPage: this.showLastItemOfPreviousPage,
            fromJobId: this.fromJobId,
            showUrl: this.showUrl
        }
    }

}

init()