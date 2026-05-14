export { SettingsPage, modName }

import { tmpl as tmpl0 } from "../../tmpl.js"
import { mainSettings, preferredTmpl } from "../../../../../config.js"
import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { pageTitleR } from "../../App/App.js"
import { ExposedPromise, fromJson, isNumber, toNumber } from "../../../../libs/basic/misc.js"
import { onChange } from "../../../../libs/basic/reactive.js"
import { exportSettings, importSettings, resetSettings, Setting } from "../../../../libs/etc/settings.js"
import { anchorToPlainTextDownload, dateInFilename, isHttpUrl, setSelectValue } from "../../../../libs/etc/misc.js"
import { ciGallerySettings } from "../../components/CiGallery/CiGallery.js"
import { posterSettings } from "../../components/Poster/Poster.js"
import { settings as cidbSettings } from "../../../../backend/cidb/settings.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"
import { addYourAnonCi, addYourKeyId, aliasOf, setAlias } from "../../../../backend/cidb/cidb.js"
import { Prompt } from "../../components/Prompt/Prompt.js"
import { locationPageSettings } from "../Location/Location.js"

type SettingTypes = typeof settingTypes[number]
const settingTypes = ["settings", "you", "aliases", "archives"] as const

const modName = "SettingsPage"
const tmpl = (name: string, data: any) => tmpl0("pages/Settings/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)

function init() {
    customElements.define(SettingsPage.tagName, SettingsPage)
}

class SettingsPage extends HTMLElement {
    static readonly pageName = "settings"
    static readonly tagName = "sf-settings"

    #shadow: ShadowRoot
    #contentLoaded = new ExposedPromise<void>()
    readonly initialContentLoaded = this.#contentLoaded.promise

    readonly #ui = {
        archivesCount: () => this.#shadow.getElementById("archivesCount") as HTMLElement,
        trustedLocationCount: () => this.#shadow.getElementById("trustedLocationCount") as HTMLElement,

        colorThemeFieldset: () => this.#shadow.getElementById("colorThemeFieldset") as HTMLElement,
        layoutFieldset: () => this.#shadow.getElementById("layoutFieldset") as HTMLElement,
        postsPerPage: () => this.#shadow.getElementById("postsPerPage") as HTMLSelectElement,
        echosPerPage: () => this.#shadow.getElementById("echosPerPage") as HTMLSelectElement,
        showLastItemOfPreviousPage: () => this.#shadow.getElementById("showLastItemOfPreviousPage") as HTMLInputElement,
        showYou: () => this.#shadow.getElementById("showYou") as HTMLInputElement,
        oldestFirst: () => this.#shadow.getElementById("oldestFirst") as HTMLInputElement,
        showQueryBar: () => this.#shadow.getElementById("showQueryBar") as HTMLInputElement,

        customOption: (el: HTMLSelectElement) => el.querySelector<HTMLOptionElement>("option[value='custom']")!,

        /* buttons */
        addArchiveButton: () => this.#shadow.getElementById("addArchiveButton") as HTMLButtonElement,
        removeArchiveButton: () => this.#shadow.getElementById("removeArchiveButton") as HTMLButtonElement,
        addTrustedLocationButton: () => this.#shadow.getElementById("addTrustedLocationButton") as HTMLButtonElement,
        removeTrustedLocationButton: () => this.#shadow.getElementById("removeTrustedLocationButton") as HTMLButtonElement,

        exportButton: () => this.#shadow.getElementById("exportButton") as HTMLButtonElement,
        importButton: () => this.#shadow.getElementById("importButton") as HTMLButtonElement,
        resetButton: () => this.#shadow.getElementById("resetButton") as HTMLButtonElement,

        /* dialogs */
        removeArchiveDialog: () => this.#shadow.getElementById("removeArchiveDialog") as HTMLDialogElement,
        removeTrustedLocationDialog: () => this.#shadow.getElementById("removeTrustedLocationDialog") as HTMLDialogElement,

        exportDialog: () => this.#shadow.getElementById("exportDialog") as HTMLDialogElement,
        importDialog: () => this.#shadow.getElementById("importDialog") as HTMLDialogElement,
        resetDialog: () => this.#shadow.getElementById("resetDialog") as HTMLDialogElement,

        /* generic dialog buttons */
        dialogOkButton: (x: HTMLDialogElement) => x.querySelector(".okButton")! as HTMLButtonElement,
        dialogCloseButton: (x: HTMLDialogElement) => x.querySelector(".closeButton")! as HTMLButtonElement,

        /* etc */
        exportSelect: () => this.#shadow.getElementById("exportSelect") as HTMLElement,
        exportSettingsAnchor: () => this.#shadow.getElementById("exportSettingsAnchor") as HTMLAnchorElement,
        importFileInput: () => this.#shadow.getElementById("importFileInput") as HTMLInputElement,

        archiveList: () => this.#shadow.getElementById("archiveList") as HTMLElement,
        trustedList: () => this.#shadow.getElementById("trustedList") as HTMLElement
    }

    constructor() {
        super()
        this.#shadow = this.attachShadow({ mode: "closed" })
        watchDialogs(this.#shadow)
    }

    connectedCallback() {
        pageTitleR.set("Settings")
        this.#shadow.innerHTML = tmpl("settings.html", {})

        //#region link between settings and UI elements
        const radioSettings = [
            {
                fieldset: this.#ui.colorThemeFieldset(),
                setting: mainSettings.colorScheme,
                reload: false
            },
            {
                fieldset: this.#ui.layoutFieldset(),
                setting: mainSettings.layout,
                reload: true
            }
        ]
        const checkboxSettings = [
            {
                ui: this.#ui.showQueryBar(),
                setting: locationPageSettings.showQuerybar
            },
            {
                ui: this.#ui.showYou(),
                setting: posterSettings.showYou
            },
            {
                ui: this.#ui.oldestFirst(),
                setting: locationPageSettings.oldestFirst
            },
            {
                ui: this.#ui.showLastItemOfPreviousPage(),
                setting: ciGallerySettings.showLastItemOfPreviousPage
            },
        ]
        const numberSettings = [
            {
                ui: this.#ui.postsPerPage(),
                setting: ciGallerySettings.postsPerPage
            },
            {
                ui: this.#ui.echosPerPage(),
                setting: ciGallerySettings.echosPerPage
            },
        ]
        //#endregion

        //#region bind settings
        //bind radio settings (color / layout)
        for (const x of radioSettings) {
            onChange(x.setting as Setting<any>, (nv) => {
                x.fieldset.querySelectorAll<HTMLInputElement>("input").forEach(x => x.checked = false)
                x.fieldset.querySelectorAll<HTMLInputElement>("input[value=" + nv + "]").forEach(x => x.checked = true)
            })

            x.fieldset.addEventListener("change", (ev) => {
                const t = ev.target as HTMLInputElement
                x.setting.setSafely(t.value)
                if (x.reload) location.reload()
            })
        }

        //bind number settings
        const promptNumberEl = new Prompt("Choose a number:", { validator: isNumber, rightAlign: true })
        this.#shadow.appendChild(promptNumberEl)

        for (const x of numberSettings) {
            onChange(x.setting, (value) => {
                lg.debug("setting value changed")
                setSelectValue(x.ui, value.toString(), value.toString(), this.#ui.customOption(x.ui))
            })
            x.ui.addEventListener("change", async () => {
                let newValue = x.ui.value
                const value = toNumber(newValue)
                if (value === null) {
                    //custom selected                
                    const customValStr = await promptNumberEl.prompt() as string | null
                    const customVal = toNumber(customValStr ?? "")
                    if (customVal === null) {
                        //reset
                        setSelectValue(x.ui, x.setting.get().toString())
                    } else {
                        if (!x.setting.set(customVal)) {
                            //value did not change and therefore setting does not trigger 
                            //onChange => manually reset select from "Custom" to current value
                            setSelectValue(x.ui, x.setting.get().toString())
                        }
                    }
                } else {
                    //valid number selected
                    x.setting.set(value)
                }
            })
        }

        //bind checkbox settings
        for (const x of checkboxSettings) {
            onChange(x.setting, (nv) => { x.ui.checked = nv })
            x.ui.addEventListener("click", () => { x.setting.set(x.ui.checked) })
        }
        //#endregion

        this.#initArchiveSetting()
        this.#initTrustedLocationSetting()

        this.#ui.exportButton().addEventListener("click", this.exportSettings.bind(this))
        this.#ui.importButton().addEventListener("click", this.importSettings.bind(this))
        this.#ui.resetButton().addEventListener("click", this.resetSettings.bind(this))

        this.#contentLoaded.resolve()
    }

    #initArchiveSetting() {
        onChange(cidbSettings.archives, (nv) => {
            this.#ui.archivesCount().innerText = nv.length.toString()
        })
        const promptMsg = "Archive URL (don't forget a trailing '/' if the archive is a directory):"
        const promptArchiveEl = new Prompt(promptMsg, { validator: x => isHttpUrl(x.trim()), placeholder: "e.g. https://archive.senf.in/ or multiline paste" })
        this.#shadow.appendChild(promptArchiveEl)
        this.#ui.addArchiveButton().addEventListener("click", async () => {
            let resp = await promptArchiveEl.promptWithMultilinePaste()
            if (resp === null) {
                lg.debug("cancelled adding archive")
                return
            }

            const curArchives = cidbSettings.archives.get()
            for (const archiveUrl of resp) {
                const url = URL.parse(archiveUrl)
                if (url == null) {
                    lg.warn("Invalid archive URL: %O", archiveUrl)
                    continue
                }
                const protocol = url.protocol.slice(0, -1)
                if (!["http", "https"].includes(protocol)) {
                    lg.warn("Invalid archive URL protocol %s: %O", protocol, archiveUrl)
                    continue
                }

                if (curArchives.map(x => x.url).includes(url.href)) {
                    lg.warn("Archive %s already exists", url.href)
                    continue
                }

                curArchives.push({ url: url.href })
            }
            cidbSettings.archives.set(curArchives)
        })
        this.#ui.removeArchiveButton().addEventListener("click", this.removeArchives.bind(this))
    }

    #initTrustedLocationSetting() {
        onChange(mainSettings.trustedLocations, (nv) => {
            this.#ui.trustedLocationCount().innerText = nv.length.toString()
        })
        const promptMsg = "Trusted location URL prefix (media from trusted locations is embedded in the app):"
        const promptEl = new Prompt(promptMsg, { placeholder: "e.g. https://archive.senf.in/ or multiline paste" })
        this.#shadow.appendChild(promptEl)
        this.#ui.addTrustedLocationButton().addEventListener("click", async () => {
            let resp = await promptEl.promptWithMultilinePaste()
            if (resp === null) {
                lg.debug("cancelled adding trusted location")
                return
            }

            const curTrustedLocations = mainSettings.trustedLocations.get()
            for (const trustedUrl0 of resp) {
                const trustedUrl = URL.parse(trustedUrl0)?.href ?? trustedUrl0 //normalize
                if (curTrustedLocations.includes(trustedUrl)) {
                    lg.warn("Trusted URL %s already exists", trustedUrl)
                    continue
                }
                curTrustedLocations.push(trustedUrl)
            }
            mainSettings.trustedLocations.set(curTrustedLocations)
        })        
        this.#ui.removeTrustedLocationButton().addEventListener("click", this.removeTrustedLocations.bind(this))
    }

    exportSettings() {
        this.#setAllSelectedSettingTypes(this.#ui.exportDialog(), true)
        this.#ui.dialogCloseButton(this.#ui.exportDialog()).onclick = () => this.#ui.exportDialog().close()
        this.#ui.dialogOkButton(this.#ui.exportDialog()).onclick = () => {
            //download as file
            const includeSettingTypes = this.#getSelectedSettingTypes(this.#ui.exportDialog())
            const exportedSettings = filterExportedSettings(exportSettings(), includeSettingTypes)
            const settingsStr = JSON.stringify(exportedSettings, null, 2)
            const aEl = this.#ui.exportSettingsAnchor()
            anchorToPlainTextDownload(aEl, exportSettingsFilename(), settingsStr)
            aEl.click()
            this.#ui.exportDialog().close()
        }

        this.#ui.exportDialog().showModal()
    }

    importSettings() {
        this.#setAllSelectedSettingTypes(this.#ui.importDialog(), true)
        this.#ui.dialogCloseButton(this.#ui.importDialog()).onclick = () => this.#ui.importDialog().close()
        this.#ui.dialogOkButton(this.#ui.importDialog()).onclick = () => this.#ui.importFileInput().click()

        this.#ui.importFileInput().addEventListener("cancel", () => {
            lg.info("file input cancel")
        })
        this.#ui.importFileInput().addEventListener("change", async () => {
            if (this.#ui.importFileInput().files?.length !== 1) return
            const file = this.#ui.importFileInput().files![0]
            lg.debug("file input changed: %O", file)

            const includeSettingTypes = this.#getSelectedSettingTypes(this.#ui.importDialog())
            const exportedSettings = fromJson(await file.text()) as ReturnType<typeof exportSettings>

            try {
                const data = {
                    settings: undefined as any,
                    archives: undefined as any,
                    aliases: undefined as any,
                    yourKeyIds: undefined as any,
                    yourAnonCis: undefined as any
                }
                //null => this part was included in setting types to be imported
                const result = {
                    settings: null as any,
                    archives: null as any,
                    yourKeyIds: null as any,
                    yourAnonCis: null as any,
                    aliases: null as any
                }

                const exportedCidbSettings = exportedSettings["cidb"]
                if (exportedCidbSettings !== undefined) {
                    //extract archives, aliases, yourKeyIds and yourAnonCIs
                    data.archives = exportedCidbSettings["archives"]
                    data.aliases = exportedCidbSettings["aliases"]
                    data.yourKeyIds = exportedCidbSettings["yourKeyIds"]
                    data.yourAnonCis = exportedCidbSettings["yourAnonCis"]

                    //these are treated separately
                    delete exportedCidbSettings["archives"]
                    delete exportedCidbSettings["aliases"]
                    delete exportedCidbSettings["yourKeyIds"]
                    delete exportedCidbSettings["yourAnonCis"]
                    data.settings = exportedSettings
                }

                if (includeSettingTypes.includes("archives")) {
                    const rv = { value: null }
                    if (cidbSettings.archives.guard(data.archives, rv)) {
                        const oldUrls = new Set(cidbSettings.archives.get().map(x => x.url))
                        const newUrls = new Set(data.archives.map(x => x.url))
                        const resUrls = Array.from(oldUrls.union(newUrls))
                        cidbSettings.archives.set(resUrls.map(x => ({ url: x })))
                    } else {
                        result.archives = { type: "invalid", reason: rv }
                    }
                }

                if (includeSettingTypes.includes("aliases")) {
                    const rv = { value: null }
                    if (cidbSettings.aliases.guard(data.aliases, rv)) {
                        const res = []
                        for (const a of data.aliases) {
                            const existingAlias = aliasOf(a[0])
                            if (existingAlias == undefined || existingAlias == a[1]) {
                                res.push([a, setAlias(a[0], a[1])])
                            } else {
                                res.push([a, { type: "otherAlias", alias: existingAlias }])
                            }
                        }
                        result.aliases = { type: "ok", entries: res }
                    } else {
                        result.aliases = { type: "invalid", reason: rv }
                    }
                }

                if (includeSettingTypes.includes("you")) {
                    const rv0 = { value: null }
                    if (cidbSettings.yourAnonCis.guard(data.yourAnonCis, rv0)) {
                        const res = []
                        for (const x of data.yourAnonCis) {
                            res.push([x, addYourAnonCi(x)])
                        }
                        result.yourAnonCis = { type: "ok", entries: res }
                    } else {
                        result.yourAnonCis = { type: "invalid", reason: rv0 }
                    }

                    const rv1 = { value: null }
                    if (cidbSettings.yourKeyIds.guard(data.yourKeyIds, rv1)) {
                        const res = []
                        for (const x of data.yourKeyIds) {
                            res.push([x, addYourKeyId(x)])
                        }
                        result.yourKeyIds = { type: "ok", entries: res }
                    } else {
                        result.yourKeyIds = { type: "invalid", reason: rv1 }
                    }
                }

                if (includeSettingTypes.includes("settings")) {
                    //add other settings
                    result.settings = importSettings(data.settings, true)
                }

                lg.info("Import result: %O", result)
            } catch (e) {
                lg.error("No settings were changed. Invalid settings file %s: %O", file.name, e)
            } finally {
                //reset file input
                this.#ui.importFileInput().value = null as any
                this.#ui.importDialog().close()
            }
        })

        this.#ui.importDialog().showModal()
    }

    resetSettings() {
        this.#ui.dialogCloseButton(this.#ui.resetDialog()).onclick = () => this.#ui.resetDialog().close()
        this.#ui.dialogOkButton(this.#ui.resetDialog()).onclick = () => {
            resetSettings()
            location.reload()
        }
        this.#ui.resetDialog().showModal()
    }

    removeArchives() {
        this.#ui.archiveList().innerHTML = tmpl("archive_list.html", { archives: cidbSettings.archives.get() })

        this.#ui.dialogCloseButton(this.#ui.removeArchiveDialog()).onclick = () => this.#ui.removeArchiveDialog().close()
        this.#ui.dialogOkButton(this.#ui.removeArchiveDialog()).onclick = () => {
            const archivesToRemove = Array.from(this.#ui.archiveList().querySelectorAll<HTMLInputElement>("input:checked").entries()).map(([_i, el]) => el.value)
            lg.debug("archives to remove: %O", archivesToRemove)
            const curArchives = cidbSettings.archives.get()
            const newArchives = curArchives.filter(x => !archivesToRemove.includes(x.url))
            if (newArchives.length == 0) {
                lg.debug("resetting archives")
                cidbSettings.archives.unset()
            } else {
                lg.debug("setting new archives after removing: %O", newArchives)
                cidbSettings.archives.set(newArchives)
            }
            this.#ui.removeArchiveDialog().close()
        }

        this.#ui.removeArchiveDialog().showModal()
    }

    removeTrustedLocations() {
        this.#ui.trustedList().innerHTML = tmpl("trusted_list.html", { trustedLocations: mainSettings.trustedLocations.get().map(x => ({ url: x })) })

        this.#ui.dialogCloseButton(this.#ui.removeTrustedLocationDialog()).onclick = () => this.#ui.removeTrustedLocationDialog().close()
        this.#ui.dialogOkButton(this.#ui.removeTrustedLocationDialog()).onclick = () => {
            const trustedLocationsToRemove = Array.from(this.#ui.trustedList().querySelectorAll<HTMLInputElement>("input:checked").entries()).map(([_i, el]) => el.value)
            lg.debug("trusted locations to remove: %O", trustedLocationsToRemove)
            const curTrusted = mainSettings.trustedLocations.get()
            const newTrusted = curTrusted.filter(x => !trustedLocationsToRemove.includes(x))

            lg.debug("setting new trusted locations: %O", newTrusted)
            mainSettings.trustedLocations.set(newTrusted)

            this.#ui.removeTrustedLocationDialog().close()
        }

        this.#ui.removeTrustedLocationDialog().showModal()
    }

    #setAllSelectedSettingTypes(parentEl: HTMLElement, value: boolean) {
        parentEl.querySelectorAll<HTMLInputElement>(".settingTypes input").forEach(x => x.checked = true)
    }

    #getSelectedSettingTypes(parentEl: HTMLElement) {
        return Array.from(parentEl.querySelectorAll<HTMLInputElement>(".settingTypes input:checked").entries()).map(([_i, el]) => el.value) as SettingTypes[]
    }
}

function exportSettingsFilename(date?: Date) {
    date ??= new Date()
    return `sf-settings-${dateInFilename()}.json`
}

function filterExportedSettings(settings: ReturnType<typeof exportSettings>, include: SettingTypes[]): ReturnType<typeof exportSettings> {
    const res = {} as ReturnType<typeof exportSettings>
    for (const [sectionName, value] of Object.entries(settings)) {
        for (const [settingName, setting] of Object.entries(settings[sectionName])) {
            let add = false
            if (sectionName == "cidb" && settingName.startsWith("your")) {
                //you
                add = include.includes("you")
            } else if (sectionName == "cidb" && settingName == "aliases") {
                //aliases
                add = include.includes("aliases")
            } else if (sectionName == "cidb" && settingName == "archives") {
                //archives
                add = include.includes("archives")
            } else {
                //general settings
                add = include.includes("settings")
            }

            if (add) {
                if (!Object.hasOwn(res, sectionName)) res[sectionName] = {}
                res[sectionName][settingName] = settings[sectionName][settingName]
            }
        }
    }
    return res
}

init()
