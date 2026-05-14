export { LoadingDots, modName }

const modName = "LoadingDotsComponent"
const tagName = "sfc-loading-dots"

const dotChar = "."
const maxDots = 3
const animIntervalMs = 750

function init() {
    customElements.define(tagName, LoadingDots)
}

class LoadingDots extends HTMLElement {
    #intervalId: number
    #state: number

    constructor() {
        super()
        this.#state = 0
        this.#intervalId = 0
    }

    connectedCallback() {
        this.#render()
        this.#intervalId = setInterval(() => {
            this.#state = (this.#state + 1) % maxDots
            this.#render()
        }, animIntervalMs)
    }

    disconnectedCallback() {
        clearInterval(this.#intervalId)
    }

    #render() {
        const noOfDots = this.#state + 1
        const noOfInvsibleDots = maxDots - noOfDots        
        this.innerHTML = `<span>${dotChar.repeat(noOfDots)}<span class="hidden">${dotChar.repeat(noOfInvsibleDots)}</span></span>`
    }
}

init()