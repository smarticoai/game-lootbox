const gameTitle = document.getElementById('game-title');
const gameDescription = document.getElementById('game-header-description');
const loadingElement = document.getElementById('loading');
const gameContent = document.querySelector('.game-content');
const prizeCards = document.getElementById('game-cards');
const prizeCardContainer = document.getElementById('prize-card-container');
const scrollLeftButton = document.getElementById('scroll-left');
const scrollRightButton = document.getElementById('scroll-right');
const rulesText = document.getElementById('rules-button-text');
const modalContainer = document.getElementById('rules-modal');
const modalContentRules = document.getElementById('modal-content-rules');
const prizeModalContainer = document.getElementById('prize-modal');
const outOfStockModalContainer = document.getElementById('out-of-stock-modal');

let miniGames = [];
let selectedGame = {};
let prizes = [];
let playerInfo = {};
let isDragging = false;
let startX;
let scrollLeft;
let flippedCardsState = {};
let miniGamesHistory = [];
let openRules = false;
let cardClaimModal = false;
let translations = {};
const SCROLL_MOVE = 200;

// Prize availability status (isLocked, isMissed, isClaimed) by active time of the prize

const getPrizeStatus = (prize, index) => {
    let isLocked = false;
    let isMissed = false;
    let isClaimed = false;

    const today = new Date();
    const todayWeekday = new Date().getDay();
    const activeFrom = prize.active_from_ts ? new Date(prize.active_from_ts) : null;
    const activeTill = prize.active_till_ts ? new Date(prize.active_till_ts) : null;

    if (activeFrom) activeFrom.setHours(0, 0, 0, 0); // resetting active_from_ts to 00
    if (activeTill) activeTill.setHours(0, 0, 0, 0); // resetting active_till_ts to 00

    const historyItem = miniGamesHistory.find(
        (history) => history.saw_prize_id === prize.id && history.saw_template_id === selectedGame.id
    );

    if (historyItem) {
        isClaimed = historyItem.is_claimed;
    }

    if (index === 0) {
        isLocked = false;
    } else {
        if (activeFrom || activeTill) {
            isLocked = activeFrom && today < activeFrom;
            if (!isClaimed && (activeFrom && today > activeTill)) {
                isMissed = true;
                isLocked = false;
            }
        }

        if (prize.weekdays && prize.weekdays.length > 0) {
            const isTodayPrizeDay = prize.weekdays.includes(todayWeekday);

            if (isTodayPrizeDay) {
                isLocked = false;
                isMissed = false;
            } else {
                isLocked = true;

                if (!activeFrom && !activeTill) {
                    const closestWeekday = Math.min(
                        ...prize.weekdays.filter(day => day < todayWeekday)
                    );

                    if (!isClaimed && closestWeekday < todayWeekday) {
                        isMissed = true;
                        isLocked = false;
                    }
                }
            }
        }
    }

    return { isLocked, isMissed, isClaimed };
};

// Get correct weekday name, if the restricted date type is by weekdays

const getNextWeekdayDate = (weekdays) => {
    const today = new Date();
    const currentDay = today.getDay() === 0 ? 7 : today.getDay();
    const todayDate = today.setHours(0, 0, 0, 0);

    for (let i = 0; i < weekdays.length; i++) {
        const targetWeekday = weekdays[i];
        const daysUntilNext = targetWeekday - currentDay;
        const nextDate = new Date(todayDate);
        nextDate.setDate(today.getDate() + daysUntilNext);
        return nextDate;
    }

    return today; 
};

const onDragStart = (e) => {
    isDragging = true;
    startX = e.pageX - prizeCardContainer.offsetLeft;
    scrollLeft = prizeCardContainer.scrollLeft;
};

const onDragMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - prizeCardContainer.offsetLeft;
    const walk = x - startX;
    prizeCardContainer.scrollLeft = scrollLeft - walk;
};

const onDragEnd = () => {
    isDragging = false;
};

const handleScroll = (e, direction) => {
    e.stopPropagation();
    if (prizeCardContainer) {
        const scrollAmount = direction === 'left' ? -SCROLL_MOVE : SCROLL_MOVE;
        prizeCardContainer.scrollBy({ top: 0, left: scrollAmount, behavior: 'smooth' });
    }
};

