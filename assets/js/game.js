/**
 * Smartico Lootbox Game - Vanilla JS Implementation
 * 
 * This file implements a lootbox/calendar prize game that integrates with the Smartico platform.
 * It supports both date-based and weekday-based prize schedules, timezone handling,
 * prize grouping, and proper error handling.
 * 
 * Key Features:
 * - Prize grouping: Multiple prizes on the same day are grouped together
 * - Timezone support: Respects max_give_period_type_id for UTC vs user timezone
 * - Error handling: Specific messages for max attempts, out of stock, segment requirements
 * - Layout support: Prepared for both card (horizontal) and map (vertical) layouts
 */

// ============================================
// CONSTANTS & ENUMS
// ============================================

/**
 * AttemptPeriodType - Determines how prize availability windows are calculated
 * @property {number} FromLastAttempt - Time-based from last attempt
 * @property {number} CalendarDaysUTC - Calendar days in UTC timezone (uses relative_period_timezone offset)
 * @property {number} CalendarDaysUserTimeZone - Calendar days in user's local timezone
 * @property {number} Lifetime - One-time lifetime prize
 */
const AttemptPeriodType = {
    FromLastAttempt: 1,
    CalendarDaysUTC: 2,
    CalendarDaysUserTimeZone: 3,
    Lifetime: 4
};

/**
 * SAWGameLayout - Determines the visual layout of the game
 * @property {number} Horizontal - Card-based horizontal scrolling layout
 * @property {number} VerticalMap - Vertical map layout with positioned prizes
 */
const SAWGameLayout = {
    Horizontal: 1,
    VerticalMap: 2
};

/**
 * SAWSpinErrorCode - Error codes returned by the API when spinning fails
 * These match the server-side error codes from public-api
 */
const SAWSpinErrorCode = {
    SAW_OK: 0,
    SAW_NO_SPINS: 40001,
    SAW_PRIZE_POOL_EMPTY: 40002,
    SAW_NOT_ENOUGH_POINTS: 40003,
    SAW_FAILED_MAX_SPINS_REACHED: 40004,
    SAW_TEMPLATE_NOT_ACTIVE: 40007,
    SAW_VISITOR_STOP_SPIN_REQUEST: -40001,
    SAW_NOT_IN_SEGMENT: 40009,
    SAW_NO_BALANCE_GEMS: 40011,
    SAW_NO_BALANCE_DIAMONDS: 40012
};

const SCROLL_MOVE = 200;

// ============================================
// DOM ELEMENTS - Cards Layout
// ============================================

const gameTitle = document.getElementById('game-title');
const gameDescription = document.getElementById('game-header-description');
const loadingElement = document.getElementById('loading');
const cardsLayout = document.getElementById('cards-layout');
const prizeCards = document.getElementById('game-cards');
const prizeCardContainer = document.getElementById('prize-card-container');
const scrollLeftButton = document.getElementById('scroll-left');
const scrollRightButton = document.getElementById('scroll-right');
const rulesText = document.getElementById('rules-button-text');
const modalContainer = document.getElementById('rules-modal');
const prizeModalContainer = document.getElementById('prize-modal');
const errorModalContainer = document.getElementById('error-modal');

// ============================================
// DOM ELEMENTS - Map Layout
// ============================================

const mapLayout = document.getElementById('map-layout');
const mapTitle = document.getElementById('map-title');
const mapMainBackground = document.getElementById('map-main-background');
const mapContainer = document.getElementById('map-container');
const mapPrizes = document.getElementById('map-prizes');
const mapHintIcon = document.getElementById('map-hint-icon');
const mapRulesText = document.getElementById('map-rules-button-text');
const mapOverlay = document.getElementById('map-overlay');
const mapPrizeWonModal = document.getElementById('map-prize-won-modal');

// ============================================
// STATE VARIABLES
// ============================================

let miniGames = [];
let selectedGame = {};
let prizes = [];
let groupedPrizes = [];
let playerInfo = {};
let isDragging = false;
let startX;
let startY;
let scrollLeft;
let scrollTop;
let flippedCardsState = {};
let miniGamesHistory = [];
let openRules = false;
let cardClaimModal = false;
let errorModal = false;
let translations = {};
let currentLanguage = 'en';

// Map Layout specific state
let currentLayout = SAWGameLayout.Horizontal;
let mapTapOverlayActive = false;
let mapPrizeWonModalActive = false;
let tapCount = 0;
let currentTapPrize = null;
let currentTapGroupId = null;
let showMapHint = true;
let currentMapSize = 'small';

// ============================================
// TIMEZONE UTILITIES
// ============================================

/**
 * Determines if the prize uses UTC-based calendar days for availability calculation.
 * When true, the prize availability is calculated using UTC time with an optional offset.
 * 
 * @param {Object} prize - The prize object
 * @param {number} [prize.max_give_period_type_id] - The period type (2 = UTC, 3 = user timezone)
 * @param {number} [prize.relative_period_timezone] - Minutes offset from UTC (e.g., 120 for UTC+2)
 * @returns {boolean} True if prize uses UTC timezone
 */
const isUTCTimezone = (prize) => {
    if (prize?.max_give_period_type_id !== undefined) {
        return prize.max_give_period_type_id === AttemptPeriodType.CalendarDaysUTC;
    }
    // Legacy fallback: if relative_period_timezone is defined, treat as UTC
    return prize?.relative_period_timezone !== undefined;
};

/**
 * Gets the current time adjusted for the prize's timezone context.
 * For UTC prizes, returns current time adjusted by the relative_period_timezone offset.
 * For user timezone prizes, returns the local time.
 * 
 * @param {Object} prize - The prize object
 * @returns {Date} Current date/time in the prize's timezone context
 */
const getPrizeTimezoneNow = (prize) => {
    if (isUTCTimezone(prize)) {
        const now = new Date();
        // Convert to UTC milliseconds
        const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
        // Apply the prize's timezone offset (relative_period_timezone is in minutes)
        const offsetMs = (prize?.relative_period_timezone || 0) * 60000;
        return new Date(utcMs + offsetMs);
    }
    return new Date();
};

/**
 * Adjusts a timestamp for the prize's timezone.
 * For UTC prizes, adds the relative_period_timezone offset to the timestamp.
 * 
 * @param {number} ts - Timestamp in milliseconds
 * @param {Object} prize - The prize object
 * @returns {number|null} Adjusted timestamp or null if ts is falsy
 */
const adjustTimestampForPrize = (ts, prize) => {
    if (!ts) return null;
    if (isUTCTimezone(prize)) {
        return ts + ((prize?.relative_period_timezone || 0) * 60000);
    }
    return ts;
};

/**
 * Converts a history timestamp to a Date in the prize's timezone context.
 * Used for comparing history entries against prize availability windows.
 * 
 * @param {number} historyTs - History timestamp in milliseconds
 * @param {Object} prize - The prize object
 * @returns {Date} Date object representing the history time in prize's timezone
 */
const getHistoryDateForPrize = (historyTs, prize) => {
    if (isUTCTimezone(prize)) {
        const date = new Date(historyTs);
        const utcMs = date.getTime() + (date.getTimezoneOffset() * 60000);
        const offsetMs = (prize?.relative_period_timezone || 0) * 60000;
        return new Date(utcMs + offsetMs);
    }
    return new Date(historyTs);
};

/**
 * Gets the ISO week number from a Date object.
 * ISO weeks start on Monday and the first week contains January 4th.
 * 
 * @param {Date} date - The date to get week number from
 * @returns {number} ISO week number (1-53)
 */
const getISOWeekNumber = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    // Set to nearest Thursday: current date + 4 - current day number (make Sunday=7)
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    // Get first day of year
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    // Calculate full weeks to nearest Thursday
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return weekNo;
};

/**
 * Gets the ISO week year from a Date object.
 * The ISO week year may differ from the calendar year at year boundaries.
 * 
 * @param {Date} date - The date to get ISO week year from
 * @returns {number} ISO week year
 */
const getISOWeekYear = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    return d.getUTCFullYear();
};

/**
 * Gets the ISO weekday (1=Monday, 7=Sunday) from a Date object.
 * JavaScript's getDay() returns 0=Sunday, so we convert to ISO format.
 * 
 * @param {Date} date - The date to get weekday from
 * @returns {number} ISO weekday (1-7, where 1=Monday, 7=Sunday)
 */
const getISOWeekday = (date) => {
    const day = date.getDay();
    return day === 0 ? 7 : day;
};

// ============================================
// PRIZE GROUPING & SORTING
// ============================================

/**
 * Sorts prizes by multiple criteria to ensure consistent ordering.
 * Sort order: prize ID → surcharge status → active_from_ts → first weekday
 * 
 * @param {Array} prizes - Array of prize objects
 * @returns {Array} Sorted array of prizes (mutates original)
 */
