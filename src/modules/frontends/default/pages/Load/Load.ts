export { LoadPage, modName }

import { tmpl as tmpl0 } from "../../tmpl.js"
import { preferredTmpl } from "../../../../../config.js"
import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { pageTitleR } from "../../App/App.js"
import { currentNaviPath as currentNaviPath0, navigateTo, NaviPath as NaviPath0, toRoutedLink } from "../../../../libs/etc/router.js"
import { JobId, JobReport, JobReportCriteria, abortJob, jobReports, jobReportsCount, loadFile, loadUrl, retryJob } from "../../../../backend/cidb/cidb.js"
import { bindToInnerHtml, bindToTextContent, onChange, reactiveExpression, ReactiveValue } from "../../../../libs/basic/reactive.js"
import { JobStartedBy, JobStatus } from "../../../../backend/cidb/types/job.js"
import { escapeHtml, ExposedPromise, sleep } from "../../../../libs/basic/misc.js"
import { LocationPage } from "../Location/Location.js"
import { Tabs } from "../../components/Tabs/Tabs.js"
import { Alert } from "../../components/Alert/Alert.js"
import { serializeCatch } from "../../../../libs/etc/misc.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"

type JobReportTmplData = JobReport & {
    progress: { percent: number, totalBytes: number, processedBytes: number },
    subject: { urlWithoutScheme: string },
    canRetry?: boolean,
    failedReason?: string,
    locationHref?: string
}

type NaviPath = NaviPath0<PathParam>
type PathParam = typeof pathParam[number]
type TabLocation = typeof tabLocation[number]

