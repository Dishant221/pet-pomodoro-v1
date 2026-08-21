/**
 * The blog's focus-break arcade: one tiny game dropped into the middle of a
 * post. The slot is created client-side — after the paragraph nearest the
 * article's midpoint — so the markdown stays plain content and a reader with
 * JavaScript off simply sees an uninterrupted article. Three games rotate,
 * chosen by a hash of the post's slug so each article keeps "its" game
 * between visits.
 *
 * Everything runs in the browser and stores nothing but a win streak in
 * localStorage — no network, no tracking, which is also what keeps it inside
 * the site's CSP and its privacy promise.
 */

const STORE_KEY = 'pp-blog-arcade';

interface ArcadeState {
  streak: number;
  lastWinDay: string;
  wins: number;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadState(): ArcadeState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { streak: 0, lastWinDay: '', wins: 0, ...JSON.parse(raw) };
  } catch {
    /* private mode or corrupt JSON — start fresh */
  }
  return { streak: 0, lastWinDay: '', wins: 0 };
}

function recordWin(): ArcadeState {
  const s = loadState();
  const t = today();
  if (s.lastWinDay !== t) {
    const yesterday = new Date(Date.now() - 86400000);
    const y = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    s.streak = s.lastWinDay === y ? s.streak + 1 : 1;
    s.lastWinDay = t;
  }
  s.wins += 1;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* fine — the game still works, the streak just won't persist */
  }
  return s;
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/** Seeded shuffle so the same puzzle appears on every visit to the same post. */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/* ---------------------------------------------------------------- shell -- */

function shell(slot: HTMLElement, gameName: string, blurb: string) {
  const card = el('div', 'pp-arcade pp-card');
  const head = el('div', 'pp-arcade-head');
  head.append(
    el('span', 'pp-arcade-paw', '🐾'),
    el('strong', '', 'Paws for a minute'),
    el('span', 'pp-arcade-name', gameName),
  );
  const sub = el('p', 'pp-arcade-blurb', blurb);
  const body = el('div', 'pp-arcade-body');
  const status = el('p', 'pp-arcade-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const foot = el('p', 'pp-arcade-foot');
  const s = loadState();
  foot.textContent =
    (s.streak > 1 ? `🔥 ${s.streak}-day streak · ` : '') +
    'Played right here in your browser — nothing is sent anywhere.';
  card.append(head, sub, body, status, foot);
  slot.append(card);
  return {
    body,
    status,
    win(message: string) {
      const st = recordWin();
      status.textContent = message + (st.streak > 1 ? ` 🔥 ${st.streak}-day streak!` : '');
      foot.textContent = 'Come back tomorrow to keep the streak alive. 🐱';
    },
  };
}

/* ---------------------------------------------------- game 1: focus five -- */

const FIVE_WORDS = [
  'FOCUS', 'TIMER', 'BREAK', 'STUDY', 'HABIT', 'BRAIN', 'PAUSE', 'TASKS',
  'GOALS', 'NOTES', 'CLOCK', 'DAILY', 'CALMS', 'RESET', 'START', 'BELLS',
];

function focusFive(slot: HTMLElement, seed: number) {
  const answer = FIVE_WORDS[seed % FIVE_WORDS.length];
  const ui = shell(
    slot,
    'Focus Five',
    'Guess the 5-letter focus word in 6 tries. Green = right spot, amber = wrong spot.',
  );

  const grid = el('div', 'pp-ff-grid');
  const rows: HTMLElement[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: HTMLElement[] = [];
    for (let c = 0; c < 5; c++) {
      const tile = el('div', 'pp-ff-tile');
      grid.append(tile);
      row.push(tile);
    }
    rows.push(row);
  }

  const form = el('form', 'pp-arcade-row');
  const input = el('input', 'pp-arcade-input') as HTMLInputElement;
  input.maxLength = 5;
  input.placeholder = 'type a word…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Your five letter guess');
  const btn = el('button', 'pp-btn pp-btn-primary pp-arcade-btn', 'Guess');
  btn.type = 'submit';
  form.append(input, btn);
  ui.body.append(grid, form);

  let turn = 0;
  let done = false;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (done) return;
    const guess = input.value.trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(guess)) {
      ui.status.textContent = 'Five letters, please — like FOCUS.';
      return;
    }
    const remaining: Record<string, number> = {};
    for (let i = 0; i < 5; i++) {
      if (guess[i] !== answer[i]) remaining[answer[i]] = (remaining[answer[i]] ?? 0) + 1;
    }
    for (let i = 0; i < 5; i++) {
      const tile = rows[turn][i];
      tile.textContent = guess[i];
      if (guess[i] === answer[i]) tile.dataset.hit = 'exact';
      else if (remaining[guess[i]]) {
        tile.dataset.hit = 'near';
        remaining[guess[i]]--;
      } else tile.dataset.hit = 'miss';
    }
    turn++;
    input.value = '';
    if (guess === answer) {
      done = true;
      ui.win(`🎉 ${answer} in ${turn} ${turn === 1 ? 'try' : 'tries'} — the cat is impressed.`);
    } else if (turn === 6) {
      done = true;
      ui.status.textContent = `It was ${answer}. The cat pretends not to have watched. 😽`;
    } else {
      ui.status.textContent = `${6 - turn} ${6 - turn === 1 ? 'guess' : 'guesses'} left.`;
    }
  });
}