const sortPrizes = (prizes) => {
    return prizes.sort((a, b) => {
        // 1. Sort by prize ID (TMiniGamePrize uses 'id')
        const prizeIdA = a.id || 0;
        const prizeIdB = b.id || 0;
        if (prizeIdA !== prizeIdB) {
            return prizeIdA - prizeIdB;
        }

        // 2. Sort by surcharge status (non-surcharge first)
        const surchargeA = a.is_surcharge ? 1 : 0;
        const surchargeB = b.is_surcharge ? 1 : 0;
        if (surchargeA !== surchargeB) {
            return surchargeB - surchargeA;
        }

        // 3. Sort by active_from_ts
        const activeFromA = a.active_from_ts || 0;
        const activeFromB = b.active_from_ts || 0;
        if (activeFromA !== activeFromB) {
            return activeFromA - activeFromB;
        }

        // 4. Sort by first weekday
        const firstWeekdayA = a.weekdays && a.weekdays.length > 0 ? Math.min(...a.weekdays) : 0;
        const firstWeekdayB = b.weekdays && b.weekdays.length > 0 ? Math.min(...b.weekdays) : 0;
        return firstWeekdayA - firstWeekdayB;
    });
};

/**
 * Groups prizes by their availability date or weekday.
 * This allows multiple prizes to be shown on the same day/card.
 * 
 * For weekday-based prizes: groupId is the ISO weekday (1-7)
 * For date-based prizes: groupId is the active_from_ts timestamp
 * 
 * @param {Array} prizes - Array of prize objects
 * @returns {Array} Array of {groupId, prizes} objects sorted by groupId
 */
const groupPrizesByDate = (prizes) => {
    // Sort prizes first for consistent ordering
    const sortedPrizes = sortPrizes([...prizes]);

    // Filter to valid prizes (must have either date range or weekdays)
    const filteredPrizes = sortedPrizes.filter(prize =>
        (prize.active_from_ts && prize.active_till_ts) ||
        (prize.weekdays && prize.weekdays.length > 0)
    );

    if (filteredPrizes.length === 0) {
        return [];
    }

    // Determine if all prizes use weekdays (vs calendar dates)
    const isWeekdays = filteredPrizes.every(prize => prize.weekdays && prize.weekdays.length > 0);

    // Collect unique group keys
    const groupKeys = new Set();
    filteredPrizes.forEach(prize => {
        if (isWeekdays) {
            // For weekday prizes, each weekday in the array is a potential group
            prize.weekdays.forEach(day => groupKeys.add(day));
        } else {
            // For date prizes, use active_from_ts as the group key
            groupKeys.add(prize.active_from_ts);
        }
    });

    // Build groups: each group contains all prizes that belong to that date/weekday
    const groups = Array.from(groupKeys).map(groupId => ({
        groupId,
        prizes: filteredPrizes.filter(prize =>
            isWeekdays
                ? prize.weekdays.includes(groupId)
                : prize.active_from_ts === groupId
        )
    }));

    // Sort groups by groupId ascending
    return groups.sort((a, b) => a.groupId - b.groupId);
};

/**
 * Finds the currently active prize ID from grouped prizes.
 * Returns the first prize that is currently within its active window.
 * 
 * @param {Array} groupedPrizes - Array of {groupId, prizes} objects
 * @returns {number|null} The ID of the active prize, or null if none active
 */
const getActivePrizeId = (groupedPrizes) => {
    for (const { prizes } of groupedPrizes) {
        for (const prize of prizes) {
            const prizeNow = getPrizeTimezoneNow(prize);
            const today = prizeNow.getTime();
            const todayWeekday = getISOWeekday(prizeNow);

            // Check weekday-based activation
            if (prize.weekdays && prize.weekdays.length > 0) {
                const sortedWeekdays = [...prize.weekdays].sort((a, b) => a - b);
                const activeWeekday = sortedWeekdays.find(day => day >= todayWeekday);
                if (activeWeekday === todayWeekday) {
                    return prize.id;
                }
            }

            // Check timestamp-based activation
            const adjustedFrom = adjustTimestampForPrize(prize.active_from_ts, prize);
            const adjustedTill = adjustTimestampForPrize(prize.active_till_ts, prize);
            if (adjustedFrom && adjustedTill && today >= adjustedFrom && today <= adjustedTill) {
                return prize.id;
            }
        }
    }
    return null;
};

// ============================================
// PRIZE STATUS CALCULATION
// ============================================

/**
 * Calculates the complete status of a prize for a specific group.
 * This includes claimed/acknowledged state, locked/missed state, active state, and stock status.
 * 
 * @param {Object} prize - The prize object (either prizeWon from history or default prizesToShow)
 * @param {number} groupId - The group identifier (weekday or timestamp)
 * @param {Object|null} historyItem - The history item if prize was won, null otherwise
 * @returns {Object} Status object with isLocked, isMissed, isClaimed, isActive, isOutOfStock, isAcknowledged
 */
const getPrizeStatus = (prize, groupId, historyItem = null) => {
    if (!prize || groupId === undefined) {
        return {
            isLocked: false,
            isMissed: false,
            isClaimed: false,
            isActive: false,
            isOutOfStock: false,
            isAcknowledged: false
        };
    }

    const prizeNow = getPrizeTimezoneNow(prize);
    const today = prizeNow.getTime();
    const todayWeekday = getISOWeekday(prizeNow);

    // Adjust timestamps for timezone
    const adjustedFrom = adjustTimestampForPrize(prize.active_from_ts, prize);
    const adjustedTill = adjustTimestampForPrize(prize.active_till_ts, prize);
    const activeFrom = prize.active_from_ts ? adjustedFrom : null;
    const activeTill = prize.active_till_ts ? adjustedTill : null;

    // Claimed/acknowledged status from history item
    const isClaimed = !!historyItem?.create_date_ts;
    const isAcknowledged = !!historyItem?.acknowledge_date_ts;

    // Determine if prize is active today
    const isWeekdayBased = prize.weekdays && prize.weekdays.length > 0;
    const firstAvailableDay = prize.weekdays?.find(day => day === groupId);
    const isWeekdayTodaysPrize = firstAvailableDay === todayWeekday;
    const isTimestampTodaysPrize = activeFrom && activeTill && today >= activeFrom && today <= activeTill;
    const isActive = isTimestampTodaysPrize || isWeekdayTodaysPrize;

    // Calculate locked/missed status
    let isLocked = false;
    let isMissed = false;

    // Date-based prizes
    if (activeFrom || activeTill) {
        isLocked = !!(activeFrom && today < activeFrom);
        if (!isClaimed && activeFrom && today > activeTill) {
            isMissed = true;
            isLocked = false;
        }
    }

    // Weekday-based prizes (may override date-based logic)
    if (isWeekdayBased) {
        if (isWeekdayTodaysPrize) {
            isLocked = false;
            isMissed = false;
        } else {
            isLocked = !isClaimed;
            const firstWeekday = prize.weekdays[0];

            if (firstWeekday && firstWeekday < todayWeekday && !isClaimed) {
                isMissed = true;
                isLocked = false;
            }

            if (firstWeekday && firstWeekday > todayWeekday && !isClaimed) {
                isLocked = true;
                isMissed = false;
            }
        }
    }

    // Out of stock check: pool is 0, not claimed, and not a surcharge prize
    const isOutOfStock = !isClaimed && prize.pool === 0 && !prize.is_surcharge;

    return { isLocked, isMissed, isClaimed, isActive, isOutOfStock, isAcknowledged };
};

// ============================================
// HISTORY MATCHING
// ============================================

/**
 * Checks the game history to determine if a prize was claimed/acknowledged for a specific group.
 * Handles both weekday-based and date-based prize matching with proper timezone awareness.
 * 
 * @param {Object} prize - The prize object
 * @param {number} groupId - The group identifier
 * @param {Date} prizeNow - Current time in prize's timezone
 * @param {boolean} useUtc - Whether to use UTC calculations
 * @param {number} activeFrom - Adjusted active_from_ts
 * @param {number} activeTill - Adjusted active_till_ts
 * @returns {Object} {isClaimed, isAcknowledged}
 */
/**
 * Finds a prize from history that matches the current group.
 * Similar to the React useEffect that finds prizeWon from history.
 * 
 * For weekday-based prizes: only matches history items from the CURRENT week.
 * For calendar day prizes: only matches history items within the prize's active period.
 * 
 * @param {Array} groupPrizes - All prizes in this group
 * @param {number} groupId - The group identifier (weekday or active_from_ts)
 * @returns {Object|null} The prize from history if found, null otherwise
 */
const findPrizeWonFromHistory = (groupPrizes, groupId) => {
    const isWeekdays = groupPrizes.every(prize => prize.weekdays && prize.weekdays.length > 0);

    for (const prize of groupPrizes) {
        const historyItem = miniGamesHistory.find(history => {
            // history.saw_prize_id matches prize.id (from TMiniGamePrize)
            if (history.saw_prize_id !== prize.id) {
                return false;
            }

            const historyDate = getHistoryDateForPrize(history.create_date_ts, prize);
            const historyWeekday = getISOWeekday(historyDate);
            const useUtc = isUTCTimezone(prize);

            // Get current time in prize's timezone
            const timezoneNow = getPrizeTimezoneNow(prize);
            const currentWeek = getISOWeekNumber(timezoneNow);
            const currentYear = getISOWeekYear(timezoneNow);

            const adjustedFrom = adjustTimestampForPrize(prize.active_from_ts, prize);
            const adjustedTill = adjustTimestampForPrize(prize.active_till_ts, prize);
            const activeFrom = prize.active_from_ts ? adjustedFrom : null;
            const activeTill = prize.active_till_ts ? adjustedTill : null;

            if (isWeekdays) {
                // For weekday-based prizes: check if history is from current week AND matches groupId
                const historyWeek = getISOWeekNumber(historyDate);
                const historyYear = getISOWeekYear(historyDate);

                const isCurrentWeek = historyWeek === currentWeek && historyYear === currentYear;
                const isCurrentWeekday = prize.weekdays?.some(day => day === historyWeekday && day === groupId);

                return isCurrentWeek && isCurrentWeekday && historyWeekday === groupId;
            } else {
                // For calendar day prizes: check if history falls within the prize's active period
                let isCurrentCalendarDay = false;
                if (activeFrom && activeTill) {
                    const historyTs = historyDate.getTime();
                    if (useUtc) {
                        isCurrentCalendarDay = historyTs >= activeFrom && historyTs <= activeTill;
                    } else {
                        const fromDate = new Date(activeFrom);
                        fromDate.setHours(0, 0, 0, 0);
                        const tillDate = new Date(activeTill);
                        tillDate.setHours(23, 59, 59, 999);
                        isCurrentCalendarDay = historyTs >= fromDate.getTime() && historyTs <= tillDate.getTime();
                    }
                }

                return isCurrentCalendarDay && prize.active_from_ts === groupId;
            }
        });

        if (historyItem) {
            return { prize, historyItem };
        }
    }

    return null;
};

