// Два режима показа активных персонажей поверх сцены (один слой #vn-fx-row-layer, включён максимум один):
//
// "Режим ряда" (rowMode) - как в 2.4: фон затемняется, персонажи стоят в ряд у нижнего края. Раскладка -
// rowLayout (ROW_LAYOUT_LIMITS): положение, масштаб, отступ.
//
// "Режим окон" (windowMode, в стиле Tales of) - фон притемняется, выезжает горизонтальная полоса с рамкой,
// в ней стоят персонажи. Снизу портреты обрезаются по внутренней границе рамки, сверху свободно выходят за
// неё. Под рамкой - плашка с именем говорящего и репликой, которая печатается по буквам.
// - windowLayout - положение и размеры полосы (WINDOW_LAYOUT_LIMITS);
// - talesStyle - форма полосы, тема рамки и фон полосы (normalizeTalesStyle);
// - talesSpeaker - позиция говорящего (ГМ щёлкает по портрету в полосе), остальные слегка притемнены;
// - talesLine - текущая реплика {pos, name, text, stamp}: из поля в панели "Эффекты" или из чата;
// - у каждого портрета своя настройка спрайта для этого режима - windowSprite {scale, offsetX, offsetY,
//   mirrorX} (окно редактирования в режиме окон правит её, а не настройки обычной VN).
//
// Обе раскладки правятся ползунками в "Настройках эффектов": пока ГМ двигает ползунки, несохранённый
// вариант рассылается по сокету (vnRowPreview) и показывается у всех; "Сохранить" пишет его в vnData.
// Портреты в обоих режимах - <img data-pos>: тряска, вспышки (main.js), фильтры (scripts/portraitFilters.js)
// и облака реакций (scripts/reactions.js) находят их по этому селектору.
import { Constants as C, allowTo, peekSetting, quickSettingsUpdate } from './const.js';

export const ROW_LAYOUT_LIMITS = {
    x: { min: -50, max: 50, step: 1, default: 0 },
    y: { min: 0, max: 60, step: 1, default: 2 },
    scale: { min: 30, max: 200, step: 5, default: 100 },
    gap: { min: -10, max: 10, step: 0.5, default: 1.5 },
}

export const WINDOW_LAYOUT_LIMITS = {
    x: { min: -50, max: 50, step: 1, default: 0 },
    y: { min: 0, max: 50, step: 1, default: 4 },
    bandHeight: { min: 15, max: 60, step: 1, default: 32 },
    bandWidth: { min: 40, max: 100, step: 1, default: 80 },
    gap: { min: -10, max: 10, step: 0.5, default: 0.5 },
    dim: { min: 0, max: 100, step: 5, default: 55 },
    // Прозрачность внутреннего фона полосы (цвета или картинки): 0 - непрозрачный, 100 - фона не видно
    bgTransparency: { min: 0, max: 100, step: 5, default: 0 },
}

// Раскладки двух режимов: ключ в vnData и пределы ползунков
export const LAYOUTS = {
    row: { key: "rowLayout", limits: ROW_LAYOUT_LIMITS },
    window: { key: "windowLayout", limits: WINDOW_LAYOUT_LIMITS },
}

export function normalizeLayout(target, layout) {
    return Object.fromEntries(Object.entries(LAYOUTS[target].limits).map(([key, limit]) => {
        const value = Number(layout?.[key])
        return [key, Number.isFinite(value) ? Math.min(limit.max, Math.max(limit.min, value)) : limit.default]
    }))
}

// Данные 2.5.x: там "режим ряда" был полосой (раскладка с bandHeight) - теперь это режим окон.
// Возвращает {windowMode, rowMode: false, windowLayout} для такого состояния сцены или слепка, иначе null.
export function getLegacyWindowState(scene) {
    if (!scene?.rowLayout || typeof scene.rowLayout !== "object" || !("bandHeight" in scene.rowLayout)) return null
    return { windowMode: !!scene.rowMode, rowMode: false, windowLayout: normalizeLayout("window", scene.rowLayout) }
}

