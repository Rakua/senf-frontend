export { getRegisteredPages, defaultPage }

import { NaviPath } from "../../../libs/etc/router.js"
import { HomePage } from "../pages/Home/Home.js"

import { InfoPage } from "../pages/Info/Info.js"
import { LoadPage } from "../pages/Load/Load.js"
import { LocationPage } from "../pages/Location/Location.js"
import { PlacesPage } from "../pages/Places/Places.js"
import { PostPage } from "../pages/Post/Post.js"
import { QueuePage } from "../pages/Queue/Queue.js"
import { SettingsPage } from "../pages/Settings/Settings.js"
import { SyntaxPage } from "../pages/Syntax/Syntax.js"
import { SourcePage } from "../pages/Source/Source.js"

type RegisteredPage = {
    Element: new () => HTMLElement & InitialContentLoaded, //class extending HTMLElement
    naviLabel?: string,  //no label => not in navi
    inShortNavi?: boolean, //true iff shown in main navi/ otherwise hide under "⋮ More"    

    pageName: string,
    path: NaviPath
}

type InitialContentLoaded = {
    initialContentLoaded: Promise<void>
}

const registeredPages = [
    { Element: HomePage as any, naviLabel: "Home", inShortNavi: true },
    { Element: PlacesPage as any, naviLabel: "Places", inShortNavi: true },
    { Element: QueuePage as any, naviLabel: "Queue", inShortNavi: true },
    { Element: SettingsPage as any, naviLabel: "Settings", inShortNavi: true },

    { Element: LocationPage },
    { Element: LoadPage },    
    { Element: PostPage },
    { Element: SyntaxPage },    
    
    { Element: InfoPage },
    { Element: SourcePage },
]

const defaultPage = () => registeredPages[0]

function getRegisteredPages(): RegisteredPage[] {
    return registeredPages.map(p => ({
        pageName: p.Element.pageName,
        path: new NaviPath(p.Element.pageName),
        ...p
    }))
}