// ============================================
// DATE FORMATTING
// ============================================

/**
 * Gets the date to display for a weekday-based prize.
 * Calculates the actual calendar date for the prize's weekday in the current week.
 * 
 * @param {Object} prize - The prize object
 * @returns {Date} The target date for the prize's weekday
 */
const getWeekdayDate = (prize) => {
    const prizeNow = getPrizeTimezoneNow(prize);
    const currentDay = getISOWeekday(prizeNow);
    const targetWeekday = prize.weekdays[0];

    const daysDifference = targetWeekday - currentDay;

    const targetDate = new Date(prizeNow);
    targetDate.setDate(prizeNow.getDate() + daysDifference);

    return targetDate;
};

/**
 * Formats a prize's date for display on the card.
 * Handles both date-based and weekday-based prizes with timezone awareness.
 * 
 * @param {Object} prize - The prize object
 * @param {string} langCode - Language code for localization (e.g., 'en', 'de')
 * @returns {string} Formatted date string (e.g., "15 Feb")
 */
const getPrizeDate = (prize, langCode) => {
    const useUtc = isUTCTimezone(prize);

    if (prize.active_from_ts) {
        const date = useUtc
            ? new Date(prize.active_from_ts + ((prize?.relative_period_timezone || 0) * 60000))
            : new Date(prize.active_from_ts);
        return date.toLocaleDateString(langCode || 'en', { month: 'short', day: 'numeric' });
    } else if (prize.weekdays && prize.weekdays.length > 0) {
        const targetDate = getWeekdayDate(prize);
        return targetDate.toLocaleDateString(langCode || 'en', { month: 'short', day: 'numeric' });
    }

    return '';
};

// ============================================
// DRAG SCROLLING - Cards Layout
// ============================================

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

// ============================================
// DRAG SCROLLING - Map Layout
// ============================================

const onMapDragStart = (e) => {
    if (mapTapOverlayActive || mapPrizeWonModalActive) return;
    isDragging = true;
    startY = e.clientY;
    scrollTop = mapContainer.scrollTop;
    mapContainer.classList.add('dragging');
};

const onMapDragMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const dy = e.clientY - startY;
    mapContainer.scrollTop = scrollTop - dy;
};

const onMapDragEnd = () => {
    isDragging = false;
    if (mapContainer) {
        mapContainer.classList.remove('dragging');
    }
};

const onMapScroll = () => {
    if (mapContainer) {
        const shouldShowHint = mapContainer.scrollTop < 20;
        if (showMapHint !== shouldShowHint) {
            showMapHint = shouldShowHint;
            if (mapHintIcon) {
                mapHintIcon.classList.toggle('hidden', !showMapHint);
            }
        }
    }
};

// Set up drag scrolling event listeners for Cards Layout
if (prizeCardContainer) {
    prizeCardContainer.addEventListener('mousedown', onDragStart);
    prizeCardContainer.addEventListener('mousemove', onDragMove);
    prizeCardContainer.addEventListener('mouseup', onDragEnd);
    prizeCardContainer.addEventListener('mouseleave', onDragEnd);
}
if (scrollLeftButton) {
    scrollLeftButton.addEventListener('mousedown', (e) => handleScroll(e, "left"));
}
if (scrollRightButton) {
    scrollRightButton.addEventListener('mousedown', (e) => handleScroll(e, "right"));
}

// Set up drag scrolling event listeners for Map Layout
if (mapContainer) {
    // Mouse events
    mapContainer.addEventListener('mousedown', onMapDragStart);
    mapContainer.addEventListener('mousemove', onMapDragMove);
    mapContainer.addEventListener('mouseup', onMapDragEnd);
    mapContainer.addEventListener('mouseleave', onMapDragEnd);
    mapContainer.addEventListener('scroll', onMapScroll);

    // Touch events for mobile
    mapContainer.addEventListener('touchstart', (e) => {
        if (mapTapOverlayActive || mapPrizeWonModalActive) return;
        isDragging = true;
        startY = e.touches[0].clientY;
        scrollTop = mapContainer.scrollTop;
    }, { passive: true });

    mapContainer.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const dy = e.touches[0].clientY - startY;
        mapContainer.scrollTop = scrollTop - dy;
    }, { passive: true });

    mapContainer.addEventListener('touchend', onMapDragEnd);
}

// ============================================
// INITIALIZATION & LOADING
// ============================================

/**
 * Loads the mini game data from the Smartico API.
 * Fetches game templates, history, and translations, then renders the game.
 * Detects and switches between Cards and Map layouts automatically.
 * 
 * @param {number|string} saw_template_id - The template ID of the game to load
 * @param {string} lang - Language code for translations
 */
const loadMiniGames = async (saw_template_id, lang) => {
    if (!window._smartico) {
        console.error('Smartico SDK not loaded');
        return;
    }

    try {
        // Show loading spinner
        if (loadingElement) {
            loadingElement.style.display = 'flex';
            loadingElement.classList.remove('hidden');
        }

        // Hide both layouts initially
        if (cardsLayout) cardsLayout.style.display = 'none';
        if (mapLayout) mapLayout.style.display = 'none';

        // Fetch game data
        const games = await window._smartico.api.getMiniGames();
        const userInfo = await window._smartico.getPublicProps();

        miniGames = games;
        playerInfo = userInfo;
        selectedGame = miniGames.find((g) => g.id === parseInt(saw_template_id, 10));

        if (!selectedGame) {
            console.error('Game not found with ID:', saw_template_id);
            if (gameTitle) gameTitle.innerHTML = 'Game not found';
            if (gameDescription) gameDescription.innerHTML = 'Please check the game ID';
            return;
        }

        prizes = selectedGame.prizes || [];
        currentLanguage = lang;

        // Determine layout type from game template
        const gameLayout = selectedGame.saw_template_ui_definition?.game_layout || SAWGameLayout.Horizontal;
        currentLayout = gameLayout;

        console.log("selectedGame", selectedGame);
        console.log("game_layout", gameLayout);

        // Fetch history
        const gamesHistory = await window._smartico.api.getMiniGamesHistory({
            limit: 1000,
            offset: 0,
            saw_template_id: saw_template_id
        });
        miniGamesHistory = gamesHistory || [];

        // Fetch translations
        const gameLanguage = lang.toUpperCase();
        const gameTranslations = await window._smartico.api.getTranslations(gameLanguage);
        translations = gameTranslations?.translations || {};

        // Group prizes for rendering
        groupedPrizes = groupPrizesByDate(prizes);

        // Render based on layout type
        if (currentLayout === SAWGameLayout.VerticalMap) {
            // Map Layout
            console.log('Initializing Map Layout');
            initializeMapLayout(lang);
        } else {
            // Cards Layout (default)
            console.log('Initializing Cards Layout');
            initializeCardsLayout(lang);
        }
    } catch (error) {
        console.error('Error fetching mini-games:', error);
        if (gameTitle) gameTitle.innerHTML = 'Error loading game';
        if (gameDescription) gameDescription.innerHTML = error.message || 'Please try again later';
        if (rulesText) rulesText.innerHTML = '';
    } finally {
        // Hide loading spinner with smooth transition
        if (loadingElement) {
            loadingElement.classList.add('hidden');
            setTimeout(() => {
                loadingElement.style.display = 'none';
            }, 500);
        }
    }
};

/**
 * Initializes the Cards Layout (game_layout === 1)
 * @param {string} lang - Language code for translations
 */
const initializeCardsLayout = (lang) => {
    // Show cards layout, hide map layout
    if (cardsLayout) cardsLayout.style.display = 'flex';
    if (mapLayout) mapLayout.style.display = 'none';

    // Set header content
    if (gameTitle) gameTitle.innerHTML = selectedGame.name || '';
    if (gameDescription) gameDescription.innerHTML = selectedGame.promo_text || '';
    if (rulesText) rulesText.innerHTML = translations.rules || 'Rules';

    // Render prize cards
    renderPrizeCards(lang);
};

/**
 * Gets the natural dimensions of an image
 * @param {string} imageUrl - URL of the image
 * @returns {Promise<{width: number, height: number}>} Promise resolving to dimensions
 */
