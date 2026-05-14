//#region import/export
export { QueuePage, modName }

import { tmpl as tmpl0 } from "../../tmpl.js"
import { preferredTmpl, mainSettings, dateToString } from "../../../../../config.js"
import { DefaultLogger } from "../../../../libs/basic/logger.js"

import * as Post from "../../../../backend/post/post.js"
import { bindToInnerHtml, bindToTextContent } from "../../../../libs/basic/reactive.js"
import { currentNaviPath, navigateTo, NaviPath } from "../../../../libs/etc/router.js"
import { capitalize, ExposedPromise } from "../../../../libs/basic/misc.js"
import { App, pageTitleR } from "../../App/App.js"
import { PostPage } from "../Post/Post.js"
import { LocationPage } from "../Location/Location.js"
import { ciMetadata, toCiUrn } from "../../../../backend/cidb/types/ci.js"
//#endregion

//#region types
interface GenericItemTmplData {
    postId: string,
    location: string,
    locationLabel: string,
    locationUrl: string,
    isHttp: boolean,
    content?: string,
    waitingTimeMin: number,
    keyId?: string,
    missingSignature: boolean,
    hasTicket: boolean
}

interface EnqueuedItemTmplData extends GenericItemTmplData {
    queueIndex: number,
    ets: Date, //estimated time of submission
    etsTime: string,
    freeTime: number, //number of free minutes before this post
    showCountdown: boolean,
    signable: boolean
}

interface PostedItemTmplData extends GenericItemTmplData {
    seqNo: number,
    ciPath: NaviPath,
    postTime: Date,
    postTimeShort: string
}

interface AbortedItemTmplData extends GenericItemTmplData {
    abortReason: string
}
//#endregion

