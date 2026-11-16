import { Constants as C, getSettings, quickSettingsUpdate, peekSetting, requestSettingsUpdate, showRenderedWindow } from '../scripts/const.js';
import { triggerVNEffect, triggerNarrativeText, previewRowLayout, setRowMode, toggleCleanView, normalizeRowLayout, ROW_LAYOUT_LIMITS } from '../scripts/main.js';
import { PresetUIClass } from '../scripts/presetUIClass.js';
import { PORTRAIT_FILTERS, normalizePortraitFilters } from '../scripts/portraitFilters.js';

// Окно "Эффекты" — быстрый доступ ГМ к визуальным эффектам поверх окна визуальной новеллы:
// - Тряска спрайта (персонажи отмечаются галочками)
// - Вспышка света / тьмы (по всему экрану, если никто не отмечен, либо только на отмеченных спрайтах)
// - Затемнение фона (переключатель, полностью тёмный фон вместо картинки локации)
// - Режим ряда (переключатель: шапка и плашки сменяются затемнением, все активные персонажи
//   выстраиваются в один горизонтальный ряд; положение, масштаб и отступы - ползунками)
// - Чистый вид (переключатель: шапка, плашки и имена скрыты, верхние круглые кнопки остаются)
// - Медленная прокрутка фона (переключатель вкл/выкл; направление и зацикленность анимации
//   настраиваются отдельно ГМом в "Настройки эффектов" - scripts/settings.js, bgScrollDirection/bgScrollLoop)
// - Блокировка личного выхода игроков из новеллы (переключатель)
//
// Сама логика применения эффектов (DOM/CSS/socket) живёт в scripts/main.js (triggerVNEffect),
// это окно - только UI поверх неё, чтобы не дублировать код между ГМ-клиентом и обработчиком сокета.
// Минимальный размер окна при растягивании за края и углы
const MIN_WIDTH = 360
const MIN_HEIGHT = 220
const RESIZE_EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"]
const ROW_PREVIEW_INTERVAL_MS = 60

export class EffectsPanel extends FormApplication {
    static instance = null

    // Отмеченные галочками персонажи: для цели эффекта (effect) и фильтров портретов (filter).
    // Позиции, ушедшие со сцены, снимаются в _syncMultiList.
    _multi = { effect: { checked: new Set() }, filter: { checked: new Set() } }
    // Несохранённая раскладка ряда (ползунки) - null, пока ползунки не трогали
    _rowDraft = null

    // Одно окно на клиента: повторный клик по кнопке поднимает уже открытое, а Hooks.on("updateSetting")
    // ниже знает, какое окно обновлять
    static open() {
        if (!EffectsPanel.instance) EffectsPanel.instance = new EffectsPanel({}, EffectsPanel._getSavedSize())
        if (EffectsPanel.instance.rendered) {
            showRenderedWindow(EffectsPanel.instance)
        } else {
            EffectsPanel.instance.render(true)
        }
        return EffectsPanel.instance
    }

    // Размер, до которого окно растянули в прошлый раз (у каждого клиента свой)
    static _getSavedSize() {
        const size = game.settings.get(C.ID, "effectsPanelSize")
        return (size?.width > 0 && size?.height > 0) ? { width: size.width, height: size.height } : {}
    }

    async close(options) {
        if (EffectsPanel.instance === this) EffectsPanel.instance = null
        // Сцена и режимы остаются как есть - откатываются только несохранённые ползунки раскладки ряда
        if (this._rowDraft) this._cancelRowDraft()
        return super.close(options)
    }

    async _render(force, options) {
        await super._render(force, options)
        this._ensureResizeHandles()
    }

    // ===== Растягивание окна за края и углы =====
    // Штатный resizable окон V1 даёт только один уголок справа снизу. Ручки - прямые дети корня окна,
    // поэтому переживают перерисовку содержимого (.window-content).
    _ensureResizeHandles() {
        const appElement = this.element?.[0]
        if (!appElement || appElement.querySelector(':scope > .vn-fx-resize-handle')) return
        appElement.classList.toggle('vn-fx-sized', this.options.height !== "auto")
        RESIZE_EDGES.forEach(edge => {
            const handleElement = document.createElement('div')
            handleElement.className = `vn-fx-resize-handle vn-fx-resize-${edge}`
            handleElement.addEventListener('pointerdown', (event) => this._onResizeStart(event, edge))
            appElement.appendChild(handleElement)
        })
    }

