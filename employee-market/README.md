# emPloyeeMarket

A joke prediction-market site styled after Polymarket. The only markets are
"will Dan get a new job" and "when does AI take everyone's job." Odds are
hardcoded in `app.js`, jittered ±10% on each page load, and nudged client-side
when you click Yes/No — nothing is persisted, so a refresh resets everything.

- **Tech:** Static HTML/CSS/JS, no build step, no backend.
- **Hosting:** Netlify (`netlify.toml` publishes the folder as-is).
- Not affiliated with Polymarket — see the on-page disclaimer.

## Local preview

```
cd employee-market
python3 -m http.server 8000
```
