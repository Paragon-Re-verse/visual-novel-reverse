// Раскладки режима ряда и режима окон (scripts/rowStage.js) в меню "Настройки эффектов" -> категории "Режим
// ряда" и "Режим окон" (apps/visualSettingsMenu.js, templates/visualSettingsMenu.hbs). Это состояние сцены
// (vnData), а не game.settings, поэтому у блока свои кнопки:
// - ползунки раскладки сразу показывают результат всем (превью по сокету), "Сохранить" пишет раскладку,
//   "Отменить" возвращает сохранённое, "По умолчанию" ставит значения по умолчанию (до сохранения);
// - в режиме окон форма полосы, тема рамки и фон применяются сразу.
// target - "row" или "window" (LAYOUTS в rowStage.js).
import { Constants as C, peekSetting, quickSettingsUpdate } from '../scripts/const.js';
import { LAYOUTS, normalizeLayout, previewLayout, FRAME_THEMES, STRIP_SHAPES, normalizeTalesStyle, setTalesStyle } from '../scripts/rowStage.js';

const PREVIEW_INTERVAL_MS = 60

const FIELD_LABELS = {
    x: "rowLayoutX", y: "rowLayoutY", bandHeight: "rowLayoutBandHeight", bandWidth: "rowLayoutBandWidth",
    scale: "rowLayoutScale", gap: "rowLayoutGap", dim: "rowLayoutDim", bgTransparency: "rowLayoutBgTransparency",
}
const LAYOUT_TITLES = { row: "rowLayoutRowTitle", window: "rowLayoutTitle" }

const capitalize = (text) => text[0].toUpperCase() + text.slice(1)

// Данные для шаблона; у режима ряда - только ползунки (style и прочее - для режима окон)
export function getRowControlsData(target, settingData) {
    const { key: layoutKey, limits } = LAYOUTS[target]
    const layout = normalizeLayout(target, settingData[layoutKey])
    const fields = Object.entries(limits).map(([key, limit]) => ({
        key, ...limit, value: layout[key],
        label: game.i18n.localize(`${C.ID}.effectsPanel.${FIELD_LABELS[key]}`),
    }))
    const title = game.i18n.localize(`${C.ID}.effectsPanel.${LAYOUT_TITLES[target]}`)
    if (target !== "window") return { target, title, fields }
    return {
        target, title, fields,
        // Значок формы - тот же многоугольник в рамке 100x40
        shapes: Object.entries(STRIP_SHAPES).map(([id, shape]) => ({
            id, fadeEdges: !!shape.fadeEdges,
            iconPoints: shape.points.map(([x, y]) => `${x},${4 + y * 0.32}`).join(" "),
            label: game.i18n.localize(`${C.ID}.effectsPanel.talesShape${capitalize(id)}`),
        })),
        themes: Object.entries(FRAME_THEMES).map(([id, color]) => ({
            id, color, label: game.i18n.localize(`${C.ID}.effectsPanel.talesTheme${capitalize(id)}`),
        })),
        style: normalizeTalesStyle(settingData.talesStyle),
    }
}

export class RowStyleControls {
    // Несохранённая раскладка - null, пока ползунки не трогали
    draft = null
    #previewTimer = null
    #hookId = null

