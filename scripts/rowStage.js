// Режим ряда в стиле Tales of: фон притемняется, выезжает горизонтальная полоса с рамкой, в ней стоят
// активные персонажи. Снизу портреты обрезаются по внутренней границе рамки, сверху свободно выходят за неё.
// Под рамкой - тёмная плашка с именем говорящего и репликой, которая печатается по буквам.
//
// Состояние сцены (vnData, общее для всех):
// - rowMode - режим включён (переключатель в панели "Эффекты");
// - rowLayout - положение и размеры (ползунки, ROW_LAYOUT_LIMITS). Пока ГМ двигает ползунки, несохранённый
//   вариант рассылается по сокету (vnRowPreview) и показывается у всех; "Сохранить" пишет rowLayout;
// - talesStyle - тема рамки и фон полосы (normalizeTalesStyle);
// - talesSpeaker - позиция говорящего (ГМ щёлкает по портрету в полосе), остальные слегка притемнены;
// - talesLine - текущая реплика {pos, name, text, stamp}: из поля в панели "Эффекты" или из чата
//   (сообщение от лица персонажа в полосе, настройка talesChatLines).
// Портреты в полосе - <img data-pos>, как и раньше в режиме ряда: тряска, вспышки (main.js), фильтры
// (scripts/portraitFilters.js) и облака реакций (scripts/reactions.js) находят их по этому селектору.
import { Constants as C, allowTo, peekSetting, quickSettingsUpdate } from './const.js';

export const ROW_LAYOUT_LIMITS = {
    x: { min: -50, max: 50, step: 1, default: 0 },
    y: { min: 0, max: 50, step: 1, default: 4 },
    bandHeight: { min: 15, max: 60, step: 1, default: 32 },
    bandWidth: { min: 40, max: 100, step: 1, default: 80 },
    scale: { min: 60, max: 250, step: 5, default: 130 },
    gap: { min: -10, max: 10, step: 0.5, default: 0.5 },
    dim: { min: 0, max: 100, step: 5, default: 55 },
}

export function normalizeRowLayout(layout) {
    return Object.fromEntries(Object.entries(ROW_LAYOUT_LIMITS).map(([key, limit]) => {
        const value = Number(layout?.[key])
        return [key, Number.isFinite(value) ? Math.min(limit.max, Math.max(limit.min, value)) : limit.default]
    }))
}

// Готовые темы рамки - основной цвет; светлая кромка и цвет имени получаются из него (color-mix в CSS)
export const FRAME_THEMES = { gold: "#c9a24a", silver: "#a7b0ba", crimson: "#9b2430", dark: "#3a3a46" }
const DEFAULT_TALES_STYLE = { theme: "gold", customColor: "#4a7fc9", bgColor: "#1c1f2b", bgImage: "" }
const isHexColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)

export function normalizeTalesStyle(style) {
    return {
        theme: (style?.theme in FRAME_THEMES || style?.theme === "custom") ? style.theme : DEFAULT_TALES_STYLE.theme,
        customColor: isHexColor(style?.customColor) ? style.customColor : DEFAULT_TALES_STYLE.customColor,
        bgColor: isHexColor(style?.bgColor) ? style.bgColor : DEFAULT_TALES_STYLE.bgColor,
        bgImage: typeof style?.bgImage === "string" ? style.bgImage : "",
    }
}

export const getFrameColor = (style) => style.theme === "custom" ? style.customColor : FRAME_THEMES[style.theme]

// ===== Раскладка: сохранённая и превью =====
let rowLayoutPreview = null
let storedRowLayoutKey = null

function applyLayoutVars(rowElement, layout) {
    if (!rowElement) return
    const { x, y, bandHeight, bandWidth, scale, gap, dim } = normalizeRowLayout(layout)
    rowElement.style.setProperty("--vn-row-x", x)
    rowElement.style.setProperty("--vn-row-y", y)
    rowElement.style.setProperty("--vn-row-band-h", bandHeight)
    rowElement.style.setProperty("--vn-row-band-w", bandWidth)
    rowElement.style.setProperty("--vn-row-scale", scale / 100)
    rowElement.style.setProperty("--vn-row-gap", gap)
    // Затемнение - на слое затемнения фона (#vn-fx-darken-layer, styles/module.css #vn-body.vn-row-mode)
    document.getElementById("vn-body")?.style.setProperty("--vn-row-dim", dim / 100)
}

// Показ превью, пришедшего по сокету (или своего); null - вернуться к сохранённой раскладке
export function showRowLayoutPreview(layout) {
    rowLayoutPreview = layout ? normalizeRowLayout(layout) : null
    applyLayoutVars(document.getElementById("vn-fx-row-layer"), rowLayoutPreview || peekSetting("rowLayout"))
}