const getImageDimensions = (imageUrl) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            resolve({
                width: img.naturalWidth,
                height: img.naturalHeight
            });
        };
        img.onerror = (err) => reject(err);
        img.src = imageUrl;
    });
};

/**
 * Calculates and sets the aspect ratio for map background based on image dimensions
 * @returns {Promise<string>} Promise resolving to mapSize ('small', 'medium', 'big')
 */
const calculateMapAspectRatio = async () => {
    if (!mapMainBackground || !mapContainer) return 'small';

    const isMobile = window.innerWidth <= 768;
    const imageUrl = isMobile
        ? './assets/img/map/game-bg-mobile.jpeg'
        : './assets/img/map/game-bg.jpeg';

    try {
        const dims = await getImageDimensions(imageUrl);
        const containerDims = mapContainer.getBoundingClientRect();
        const threshold = isMobile ? 500 : 1000;
        const calculatedDimsWithThreshold = dims.height - threshold;

        // Set aspect ratio on map-main-background
        mapMainBackground.style.aspectRatio = `${dims.width} / ${dims.height}`;

        // Determine map size based on image height
        let mapSize = 'small';
        if (calculatedDimsWithThreshold > 1500 && calculatedDimsWithThreshold > containerDims.height) {
            mapSize = 'big';
        } else if (calculatedDimsWithThreshold > 1000 && calculatedDimsWithThreshold < 1500 && calculatedDimsWithThreshold > containerDims.height) {
            mapSize = 'medium';
        }

        return mapSize;
    } catch (error) {
        console.error('Error loading map background image:', error);
        return 'small';
    }
};

/**
 * Initializes the Map Layout (game_layout === 2)
 * @param {string} lang - Language code for translations
 */
const initializeMapLayout = async (lang) => {
    // Show map layout, hide cards layout
    if (mapLayout) mapLayout.style.display = 'flex';
    if (cardsLayout) cardsLayout.style.display = 'none';

    // Set header content with data-text attribute for ::before and ::after effects
    const gameName = selectedGame.name || '';
    if (mapTitle) {
        mapTitle.innerHTML = gameName;
        mapTitle.setAttribute('data-text', gameName);
    }
    if (mapRulesText) mapRulesText.innerHTML = translations.rules || 'Rules';

    // Set hint message
    const hintMessage = document.getElementById('map-hint-message');
    if (hintMessage) {
        hintMessage.innerHTML = translations.lootboxMapHintMessage || 'Drag up and down to navigate';
    }

    // Show hint icon initially
    if (mapHintIcon) {
        mapHintIcon.classList.remove('hidden');
        showMapHint = true;
    }

    // Calculate aspect ratio and get map size
    currentMapSize = await calculateMapAspectRatio();

    // Render map prizes with calculated mapSize
    renderMapPrizes(lang, currentMapSize);
};

// ============================================
// RENDERING FUNCTIONS
// ============================================

/**
 * Renders all prize cards for the horizontal layout.
 * Uses grouped prizes to show one card per group (date/weekday).
 * 
 * @param {string} lang - Language code for date formatting
 */
const renderPrizeCards = (lang) => {
    if (!prizeCards || groupedPrizes.length === 0) {
        if (prizeCards) prizeCards.innerHTML = '';
        return;
    }

    prizeCards.innerHTML = '';
    flippedCardsState = {};

    const activePrizeId = getActivePrizeId(groupedPrizes);

    // Render each group as a single card
    groupedPrizes.forEach(({ groupId, prizes: groupPrizes }, index) => {
        // Find default prize to show (first prize in group matching groupId)
        const isWeekdays = groupPrizes.every(p => p.weekdays && p.weekdays.length > 0);
        const prizesToShow = isWeekdays
            ? groupPrizes.find(p => p.weekdays?.[0] === groupId)
            : groupPrizes.find(p => p.active_from_ts === groupId);

        // Check if user won a prize from this group (from history)
        const prizeWonResult = findPrizeWonFromHistory(groupPrizes, groupId);
        const prizeWon = prizeWonResult?.prize;
        const historyItem = prizeWonResult?.historyItem;

        // Use prizeWon if available, otherwise use default prizesToShow
        const prize = prizeWon || prizesToShow || groupPrizes[0];

        // Calculate status using the history item
        const status = getPrizeStatus(prize, groupId, historyItem);
        const { isLocked, isMissed, isClaimed, isActive, isOutOfStock, isAcknowledged } = status;

        // For date display, always use prizesToShow (not prizeWon)
        const monthDate = getPrizeDate(prizesToShow || prize, lang);
        const prizeId = prize.id;

        // Determine if this is the active prize
        const prizeNow = getPrizeTimezoneNow(prize);
        const prizeTimezoneWeekday = getISOWeekday(prizeNow);
        const todayGroupId = prize.active_from_ts ? prize.active_from_ts : prizeTimezoneWeekday;
        const isTodayActiveGroup = groupId === todayGroupId;

        const isActivePrize = isTodayActiveGroup && isActive && !isOutOfStock;
        const isActivePrizeOutOfStock = isTodayActiveGroup && isActive && isOutOfStock;
        const isRenderedActive = isActivePrize || isActivePrizeOutOfStock;

        const explicitAcknowledge = prizeWon?.acknowledge_type === 'explicity-acknowledge';

        // Build the card HTML
        const cardClasses = [
            'prize-card',
            isLocked ? 'locked' : '',
            isMissed ? 'missed' : '',
            isRenderedActive ? 'active-prize' : '',
            isClaimed ? 'claimed flip' : ''
        ].filter(Boolean).join(' ');

        const contentClasses = [
            'prize-card-content',
            isMissed ? 'missed' : '',
            isRenderedActive ? 'active-prize' : '',
            isClaimed ? 'claimed flip' : ''
        ].filter(Boolean).join(' ');

        const prizeCardHTML = `
            <div class="${cardClasses}" data-index="${prizeId}" data-group-id="${groupId}">
                <div class="${contentClasses}">
                    <div class="front-side">
                        ${isLocked ? '<div class="locked-overlay"></div>' : ''}
                        <div class="prize-number top">${monthDate}</div>
                        <div class="prize-number bottom">${monthDate}</div>
                    </div>
                    <div class="back-side ${isMissed ? 'missed' : ''} ${isActivePrizeOutOfStock && !isClaimed ? 'out-of-stock' : ''}">
                        ${isMissed ? '<div class="missed-overlay"></div>' : ''}
                        <div class="prize-number top">${monthDate}</div>
                        <div class="prize-content">
                            ${(isClaimed || !isClaimed) && prizeWon
                ? `<div class="prize-front-prize-name">${prizeWon.name || ''}</div>`
                : ''}
                            ${isActivePrizeOutOfStock && !isClaimed
                ? `<div class="prize-out-of-stock-text">${prize.out_of_stock_message || translations.lootboxOutOfStockPrize || 'Out of stock'}</div>`
                : ''}
                            ${isClaimed && prizeWon
                ? (prizeWon.icon
                    ? `<img class="prize-front-image" src="${prizeWon.icon}" alt="prize-icon" draggable="false">`
                    : '<div class="prize-front-no-image"></div>')
                : ''}
                            ${isMissed
                ? (prize.icon
                    ? `<img class="prize-front-image" src="${prize.icon}" alt="prize-icon" draggable="false">`
                    : '<div class="prize-front-no-image"></div>')
                : ''}
                            ${isActivePrize && explicitAcknowledge && !isAcknowledged
                ? `<div class="prize-claim-btn">
                                        <div class="prize-claim-btn-text">${prizeWon?.acknowledge_action_title || translations.claimPrize || 'Claim'}</div>
                                    </div>`
                : ''}
                        </div>
                        <div class="prize-number bottom">${monthDate}</div>
                    </div>
                    <div class="prize-card-bottom-glow ${isRenderedActive ? 'active-prize' : ''} ${isClaimed ? 'claimed' : ''}"></div>
                </div>
            </div>
        `;

        prizeCards.innerHTML += prizeCardHTML;

        // Mark claimed cards as flipped
        if (isClaimed) {
            flippedCardsState[prizeId] = true;
        }
    });

    // Scroll to active prize card
    if (activePrizeId && prizeCardContainer) {
        setTimeout(() => {
            const activePrizeCard = document.querySelector(`.prize-card[data-index="${activePrizeId}"]`);
            if (activePrizeCard) {
                activePrizeCard.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' });
            }
        }, 300);
    }

    // Attach event listeners
    attachCardEventListeners();
};

/**
 * Attaches click event listeners to prize cards.
 */
const attachCardEventListeners = () => {
    groupedPrizes.forEach(({ prizes: groupPrizes, groupId }) => {
        // Find the actual prize being displayed (same logic as renderPrizeCards)
        const isWeekdays = groupPrizes.every(p => p.weekdays && p.weekdays.length > 0);
        const prizesToShow = isWeekdays
            ? groupPrizes.find(p => p.weekdays?.[0] === groupId)
            : groupPrizes.find(p => p.active_from_ts === groupId);

        const prizeWonResult = findPrizeWonFromHistory(groupPrizes, groupId);
        const prizeWon = prizeWonResult?.prize;
        const prize = prizeWon || prizesToShow || groupPrizes[0];
        const prizeId = prize.id;

        const cardElement = document.querySelector(`.prize-card[data-index="${prizeId}"]`);
        if (cardElement) {
            cardElement.addEventListener('click', () => handlePrizeFlip(prize, groupId, groupPrizes));
        }

        const claimButtonElement = document.querySelector(`.prize-card[data-index="${prizeId}"] .prize-claim-btn`);
        if (claimButtonElement) {
            claimButtonElement.addEventListener('click', (event) => {
                event.stopPropagation();
                handleOpenPrizeModal(prizeWon || prize);
            });
        }
    });
};