prizeCardContainer.addEventListener('mousedown', onDragStart);
prizeCardContainer.addEventListener('mousemove', onDragMove);
prizeCardContainer.addEventListener('mouseup', onDragEnd);
prizeCardContainer.addEventListener('mouseleave', onDragEnd);
scrollLeftButton.addEventListener('mousedown', (e) => handleScroll(e, "left"));
scrollRightButton.addEventListener('mousedown', (e) => handleScroll(e, "right"));

// Initial loading of game, prizes, history and translations

const loadMiniGames = async (saw_template_id, lang) => {
    if (window._smartico) {
        try {
            loadingElement.style.display = 'flex';
            gameContent.style.display = 'none';

            const games = await window._smartico.api.getMiniGames();
            const userInfo = await window._smartico.getPublicProps();

            miniGames = games;
            playerInfo = userInfo;
            selectedGame = miniGames.find((g) => g.id === parseInt(saw_template_id, 10));
            prizes = selectedGame.prizes;

            const gamesHistory = await window._smartico.api.getMiniGamesHistory({ limit: 100, offset: 0, saw_template_id: saw_template_id });
            miniGamesHistory = gamesHistory;

            const gameLanguage = lang.toUpperCase();
            const gameTranslations = await window._smartico.api.getTranslations(gameLanguage);
            translations = gameTranslations.translations;

            if (selectedGame) {
                gameTitle.innerHTML = selectedGame.name;
                gameDescription.innerHTML = selectedGame.promo_text;
                rulesText.innerHTML = translations.rules;
                renderPrizeCards(lang);
            }

        } catch (error) {
            console.error('Error fetching mini-games:', error);
            gameTitle.innerHTML = 'Error loading name!';
            gameDescription.innerHTML = 'Error loading description';
            rulesText.innerHTML = '';
        } finally {
            loadingElement.style.display = 'none';
            gameContent.style.display = 'flex';
        }
    }
};

const handleOpenRules = () => {
	openRules = true;
	renderModalRules();
};

const handleCloseRules = () => {
	openRules = false;
	modalContainer.innerHTML = '';
};

const renderModalRules = () => {
	if (!openRules && !modalContainer) {
		modalContainer.innerHTML = '';
		return;
	}

	modalContainer.innerHTML = `
        <div class="modal-wrapper ${openRules ? 'active' : ''}">
            <div class="modal-content">
                <div class="modal-content-text">
                    <div class="modal-content-title" id="modal-content-title">${translations.rules}</div>
                    <div class="modal-content-rules" id="modal-content-rules">
                    </div>
                </div>
                <div class="modal-content-button" onclick="handleCloseRules();">
                    <div class="modal-content-button-text" id="back-button-text"></div>
                </div>
            </div>
        </div>
    `;
	const modalContentRules = document.getElementById('modal-content-rules');
	const backText = document.getElementById('back-button-text');

	if (modalContentRules && backText) {
		modalContentRules.innerHTML = selectedGame.description;
		backText.innerHTML = translations.backToGame;
	}
};

const handlePrizeFlip = async (prize, index) => {
    const { isLocked, isMissed, isClaimed } = getPrizeStatus(prize, index);

    if (isLocked || isMissed || flippedCardsState[prize.id]) return;

    const acknowledgeWithClaim = prize.acknowledge_type === 'explicity-acknowledge';

    const cardElement = document.querySelector(`.prize-card[data-index="${prize.id}"]`);
    if (cardElement && !isClaimed) {
        cardElement.classList.add('flip');
        flippedCardsState[prize.id] = true;
        if (!acknowledgeWithClaim) {
            setTimeout(() => {
                handleOpenPrizeModal(prize);
            }, 2000)
        }
    }
};

// Use this function on order to trigger playMiniGame event and claim your prize

const handleClaimPrizeInModal = async () => {
    try {
        const { prize_id } = await window._smartico.api.playMiniGame(selectedGame.id);
        const prize = prizes.find((p) => p.id === prize_id);

        flippedCardsState[prize.id] = true;

        const updatedHistory = await window._smartico.api.getMiniGamesHistory({ limit: 100, offset: 0, saw_template_id: selectedGame.id });
        miniGamesHistory = updatedHistory;
        const historyItem = miniGamesHistory.find(
            (history) => history.saw_prize_id === prize.id && history.saw_template_id === selectedGame.id
        );
        if (historyItem) {
            historyItem.is_claimed = true;
        }

        handleClosePrizeModal();
        renderPrizeCards();

    } catch (error) {
        console.error(`Failed to flip prize card ${prize.id}:`, error);
    }
}


