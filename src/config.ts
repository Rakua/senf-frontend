export {
    DeviceType, mainSettings,
    registeredFrontends, RegisteredFrontend,    
    devMode, enableDevMode, disableDevMode, preferredTmpl, dateToString,
    darkModeEnabled, toggleDarkMode, toggleLayout, initBindSettingsToDom,
    isTrustedLocation
}

import { newSettings } from "./modules/libs/etc/settings.js"
import { DeviceType, guessDevice } from "./modules/libs/etc/misc.js"
import { guards, literalGuard, toArrayGuard } from "./modules/libs/etc/guard.js"
import { onChange } from "./modules/libs/basic/reactive.js"

type RegisteredFrontend = typeof registeredFrontends[number]
type DateStyle = typeof dateStyles[number]
type ColorScheme = typeof colorSchemes[number]

const registeredFrontends = ["default", "test"] as const
const dateStyles = ["full", "long", "medium", "short"] as const
const colorSchemes = ["auto", "light", "dark"] as const

const frontendGuard = literalGuard(...registeredFrontends)
const dateStyleGuard = literalGuard(...dateStyles)
const colorSchemeGuard = literalGuard(...colorSchemes)
const layoutGuard = literalGuard(...Object.values(DeviceType))
const wtGuard = toArrayGuard(guards.positiveInteger)

/**
 * Settings shared across different modules
 */
const mainSettings = newSettings("main", {
    platformName: { default: "senf.in" },
    serverUrl: { default: "https://a.senf.in", guard: guards.url },
    appUrl: { default: "https://app.senf.in", guard: guards.url },    
    websiteUrl: { default: "https://senf.in", guard: guards.url },
    repoUrl: { default: "https://repo.senf.in", guard: guards.url },
    sdstUrl: { default: "https://sdstool.app", guard: guards.url },

    frontend: { default: registeredFrontends[0] as RegisteredFrontend, guard: frontendGuard },
    colorScheme: { default: colorSchemes[0] as ColorScheme, guard: colorSchemeGuard },

    signRequestViaFragmentId: { default: false },
    acceptedAlgorithms: { default: ["ed25519", "ed448", "secp256k1", "prime256v1", "brainpoolP256r1", "brainpoolP256t1"] },
    acceptedDigestMethods: { default: ["sha256"] },
    acceptedSchemes: { default: ["http", "https", "ci", "tag"] },

    layout: { default: guessDevice(), guard: layoutGuard },
    locale: { default: navigator.language },
    dateStyle: { default: "medium", guard: dateStyleGuard },
    timeStyle: { default: "short", guard: dateStyleGuard },

    selectWaitingTimes: {
        default: [1, 5, 15, 60, 120], guard: wtGuard,
        repair(ev) {
            const v = ev.data.value
            if (!Array.isArray(v)) return undefined
            const r = v.filter(x => typeof x == "number" && Number.isFinite(x) && x % 1 == 0 && x >= 1)
            return r.length > 0 ? r : undefined
        },
    },

    trustedLocations: { default: ["https://archive.senf.in/"], description: "Media content from trusted domains is embedded in the location page. Add 'http' as trusted domain to trust all domains." },
})

const devMode = () => localStorage.getItem("devMode") !== null
const preferredTmpl = () => mainSettings.layout.get()

const toggleLayout = () => mainSettings.layout.set(mainSettings.layout.get() == DeviceType.Desktop ? DeviceType.Mobile : DeviceType.Desktop)

const darkModeEnabled = () => mainSettings.colorScheme.get() == "auto"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches //user agent's preference
    : mainSettings.colorScheme.get() == "dark" //explicit color mode is set
const toColorScheme = (isDark: boolean) => isDark ? "dark" : "light"
const toggleDarkMode = () => mainSettings.colorScheme.set(toColorScheme(!darkModeEnabled()))

function enableDevMode() {
    localStorage.setItem("devMode", "true")
    window.location.reload()
}

function disableDevMode() {
    localStorage.removeItem("devMode")
    window.location.reload()
}

function dateToString(date: Date, mode: "full" | "dateOnly" | "timeOnly") {
    return new Intl.DateTimeFormat(mainSettings.locale.get(), {
        dateStyle: mode != "timeOnly" ? mainSettings.dateStyle.get() : undefined,
        timeStyle: mode != "dateOnly" ? mainSettings.timeStyle.get() : undefined,
    }).format(date)
}

function isTrustedLocation(url: string) {
    url = URL.parse(url)?.href ?? url //normalize url
    return mainSettings.trustedLocations.get().some(prefix => url.startsWith(prefix))
}

/**
 * Binds the layout and color scheme settings to their respective
 * `<html>` dataset attributes in order to be accessible by CSS.
 * Call this in `main.ts` at the beginning of initialization.
 * 
 * @example // access layout and color scheme in CSS
 * $X[data-layout="m"] { //CSS styles } 
 * $X[data-layout="d"] { //CSS styles } 
 * $X[data-theme="light"] { //CSS styles }
 * $X[data-theme="dark"] { //CSS styles }
 * 
 */
function initBindSettingsToDom() {
    onChange(mainSettings.colorScheme, () => {
        document.documentElement.style.colorScheme = toColorScheme(darkModeEnabled())
        document.documentElement.dataset.theme = toColorScheme(darkModeEnabled())
    })

    //only set layout (desktop/mobile) on loading
    //changing layout requires reload
    document.documentElement.dataset.layout = mainSettings.layout.get()
    // onChange(mainSettings.layout, (nv) => {
    //     document.documentElement.dataset.layout = nv
    // })
}