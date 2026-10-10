// Переход между локациями: при смене фона экран VN закрывается (затемнение или шторка), под ним
// применяется обновление vnData, и экран открывается уже с новым фоном. Каждый клиент играет переход сам
// по своему updateSetting. Настройки locationTransition / locationTransitionSpeed - меню "Настройки эффектов".
// С Reduced motion (личная настройка) переход не играется - фон меняется мгновенно.
import { Constants as C } from './const.js';

const MAX_PRELOAD_WAIT_MS = 1500
let lastBackgroundImage
let isBackgroundKnown = false
let runningTransition = null

const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))

function isVnVisibleForMe(vnData) {
    return vnData.showVN && !game.user.getFlag(C.ID, "hideVN")
        && (game.user.isGM || !vnData.showForIds || vnData.showForIds.includes(game.user.id))
}

// Запоминает фон при каждом обновлении - иначе следующая смена сравнивалась бы с устаревшим значением
function isBackgroundChange(vnData) {
    const backgroundImage = vnData?.location?.backgroundImage ?? null
    const wasKnown = isBackgroundKnown
    const previousBackgroundImage = lastBackgroundImage
    lastBackgroundImage = backgroundImage
    isBackgroundKnown = true
    return wasKnown && previousBackgroundImage !== backgroundImage
}

function getTransitionLayer() {
    let layer = document.getElementById("vn-fx-transition-layer")
    if (!layer) {
        layer = document.createElement("div")
        layer.id = "vn-fx-transition-layer"
        document.getElementById("vn-body").appendChild(layer)
    }
    return layer
}

function preloadImage(path) {
    if (!path) return Promise.resolve()
    const image = new Image()
    image.src = path
    return image.decode().catch(() => {})
}

async function playTransition(mode, backgroundImage, applyUpdate) {
    const halfMilliseconds = game.settings.get(C.ID, "locationTransitionSpeed") * 1000 / 2
    const preload = preloadImage(backgroundImage)
    const layer = getTransitionLayer()
    layer.className = `vn-transition-${mode}`
    layer.style.setProperty("--vn-transition-half", `${halfMilliseconds}ms`)
    void layer.offsetWidth // начальное положение (шторка слева / прозрачный слой) до запуска перехода
    layer.classList.add("vn-transition-cover")
    await wait(halfMilliseconds)
    try {
        await applyUpdate()
        // Новый фон подгружается, пока экран закрыт - открываем не дольше чем через 1.5 с, даже если не загрузился
        await Promise.race([preload, wait(MAX_PRELOAD_WAIT_MS)])
    } finally {
        // Экран открывается и при ошибке рендера - иначе VN остался бы закрыт чёрным слоем
        layer.classList.replace("vn-transition-cover", "vn-transition-reveal")
        await wait(halfMilliseconds)
        layer.className = ""
    }
}

// Точка входа из main.js Hooks.on("updateSetting") для vnData. Обновления, пришедшие во время перехода,
// ждут его окончания - иначе их рендер показал бы новый фон до того, как экран закрылся.
export async function applyVnDataUpdate(vnData, applyUpdate) {
    while (runningTransition) await runningTransition
    const mode = game.settings.get(C.ID, "locationTransition")
    const shouldPlay = isBackgroundChange(vnData) && mode !== "none"
        && !document.body.classList.contains("vn-reduced-motion")
        && isVnVisibleForMe(vnData) && !!document.getElementById("vn-body")
    if (!shouldPlay) return applyUpdate()
    runningTransition = playTransition(mode, vnData.location.backgroundImage, applyUpdate)
    try {
        await runningTransition
    } finally {
        runningTransition = null
    }
}

Hooks.once("ready", () => isBackgroundChange(game.settings.get(C.ID, "vnData")))
