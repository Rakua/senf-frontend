export { YourAnonCis, YourKeyIds, Aliases }

import { ReactiveSyncWritableValue } from "../../libs/basic/reactive.js"
import { UserCiPrimaryKey } from "./db/schema/v1.js"
import { KeyId } from "./types/ci.js"

class YourAnonCis {
    readonly #data: ReactiveSyncWritableValue<UserCiPrimaryKey[] | undefined>

    constructor(data: ReactiveSyncWritableValue<UserCiPrimaryKey[] | undefined>) {
        this.#data = data
    }

    get(): UserCiPrimaryKey[] {
        return this.#data.get() ?? []
    }

    contains(pk: UserCiPrimaryKey) {
        return this.get().find(x => x[0] === pk[0] && x[1] === pk[1]) != undefined
    }

    /**
     * @returns true if ciId was not previously contained in yourAnonCis
     */
    add(pk: UserCiPrimaryKey) {
        if (this.contains(pk)) return false
        const nv = this.get()
        nv.push(pk)
        this.#data.set(nv)
        return true
    }
}

class YourKeyIds {
    readonly #data: ReactiveSyncWritableValue<KeyId[] | undefined>

    constructor(data: ReactiveSyncWritableValue<KeyId[] | undefined>) {
        this.#data = data
    }


    get(): KeyId[] {
        return this.#data.get() ?? []
    }

    contains(kid: KeyId) {
        return this.get().includes(kid)
    }

    /**
     * @returns true if keyId was not previously contained in yourKeyIds
     */
    add(kid: KeyId) {
        if (this.contains(kid)) return false
        const kids = this.get()
        kids.push(kid)
        this.#data.set(kids)
        return true
    }
}

class Aliases {
    readonly #data: ReactiveSyncWritableValue<[KeyId, string][] | undefined>

    constructor(data: ReactiveSyncWritableValue<[KeyId, string][] | undefined>) {
        this.#data = data
    }

    get() {
        return this.#data.get() ?? []
    }

    getAlias(keyId: KeyId): string | undefined {
        const x = this.get().find(x => x[0] == keyId)
        return x == undefined ? undefined : x[1]
    }

    hasAlias(keyId: KeyId) {
        return this.getAlias(keyId) != undefined
    }

    getKeyId(alias: string): string | undefined {
        const x = this.get().find(x => x[1] == alias)
        return x == undefined ? undefined : x[0]
    }

    aliasExists(alias: string) {
        return this.getKeyId(alias) != undefined
    }

    /**
     * @returns true if alias did not exist previously
     */
    setAlias(keyId: string, alias: string) {
        if(this.aliasExists(alias)) return false
        const aliases = this.get()
        aliases.push([keyId, alias])
        this.#data.set(aliases)
        return true
    }

    unsetAlias(keyId: string) {
        if(!this.hasAlias(keyId)) return false
        const aliases = this.get().filter(([kid,alias]) => kid != keyId)
        this.#data.set(aliases)
        return true
    }
}

