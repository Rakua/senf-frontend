export { InfoPage, modName }

import { tmpl as tmpl0 } from "../../tmpl.js"
import { devMode, mainSettings, preferredTmpl } from "../../../../../config.js"
import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { pageTitleR } from "../../App/App.js"
import { ExposedPromise, toJson } from "../../../../libs/basic/misc.js"
import { isMainTab, isMainTabR } from "../../../../libs/etc/tab.js"
import { bindTo, bindToTextContent, onChange, ReactiveAtom } from "../../../../libs/basic/reactive.js"
import { bypassChecksActive, bypassChecksData, deleteDatabase, echoWithStubsCountR, exportDatabase, exportDatabaseParameters, globalEchoCountR, globalPostCountR, importDatabase, importDatabaseParameters, keyIdCountR, postCountR, urlCountR } from "../../../../backend/cidb/cidb.js"
import { dateInFilename, showChildEl, showEl } from "../../../../libs/etc/misc.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"
import { ByteSize } from "../../components/ByteSize/ByteSize.js"
import { version } from "../../../../../version.js"
import { Alert } from "../../components/Alert/Alert.js"

type TmplData = {
    sfVersion: string,
    sfBuildDate: Date,
    sfBuildDateStr: string,
    devMode: boolean
}

const modName = "InfoPage"
const tmpl = (name: string, data: any) => tmpl0("pages/Info/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)

const storageUsedR = new ReactiveAtom(0)
const storageQuotaR = new ReactiveAtom(0)

function init() {
    customElements.define(InfoPage.tagName, InfoPage);

    (async () => {
        try {
            const x = await storageUsage()
            storageUsedR.set(x.usage)
            storageQuotaR.set(x.quota)
        } catch (e) {
            lg.error("Failed to compute storage usage: %O", e)
        }
    })()
}

class InfoPage extends HTMLElement {
    static readonly pageName = "info"
    static readonly tagName = "sf-info"

    #contentLoaded = new ExposedPromise<void>()
    readonly initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    readonly #ui = {
        isMainTab: () => this.#shadow.getElementById("isMainTab") as HTMLElement,

        bypass: () => this.#shadow.getElementById("bypass") as HTMLElement,
        bypassData: () => this.#shadow.getElementById("bypassData") as HTMLElement,

        /* stats */
        storageUsed: () => this.#shadow.getElementById("storageUsed") as HTMLElement,
        storageTotal: () => this.#shadow.getElementById("storageTotal") as HTMLElement,
        localPostCount: () => this.#shadow.getElementById("localPostCount") as HTMLElement,
        globalPostCount: () => this.#shadow.getElementById("globalPostCount") as HTMLElement,
        localEchoCount: () => this.#shadow.getElementById("localEchoCount") as HTMLElement,
        globalEchoCount: () => this.#shadow.getElementById("globalEchoCount") as HTMLElement,
        urlCount: () => this.#shadow.getElementById("urlCount") as HTMLElement,
        keyIdCount: () => this.#shadow.getElementById("keyIdCount") as HTMLElement,

        /* action buttons */
        importButton: () => this.#shadow.getElementById("importButton") as HTMLButtonElement,
        exportButton: () => this.#shadow.getElementById("exportButton") as HTMLButtonElement,
        deleteButton: () => this.#shadow.getElementById("deleteButton") as HTMLButtonElement,
        websiteButton: () => this.#shadow.getElementById("websiteButton") as HTMLButtonElement,
        repositoryButton: () => this.#shadow.getElementById("repositoryButton") as HTMLButtonElement,

        /* export dialog related */
        exportDialog: () => this.#shadow.getElementById("exportDialog") as HTMLDialogElement,
        exportTexts: () => this.#shadow.getElementById("exportTexts") as HTMLElement,
        exportCurrentTable: () => this.#shadow.getElementById("exportCurrentTable") as HTMLElement,
        exportCurrentTableI: () => this.#shadow.getElementById("exportCurrentTableI") as HTMLElement,
        exportCurrentTableN: () => this.#shadow.getElementById("exportCurrentTableN") as HTMLElement,
        exportSize: () => this.#shadow.getElementById("exportSize") as ByteSize,
        exportProgressBar: () => this.#shadow.getElementById("exportProgressBar") as HTMLProgressElement,
        exportButtonBars: () => this.#shadow.getElementById("exportButtonBars") as HTMLElement,
        exportAbort: () => this.#shadow.getElementById("exportAbort") as HTMLButtonElement,
        exportDownload: () => this.#shadow.getElementById("exportDownload") as HTMLButtonElement,
        exportCancel: () => this.#shadow.getElementById("exportCancel") as HTMLButtonElement,
        exportDownloadLink: () => this.#shadow.getElementById("exportDownloadLink") as HTMLAnchorElement,

        /* import dialog related */
        importDialog: () => this.#shadow.getElementById("importDialog") as HTMLDialogElement,
        importProgressBar: () => this.#shadow.getElementById("importProgressBar") as HTMLProgressElement,
        importTexts: () => this.#shadow.getElementById("importTexts") as HTMLElement,
        importFilename: () => this.#shadow.getElementById("importFilename") as HTMLElement,
        importFileSizeProcessed: () => this.#shadow.getElementById("importFileSizeProcessed") as ByteSize,
        importFileSizeTotal: () => this.#shadow.getElementById("importFileSizeTotal") as ByteSize,
        importButtonBars: () => this.#shadow.getElementById("importButtonBars") as HTMLElement,
        importAbortButton: () => this.#shadow.getElementById("importAbortButton") as HTMLButtonElement,
        importOkButton: () => this.#shadow.getElementById("importOkButton") as HTMLButtonElement,
        importFileInput: () => this.#shadow.getElementById("importFileInput") as HTMLInputElement,

        importNewRecords: () => this.#shadow.getElementById("importNewRecords") as HTMLElement,
        importProcessedRecords: () => this.#shadow.getElementById("importProcessedRecords") as HTMLElement,
        importErrorMessage: () => this.#shadow.getElementById("importErrorMessage") as HTMLElement,

        /* delete dialog related */
        deleteDialog: () => this.#shadow.getElementById("deleteDialog") as HTMLDialogElement,

        /* generic dialog buttons */
        dialogOkButton: (x: HTMLDialogElement) => x.querySelector(".okButton")! as HTMLButtonElement,
        dialogCloseButton: (x: HTMLDialogElement) => x.querySelector(".closeButton")! as HTMLButtonElement,
    }

    constructor() {
        super()
        this.#shadow = this.attachShadow({ mode: "open" })
        pageTitleR.set("Info")

        const tmplData: TmplData = {
            sfVersion: version.label,
            sfBuildDate: version.date,
            sfBuildDateStr: version.dateStr,
            devMode: devMode()
        }

        this.#shadow.innerHTML = tmpl("info.html", tmplData)
        watchDialogs(this.#shadow)

        if (bypassChecksActive()) {
            showEl(this.#ui.bypass())
            this.#ui.bypassData().innerText = toJson(bypassChecksData())
        }

        //bind stats to DOM
        onChange(storageUsedR, x => this.#ui.storageUsed().setAttribute("value", x.toString()))
        onChange(storageQuotaR, x => this.#ui.storageTotal().setAttribute("value", x.toString()))
        bindToTextContent(postCountR, this.#ui.localPostCount())
        bindToTextContent(echoWithStubsCountR, this.#ui.localEchoCount())
        bindToTextContent(urlCountR, this.#ui.urlCount())
        bindToTextContent(keyIdCountR, this.#ui.keyIdCount())
        bindToTextContent(globalPostCountR, this.#ui.globalPostCount())
        bindToTextContent(globalEchoCountR, this.#ui.globalEchoCount())
        bindToTextContent(isMainTabR, this.#ui.isMainTab())

        //info page buttons
        this.#ui.exportButton().addEventListener("click", this.exportDb.bind(this))

        this.#ui.importButton().addEventListener("click", () => {
            if (!isMainTab()) {
                const el = new Alert("Database can only be imported in main tab. Please close all other tabs where the app is open and try again.")
                document.body.appendChild(el)
                el.alert().then(() => document.body.removeChild(el))
                return
            }
            this.#ui.importFileInput().click()
        })
        this.#ui.importFileInput().addEventListener("cancel", () => {
            lg.info("file input cancel")
        })
        this.#ui.importFileInput().addEventListener("change", () => {
            if (this.#ui.importFileInput().files?.length !== 1) return
            lg.debug("file input changed: %O", this.#ui.importFileInput().files)
            this.importDb.bind(this)()
        })

        this.#ui.deleteButton().addEventListener("click", () => this.#ui.deleteDialog().showModal())

        this.#ui.websiteButton().addEventListener("click", () => window.open(mainSettings.websiteUrl.get(), "_blank"))
        this.#ui.repositoryButton().addEventListener("click", () => window.open(mainSettings.repoUrl.get(), "_blank"))

        //delete dialog actions
        this.#ui.dialogOkButton(this.#ui.deleteDialog()).addEventListener("click", this.deleteDb.bind(this))
        this.#ui.dialogCloseButton(this.#ui.deleteDialog()).addEventListener("click", () => this.#ui.deleteDialog().close())

        this.#contentLoaded.resolve()
    }

    //#region export
    exportDb() {
        const ev = exportDatabaseParameters()
        const ed = exportDatabase(ev.progress, ev.abortSignal)

        //dialog actions
        this.#ui.exportAbort().onclick = () => ev.abortSignal.abort = true
        this.#ui.exportCancel().onclick = () => this.#ui.exportDialog().close()
        this.#ui.exportDownload().onclick = () => {
            this.#ui.exportDownloadLink().click()
            this.#ui.exportDialog().close()
        }

        //callback when export has been finished or aborted
        ed.then((blob) => {
            if (blob === undefined) {
                //export aborted
                this.#ui.exportDialog().close()
                return
            }

            //export finished
            const url = URL.createObjectURL(blob)
            this.#ui.exportDialog().addEventListener("close", () => {
                //free blob after export download dialog has been closed
                lg.debug("revoke object url")
                URL.revokeObjectURL(url)
            }, { once: true })

            //prepare and show download dialog
            this.#ui.exportDownloadLink().href = url
            this.#ui.exportDownloadLink().download = exportDbFilename()
            this.#ui.exportSize().value = blob.size
            showChildEl(this.#ui.exportTexts(), 1)
            showChildEl(this.#ui.exportButtonBars(), 1)
            this.#ui.exportDownload().focus()
        })

        //prepare dialog and show it
        bindToTextContent(ev.progress.currentTable, this.#ui.exportCurrentTable())
        bindToTextContent(ev.progress.currentTableProcessedRowCount, this.#ui.exportCurrentTableI())
        bindToTextContent(ev.progress.currentTableRowCount, this.#ui.exportCurrentTableN())
        bindTo(ev.progress.totalRowCount, this.#ui.exportProgressBar(), "max")
        bindTo(ev.progress.processedRowCount, this.#ui.exportProgressBar(), "value")
        showChildEl(this.#ui.exportTexts(), 0)
        showChildEl(this.#ui.exportButtonBars(), 0)
        this.#ui.exportDialog().showModal()
    }

    //#endregion

    //#region import
    importDb() {
        lg.info("importDb() started")
        const file = this.#ui.importFileInput().files?.item(0)
        if (file == null) return

        const iv = importDatabaseParameters()
        this.#ui.importOkButton().onclick = () => this.#ui.importDialog().close()
        this.#ui.importAbortButton().onclick = () => iv.abortSignal.abort = true

        const abortOnEsc = (ev: KeyboardEvent) => {
            if (ev.key == "Escape") iv.abortSignal.abort = true
        }
        //abort when Esc is pressed
        document.addEventListener("keydown", abortOnEsc.bind(this))

        this.#ui.importFilename().textContent = file.name
        this.#ui.importFileSizeTotal().value = file.size
        bindTo(iv.progress.processedBytes, this.#ui.importFileSizeProcessed(), "value")
        bindTo(iv.progress.totalBytes, this.#ui.importProgressBar(), "max")
        bindTo(iv.progress.processedBytes, this.#ui.importProgressBar(), "value")

        showChildEl(this.#ui.importTexts(), 0)
        showChildEl(this.#ui.importButtonBars(), 0)

        importDatabase(file.stream(), file.size, iv.progress, iv.abortSignal).then(res => {
            document.removeEventListener("keydown", abortOnEsc)

            let importTextsIndex: number
            switch (res.type) {
                case "ok":
                    importTextsIndex = 1
                    this.#ui.importNewRecords().innerText = iv.progress.newRows.get().toString()
                    this.#ui.importProcessedRecords().innerText = iv.progress.processedRows.get().toString()
                    break

                case "aborted":
                    importTextsIndex = 2
                    break

                case "error":
                    importTextsIndex = 3
                    this.#ui.importErrorMessage().innerText = res.error.message
                    break
            }

            //set progress bar to 100%
            this.#ui.importProgressBar().value = this.#ui.importProgressBar().max

            //show result text
            showChildEl(this.#ui.importTexts(), importTextsIndex)
            showEl(this.#ui.importTexts())

            //show Ok button
            showChildEl(this.#ui.importButtonBars(), 1)
            this.#ui.importOkButton().focus()

            //reset file input            
            this.#ui.importFileInput().value = null as any
        })

        this.#ui.importDialog().showModal()
    }
    //#endregion

    deleteDb() {
        const deleted = deleteDatabase()
        if (deleted) location.reload()
        this.#ui.deleteDialog().close()
    }

}

function exportDbFilename(date?: Date) {
    date ??= new Date()
    return `senf-db-${dateInFilename()}.jsonl.gz`
}

async function storageUsage() {
    if (!(navigator.storage && navigator.storage.estimate))
        throw new Error("cannot estimate storage usage")

    const estimation = await navigator.storage.estimate()
    if (estimation.usage == undefined)
        throw new Error("estimation.usage undefined")
    if (estimation.quota == undefined)
        throw new Error("estimation.quota undefined")

    const usage = estimation.usage ?? 0
    const quota = estimation.quota ?? 0
    return {
        usage: usage,
        quota: quota
    }
}

init()