// Спрайт портрета в режиме окон: высота - 130% внутренней высоты полосы, умноженные на scale;
// смещение в px (offsetY - вверх), отражение по горизонтали
export const WINDOW_SPRITE_LIMITS = { scale: { min: 0, max: 200, default: 100 } }
export function normalizeWindowSprite(sprite) {
    const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback
    return {
        scale: Math.min(WINDOW_SPRITE_LIMITS.scale.max, Math.max(WINDOW_SPRITE_LIMITS.scale.min, number(sprite?.scale, 100))),
        offsetX: number(sprite?.offsetX, 0),
        offsetY: number(sprite?.offsetY, 0),
        mirrorX: !!sprite?.mirrorX,
    }
}

// Готовые темы рамки - основной цвет; светлая кромка и цвет имени получаются из него (color-mix в CSS)
export const FRAME_THEMES = { gold: "#c9a24a", silver: "#a7b0ba", crimson: "#9b2430", dark: "#3a3a46" }

// Формы полосы. Нижний край у всех горизонтальный - по нему обрезаются портреты. points - многоугольник
// фона в процентах (clip-path), framePath - линии рамки в той же системе координат 0..100 (SVG).
// "Стёртые края" - прямоугольник, растворяющийся слева и справа (mask), рамка - только сверху и снизу.
export const STRIP_SHAPES = {
    rectangle: { points: [[0, 0], [100, 0], [100, 100], [0, 100]] },
    parallelogram: { points: [[5, 0], [100, 0], [95, 100], [0, 100]] },
    slanted: { points: [[0, 14], [100, 0], [100, 100], [0, 100]] },
    faded: { points: [[0, 0], [100, 0], [100, 100], [0, 100]], framePath: "M0,0 H100 M0,100 H100", fadeEdges: true },
}
const getShapeFramePath = (shape) => shape.framePath || `M${shape.points.map(([x, y]) => `${x},${y}`).join(" L")} Z`

const DEFAULT_TALES_STYLE = { shape: "rectangle", theme: "gold", customColor: "#4a7fc9", bgColor: "#1c1f2b", bgImage: "" }
const isHexColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)

export function normalizeTalesStyle(style) {
    return {
        shape: style?.shape in STRIP_SHAPES ? style.shape : DEFAULT_TALES_STYLE.shape,
        theme: (style?.theme in FRAME_THEMES || style?.theme === "custom") ? style.theme : DEFAULT_TALES_STYLE.theme,
        customColor: isHexColor(style?.customColor) ? style.customColor : DEFAULT_TALES_STYLE.customColor,
        bgColor: isHexColor(style?.bgColor) ? style.bgColor : DEFAULT_TALES_STYLE.bgColor,
        bgImage: typeof style?.bgImage === "string" ? style.bgImage : "",
    }
}

export const getFrameColor = (style) => style.theme === "custom" ? style.customColor : FRAME_THEMES[style.theme]

// ===== Раскладки: сохранённые и превью =====
const layoutPreviews = { row: null, window: null }
const storedLayoutKeys = { row: null, window: null }

function applyRowLayoutVars(rowElement, layout) {
    const { x, y, scale, gap } = normalizeLayout("row", layout)
    rowElement.style.setProperty("--vn-row-x", x)
    rowElement.style.setProperty("--vn-row-y", y)
    rowElement.style.setProperty("--vn-row-scale", scale / 100)
    rowElement.style.setProperty("--vn-row-gap", gap)
}

function applyWindowLayoutVars(rowElement, layout) {
    const { x, y, bandHeight, bandWidth, gap, dim, bgTransparency } = normalizeLayout("window", layout)
    rowElement.style.setProperty("--vn-win-x", x)
    rowElement.style.setProperty("--vn-win-y", y)
    rowElement.style.setProperty("--vn-win-band-h", bandHeight)
    rowElement.style.setProperty("--vn-win-band-w", bandWidth)
    rowElement.style.setProperty("--vn-win-gap", gap)
    rowElement.style.setProperty("--vn-win-bg-opacity", 1 - bgTransparency / 100)
    // Затемнение - на слое затемнения фона (#vn-fx-darken-layer, styles/module.css #vn-body.vn-window-mode)
    document.getElementById("vn-body")?.style.setProperty("--vn-win-dim", dim / 100)
}

function applyLayoutVars(rowElement, settingData) {
    if (!rowElement) return
    applyRowLayoutVars(rowElement, layoutPreviews.row || settingData.rowLayout)
    applyWindowLayoutVars(rowElement, layoutPreviews.window || settingData.windowLayout)
}