    _onResizeStart(event, edge) {
        if (event.button !== 0 || this._minimized) return
        event.preventDefault()
        event.stopPropagation()
        const handleElement = event.currentTarget
        const appElement = this.element[0]
        handleElement.setPointerCapture(event.pointerId)
        const start = {
            x: event.clientX, y: event.clientY,
            left: this.position.left ?? appElement.offsetLeft, top: this.position.top ?? appElement.offsetTop,
            width: Number.isFinite(this.position.width) ? this.position.width : appElement.offsetWidth,
            height: Number.isFinite(this.position.height) ? this.position.height : appElement.offsetHeight,
        }
        // С height: "auto" окно V1 сбрасывает высоту при каждом setPosition - после первого растягивания
        // высота фиксированная
        this.options.height = start.height
        appElement.classList.add('vn-fx-sized')
        const onMove = (moveEvent) => {
            const deltaX = moveEvent.clientX - start.x
            const deltaY = moveEvent.clientY - start.y
            let width = start.width
            let height = start.height
            if (edge.includes("e")) width = start.width + deltaX
            if (edge.includes("w")) width = start.width - deltaX
            if (edge.includes("s")) height = start.height + deltaY
            if (edge.includes("n")) height = start.height - deltaY
            width = Math.min(Math.max(MIN_WIDTH, width), window.innerWidth)
            height = Math.min(Math.max(MIN_HEIGHT, height), window.innerHeight)
            const left = edge.includes("w") ? Math.max(0, start.left + start.width - width) : start.left
            const top = edge.includes("n") ? Math.max(0, start.top + start.height - height) : start.top
            this.setPosition({ left, top, width, height })
        }
        const onEnd = () => {
            handleElement.removeEventListener('pointermove', onMove)
            handleElement.removeEventListener('pointerup', onEnd)
            handleElement.removeEventListener('pointercancel', onEnd)
            game.settings.set(C.ID, "effectsPanelSize", { width: this.position.width, height: this.position.height })
        }
        handleElement.addEventListener('pointermove', onMove)
        handleElement.addEventListener('pointerup', onEnd)
        handleElement.addEventListener('pointercancel', onEnd)
    }

    // Окно, которое ещё не растягивали, подстраивает высоту под содержимое (раздел ряда, галочки)
    _fitHeight() {
        if (this.options.height === "auto" && this.rendered && !this._minimized) this.setPosition({ height: "auto" })
    }

    // Живое обновление списков персонажей и подсветки фильтров без полной перерисовки окна
    // (полная перерисовка сбивала бы фокус/ввод в полях шкал). Только чтение vnData - без deepClone.
    refreshLiveState() {
        if (!this.rendered || !this.element?.length) return
        this._syncLiveState(this.element)
    }

    _syncLiveState(html) {
        const liveData = {
            activeSpeakers: peekSetting("activeSpeakers") || {},
            activeSlots: peekSetting("activeSlots") || {},
        }
        const effectTargets = this._getActiveTargets(liveData)
        const stageTargets = this._getStageTargets(liveData)
        this._syncMultiList(html, "effect", effectTargets)
        this._syncMultiList(html, "filter", stageTargets)
        this._refreshFilterButtons(html, liveData)
        this._syncRowLayout(html)
        // Переключатели тоже сверяются с фактическими данными (их меняют и другие места - напр. кнопка
        // "Чистый вид" в окне VN или выбор пресета локации), а не только с последним кликом в этом окне
        Object.entries(EffectsPanel.TOGGLE_SETTINGS).forEach(([selector, settingKey]) => {
            html[0].querySelector(selector)?.classList.toggle('vn-fx-active', !!peekSetting(settingKey))
        })
    }

    static TOGGLE_SETTINGS = {
        '.vn-fx-toggle-darken': 'darkenBack',
        '.vn-fx-toggle-row': 'rowMode',
        '.vn-fx-toggle-cleanview': 'cleanView',
        '.vn-fx-bgscroll-toggle': 'bgScroll',
        '.vn-fx-blur-toggle': 'bgBlur',
        '.vn-fx-toggle-lockexit': 'lockExit',
    }

