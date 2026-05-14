export { LocationPage, modName, settings as locationPageSettings }

import { tmpl as tmpl0 } from "../../tmpl.js"
import { isTrustedLocation, mainSettings, preferredTmpl } from "../../../../../config.js"
import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { App, pageTitleR } from "../../App/App.js"
import { currentNaviPath, navigateTo, NaviPath, toRoutedLink } from "../../../../libs/etc/router.js"
import { distinctArray, ExposedPromise, toJson } from "../../../../libs/basic/misc.js"
import { addCiGallery } from "../../components/CiGallery/CiGallery.js"
import { BaseQuery } from "../../components/QueryBar/QueryBar.js"
import { aliasOf, EntityModel, fromKeys, getJobById, queryWithoutProgress, setAlias, unsetAlias, yourCis } from "../../../../backend/cidb/cidb.js"
import { PostFull } from "../../components/PostFull/PostFull.js"
import { parseCiUrn } from "../../../../backend/cidb/types/ci.js"
import { PostPage } from "../Post/Post.js"
import { Prompt } from "../../components/Prompt/Prompt.js"
import { Confirm } from "../../components/Confirm/Confirm.js"
import { Alert } from "../../components/Alert/Alert.js"
import { newSettings } from "../../../../libs/etc/settings.js"
import { onChange, ReactiveSyncWritableValue } from "../../../../libs/basic/reactive.js"
import { dateInFilename, hideEl, mediaTypeFromUrl, showEl } from "../../../../libs/etc/misc.js"
import { DownloadCis } from "../../components/DownloadCis/DownloadCis.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"

//#region types
type PageMode = PageModeUri | PageModePrefix | PageModePoster | PageModeJob | PageModeYou
type PageModeUri = {
    type: "uri",
    url: URL,
    scrollToFirstComment?: boolean
}
type PageModePrefix = {
    type: "prefix",
    url: URL
}
type PageModePoster = {
    type: "poster",
    keyId: string
}
type PageModeJob = {
    type: "job",
    jobId: number
}
type PageModeYou = {
    type: "you"
}
//#endregion

