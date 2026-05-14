import { devMode, enableDevMode, disableDevMode, mainSettings, initBindSettingsToDom } from "./config.js"
import { DefaultLogger } from "./modules/libs/basic/logger.js"

import { init as initDev, devTest } from "./dev.js"
import { init as initMathjax } from "./modules/libs/etc/mathjax.js"
import { init as initDialogs } from "./modules/libs/etc/dialogs.js"
import { init as initRouter } from "./modules/libs/etc/router.js"
import { init as initStorage } from "./modules/libs/etc/storage.js"
import { init as initTab } from "./modules/libs/etc/tab.js"
import { init as initTime } from "./modules/backend/time.js"
import { init as initPost } from "./modules/backend/post/post.js"
import { bypassChecksActive, bypassChecksData, init as initCidb } from "./modules/backend/cidb/cidb.js"

declare global {
    interface Window {
        MathJax: any,
        sf: any
    }
}

const lg = new DefaultLogger("main")

main()

function main() {
    window.sf = { enableDevMode, disableDevMode }

    lg.info("main() (devMode = %O)", devMode())
    //hide debug messages in non-dev mode
    if (!devMode()) DefaultLogger.muteLevel("debug")
    if(bypassChecksActive()) lg.security("Bypassing CI checks for %O", bypassChecksData())
    
    //init     
    if (devMode()) initDev()
    initBindSettingsToDom()
    initMathjax()
    initDialogs()
    initRouter()
    initStorage()
    initTab()
    initTime()
    initPost()
    initCidb()

    //load frontend
    const frontend = mainSettings.frontend.get()
    lg.info("Frontend: %s", frontend)
    import(`./modules/frontends/${frontend}/main.js`)

    if (devMode()) devTest()
}
