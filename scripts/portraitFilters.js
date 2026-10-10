// Автофильтры (настройка autoPortraitFilters, меню "Настройки эффектов"): activeSpeakers[pos].autoFilters -
// вычисляются ГМом из состояния актёра (HP, статусы) и хранятся отдельно от ручных filters, поэтому
// "Снять фильтры" в панели их не трогает, а выключение настройки сразу убирает их у всех клиентов.
import { Constants as C, getSettings } from './const.js';

// Фильтры-эффекты на портретах VN-окна (кровь, грязь, затемнение и т.д.).
//
// Хранение: activeSpeakers[pos].filters - массив id из PORTRAIT_FILTERS. Это состояние СЦЕНЫ, а не
// библиотеки портретов: фильтр едет вместе с персонажем при обмене слотами, но не сохраняется в
// settings.portraits (см. _confirmChanges в main.js) и пропадает, когда персонажа убирают со сцены.
//
// Применение: CSS-свойство filter на обёртке .vn-portrait (а не на её <img>) - у <img> свой filter
// для неактивных портретов (brightness(0.35)) и анимаций появления, inline-стиль на нём перебил бы их.
// .vn-portrait - position: fixed, а <img> внутри - position: relative, поэтому filter (который делает
// элемент containing block для потомков) не сдвигает раскладку. SVG-фильтры (кровь, грязь) обрезаются
// по SourceAlpha - текстура ложится только на непрозрачные пиксели персонажа, не на фон картинки.

// Порядок массива = порядок композиции: сначала текстуры, потом цветовые фильтры (чтобы затемнение
// и обесцвечивание касались и крови/грязи), в конце размытие и свечение (drop-shadow не затемняется).
export const PORTRAIT_FILTERS = [
    { id: "dirt", icon: "fas fa-hill-rockslide", css: "url(#vn-pf-dirt)" },
    { id: "blood", icon: "fas fa-droplet", css: "url(#vn-pf-blood)" },
    { id: "poison", icon: "fas fa-skull-crossbones", css: "sepia(0.7) hue-rotate(50deg) saturate(1.7)" },
    { id: "frozen", icon: "fas fa-snowflake", css: "saturate(0.45) sepia(0.35) hue-rotate(165deg) brightness(1.08)" },
    { id: "sepia", icon: "fas fa-hourglass-half", css: "sepia(0.9)" },
    { id: "grayscale", icon: "fas fa-circle-half-stroke", css: "grayscale(1)" },
    { id: "darken", icon: "fas fa-moon", css: "brightness(0.45)" },
    { id: "silhouette", icon: "fas fa-user-secret", css: "brightness(0)" },
    { id: "blur", icon: "fas fa-eye-low-vision", css: "blur(3px)" },
    { id: "ghost", icon: "fas fa-ghost", css: "grayscale(0.7) brightness(1.25) opacity(0.55) drop-shadow(0 0 8px rgba(150, 200, 255, 0.9))" },
    { id: "glow", icon: "fas fa-sun", css: "drop-shadow(0 0 10px rgba(255, 210, 120, 0.95))" },
]

const FILTER_IDS = PORTRAIT_FILTERS.map(filter => filter.id)
const ROW_LAYER_SHADOW = "drop-shadow(0 10px 18px rgba(0,0,0,.6))"

// Приводит произвольный список к каноническому порядку композиции, отбрасывая неизвестные id
export function normalizePortraitFilters(filters) {
    const requested = new Set(Array.isArray(filters) ? filters : [])
    return FILTER_IDS.filter(id => requested.has(id))
}

// Ручные фильтры + автофильтры (если включены) - то, что реально рисуется на портрете
export function getEffectiveFilters(speaker) {
    if (!speaker) return []
    const autoFilters = game.settings.get(C.ID, "autoPortraitFilters") ? speaker.autoFilters : []
    return normalizePortraitFilters([...(speaker.filters || []), ...(autoFilters || [])])
}

export function buildSpeakerFilterCss(speaker) {
    return buildPortraitFilterCss(getEffectiveFilters(speaker))
}