const renderPrizeCards = (lang) => {
    if (!prizeCards || !prizes || prizes.length === 0) {
        prizeCards.innerHTML = '';
        return;
    }

    const currentDate = new Date();
    let activePrizeId = null;

    prizeCards.innerHTML = '';

    // Sort prizes by active_from_ts or by weekdays
    prizes.sort((a, b) => {
        const activeFromA = a.active_from_ts || 0;
        const activeFromB = b.active_from_ts || 0;

        if (activeFromA !== activeFromB) {
            return activeFromA - activeFromB;
        }

        const firstWeekdayA = a.weekdays && a.weekdays.length > 0 ? Math.min(...a.weekdays) : [];
        const firstWeekdayB = b.weekdays && b.weekdays.length > 0 ? Math.min(...b.weekdays) : [];

        return firstWeekdayA - firstWeekdayB;
    });

    let defaultPrizeDate = 'Available';
    const firstActivePrize = prizes.find(prize => prize.active_from_ts);
    const firstActiveWeekdayPrize = prizes.find(prize => prize.weekdays && prize.weekdays.length > 0);

    if (firstActivePrize && firstActivePrize.active_from_ts) {
        const firstActiveDate = new Date(firstActivePrize.active_from_ts);
        firstActiveDate.setDate(firstActiveDate.getDate() - 1);
        defaultPrizeDate = firstActiveDate.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
    } else {
        const currentWeekday = currentDate.getDay() || 7;
        const closestWeekday = firstActiveWeekdayPrize.weekdays.sort((a, b) => a - b)
        .find(day => day > currentWeekday) || firstActiveWeekdayPrize.weekdays[0];

        const firstActiveWeekdayDate = new Date(currentDate);
        const dayDifference = (closestWeekday - currentWeekday) % 7 || 7;
        firstActiveWeekdayDate.setDate(currentDate.getDate() + dayDifference);
        firstActiveWeekdayDate.setDate(firstActiveWeekdayDate.getDate() - 1);
        defaultPrizeDate = firstActiveWeekdayDate.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
    }

    prizes.forEach((prize, index) => {
        let monthDate = '';
        let isActivePrize = false;

        const acknowledgeWithClaim = prize.acknowledge_type === 'explicity-acknowledge';

        const { isLocked, isMissed, isClaimed } = getPrizeStatus(prize, index);

        // Proper naming of the month depending on the restriction type (by days/weekdays)

        if (index === 0) {
            monthDate = defaultPrizeDate;
        } else {
            if (prize.active_from_ts) {
                const activeDate = new Date(prize.active_from_ts);
                monthDate = activeDate.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
                const activeFrom = new Date(prize.active_from_ts);
                const activeTill = new Date(prize.active_till_ts);
                if (currentDate >= activeFrom && currentDate <= activeTill) {
                        activePrizeId = prize.id;
                        isActivePrize = true;
                }
            
            } else if (prize.weekdays && prize.weekdays.length > 0) {
                const nextWeekdayDate = getNextWeekdayDate(prize.weekdays);
                monthDate = nextWeekdayDate.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
                if (index === 0) {
                    monthDate = defaultPrizeDate;
                }
            } else {
                monthDate = 'Date Unknown';
            }
        }

        const prizeCardHTML = `
         <div class="prize-card ${isLocked ? 'locked' : ''} ${isMissed ? 'missed' : ''} ${isActivePrize ? 'active-prize' : ''} ${isClaimed ? 'claimed' : ''}" data-index=${prize.id}>
                    <div class="prize-card-content ${isMissed ? 'missed' : ''} ${isActivePrize ? 'active-prize' : ''} ${isClaimed ? 'claimed' : ''}">
                        <div class="front-side">
                            <div class="prize-number top">${monthDate}</div>
                            <div class="prize-number bottom">${monthDate}</div>
                        </div>
                        <div class="back-side ${isMissed ? 'missed' : ''}">
                            <div class="prize-number top">${monthDate}</div>
                            <div class="prize-content">
                                ${isActivePrize
                                    ? `<div class="prize-front-prize-name">${prize.name}</div>`
                                    : ''}
                                <img class="prize-front-image" src=${prize.icon} alt="prize-icon" draggable="false"></img>
                                ${isActivePrize && acknowledgeWithClaim && !isClaimed
                                    ? `<div class="prize-claim-btn">
                                            <div class="prize-claim-btn-text">${translations.claimPrize}</div>
                                        </div>`
                                    : ''}
                            </div>
                            <div class="prize-number bottom">${monthDate}</div>
                        </div>
                        <div class="prize-card-bottom-glow ${isActivePrize ? 'active-prize': ''} ${isClaimed ? 'claimed' : ''}"></div>
                    </div>
                </div>
        `;

        prizeCards.innerHTML += prizeCardHTML;

        if (isClaimed) {
            const cardElement = document.querySelector(`.prize-card[data-index="${prize.id}"]`);
            if (cardElement) {
                cardElement.classList.add('flip');
                flippedCardsState[prize.id] = true;
            }
        }

        // scroll into an active prize card both on mobile and desktop
        const activePrizeCard = document.querySelector(`.prize-card[data-index="${activePrizeId}"]`);
        if (activePrizeId && prizeCardContainer) {
            setTimeout(() => {
                if (activePrizeCard) {
                    activePrizeCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' });
                }
            }, 300);
        }
    });

    prizes.forEach((prize, index) => {
        const cardElement = document.querySelector(`.prize-card[data-index="${prize.id}"]`);
        if (cardElement) {
            cardElement.addEventListener('click', () => handlePrizeFlip(prize, index));
        }
        const claimButtonElement = document.querySelector(`.prize-card[data-index="${prize.id}"] .prize-claim-btn`);
        if (claimButtonElement) {
            claimButtonElement.addEventListener('click', (event) => {
                event.stopPropagation();
                handleOpenPrizeModal(prize);
            });
        }
    });
}