const modName = "LoadPage"
const tmpl = (name: string, data: any) => tmpl0("pages/Load/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)
const currentNaviPath = () => currentNaviPath0() as unknown as NaviPath
const NaviPath = NaviPath0<PathParam>

const pathParam = ["url", "tab", "startedBy"] as const
const tabLocation = ["ongoing", "finished"] as const

function init() {
    customElements.define(LoadPage.tagName, LoadPage)
}

class LoadPage extends HTMLElement {
    static readonly pageName = "load"
    static readonly tagName = "sf-load"
    static readonly paths = {
        default: new NaviPath(this.pageName), // shows ongoing
        ongoing: (startedBy: string) =>
            new NaviPath(this.pageName)
                .set("tab", "ongoing")
                .set("startedBy", toJobStartedBy(startedBy)),

        finished: (startedBy: string) =>
            new NaviPath(this.pageName)
                .set("tab", "finished")
                .set("startedBy", toJobStartedBy(startedBy)),

        currentTab: (startedBy: string) => {
            const curTab = currentNaviPath().get("tab") === "finished"
                ? "finished" : "ongoing"
            return new NaviPath(this.pageName)
                .set("tab", curTab)
                .set("startedBy", toJobStartedBy(startedBy))
        }
    }

    #contentLoaded = new ExposedPromise<void>()
    readonly initialContentLoaded = this.#contentLoaded.promise

    #prevOngoingJobCountExcludingCrawls = 0

    #shadow: ShadowRoot
    #tabs = () => this.#shadow.getElementById("tabs") as Tabs
    readonly #ui = {
        urlInput: () => this.#shadow.getElementById("urlInput") as HTMLInputElement,
        loadButton: () => this.#shadow.getElementById("loadButton") as HTMLButtonElement,
        filesInput: () => this.#shadow.getElementById("filesInput") as HTMLInputElement,
        //filesButton: () => this.#shadow.getElementById("filesButton") as HTMLButtonElement,

        abortButtons: () => this.#tabs().get("ongoing").contents.querySelectorAll<HTMLButtonElement>(".abortButton"),
        retryButtons: () => this.#tabs().get("finished").contents.querySelectorAll<HTMLButtonElement>(".retryButton"),
        routedLinks: () => this.#tabs().get("finished").contents.querySelectorAll<HTMLAnchorElement>("a.routed"),
        startedBySelect: () => this.#shadow.getElementById("startedBySelect") as HTMLSelectElement,

        tab: (loc: TabLocation, el: "Size" | "Link" | "LinkA" | "Tab") => this.#shadow.getElementById(loc + el) as HTMLElement,

        tabs: this.#tabs.bind(this),
    }

    async #bindJobsToUi() {
        const startedBy = this.#processUrlParameters()

        //binding reactive data to UI
        const ongoingCrit: JobReportCriteria = {
            statuses: ["waiting", "enqueued", "started"],
            types: ["file", "url"]
        }
        const finishedCrit: JobReportCriteria = {
            statuses: ["completed", "aborted", "failed"],
            types: ["file", "url"]
        }

        const r = (type: "report" | "count", status: "ongoing" | "finished", startedBy: JobStartedBy) => {
            const jr = type == "report" ? jobReports : jobReportsCount
            const crit = status == "ongoing" ? ongoingCrit : finishedCrit

            //lexicographic order: show started jobs first then enqueued/waiting
            const ongoingOrder = (a: JobReport, b: JobReport) => {
                const statusVal = (status: JobStatus) => status == "started" ? 0 : 1
                if (a.status != b.status) return statusVal(a.status) - statusVal(b.status)
                return a.jobId - b.jobId //oldest first
            }

            const r = jr({ ...crit, startedBy: startedBy })
            if (type == "count") return r as ReactiveValue<number>
            return reactiveExpression(
                [r as ReactiveValue<JobReport[]>],
                (jr: JobReport[]) => status == "finished"
                    ? jr.reverse() : jr.sort(ongoingOrder)
            )

        }

        const options = (status: "ongoing" | "finished") => ({
            converter: (jr: JobReport[]) => tmpl("table_" + status + ".html", this.#jobReportsToTmplData(jr)),
            afterUpdate: () => this.#registerListeners()
        })

        await this.#tabs().initialContentLoaded

        const ongoingSizeEl = this.#tabs().get("ongoing").title.getElementsByClassName("size")[0]
        const finishedSizeEl = this.#tabs().get("finished").title.getElementsByClassName("size")[0]

        bindToInnerHtml(r("report", "ongoing", startedBy) as any, this.#tabs().get("ongoing").contents, options("ongoing"))
        bindToInnerHtml(r("report", "finished", startedBy) as any, this.#tabs().get("finished").contents, options("finished"))
        bindToTextContent(r("count", "ongoing", startedBy) as any, ongoingSizeEl)
        bindToTextContent(r("count", "finished", startedBy) as any, finishedSizeEl)

        const jc = jobReportsCount({ statuses: ["waiting", "enqueued", "started"], types: ["url", "file"] })
        this.#prevOngoingJobCountExcludingCrawls = jc.get()        

        jc.onChange(async (nv) => {                    
            if (nv === 0 && this.#prevOngoingJobCountExcludingCrawls > 0) this.#tabs().select("finished")
            this.#prevOngoingJobCountExcludingCrawls = nv
        })
    }

    constructor() {
        super()
        pageTitleR.set("Load comments")
        this.#shadow = this.attachShadow({ mode: "closed" })
        watchDialogs(this.#shadow)
        this.#shadow.innerHTML = tmpl("load.html", {})


        this.#ui.loadButton().addEventListener("click", async () => {
            if (this.#ui.urlInput().value.trim() == "") {
                //URL input empty => show file picker dialog
                this.#ui.filesInput().click()
            } else {
                //URL input non-empty => load from url
                this.#afterLoadAction(await this.#loadFromUrl())
            }
        })
        this.#ui.urlInput().addEventListener("paste", async (ev) =>
            this.#afterLoadAction(await this.#onPasteUrl(ev)))
        this.#ui.filesInput().addEventListener("change", async () =>
            this.#afterLoadAction(await this.#loadFromFiles()))
        this.#ui.filesInput().addEventListener("cancel", () => this.#ui.filesInput().value = "")

        this.#ui.startedBySelect().addEventListener("change", () =>
            navigateTo(LoadPage.paths.currentTab(this.#ui.startedBySelect().value as JobStartedBy)))

        const startedBy = this.#processUrlParameters()
        this.#ui.startedBySelect().value = startedBy

        this.#bindJobsToUi().then(() => this.#contentLoaded.resolve())
    }

    #processUrlParameters(): JobStartedBy {
        const cnp = currentNaviPath()

        //if url paramter is passed, set url input to its value
        if (cnp.has("url")) {
            this.#ui.urlInput().value = cnp.get("url") as string
        }

        const sb = cnp.get("startedBy")
        if (typeof sb != "string") return "anyone"
        return toJobStartedBy(sb)
    }

    //#region actions

    //an action returns true if at least one new job was started

    async #loadFromUrl(pastedUrl?: string) {
        const url = pastedUrl != undefined ? pastedUrl : this.#ui.urlInput().value
        if (url.trim() == "") return false //ignore empty lines

        this.#ui.loadButton().disabled = true
        this.#ui.urlInput().disabled = true
        try {
            const urlObj = new URL(url) //check that it is a valid URL
            if (!["https:", "http:"].includes(urlObj.protocol)) throw new Error("only http(s) allowed")
            const jobId = await loadUrl(url)
            this.#ui.urlInput().value = ""
            lg.log("Loading url %s (jobId %O)", url, jobId)

            return true
        } catch (e) {
            lg.error("Failed to load from URL: %O" + e)
            if (pastedUrl == undefined) this.#alert("Failed to load from URL:<br>" + escapeHtml(serializeCatch(e)))
            return false
        } finally {
            this.#ui.loadButton().disabled = false
            this.#ui.urlInput().disabled = false
        }
    }

    async #loadFromFiles() {
        this.#ui.loadButton().disabled = true
        try {
            const files = this.#ui.filesInput().files
            if (files == null || files.length == 0) throw new Error("no file(s) selected")
            for (let i = 0; i < files.length; i++) {
                const jobId = await loadFile(files[i])
                lg.log("Loading file %O (jobId %O)", files[i], jobId)
            }

            return true
        } catch (e) {
            lg.error("Failed to load file: %O", e)
            this.#alert("Failed to load file:<br>" + escapeHtml(serializeCatch(e)))
            return false
        } finally {
            this.#ui.loadButton().disabled = false
        }
    }

    #alert(htmlText: string) {
        const alertEl = new Alert(htmlText)
        this.#shadow.appendChild(alertEl)
        alertEl.alert()
    }

    async #onPasteUrl(ev: ClipboardEvent) {
        /*
            FF bug: if multiple files are pasted, only the first one is available 
            in files property. https://bugzilla.mozilla.org/show_bug.cgi?id=864052
        */
        const files = ev.clipboardData?.files
        if (files != undefined && files.length > 0) {
            let startedNewJob = false
            try {
                this.#ui.loadButton().disabled = true
                this.#ui.urlInput().disabled = true
                for (let i = 0; i < files.length; i++) {
                    const jobId = await loadFile(files[i])
                    startedNewJob = true
                    lg.log("Loading file %O (jobId %O)", files[i], jobId)
                }

                return true
            } catch (e) {
                lg.error("#onPasteUrl() error: %O", e)
                return startedNewJob
            } finally {
                this.#ui.loadButton().disabled = false
                this.#ui.urlInput().disabled = false
                this.#ui.urlInput().value = ""
            }
        }

        const pastedText = ev.clipboardData?.getData("text").trim() ?? ""
        if (pastedText.indexOf("\n") == -1) return false

        const lines = pastedText.split("\n")
        let startedNewJob = false
        for (const line of lines) {
            const started = await this.#loadFromUrl(line.trim())
            startedNewJob ||= started
        }
        return startedNewJob
    }

    #afterLoadAction(newJobAdded: boolean) {
        if (!newJobAdded) return
        const sb = currentNaviPath().get("startedBy") === "user" ? "user" : "anyone"
        navigateTo(LoadPage.paths.ongoing(sb))
    }
    //#endregion

    //#region tmpl data
    #jobReportsToTmplData(jobReports: JobReport[]): ({ items: JobReportTmplData[] }) {
        const removeProtocol = (x: string) => {
            if (x.toLowerCase().startsWith("https://")) return x.slice("https://".length)
            if (x.toLowerCase().startsWith("http://")) return x.slice("http://".length)
            return x
        }

        const f = (report: JobReport) => {
            const res = report as JobReportTmplData
            if (res.subject.type != "file") {
                (res.subject as any).urlWithoutScheme = decodeURI(removeProtocol(res.subject.url))
            }
            if (res.progress.totalBytes != null) {
                res.progress.percent = Math.floor(100 * (res.progress.bytesProcessed / res.progress.totalBytes))
                res.progress.totalBytes = res.progress.totalBytes
            }
            res.progress.processedBytes = res.progress.bytesProcessed
            res.canRetry = res.subject.type == "url"
                && (res.status == "aborted" || res.status == "failed")

            if (res.status == "failed") res.failedReason = res.failedError?.message

            res.locationHref = LocationPage.path({ type: "job", jobId: res.jobId }).toFragmentId()
            return res
        }

        return { items: jobReports.map(f) }
    }
    //#endregion

    #registerListeners() {
        this.#ui.abortButtons().forEach(btn => btn.addEventListener("click", async () => {
            (btn as HTMLButtonElement).disabled = true
            try {
                const jobId = Number(btn.dataset.jobid) as JobId
                await abortJob(jobId)
            } catch (e) {
                lg.error("Failed to abort job with id %s: %O", btn.dataset.jobid, e)
            } finally {
                (btn as HTMLButtonElement).disabled = false
            }
        }))

        this.#ui.retryButtons().forEach(btn => btn.addEventListener("click", async () => {
            (btn as HTMLButtonElement).disabled = true
            try {
                const jobId = Number(btn.dataset.jobid) as JobId
                lg.debug("retry job %s", jobId)
                const rj = retryJob(jobId)
                this.#afterLoadAction(true)
                await rj
            } catch (e) {
                lg.error("Failed to retry job with id %s", btn.dataset.jobid)
            } finally {
                (btn as HTMLButtonElement).disabled = false
            }
        }))

        this.#ui.routedLinks().forEach(aEl => toRoutedLink(aEl, "navigateTo"))
    }
}

function toJobStartedBy(x: string): JobStartedBy {
    if (["user", "script", "anyone"].includes(x)) return x as JobStartedBy
    return "anyone"
}

init()