// Показ превью, пришедшего по сокету (или своего); null - вернуться к сохранённой раскладке
export function showLayoutPreview(target, layout) {
    if (!LAYOUTS[target]) return
    layoutPreviews[target] = layout ? normalizeLayout(target, layout) : null
    const rowElement = document.getElementById("vn-fx-row-layer")
    if (rowElement) applyLayoutVars(rowElement, { rowLayout: peekSetting("rowLayout"), windowLayout: peekSetting("windowLayout") })
}

// layout - несохранённая раскладка, null - вернуться к сохранённой. Без записи в настройки мира.
export function previewLayout(target, layout) {
    showLayoutPreview(target, layout)
    game.socket.emit(`module.${C.ID}`, { type: 'vnRowPreview', data: { target, layout: layoutPreviews[target] } })
}

// Любое изменение сохранённой раскладки (сохранение, выбор пресета локации) снимает её превью у всех
export function syncStoredLayouts(settingData) {
    for (const [target, { key }] of Object.entries(LAYOUTS)) {
        const storedKey = JSON.stringify(normalizeLayout(target, settingData[key]))
        if (storedLayoutKeys[target] !== null && storedKey !== storedLayoutKeys[target]) layoutPreviews[target] = null
        storedLayoutKeys[target] = storedKey
    }
}

// ===== Состояние сцены =====
// Оба режима прячут шапку и слайдеры (main.js partsClassData), верхние круглые кнопки остаются - выйти из
// режима можно и с закрытой панелью "Эффекты". Включённым может быть только один режим.
// Режим ряда (как в 2.4) затемняет фон полностью ("Затемнение фона") и снимает его при выключении.
export async function setRowMode(isEnabled) {
    await quickSettingsUpdate(
        isEnabled ? { rowMode: true, windowMode: false, darkenBack: true } : { rowMode: false, darkenBack: false },
        // editWindow - окно редактирования переключается между настройками спрайтов обычной VN и режима окон
        { renderData: { renderParts: ["headerSlider", "leftSlider", "rightSlider", "editWindow"] } }
    )
}

// Режим окон притемняет фон своей настройкой dim; полное "Затемнение фона" режима ряда при переходе снимается
export async function setWindowMode(isEnabled) {
    await quickSettingsUpdate(
        isEnabled ? { windowMode: true, rowMode: false, darkenBack: false } : { windowMode: false },
        { renderData: { renderParts: ["headerSlider", "leftSlider", "rightSlider", "editWindow"] } }
    )
}

export async function setTalesStyle(patch) {
    await quickSettingsUpdate({ talesStyle: normalizeTalesStyle({ ...normalizeTalesStyle(peekSetting("talesStyle")), ...patch }) })
}

// Повторный щелчок по говорящему снимает выбор
export async function toggleTalesSpeaker(position) {
    await quickSettingsUpdate({ talesSpeaker: peekSetting("talesSpeaker") === position ? null : position })
}

const MAX_LINE_LENGTH = 1000

export async function sayTalesLine(text) {
    const lineText = String(text || "").trim().slice(0, MAX_LINE_LENGTH)
    if (!lineText) return
    const position = peekSetting("talesSpeaker")
    const name = (position && peekSetting("activeSpeakers")?.[position]?.name) || ""
    await quickSettingsUpdate({ talesLine: { pos: position || null, name, text: lineText, stamp: Date.now() } })
}

export async function clearTalesLine() {
    await quickSettingsUpdate({ talesLine: null })
}

// ===== Отрисовка =====
const getActiveEntries = (settingData) => ["left", "right"].flatMap(side =>
    (settingData.activeSlots?.[side] || [])
        .map(pos => ({ pos, speaker: settingData.activeSpeakers?.[pos] }))
        .filter(entry => entry.speaker)
)

const getImagesKey = (images) => Array.from(images).map(img => `${img.dataset.pos}:${img.dataset.src}`).join("|")
const getEntriesKey = (entries) => entries.map(entry => `${entry.pos}:${entry.speaker.img}`).join("|")

function createImage(entry) {
    const img = document.createElement("img")
    img.src = entry.speaker.img
    img.dataset.src = entry.speaker.img
    // data-pos - чтобы applyPortraitFilters (scripts/portraitFilters.js) мог наложить фильтры слота
    img.dataset.pos = entry.pos
    return img
}