const handleOpenPrizeModal = (prize) => {
    cardClaimModal = true;
	renderPrizeModal(prize);
}

const handleClosePrizeModal = () => {
    cardClaimModal = false;
    prizeModalContainer.innerHTML = ''
}


const renderPrizeModal = (prize) => {
    if (!cardClaimModal && !prizeModalContainer) {
        prizeModalContainer.innerHTML = '';
        return
    }
    const acknowledgeWithClaim = prize?.acknowledge_type === 'explicity-acknowledge';
    const acknowledgeMessage = prize?.aknowledge_message ?? `You've mastered today's challenge and uncovered a sweet Halloween treat!`

    prizeModalContainer.innerHTML = `
            <div class="modal-prize-wrapper active">
                <div class="modal-prize-card">
                    <div class="modal-close-button" onclick="handleClosePrizeModal();">
                        <div class="close-btn"></div>
                    </div>
                     <div class="modal-prize-content">
                        <div class="modal-prize-text-content">
                            <div class="modal-prize-title">${translations.claimPrizeSuccess}</div>
                            <div class="modal-prize-message">
                                ${acknowledgeMessage}
                            </div>
                        </div>
                        <div class="modal-prize-buttons ${acknowledgeWithClaim ? 'two-btns' : ''}">
                            <div class="modal-prize-button" id="main-claim-btn">
                                <div class="modal-prize-button-text">${prize?.acknowledge_action_title}</div>
                            </div>
                        ${acknowledgeWithClaim
                            ? `<div class="modal-prize-button cancel" onclick="handleClosePrizeModal();">
                                <div class="modal-prize-button-text cancel">${prize?.acknowledge_action_title_additional}</div>
                                </div>`
                            : ''
                        }
                        </div>
                    </div>
                </div>
            </div>
        `;

        const mainClaimButton = document.getElementById('main-claim-btn');
        if (mainClaimButton) {
            mainClaimButton.addEventListener('click', (event) => {
                event.stopPropagation();
                handleClaimPrizeInModal();
            })
        }
}

const initializeGame = (saw_template_id, lang) => {
    loadMiniGames(saw_template_id, lang);
};