    // Галочки персонажей - перестраиваются, только если состав персонажей изменился
    _syncMultiList(html, scope, targets) {
        const sectionElement = html[0].querySelector(`.vn-fx-target-section[data-scope="${scope}"]`)
        if (!sectionElement) return
        const state = this._multi[scope]
        const targetPositions = new Set(targets.map(target => target.pos))
        state.checked.forEach(position => { if (!targetPositions.has(position)) state.checked.delete(position) })
        const listElement = sectionElement.querySelector('.vn-fx-multi-list')
        const targetsKey = targets.map(target => `${target.pos}:${target.name}`).join("|")
        if (listElement.dataset.targetsKey !== targetsKey) {
            listElement.dataset.targetsKey = targetsKey
            listElement.replaceChildren()
            if (!targets.length) {
                const emptyElement = document.createElement('p')
                emptyElement.className = 'vn-fx-hint'
                emptyElement.textContent = game.i18n.localize(`${C.ID}.effectsPanel.noCharacters`)
                listElement.appendChild(emptyElement)
            }
            targets.forEach(target => {
                const labelElement = document.createElement('label')
                labelElement.className = 'vn-fx-multi-item'
                const checkboxElement = document.createElement('input')
                checkboxElement.type = 'checkbox'
                checkboxElement.value = target.pos
                const nameElement = document.createElement('span')
                // textContent - имя персонажа вводит пользователь
                nameElement.textContent = target.name
                labelElement.append(checkboxElement, nameElement)
                listElement.appendChild(labelElement)
            })
        }
        listElement.querySelectorAll('input[type="checkbox"]').forEach(checkboxElement => {
            checkboxElement.checked = state.checked.has(checkboxElement.value)
        })
        this._syncCheckAll(sectionElement, state, targets.length)
    }

    // "Отметить всех": отмечена, если отмечены все; "наполовину" - если часть
    _syncCheckAll(sectionElement, state, targetCount) {
        const checkAllElement = sectionElement.querySelector('.vn-fx-check-all input')
        if (!checkAllElement) return
        checkAllElement.disabled = targetCount === 0
        checkAllElement.checked = targetCount > 0 && state.checked.size === targetCount
        checkAllElement.indeterminate = state.checked.size > 0 && state.checked.size < targetCount
    }

    // ===== Раскладка режима ряда =====
    _getRowLayoutFields(layout) {
        const normalizedLayout = normalizeRowLayout(layout)
        const labels = { x: "rowLayoutX", y: "rowLayoutY", scale: "rowLayoutScale", gap: "rowLayoutGap" }
        return Object.entries(ROW_LAYOUT_LIMITS).map(([key, limit]) => ({
            key, ...limit, value: normalizedLayout[key],
            label: game.i18n.localize(`${C.ID}.effectsPanel.${labels[key]}`),
        }))
    }

    _setRowSliders(html, layout) {
        const normalizedLayout = normalizeRowLayout(layout)
        html[0].querySelectorAll('.vn-fx-rowlayout input[type="range"]').forEach(inputElement => {
            inputElement.value = normalizedLayout[inputElement.dataset.key]
            inputElement.nextElementSibling.textContent = inputElement.value
        })
    }

    // Раздел виден, пока включён режим ряда; ползунки без черновика повторяют сохранённую раскладку
    _syncRowLayout(html) {
        const sectionElement = html[0].querySelector('.vn-fx-rowlayout')
        if (!sectionElement) return
        const isRowMode = !!peekSetting("rowMode")
        if (!isRowMode && this._rowDraft) this._cancelRowDraft()
        if (sectionElement.hidden === isRowMode) {
            sectionElement.hidden = !isRowMode
            this._fitHeight()
        }
        if (!this._rowDraft) this._setRowSliders(html, peekSetting("rowLayout"))
        sectionElement.querySelector('.vn-fx-rowlayout-save')?.classList.toggle('vn-fx-dirty', !!this._rowDraft)
    }

    // Превью уходит всем не чаще раза в ROW_PREVIEW_INTERVAL_MS, последнее положение ползунка - всегда
    _scheduleRowPreview() {
        if (this._rowPreviewTimer) return
        this._rowPreviewTimer = setTimeout(() => {
            this._rowPreviewTimer = null
            if (this._rowDraft) previewRowLayout(this._rowDraft)
        }, ROW_PREVIEW_INTERVAL_MS)
    }

    _cancelRowDraft() {
        clearTimeout(this._rowPreviewTimer)
        this._rowPreviewTimer = null
        this._rowDraft = null
        previewRowLayout(null)
    }