export function buildPortraitFilterCss(filters) {
    const cssParts = normalizePortraitFilters(filters).map(id => PORTRAIT_FILTERS.find(filter => filter.id === id).css)
    if (!cssParts.length) return ""
    return cssParts.join(" ")
}

// Текстурные фильтры (кровь, грязь) - шум feTurbulence. Считать его на лету дорого: браузер пересчитывает
// шум по каждому пикселю при КАЖДОЙ перерисовке портрета (анимация появления, переход фильтра, окно поверх
// портрета). Замер в Chromium (14 портретов, панель тащат поверх): живой шум - до 150 мс на кадр при
// переключении фильтра и ~30 fps при перетаскивании; запечённый тайл - не дороже портретов без фильтров.
// Поэтому шум один раз "запекается" в бесшовный тайл 512x512 (canvas + тот же фильтр с stitchTiles), а
// фильтр портрета только размножает картинку (feTile) и обрезает её по альфе персонажа.
// Живые фильтры ниже - запасной вариант, если браузер не умеет canvas.filter = "url(#...)".
const TEXTURE_TILE_SIZE = 512

// Генераторы тайлов: те же цвета/пороги, что у живых фильтров; частоты кратны 1/512 - иначе тайл не бесшовный
const TEXTURE_GENERATORS = {
    dirt: `
      <feTurbulence type="fractalNoise" baseFrequency="0.0078125 0.01171875" numOctaves="4" seed="4" stitchTiles="stitch" result="smudgeNoise"/>
      <feColorMatrix in="smudgeNoise" type="matrix" values="0 0 0 0 0.27  0 0 0 0 0.19  0 0 0 0 0.10  3.4 0 0 0 -1.5" result="smudge"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.08984375" numOctaves="2" seed="9" stitchTiles="stitch" result="speckNoise"/>
      <feColorMatrix in="speckNoise" type="matrix" values="0 0 0 0 0.16  0 0 0 0 0.11  0 0 0 0 0.06  14 0 0 0 -9.1" result="speck"/>
      <feMerge><feMergeNode in="smudge"/><feMergeNode in="speck"/></feMerge>`,
    blood: `
      <feTurbulence type="fractalNoise" baseFrequency="0.015625 0.009765625" numOctaves="3" seed="21" stitchTiles="stitch" result="splatNoise"/>
      <feColorMatrix in="splatNoise" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.02  0 0 0 0 0.03  0 -11 0 0 4.35" result="splat"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.05859375" numOctaves="2" seed="13" stitchTiles="stitch" result="dropNoise"/>
      <feColorMatrix in="dropNoise" type="matrix" values="0 0 0 0 0.30  0 0 0 0 0.01  0 0 0 0 0.02  0 0 -20 0 7.3" result="drops"/>
      <feMerge><feMergeNode in="splat"/><feMergeNode in="drops"/></feMerge>`,
}

// Область фильтра с запасом -50%/200%: <img> внутри .vn-portrait может выходить за её рамки
// (масштаб и смещения портрета), а SVG-фильтр обрезает всё за пределами своей области.
const PORTRAIT_FILTER_REGION = `x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"`
const MASK_TEXTURE_TO_PORTRAIT = `
      <feComposite in="texture" in2="SourceAlpha" operator="in" result="textureMasked"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="textureMasked"/></feMerge>`

// Живой (запасной) вариант: генератор с исходными частотами без stitchTiles + та же обрезка по альфе
const LIVE_TEXTURE_FILTERS = {
    dirt: TEXTURE_GENERATORS.dirt.replace(`baseFrequency="0.0078125 0.01171875"`, `baseFrequency="0.008 0.012"`).replace(`baseFrequency="0.08984375"`, `baseFrequency="0.09"`),
    blood: TEXTURE_GENERATORS.blood.replace(`baseFrequency="0.015625 0.009765625"`, `baseFrequency="0.016 0.009"`).replace(`baseFrequency="0.05859375"`, `baseFrequency="0.06"`),
}
const asTexture = (primitives) => primitives.replace(/<feMerge>(?![\s\S]*<feMerge>)/, `<feMerge result="texture">`)