const modName = "QueuePage"
const tmpl = (name: string, data: any) => tmpl0("pages/Queue/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)

function init() {
    customElements.define(QueuePage.tagName, QueuePage)
}

class QueuePage extends HTMLElement {
    static readonly pageName = "queue"
    static readonly tagName = "sf-queue"
    static readonly paths = {
        default: new NaviPath(this.pageName), // shows enqueued
        enqueued: new NaviPath(this.pageName).set("tab", Post.ItemLocation.Enqueued),
        posted: new NaviPath(this.pageName).set("tab", Post.ItemLocation.Posted),
        aborted: new NaviPath(this.pageName).set("tab", Post.ItemLocation.Aborted)
    }

    #contentLoaded = new ExposedPromise<void>()
    readonly initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    #ui = {
        newComment: () => this.#shadow.getElementById("newComment") as HTMLButtonElement,
        gotoYourPosts: () => this.#shadow.getElementById("gotoYourPosts") as HTMLButtonElement,
        removeAllAborted: () => this.#shadow.getElementById("removeAllAborted") as HTMLButtonElement,
        removeAllPosted: () => this.#shadow.getElementById("removeAllPosted") as HTMLButtonElement,
        signButtons: () => this.#shadow.querySelectorAll(".signButton") as NodeListOf<HTMLElement>,
        abortButtons: () => this.#shadow.querySelectorAll(".abortButton") as NodeListOf<HTMLElement>,
        repostButtons: () => this.#shadow.querySelectorAll(".repostButton") as NodeListOf<HTMLElement>,
        removeButtons: () => this.#shadow.querySelectorAll(".removeButton") as NodeListOf<HTMLElement>,
        tab: (loc: Post.ItemLocation, el: "Size" | "Link" | "Tab") => this.#shadow.getElementById(loc + el) as HTMLElement
    }

    constructor() {
        super()
        this.#shadow = this.attachShadow({ mode: "closed" })
    }

    connectedCallback() {
        pageTitleR.set(capitalize(this.currentTab()) + " posts")
        this.#shadow.innerHTML = tmpl("queue.html", {})
        this.openTab(this.currentTab())

        for (const loc of Object.values(Post.ItemLocation)) {
            const converter = (data: Post.PostItem[]) => tmpl("table_" + loc + ".html", { items: this.#dataGetMux(loc)(data) })
            const afterUpdate = this.#registerListeners[loc].bind(this)

            bindToTextContent(Post.sizeR[loc], this.#ui.tab(loc, "Size"))
            bindToInnerHtml(
                Post.stateR[loc],
                this.#ui.tab(loc, "Tab"),
                { converter: converter, afterUpdate: afterUpdate }
            )
        }

        this.#contentLoaded.resolve()
    }

    //#region tab
    currentTab(): Post.ItemLocation {
        const np = currentNaviPath()
        if (np.get("tab") === Post.ItemLocation.Posted) return Post.ItemLocation.Posted
        if (np.get("tab") === Post.ItemLocation.Aborted) return Post.ItemLocation.Aborted
        return Post.ItemLocation.Enqueued
    }

    openTab(itemLocation: Post.ItemLocation) {
        for (const loc of Object.values(Post.ItemLocation)) {
            if (loc == itemLocation) {
                this.#ui.tab(loc, "Link").classList.add("underline")
                this.#ui.tab(loc, "Tab").classList.remove("display-none")
            } else {
                this.#ui.tab(loc, "Link").classList.remove("underline")
                this.#ui.tab(loc, "Tab").classList.add("display-none")
            }
        }
    }
    //#endregion

    //#region compute tmpl data
    #dataGetMux(loc: Post.ItemLocation) {
        switch (loc) {
            case Post.ItemLocation.Enqueued: return this.#enqueuedDataGet.bind(this)
            case Post.ItemLocation.Posted: return this.#postedDataGet.bind(this)
            case Post.ItemLocation.Aborted: return this.#abortedDataGet.bind(this)
        }
    }

    #enqueuedDataGet(enqItems: Post.PostItem[]): EnqueuedItemTmplData[] {
        const now = new Date()
        const tmplData: EnqueuedItemTmplData[] = []
        for (const [index, item] of enqItems.entries()) {
            const data = this.#genericDataGet(item)

            //n > 0: freeTime = item[n].postTimeClient - item[n-1].earliestSubmissionData
            //n = 0: freeTime = item[n].postTimeClient - now 
            //convert to minutes: Math.floor(.../60000)
            //if smaller than 0 then take 0: Math.max(0,...)
            // in minutes, floor value
            const freeTime = item.getPostTime().client == undefined
                ? 0
                : Math.max(0, Math.floor((item.getPostTime().client.getTime() -
                    (index == 0
                        ? now.getTime()
                        : enqItems[index - 1].earliestSubmissionDate().getTime())) / 60000))

            const etsTime = new Intl.DateTimeFormat(mainSettings.locale.get(),{
                timeStyle: mainSettings.timeStyle.get()
            }).format()

            tmplData.push({
                ...data,
                queueIndex: index + 1,
                ets: item.earliestSubmissionDate(),
                //etsTime: dateToTime(item.earliestSubmissionDate(), mainSettings.use12hFormat.get()),
                etsTime: dateToString(item.earliestSubmissionDate(), "timeOnly"),
                freeTime: freeTime,
                showCountdown: index == 0 && item.hasTicket(),
                signable: index > 0 || !item.hasTicket()
            })
        }
        return tmplData
    }

    #postedDataGet(postedItems: Post.PostItem[]): PostedItemTmplData[] {
        const tmplData: PostedItemTmplData[] = []
        postedItems.reverse().forEach(item => {
            const ciMd = ciMetadata(item.ci!)
            const seqNo = ciMd.seqNo
            const chain = ciMd.chain
            const ciUrn = toCiUrn({seqNo: seqNo, chain: chain})
            tmplData.push({
                ...this.#genericDataGet(item),
                seqNo: seqNo,
                //ciPath: new NaviPath("location").set("url", `ci:${seqNo}@qa2.senf.in`),
                ciPath: LocationPage.path({type: "uri", url: new URL(ciUrn)}),
                postTime: ciMd.timestamp,
                postTimeShort: dateToString(ciMd.timestamp, "timeOnly")
                //postTimeShort: dateToTime(ciMd.timestamp, mainSettings.use12hFormat.get())
            })
        })
        return tmplData
    }

    #abortedDataGet(abortedItems: Post.PostItem[]): AbortedItemTmplData[] {
        const tmplData: AbortedItemTmplData[] = []
        abortedItems.reverse().forEach(item =>
            tmplData.push({
                ...this.#genericDataGet(item),
                abortReason: item.abortReason()
            })
        )
        return tmplData
    }

    #genericDataGet(item: Post.PostItem): GenericItemTmplData {
        const shorten = (x: string) => x.length > 40 ? x.slice(0, 37) + "..." : x

        const np = new NaviPath()
        np.setPage("location")
        np.set("url", item.postContent.location)

        const locationLabel = (location: string) => {
            if (location.startsWith("keyid")) return location.slice(0, -43 + 12) + "..."
            return location
        }

        return {
            postId: item.postId(),
            location: item.postContent.location,
            locationUrl: np.toFragmentId(),
            locationLabel: locationLabel(item.postContent.location),
            isHttp: item.postContent.location.startsWith("http"),
            content: item.postContent.content == "" ? undefined : shorten(item.postContent.content),
            waitingTimeMin: Math.floor(item.postContent.waitingTimeSec / 60),
            keyId: item.getKeyId(),
            hasTicket: item.hasTicket(),
            missingSignature: item.missingSignature()
        }
    }
    //#endregion

    //#region listeners

    //when tab html is rerendered register listeners to buttons with these functions again
    #registerListeners: { [key in Post.ItemLocation]: () => void } = {
        "enqueued": this.#registerEnqueuedListeners.bind(this),
        "posted": this.#registerPostedListeners.bind(this),
        "aborted": this.#registerAbortedListeners.bind(this),
    }

    #registerEnqueuedListeners() {
        //add event listeners (sign, abort, new comment)    
        this.#ui.newComment().addEventListener("click", () => navigateTo(new NaviPath("post")))
        this.#ui.signButtons().forEach(async (btn) => btn.addEventListener("click", async function () {
            //(btn as HTMLButtonElement).disabled = true
            const postId = btn.dataset.postid as string
            const gbpi = Post.getPostById(postId)
            if (gbpi == undefined) {
                lg.error("post %s does not exist", postId)
                return
            }
            if (gbpi.location !== Post.ItemLocation.Enqueued) {
                lg.error("expected post %s to be in enqueued but found it in %s", gbpi.location)
                return
            }

            const post = gbpi.post
            await App.signPost(post)
        }))

        this.#ui.abortButtons().forEach(btn => btn.addEventListener("click", async () => {
            const btn0 = btn as HTMLButtonElement
            btn0.disabled = true
            const postId = btn.dataset.postid as string
            const gbpi = Post.getPostById(postId)
            try {
                if (gbpi == undefined)
                    throw new Error(`post ${postId} does not exist`)
                if (gbpi.location !== Post.ItemLocation.Enqueued)
                    throw new Error(`post ${postId} expected to be enqueued but found in ${gbpi.location}`)

                await Post.abort(postId)
            } catch (e) {
                lg.error("Failed to abort post: %O", e);
                btn0.disabled = false
            }
        }))
    }

    #registerPostedListeners() {
        this.#ui.gotoYourPosts().addEventListener("click", () => navigateTo(LocationPage.path({type: "you"})))
        this.#ui.removeAllPosted().addEventListener("click", this.#removeAllActionGen("posted"))
        this.#ui.removeButtons().forEach(btn => btn.addEventListener("click", this.#removeActionGen(btn as HTMLButtonElement)))
    }

    #registerAbortedListeners() {
        this.#ui.removeAllAborted().addEventListener("click", this.#removeAllActionGen("aborted"))
        this.#ui.removeButtons().forEach(btn => btn.addEventListener("click", this.#removeActionGen(btn as HTMLButtonElement)))
        this.#ui.repostButtons().forEach(btn => btn.addEventListener("click", () => {
            (btn as HTMLButtonElement).disabled = true
            const post = Post.getPostById(btn.dataset.postid as string)!.post
            navigateTo(PostPage.paths.repost(post.postId()))
        }))
    }

    #removeActionGen(btn: HTMLButtonElement) {
        return async () => {
            btn.disabled = true
            try {
                await Post.remove(btn.dataset.postid as string)
            } catch (e) {
                lg.error("Failed to remove post %s: %O", btn.dataset.postid, e)
                btn.disabled = false
            }
        }
    }

    #removeAllActionGen(location: "posted" | "aborted") {
        return async () => {
            let btn: HTMLButtonElement
            let loc: Post.ItemLocation.Posted | Post.ItemLocation.Aborted
            switch (location) {
                case "posted":
                    loc = Post.ItemLocation.Posted
                    btn = this.#ui.removeAllPosted()
                    break
                case "aborted":
                    loc = Post.ItemLocation.Aborted
                    btn = this.#ui.removeAllAborted()
                    break
            }

            btn.disabled = true
            try {
                await Post.removeAllFrom(loc)
            } catch (e) {
                lg.error("Failed to remove all posts from %s: %O", location, e)
            } finally {
                btn.disabled = false
            }
        }
    }
    //#endregion
}

init()