    static get defaultOptions() {
        const defaults = super.defaultOptions;
        const overrides = {
            // Класс окна-приложения (Application root) - НЕ переиспользовать имя 'vn-fx-panel-body':
            // это имя уже занято внутренним flex-рядом в templates/effectsPanel.hbs, и CSS-правило
            // .vn-fx-panel-body { align-items: flex-start } писалось именно для него. Совпадение
            // имён приводило к тому, что то же правило утекало и на корень окна, сжимая
            // .window-header (родитель заголовка и кнопки Close) вместо растягивания на всю ширину.
            classes: ['vn-fx-panel-app'],
            width: 640,
            height: "auto",
            resizable: false,
            id: "EffectsPanel",
            template: `modules/${C.ID}/templates/effectsPanel.hbs`,
            title: game.i18n.localize(`${C.ID}.effectsPanel.windowTitle`),
            closeOnSubmit: false,
            submitOnChange: false
        };
        return foundry.utils.mergeObject(defaults, overrides);
    }

    // Список активных (видимых) портретов для выбора цели эффекта
    _getActiveTargets(settingData = getSettings()) {
        const positions = [...(settingData.activeSlots?.left || []), ...(settingData.activeSlots?.right || [])]
        return positions
            .map(pos => ({ pos, speaker: settingData.activeSpeakers?.[pos] }))
            .filter(t => t.speaker)
            .map(t => ({ pos: t.pos, name: t.speaker.name || t.pos }))
    }

    // Цели для фильтров портретов - ВСЕ персонажи на сцене (в пределах slotCount активного пресета),
    // а не только активные (говорящие), как у тряски/вспышки: фильтр - постоянное состояние, и "кровь"
    // на персонаже второго плана - обычный сценарий.
    _getStageTargets(settingData = getSettings()) {
        const slotCount = PresetUIClass.getActivePreset().slotCount
        return ["left", "right"]
            .flatMap(side => C.numArray.slice(0, slotCount[side]).map(index => `${side}${index}`))
            .map(pos => ({ pos, speaker: settingData.activeSpeakers?.[pos] }))
            .filter(target => target.speaker)
            .map(target => ({ pos: target.pos, name: target.speaker.name || target.pos }))
    }

    // Список bar активного UI-пресета (раскладка) + их живое содержимое из vnData.barsData
    // (если содержимого ещё нет - bar ни разу не редактировался, показываем значения по умолчанию;
    // сам факт отсутствия записи в barsData - это и есть "скрыт до первого изменения", см. main.js)
    _getBarsData(settingData = getSettings()) {
        const preset = PresetUIClass.getActivePreset()
        const barsContent = settingData.barsData || []
        return preset.bars.map(layout => {
            const content = barsContent.find(b => b.id === layout.id) || {}
            const totalSeconds = content.timerDurationSeconds || 0
            return {
                id: layout.id,
                name: content.name || "",
                color: content.color || "#a33636",
                value: content.value ?? 0,
                mode: content.mode || "counter",
                isTimer: content.mode === "timer",
                timerH: Math.floor(totalSeconds / 3600),
                timerM: Math.floor((totalSeconds % 3600) / 60),
                timerS: totalSeconds % 60,
                // Постоянный переключатель-"глаз" (см. activateListeners ниже) - независим от
                // "Всегда показывать bar" (глобальная настройка) и от 10-секундного превью правки.
                visible: !!content.visible,
            }
        })
    }

    getData(options) {
        const settingData = getSettings()
        return {
            darkenBack: !!settingData.darkenBack,
            rowMode: !!settingData.rowMode,
            cleanView: !!settingData.cleanView,
            rowLayoutFields: this._getRowLayoutFields(settingData.rowLayout),
            bgScroll: !!settingData.bgScroll,
            bgBlur: !!settingData.bgBlur,
            lockExit: !!settingData.lockExit,
            bars: this._getBarsData(settingData),
            portraitFilters: PORTRAIT_FILTERS.map(filter => ({
                id: filter.id,
                icon: filter.icon,
                label: game.i18n.localize(`${C.ID}.portraitFilters.${filter.id}`),
            })),
        }
    }

    // Позиции, к которым применяется фильтр: отмеченные галочками персонажи на сцене
    _getFilterPositions(settingData = getSettings()) {
        const stagePositions = this._getStageTargets(settingData).map(target => target.pos)
        return stagePositions.filter(position => this._multi.filter.checked.has(position))
    }

    // Кнопка фильтра подсвечена, если фильтр есть у КАЖДОГО отмеченного персонажа
    _refreshFilterButtons(html, settingData = { activeSpeakers: peekSetting("activeSpeakers") || {} }) {
        const speakers = this._getFilterPositions(settingData).map(pos => settingData.activeSpeakers[pos])
        html[0].querySelectorAll('.vn-fx-pfilter').forEach(buttonElement => {
            const filterId = buttonElement.dataset.filter
            const isActive = speakers.length > 0 && speakers.every(speaker => normalizePortraitFilters(speaker.filters).includes(filterId))
            buttonElement.classList.toggle('vn-fx-active', isActive)
        })
    }

