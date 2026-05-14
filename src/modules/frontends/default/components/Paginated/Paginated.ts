export { PaginatedOptions, PageContents, Paginated, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { currentNaviPath, navigateWithinPage, rewriteNaviPath } from "../../../../libs/etc/router.js"
import { fallback, guard, primitiveType } from "../../../../libs/etc/guard.js"
import { ExposedPromise, toNumber } from "../../../../libs/basic/misc.js"
import { App } from "../../App/App.js"
import { EventEmitter, Events } from "../../../../libs/basic/events.js"

//#region events
type PaginatedEvent = PaginatedEventGoto
type PaginatedEventGoto = {
    type: "goto",
    data: {
        newPage: number,
        oldPage: number,
        action: "first" | "last" | "prev" | "next" | "input" | "programatically",
        fromBottonNavi: boolean
    }
}
//#endregion

//#region types
type PageContents = (pageNo: number) => Node | Promise<Node>
type PaginatedOptions = {
    parameter?: string,
    noNaviOnSinglePage?: boolean,
    scrollTo?: HTMLElement | "topNavi" | "noScroll"
}
//#endregion

const modName = "PaginatedComponent"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/Paginated/" + name, data, preferredTmpl())

function init() {
    customElements.define(Paginated.tagName, Paginated)
}

class Paginated extends HTMLElement implements EventEmitter<PaginatedEvent> {
    static readonly tagName = "sfc-paginated"

    #pageContents: PageContents
    #pageCount: number
    #curPage: number
    #parameter: string
    #scrollToEl: HTMLElement | null

    #contentLoaded = new ExposedPromise<void>()
    initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    #ui = {
        top: () => this.#shadow.getElementById("top")!,

        navi: () => Array.from(this.#shadow.querySelectorAll<HTMLElement>(".pagination-navi")),

        firstPage: () => Array.from(this.#shadow.querySelectorAll<HTMLElement>(`[name=firstPage]`)),
        prevPage: () => Array.from(this.#shadow.querySelectorAll<HTMLElement>(`[name=prevPage]`)),
        curPage: () => Array.from(this.#shadow.querySelectorAll<HTMLInputElement>(`[name=curPage]`)),
        pageCount: () => Array.from(this.#shadow.querySelectorAll<HTMLElement>(`[name=pageCount]`)),
        nextPage: () => Array.from(this.#shadow.querySelectorAll<HTMLElement>(`[name=nextPage]`)),
        lastPage: () => Array.from(this.#shadow.querySelectorAll<HTMLElement>(`[name=lastPage]`)),

        pageContents: () => this.#shadow.getElementById("pageContents")!,
    }

    #events = new Events<PaginatedEvent>()
    addListener = this.#events.export().addListener
    removeListener = this.#events.export().removeListener

    constructor(pageCount: number, pageContents: PageContents, options?: PaginatedOptions) {
        super()

        const noNaviOnSinglePage = options?.noNaviOnSinglePage ?? true
        if (pageCount < 1) error("page count needs to be at least 1, got %s in %O", pageCount, this)
        this.#pageCount = pageCount
        this.#pageContents = pageContents
        this.#parameter = options?.parameter ?? "p"
        this.#curPage = fallback(currentNaviPath().get(this.#parameter), 1, guard(primitiveType.number, this.#isValidPage.bind(this)))

        this.#shadow = this.attachShadow({ mode: "open" })
        this.#shadow.innerHTML = tmpl("paginated.html", {
            top: { isBottom: false },
            bot: { isBottom: true }
        })

        //after shadow DOM init because this.#ui.top() needs to be defined
        //App.setScrollMarginTop(this.#ui.top())
        const scrollTo = options?.scrollTo ?? "topNavi"
        this.#scrollToEl =
            scrollTo == "noScroll" ? null :
                scrollTo == "topNavi" ? this.#ui.top() : scrollTo

        //set page count and current page in navi
        this.#ui.pageCount().forEach(el => el.innerText = this.#pageCount.toString())
        this.#setCurrentPageInNavi(false)

        //listeners for buttons and page number input
        this.#ui.firstPage().forEach(btn => btn.addEventListener("click",
            this.#genericNaviAction(() => 1, "first", this.#fromBottomNavi(btn))))
        this.#ui.lastPage().forEach(btn => btn.addEventListener("click",
            this.#genericNaviAction(() => this.pageCount(), "last", this.#fromBottomNavi(btn))))
        this.#ui.prevPage().forEach(btn => btn.addEventListener("click",
            this.#genericNaviAction(() => this.curPage() - 1, "prev", this.#fromBottomNavi(btn))))
        this.#ui.nextPage().forEach(btn => btn.addEventListener("click",
            this.#genericNaviAction(() => this.curPage() + 1, "next", this.#fromBottomNavi(btn))))

        this.#ui.curPage().forEach(inp => {
            inp.addEventListener("change", () => {
                const newPage = toNumber(inp.value)
                if (newPage === null || !this.#isValidPage(newPage)) {
                    //restore old page no
                    this.#setCurrentPageInNavi(false)
                    return
                }
                const oldPage = this.curPage()
                if (!this.#goto(newPage, false)) return
                this.#events.emitEvent({
                    type: "goto",
                    data: {
                        newPage: newPage,
                        oldPage: oldPage,
                        action: "input",
                        fromBottonNavi: this.#fromBottomNavi(inp)
                    }
                })
            })
        })

        //hide navi when there is only a single page
        if (noNaviOnSinglePage && pageCount == 1)
            this.#ui.navi().forEach(el => el.classList.add("display-none"))

        //show current page
        this.#showCurrentPage(true).then(() => this.#contentLoaded.resolve())

        //scroll to top when bottom navi was used
        this.addListener((ev) => {
            if (ev.data.fromBottonNavi) this.scrollToTop()
        })
    }

    /**
     * @param pageNo starts with 1
     * @param disableScroll will not scroll if set to true
     */
    goto(pageNo: number) {
        const oldPage = this.curPage()
        const changed = this.#goto(pageNo, true)
        if (changed) {
            this.#events.emitEvent({
                type: "goto",
                data: {
                    newPage: pageNo,
                    oldPage: oldPage,
                    action: "programatically",
                    fromBottonNavi: false
                }
            })
        }

        return changed
    }

    /**
     * @returns true if current page was changed
     */
    #goto(pageNo: number, throwOnInvalidPage: boolean) {
        lg.debug("#goto %O %O", pageNo, throwOnInvalidPage)
        if (!this.#isValidPage(pageNo)) {
            if (throwOnInvalidPage) throw new Error("invalid page number")
            return false
        }

        lg.debug("#goto valid")
        if (pageNo == this.#curPage) {
            lg.debug("no change")
            const cnp = currentNaviPath()
            if (pageNo == 1 && cnp.get(this.#parameter) !== 1) {
                //page no is 1 by default (URL parameter not specified or invalid)
                //user actively navigates to 1 -> just set it in the URL without
                //affecting the history
                rewriteNaviPath(cnp.set(this.#parameter, 1))
            }

            return false
        }

        lg.debug("set new pageNo")
        this.#curPage = pageNo
        this.#setCurrentPageInNavi(true)
        this.#showCurrentPage()
        return true
    }

    curPage() {
        return this.#curPage
    }

    pageCount() {
        return this.#pageCount
    }

    #genericNaviAction(newPage: () => number, action: PaginatedEventGoto["data"]["action"], fromBottonNavi: boolean) {
        const f = () => {
            const oldPage = this.curPage()
            const newPage0 = newPage()

            if (!this.#goto(newPage0, false)) return

            //page changed -> emit event
            this.#events.emitEvent({
                type: "goto",
                data: {
                    newPage: newPage0,
                    oldPage: oldPage,
                    action: action,
                    fromBottonNavi: fromBottonNavi
                }
            })
        }
        return f.bind(this)
    }

    #isValidPage(pageNo: number) {
        return pageNo >= 1 && pageNo <= this.#pageCount && pageNo % 1 == 0
    }

    #setCurrentPageInNavi(updateUrl: boolean) {
        lg.debug("setCurrentPageInNavi %s (update url = %O)", this.#curPage, updateUrl)
        this.#ui.curPage().forEach(el => el.value = this.#curPage.toString())
        if (updateUrl) navigateWithinPage(currentNaviPath().set(this.#parameter, this.#curPage))
    }

    async #showCurrentPage(calledFromConstructor?: boolean) {
        calledFromConstructor ??= false

        const contents = await this.#pageContents(this.#curPage)
        this.#ui.pageContents().replaceChildren(contents)

        if (calledFromConstructor) this.#contentLoaded.resolve()
    }

    /**
     * Determines if `el` is part of the bottom navigation bar.
     */
    #fromBottomNavi(el: HTMLElement) {
        const parent = el.closest(".pagination-navi")
        if (parent === null) return false
        return parent.classList.contains("bottomNavi")
    }


    /**
     * If the property `scrollTo` in the `options` parameter to the constructor
     * was set to `"noScroll"` then this method does nothing.
     */
    scrollToTop() {
        if (this.#scrollToEl == null) return
        App.scrollTo(this.#scrollToEl)
    }
}

function error(msg: string, ...args: any[]): never {
    lg.impossible(msg, args)
    throw new Error(`error in <${Paginated.tagName}>, see logger output [IMP][${modName}] for more details`)
}

init()
