export { HomePage, modName }

import { tmpl as tmpl0 } from "../../tmpl.js"
import { preferredTmpl } from "../../../../../config.js"
import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { navigateTo, NaviPath, toRoutedLink } from "../../../../libs/etc/router.js"
import { pageTitleR } from "../../App/App.js"
import { onChange, reactiveExpression } from "../../../../libs/basic/reactive.js"
import { JobReportCriteria, jobReportsCount, reactiveCounts } from "../../../../backend/cidb/reactive.js"
import { fromKeys, getLocationsStartingWith } from "../../../../backend/cidb/cidb.js"
import { ExposedPromise, nodesFromString } from "../../../../libs/basic/misc.js"
import { addCiGallery } from "../../components/CiGallery/CiGallery.js"
import { dateInFilename, showChildEl } from "../../../../libs/etc/misc.js"
import { BaseQuery } from "../../components/QueryBar/QueryBar.js"
import { LocationPage } from "../Location/Location.js"
import { PostPage } from "../Post/Post.js"
import { DownloadCis } from "../../components/DownloadCis/DownloadCis.js"

const modName = "HomePage"
const tmpl = (name: string, data: any) => tmpl0("pages/Home/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)

function init() {
    customElements.define(HomePage.tagName, HomePage)
}

class HomePage extends HTMLElement {
    static readonly pageName = "home"
    static readonly tagName = "sf-home"
    static readonly paths = {
        default: new NaviPath(this.pageName)
    }

    #contentLoaded = new ExposedPromise<void>()
    readonly initialContentLoaded = this.#contentLoaded.promise

    #disconnectedCallbackEp = new ExposedPromise<void>()

    #ciCountOnLoad: number = Number.NaN //ci count when HomePage is loaded

    #shadow: ShadowRoot
    readonly #ui = {
        url: () => this.#shadow.getElementById("url") as HTMLInputElement,
        urlSuggestions: () => this.#shadow.getElementById("urlSuggestions") as HTMLInputElement,
        go: () => this.#shadow.getElementById("go") as HTMLButtonElement,
        newComment: () => this.#shadow.getElementById("newComment") as HTMLButtonElement,
        loadComments: () => this.#shadow.getElementById("loadComments") as HTMLButtonElement,

        statusPart: () => this.#shadow.getElementById("statusPart") as HTMLElement,
        statusDownload: () => this.#shadow.getElementById("statusDownload") as HTMLElement,
        statusLoading: () => this.#shadow.getElementById("statusLoading") as HTMLElement,
        statusCommentsNew: () => this.#shadow.getElementById("statusCommentsNew") as HTMLElement,
        statusCommentsNewCount: () => this.#shadow.getElementById("statusCommentsNewCount") as HTMLElement,
        statusCommentsRefreshA: () => this.#shadow.getElementById("statusCommentsRefreshA") as HTMLAnchorElement,
        loadPageA: () => this.#shadow.getElementById("loadPageA") as HTMLAnchorElement,

        querybar: () => this.#shadow.getElementById("querybar") as HTMLElement,
        gallery: () => this.#shadow.getElementById("gallery") as HTMLElement
    }

    constructor() {
        super()
        pageTitleR.set("Home")

        //defaultQueryAspect(HomePage.pageName)

        this.#shadow = this.attachShadow({ mode: "open" })
        this.#shadow.innerHTML = tmpl("home.html", {
            commentCount: 0,
        })

        //#region loaded section
        const criteria: JobReportCriteria = {
            statuses: ["waiting", "started", "enqueued"],
            types: ["url", "file", "crawl"]
        }
        const loadingJobCountR = jobReportsCount(criteria)
        const statusLoadingVisibleR = reactiveExpression([loadingJobCountR], n => n > 0)
        onChange(statusLoadingVisibleR, (isLoading) => this.#updateStatusSection(isLoading))
        reactiveCounts.ciCountR.then((ciCountR) => {
            this.#ciCountOnLoad = ciCountR.get()
            onChange(ciCountR, () => this.#updateStatusSection(statusLoadingVisibleR.get()))
        })
        reactiveCounts.postCountR.then((postCountR) => {
            onChange(postCountR, newCount => {
                this.#ui.loadPageA().innerHTML = tmpl("loaded.html", {
                    commentCount: newCount
                })
            })
        })

        //#endregion

        //this.#initStatusSection()

        this.#updateSuggestions()
        this.#ui.url().addEventListener("input", ((ev: InputEvent) => {
            lg.debug("url input event: %O", ev)
            if (ev.inputType == "insertReplacementText") {
                //go to suggestion
                this.#ui.go().click()
            } else {
                this.#updateSuggestions()
            }
        }) as any)

        this.#ui.url().addEventListener("keypress", async (e) => {
            if (e.key != "Enter") return
            const uri = this.#ui.url().value.trim()
            if (uri == "") {
                //empty URI => new comment
                this.#ui.newComment().click()
            } else {
                const loc = (await fromKeys("location", [uri]))[0]
                if (loc != undefined && loc.loadedCiCount() > 0) {
                    //location has loaded CIs => go to location
                    this.#ui.go().click()
                } else {
                    //no loaded CIs => assume new comment
                    this.#ui.newComment().click()
                }
            }
        })
        this.#ui.go().addEventListener("click", this.goToPlace.bind(this))
        this.#ui.newComment().addEventListener("click", this.newComment.bind(this))
        toRoutedLink(this.#ui.statusCommentsRefreshA(), "refresh")
        toRoutedLink(this.#ui.loadPageA(), "navigateTo")
        const dlEl = new DownloadCis(exportCisFilename())
        this.#ui.statusDownload().replaceChildren(dlEl)

        //#region gallery
        const query: BaseQuery<"ci"> = {
            index: {
                type: "date",
                name: "postedOn",
                values: { type: "interval", start: new Date(0) }
            },
            order: [{ column: "postedOn", order: "desc" }],
            filter: {
                scheme: {
                    defined: true,
                    condition: { values: ["http", "https"] }
                }
            },
            period: {
                type: "youngerThan",
                value: 30,
                unit: "day"
            }
        }
        addCiGallery(query, this.#ui.querybar(), this.#ui.gallery(), { postFullOptions: { preview: true } })
            .then((x) => {
                x.querybar.loadDefaultQuery("home")
                this.#contentLoaded.resolve()
            })

        //#endregion
    }

    async #updateSuggestions() {
        let loc = this.#ui.url().value
        if (loc.length == 0) loc = "http"

        const locations = await getLocationsStartingWith(loc, true, 10)
        //lg.debug("get suggestions for %s: %O", loc, locations)

        type TmplData = {
            suggestions: {
                location: string,
                commentCount: number
            }[]
        }
        const tmplData: TmplData = {
            suggestions: locations.map(l => ({
                location: l.location(),
                commentCount: l.postCount()
            }))
        }
        const suggestions = nodesFromString(tmpl("suggestions.html", tmplData))
        this.#ui.urlSuggestions().replaceChildren(...suggestions)

    }

    async #updateStatusSection(loading: boolean) {
        await reactiveCounts.ciCountR
        await reactiveCounts.postCountR

        const spEl = this.#ui.statusPart()
        const statusParts = {
            dl: 0,
            loading: 1,
            new: 2
        }

        lg.debug("#updateStatusSection", loading, this.#ciCountOnLoad)
        if (loading) {
            showChildEl(spEl, statusParts.loading)
        } else {
            const newCis = (await reactiveCounts.ciCountR).get() > this.#ciCountOnLoad
            const curPart = newCis ? statusParts.new : statusParts.dl
            showChildEl(spEl, curPart)
        }
    }

    goToPlace() {
        const url = this.#ui.url().value.trim()
        if (url == "") return
        try {
            const np = new NaviPath("location").set("url", url)
            navigateTo(LocationPage.path({ type: "uri", url: new URL(url) }))
        } catch (e) {
            lg.error("Invalid URL: %O", e)
        }
    }

    newComment() {
        const uriStr = this.#ui.url().value.trim()
        const uri = uriStr == "" ? undefined : uriStr
        navigateTo(PostPage.paths.new(uri))
    }

    loadComments() {
        const np = new NaviPath("load")
        const url = this.#ui.url().value.trim()
        if (url.endsWith(".jsonl")) np.set("url", url)
        navigateTo(np)
    }

    disconnectedCallback() {
        this.#disconnectedCallbackEp.resolve()
    }
}

function exportCisFilename(date?: Date) {
    date ??= new Date()
    return `sf-all-posts-${dateInFilename()}.jsonl`
}

init()