const SVG_FILTER_DEFS = `
<svg id="vn-portrait-filter-defs" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    ${Object.entries(TEXTURE_GENERATORS).map(([id, primitives]) => `<filter id="vn-pf-gen-${id}" x="0" y="0" width="${TEXTURE_TILE_SIZE}" height="${TEXTURE_TILE_SIZE}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${primitives}</filter>`).join("")}
    ${Object.entries(LIVE_TEXTURE_FILTERS).map(([id, primitives]) => `<filter id="vn-pf-${id}" ${PORTRAIT_FILTER_REGION}>${asTexture(primitives)}${MASK_TEXTURE_TO_PORTRAIT}</filter>`).join("")}
  </defs>
</svg>`

export function ensurePortraitFilterDefs() {
    if (document.getElementById("vn-portrait-filter-defs")) return
    document.body.insertAdjacentHTML("beforeend", SVG_FILTER_DEFS)
}

// null - браузер не поддерживает canvas.filter со ссылкой на SVG-фильтр (остаётся живой фильтр)
function bakeTextureTile(generatorFilterId) {
    const canvas = document.createElement("canvas")
    canvas.width = TEXTURE_TILE_SIZE
    canvas.height = TEXTURE_TILE_SIZE
    const context = canvas.getContext("2d")
    if (!context || !("filter" in context)) return null
    context.filter = `url(#${generatorFilterId})`
    if (!context.filter || context.filter === "none") return null
    context.fillRect(0, 0, TEXTURE_TILE_SIZE, TEXTURE_TILE_SIZE)
    // Если фильтр молча не применился, вместо полупрозрачной текстуры будет сплошной чёрный квадрат
    const pixels = context.getImageData(0, 0, TEXTURE_TILE_SIZE, TEXTURE_TILE_SIZE).data
    let hasTransparency = false
    for (let index = 3; index < pixels.length; index += 4 * 97) {
        if (pixels[index] < 255) {
            hasTransparency = true
            break
        }
    }
    if (!hasTransparency) return null
    return canvas.toDataURL("image/png")
}

const bakedTextures = new Set()
function ensureBakedTexture(id) {
    if (bakedTextures.has(id)) return
    bakedTextures.add(id)
    try {
        const tileUrl = bakeTextureTile(`vn-pf-gen-${id}`)
        if (!tileUrl) return
        document.getElementById(`vn-pf-${id}`).innerHTML = `
      <feImage href="${tileUrl}" x="0" y="0" width="${TEXTURE_TILE_SIZE}" height="${TEXTURE_TILE_SIZE}" preserveAspectRatio="none" result="tile"/>
      <feTile in="tile" result="texture"/>${MASK_TEXTURE_TO_PORTRAIT}`
    } catch (error) {
        console.warn(`visual-novel-reverse | portrait filter "${id}" stays live (texture bake failed):`, error)
    }
}

// Запись в style.filter только при реальном изменении - иначе каждое обновление vnData заново
// инвалидировало бы стили всех портретов. Сравниваем с data-атрибутом, а не со style.filter:
// браузер нормализует прочитанное значение (url(#id) -> url("#id")), и оно никогда не совпало бы.
function setFilterIfChanged(element, filterCss) {
    if (element.dataset.vnFilter === filterCss) return
    element.dataset.vnFilter = filterCss
    element.style.filter = filterCss
}