// ============================================
// EVENT HANDLERS
// ============================================

/**
 * Handles clicking on a prize card to flip it and attempt to win.
 * 
 * @param {Object} prize - The prize object (current display prize)
 * @param {number} groupId - The group identifier
 * @param {Array} groupPrizes - All prizes in this group (needed for history lookup)
 */
const handlePrizeFlip = async (prize, groupId, groupPrizes) => {
    const prizeId = prize.id;

    // Check if already won (from history)
    const prizeWonResult = findPrizeWonFromHistory(groupPrizes, groupId);
    const historyItem = prizeWonResult?.historyItem;
    const prizeWon = prizeWonResult?.prize;

    const status = getPrizeStatus(prize, groupId, historyItem);
    const { isLocked, isMissed, isClaimed, isOutOfStock, isActive, isAcknowledged } = status;

    // Don't allow flip for locked or missed cards
    if (isLocked || isMissed) {
        return;
    }

    // If already claimed/acknowledged - allow reopening the prize modal
    if ((isClaimed || isAcknowledged) && prizeWon) {
        handleOpenPrizeModal(prizeWon);
        return;
    }

    // If card is already flipped (during animation), prevent double-click
    if (flippedCardsState[prizeId]) {
        return;
    }

    // Show tooltip for out of stock prizes
    if (isOutOfStock) {
        const cardElement = document.querySelector(`.prize-card[data-index="${prizeId}"]`);
        if (cardElement) {
            // Flip briefly to show out of stock state
            cardElement.classList.add('flip');
            setTimeout(() => {
                const updatedResult = findPrizeWonFromHistory(groupPrizes, groupId);
                if (!updatedResult?.historyItem?.create_date_ts) {
                    cardElement.classList.remove('flip');
                }
            }, 2500);
        }
        return;
    }

    // Only spin for active, unclaimed prizes
    if (!isActive || isClaimed) {
        return;
    }

    const cardElement = document.querySelector(`.prize-card[data-index="${prizeId}"]`);
    if (cardElement) {
        cardElement.classList.add('flip');
        flippedCardsState[prizeId] = true;

        try {
            const response = await window._smartico.api.playMiniGame(selectedGame.id);
            const { err_code, err_message, prize_id } = response;

            if (err_code === SAWSpinErrorCode.SAW_OK) {
                // Success - find the won prize
                // prize_id from API response matches prize.id (TMiniGamePrize.id)
                const winPrize = prizes.find((p) => p.id === prize_id);
                if (winPrize) {
                    flippedCardsState[winPrize.id] = true;
                }

                // Refresh history from server
                const updatedHistory = await window._smartico.api.getMiniGamesHistory({
                    limit: 100,
                    offset: 0,
                    saw_template_id: selectedGame.id
                });
                miniGamesHistory = updatedHistory || [];

                // Immediately update the card content with won prize info
                updateCardWithWonPrize(cardElement, winPrize || prize, groupId);

                // Show prize modal after a short delay for animation
                const acknowledgeWithClaim = (winPrize || prize).acknowledge_type === 'explicity-acknowledge';
                if (!acknowledgeWithClaim) {
                    setTimeout(() => {
                        handleOpenPrizeModal(winPrize || prize);
                    }, 1500);
                }
            } else {
                // Error - handle based on error code
                handleSpinError(err_code, err_message, prize);
                cardElement.classList.remove('flip');
                flippedCardsState[prizeId] = false;
            }
        } catch (error) {
            console.error('Error playing mini game:', error);
            handleSpinError(null, error.message, prize);
            cardElement.classList.remove('flip');
            flippedCardsState[prizeId] = false;
        }
    }
};

/**
 * Updates a card element with the won prize information.
 * Called immediately after winning to show prize details on the card.
 * 
 * @param {HTMLElement} cardElement - The card DOM element
 * @param {Object} winPrize - The won prize object
 * @param {number} groupId - The group identifier
 */
const updateCardWithWonPrize = (cardElement, winPrize, groupId) => {
    if (!cardElement || !winPrize) return;

    // Add claimed class to the card
    cardElement.classList.add('claimed');

    const contentElement = cardElement.querySelector('.prize-card-content');
    if (contentElement) {
        contentElement.classList.add('claimed');
    }

    // Update the prize content on the back side
    const prizeContent = cardElement.querySelector('.back-side .prize-content');
    if (prizeContent) {
        // Build the won prize content
        let prizeHTML = '';

        // Prize name
        if (winPrize.name) {
            prizeHTML += `<div class="prize-front-prize-name">${winPrize.name}</div>`;
        }

        // Prize icon
        if (winPrize.icon) {
            prizeHTML += `<img class="prize-front-image" src="${winPrize.icon}" alt="prize-icon" draggable="false">`;
        } else {
            prizeHTML += '<div class="prize-front-no-image"></div>';
        }

        prizeContent.innerHTML = prizeHTML;
    }

    // Update the glow element
    const glowElement = cardElement.querySelector('.prize-card-bottom-glow');
    if (glowElement) {
        glowElement.classList.add('claimed');
    }
};

/**
 * Handles spin errors with specific messages based on error code.
 * Uses translation key format: translations['sawErrorCode' + errCode] for localized messages.
 * 
 * @param {number} errCode - The error code from the API
 * @param {string} errMessage - The error message from the API (optional fallback)
 * @param {Object} prize - The prize that was attempted
 */
const handleSpinError = (errCode, errMessage, prize) => {
    let title = translations.somethingWentWrong || 'Something went wrong';

    // Get translation using sawErrorCode + errCode pattern (e.g., sawErrorCode40001)
    const translatedMessage = translations['sawErrorCode' + errCode];
    let message = translatedMessage || errMessage;

    switch (errCode) {
        case SAWSpinErrorCode.SAW_FAILED_MAX_SPINS_REACHED:
            // Max spins reached - use over_limit_message from game template if available
            message = selectedGame?.over_limit_message || translatedMessage || errMessage || 'Maximum attempts reached';
            break;

        case SAWSpinErrorCode.SAW_NOT_IN_SEGMENT:
            // User not in segment - show requirements_to_get_prize if available
            title = translations.lootboxSegmentationErrorMessage || 'Requirements not met';
            message = prize?.requirements_to_get_prize || translatedMessage || errMessage || 'You do not meet the requirements for this prize';
            break;

        case SAWSpinErrorCode.SAW_TEMPLATE_NOT_ACTIVE:
            // Game template not active
            message = translatedMessage || errMessage || 'This game is not currently active';
            break;

        case SAWSpinErrorCode.SAW_PRIZE_POOL_EMPTY:
            // Prize pool is empty - use out_of_stock_message if available
            message = prize?.out_of_stock_message || translatedMessage || translations.lootboxOutOfStockPrize || 'This prize is out of stock';
            break;

        case SAWSpinErrorCode.SAW_NO_SPINS:
            // No spin attempts available
            message = translatedMessage || errMessage || 'No spin attempts available';
            break;

        case SAWSpinErrorCode.SAW_NOT_ENOUGH_POINTS:
            // Not enough points
            message = translatedMessage || errMessage || 'Not enough points to play';
            break;

        case SAWSpinErrorCode.SAW_NO_BALANCE_GEMS:
            // Not enough gems
            message = translatedMessage || errMessage || 'Not enough gems to play';
            break;

        case SAWSpinErrorCode.SAW_NO_BALANCE_DIAMONDS:
            // Not enough diamonds
            message = translatedMessage || errMessage || 'Not enough diamonds to play';
            break;

        default:
            // Generic error handling - try translation first, then fallback
            message = translatedMessage || errMessage || translations.tryAgainLater || 'Please try again later';
    }

    renderErrorModal(title, message);
};

/**
 * Handles claiming a prize from the modal.
 */
const handleClaimPrizeInModal = async () => {
    handleClosePrizeModal();
};

// ============================================
// MODAL FUNCTIONS
// ============================================

/**
 * Opens the rules modal.
 */
const handleOpenRules = () => {
    openRules = true;
    renderModalRules();
};

/**
 * Closes the rules modal.
 */
const handleCloseRules = () => {
    openRules = false;
    modalContainer.innerHTML = '';
};

/**
 * Renders the rules modal content.
 */
const renderModalRules = () => {
    if (!openRules || !modalContainer) {
        if (modalContainer) modalContainer.innerHTML = '';
        return;
    }

    let layoutClassName = '';

    if (selectedGame.saw_template_ui_definition.game_layout === 1) {
        layoutClassName = 'cards';
    } else {
        layoutClassName = 'map';
    }

    modalContainer.innerHTML = `
        <div class="modal-wrapper ${openRules ? 'active' : ''} ${layoutClassName}">
            <div class="modal-content">
                <div class="modal-content-text">
                    <div class="modal-content-title">${translations.rules || 'Rules'}</div>
                    <div class="modal-content-rules">${selectedGame.description || ''}</div>
                </div>
                <div class="modal-content-button" onclick="handleCloseRules();">
                    <div class="modal-content-button-text">${translations.backToGame || 'Back to Game'}</div>
                </div>
            </div>
        </div>
    `;
};