/* ---------------------------------------------------- game 2: unscramble -- */

const SCRAMBLES: Array<[string, string]> = [
  ['POMODORO', 'The tomato-shaped technique this blog keeps going on about.'],
  ['ROUTINE', 'What a good morning has and a bad one lacks.'],
  ['STREAK', 'What you protect by showing up again tomorrow.'],
  ['SESSION', 'One timer, one task, one of these.'],
  ['COMPANION', 'The cat, officially.'],
  ['DISTRACTED', 'What you were before the bell rang.'],
  ['ATTENTION', 'The thing every app is trying to steal.'],
  ['RECHARGE', 'What a real break actually does.'],
];

function unscramble(slot: HTMLElement, seed: number) {
  const [word, hint] = SCRAMBLES[seed % SCRAMBLES.length];
  let mixed = seededShuffle(word.split(''), seed).join('');
  if (mixed === word) mixed = mixed.split('').reverse().join('');
  const ui = shell(slot, 'Unscramble', 'Rearrange the letters into a word this article would approve of.');

  const letters = el('div', 'pp-us-letters');
  for (const ch of mixed) letters.append(el('span', 'pp-ff-tile pp-us-tile', ch));
  const hintP = el('p', 'pp-arcade-hint', `Hint: ${hint}`);

  const form = el('form', 'pp-arcade-row');
  const input = el('input', 'pp-arcade-input') as HTMLInputElement;
  input.placeholder = 'your answer…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Your unscrambled word');
  const btn = el('button', 'pp-btn pp-btn-primary pp-arcade-btn', 'Check');
  btn.type = 'submit';
  form.append(input, btn);
  ui.body.append(letters, hintP, form);

  let tries = 0;
  let done = false;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (done) return;
    tries++;
    if (input.value.trim().toUpperCase() === word) {
      done = true;
      ui.win(`🎉 ${word} — solved in ${tries} ${tries === 1 ? 'try' : 'tries'}.`);
    } else if (tries === 5) {
      done = true;
      ui.status.textContent = `It was ${word}. Sneaky letters. 🙀`;
    } else {
      ui.status.textContent = tries >= 2 ? `Not yet — it starts with “${word[0]}”.` : 'Not quite — try again.';
    }
  });
}

/* -------------------------------------------------- game 3: memory pairs -- */

const PAIR_EMOJI = ['🐱', '🍅', '⏰', '📚', '☕', '🌙'];

function memoryPairs(slot: HTMLElement, seed: number) {
  const ui = shell(slot, 'Memory Pairs', 'Find all six pairs. Fewer flips, smugger cat.');
  const deck = seededShuffle([...PAIR_EMOJI, ...PAIR_EMOJI], seed + 7);
  const grid = el('div', 'pp-mp-grid');
  let first: HTMLButtonElement | null = null;
  let lock = false;
  let moves = 0;
  let found = 0;

  deck.forEach((emoji) => {
    const card = el('button', 'pp-mp-card') as HTMLButtonElement;
    card.type = 'button';
    card.dataset.emoji = emoji;
    card.setAttribute('aria-label', 'Hidden card');
    card.textContent = '🐾';
    card.addEventListener('click', () => {
      if (lock || card.dataset.state) return;
      card.textContent = emoji;
      card.dataset.state = 'up';
      card.setAttribute('aria-label', emoji);
      if (!first) {
        first = card;
        return;
      }
      moves++;
      if (first.dataset.emoji === emoji) {
        first.dataset.state = card.dataset.state = 'matched';
        first = null;
        found++;
        if (found === PAIR_EMOJI.length) {
          ui.win(`🎉 All pairs in ${moves} moves.`);
        } else {
          ui.status.textContent = `${PAIR_EMOJI.length - found} pairs to go — ${moves} moves so far.`;
        }
      } else {
        lock = true;
        const a = first;
        first = null;
        setTimeout(() => {
          for (const c of [a, card]) {
            delete c.dataset.state;
            c.textContent = '🐾';
            c.setAttribute('aria-label', 'Hidden card');
          }
          lock = false;
        }, 650);
        ui.status.textContent = `${moves} moves.`;
      }
    });
    grid.append(card);
  });
  ui.body.append(grid);
}

/* ------------------------------------------------------------------ mount -- */

const GAMES = [focusFive, unscramble, memoryPairs];

export function mountFocusGame(prose: HTMLElement | null): void {
  if (!prose) return;

  // Only interrupt articles long enough that a pause reads as a break, not an
  // ad — and place the slot after the paragraph nearest the middle.
  const paras = Array.from(prose.children).filter((n) => n.tagName === 'P');
  if (paras.length < 8) return;
  const middle = paras[Math.floor(paras.length / 2)];

  const slot = el('div', 'pp-game-slot');
  middle.after(slot);

  const slug = location.pathname.replace(/\/$/, '').split('/').pop() ?? 'petpomo';
  const seed = hash(slug);
  GAMES[seed % GAMES.length](slot, seed);
}