    // Без renderParts - фильтры накладываются на существующие узлы в Hooks.on("updateSetting")
    // (main.js -> applyPortraitFilters), перерисовка портретов перезапустила бы их анимацию появления
    async _updateFilters(html, updateFilters) {
        const settingData = getSettings()
        const speakers = this._getFilterPositions(settingData).map(pos => settingData.activeSpeakers[pos])
        if (!speakers.length) {
            const hasStageTargets = this._getStageTargets(settingData).length > 0
            ui.notifications.warn(game.i18n.localize(`${C.ID}.effectsPanel.${hasStageTargets ? "noTargetsChecked" : "noFilterTargets"}`))
            return
        }
        updateFilters(speakers)
        // Подсветка сразу, не дожидаясь круга до сервера и перерисовки VN-окна
        this._refreshFilterButtons(html, settingData)
        await requestSettingsUpdate(settingData)
    }

    // Цель - отмеченные персонажи. Без отметок вспышка идёт на весь экран ("all"), а тряске нужна цель.
    _triggerEffect(kind) {
        const positions = [...this._multi.effect.checked]
        if (positions.length) return triggerVNEffect(kind, positions)
        if (kind !== "shake") return triggerVNEffect(kind, "all")
        ui.notifications.warn(game.i18n.localize(`${C.ID}.effectsPanel.noTargetsChecked`))
    }