// Режим ряда (2.4): картинки - прямые дети слоя
function updatePlainRow(rowElement, entries) {
    if (rowElement.querySelector(":scope > .vn-tales-stage")) rowElement.replaceChildren()
    if (getImagesKey(rowElement.querySelectorAll(":scope > img")) === getEntriesKey(entries)) return
    rowElement.replaceChildren(...entries.map(createImage))
}

function ensureStage(rowElement) {
    let stageElement = rowElement.querySelector(":scope > .vn-tales-stage")
    if (stageElement) return stageElement
    stageElement = document.createElement("div")
    stageElement.className = "vn-tales-stage"
    stageElement.innerHTML = `
        <div class="vn-tales-band">
            <div class="vn-tales-band-bg"></div>
            <svg class="vn-tales-frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path class="vn-tales-frame-outer"/><path class="vn-tales-frame-inner"/>
            </svg>
            <div class="vn-tales-actors"></div>
        </div>
        <div class="vn-tales-dialogue"><div class="vn-tales-name"></div><div class="vn-tales-text"></div></div>`
    rowElement.replaceChildren(stageElement)
    // Выбор говорящего - щелчок по портрету в полосе (только с правом окна редактирования, по умолчанию ГМ)
    stageElement.querySelector(".vn-tales-actors").addEventListener("click", (event) => {
        const actorElement = event.target.closest(".vn-tales-actor")
        if (!actorElement || !allowTo("editWindow")) return
        toggleTalesSpeaker(actorElement.dataset.pos)
    })
    return stageElement
}

function syncActors(actorsElement, entries) {
    if (getImagesKey(actorsElement.querySelectorAll("img")) === getEntriesKey(entries)) return
    actorsElement.replaceChildren(...entries.map(entry => {
        const actorElement = document.createElement("div")
        actorElement.className = "vn-tales-actor"
        actorElement.dataset.pos = entry.pos
        actorElement.appendChild(createImage(entry))
        return actorElement
    }))
}

// Спрайт режима окон - на обёртке .vn-tales-actor (а не на <img>): тряска и вспышка анимируют transform
// и filter самой картинки и иначе стирали бы смещение и отражение на время анимации
export function applyWindowSprite(actorElement, sprite) {
    if (!actorElement) return
    const { scale, offsetX, offsetY, mirrorX } = normalizeWindowSprite(sprite)
    actorElement.style.height = `${1.3 * scale}%`
    actorElement.style.transform = `translate(${offsetX}px, ${-offsetY}px)${mirrorX ? " scaleX(-1)" : ""}`
}

// Узел портрета в полосе - для живого превью из окна редактирования (main.js)
export const getWindowActorElement = (position) =>
    document.querySelector(`#vn-fx-row-layer .vn-tales-actor[data-pos="${CSS.escape(position || "")}"]`)

function applyStyle(rowElement, stageElement, style) {
    rowElement.style.setProperty("--vn-tales-frame", getFrameColor(style))
    const shape = STRIP_SHAPES[style.shape]
    const bandElement = stageElement.querySelector(".vn-tales-band")
    bandElement.dataset.shape = style.shape
    bandElement.classList.toggle("vn-tales-fade-edges", !!shape.fadeEdges)
    const framePath = getShapeFramePath(shape)
    stageElement.querySelectorAll(".vn-tales-frame path").forEach(pathElement => pathElement.setAttribute("d", framePath))
    const backgroundElement = stageElement.querySelector(".vn-tales-band-bg")
    backgroundElement.style.clipPath = `polygon(${shape.points.map(([x, y]) => `${x}% ${y}%`).join(", ")})`
    backgroundElement.style.backgroundColor = style.bgColor
    // JSON.stringify - путь в кавычках с экранированием, чтобы он не вышел за пределы url(...)
    backgroundElement.style.backgroundImage = style.bgImage ? `url(${JSON.stringify(style.bgImage)})` : ""
}

