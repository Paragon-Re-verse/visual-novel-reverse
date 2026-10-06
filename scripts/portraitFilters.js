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

export function buildPortraitFilterCss(filters) {
    const cssParts = normalizePortraitFilters(filters).map(id => PORTRAIT_FILTERS.find(filter => filter.id === id).css)
    if (!cssParts.length) return ""
    return cssParts.join(" ")
}

// Область фильтра с запасом -50%/200%: <img> внутри .vn-portrait может выходить за её рамки
// (масштаб и смещения портрета), а SVG-фильтр обрезает всё за пределами своей области.
const SVG_FILTER_DEFS = `
<svg id="vn-portrait-filter-defs" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">
  <defs>
    <filter id="vn-pf-dirt" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="4" seed="4" result="smudgeNoise"/>
      <feColorMatrix in="smudgeNoise" type="matrix" values="0 0 0 0 0.27  0 0 0 0 0.19  0 0 0 0 0.10  3.4 0 0 0 -1.5" result="smudge"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="9" result="speckNoise"/>
      <feColorMatrix in="speckNoise" type="matrix" values="0 0 0 0 0.16  0 0 0 0 0.11  0 0 0 0 0.06  14 0 0 0 -9.1" result="speck"/>
      <feMerge result="grime"><feMergeNode in="smudge"/><feMergeNode in="speck"/></feMerge>
      <feComposite in="grime" in2="SourceAlpha" operator="in" result="grimeMasked"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="grimeMasked"/></feMerge>
    </filter>
    <filter id="vn-pf-blood" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.016 0.009" numOctaves="3" seed="21" result="splatNoise"/>
      <feColorMatrix in="splatNoise" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.02  0 0 0 0 0.03  0 -11 0 0 4.35" result="splat"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="13" result="dropNoise"/>
      <feColorMatrix in="dropNoise" type="matrix" values="0 0 0 0 0.30  0 0 0 0 0.01  0 0 0 0 0.02  0 0 -20 0 7.3" result="drops"/>
      <feMerge result="blood"><feMergeNode in="splat"/><feMergeNode in="drops"/></feMerge>
      <feComposite in="blood" in2="SourceAlpha" operator="in" result="bloodMasked"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="bloodMasked"/></feMerge>
    </filter>
  </defs>
</svg>`

export function ensurePortraitFilterDefs() {
    if (document.getElementById("vn-portrait-filter-defs")) return
    document.body.insertAdjacentHTML("beforeend", SVG_FILTER_DEFS)
}

// Применяет фильтры к УЖЕ СУЩЕСТВУЮЩИМ узлам - вызывается из _onRender и из Hooks.on("updateSetting")
// (переключение фильтра в панели не просит перерисовку портретов, чтобы не перезапускать их анимацию появления)
export function applyPortraitFilters(settingData) {
    ensurePortraitFilterDefs()
    const activeSpeakers = settingData?.activeSpeakers || {}
    document.querySelectorAll("#vn-body .vn-portrait").forEach(portraitElement => {
        const position = portraitElement.closest(".vn-pBody")?.dataset.pos
        if (!position) return
        portraitElement.style.filter = buildPortraitFilterCss(activeSpeakers[position]?.filters)
    })
    // "Режим ряда" рисует собственные <img> (main.js _updateRowLayer) - им тоже нужны фильтры их слота.
    // У этих <img> уже есть CSS-тень (#vn-fx-row-layer img в _injectEffectStyles) - inline filter её
    // перебил бы, поэтому при наличии фильтров дописываем ту же тень в конец.
    document.querySelectorAll("#vn-fx-row-layer img[data-pos]").forEach(rowImageElement => {
        const filterCss = buildPortraitFilterCss(activeSpeakers[rowImageElement.dataset.pos]?.filters)
        if (filterCss) {
            rowImageElement.style.filter = `${filterCss} ${ROW_LAYER_SHADOW}`
        } else {
            rowImageElement.style.filter = ""
        }
    })
}
