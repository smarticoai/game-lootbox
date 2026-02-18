# Lootbox Game

A customizable lootbox/daily rewards game UI built on the [Smartico.ai](https://smartico.ai) gamification platform using the [Public API](https://github.com/smarticoai/public-api).

![Example of the game!](/assets/demo.gif "Demo")

- **Live Demo** - https://demo.smartico.ai/custom-game/game-lootbox/index.html
- **More Examples** - https://expo.smartico.ai/widgets/intro

## Features

- **Two Layout Modes**
  - **Cards Layout** (`game_layout: 1`) - Horizontal scrollable cards with flip animation
  - **Map Layout** (`game_layout: 2`) - Vertical scrollable map with 3-tap gift interaction

- **Prize Grouping** - Multiple prizes on the same day/weekday are grouped into a single visual element

- **Timezone Support** - Prizes can be configured for UTC or user's local timezone based on `max_give_period_type_id`

- **Prize States** - Visual differentiation for locked, active, claimed, missed, and out-of-stock prizes

- **Error Handling** - Localized error messages for max attempts reached, out of stock, and segmentation requirements

- **History Tracking** - Automatically shows previously won prizes with correct weekly reset logic

- **Responsive Design** - Works on both desktop and mobile devices

## Quick Start

```bash
npm install
npm run dev
```

## Configuration

Adjust the following variables in `index.html` for your setup:

```javascript
// ID of your game template from Smartico BackOffice
const _saw_template_id = 1514;

// Label & brand keys specific to your setup (contact your Success Manager)
const _label_key = 'your-label-key';
const _brand_key = 'your-brand-key';

// Currently identified user
window._smartico_user_id = 'user123';
window._smartico_language = 'en';
```

### URL Parameters

You can also pass configuration via URL parameters:

```
?saw_template_id=1514&label_key=xxx&brand_key=xxx&user_ext_id=user123&lang=en
```

## Project Structure

```
game-lootbox/
├── index.html                 # Main HTML with both layout structures
├── assets/
│   ├── css/
│   │   ├── cardsStyles.css    # Styles for Cards layout
│   │   └── mapStyles.css      # Styles for Map layout
│   ├── js/
│   │   └── game.js            # Main game logic (vanilla JS)
│   └── img/
│       ├── cards/             # Cards layout images
│       └── map/               # Map layout images
```

## API Usage

The game uses the Smartico Public API:

```javascript
// 1. Get available mini-games
const games = await _smartico.api.getMiniGames();

// 2. Find your game by template ID
const game = games.find(g => g.id === saw_template_id);

// 3. Get game history for the user
const history = await _smartico.api.getMiniGamesHistory({
    limit: 1000,
    offset: 0,
    saw_template_id: game.id
});

// 4. Play the game (spin/flip)
const result = await _smartico.api.playMiniGame(game.id);
// Returns: { err_code, err_message, prize_id }

// 5. Get translations for localization
const translations = await _smartico.api.getTranslations('EN');
```

## Layout Detection

The layout is automatically detected from the game template configuration:

```javascript
const gameLayout = game.saw_template_ui_definition?.game_layout;
// 1 = Cards (Horizontal)
// 2 = Map (Vertical)
```

## Customization

### Styling

- **Cards Layout**: Modify `assets/css/cardsStyles.css`
- **Map Layout**: Modify `assets/css/mapStyles.css`

### Images

Replace images in `assets/img/cards/` or `assets/img/map/` to customize the visual appearance:

- `game-bg.png` / `game-bg.jpeg` - Desktop background
- `game-bg-mobile.png` / `game-bg-mobile.jpeg` - Mobile background
- `active-box.png` - Active prize box
- `locked.png` - Locked prize indicator
- Prize position classes can be customized in CSS for map layout

### Prize Positioning (Map Layout)

Prizes are positioned using CSS classes based on `mapSize` and device:

```css
.desktop-week-prize-1 { top: 17%; left: 46%; }
.desktop-week-prize-2 { top: 38%; left: 55%; }
/* ... */
.mobile-week-prize-1 { top: 15%; left: 40%; }
/* ... */
```

## Key Concepts

### Prize Status Calculation

Each prize's status is determined by:
- Current time vs prize availability window
- User's history (claimed/acknowledged)
- Stock availability
- Timezone settings (`max_give_period_type_id`: 2=UTC, 3=User timezone)

### Weekly Reset

For weekday-based prizes, history is filtered by current ISO week and year to ensure proper weekly reset.

### Explicit Acknowledge

Prizes with `acknowledge_type: 'explicity-acknowledge'` require user action before being marked as fully claimed.

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- No external dependencies (vanilla JavaScript)
- Uses native `Date` for timezone calculations