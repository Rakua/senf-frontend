export { PostFull, PostFullOptions, modName }

import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"

import { DefaultLogger, } from "../../../../libs/basic/logger.js"
import { PostBody } from "../PostBody/PostBody.js"
import { EntityModel } from "../../../../backend/cidb/types/entity.js"
import { distinctArray, nodeFromString, toJson } from "../../../../libs/basic/misc.js"
import { currentNaviPath, navigateTo, toRoutedLink } from "../../../../libs/etc/router.js"
import { LocationPage } from "../../pages/Location/Location.js"
import { PostPage } from "../../pages/Post/Post.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"
import { App } from "../../App/App.js"
import { SourcePage } from "../../pages/Source/Source.js"
import { Alert } from "../Alert/Alert.js"
import { ciMetadata } from "../../../../backend/cidb/types/ci.js"
import { hideEl, showEl } from "../../../../libs/etc/misc.js"
import { IsolatedStorage } from "../../../../libs/etc/storage.js"
import { fallback, guard, tupleType } from "../../../../libs/etc/guard.js"
import { UserCiPrimaryKey } from "../../../../backend/cidb/cidb.js"

type Model = EntityModel<"post"> | EntityModel<"echo">

type PostFullOptions = {
    showUrl?: boolean,
    disableLocationLink?: boolean,
    fromJobId?: number, //use to determine which posts are new
    preview?: boolean
}

const modName = "PostFull"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/PostFull/" + name, data, preferredTmpl())

/**
 * Used to store which posts have been uncollapsed on a given navi path.
 * Keys are navipath frag ids.
 */
const storage = new IsolatedStorage("session", modName)

function init() {
    customElements.define(PostFull.tagName, PostFull)
}

function isPost(x: EntityModel<"post"> | EntityModel<"echo">): x is EntityModel<"post"> {
    return Object.hasOwn(x, "content")
}

class PostFull extends HTMLElement {
    static readonly tagName = "sfc-post-full"
    #shadow: ShadowRoot
    readonly #ui = {
        body: () => this.#shadow.getElementById("postBody") as HTMLElement,
        showMore: () => this.#shadow.getElementById("showMore") as HTMLElement,
        showMoreA: () => this.#ui.showMore().querySelector("a")!,

        routedA: () => this.#shadow.querySelectorAll<HTMLAnchorElement>("a.routed"),
        actionsA: () => this.#shadow.getElementById("actionsA") as HTMLAnchorElement,

