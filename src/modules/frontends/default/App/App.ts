//#region import/export
export { modName, App, pageTitleR }

import { tmpl as tmpl0 } from "../tmpl.js"
import { DeviceType, mainSettings, preferredTmpl } from "../../../../config.js"

import { addListener as addRouterListener, navigateWithinPage, currentNaviPath, NaviPath, toRoutedLink, RouterEvent, rewriteNaviPath, refresh, navigateTo, navigateToAndReload } from "../../../libs/etc/router.js"

//make custom components available in case they are used only as tag in html but not imported
import '../components/LoadingDots/LoadingDots.js'
import '../components/ByteSize/ByteSize.js'
import '../components/Date/Date.js'
import '../components/WaitingTime/WaitingTime.js'
import '../components/Countdown/Countdown.js'
import '../components/Alert/Alert.js'
import '../components/Confirm/Confirm.js'
import '../components/Prompt/Prompt.js'
import '../components/Uri/Uri.js'
import '../components/KeyId/KeyId.js'
import '../components/Poster/Poster.js'
import '../components/PeriodSelect/PeriodSelect.js'
import '../components/GalleryFilter/GalleryFilter.js'

import '../components/Tabs/Tabs.js'
import '../components/Paginated/Paginated.js'

import '../components/PostBody/PostBody.js'
import '../components/PostFull/PostFull.js'

import '../components/DownloadCis/DownloadCis.js'


import * as Post from "../../../backend/post/post.js"
import { DefaultLogger } from "../../../libs/basic/logger.js"
import { bindTo, onChange, ReactiveAtom, reactiveExpression, ThrottleReactiveValue } from "../../../libs/basic/reactive.js"
import { getRegisteredPages } from "./pages.js"
import { isMainTabR } from "../../../libs/etc/tab.js"
import { escapeHtml, ExposedPromise, sleep, toJson } from "../../../libs/basic/misc.js"
import { IsolatedStorage } from "../../../libs/etc/storage.js"

import { LocationPage } from "../pages/Location/Location.js"
import { QueuePage } from "../pages/Queue/Queue.js"
import { CiId, toCiUrn, UserCi } from "../../../backend/cidb/types/ci.js"
import { fallback, guard, typeOf } from "../../../libs/etc/guard.js"
import { Alert } from "../components/Alert/Alert.js"
import { watchDialogs } from "../../../libs/etc/dialogs.js"
import { bypassChecksActive, loadCiIntoDb } from "../../../backend/cidb/cidb.js"
import { HomePage } from "../pages/Home/Home.js"
import { hasScrollbar, showChildEl } from "../../../libs/etc/misc.js"
//#endregion

/**
 * - in-app navigation => through `navigateTo` or `navigateWihtinPage`
 * - refresh => `App.refresh()`
 * - other => page reload or back/forward function in user agent
 */
type NavigationType = "init" | "refresh" | "navigateTo" | "navigateWithinPage" | "other"


/**
 * todos:
 *   - test navi queue counter (mobile/desktop)
 *     - navi queue counter layout problem on mobile
 *   - fresh links (never show visited color)
 *     - decide which <a> in components should be fresh 
 *       and add class always-fresh to them
 */

