# Sales Pipeline

One screen for a 20-person sales team sharing a 50,000-deal pipeline. It loads 50,000 deals into a list you can drive entirely from the keyboard. The network is slow and drops about 1 in 10 saves, and teammates edit the same deals while you work.

> Write-up: [WRITEUP.md](./WRITEUP.md)

## Run it

```bash
npm start
```

This installs dependencies and opens http://localhost:5173. It needs Node 20.19+ or 22.12+. After the first run, `npm run dev` is enough.

| Script             | What it does                                                           |
| ------------------ | ---------------------------------------------------------------------- |
| `npm start`        | install + dev server + open browser                                    |
| `npm test`         | 32 unit tests: sync engine + folder boundaries (Vitest, ~2 s)          |
| `npm run test:e2e` | Playwright smoke tests (first time: `npx playwright install chromium`) |
| `npm run build`    | type-check + production build (`npm run preview` to serve it)          |

## Using it

There are two views of the same deals. Press `V` to switch; the app remembers your choice, and `?view=board` opens straight into the board.

- **Table (default).** A stage strip across the top shows _My focus_, _All open_ and the seven stages, each with a live count and ₹ total. These work as tabs (`←`/`→`). Below it is a virtualized table: only about 30 rows exist in the DOM, whether the view holds 30 deals or 37,000.
- **Board.** Five columns, New Lead → Negotiation, each virtualized, with Won and Lost as drop zones along the bottom. Choose the scope with _My focus_ / _All open_ (`F`). Each column has "Open in table ↗" for big jobs.

Filters, sorting, selection, shortcuts and saving work the same way in both views.

**Closing a deal** (`6`/`7`, the Move menu, `]` from Negotiation, or dropping on Won/Lost) always opens a short dialog. Lost needs a reason: press `1`–`7` to pick one, and "Other" needs a note. Won takes an optional note. For a bulk close, this is the same dialog as the bulk confirmation, so there's still only one step. The server checks the same rule, so a Lost deal can never be saved without a reason. Won and Lost rows show the reason or note.

**Editing fields** (`E`, or **Edit fields** in the bulk bar) changes the owner and/or the close date of the selection, or of the focused deal. The close date can be set to a date, moved by N days (each deal keeps its own date), or set to the end of next quarter. Only the fields you change are sent, and each one is checked against what you saw, so an edit never overwrites a teammate's newer change and never clashes with a teammate moving the deal.

**Drag-and-drop:** on the board, drop cards on a column or on Won/Lost. In the table, drop rows on a stage tab. Dragging a selected card or row moves the whole selection, and `Esc` cancels a drag. Every drag has a keyboard equivalent.

Every shortcut acts on the selected deals. If nothing is selected, it acts on the focused deal.

| Keys               | Action                                                       |
| ------------------ | ------------------------------------------------------------ |
| `J`/`K` or `↓`/`↑` | next / previous deal (`PgUp` `PgDn` `Home` `End` also work)  |
| `←`/`→`            | table: previous / next tab · board: previous / next column   |
| `⇧←`/`⇧→`          | board: carry the card to the previous / next stage           |
| `V` · `F`          | switch Table ⇄ Board · toggle My focus ⇄ All open            |
| `X` or `Space`     | select deal · `⇧↓`/`⇧↑` extend selection                     |
| `⌘A` / `Ctrl+A`    | select **every** deal in the view, not just the visible ones |
| `1` … `7`          | move to New Lead … Lost (Won/Lost ask for a note / reason)   |
| `]` / `[`          | move to the next / previous stage                            |
| `M`                | move menu (type to filter stages)                            |
| `E`                | edit owner / close date                                      |
| `Z`                | undo the last change                                         |
| `A`                | unsaved changes & conflicts drawer                           |
| `⇧R`               | retry everything that failed                                 |
| `U`                | pull teammates' changes into the current list                |
| `/`                | search                                                       |
| `?`                | all shortcuts · `⇧S` simulation settings · `Esc` close/clear |

Moving more than 20 deals at once asks for confirmation. More than 50 deals (moves or edits) run as a background job that shows progress, can be stopped part-way, and can be undone. Undo puts back exactly what was there before, including a Lost deal's old reason.

## Simulation controls

Open **Simulation** (`⇧S`) to change these while you test. The defaults match the brief.

| Setting                                 | Default     | URL param          |
| --------------------------------------- | ----------- | ------------------ |
| Latency                                 | 300–1500 ms | `latency=300-1500` |
| Failed saves                            | 10 %        | `fail=0.1`         |
| …of which "saved, reply lost"           | 0 %         | `lost=0.3`         |
| Teammate edits / second                 | 1           | `teammates=5`      |
| Hotspot: edits land on rows you can see | 25 %        | `hotspot=1`        |
| Auto-retry (2× with backoff)            | on          | `retry=0`          |
| Offline                                 | off         | `offline=1`        |

The panel also has two one-shot buttons:

- **Force a conflict on my next save.** A teammate changes the same thing (moves the deal, or reassigns it / changes its close date for an edit) while your request is on its way to the server.
- **Teammate moves the focused deal.**

Settings are saved in this browser. URL params override them, so a link always reproduces the same setup, for example: `/?fail=0.5&teammates=10&hotspot=1`.

For poking at things from the console, `window.__pipeline`, `window.__sim` and `window.__server` are exposed.

## How it's put together

There's no real backend, so `src/` is split the way a real app would be: a client, a backend, and the contract between them.

```
src/
  shared/         the contract: both sides import it, it imports nothing else
    api.ts          PipelineApi, DealMutation, MutationResult, ServerEvent, ApiError
    domain.ts       Deal & stage types, lost reasons, closeProblem() (the rule both sides check)
    owners.ts  random.ts
  server/         the fake backend (delete it when a real one exists)
    index.ts        the only entry point: createFakeBackend()
    db.ts           in-memory DB: compare-and-set per part (stage, each field), validation, idempotency keys, events
    transport.ts    the fake network: latency, failures, lost replies, offline, push channel
    seed.ts         50k seeded deals
    teammates.ts    19 simulated teammates editing deals (biased toward what's on your screen)
    simConfig.ts    live knobs + URL params
  client/         the React app
    app/instance.ts the composition root: the one client file that imports server/
    store/
      pipeline.ts     Zustand store + sync engine (outbox, retries, conflicts, stable list)
      describe.ts     plain-language text for changes and conflicts
      query.ts        filtering / sorting / insertion
      pipeline.test.ts
    lib/            ₹ formatting, "why now" priority rules
    ui/             React components; useKeyboard.ts is the whole key map
      DealTable / DealRow       the table view
      Board / DealCard          the board view; boardModel.ts groups the shared list by stage
      drag.tsx                  drag-and-drop without a library (drops change the stage, not the position)
      ConfirmDialog / EditDialog   bulk confirm + close details (reason / note); bulk field edit
  boundaries.test.ts  fails the build if client/ imports server/ (outside instance.ts) or shared/ imports either
e2e/              Playwright smoke tests
```

```
user action ──▶ intent (per deal, latest wins) ──▶ outbox ──▶ api.saveDeals (batched, 2 lanes)
                    │                                              │
                    ▼                                              ▼
 display = server truth + pending intents  ◀── results / push events (versioned, batched every 200 ms)
                    │
                    ▼
       stable list snapshot (never re-sorted by other people's changes)
```

To swap in a real backend, write a REST + WebSocket client that implements `PipelineApi` from `shared/api.ts`, pass it to the store in `client/app/instance.ts`, and delete `server/`. Nothing else in `client/` changes.
