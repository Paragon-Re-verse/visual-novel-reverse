// Реакции игроков: пузырь («!», «?», «♥»…) над портретом на ~1.6 с. Одноразовое событие через сокет
// модуля (как тряска/вспышки в main.js) - в vnData не хранится.
// Игрок реагирует за своего персонажа (Character Player на сцене), ГМ - за выбранный слот (editActiveSpeaker,
// золотая рамка в Actor Picker / окне редактирования). Настройка playerReactions - меню "Настройки эффектов".
import { Constants as C, allowTo, peekSetting } from './const.js';

export const REACTIONS = [
    { id: "exclaim", text: "!" },
    { id: "question", text: "?" },
    { id: "surprise", text: "!?" },
    { id: "love", text: "♥" },
    { id: "silence", text: "…" },
    { id: "music", text: "♪" },
]

const BUBBLE_VISIBLE_MS = 1600
const BUBBLE_FADE_MS = 300
const COOLDOWN_MS = 1000
let lastReactionAt = 0

function getOwnReactionPosition() {
    const activeSpeakers = peekSetting("activeSpeakers") || {}
    if (game.user.isGM) {
        const position = peekSetting("editActiveSpeaker")
        return activeSpeakers[position] ? position : null
    }
    const characterId = game.user.character?.id
    if (!characterId) return null
    return Object.keys(activeSpeakers).find(position => activeSpeakers[position]?.id === characterId) || null
}

// Сокет не сообщает отправителя - userId приходит от клиента. Реакция косметическая, поэтому проверка
// только отсекает реакцию игрока на чужой портрет из штатного интерфейса другого клиента.
function isReactionAllowed(position, userId) {
    const user = game.users.get(userId)
    if (!user) return false
    if (user.isGM) return true
    return !!user.character && peekSetting("activeSpeakers")?.[position]?.id === user.character.id
}

export function showReaction(position, reactionId) {
    const reaction = REACTIONS.find(item => item.id === reactionId)
    const body = document.getElementById("vn-body")
    if (!reaction || !body) return
    // В режиме ряда портреты рисует собственный слой (main.js _updateRowLayer)
    const rowImage = document.querySelector(`#vn-fx-row-layer.vn-fx-active img[data-pos="${position}"]`)
    const slotElement = document.querySelector(`#vn-body .vn-pBody[data-pos="${position}"]`)
    const anchorRect = (rowImage || slotElement)?.getBoundingClientRect()
    if (!anchorRect || !anchorRect.width) return

    body.querySelector(`.vn-reaction-bubble[data-pos="${position}"]`)?.remove()
    const bubble = document.createElement("div")
    const isRightSide = position.startsWith("right")
    bubble.className = isRightSide ? "vn-reaction-bubble vn-reaction-right" : "vn-reaction-bubble"
    bubble.dataset.pos = position
    bubble.textContent = reaction.text
    // Кончик хвоста - над верхом слота (там голова персонажа); облако не выше шапки VN и не за краем экрана
    // (слева облако уходит вправо от кончика на ~58px, справа - влево)
    const tipX = anchorRect.left + anchorRect.width / 2
    bubble.style.left = `${isRightSide ? Math.max(Math.min(tipX, window.innerWidth - 16), 62) : Math.min(Math.max(tipX, 16), window.innerWidth - 62)}px`
    bubble.style.top = `${Math.max(anchorRect.top + anchorRect.height * 0.05, 90)}px`
    body.appendChild(bubble)
    setTimeout(() => bubble.classList.add("vn-reaction-out"), BUBBLE_VISIBLE_MS)
    setTimeout(() => bubble.remove(), BUBBLE_VISIBLE_MS + BUBBLE_FADE_MS)
}

export function sendReaction(reactionId) {
    if (!game.settings.get(C.ID, "playerReactions") || !allowTo("portraitInteraction")) return
    const now = Date.now()
    if (now - lastReactionAt < COOLDOWN_MS) return
    const position = getOwnReactionPosition()
    if (!position) {
        ui.notifications.warn(game.i18n.localize(`${C.ID}.reactions.${game.user.isGM ? "noTarget" : "noCharacter"}`))
        return
    }
    lastReactionAt = now
    showReaction(position, reactionId)
    game.socket.emit(`module.${C.ID}`, { type: "vnReaction", data: { position, reactionId, userId: game.user.id } })
}

export function receiveReaction(data) {
    if (!game.settings.get(C.ID, "playerReactions") || !isReactionAllowed(data.position, data.userId)) return
    showReaction(data.position, data.reactionId)
}

// Кнопка-смайлик в левом нижнем углу (mainApp/foreground.hbs, data-action="reactionMenu") открывает ряд вариантов
export function toggleReactionMenu(buttonElement) {
    const existingMenu = document.getElementById("vn-reaction-menu")
    if (existingMenu) {
        existingMenu.remove()
        return
    }
    const menu = document.createElement("div")
    menu.id = "vn-reaction-menu"
    menu.className = "vn-reaction-menu flexrow"
    REACTIONS.forEach(reaction => {
        const optionElement = document.createElement("div")
        optionElement.className = "vn-square-button vn-reaction-option"
        optionElement.textContent = reaction.text
        optionElement.dataset.tooltip = game.i18n.localize(`${C.ID}.reactions.${reaction.id}`)
        optionElement.addEventListener("click", () => {
            sendReaction(reaction.id)
            menu.remove()
        })
        menu.appendChild(optionElement)
    })
    const buttonRect = buttonElement.getBoundingClientRect()
    menu.style.left = `${buttonRect.right + 8}px`
    menu.style.bottom = `${window.innerHeight - buttonRect.bottom}px`
    document.getElementById("vn-body")?.appendChild(menu)
}