    constructor(rootElement) {
        this.root = rootElement
        this.target = rootElement.dataset.target in LAYOUTS ? rootElement.dataset.target : "window"
        this.layoutKey = LAYOUTS[this.target].key
        this.#activateListeners()
        // Раскладку и стиль меняют и другие места: пресет локации со слепком, другой ГМ
        this.#hookId = Hooks.on("updateSetting", (setting) => {
            if (setting.key === `${C.ID}.vnData`) this.sync()
        })
        this.sync()
    }

    get hasDraft() {
        return !!this.draft
    }

    #getSliders() {
        return Array.from(this.root.querySelectorAll('input[type="range"][data-row-key]'))
    }

    #setSliders(layout) {
        const normalizedLayout = normalizeLayout(this.target, layout)
        this.#getSliders().forEach(inputElement => {
            inputElement.value = normalizedLayout[inputElement.dataset.rowKey]
            inputElement.nextElementSibling.textContent = inputElement.value
        })
    }

    // Превью уходит всем не чаще раза в PREVIEW_INTERVAL_MS, последнее положение ползунка - всегда
    #schedulePreview() {
        this.root.querySelector('.vn-row-save')?.classList.add('vn-row-dirty')
        if (this.#previewTimer) return
        this.#previewTimer = setTimeout(() => {
            this.#previewTimer = null
            if (this.draft) previewLayout(this.target, this.draft)
        }, PREVIEW_INTERVAL_MS)
    }

    #clearDraft() {
        clearTimeout(this.#previewTimer)
        this.#previewTimer = null
        this.draft = null
    }

    async saveDraft() {
        if (!this.draft) return
        const layout = normalizeLayout(this.target, this.draft)
        this.#clearDraft()
        // Превью снимается у всех само, когда приходит новая сохранённая раскладка (rowStage.js syncStoredLayouts)
        await quickSettingsUpdate({ [this.layoutKey]: layout })
        this.sync()
    }

    cancelDraft() {
        if (!this.draft) return
        this.#clearDraft()
        previewLayout(this.target, null)
        this.sync()
    }

    sync() {
        if (!this.root.isConnected) return
        if (!this.draft) this.#setSliders(peekSetting(this.layoutKey))
        this.root.querySelector('.vn-row-save')?.classList.toggle('vn-row-dirty', !!this.draft)
        const style = normalizeTalesStyle(peekSetting("talesStyle"))
        this.root.querySelectorAll('[data-shape]').forEach(element => {
            element.classList.toggle('vn-row-active', element.dataset.shape === style.shape)
        })
        this.root.querySelectorAll('[data-theme]').forEach(element => {
            element.classList.toggle('vn-row-active', element.dataset.theme === style.theme)
        })
        const setColorInput = (selector, value) => {
            const inputElement = this.root.querySelector(selector)
            if (inputElement && document.activeElement !== inputElement) inputElement.value = value
        }
        setColorInput('.vn-row-custom-color', style.customColor)
        setColorInput('.vn-row-bg-color', style.bgColor)
        const clearImageButton = this.root.querySelector('.vn-row-bg-clear')
        if (clearImageButton) clearImageButton.disabled = !style.bgImage
    }

    // Окно закрыто или перерисовано: несохранённые ползунки откатываются, подписка снимается
    dispose() {
        this.cancelDraft()
        Hooks.off("updateSetting", this.#hookId)
    }

    #activateListeners() {
        this.root.addEventListener('input', (event) => {
            if (!event.target.matches('input[type="range"][data-row-key]')) return
            event.target.nextElementSibling.textContent = event.target.value
            this.draft = Object.fromEntries(this.#getSliders().map(inputElement => [inputElement.dataset.rowKey, Number(inputElement.value)]))
            this.#schedulePreview()
        })
        this.root.querySelector('.vn-row-save')?.addEventListener('click', () => this.saveDraft())
        this.root.querySelector('.vn-row-cancel')?.addEventListener('click', () => this.cancelDraft())
        this.root.querySelector('.vn-row-default')?.addEventListener('click', () => {
            this.draft = normalizeLayout(this.target, null)
            this.#setSliders(this.draft)
            this.#schedulePreview()
        })

        this.root.querySelectorAll('button[data-shape]').forEach(buttonElement => {
            buttonElement.addEventListener('click', () => setTalesStyle({ shape: buttonElement.dataset.shape }))
        })
        this.root.querySelectorAll('button[data-theme]').forEach(buttonElement => {
            buttonElement.addEventListener('click', () => setTalesStyle({ theme: buttonElement.dataset.theme }))
        })
        // Щелчок по "Свой цвет" сразу включает эту тему, выбор цвета - меняет её цвет
        const customColorElement = this.root.querySelector('.vn-row-custom-color')
        customColorElement?.addEventListener('click', () => {
            if (normalizeTalesStyle(peekSetting("talesStyle")).theme !== "custom") setTalesStyle({ theme: "custom" })
        })
        customColorElement?.addEventListener('change', (event) => {
            setTalesStyle({ theme: "custom", customColor: event.currentTarget.value })
        })
        this.root.querySelector('.vn-row-bg-color')?.addEventListener('change', (event) => {
            setTalesStyle({ bgColor: event.currentTarget.value })
        })
        this.root.querySelector('.vn-row-bg-image')?.addEventListener('click', () => {
            const FilePickerClass = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker
            new FilePickerClass({
                type: "image",
                current: normalizeTalesStyle(peekSetting("talesStyle")).bgImage,
                callback: (path) => setTalesStyle({ bgImage: path }),
            }).render(true)
        })
        this.root.querySelector('.vn-row-bg-clear')?.addEventListener('click', () => setTalesStyle({ bgImage: "" }))
    }
}
