// Настройки полосы режима ряда (scripts/rowStage.js) в меню "Настройки эффектов" -> категория "Режим ряда"
// (apps/visualSettingsMenu.js, templates/visualSettingsMenu.hbs). Это состояние сцены (vnData), а не
// game.settings, поэтому у блока свои кнопки:
// - ползунки раскладки сразу показывают результат всем (превью по сокету), "Сохранить" пишет rowLayout,
//   "Отменить" возвращает сохранённое, "По умолчанию" ставит значения по умолчанию (до сохранения);
// - форма полосы, тема рамки и фон применяются сразу.
import { Constants as C, peekSetting, quickSettingsUpdate } from '../scripts/const.js';
import { ROW_LAYOUT_LIMITS, normalizeRowLayout, previewRowLayout, FRAME_THEMES, STRIP_SHAPES, normalizeTalesStyle, setTalesStyle } from '../scripts/rowStage.js';

const PREVIEW_INTERVAL_MS = 60

const FIELD_LABELS = {
    x: "rowLayoutX", y: "rowLayoutY", bandHeight: "rowLayoutBandHeight", bandWidth: "rowLayoutBandWidth",
    scale: "rowLayoutScale", gap: "rowLayoutGap", dim: "rowLayoutDim", bgTransparency: "rowLayoutBgTransparency",
}

const capitalize = (text) => text[0].toUpperCase() + text.slice(1)

// Данные для шаблона
export function getRowControlsData(settingData) {
    const layout = normalizeRowLayout(settingData.rowLayout)
    return {
        fields: Object.entries(ROW_LAYOUT_LIMITS).map(([key, limit]) => ({
            key, ...limit, value: layout[key],
            label: game.i18n.localize(`${C.ID}.effectsPanel.${FIELD_LABELS[key]}`),
        })),
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
        const normalizedLayout = normalizeRowLayout(layout)
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
            if (this.draft) previewRowLayout(this.draft)
        }, PREVIEW_INTERVAL_MS)
    }

    #clearDraft() {
        clearTimeout(this.#previewTimer)
        this.#previewTimer = null
        this.draft = null
    }

    async saveDraft() {
        if (!this.draft) return
        const rowLayout = normalizeRowLayout(this.draft)
        this.#clearDraft()
        // Превью снимается у всех само, когда приходит новая сохранённая раскладка (rowStage.js syncStoredRowLayout)
        await quickSettingsUpdate({ rowLayout })
        this.sync()
    }

    cancelDraft() {
        if (!this.draft) return
        this.#clearDraft()
        previewRowLayout(null)
        this.sync()
    }

    sync() {
        if (!this.root.isConnected) return
        if (!this.draft) this.#setSliders(peekSetting("rowLayout"))
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
            this.draft = normalizeRowLayout(null)
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
