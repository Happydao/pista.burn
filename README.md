# PISTA Burn Garage

The official on-chain burn dashboard for **PISTA**, the utility token of [Bella Bumper Play 2 Earn](https://www.bellabumper.fun), an arcade racing game on Solana.

Players spend PISTA to buy game credits. Every week, 70% of collected PISTA is distributed as claimable rewards to the top players, 10% is permanently burned, 10% goes to Torrino DAO, and 10% supports the developers. This dashboard verifies the burn allocation on-chain and publishes the updated totals through GitHub Pages.

## Live dashboard

[happydao.github.io/pista.burn](https://happydao.github.io/pista.burn/)

## Verified addresses

- PISTA mint: [`9CaQUthsVMugZzMvskrrvcHXyjFqHGdNtGkPT8QSRACE`](https://solscan.io/token/9CaQUthsVMugZzMvskrrvcHXyjFqHGdNtGkPT8QSRACE)
- Burn operator: [`5G62fW1BuK6k9B6sGwvTBtoKRPseshj9SSYPzudSPUYE`](https://solscan.io/account/5G62fW1BuK6k9B6sGwvTBtoKRPseshj9SSYPzudSPUYE)

The operator wallet also handles other tokens. A transaction is counted only when it contains an SPL Token `burn` or `burnChecked` instruction resolved to the exact PISTA mint.

## Data pipeline

The workflow in `.github/workflows/update-and-deploy.yml` runs every hour at minute 7 and can also be started manually.

1. Helius returns new successful transactions involving the burn operator.
2. The collector checks top-level and inner SPL Token instructions.
3. Only verified PISTA burns are added to `data/dashboard.json`.
4. Current token supply is read from Solana and price data is requested from DexScreener.
5. Updated data is committed by `github-actions[bot]` and the static site is deployed to GitHub Pages.

The collector stores a scan cursor and continues older-history backfills when necessary. After the initial scan, ordinary hourly runs request only new wallet transactions.

## Repository secret

Create an Actions repository secret named:

```text
HELIUS_API_KEY
```

The key is used only inside GitHub Actions and is never included in the published dashboard.

## Local development

Serve the repository root with any static server. For example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

To collect live data locally:

```bash
HELIUS_API_KEY=your_key npm run update
```

To validate and build the deployable site:

```bash
npm test
```

The output is written to `dist/`.

## Links

- [Play Bella Bumper](https://www.bellabumper.fun)
- [Buy PISTA on Jupiter](https://jup.ag/tokens/9CaQUthsVMugZzMvskrrvcHXyjFqHGdNtGkPT8QSRACE)
- [Follow Bella Bumper on X](https://x.com/playbellabumper)

## Data note

The displayed USD value uses the current available market price, not the historical price at the time of each burn. Supply reduction assumes the tracked burn history represents the relevant PISTA burns performed by the configured operator.