        actionsDialog: () => this.#shadow.getElementById("actionsDialog") as HTMLDialogElement,
        actionsShare: () => this.#shadow.getElementById("actionsShare") as HTMLButtonElement,
        actionsQuote: () => this.#shadow.getElementById("actionsQuote") as HTMLButtonElement,
        actionsSource: () => this.#shadow.getElementById("actionsSource") as HTMLButtonElement,
        actionsClose: () => this.#shadow.getElementById("actionsClose") as HTMLButtonElement
    }

    readonly ci: Model
    readonly showUrl: boolean
    readonly disableLocationLink: boolean
    readonly fromJobId?: number
    readonly preview: boolean

    constructor(ci: Model, options?: PostFullOptions) {
        super()

        this.ci = ci
        this.showUrl = options?.showUrl ?? true
        this.disableLocationLink = options?.disableLocationLink ?? false
        this.fromJobId = options?.fromJobId
        this.preview = options?.preview ?? false

        this.#shadow = this.attachShadow({ mode: "open" })
        this.#shadow.innerHTML = tmpl("post_full.html", this.#tmplData(this.ci as EntityModel<"post">))
        watchDialogs(this.#shadow)

        const body = isPost(this.ci) ? new PostBody(this.ci.content()) : nodeFromString(tmpl("echo_body.html", {}))
        this.#ui.body().appendChild(body)
        const copiedToClipboard = new Alert("Copied share link for #" + ci.ciId().seqNo + " to clipboard.")
        this.#shadow.appendChild(copiedToClipboard)

        this.#ui.routedA().forEach(aEl => toRoutedLink(aEl, "navigateTo", () => App.refresh()))

        //init actions dialog
        this.#ui.actionsA().addEventListener("click", () => this.#ui.actionsDialog().showModal())
        this.#ui.actionsClose().addEventListener("click", () => this.#ui.actionsDialog().close())

        const userCi = ci.ci()!

        this.#ui.actionsShare().addEventListener("click", async () => {

            const shareUrl = App.shareLink(userCi)

            if (navigator.share === undefined) {
                navigator.clipboard.writeText(shareUrl)
                this.#ui.actionsDialog().close()
                copiedToClipboard.alert()
            } else {

                const shareData: ShareData = {
                    title: "Senf post #" + ciMetadata(userCi).seqNo,
                    url: shareUrl,
                }
                await navigator.share(shareData)
                this.#ui.actionsDialog().close()
            }
        })
        this.#ui.actionsSource().addEventListener("click", () => {
            this.#ui.actionsDialog().close()
            navigateTo(SourcePage.path.source(ci.ciUrn()))
        })
        this.#ui.actionsQuote().addEventListener("click", () => {
            //go to reply page with quote            
            this.#ui.actionsDialog().close()
            navigateTo(PostPage.paths.quote(ci.ciPk()))
        })

    }

    connectedCallback() {
        this.#restoreCollapseState()
    }

    //#region collapse related
    #collapse() {
        this.#ui.body().classList.add("preview")
        this.#ui.body().classList.add("preview-overflow")
        this.#ui.showMoreA().onclick = () => this.#uncollapse()
        showEl(this.#ui.showMore())
    }

    #uncollapse() {
        const body = this.#ui.body()
        body.classList.remove("preview")
        body.classList.remove("preview-overflow")
        hideEl(this.#ui.showMore())
        this.#rememberUncollapsed()
    }

    /**
     * If the user has reached the current page via back/forward
     * navigation then uncollapse all previously uncollpased posts.
     * Otherwise, collapse all posts that are too long.
     * 
     * Only has an effect if the `preview` option is set to true.
     */
    async #restoreCollapseState() {
        const body = this.#ui.body()
        if (this.preview && body.scrollHeight > body.clientHeight) {
            if (await App.lastNavigation() == "other") {
                //back/forward case
                if (this.#hasBeenUncollapsed()) {
                    this.#uncollapse()                    
                } else {
                    this.#collapse()
                }
            } else {
                //reset collapse states
                storage.delete(currentNaviPath().toFragmentId())
                this.#collapse()
            }
        }
    }

    /**
     * Remembers that the given post has been uncollapsed on the current
     * navi path in the session storage.
     */
    #rememberUncollapsed() {
        //no need for duplicate checking since a post can only be collapsed once
        storage.append(currentNaviPath().toFragmentId(), this.ci.ciPk())
    }

    /**
     * Recalls whether the given post has been uncollapsed on the current
     * navi path.
     */
    #hasBeenUncollapsed() {
        const s = storage.get(currentNaviPath().toFragmentId()) as UserCiPrimaryKey[]
        if (!Array.isArray(s)) return false
        const pk = this.ci.ciPk()
        return s.find(y => y[0] == pk[0] && y[1] == pk[1])
    }
    //#endregion


    #tmplData(post: Model) {
        const times = distinctArray([post.totalWaitingTime(), post.maxWaitingTime(), post.waitingTime()])

        return {
            posterKind: post.posterKind(),
            keyId: post.poster(),
            alias: post.alias(),
            postedOn: post.postedOn().toISOString(),
            location: post.location(),
            waitingTime: post.waitingTime(),
            isYou: post.isYou(),
            times: times.map(x => ({ value: x })),
            ciType: post.ciType(),

            replies: post.loadedPostCount() ?? 0,

            seqNo: post.ciId().seqNo,
            uri: post.ciUrn(),
            ciInDb: post.ciInDb(),

            hrefShare: "#",
            hrefQuote: "#",
            hrefSource: "#",
            hrefLocation: LocationPage.path({ type: "uri", url: new URL(post.ciUrn()) }).toFragmentId(),
            hrefGotoReplies: LocationPage.path({ type: "uri", url: new URL(post.ciUrn()), scrollToFirstComment: true }).toFragmentId(),
            hrefReply: PostPage.paths.reply(post.ciPk()).toFragmentId(),

            showUrl: this.showUrl,
            disableLocationLink: this.disableLocationLink,
            isNew: this.fromJobId !== undefined && this.fromJobId === post.firstJobId(),
            preview: this.preview
        }
    }

}

init()