// Применяет фильтры к УЖЕ СУЩЕСТВУЮЩИМ узлам - вызывается из _onRender и из Hooks.on("updateSetting")
// (переключение фильтра в панели не просит перерисовку портретов, чтобы не перезапускать их анимацию появления)
export function applyPortraitFilters(settingData) {
    ensurePortraitFilterDefs()
    const activeSpeakers = settingData?.activeSpeakers || {}
    Object.values(activeSpeakers).forEach(speaker => {
        getEffectiveFilters(speaker).forEach(id => {
            if (TEXTURE_GENERATORS[id]) ensureBakedTexture(id)
        })
    })
    document.querySelectorAll("#vn-body .vn-portrait").forEach(portraitElement => {
        const position = portraitElement.closest(".vn-pBody")?.dataset.pos
        if (!position) return
        setFilterIfChanged(portraitElement, buildSpeakerFilterCss(activeSpeakers[position]))
    })
    // "Режим ряда" рисует собственные <img> (main.js _updateRowLayer) - им тоже нужны фильтры их слота.
    // У этих <img> уже есть CSS-тень (#vn-fx-row-layer img в _injectEffectStyles) - inline filter её
    // перебил бы, поэтому при наличии фильтров дописываем ту же тень в конец.
    document.querySelectorAll("#vn-fx-row-layer img[data-pos]").forEach(rowImageElement => {
        const filterCss = buildSpeakerFilterCss(activeSpeakers[rowImageElement.dataset.pos])
        if (filterCss) {
            setFilterIfChanged(rowImageElement, `${filterCss} ${ROW_LAYER_SHADOW}`)
        } else {
            setFilterIfChanged(rowImageElement, "")
        }
    })
}

// ===== Автофильтры по состоянию персонажа =====
// Статусы - id из CONFIG.statusEffects (dnd5e). HP - system.attributes.hp (dnd5e); в системах без этого
// пути (PbtA и т.п.) работают только статусы.
function computeAutoFilters(actor) {
    const statuses = actor.statuses ?? new Set()
    const hasStatus = (...ids) => ids.some(id => statuses.has(id))
    const hp = actor.system?.attributes?.hp
    const isBloodied = hp && hp.max > 0 && hp.value > 0 && hp.value / hp.max < 0.5
    const filters = []
    if (hasStatus("dead", "petrified")) filters.push("grayscale")
    else if (hasStatus("unconscious", "sleeping")) filters.push("darken")
    if (isBloodied || hasStatus("bleeding")) filters.push("blood")
    if (hasStatus("poisoned")) filters.push("poison")
    if (hasStatus("invisible", "ethereal")) filters.push("ghost")
    return normalizePortraitFilters(filters)
}

// Портрет привязан к актёру по id. У несвязанных токенов (типичные NPC) HP и статусы живут на токене,
// а не на актёре из каталога - берём токен этого актёра на текущей сцене, если он есть.
// ponytail: при нескольких несвязанных токенах одного актёра берётся первый; привязка портрета к
// конкретному токену - если понадобится различать одинаковых NPC.
function resolveActor(actorId) {
    const unlinkedToken = canvas?.scene?.tokens?.find(token => token.actorId === actorId && !token.actorLink)
    return unlinkedToken?.actor || game.actors.get(actorId)
}

// Пишет только активный ГМ и только при реальном изменении - собственная запись вызывает updateSetting
// повторно, но второй проход уже ничего не меняет.
async function syncAutoFilters() {
    if (!game.users.activeGM?.isSelf) return
    const isEnabled = game.settings.get(C.ID, "autoPortraitFilters")
    const settings = getSettings()
    let hasChanges = false
    for (const speaker of Object.values(settings.activeSpeakers || {})) {
        if (!speaker) continue
        const actor = isEnabled && speaker.id ? resolveActor(speaker.id) : null
        const autoFilters = actor ? computeAutoFilters(actor) : []
        if (normalizePortraitFilters(speaker.autoFilters).join() === autoFilters.join()) continue
        speaker.autoFilters = autoFilters
        hasChanges = true
    }
    if (hasChanges) await game.settings.set(C.ID, "vnData", settings)
}

export const scheduleAutoFilterSync = foundry.utils.debounce(syncAutoFilters, 150)

for (const hookName of ["updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateToken", "canvasReady"]) {
    Hooks.on(hookName, () => scheduleAutoFilterSync())
}
Hooks.on("updateSetting", (setting) => {
    if (setting.key === `${C.ID}.vnData`) scheduleAutoFilterSync()
})