const modName = "App"
const tmpl = (name: string, data: any) => tmpl0("App/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)
const storage = new IsolatedStorage("session", modName + ":scrollPos")

const pageTitleR = new ReactiveAtom<string>("")
const documentTitleR = reactiveExpression([pageTitleR, isMainTabR, Post.isLockedR, Post.enqueuedSizeR], title)
const goToSdstR = new ReactiveAtom(false)

const appEp = new ExposedPromise<App>()
let appP = appEp.promise

function init() {
    lg.info("INIT APP")
    history.scrollRestoration = "manual"
    customElements.define(App.tagName, App)
    bindTo(documentTitleR, document, "title")

    if (document.readyState != "loading") {
        lg.info("DOC READY, CALL initAfterDOM")
        initAfterDom()
    } else {
        addEventListener("DOMContentLoaded", initAfterDom)
    }

    (window as any).appScrollTo = App.scrollTo;
}

/**
 * Create App instance after DOM has loaded to ensure that all 
 * backend modules have been already initialized.
 */
function initAfterDom() {
    const app = new App()
    document.body.replaceChildren(app)
    //document.addEventListener("keydown", hotkeyHandler)
}

function title(pageTitle: string, isMainTab: boolean, isWorkingInPost: boolean, enqueuedSize: number) {
    const working = isWorkingInPost ? "*" : ""
    const size = isMainTab && enqueuedSize > 0 ? "(" + enqueuedSize + ")" : ""
    return working + (isMainTab ? "ṠF" : "SF") + size + " " + pageTitle
}

function scrollYPosition() {
    return window.scrollY || document.documentElement.scrollTop
}

class App extends HTMLElement {
    static readonly tagName = "sf-app"

    static readonly paths = {
        share: (userCi: UserCi) => new NaviPath().set("action", "share").set("ci", toJson(userCi))
    }

    #shadow: ShadowRoot
    readonly #ui = {
        header: () => this.#shadow.getElementById("header") as HTMLElement,
        main: () => this.#shadow.getElementById("main") as HTMLElement,
        logo: () => this.#shadow.getElementById("logo") as HTMLElement,
        logoImg: () => this.#shadow.getElementById("logoImg") as HTMLImageElement,
        naviQueueCounter: () => this.#shadow.getElementById("naviQueueCounter") as HTMLElement,
        naviEnqueuedCounter: () => this.#shadow.getElementById("naviEnqueuedCounter") as HTMLElement,
        naviAbortedCounter: () => this.#shadow.getElementById("naviAbortedCounter") as HTMLElement,
        naviRequiringSignature: () => this.#shadow.getElementById("naviRequiringSignature") as HTMLElement,
        naviItems: () => Array.from(this.#shadow.querySelectorAll<HTMLElement>(".navi-item")),

        shareLoadingDialog: () => this.#shadow.getElementById("shareLoadingDialog") as HTMLDialogElement,
        shareSuccessDialog: () => this.#shadow.getElementById("shareSuccessDialog") as HTMLDialogElement,
        shareFailedDialog: () => this.#shadow.getElementById("shareFailedDialog") as HTMLDialogElement,

        shareSucessMsg: () => this.#shadow.getElementById("shareSucessMsg") as HTMLElement,
        shareSeqNo: () => this.#shadow.querySelectorAll<HTMLElement>(".shareSeqNo"),
        shareFailedReason: () => this.#shadow.getElementById("shareFailedReason") as HTMLElement,

        dialogOkButton: (d: HTMLDialogElement) => d.querySelector<HTMLButtonElement>("button.okButton"),
        dialogCloseButton: (d: HTMLDialogElement) => d.querySelector<HTMLButtonElement>("button.closeButton"),
    }

    #lastNavigation: NavigationType = "init"
    #pageHasLoaded?: Promise<void>

    #lastScrollYPos
    #lastScrollYDelta
    static readonly minScrollThreshold = 100

    static #askBeforeClosingR = () => reactiveExpression(
        [isMainTabR, Post.enqueuedSizeR, goToSdstR],
        (iwt: boolean, es: number, goToSdst: boolean) => !goToSdst && iwt && es > 0
    )

    static #naviQueueCounterVisible = () => reactiveExpression(
        [mainSettings.layout, Post.enqueuedSizeR, Post.autoAbortedSizeR],
        (layout, es, as) => layout == DeviceType.Desktop || es + as > 0
    )

    static shareLink(userCi: UserCi) {
        const appUrl = new URL(mainSettings.appUrl.get())
        appUrl.hash = App.paths.share(userCi).toFragmentId()
        return appUrl.href
    }

    constructor() {
        super()
        this.#shadow = this.attachShadow({ mode: "open" })
        watchDialogs(this.#shadow)

        onChange(App.#askBeforeClosingR(), (abc) => {
            if (abc) {
                lg.debug("ask user for confirmation before closing tab")
                onbeforeunload = (ev) => ev.preventDefault()
            } else {
                lg.debug("don't ask user for confirmation before closing tab")
                onbeforeunload = null
            }
        })

        const tmplData = {
            pages: getRegisteredPages(),
            curPage: App.currentPage()
        }

        const converter = (x: number) => x == 0 ? "" : String(x)
        const converter2 = (x: boolean) => x ? "*" : ""

        this.#shadow.innerHTML = tmpl("app.html", tmplData)
        this.#ui.header().querySelectorAll("a").forEach(aEl => toRoutedLink(aEl, "navigateTo"))

        //show when bypass feature in cidb is activated
        if (bypassChecksActive()) this.#ui.header().classList.add("bypass-activated")

        bindTo(Post.enqueuedSizeR, this.#ui.naviEnqueuedCounter(), "innerHTML", { converter: converter })
        bindTo(Post.autoAbortedSizeR, this.#ui.naviAbortedCounter(), "innerHTML", { converter: converter })
        bindTo(Post.signatureMissingR, this.#ui.naviRequiringSignature(), "innerHTML", { converter: converter2 })

        onChange(App.#naviQueueCounterVisible(), this.setNaviQueueCounterVisibility.bind(this))
        onChange(isMainTabR, (isMainTab) => {
            const file = isMainTab && false ? "senf-writer" : "senf"
            this.#ui.logoImg().src = `assets/frontends/default/img/${file}.svg`
        })

        //trigger click on <a> element when user clicks on .naviItem but not <a> itself
        this.#ui.naviItems().forEach(el => {
            el.addEventListener("click", (ev) => {
                const target = ev.target as HTMLElement
                target.querySelector("a")?.click()
            })
        })

        // hide/show header due to y-scrolling
        const scrollEvent0 = new ReactiveAtom(null)
        addEventListener("scroll", () => scrollEvent0.set(null))
        const scrollEvent = new ThrottleReactiveValue(scrollEvent0, 100).throttled()
        this.#lastScrollYPos = new ReactiveAtom(scrollYPosition())
        this.#lastScrollYDelta = new ReactiveAtom(0)
        scrollEvent.onChange(() => {
            this.#lastScrollYDelta.set(scrollYPosition() - this.#lastScrollYPos.get())
            this.#lastScrollYPos.set(scrollYPosition())
        })
        this.#lastScrollYDelta.onChange(this.smartHeader.bind(this))

        //show menu when auto aborted changes
        // Post.autoAbortedSizeR.onChange(nv => {
        //     if (nv > 0) this.#showHeader()
        // })

        // initial navigation
        this.navigate({ type: "init" })
        addRouterListener((ev) => this.navigate(ev))

        //process actions
        appEp.resolve(this)
    }

    connectedCallback() {
        this.#processActions().then(() => appEp.resolve(this))
    }

    async #processActions() {
        const cnp = currentNaviPath()
        if (!cnp.hasPage()) {
            const action = fallback(cnp.get("action"), "", guard(""))
            switch (action) {
                case "share": {
                    lg.info("share action")

                    try {
                        const ciObj = cnp.get("ci")
                        if (typeOf(ciObj) !== "object") throw new Error("Post is missing or invalid.")
                        const ci = ciObj as any

                        this.#showShareLoadingDialog()
                        const res = await loadCiIntoDb(ci, false)
                        lg.info("loadCiIntoDb res", res)
                        if (res.type == "invalid") {
                            lg.error("Failed to load CI from share link", res.reason)
                            throw new Error("Invalid CI: " + res.reason.code)
                        }
                        this.#showShareSuccessDialog(res.alreadyExists, res.ciId)
                    } catch (e) {
                        lg.info("share failed:", e)
                        const err = e as Error
                        this.#showShareFailedDialog(err.message)
                    }
                }

                default:
                    break
            }
        }
    }

    //#region share dialogs
    #showShareLoadingDialog() {
        this.#ui.shareLoadingDialog().showModal()
    }

    #showShareSuccessDialog(exists: boolean, ciId: CiId) {
        this.#ui.shareLoadingDialog().close()

        const dEl = this.#ui.shareSuccessDialog()
        this.#ui.shareSeqNo().forEach(el => {
            lg.info("share seq no for %O %O", el, ciId)
            el.innerText = ciId.seqNo.toString()
        })
        showChildEl(this.#ui.shareSucessMsg(), exists ? 1 : 0)
        this.#ui.dialogOkButton(dEl)!.onclick = () => navigateToAndReload(LocationPage.paths.uri(new URL(toCiUrn(ciId)), false))
        this.#ui.dialogCloseButton(dEl)!.onclick = () => navigateToAndReload(HomePage.paths.default)

        dEl.showModal()
    }

    #showShareFailedDialog(reason: string) {
        this.#ui.shareLoadingDialog().close()

        const dEl = this.#ui.shareFailedDialog()
        this.#ui.dialogCloseButton(dEl)!.onclick = () => navigateToAndReload(HomePage.paths.default)

        this.#ui.shareFailedReason().innerText = reason

        dEl.showModal()
    }

    //#endregion

    headerHeight() {
        return this.#ui.header().clientHeight
    }

    #updateScrollPosition(path: NaviPath) {
        const frag = path.toFragmentId()
        const pos = scrollPosition()
        lg.debug("#updateScrollPosition %O %O", frag, pos)
        storage.set(frag, pos)
    }

    #lastScrollPosition(path: NaviPath) {
        const frag = path.toFragmentId()
        const pos = (storage.get(frag) ?? { x: 0, y: 0 }) as ReturnType<typeof scrollPosition>
        lg.debug("#lastScrollPosition %O %O", frag, pos)
        return pos
    }

    #longScrollbar() {
        lg.debug("long scroll bar")
        this.#ui.main().style.paddingBottom = "100vh"
    }

    #normalScrollbar() {
        lg.debug("normal scrollbar")
        this.#ui.main().style.paddingBottom = "4em"
        //this.#ui.main().style.paddingBottom = "100vh"
    }

    async navigate(ev: RouterEvent | { type: "init" }) {
        if (ev.type !== "init" && ev.data.newPath.has("action")) {
            await this.#processActions()
            return
        }

        this.#lastNavigation = ev.type == "init" ? "init" :
            (ev.data.oldPath.toFragmentId() == ev.data.newPath.toFragmentId() ? "refresh" :
                (!ev.data.inApp ? "other" :
                    (ev.data.withinPage ? "navigateWithinPage" : "navigateTo")))

        //remember scroll position of previous page
        if (this.#lastNavigation != "init" && this.#lastNavigation != "refresh") {
            this.#updateScrollPosition((ev as RouterEvent).data.oldPath)
        }

        //restore bottom padding for navigation across pages
        if (ev.type == "navigation" && !ev.data.withinPage) {
            lg.debug("reset padding bottom")
            this.#normalScrollbar()
        } else {
            lg.debug("dont reset padding bottom", ev)
        }

        //nothing to do for within page navigation
        if (this.#lastNavigation == "navigateWithinPage") return

        this.processSrResponse()
        this.updateActivePage()
        this.#pageHasLoaded = this.loadPage()

        await this.#pageHasLoaded
        lg.info("Initial content of page has been loaded")

        if (this.#lastNavigation == "other") {
            /**
             * Assume that the browser's back or forward function was used and 
             * apply scroll restoration. One exception where this heuristic fails 
             * is, if the user manually changes the URL in the address bar.
             */

            //sleep a bit to wait until rendering has finished
            await sleep(50)

            //restore scroll position
            const lastScrollPos = this.#lastScrollPosition(currentNaviPath())
            if (this.usesLongScrollbar()) {
                lg.debug("page uses long scrollbar")
                this.#longScrollbar()
            }
            window.scrollTo(lastScrollPos.x, lastScrollPos.y)
        } else {
            window.scrollTo(0, 0)
        }
    }

    /**
     * Resolves as soon as the initial content of the page has been loaded
     */
    async loadPage() {
        const mainEl = this.#shadow.getElementById("main") as HTMLElement

        const curPage = getRegisteredPages().find(p => p.pageName == App.currentPage())
        if (curPage === undefined) {
            const msg = "loadPage() failed since curPage is undefined (no registered page with name %s exists)"
            lg.impossible(msg, App.currentPage())
            throw new Error(msg.replace("%s", App.currentPage()))
        }
        const mainContent = new curPage.Element()
        mainEl.replaceChildren(mainContent)

        return await mainContent.initialContentLoaded
    }

    updateActivePage() {
        lg.debug("current page: %s", App.currentPage())
        this.#shadow.querySelectorAll(".navi-item").forEach(x => x.classList.remove("active"))
        this.#shadow.querySelector("#navi-" + App.currentPage())?.classList.add("active")
    }

    /**
     * Hides header when scrolling down beyond a certain threshold and 
     * shows it again when scrolling up. Only on mobile layout.
     * 
     * @param yDelta smaller than 0 iff user scrolled up
     */
    smartHeader(yDelta: number) {
        //don't do this on desktop
        if (mainSettings.layout.get() == DeviceType.Desktop) return

        if (scrollYPosition() == 0 || yDelta < 0) {
            //show header at the top or when user scrolled up
            this.showHeader()
        } else if (yDelta > 0 && scrollYPosition() > App.minScrollThreshold) {
            //hide header when user scrolls down and has scrolled beyond a certain point
            this.hideHeader()
        }
    }

    hideHeader(programatically?: boolean) {
        programatically ??= false
        //this.#ui.header().classList.add("display-none")
        this.#ui.header().classList.add("hidden")
        if (programatically) this.#ui.header().classList.add("programatically")
    }

    showHeader() {
        if (this.#ui.header().classList.contains("programatically")) {
            this.#ui.header().classList.remove("programatically")
            return
        }
        //this.#ui.header().classList.remove("display-none")
        this.#ui.header().classList.remove("hidden")
    }

    setNaviQueueCounterVisibility(visible: boolean) {
        if (visible) {
            lg.debug("is visible, layout %O", mainSettings.layout.get())
            this.#ui.naviQueueCounter().style.display = "inline-block"
        } else {
            lg.debug("is not visible, layout %O", mainSettings.layout.get())
            this.#ui.naviQueueCounter().style.display = "none"
        }
    }

    getLastNavigation() {
        return this.#lastNavigation
    }

    /**
     * Returns true if current navi path uses long scroll bar.
     * This is used to restore the bottom padding on the page
     * before restoring the scroll position.
     */
    usesLongScrollbar() {
        const longScrollbarFlags = ["stfc"]
        const cnp = currentNaviPath()
        return longScrollbarFlags.some(x => cnp.has(x))
    }

    /**
     * Handle sign request response if it was sent via fragment id
     */
    async processSrResponse() {
        const cnp = currentNaviPath()
        if (cnp.has("sr")) {
            goToSdstR.set(false)
            const sr = cnp.get("sr") as any
            lg.debug("sr: ", sr)
            const postId = sr["contextId"] as string
            const signedPlainText = sr["data"] as string
            const signed = sr["signed"] as boolean

            navigateWithinPage(currentNaviPath().unset("sr"))
            lg.debug("has sign request -> sign post %s with %O", postId, signedPlainText)

            try {
                if (signed === false) {
                    lg.info("sign cancelled %O", postId)
                    //Post.unsign(postId)
                } else {
                    lg.info("sign post %O", postId)
                    const res = await Post.sign(postId, signedPlainText)
                }
            } catch (e) {
                lg.error("Failed to sign %O", e)
                const msg = "Failed to sign because:<br>" + escapeHtml((e as Error).message)
                await App.alert(msg)
            }

            //if signData has no signature -> 
            //if signData is empty
            //if signData does not match post text

            /*
                todo:
                register event listeners to Post Sign/SignFailed events
                in case of failed -> notify user + try again 
                  - reasons: post does not exist, failed to get lock
                in case of ok -> msg to user
            */


            //if page was new before then move to queue (unless navi parameter "stay" exists)
        }
    }

    //#region external App API
    static async signPost(post: Post.PostItem) {
        if (!mainSettings.signRequestViaFragmentId.get()) {
            // sign via postMessage
            try {
                const userSigned = await Post.requestSignature(post)
                if (!userSigned) {
                    lg.warn("User cancelled sign request")
                    return
                }
            } catch (e) {
                const err = e as Error
                lg.error("Failed to sign post %O because %O", post, err)
                await App.alert(`Failed to sign post because:<br>${escapeHtml(err.message)}`)
                return
            }
        } else {
            // sign via fragment id
            try {
                const srUrl = sdstSignRequestUrl(post.toText(), QueuePage.paths.enqueued, post.postId())
                goToSdstR.set(true)
                window.open(srUrl, "_self")
                goToSdstR.set(false)
            } catch (e) {
                lg.error("Failed to sign post %O: %O", post, e)
            }
        }
    }

    static currentPage() {
        //if page param not set but url => add page=url 
        const cnp = currentNaviPath()

        if (!cnp.hasPage() && cnp.has("url")) {
            cnp.setPage(LocationPage.pageName)
            rewriteNaviPath(cnp)
            return LocationPage.pageName
        }

        //if page param set and valid => return current navi parameters        
        if (cnp.hasPage() && getRegisteredPages().find(p => p.pageName === cnp.get("page")) !== undefined) {
            return cnp.getPage() as string
        }

        return getRegisteredPages()[0].pageName
    }

    static async scrollTo(el: HTMLElement, forceScroll?: boolean) {
        const app = await appP
        if (app == undefined) {
            setTimeout(() => App.scrollTo(el), 50)
            return
        }
        if (app.#pageHasLoaded === undefined) {
            throw new Error("#pageHasLoaded is still undefined")
        }

        await app.#pageHasLoaded
        lg.debug("scroll to", el, forceScroll)

        if (forceScroll === true) {
            app.#longScrollbar()
            //app.#ui.main().style.paddingBottom = "100vh"
        }

        el.style.scrollMarginTop = `calc(${app.headerHeight()}px + 1em)`
        el.scrollIntoView()
        app.#updateScrollPosition(currentNaviPath())

        if (mainSettings.layout.get() == DeviceType.Mobile && hasScrollbar() && scrollYPosition() > App.minScrollThreshold) {
            //check for has scroll bar to make it possible to make the
            //header visible again by scrolling up
            app.hideHeader(true)
        }
    }

    static refresh() {
        refresh(true)
    }

    static async lastNavigation() {
        const app = await appP
        return app === undefined ? "load" : app.getLastNavigation()
    }

    static async alert(htmlText: string) {
        const al = new Alert(htmlText)
        const app = await appP
        app.#shadow.appendChild(al)
        await al.alert()
        al.remove()
    }
    //#endregion
}

function sdstSignRequestUrl(signData: string, callback: NaviPath, contextId: string): string {
    const obj = {
        "contextId": contextId,
        "callback": mainSettings.appUrl.get() + "/#" + callback.toFragmentId() + "&sr=",
        "signData": signData,
        "acceptedAlgorithms": mainSettings.acceptedAlgorithms.get(), //optional, can be used to specify accepted algs for plain text
        "acceptedDigestMethods": mainSettings.acceptedDigestMethods.get() //optional, can be used to specify accepted dms for plain text            
    }
    return mainSettings.sdstUrl.get() + "/#S" + encodeURIComponent(JSON.stringify(obj))
}

function scrollPosition() {
    const floor = (x: number) => Number(x.toFixed(2))
    return { x: floor(window.scrollX), y: floor(window.scrollY) }
}


// function addCss(href: string) {
//     const link = document.createElement("link")
//     link.rel = "stylesheet"
//     link.href = href
//     document.head.appendChild(link)
// }

init()