// Реплика печатается по буквам (темп - настройка narrativeTypeSpeed, символов/сек, как у "Нарратива");
// с уменьшением движения - сразу целиком. Новая реплика прерывает печать предыдущей.
function showLine(dialogueElement, line) {
    const stamp = line?.stamp ? String(line.stamp) : ""
    if (dialogueElement.dataset.stamp === stamp) return
    dialogueElement.dataset.stamp = stamp
    clearTimeout(dialogueElement._typingTimer)
    const nameElement = dialogueElement.querySelector(".vn-tales-name")
    const textElement = dialogueElement.querySelector(".vn-tales-text")
    dialogueElement.classList.toggle("vn-tales-has-line", !!line?.text)
    nameElement.textContent = line?.name || ""
    nameElement.hidden = !line?.name
    const text = String(line?.text || "")
    const charsPerSecond = Number(game.settings.get(C.ID, "narrativeTypeSpeed")) || 20
    if (!text || document.body.classList.contains("vn-reduced-motion")) {
        textElement.textContent = text
        return
    }
    let shownCount = 0
    const tick = () => {
        shownCount++
        textElement.textContent = text.slice(0, shownCount)
        if (shownCount < text.length) dialogueElement._typingTimer = setTimeout(tick, 1000 / charsPerSecond)
    }
    tick()
}

function updateWindowStage(rowElement, settingData, entries) {
    const stageElement = ensureStage(rowElement)
    const actorsElement = stageElement.querySelector(".vn-tales-actors")
    syncActors(actorsElement, entries)
    const speakerPosition = entries.some(entry => entry.pos === settingData.talesSpeaker) ? settingData.talesSpeaker : null
    actorsElement.classList.toggle("vn-tales-has-speaker", !!speakerPosition)
    actorsElement.querySelectorAll(".vn-tales-actor").forEach(actorElement => {
        actorElement.classList.toggle("vn-tales-speaking", actorElement.dataset.pos === speakerPosition)
        applyWindowSprite(actorElement, settingData.activeSpeakers?.[actorElement.dataset.pos]?.windowSprite)
    })
    rowElement.classList.toggle("vn-tales-clickable", allowTo("editWindow"))
    applyStyle(rowElement, stageElement, normalizeTalesStyle(settingData.talesStyle))
    showLine(stageElement.querySelector(".vn-tales-dialogue"), settingData.talesLine)
}

// Вызывается из main.js на каждом рендере окна VN и на каждом обновлении vnData
export function updateRowLayer(rowElement, settingData) {
    if (!rowElement) return
    const isWindowMode = !!settingData.windowMode
    const isRowMode = !isWindowMode && !!settingData.rowMode
    rowElement.classList.toggle("vn-fx-active", isWindowMode || isRowMode)
    rowElement.classList.toggle("vn-row-window", isWindowMode)
    rowElement.classList.toggle("vn-row-plain", isRowMode)
    applyLayoutVars(rowElement, settingData)
    if (!isWindowMode && !isRowMode) {
        if (rowElement.childElementCount) rowElement.replaceChildren()
        return
    }
    const entries = getActiveEntries(settingData)
    if (isWindowMode) updateWindowStage(rowElement, settingData, entries)
    else updatePlainRow(rowElement, entries)
}

// ===== Реплики из чата (режим окон) =====
// Сообщение от лица персонажа, который стоит в полосе, становится репликой. Пишет только активный ГМ
// (у остальных клиентов то же событие игнорируется), шёпот и броски пропускаются.
function getChatLineText(content) {
    // DOMParser - документ "инертный": скрипты не выполняются, картинки не грузятся
    return new DOMParser().parseFromString(String(content || ""), "text/html").body.textContent.replace(/\s+\n/g, "\n").trim()
}

Hooks.on("createChatMessage", (message) => {
    if (!game.users.activeGM?.isSelf) return
    if (!game.settings.get(C.ID, "talesChatLines") || !peekSetting("windowMode")) return
    const chatStyles = CONST.CHAT_MESSAGE_STYLES || {}
    if (message.isRoll || message.whisper?.length || ![chatStyles.IC, chatStyles.EMOTE].includes(message.style)) return
    const actorId = message.speaker?.actor
    if (!actorId) return
    const activeSpeakers = peekSetting("activeSpeakers") || {}
    const entry = getActiveEntries({ activeSlots: peekSetting("activeSlots"), activeSpeakers }).find(item => item.speaker.id === actorId)
    if (!entry) return
    const text = getChatLineText(message.content).slice(0, MAX_LINE_LENGTH)
    if (!text) return
    quickSettingsUpdate({
        talesSpeaker: entry.pos,
        talesLine: { pos: entry.pos, name: entry.speaker.name || message.alias || "", text, stamp: Date.now() },
    })
})