    activateListeners(html) {
        super.activateListeners(html);

        // --- Галочки персонажей (цель эффекта и фильтры портретов) ---
        html[0].querySelectorAll('.vn-fx-target-section').forEach(sectionElement => {
            const scope = sectionElement.dataset.scope
            const state = this._multi[scope]
            const listElement = sectionElement.querySelector('.vn-fx-multi-list')
            const getCheckboxes = () => Array.from(listElement.querySelectorAll('input[type="checkbox"]'))
            listElement.addEventListener('change', (event) => {
                const checkboxElement = event.target
                if (checkboxElement.type !== 'checkbox') return
                if (checkboxElement.checked) state.checked.add(checkboxElement.value)
                else state.checked.delete(checkboxElement.value)
                this._syncCheckAll(sectionElement, state, getCheckboxes().length)
                if (scope === "filter") this._refreshFilterButtons(html)
            })
            sectionElement.querySelector('.vn-fx-check-all input')?.addEventListener('change', (event) => {
                const isChecked = event.currentTarget.checked
                getCheckboxes().forEach(checkboxElement => {
                    checkboxElement.checked = isChecked
                    if (isChecked) state.checked.add(checkboxElement.value)
                    else state.checked.delete(checkboxElement.value)
                })
                this._syncCheckAll(sectionElement, state, getCheckboxes().length)
                if (scope === "filter") this._refreshFilterButtons(html)
            })
        })

        // --- Тряска ---
        html.find('.vn-fx-shake').on('click', (event) => {
            event.preventDefault()
            this._triggerEffect('shake')
        })

        // --- Вспышка света / тьмы ---
        html.find('.vn-fx-flash-light').on('click', (event) => {
            event.preventDefault()
            this._triggerEffect('flashLight')
        })
        html.find('.vn-fx-flash-dark').on('click', (event) => {
            event.preventDefault()
            this._triggerEffect('flashDark')
        })

        // --- Затемнение фона (переключатель, синхронизируется всем игрокам через настройки) ---
        html.find('.vn-fx-toggle-darken').on('click', async (event) => {
            event.preventDefault()
            const next = !peekSetting("darkenBack")
            event.currentTarget.classList.toggle('vn-fx-active', next)
            await quickSettingsUpdate({ darkenBack: next }, { renderData: { renderParts: ["foreground"] } })
        })

        // --- Режим ряда (переключатель) ---
        // Прячет шапку и слайдеры и затемняет фон (main.js setRowMode); верхние круглые кнопки остаются.
        // (Если нужно "затемнение само по себе" без режима ряда - для этого отдельная кнопка выше.)
        html.find('.vn-fx-toggle-row').on('click', async (event) => {
            event.preventDefault()
            const turningOn = !peekSetting("rowMode")
            event.currentTarget.classList.toggle('vn-fx-active', turningOn)
            html[0].querySelector('.vn-fx-toggle-darken')?.classList.toggle('vn-fx-active', turningOn)
            await setRowMode(turningOn)
        })

        // --- Чистый вид (шапка, плашки и имена скрыты, верхние кнопки остаются) ---
        html.find('.vn-fx-toggle-cleanview').on('click', async (event) => {
            event.preventDefault()
            event.currentTarget.classList.toggle('vn-fx-active', !peekSetting("cleanView"))
            await toggleCleanView()
        })

        // --- Раскладка режима ряда: ползунки сразу показывают результат всем (превью по сокету),
        // "Сохранить" пишет vnData.rowLayout, "Отменить" возвращает сохранённое ---
        const rowLayoutElement = html[0].querySelector('.vn-fx-rowlayout')
        const readRowSliders = () => Object.fromEntries(Array.from(rowLayoutElement.querySelectorAll('input[type="range"]'))
            .map(inputElement => [inputElement.dataset.key, Number(inputElement.value)]))
        rowLayoutElement?.addEventListener('input', (event) => {
            if (event.target.type !== 'range') return
            event.target.nextElementSibling.textContent = event.target.value
            this._rowDraft = readRowSliders()
            rowLayoutElement.querySelector('.vn-fx-rowlayout-save')?.classList.add('vn-fx-dirty')
            this._scheduleRowPreview()
        })
        rowLayoutElement?.querySelector('.vn-fx-rowlayout-save')?.addEventListener('click', async (event) => {
            if (!this._rowDraft) return
            const rowLayout = normalizeRowLayout(this._rowDraft)
            clearTimeout(this._rowPreviewTimer)
            this._rowPreviewTimer = null
            this._rowDraft = null
            event.currentTarget.classList.remove('vn-fx-dirty')
            // Превью снимается у всех само, когда приходит новая сохранённая раскладка (main.js _syncStoredRowLayout)
            await quickSettingsUpdate({ rowLayout })
        })
        rowLayoutElement?.querySelector('.vn-fx-rowlayout-cancel')?.addEventListener('click', () => {
            if (this._rowDraft) this._cancelRowDraft()
            this._syncRowLayout(html)
        })
        rowLayoutElement?.querySelector('.vn-fx-rowlayout-default')?.addEventListener('click', () => {
            this._rowDraft = normalizeRowLayout(null)
            this._setRowSliders(html, this._rowDraft)
            rowLayoutElement.querySelector('.vn-fx-rowlayout-save')?.classList.add('vn-fx-dirty')
            this._scheduleRowPreview()
        })

        // --- Медленная прокрутка фона (один переключатель вкл/выкл, общий для всех игроков.
        // Направление и зацикленность берутся из настроек ГМа - bgScrollDirection/bgScrollLoop,
        // "Настройки эффектов" в Visual Settings Menu, применяются в main.js _onRender) ---
        html.find('.vn-fx-bgscroll-toggle').on('click', async (event) => {
            event.preventDefault()
            const next = !peekSetting("bgScroll")
            event.currentTarget.classList.toggle('vn-fx-active', next)
            await quickSettingsUpdate({ bgScroll: next }, { renderData: { renderParts: ["background"] } })
        })

        // --- Размытие фона (переключатель вкл/выкл, общий для всех игроков. Сила размытия берётся из
        // настройки ГМа - bgBlurStrength, "Настройки эффектов" в Visual Settings Menu, применяется в
        // main.js _onRender). БЕЗ renderParts:["background"] - иначе Foundry пересобирает Handlebars-часть
        // "background" и уничтожает/пересоздаёт #vn-background-image на каждый клик, а CSS transition
        // (плавное появление/исчезновение блюра) не может анимироваться на только что созданном узле -
        // получался мгновенный скачок вместо плавного перехода. main.js, Hooks.on("updateSetting", ...)
        // сам применяет blur на уже существующем узле через _applyBackgroundVisualEffects(). ---
        html.find('.vn-fx-blur-toggle').on('click', async (event) => {
            event.preventDefault()
            const next = !peekSetting("bgBlur")
            event.currentTarget.classList.toggle('vn-fx-active', next)
            await quickSettingsUpdate({ bgBlur: next })
        })

        // --- Нарратив (одноразовая полноэкранная текстовая вставка - ГМ пишет текст в диалоге,
        // каждый перевод строки внутри текста = разрыв на "страницы"; см. triggerNarrativeText, main.js) ---
        html.find('.vn-fx-narrative').on('click', (event) => {
            event.preventDefault()
            new Dialog({
                title: game.i18n.localize(`${C.ID}.effectsPanel.narrativeDialogTitle`),
                content: `<textarea class="vn-narrative-input" rows="6" style="width:100%;resize:vertical;" placeholder="${game.i18n.localize(`${C.ID}.effectsPanel.narrativePlaceholder`)}"></textarea>`,
                buttons: {
                    confirm: {
                        icon: '<i class="fas fa-check"></i>',
                        label: game.i18n.localize(`${C.ID}.effectsPanel.confirm`),
                        callback: (html) => triggerNarrativeText(html[0].querySelector('.vn-narrative-input')?.value || "")
                    }
                },
                default: "confirm"
            }).render(true)
        })

        // --- Блокировка личного выхода игроков из новеллы (переключатель) ---
        html.find('.vn-fx-toggle-lockexit').on('click', async (event) => {
            event.preventDefault()
            const next = !peekSetting("lockExit")
            event.currentTarget.classList.toggle('vn-fx-active', next)
            await quickSettingsUpdate({ lockExit: next }, { renderData: { renderParts: ["foreground"] } })
        })

        // --- Фильтры портретов (кровь, грязь, затемнение и т.д., scripts/portraitFilters.js) ---
        this._syncLiveState(html)
        html.find('.vn-fx-pfilter').on('click', async (event) => {
            event.preventDefault()
            const filterId = event.currentTarget.dataset.filter
            await this._updateFilters(html, (speakers) => {
                // Если фильтр уже есть у всех целей - снимаем со всех, иначе добавляем всем
                const allHaveFilter = speakers.every(speaker => normalizePortraitFilters(speaker.filters).includes(filterId))
                speakers.forEach(speaker => {
                    const currentFilters = normalizePortraitFilters(speaker.filters)
                    if (allHaveFilter) {
                        speaker.filters = currentFilters.filter(id => id !== filterId)
                    } else {
                        speaker.filters = normalizePortraitFilters([...currentFilters, filterId])
                    }
                })
            })
        })
        html.find('.vn-fx-pfilter-clear').on('click', async (event) => {
            event.preventDefault()
            await this._updateFilters(html, (speakers) => {
                speakers.forEach(speaker => { speaker.filters = [] })
            })
        })

        // --- Горизонтальные шкалы (bar) - отдельная колонка. Раскладка (позиция/масштаб) заведена
        // в UI customization/detailed mode (PresetUIClass.bars) - здесь редактируется только живое
        // содержимое (vnData.barsData), по одной строке на bar. Первое изменение любого поля создаёт
        // запись в barsData (bar перестаёт быть скрытым, если barsAlwaysShow выключен) - см. main.js
        // _preparePartContext "bars" case. ---

        // Добавить новый bar прямо отсюда, не выходя в UI customization (раньше это был единственный
        // путь - долгий и неочевидный для панели, которой пользуются "по ходу игры"). Раскладка
        // получает дефолтную позицию/масштаб (см. PresetUIClass.newBar) - подправить её можно в
        // detailed mode, как и у любого другого bar.
        html[0].querySelector('.vn-fx-bar-add-button')?.addEventListener('click', async () => {
            const preset = PresetUIClass.getActivePreset()
            await PresetUIClass.addBar(preset.id)
            this.render()
        })

        html[0].querySelectorAll('.vn-fx-bar-row').forEach(rowEl => {
            const barId = rowEl.dataset.barId

            // patch - изменяемые поля bar. Если записи ещё нет в barsData - это структурное появление
            // нового узла .vn-bar в VN-окне, нужен renderParts:["bars"] один раз. Если запись уже
            // есть - только значение/цвет меняются на уже существующем узле (see main.js
            // _applyBarVisualState, вызывается из Hooks.on("updateSetting", ...) без renderParts,
            // чтобы CSS transition плавно анимировал изменение, а не дёргался пересозданным узлом).
            //
            // preview (по умолчанию true) - любая правка поля даёт bar 10-секундное окно видимости
            // (previewUntil), даже если он иначе скрыт (см. main.js _isBarVisible) - ГМ сразу видит
            // результат своей правки. Окно истекает само по себе (тиковый setInterval в main.js),
            // без отдельной записи в settings на истечение. Переключатель-"глаз" - единственное
            // исключение (preview: false) - это осознанный постоянный выбор ГМа, а не мимолётная
            // правка, ему не нужно (и не должно) авто-скрываться через 10 секунд.
            const upsertBar = async (patch, { preview = true } = {}) => {
                const settingData = getSettings()
                const barsData = foundry.utils.deepClone(settingData.barsData || [])
                let bar = barsData.find(b => b.id === barId)
                const isNew = !bar
                if (!bar) {
                    bar = { id: barId, name: "", color: "#a33636", value: 0, mode: "counter", timerDurationSeconds: 0, timerEndTimestamp: null, visible: false, previewUntil: null }
                    barsData.push(bar)
                }
                Object.assign(bar, patch)
                if (preview) bar.previewUntil = Date.now() + 10000
                await quickSettingsUpdate({ barsData }, isNew ? { renderData: { renderParts: ["bars"] } } : {})
            }

            // Постоянный переключатель видимости ("глаз", тот же паттерн, что в самом Foundry) -
            // в отличие от превью выше, не истекает сам по себе, и не зависит от того, тронуто ли
            // поле значения/цвета/имени.
            const visibilityToggle = rowEl.querySelector('.vn-fx-bar-visibility-toggle')
            visibilityToggle?.addEventListener('click', async () => {
                const current = (peekSetting("barsData") || []).find(b => b.id === barId)
                const nextVisible = !current?.visible
                // Только кнопка и иконка - полная перерисовка окна на каждый клик была заметной задержкой
                visibilityToggle.classList.toggle('vn-fx-active', nextVisible)
                const iconElement = visibilityToggle.querySelector('i')
                iconElement?.classList.toggle('fa-eye', nextVisible)
                iconElement?.classList.toggle('fa-eye-slash', !nextVisible)
                await upsertBar({ visible: nextVisible }, { preview: false })
            })

            rowEl.querySelector('[data-key="name"]')?.addEventListener('change', (event) => {
                upsertBar({ name: event.currentTarget.value })
            })
            rowEl.querySelector('[data-key="color"]')?.addEventListener('change', (event) => {
                upsertBar({ color: event.currentTarget.value })
            })
            // "input" стреляет на каждый пиксель протаскивания ползунка - пишем в settings только
            // на "change" (отпускание), иначе на один драг ушла бы пачка записей game.settings.set
            // подряд. Пока тащим - только обновляем текстовый индикатор локально, без записи.
            const valueInputEl = rowEl.querySelector('[data-key="value"]')
            const valueReadoutEl = rowEl.querySelector('.vn-fx-bar-value-readout')
            valueInputEl?.addEventListener('input', (event) => {
                if (valueReadoutEl) valueReadoutEl.textContent = `${event.currentTarget.value}%`
            })
            valueInputEl?.addEventListener('change', (event) => {
                upsertBar({ mode: "counter", value: Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0)) })
            })
            rowEl.querySelector('[data-key="mode"]')?.addEventListener('change', async (event) => {
                await upsertBar({ mode: event.currentTarget.value })
                // Переключение counter/timer меняет, какие поля показаны в самой панели - надо
                // перерисовать панель (не VN-окно, там достаточно нового значения displayValue)
                this.render()
            })
            rowEl.querySelector('.vn-fx-bar-timer-start')?.addEventListener('click', () => {
                const h = Number(rowEl.querySelector('[data-key="timerH"]')?.value) || 0
                const m = Number(rowEl.querySelector('[data-key="timerM"]')?.value) || 0
                const s = Number(rowEl.querySelector('[data-key="timerS"]')?.value) || 0
                const totalSeconds = Math.max(1, h * 3600 + m * 60 + s)
                upsertBar({ mode: "timer", timerDurationSeconds: totalSeconds, timerEndTimestamp: Date.now() + totalSeconds * 1000, value: 100 })
            })

            // Второй способ удалить bar (первый - кнопка на мувере в Detailed mode, visualSettingsMenu.js) -
            // та же пара действий: убрать из раскладки пресета (PresetUIClass.removeBar) и из живого
            // содержимого (barsData), иначе актив копился бы в позиционировании без данных.
            rowEl.querySelector('.vn-fx-bar-delete-button')?.addEventListener('click', async () => {
                const preset = PresetUIClass.getActivePreset()
                await PresetUIClass.removeBar(preset.id, barId)
                const settingData = getSettings()
                const barsData = (settingData.barsData || []).filter(b => b.id !== barId)
                await quickSettingsUpdate({ barsData }, { renderData: { renderParts: ["bars"] } })
                this.render()
            })
        })
    }

    async _updateObject(event, formData) {
    }
}

// Списки персонажей и подсветка в открытой панели следят за каждым изменением сцены (раньше обновлялись
// только при повторном открытии окна). presetsUI - смена пресета меняет число слотов на сцене.
Hooks.on("updateSetting", (setting) => {
    if (setting.key !== `${C.ID}.vnData` && setting.key !== `${C.ID}.presetsUI`) return
    EffectsPanel.instance?.refreshLiveState()
})