/**
 * Opens the prize won modal.
 * 
 * @param {Object} prize - The won prize object
 */
const handleOpenPrizeModal = (prize) => {
    cardClaimModal = true;
    renderPrizeModal(prize);
};

/**
 * Closes the prize won modal and re-renders cards to reflect updated status.
 */
const handleClosePrizeModal = () => {
    cardClaimModal = false;
    prizeModalContainer.innerHTML = '';
    // Re-render cards to update claimed status
    renderPrizeCards(currentLanguage);
};

/**
 * Renders the prize won modal.
 * 
 * @param {Object} prize - The won prize object
 */
const renderPrizeModal = (prize) => {
    if (!cardClaimModal || !prizeModalContainer) {
        if (prizeModalContainer) prizeModalContainer.innerHTML = '';
        return;
    }

    const acknowledgeWithClaim = prize?.acknowledge_type === 'explicity-acknowledge';
    const acknowledgeMessage = prize?.aknowledge_message || 'Congratulations! You won a prize!';
    const actionTitle = prize?.acknowledge_action_title || translations.doOk || 'OK';
    const cancelTitle = prize?.acknowledge_action_title_additional || translations.doCancel || 'Cancel';

    prizeModalContainer.innerHTML = `
        <div class="modal-prize-wrapper active">
            <div class="modal-prize-card">
                <div class="modal-close-button" onclick="handleClosePrizeModal();">
                    <div class="close-btn"></div>
                </div>
                <div class="modal-prize-content">
                    <div class="modal-prize-text-content">
                        <div class="modal-prize-title">${translations.claimPrizeSuccess || 'Prize Won!'}</div>
                        <div class="modal-prize-message">${acknowledgeMessage}</div>
                    </div>
                    <div class="modal-prize-buttons ${acknowledgeWithClaim ? 'two-btns' : ''}">
                        <div class="modal-prize-button" id="main-claim-btn">
                            <div class="modal-prize-button-text">${actionTitle}</div>
                        </div>
                        ${acknowledgeWithClaim
            ? `<div class="modal-prize-button cancel" onclick="handleClosePrizeModal();">
                                    <div class="modal-prize-button-text cancel">${cancelTitle}</div>
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
        });
    }
};

/**
 * Opens the error modal.
 * 
 * @param {string} errorMessage - The error message to display
 */
const handleOpenErrorModal = (errorMessage) => {
    errorModal = true;
    renderErrorModal(translations.somethingWentWrong || 'Something went wrong', errorMessage);
};

/**
 * Closes the error modal.
 */
const handleCloseErrorModal = () => {
    errorModal = false;
    errorModalContainer.innerHTML = '';
};

/**
 * Renders the error modal.
 * 
 * @param {string} title - The error title
 * @param {string} message - The error message
 */