const modName = "LocationPage"
const tmpl = (name: string, data: any) => tmpl0("pages/Location/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)

const settings = {
    ...newSettings(modName, {
        showQuerybar: { default: false },
        oldestFirst: { default: false, description: "If true, the default order for comments for CIs is oldest first" }
    }),
    trustedLocations: mainSettings.trustedLocations
}

function init() {
    customElements.define(LocationPage.tagName, LocationPage)
}

class LocationPage extends HTMLElement {
    static readonly pageName = "location"
    static readonly tagName = "sf-location"

    #contentLoaded = new ExposedPromise<void>()
    readonly initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    readonly #ui = {
        head: () => this.#shadow.getElementById("head") as HTMLElement,
        querybar: () => this.#shadow.getElementById("querybar") as HTMLElement,
        gallery: () => this.#shadow.getElementById("gallery") as HTMLElement,

        fullPost: () => this.#shadow.getElementById("fullPost") as HTMLElement,
        showOnlyNewPosts: () => this.#shadow.getElementById("showOnlyNewPosts") as HTMLInputElement,

        aliasA: () => this.#shadow.getElementById("aliasA") as HTMLAnchorElement,
        trustA: () => this.#shadow.getElementById("trustA") as HTMLAnchorElement,
        routedLinks: () => this.#shadow.querySelectorAll<HTMLAnchorElement>("a.routed"),

        downloadYourCis: () => this.#shadow.getElementById("downloadYourCis") as HTMLElement
    }

    #onlyNewPostsR(): ReactiveSyncWritableValue<boolean> {
        const rwv = currentNaviPath().reactive("onp")
        return {
            get: () => rwv.get() === 1,
            onChange: (f) => rwv.onChange((nv) => f(nv === 1)),
            set: (x: boolean) => rwv.set(x ? 1 : 0)
        }
    }

    async #initGallery(mode: PageMode) {
        let query: BaseQuery<"ci">
        let showUrl: boolean
        let preview = false
        let scrollToFirstComment = false
        let noGallery = false
        /**
         * Is a number iff mode is job and job type is url or file
         * Used to determine which posts are new.
         */
        let dataJobId: number | undefined = undefined
        switch (mode.type) {
            case "uri": {
                query = {
                    index: {
                        type: "string",
                        name: "location",
                        values: { type: "set", literals: [mode.url.href] }
                    },
                    order: [{ column: "postedOn", order: settings.oldestFirst.get() ? "asc" : "desc" }],
                    filter: {}
                }
                showUrl = false
                preview = true
                scrollToFirstComment = mode.scrollToFirstComment ?? false
                break
            }

            case "prefix": {
                query = {
                    index: {
                        type: "string",
                        name: "location",
                        prefix: true,
                        values: { type: "set", literals: [mode.url.href] }
                    },
                    order: [{ column: "postedOn", order: "desc" }],
                    filter: {}
                }
                showUrl = true
                preview = true
                break
            }

            case "poster": {
                query = {
                    index: {
                        type: "string",
                        name: "poster",
                        values: { type: "set", literals: [mode.keyId] }
                    },
                    order: [{ column: "postedOn", order: "desc" }],
                    filter: {}
                }
                showUrl = true
                preview = true
                break
            }

            case "job": {
                query = {
                    index: {
                        type: "number",
                        name: "jobIds",
                        values: { type: "set", literals: [mode.jobId] }
                    },
                    order: [{ column: "postedOn", order: "desc" }],
                    filter: {}
                }
                showUrl = true
                preview = true

                const jobRec = await getJobById(mode.jobId)
                if (jobRec === undefined) break
                switch (jobRec.subject.type) {
                    case "file":
                    case "url": {
                        dataJobId = mode.jobId
                        if (this.#onlyNewPostsR().get()) {
                            query.filter!.firstJobId = onlyNewPostsFromJobFilter(mode.jobId).firstJobId
                        }
                        break
                    }
                    case "crawl": {
                        noGallery = true
                        break
                    }
                }
                break
            }

            case "you": {
                const pks = await yourCis()
                lg.debug("your cis: %O", pks)
                query = {
                    index: pks,
                    order: [{ column: "postedOn", order: "desc" }],
                    filter: {}
                }
                showUrl = true
                preview = true
                break
            }
        }

        if (noGallery) return
        const x = await addCiGallery(query, this.#ui.querybar(), this.#ui.gallery(), {
            postFullOptions: { preview: preview },
            showUrl: showUrl,
            fromJobId: dataJobId
        })

        if (scrollToFirstComment) x.gallery.scrollToFirstComment()

        onChange(settings.showQuerybar, (showQuerybar) => {
            if (showQuerybar) {
                showEl(this.#ui.querybar())
                this.#ui.gallery().classList.remove("top-margin-l")
                this.#ui.gallery().classList.add("top-margin")
            } else {
                hideEl(this.#ui.querybar())
                this.#ui.gallery().classList.remove("top-margin")
                this.#ui.gallery().classList.add("top-margin-l")
            }
        })

        if (dataJobId !== undefined) {
            this.#onlyNewPostsR().onChange(async (nv) => {
                query.filter = nv ? { firstJobId: onlyNewPostsFromJobFilter(dataJobId).firstJobId } : {}
                await addCiGallery(query, this.#ui.querybar(), this.#ui.gallery(), {
                    postFullOptions: { showUrl: showUrl },
                    fromJobId: dataJobId
                })
            })
        }
    }

    async #initHead(mode: PageMode) {
        try {
            lg.debug("init head with ", mode)
            switch (mode.type) {
                case "uri": {
                    /**
                     * check if url is ci and if so return EntityModel(post/echo) if it exists
                     */
                    const url = mode.url
                    pageTitleR.set("@" + url.href)
                    const ci = await uriToCi(url)
                    lg.debug("uri to ci: %O => %O", url, ci?.ciId())
                    if (ci !== null) {
                        //attach full post                    
                        const postFullEl = new PostFull(ci, { showUrl: true, disableLocationLink: true })
                        lg.debug("Attach full post", postFullEl, ci.ciId())
                        this.#ui.head().replaceChildren(postFullEl)
                        this.#ui.head().classList.add("center-block")
                    } else {
                        //get location entry for echo stats
                        const url = mode.url
                        const echos = await echoStats("uri", url)

                        const linkUrl = isHttpUrl(url)

                        let mediaType = mediaTypeFromUrl(url) ?? undefined

                        this.#ui.head().innerHTML = tmpl("generic.html", {
                            url: url.href,
                            linkUrl: isHttpUrl,
                            mediaType: mediaType,
                            isTrustedLocation: isTrustedLocation(url.href),
                            domainPath: isHttpUrl(url) ? LocationPage.path({ type: "prefix", url: url }).toFragmentId() : undefined,
                            newCommentPath: PostPage.paths.reply(url.href).toFragmentId(),
                            echos: echos,
                            mode: mode.type
                        })

                        const trustPromptMsg = "Trusted location URL prefix (media from trusted locations is embedded in the app):"
                        const trustPromptEl = new Prompt(trustPromptMsg, { placeholder: "e.g. https://archive.senf.in/" })
                        this.#shadow.appendChild(trustPromptEl)
                        this.#ui.trustA()?.addEventListener("click", async () => {
                            const defaultValue = (new URL(url.origin)).href
                            const resp = await trustPromptEl.prompt(defaultValue)
                            if (resp == null) return

                            const trustedPrefixes = settings.trustedLocations.get()
                            if (trustedPrefixes.includes(resp)) return
                            trustedPrefixes.push(resp)
                            settings.trustedLocations.set(trustedPrefixes)
                            App.refresh()

                        })


                    }
                    break
                }

                case "prefix": {
                    const url = mode.url
                    const pageTitle = "@" + (isHttpUrl(url) ? url.host : url.href)
                    pageTitleR.set(pageTitle)

                    const echos = await echoStats("prefix", url)
                    //if url is domain with empty pathname => remove the trailing slash
                    const normalizedUrl = isHttpUrl(url) && url.pathname == "/"
                        ? url.protocol + "//" + url.host : url.href

                    this.#ui.head().innerHTML = tmpl("generic.html", {
                        url: normalizedUrl,
                        linkUrl: isHttpUrl(url),
                        newCommentPath: PostPage.paths.reply(url.href).toFragmentId(),
                        echos: echos,
                        mode: mode.type
                    })

                    // toRoutedLink(this.#ui.domainA(), "navigateTo")
                    // toRoutedLink(this.#ui.newA(), "navigateTo")
                    break
                }

                case "you": {
                    pageTitleR.set("Your posts")
                    this.#ui.head().innerHTML = tmpl("you.html", {})
                    const dlEl = new DownloadCis(exportCisFilename(), await yourCis())
                    this.#ui.downloadYourCis().replaceChildren(dlEl)
                    break
                }

                case "poster": {
                    const keyId = mode.keyId
                    const keyId12 = keyId.slice(0, 12)
                    pageTitleR.set("Poster " + keyId12)
                    const alias = aliasOf(keyId)
                    const poster = (await fromKeys("poster", [keyId]))[0]
                    let echos = [0]
                    let waitingTimes = [0]
                    if (poster !== undefined) {
                        echos = distinctArray([poster.totalEchoSum(), poster.totalEchoMax(), poster.totalEchoAvg()])
                        waitingTimes = distinctArray([poster.waitingTimeSum(), poster.waitingTimeMax(), poster.waitingTimeAvg()])
                    }

                    this.#ui.head().innerHTML = tmpl("poster.html", {
                        keyId: keyId,
                        keyId12: keyId12,
                        alias: alias,
                        echos: echos.map(x => ({ value: x })),
                        waitingTimes: waitingTimes.map(x => ({ value: x })),
                        echosDiffer: toJson(echos) != toJson(waitingTimes)
                    })

                    //set dialogs
                    const setAliasPrompt = new Prompt(`Enter alias for ${keyId}:`, {
                        placeholder: "Alias (must be non-empty)",
                        okButtonLabel: "Set alias",
                        validator: (x) => x.trim() != "" && x.length < 43
                    })
                    const unsetAliasConfirm = new Confirm(`Unset alias ${alias} of ${keyId}?`, {
                        okButtonLabel: "Unset"
                    })
                    lg.debug("append dialogs to head")
                    this.#ui.head().append(setAliasPrompt, unsetAliasConfirm)


                    lg.debug("set alias a click", this.#ui.aliasA())
                    //bind alias button to dialog
                    this.#ui.aliasA().addEventListener("click", async (ev) => {
                        ev.preventDefault()
                        lg.debug("clicked on alias", alias)
                        if (alias === undefined) {
                            const newAlias = await setAliasPrompt.prompt()
                            if (newAlias != null) {
                                const res = setAlias(keyId, newAlias.trim())
                                switch (res.type) {
                                    case "ok":
                                        App.refresh()
                                        break

                                    case "exists": {
                                        const alertEl = new Alert(`The alias ${newAlias} is already assigned to <a id="gotoKeyIdA" href="javascript:;">${res.keyId}</a>.`)
                                        const gotoKeyIdA = alertEl.shadowRoot!.getElementById("gotoKeyIdA") as HTMLAnchorElement
                                        gotoKeyIdA.onclick = () => {
                                            alertEl.close()
                                            navigateTo(LocationPage.path({ type: "poster", keyId: res.keyId }))
                                        }

                                        this.#ui.head().append(alertEl)
                                        await alertEl.alert()
                                    }

                                    case "tooLong": {
                                        const alertEl = new Alert(`The alias ${newAlias} is too long. It must be less than 43 characters long.`)
                                        this.#ui.head().append(alertEl)
                                        await alertEl.alert()
                                    }
                                }
                            }
                        } else {
                            const ua = await unsetAliasConfirm.confirm()
                            if (ua) {
                                unsetAlias(keyId)
                                App.refresh()
                            }
                        }
                    })
                    break
                }

                case "job": {
                    lg.debug("job case")
                    const job = await getJobById(mode.jobId)
                    if (job === undefined || ["waiting", "enqueued", "started"].includes(job.status)) {
                        this.#ui.head().innerHTML = tmpl("invalid.html", {})
                        pageTitleR.set("Invalid job id")
                        break
                    }
                    pageTitleR.set("Job " + job.jobId)
                    switch (job.subject.type) {
                        case "file":
                        case "url": {
                            this.#ui.head().innerHTML = tmpl("job_data.html", {
                                type: job.subject.type,
                                status: job.status,
                                file: job.subject.type == "url" ? decodeURI(job.subject.url) : job.subject.filename,
                                size: job.progress.totalBytes,
                                updatedOn: job.updatedOn,

                                added: job.progress.itemsAdded,
                                skipped: job.progress.itemsSkipped,
                                invalid: job.progress.itemsInvalid
                            })

                            const sonpR = this.#onlyNewPostsR()
                            onChange(sonpR, (nv) => {
                                this.#ui.showOnlyNewPosts().checked = nv
                            })
                            this.#ui.showOnlyNewPosts().addEventListener("change", () => {
                                sonpR.set(this.#ui.showOnlyNewPosts().checked)
                            })

                            break
                        }
                        case "crawl": {
                            this.#ui.head().innerHTML = tmpl("job_crawl.html", {
                                status: job.status,
                                url: job.subject.url,
                                updatedOn: job.updatedOn,
                                added: job.progress.itemsAdded
                            })
                            break
                        }
                    }
                    break
                }
            }
        } catch (e) {
            lg.error("inithead error", e)
        }

        this.#ui.routedLinks().forEach(aEl => toRoutedLink(aEl, "navigateTo"))
    }

    constructor() {
        super()
        pageTitleR.set("Location")
        this.#shadow = this.attachShadow({ mode: "open" })
        watchDialogs(this.#shadow)
        const pageMode = LocationPage.mode(currentNaviPath())
        if (pageMode == null) {
            //invalid page mode
            pageTitleR.set("Invalid location")
            this.#shadow.innerHTML = tmpl("invalid.html", {})
            this.#contentLoaded.resolve()
            return
        }

        this.#shadow.innerHTML = tmpl("location.html", {})
        const head = this.#initHead(pageMode)
        const gallery = this.#initGallery(pageMode)

        Promise.allSettled([head, gallery]).then(() => this.#contentLoaded.resolve())
    }

    //#region page mode to navi path and back
    /**
     * Computes the navi path for the given page mode.
     */
    static path(mode: PageMode): NaviPath {
        const np = new NaviPath(LocationPage.pageName)
        switch (mode.type) {
            case "uri":
                const x = np.set("uri", mode.url.href)
                if (mode.scrollToFirstComment === true) x.set("stfc", 1)
                return x
            case "prefix":
                const url = mode.url
                const prefixUri = isHttpUrl(url) ? url.protocol + "//" + url.host : url.href
                return np.set("mode", "prefix").set("uri", prefixUri)
            case "poster":
                //use "_" prefix to prevent keyId from being interpreted as number in NaviPath
                return np.set("mode", "poster").set("kid", "_" + mode.keyId)
            case "job":
                return np.set("mode", "job").set("id", mode.jobId)
            case "you":
                return np.set("mode", "you")
        }
    }

    static paths = {
        uri: (url: URL, scrolltoFirstComment: boolean) => LocationPage.path({ type: "uri", url: url, scrollToFirstComment: scrolltoFirstComment })
    }

    /**
     * Computes the page mode from the given navi path. Returns null
     * if the path does not specify a valid page mode.
     */
    static mode(path: NaviPath): PageMode | null {
        const uriOrPrefixMode = (mode: "uri" | "prefix"): PageMode | null => {
            const u = path.get("uri")
            const uri = typeof u == "string" ? u : ""
            const url = URL.parse(uri)
            return (url === null) ? null : { type: mode, url: url }
        }

        const m = path.get("mode")
        if (m === undefined) {
            const x = uriOrPrefixMode("uri")
            if (path.has("stfc")) {
                (x as any).scrollToFirstComment = true
            }
            return x
        }

        const mode = typeof (m) == "string" ? m : ""
        switch (mode) {
            case "prefix":
                return uriOrPrefixMode("prefix")

            case "poster":
                const k = path.get("kid")
                //slice(1) removes the "_" prefix
                const kid = typeof k == "string" ? k.slice(1) : ""
                return kid == "" ? null : { type: "poster", keyId: kid }

            case "job":
                const jobId = path.get("id")
                return typeof jobId !== "number" ? null : { type: "job", jobId: jobId }

            case "you":
                return { type: "you" }

            default:
                return null
        }
    }
    //#endregion

}

/**
 * Computes the echo stats (sum/max/avg) for a domain(prefix) a a URI and
 * removes duplicate values.
 */
async function echoStats(type: "prefix" | "uri", url: URL) {
    const pks = await queryWithoutProgress({
        entity: "location",
        index: {
            type: "string",
            name: "location",
            prefix: type == "prefix",
            values: { type: "set", literals: [url.href] }
        }
    })

    const locEntities = await fromKeys("location", pks)
    let echoSum = 0
    let echoMax = 0
    let echoCount = 0
    for (const locEntity of locEntities) {
        echoSum += locEntity.echoSum()
        echoMax = Math.max(locEntity.echoMax(), echoMax)
        echoCount += locEntity.echoCount()
    }
    const echoAvg = echoCount > 0 ? echoSum / echoCount : 0
    return distinctArray([echoSum, echoMax, echoAvg]).map(x => ({ value: x }))
}

/**
 * Use this filter to show only CIs from a given jobId that were newly
 * added
 */
function onlyNewPostsFromJobFilter(jobId: number) {
    return {
        firstJobId: {
            defined: true,
            condition: { values: [jobId] }
        }
    }
}

/**
 * If the given URL describes a CI URI that is in the database then
 * the CI will be returned, otherwise null.
 */
async function uriToCi(url: URL): Promise<EntityModel<"post"> | EntityModel<"echo"> | null> {
    const ciUrn = parseCiUrn(url.href)
    if (ciUrn == null || ciUrn.platform !== mainSettings.platformName.get()) return null

    const post = await fromKeys("post", [[ciUrn.chain, ciUrn.seqNo]])
    if (post.length == 1) return post[0]

    const echo = await fromKeys("echo", [[ciUrn.chain, ciUrn.seqNo]])
    if (echo.length == 1) return echo[0]

    return null
}

function isHttpUrl(url: URL) {
    return ["http:", "https:"].includes(url.protocol)
}

function exportCisFilename(date?: Date) {
    date ??= new Date()
    return `sf-your-posts-${dateInFilename()}.jsonl`
}

init()