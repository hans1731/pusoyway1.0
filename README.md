# Ace Room — Browser Card Game (Virtual Credits Only)

A mobile-friendly multiplayer Pusoy-style game starter project. It uses Node.js, Express, and Socket.IO.

## Features included
- Browser-based lobby and responsive mobile UI
- Create a private room and share its room code
- Join a room using a room code
- Ace Room: the player dealt the Ace of Diamonds is selected as dealer
- Dealer Room: dealer rotates after every three completed rounds
- Bot Room: create a room with simple bot seats
- Virtual credit wallet and virtual-only "Coin Deposit" page
- 2–4 seats, 13 cards per player, 12-second betting phase
- 90-second arrangement phase for Front (3), Middle (5), and Back (5)
- Basic foul checking and row-comparison scoring
- No real-money deposits, withdrawals, purchases, or redemption

## Important prototype notes
- This is a starter implementation. Room state, virtual balances, and history are stored in server memory and reset when the server restarts.
- The basic scoring engine is intentionally simple and should be reviewed with your exact house rules before public use.
- Bot players are simple placeholders and are not a sophisticated AI.
- Do not add real-money payments or represent virtual credits as redeemable value.
- For a persistent public launch, add a database, authentication, rate limits, server-side audit logging, and deployment secrets.

## Run locally
1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

## Publish for browser access
1. Upload the project folder to a GitHub repository.
2. Deploy it on a Node.js-capable host that supports long-lived WebSocket connections (for example, a suitable free-tier service, if available).
3. Set the start command to `npm start`.
4. Open the deployed URL on phones or computers.

Static-only hosting such as GitHub Pages cannot run `server.js` or host the Socket.IO game server by itself. It can host static files, but this multiplayer project needs a separate Node.js backend.

## Game flow
- Create a room or enter a room code.
- Each player starts with 0 virtual credits; the virtual Coin Deposit page grants demo credits only.
- The host starts when at least two human players are present.
- Players choose a virtual bet from 5, 10, or 15 credits.
- Each player receives 13 cards and arranges them into 3/5/5 rows.
- Submit the rows before the 90-second timer ends.
- The server checks fouls and compares row hand ranks, then updates virtual balances.

## Suggested next development steps
- Persist players, balances, rooms, and round history in a database.
- Add reconnect handling and stronger validation.
- Confirm the exact house rules for royalties, Black Pair carry-over, dealer multipliers, and side pots before implementing those rules for real.