const renderErrorModal = (title, message) => {
    errorModal = true;

    if (!errorModalContainer) {
        return;
    }

    errorModalContainer.innerHTML = `
        <div class="modal-prize-wrapper active">
            <div class="modal-prize-card">
                <div class="modal-close-button" onclick="handleCloseErrorModal();">
                    <div class="close-btn"></div>
                </div>
                <div class="modal-prize-content">
                    <div class="modal-prize-text-content">
                        <div class="modal-prize-title stock">${title}</div>
                        <div class="modal-prize-message">${message}</div>
                    </div>
                    <div class="modal-prize-buttons">
                        <div class="modal-prize-button stock" onclick="handleCloseErrorModal();">
                            <div class="modal-prize-button-text">${translations.doOk || 'OK'}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
};

// ============================================
// MAP LAYOUT - RENDERING
// ============================================

/**
 * Random tooltip text arrays for locked and missed prizes
 */
const missedPrizesText = [
    () => translations.lootboxMissedPrizeText1 || "Time's up! The prize got away!",
    () => translations.lootboxMissedPrizeText2 || "Missed it! Don't let the next one go!",
    () => translations.lootboxMissedPrizeText3 || "Gone! Stay ready for the next prize!",
    () => translations.lootboxMissedPrizeText4 || "Timeout! This treasure is gone!"
];

const lockedPrizesText = [
    () => translations.lootboxLockedPrizeText1 || "Wait up - the prize isn't ready!",
    () => translations.lootboxLockedPrizeText2 || "Patience! The treasure isn't ready just yet.",
    () => translations.lootboxLockedPrizeText3 || "Still locked! Come back and crack it open!",
    () => translations.lootboxLockedPrizeText4 || "Prize on pause - come back for the win!",
    () => translations.lootboxLockedPrizeText5 || "Unlocking soon - return for your shiny reward!"
];

/**
 * Gets a random phrase from the tooltip text arrays
 * @param {Array} texts - Array of functions that return text
 * @returns {string} Random text
 */
const getRandomPhrase = (texts) => {
    const randomIndex = Math.floor(Math.random() * texts.length);
    return texts[randomIndex]();
};

/**
 * Renders all prizes for the Map Layout
 * @param {string} lang - Language code for date formatting
 * @param {string} mapSize - Size of the map calculated from image dimensions ('small', 'medium', 'big')
 */
const renderMapPrizes = (lang, mapSize = 'small') => {
    if (!mapPrizes || groupedPrizes.length === 0) {
        if (mapPrizes) mapPrizes.innerHTML = '';
        return;
    }

    mapPrizes.innerHTML = '';

    // Render each group as a map prize item
    groupedPrizes.forEach(({ groupId, prizes: groupPrizes }, index) => {
        const prizeItemHTML = renderMapPrizeItem(groupPrizes, groupId, index, lang, mapSize);
        mapPrizes.innerHTML += prizeItemHTML;
    });

    // Attach event listeners to prize items
    attachMapPrizeEventListeners();
};

/**
 * Renders a single prize item for the Map Layout
 * @param {Array} groupPrizes - All prizes in this group
 * @param {number} groupId - The group identifier (weekday or timestamp)
 * @param {number} index - Index of this prize in the list
 * @param {string} lang - Language code
 * @param {string} mapSize - Size of the map ('small', 'medium', 'big')
 * @returns {string} HTML string for the prize item
 */
const renderMapPrizeItem = (groupPrizes, groupId, index, lang, mapSize = 'small') => {
    // Find default prize to show
    const isWeekdays = groupPrizes.every(p => p.weekdays && p.weekdays.length > 0);
    const prizesToShow = isWeekdays
        ? groupPrizes.find(p => p.weekdays?.[0] === groupId)
        : groupPrizes.find(p => p.active_from_ts === groupId);

    // Check if user won a prize from this group
    const prizeWonResult = findPrizeWonFromHistory(groupPrizes, groupId);
    const prizeWon = prizeWonResult?.prize;
    const historyItem = prizeWonResult?.historyItem;

    // Use prizeWon if available, otherwise use default prizesToShow
    const prize = prizeWon || prizesToShow || groupPrizes[0];

    // Calculate status
    const status = getPrizeStatus(prize, groupId, historyItem);
    const { isLocked, isMissed, isClaimed, isActive, isOutOfStock, isAcknowledged } = status;

    // For date display
    const monthDate = getPrizeDate(prizesToShow || prize, lang);
    const prizeId = prize.id;

    // Determine if this is the active prize
    const prizeNow = getPrizeTimezoneNow(prize);
    const prizeTimezoneWeekday = getISOWeekday(prizeNow);
    const todayGroupId = prize.active_from_ts ? prize.active_from_ts : prizeTimezoneWeekday;
    const isTodayActiveGroup = groupId === todayGroupId;

    const isActivePrize = isTodayActiveGroup && isActive && !isClaimed && !isOutOfStock;
    const isActivePrizeOutOfStock = isTodayActiveGroup && isActive && !isClaimed && isOutOfStock;

    const explicitAcknowledge = prizeWon?.acknowledge_type === 'explicity-acknowledge';

    // Build position class name based on mapSize and device
    const isMobile = window.innerWidth <= 768;
    const isWeekMap = mapSize === 'small' || mapSize === 'medium';
    const devicePrefix = isMobile ? 'mobile' : 'desktop';
    const mapTypePrefix = isWeekMap ? '-week' : '';
    const prizePositionClass = `${devicePrefix}${mapTypePrefix}-prize-${index + 1}`;

    // Build classes
    const prizeClasses = [
        'map-box-prize',
        prizePositionClass,
        isActive ? 'active-prize' : '',
        isLocked ? 'locked' : '',
        isMissed ? 'missed' : '',
        isClaimed ? 'claimed' : ''
    ].filter(Boolean).join(' ');

    // Build inner content based on state
    let boxContent = '';

    if (isActivePrize || isActivePrizeOutOfStock) {
        boxContent = `
            <div class="giftWrap ${isActivePrizeOutOfStock ? 'out-of-stock' : ''}">
                <div class="active-prize ${isActivePrizeOutOfStock ? 'out-of-stock' : ''}"></div>
                ${!isActivePrizeOutOfStock ? '<div class="gift_glow_rotate"></div>' : ''}
            </div>
        `;
    } else if (isClaimed) {
        const prizeIcon = prizeWon?.icon || prize?.icon;
        boxContent = `
            <div class="prize-img-container">
                ${prizeIcon
                ? `<div class="prize-front-image" style="background-image: url('${prizeIcon}')"></div>`
                : '<div class="prize-front-no-image"></div>'
            }
            </div>
            <div class="glow"></div>
        `;
    } else if (isLocked) {
        boxContent = `<div class="locked-overlay"></div>`;
    } else if (isMissed) {
        const prizeIcon = prize?.icon;
        boxContent = `
            <div class="prize-img-container missed">
                ${prizeIcon
                ? `<div class="prize-front-image" style="background-image: url('${prizeIcon}')"></div>`
                : '<div class="prize-front-no-image"></div>'
            }
            </div>
        `;
    }

    // Tooltip for explicit acknowledge (claimable)
    let tooltipContent = '';
    if (isActive && explicitAcknowledge && !isAcknowledged && isClaimed) {
        tooltipContent = `
            <div class="prize-tooltip-wrapper claimable visible">
                <div class="header-tooltip">
                    <div class="text">${translations.claimPrize || 'Claim now!'}</div>
                </div>
                <div class="header-tooltip-arrow"></div>
            </div>
        `;
    }

    return `
        <div class="${prizeClasses}" 
             data-prize-id="${prizeId}" 
             data-group-id="${groupId}"
             data-index="${index}">
            <div class="box">
                ${tooltipContent}
                <div class="prize-tooltip-wrapper" data-tooltip-id="${prizeId}">
                    <div class="header-tooltip">
                        <div class="text"></div>
                    </div>
                    <div class="header-tooltip-arrow"></div>
                </div>
                ${boxContent}
            </div>
            <div class="prize-date ${isMissed || isActivePrizeOutOfStock ? 'missed' : ''}">${monthDate}</div>
        </div>
    `;
};

/**
 * Attaches event listeners to map prize items
 */
const attachMapPrizeEventListeners = () => {
    groupedPrizes.forEach(({ prizes: groupPrizes, groupId }, index) => {
        // Find the actual prize being displayed
        const isWeekdays = groupPrizes.every(p => p.weekdays && p.weekdays.length > 0);
        const prizesToShow = isWeekdays
            ? groupPrizes.find(p => p.weekdays?.[0] === groupId)
            : groupPrizes.find(p => p.active_from_ts === groupId);

        const prizeWonResult = findPrizeWonFromHistory(groupPrizes, groupId);
        const prizeWon = prizeWonResult?.prize;
        const prize = prizeWon || prizesToShow || groupPrizes[0];
        const prizeId = prize.id;

        const prizeElement = document.querySelector(`.map-box-prize[data-prize-id="${prizeId}"]`);
        if (prizeElement) {
            prizeElement.addEventListener('click', () => handleMapPrizeClick(prize, groupId, groupPrizes));

            // Tooltip hide on mouse leave
            prizeElement.addEventListener('mouseleave', () => {
                setTimeout(() => hideMapTooltip(prizeId), 3000);
            });
        }
    });
};

/**
 * Handles clicking on a map prize item
 * @param {Object} prize - The prize object
 * @param {number} groupId - The group identifier
 * @param {Array} groupPrizes - All prizes in this group
 */
const handleMapPrizeClick = async (prize, groupId, groupPrizes) => {
    const prizeId = prize.id;

    // Check if already won
    const prizeWonResult = findPrizeWonFromHistory(groupPrizes, groupId);
    const historyItem = prizeWonResult?.historyItem;
    const prizeWon = prizeWonResult?.prize;

    const status = getPrizeStatus(prize, groupId, historyItem);
    const { isLocked, isMissed, isClaimed, isOutOfStock, isActive, isAcknowledged } = status;

    const prizeElement = document.querySelector(`.map-box-prize[data-prize-id="${prizeId}"]`);
    const isBlockedState = isLocked || isMissed;

    // Handle blocked states (locked/missed/out-of-stock) - show tooltip
    if (isBlockedState || (isOutOfStock && isActive)) {
        let tooltipText = '';

        if (isOutOfStock) {
            tooltipText = prize.out_of_stock_message || translations.lootboxOutOfStockPrize || 'Out of stock';
        } else if (isBlockedState) {
            const texts = isMissed ? missedPrizesText : lockedPrizesText;
            tooltipText = getRandomPhrase(texts);
        }

        if (tooltipText && prizeElement) {
            showMapTooltip(prizeId, tooltipText);
            prizeElement.classList.add('shake-not-active');
            setTimeout(() => prizeElement.classList.remove('shake-not-active'), 500);
        }
        return;
    }

    // If already claimed - open prize won modal
    if (isClaimed && prizeWon) {
        openMapPrizeWonModal(prizeWon, historyItem);
        return;
    }

    // If active and not claimed - open tap overlay to play
    if (isActive && !isClaimed && !isOutOfStock) {
        openMapTapOverlay(prize, groupId, groupPrizes);
    }
};

// ============================================
// MAP LAYOUT - TOOLTIP SYSTEM
// ============================================

/**
 * Shows a tooltip for a map prize
 * @param {number} prizeId - The prize ID
 * @param {string} text - The tooltip text
 */
const showMapTooltip = (prizeId, text) => {
    const tooltipWrapper = document.querySelector(`.map-box-prize[data-prize-id="${prizeId}"] .prize-tooltip-wrapper[data-tooltip-id="${prizeId}"]`);
    if (tooltipWrapper) {
        const textEl = tooltipWrapper.querySelector('.text');
        if (textEl) textEl.innerHTML = text;
        tooltipWrapper.classList.add('visible');
    }
};

/**
 * Hides a tooltip for a map prize
 * @param {number} prizeId - The prize ID
 */
const hideMapTooltip = (prizeId) => {
    const tooltipWrapper = document.querySelector(`.map-box-prize[data-prize-id="${prizeId}"] .prize-tooltip-wrapper[data-tooltip-id="${prizeId}"]`);
    if (tooltipWrapper) {
        tooltipWrapper.classList.remove('visible');
    }
};

// ============================================
// MAP LAYOUT - TAP OVERLAY (3-tap interaction)
// ============================================

/**
 * Opens the tap overlay modal for the 3-tap prize reveal
 * @param {Object} prize - The prize object
 * @param {number} groupId - The group identifier
 * @param {Array} groupPrizes - All prizes in this group
 */
const openMapTapOverlay = (prize, groupId, groupPrizes) => {
    if (!mapOverlay) return;

    mapTapOverlayActive = true;
    tapCount = 0;
    currentTapPrize = prize;
    currentTapGroupId = groupId;

    // Hide the small gift on the map
    const prizeElement = document.querySelector(`.map-box-prize[data-prize-id="${prize.id}"]`);
    if (prizeElement) {
        prizeElement.classList.add('hide-small-gift');
    }

    const tapText = translations.lootboxPrizeModalTap || 'Tap the gift 3 times!!!';

    mapOverlay.innerHTML = `
        <div class="overlay-close-button-wrapper" id="overlay-close-btn" style="opacity: 0;">
            <div class="close-button"></div>
        </div>
        <div class="prize_title" id="map-prize-title"></div>
        <div class="gift_fly_in">
            <div class="gift_float">
                <div class="gift_wrap_big" id="map-big-gift">
                    <div class="gift_contain_big" id="map-gift-contain">
                        <div class="gift_inner" id="map-gift-inner">
                            <div class="gift_glow_rotate"></div>
                            <div class="gift_opened" id="map-gift-opened"></div>
                            <div class="gift" id="map-gift-closed"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="split_text" id="map-animated-text">${tapText}</div>
        <div class="prize_wrap" id="map-prize-wrapper">
            <div class="prize_image" id="map-prize-image"></div>
        </div>
        <div class="prize-acknowledge" id="map-prize-acknowledge">
            <div class="prize_acknowledge_text" id="map-acknowledge-text"></div>
            <div class="prize_button_container" id="map-button-container"></div>
        </div>
    `;

    // Add show_overlay class with a small delay for smooth fade-in transition
    requestAnimationFrame(() => {
        mapOverlay.classList.add('show_overlay');
    });

    // Set up click handler on the closed gift
    const giftClosed = document.getElementById('map-gift-closed');
    if (giftClosed) {
        giftClosed.addEventListener('click', handleMapTapClick);
    }

    // Set up close button handler
    const closeBtn = document.getElementById('overlay-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeMapTapOverlay);
    }

    // Animate the tap text
    setTimeout(() => animateTapText(), 100);
};

/**
 * Closes the tap overlay modal
 */
const closeMapTapOverlay = () => {
    if (!mapOverlay) return;

    mapTapOverlayActive = false;
    mapOverlay.classList.remove('show_overlay');

    // Clear content after transition
    setTimeout(() => {
        mapOverlay.innerHTML = '';
    }, 350);

    // Show the small gift again
    if (currentTapPrize) {
        const prizeElement = document.querySelector(`.map-box-prize[data-prize-id="${currentTapPrize.id}"]`);
        if (prizeElement) {
            prizeElement.classList.remove('hide-small-gift');
        }
    }

    // Re-render map prizes to update state
    renderMapPrizes(currentLanguage, currentMapSize);

    currentTapPrize = null;
    currentTapGroupId = null;
    tapCount = 0;
};

/**
 * Animates the "Tap 3 times" text with staggered letter appearance
 */
const animateTapText = () => {
    const animatedText = document.getElementById('map-animated-text');
    if (!animatedText) return;

    const text = animatedText.textContent;
    animatedText.innerHTML = '';

    text.split('').forEach(char => {
        if (char === ' ') {
            animatedText.appendChild(document.createTextNode(' '));
        } else {
            const span = document.createElement('span');
            span.textContent = char;
            span.classList.add('letter');
            animatedText.appendChild(span);
        }
    });

    const letters = document.querySelectorAll('#map-animated-text .letter');
    letters.forEach((letter, index) => {
        setTimeout(() => {
            letter.classList.add('staggered');
        }, 200 + index * 25);
    });
};

/**
 * Removes the staggered class from animated text letters
 */
const removeStaggeredClass = () => {
    const letters = document.querySelectorAll('#map-animated-text .letter');
    letters.forEach((letter, index) => {
        setTimeout(() => {
            letter.classList.remove('staggered');
        }, index * 25);
    });
};

/**
 * Handles a tap/click on the gift box in the overlay
 */
const handleMapTapClick = async () => {
    tapCount++;

    const bigGift = document.getElementById('map-big-gift');
    const giftInner = document.getElementById('map-gift-inner');
    const giftContain = document.getElementById('map-gift-contain');
    const giftClosed = document.getElementById('map-gift-closed');
    const giftOpened = document.getElementById('map-gift-opened');
    const prizeWrapper = document.getElementById('map-prize-wrapper');
    const prizeImage = document.getElementById('map-prize-image');
    const prizeTitle = document.getElementById('map-prize-title');
    const prizeAcknowledge = document.getElementById('map-prize-acknowledge');
    const closeButton = document.getElementById('overlay-close-btn');

    // Scale up the gift on each tap
    if (tapCount <= 3 && bigGift) {
        bigGift.style.transition = "transform 0.5s cubic-bezier(0.850, -1.800, 0.240, 1.575)";
        bigGift.style.transform = `scale(${2 + (tapCount * 0.25)})`;
    }

    // Third tap - trigger the spin and reveal
    if (tapCount === 3) {
        // Show close button
        if (closeButton) closeButton.style.opacity = '1';

        // Shake and bounce animations
        if (giftInner) giftInner.classList.add('shake');
        if (giftContain) giftContain.classList.add('move-down');

        setTimeout(() => {
            if (giftClosed) giftClosed.classList.add('down-up-bounce');
            if (giftOpened) giftOpened.classList.add('down-up-bounce');
        }, 200);

        // Send the API request
        try {
            const response = await window._smartico.api.playMiniGame(selectedGame.id);
            const { err_code, err_message, prize_id } = response;

            if (err_code === SAWSpinErrorCode.SAW_OK) {
                const winPrize = prizes.find(p => p.id === prize_id);

                // Refresh history
                const updatedHistory = await window._smartico.api.getMiniGamesHistory({
                    limit: 1000,
                    offset: 0,
                    saw_template_id: selectedGame.id
                });
                miniGamesHistory = updatedHistory || [];

                // Reveal animations
                setTimeout(() => {
                    if (giftClosed) giftClosed.style.opacity = '0';
                    if (giftOpened) giftOpened.style.opacity = '1';
                    if (prizeWrapper) prizeWrapper.classList.add('prize_open');

                    if (winPrize && prizeImage) {
                        prizeImage.style.backgroundImage = `url('${winPrize.icon || ''}')`;
                    }
                }, 1700);

                // Show prize info
                setTimeout(() => {
                    if (winPrize) {
                        if (prizeTitle) {
                            prizeTitle.innerHTML = winPrize.name || 'Prize';
                            prizeTitle.style.transform = 'scale(1)';
                        }
                        if (prizeAcknowledge) {
                            renderMapPrizeAcknowledge(winPrize);
                            prizeAcknowledge.style.transform = 'scale(1)';
                        }
                    }
                }, 2000);

                // Clean up animations
                setTimeout(() => {
                    if (giftInner) giftInner.classList.remove('shake');
                    if (giftClosed) giftClosed.classList.remove('down-up-bounce');
                    if (giftOpened) giftOpened.classList.remove('down-up-bounce');
                }, 2000);

                removeStaggeredClass();
            } else {
                // Handle error
                handleSpinError(err_code, err_message, currentTapPrize);
                closeMapTapOverlay();
            }
        } catch (error) {
            console.error('Error playing mini game:', error);
            handleSpinError(null, error.message, currentTapPrize);
            closeMapTapOverlay();
        }
    }
};

/**
 * Renders the prize acknowledge section in the tap overlay
 * @param {Object} winPrize - The won prize object
 */
const renderMapPrizeAcknowledge = (winPrize) => {
    const acknowledgeText = document.getElementById('map-acknowledge-text');
    const buttonContainer = document.getElementById('map-button-container');

    if (!acknowledgeText || !buttonContainer) return;

    const acknowledgeWithClaim = winPrize?.acknowledge_type === 'explicity-acknowledge';
    const acknowledgeMessage = winPrize?.aknowledge_message || translations.congratulations || 'Congratulations!';
    const actionTitle = winPrize?.acknowledge_action_title || translations.doOk || 'OK';
    const cancelTitle = winPrize?.acknowledge_action_title_additional || translations.doCancel || 'Cancel';

    acknowledgeText.innerHTML = acknowledgeMessage;

    let buttonsHTML = `
        <div class="prize_button" id="map-claim-btn">${actionTitle}</div>
    `;

    if (acknowledgeWithClaim) {
        buttonsHTML += `
            <div class="prize_button cancel" id="map-cancel-btn">${cancelTitle}</div>
        `;
    }

    buttonContainer.innerHTML = buttonsHTML;

    // Attach event listeners
    const claimBtn = document.getElementById('map-claim-btn');
    const cancelBtn = document.getElementById('map-cancel-btn');

    if (claimBtn) {
        claimBtn.addEventListener('click', () => handleMapPrizeClaim(winPrize));
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => closeMapTapOverlay());
    }
};

/**
 * Handles claiming a prize from the tap overlay
 * @param {Object} winPrize - The won prize object
 */
const handleMapPrizeClaim = (winPrize) => {
    closeMapTapOverlay();
};

// ============================================
// MAP LAYOUT - PRIZE WON MODAL (for reopening)
// ============================================

/**
 * Opens the prize won modal to view a claimed prize
 * @param {Object} prize - The prize object
 * @param {Object} historyItem - The history item for this prize
 */
const openMapPrizeWonModal = (prize, historyItem) => {
    if (!mapPrizeWonModal) return;

    mapPrizeWonModalActive = true;
    const isAcknowledged = !!historyItem?.acknowledge_date_ts;

    const acknowledgeWithClaim = prize?.acknowledge_type === 'explicity-acknowledge';
    const actionTitle = prize?.acknowledge_action_title || translations.doOk || 'OK';
    const cancelTitle = prize?.acknowledge_action_title_additional || translations.doCancel || 'Cancel';
    const acknowledgeMessage = prize?.aknowledge_message || '';

    let actionsHTML = '';
    if (!isAcknowledged) {
        actionsHTML = `
            <div class="won-prize-actions">
                <div class="won-prize-btn" id="map-won-claim-btn">
                    <div class="won-prize-btn-text">${actionTitle}</div>
                </div>
                ${acknowledgeWithClaim
                ? `<div class="won-prize-btn cancel" id="map-won-cancel-btn">
                            <div class="won-prize-btn-text">${cancelTitle}</div>
                        </div>`
                : ''
            }
            </div>
        `;
    }

    mapPrizeWonModal.innerHTML = `
        <div class="won-modal-wrapper">
            <div class="won-modal-content">
                <div class="modal-won-button-wrapper" id="won-modal-close-btn">
                    <div class="modal-won-close-button"></div>
                </div>
                <div class="won-prize-image-container">
                    ${prize?.icon
            ? `<img src="${prize.icon}" alt="Prize" draggable="false">`
            : '<div class="prize-front-no-image"></div>'
        }
                </div>
                <div class="won-prize-name">${prize?.name || 'Prize'}</div>
                ${acknowledgeMessage ? `<div class="won-prize-message">${acknowledgeMessage}</div>` : ''}
                ${actionsHTML}
            </div>
        </div>
    `;

    mapPrizeWonModal.classList.add('active');

    // Attach close button event listener
    const closeModalBtn = document.getElementById('won-modal-close-btn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeMapPrizeWonModal);
    }

    // Attach event listeners
    const claimBtn = document.getElementById('map-won-claim-btn');
    const cancelBtn = document.getElementById('map-won-cancel-btn');

    if (claimBtn) {
        claimBtn.addEventListener('click', () => {
            closeMapPrizeWonModal();
        });
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            closeMapPrizeWonModal();
        });
    }
};

/**
 * Closes the prize won modal
 */
const closeMapPrizeWonModal = () => {
    if (!mapPrizeWonModal) return;

    mapPrizeWonModalActive = false;
    mapPrizeWonModal.classList.remove('active');
    mapPrizeWonModal.innerHTML = '';
};

// ============================================
// GAME INITIALIZATION
// ============================================

/**
 * Initializes the game with the specified template and language.
 * This is the main entry point called from index.html.
 * 
 * @param {number|string} saw_template_id - The game template ID
 * @param {string} lang - The language code
 */
const initializeGame = (saw_template_id, lang) => {
    loadMiniGames(saw_template_id, lang);
};