// layout - несохранённая раскладка, null - вернуться к сохранённой. Без записи в настройки мира.
export function previewRowLayout(layout) {
    showRowLayoutPreview(layout)
    game.socket.emit(`module.${C.ID}`, { type: 'vnRowPreview', data: { layout: rowLayoutPreview } })
}

// Любое изменение сохранённой раскладки (сохранение, выбор пресета локации) снимает превью у всех
export function syncStoredRowLayout(settingData) {
    const storedKey = JSON.stringify(normalizeRowLayout(settingData.rowLayout))
    if (storedRowLayoutKey !== null && storedKey !== storedRowLayoutKey) rowLayoutPreview = null
    storedRowLayoutKey = storedKey
}

// ===== Состояние сцены =====
// Режим ряда прячет шапку и слайдеры (main.js partsClassData), верхние круглые кнопки остаются - выйти из
// режима можно и с закрытой панелью "Эффекты". Фон притемняется настройкой dim, а не "Затемнением фона";
// при выключении "Затемнение фона" тоже снимается - в 2.4 режим ряда включал его вместе с собой.
export async function setRowMode(isEnabled) {
    await quickSettingsUpdate(
        isEnabled ? { rowMode: true } : { rowMode: false, darkenBack: false },
        { renderData: { renderParts: ["headerSlider", "leftSlider", "rightSlider"] } }
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

function ensureStage(rowElement) {
    let stageElement = rowElement.querySelector(":scope > .vn-tales-stage")
    if (stageElement) return stageElement
    stageElement = document.createElement("div")
    stageElement.className = "vn-tales-stage"
    stageElement.innerHTML = `
        <div class="vn-tales-band">
            <div class="vn-tales-band-bg"></div>
            <div class="vn-tales-frame"></div>
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
    const existingKey = Array.from(actorsElement.querySelectorAll("img")).map(img => `${img.dataset.pos}:${img.dataset.src}`).join("|")
    const wantedKey = entries.map(entry => `${entry.pos}:${entry.speaker.img}`).join("|")
    if (existingKey === wantedKey) return
    actorsElement.replaceChildren(...entries.map(entry => {
        const actorElement = document.createElement("div")
        actorElement.className = "vn-tales-actor"
        actorElement.dataset.pos = entry.pos
        const img = document.createElement("img")
        img.src = entry.speaker.img
        img.dataset.src = entry.speaker.img
        // data-pos - чтобы applyPortraitFilters (scripts/portraitFilters.js) мог наложить фильтры слота
        img.dataset.pos = entry.pos
        actorElement.appendChild(img)
        return actorElement
    }))
}

function applyStyle(rowElement, stageElement, style) {
    rowElement.style.setProperty("--vn-tales-frame", getFrameColor(style))
    const backgroundElement = stageElement.querySelector(".vn-tales-band-bg")
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

// Вызывается из main.js на каждом рендере окна VN и на каждом обновлении vnData
export function updateRowLayer(rowElement, settingData) {
    if (!rowElement) return
    const isActive = !!settingData.rowMode
    rowElement.classList.toggle("vn-fx-active", isActive)
    applyLayoutVars(rowElement, rowLayoutPreview || settingData.rowLayout)
    if (!isActive) {
        if (rowElement.childElementCount) rowElement.replaceChildren()
        return
    }
    const stageElement = ensureStage(rowElement)
    const entries = getActiveEntries(settingData)
    const actorsElement = stageElement.querySelector(".vn-tales-actors")
    syncActors(actorsElement, entries)
    const speakerPosition = entries.some(entry => entry.pos === settingData.talesSpeaker) ? settingData.talesSpeaker : null
    actorsElement.classList.toggle("vn-tales-has-speaker", !!speakerPosition)
    actorsElement.querySelectorAll(".vn-tales-actor").forEach(actorElement => {
        actorElement.classList.toggle("vn-tales-speaking", actorElement.dataset.pos === speakerPosition)
    })
    rowElement.classList.toggle("vn-tales-clickable", allowTo("editWindow"))
    applyStyle(rowElement, stageElement, normalizeTalesStyle(settingData.talesStyle))
    showLine(stageElement.querySelector(".vn-tales-dialogue"), settingData.talesLine)
}

// ===== Реплики из чата =====
// Сообщение от лица персонажа, который стоит в полосе, становится репликой. Пишет только активный ГМ
// (у остальных клиентов то же событие игнорируется), шёпот и броски пропускаются.
function getChatLineText(content) {
    // DOMParser - документ "инертный": скрипты не выполняются, картинки не грузятся
    return new DOMParser().parseFromString(String(content || ""), "text/html").body.textContent.replace(/\s+\n/g, "\n").trim()
}

Hooks.on("createChatMessage", (message) => {
    if (!game.users.activeGM?.isSelf) return
    if (!game.settings.get(C.ID, "talesChatLines") || !peekSetting("rowMode")) return
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
